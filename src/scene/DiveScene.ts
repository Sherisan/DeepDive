import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { RoundView } from '../game/engine';
import { ZONES, ZONE_DEPTH, multiplierFor } from '../game/math';
import { formatMultiplier } from '../game/money';
import { sound } from '../game/sound';
import { Diver } from './diver';
import { Manta, buildSchools, type School } from './fauna';
import { buildAnemones, buildCoral, buildGlowSpecks, buildKelp, buildSeaFans, buildTubeSponges, type Placement } from './flora';
import { DIVER_Z, LEDGE_H, LEDGE_W, SEABED_Y, SKY_SHOWN, WALL_INNER, WORLD_DEPTH, caveFront, cavesFor, hoverY, ledgeFor, ledgeY } from './geometry';
import { LEDGES, LEDGE_IDS, type LedgeId } from './ledges';
import {
  GLOW_GLSL,
  applyEnvironment,
  bindGlow,
  makeBackdrop,
  makeCaveGlow,
  makeEnvironment,
  makeGlowLights,
  makeGodRay,
  makeLedgeMaterial,
  makePointPool,
  makeSnow,
  makeSurfaceBand,
  waterColorAt,
  type PointScale,
} from './materials';
import { buildAngler, buildBoat, buildChest, buildClam, buildJelly, buildSeabed, buildShark, sandHeight, type Clam, type Jelly, type Shark } from './models';
import { rng } from './noise';
import { buildCanyonWall, makeRockMaterial, makeRockTexture, sampleWalls } from './rock';

export interface SceneState {
  round: RoundView | null;
  swimming: number | null;
  interactive: boolean;
}

const FOV = 34;
/** The camera always fits at least this much of the canyon (world units on the ledge plane) into the focus box. */
const FRAME_W = 620;
const FRAME_H = 560;
const BUBBLES = 96;
const PLANKTON_PER_CAVE = 14;
/** Where the diver treads water at the surface, beside the boat. */
const IDLE_X = 150;
/** The canyon walls' cliff faces stand this far in front of the ledges. */
const WALL_FRONT = 245;
/** Glow lights 0–2 are the caves; this one is the bite flash or the chest. */
const GLOW_SLOT = 3;
/**
 * Rendering steps, best first. When frames run slow the multisampling gives way to FXAA (much cheaper on
 * integrated GPUs), then the resolution comes down.
 */
const QUALITY_STEPS = [
  { msaa: true, scale: 1 },
  { msaa: false, scale: 1 },
  { msaa: false, scale: 0.86 },
  { msaa: false, scale: 0.74 },
  { msaa: false, scale: 0.64 },
  { msaa: false, scale: 0.56 },
];

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const easeOutBack = (v: number) => {
  const c = 1.6, x = v - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

/**
 * The 3D ocean, filling the screen: a sunlit canyon whose rock-ledge zones the camera follows down. Each
 * zone is one of the ledge paintings on a lit plane, spanning between two procedural cliff walls dressed
 * with kelp, coral, sea fans and glowing sponges. The diver, shark, clams and chest are real 3D models lit
 * by the sun, the diver's torch and the caves' own light. The camera keeps the play column centred in the
 * `focus` element (the part of the screen the HUD panels leave free). Game state comes in through
 * setState; clicks on a cave go out through onPick.
 */
export class DiveScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 9000);
  private readonly timer = new THREE.Timer();
  private readonly uTime = { value: 0 };
  private readonly uScale: PointScale = { value: 1 };
  private readonly fog = new THREE.Fog(0x0b5f88, 1000, 2700);
  private readonly hemi = new THREE.HemisphereLight(0xcdf6ff, 0x0b2a3a, 3);
  private readonly sun = new THREE.DirectionalLight(0xffe3bd, 2.5);
  private readonly backdrop = makeBackdrop();
  /** Cave glow, the shark's red flash and the chest's gold light, shared by the ledge, cliff and sand shaders. */
  private readonly glow = makeGlowLights();
  private readonly caveLight = new THREE.Color('#3fd4ff');
  private readonly biteColor = new THREE.Color('#ff2a3d');
  private readonly chestColor = new THREE.Color('#ffc45a');
  private readonly bitePos = new THREE.Vector3();
  private maxSamples = 4;
  private readonly env: THREE.WebGLRenderTarget;
  private readonly diver: Diver;
  private rockTex: THREE.Texture | null = null;
  private readonly ledgeMats = new Map<LedgeId, THREE.MeshStandardMaterial>();
  private readonly zoneLabels: HTMLDivElement[] = [];
  private readonly caveTags: CSS2DObject[] = [];
  private readonly glows: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private readonly hits: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(9, 9);
  private readonly eyeGeo = new THREE.SphereGeometry(3.3, 12, 8);
  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.5) });
  private readonly clams: { k: number; clam: Clam; born: number }[] = [];
  private readonly eyes: { k: number; group: THREE.Group; born: number }[] = [];
  private shark: { obj: Shark; born: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private readonly chest = buildChest();
  private chestOpenAt = -1;
  private readonly boat = buildBoat();
  private schools: School[] = [];
  private manta: Manta | null = null;
  private readonly jellies: { jelly: Jelly; x: number; y: number; phase: number }[] = [];
  private readonly lures: THREE.Mesh[] = [];
  private readonly bubbles = makePointPool(BUBBLES, new THREE.Color(0.85, 0.97, 1), this.uScale, true, false);
  private readonly bubbleLife = new Float32Array(BUBBLES).fill(99);
  private readonly bubbleSeed = new Float32Array(BUBBLES);
  private nextBubble = 0;
  private bubbleTimer = 0;
  private readonly plankton = makePointPool(PLANKTON_PER_CAVE * 3, new THREE.Color(0.6, 2.2, 2.6), this.uScale, false, true);
  private planktonBase: THREE.Vector3[] = [];
  private state: SceneState = { round: null, swimming: null, interactive: false };
  private roundId: string | null = null;
  private hovered = -1;
  private camY = 0;
  private lookX = 0;
  private lookY = 0;
  private facing = 0;
  private biteAt = -1;
  private readonly aim = new THREE.Vector3();
  private readonly aimTarget = new THREE.Vector3();
  private aimOn = false;
  // Framing: world units per CSS pixel on the ledge plane, camera distance, focus box.
  private u = 1;
  private dist = 1000;
  private focusHalfH = 280;
  private view = { w: 1, h: 1, cx: 0.5, cy: 0.5 };
  // Resolution scaling to hold the frame rate on slower GPUs.
  private basePr = 1;
  private level = 0;
  /** The best step this GPU uses at all (integrated GPUs skip multisampling). */
  private topLevel = 0;
  /** The best step allowed: once a step has proved too slow, don't go back to it (until the canvas changes size). */
  private ceiling = 0;
  private readonly fxaa = new ShaderPass(FXAAShader);
  private readonly frameTimes: number[] = [];
  /** Frames aren't judged before this time: start-up, or just after a change of step. */
  private settleUntil = 3;
  private readonly lastPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private raf = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly focus: HTMLElement | null,
    private readonly onPick: (cave: number) => void,
  ) {
    const phone = window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.basePr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.75);
    renderer.setPixelRatio(this.basePr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    // Checking every shader's info log costs start-up time and only matters while developing.
    renderer.debug.checkShaderErrors = import.meta.env.DEV;
    // Integrated and software GPUs start on FXAA rather than multisampling (it costs them a third of the
    // frame); everything else starts at the top step and comes down only if it has to.
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Intel|Iris|UHD|HD Graphics|Vega \d+ Graphics|Radeon\(TM\) Graphics|Radeon Graphics|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render/i.test(gpu)) {
      this.level = this.ceiling = this.topLevel = 1;
    }
    renderer.domElement.className = 'ocean-canvas';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.labels.domElement.className = 'ocean-labels';
    host.appendChild(this.labels.domElement);

    // HDR, multisampled: bloom picks out anything brighter than white (pearls, eyes, torch, glow).
    this.maxSamples = phone ? 2 : 4;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.maxSamples }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold above 1: only HDR emitters bloom, so the bright sky never veils the scene.
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 1.02);
    // Bloom blurs every pixel into its neighbours, so one NaN or Inf from any shader would black out the
    // whole frame. Drop such pixels (and cap extreme HDR) before they spread.
    const hp = bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      // (D3D's shader compiler drops isnan(), so test the float bits.)
      'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tbvec4 bad = greaterThanEqual( floatBitsToUint( texel ) & 0x7fffffffu, uvec4( 0x7f800000u ) );\n\t\t\ttexel = any( bad ) ? vec4( 0.0 ) : clamp( texel, 0.0, 64.0 );',
    );
    hp.needsUpdate = true;
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa.enabled = false;
    this.composer.addPass(this.fxaa);

    this.env = makeEnvironment(renderer);
    this.diver = new Diver(this.env.texture);
    applyEnvironment(this.chest.root, this.env.texture, 0.9);
    applyEnvironment(this.boat.root, this.env.texture, 0.4);

    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.backdrop.mesh);
    this.buildSurface();
    this.buildCanyon();
    this.buildLedges();
    this.buildLife();
    this.buildCaveEffects();
    this.buildLabels();
    this.diver.root.position.set(IDLE_X, -24, DIVER_Z);
    this.lastPos.copy(this.diver.root.position);
    this.scene.add(this.diver.root);
    this.chest.root.remove(this.chest.light);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    if (focus) this.resizeObserver.observe(focus);
    window.addEventListener('resize', this.onWindowResize);
    this.resize();
    this.camY = this.camTop();
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerleave', this.onPointerLeave);
    host.addEventListener('click', this.onClick);
    this.timer.connect(document);
    this.raf = requestAnimationFrame(this.loop);
    // Dev only (stripped from builds): lets the browser test scripts inspect the scene.
    if (import.meta.env.DEV) Object.assign(window, { __dive: this });
  }

  // ── Building the world ────────────────────────────────────────────────

  private buildSurface() {
    const band = makeSurfaceBand(this.uTime);
    band.position.set(0, -20, 45);
    this.scene.add(band);
    this.boat.root.position.set(-30, 4, -80);
    this.boat.root.rotation.y = -0.18;
    this.scene.add(this.boat.root);
    // Sun shafts down the canyon, and a few in front of the cliffs at the sides of the screen.
    const r = rng(77);
    for (let i = 0; i < 13; i++) {
      const inCanyon = i < 8;
      const ray = makeGodRay(this.uTime, i * 1.37);
      const w = inCanyon ? 55 + r() * 75 : 80 + r() * 90;
      const h = 700 + r() * 380;
      ray.scale.set(w, h, 1);
      const x = inCanyon ? -280 + i * 76 + r() * 30 : (i % 2 ? 1 : -1) * (380 + r() * 420);
      const z = inCanyon ? -420 + r() * 480 : WALL_FRONT + 40 + r() * 200;
      ray.position.set(x, -h / 2 - 6, z);
      ray.rotation.z = -0.22 + r() * 0.12;
      this.scene.add(ray);
    }
  }

  private buildCanyon() {
    const tex = makeRockTexture(512);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.rockTex = tex;
    const mat = makeRockMaterial(tex, this.uTime, WORLD_DEPTH, this.glow);
    const opts = { inner: WALL_INNER, front: WALL_FRONT, top: 120, bottom: SEABED_Y - 340 };
    const left = buildCanyonWall(-1, mat, { ...opts, seed: 3 });
    const right = buildCanyonWall(1, mat, { ...opts, seed: 8 });
    this.scene.add(left.mesh, right.mesh);

    // Life on the walls, by depth: kelp and coral in the light, sea fans mid-water, glowing sponges deep.
    const walls = [left.surface, right.surface];
    const r = rng(42);
    const open = (p: THREE.Vector3, n: THREE.Vector3) => n.z > 0.45 || n.x * -Math.sign(p.x) > 0.45;
    const inView = (p: THREE.Vector3) => Math.abs(p.x) < 1050 && p.z > -950;
    const kelp = sampleWalls(walls, r, 70, (p, n) => p.y < -70 && p.y > -820 && n.y > -0.25 && open(p, n) && inView(p));
    this.scene.add(buildKelp(kelp, this.uTime, { h: [110, 290], w: [12, 22], top: -16, base: '#23290c', tip: '#86782a', seed: 5, cluster: 3 }));
    const coral = sampleWalls(walls, r, 130, (p, n) => p.y < -36 && p.y > -900 && n.y > 0.55 && inView(p));
    this.scene.add(buildCoral(coral, ['#e8735a', '#e889ad', '#a77fd6', '#e6b85c', '#e0884a', '#d65f6a'], 9));
    const fans = sampleWalls(walls, r, 48, (p, n) => p.y < -640 && p.y > -1760 && open(p, n) && inView(p));
    this.scene.add(buildSeaFans(fans, ['#b0326e', '#d4504f', '#8e44ad', '#e67e22', '#c0392b', '#d35f9e'], this.uTime, 13));
    // Purple tube sponges mid-water and glowing anemones in the deep, as on the ledge art.
    const tubes = sampleWalls(walls, r, 26, (p, n) => p.y < -760 && p.y > -1560 && n.y > 0.35 && inView(p));
    this.scene.add(buildTubeSponges(tubes, ['#7b3fc4', '#9a3fb0', '#6544c8'], 17));
    const anemones = sampleWalls(walls, r, 70, (p, n) => p.y < -1580 && p.y > -2640 && n.y > 0.15 && inView(p));
    this.scene.add(buildAnemones(anemones, ['#4fd8ff', '#5fa8ff', '#ff6fb5', '#7dffe0'], this.uTime, 19));
    const specks = sampleWalls(walls, r, 620, (p, n) => p.y < -1250 && p.y > -2760 && open(p, n) && inView(p));
    this.scene.add(buildGlowSpecks(specks, ['#59f3ff', '#7dffb2', '#b18cff', '#4fb6ff'], this.uTime, this.uScale, 21));
  }

  /** Let a standard material receive the glow lights (cave light, bite flash, chest gold). */
  private addGlowTo(m: THREE.MeshStandardMaterial, key: string) {
    m.onBeforeCompile = (shader) => {
      bindGlow(shader, this.glow);
      shader.vertexShader = `varying vec3 vGlowPos;\nvarying vec3 vGlowNrm;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vGlowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vGlowNrm = mat3(modelMatrix) * objectNormal;',
      );
      shader.fragmentShader = `varying vec3 vGlowPos;\nvarying vec3 vGlowNrm;\n${GLOW_GLSL}\n${shader.fragmentShader}`.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * glowLight(vGlowPos, normalize(vGlowNrm));',
      );
    };
    m.customProgramCacheKey = () => key;
  }

  private buildLedges() {
    const loader = new THREE.TextureLoader();
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    for (const id of LEDGE_IDS) {
      const mat = makeLedgeMaterial(this.uTime, id.startsWith('deep') ? 1.4 : 0, LEDGES[id].bottom, this.glow);
      this.ledgeMats.set(id, mat);
      loader.load(`${import.meta.env.BASE_URL}ledges/${id}.webp`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = anisotropy;
        mat.map = tex;
        mat.bumpMap = tex;
        mat.needsUpdate = true;
        mat.userData.ready = true;
      });
    }
    const geo = new THREE.PlaneGeometry(LEDGE_W, LEDGE_H);
    for (let k = 0; k < ZONES; k++) {
      const { id, mirror } = ledgeFor(k);
      const mesh = new THREE.Mesh(geo, this.ledgeMats.get(id)!);
      mesh.position.set(0, ledgeY(k), 0);
      if (mirror) mesh.scale.x = -1;
      // Deeper ledges draw later, over the haze hanging below the one above.
      mesh.renderOrder = 10 + k;
      this.scene.add(mesh);
    }
  }

  private buildLife() {
    this.schools = buildSchools(
      [
        { count: 28, palette: ['#ffd23f', '#3fa7ff', '#ffe27a'], scale: 1, y: -170, z: -40, ax: 205, ay: 40, az: 120, speed: 34, seed: 1 },
        { count: 34, palette: ['#c9e4f2', '#9fc4d8', '#e7f4fb'], scale: 0.8, y: -610, z: -260, ax: 220, ay: 60, az: 190, speed: 46, seed: 2 },
        { count: 22, palette: ['#ff7f3f', '#ff9a5a', '#ffb27a'], scale: 0.9, y: -1030, z: -130, ax: 195, ay: 50, az: 140, speed: 30, seed: 3 },
        { count: 16, palette: ['#8fb7c9', '#b8d6e3'], scale: 1.1, y: -1520, z: -330, ax: 195, ay: 70, az: 170, speed: 38, seed: 4 },
      ],
      this.uTime,
      this.env.texture,
    );
    for (const s of this.schools) this.scene.add(s.mesh);
    this.manta = new Manta(this.uTime, -1080, -640);
    this.scene.add(this.manta.root);

    const jellies: [number, number, string, number][] = [
      [-232, 3, '#ff7ad9', -90],
      [226, 4, '#7cf3ff', -120],
      [-238, 5, '#b98aff', -70],
      [215, 6, '#ff9be6', -100],
    ];
    jellies.forEach(([x, k, color, z], i) => {
      const jelly = buildJelly(color);
      const y = hoverY(k) + 12;
      jelly.root.position.set(x, y, z);
      this.scene.add(jelly.root);
      this.jellies.push({ jelly, x, y, phase: i * 1.7 });
    });

    for (const [x, k, flip] of [
      [-246, 6, 1],
      [246, 7, -1],
    ] as const) {
      const a = buildAngler();
      a.root.position.set(x, hoverY(k) + 4, -110);
      a.root.scale.x = flip;
      this.lures.push(a.lure);
      this.scene.add(a.root);
    }

    const bed = buildSeabed((m) => this.addGlowTo(m, 'dive-sand'));
    bed.position.y = SEABED_Y;
    this.scene.add(bed);
    this.chest.root.position.set(70, SEABED_Y + sandHeight(10) - 6, 10);
    this.chest.root.rotation.y = -0.25;
    this.scene.add(this.chest.root);
    // Sea grass and a few sponges on the canyon floor.
    const r = rng(99);
    const grass: Placement[] = [];
    const floorSponges: Placement[] = [];
    const n = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 190; i++) {
      const z = 40 - r() * 560;
      const x = (r() - 0.5) * 560;
      if (Math.abs(x - 70) < 70 && Math.abs(z - 10) < 50) continue;
      grass.push({ p: new THREE.Vector3(x, SEABED_Y + sandHeight(z) - 3, z), n });
    }
    for (let i = 0; i < 12; i++) {
      const z = -60 - r() * 380;
      floorSponges.push({ p: new THREE.Vector3((r() - 0.5) * 520, SEABED_Y + sandHeight(z) - 2, z), n });
    }
    this.scene.add(buildKelp(grass, this.uTime, { h: [16, 48], w: [3, 6], base: '#1f3a14', tip: '#6f9a34', seed: 31 }));
    this.scene.add(buildAnemones(floorSponges, ['#4fd8ff', '#ff6fb5', '#7dffe0'], this.uTime, 33));

    this.scene.add(makeSnow(1800, { x: 1000, yTop: -30, yBottom: SEABED_Y, zFar: -900, zNear: 700 }, this.uTime, this.uScale));
    for (let i = 0; i < BUBBLES; i++) this.bubbleSeed[i] = Math.random();
    this.scene.add(this.bubbles, this.plankton);
  }

  private buildCaveEffects() {
    const hitGeo = new THREE.CircleGeometry(1, 24);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    for (let c = 0; c < 3; c++) {
      const glow = makeCaveGlow(this.uTime);
      glow.visible = false;
      const hit = new THREE.Mesh(hitGeo, hitMat);
      this.glows.push(glow);
      this.hits.push(hit);
      this.scene.add(glow, hit);
    }
  }

  private buildLabels() {
    for (let k = 0; k < ZONES; k++) {
      const el = document.createElement('div');
      el.className = 'zl';
      el.innerHTML = `<b>${formatMultiplier(multiplierFor(k + 1))}</b><small>${(k + 1) * ZONE_DEPTH} m</small>`;
      const obj = new CSS2DObject(el);
      obj.position.set(WALL_INNER - 66, hoverY(k) + 4, 0);
      this.scene.add(obj);
      this.zoneLabels.push(el);
    }
    for (let c = 0; c < 3; c++) {
      const el = document.createElement('div');
      el.className = 'cave-tag';
      el.textContent = String(c + 1);
      const obj = new CSS2DObject(el);
      obj.visible = false;
      this.scene.add(obj);
      this.caveTags.push(obj);
    }
  }

  // ── Game state in ─────────────────────────────────────────────────────

  setState(next: SceneState) {
    this.state = next;
    const r = next.round;
    const id = r?.id ?? null;
    if (id !== this.roundId) {
      this.clearRound();
      this.roundId = id;
      if (r?.status === 'live' && r.picks.length === 0) this.burst(this.diver.root.position, 26);
    }
    if (r) {
      for (let k = 0; k < r.rung; k++) if (!this.clams.some((c) => c.k === k)) this.addClam(k, r.picks[k]);
      if (r.status !== 'live' && r.sharks && this.eyes.length === 0) {
        r.sharks.forEach((c, k) => {
          if (!(r.status === 'bitten' && k === r.picks.length - 1)) this.addEyes(k, c);
        });
      }
      if (r.status === 'bitten' && !this.shark) this.spawnShark(r.picks.length - 1, r.picks[r.picks.length - 1]);
      if (r.status === 'abyss' && this.chestOpenAt < 0) this.chestOpenAt = this.uTime.value;
    }
    this.placeActiveZone(r?.status === 'live' ? r.picks.length : -1);
    this.zoneLabels.forEach((el, k) => {
      el.className = `zl${r?.status === 'live' && k === r.picks.length ? ' active' : ''}${r && k < r.rung ? ' cleared' : ''}`;
    });
    this.pickTest();
  }

  private clearRound() {
    for (const { clam } of this.clams) {
      this.scene.remove(clam.root);
      disposeTree(clam.root);
    }
    this.clams.length = 0;
    for (const { group } of this.eyes) this.scene.remove(group);
    this.eyes.length = 0;
    if (this.shark) {
      this.scene.remove(this.shark.obj.root);
      disposeTree(this.shark.obj.root);
      this.shark = null;
    }
    this.chestOpenAt = -1;
    this.biteAt = -1;
  }

  private addClam(k: number, c: number) {
    const spot = cavesFor(k)[c];
    const clam = buildClam();
    applyEnvironment(clam.root, this.env.texture, 1);
    clam.root.position.set(spot.x, spot.y - spot.r * 0.42, 16);
    clam.root.scale.setScalar(0.001);
    this.scene.add(clam.root);
    this.clams.push({ k, clam, born: this.uTime.value });
  }

  private addEyes(k: number, c: number) {
    const spot = cavesFor(k)[c];
    const group = new THREE.Group();
    for (const dx of [-1, 1]) {
      const eye = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      eye.position.x = dx * spot.r * 0.22;
      group.add(eye);
    }
    group.position.set(spot.x, spot.y + spot.r * 0.1, 6);
    group.scale.setScalar(0.001);
    this.scene.add(group);
    this.eyes.push({ k, group, born: this.uTime.value + k * 0.07 });
  }

  /** The shark bursts out of the cave and lunges up past the diver, side-on to the camera. */
  private spawnShark(k: number, c: number) {
    const spot = cavesFor(k)[c];
    const obj = buildShark(this.uTime);
    applyEnvironment(obj.root, this.env.texture, 0.45);
    const from = new THREE.Vector3(spot.x, spot.y - spot.r * 0.1, -95);
    const side = spot.x <= 0 ? 1 : -1;
    const to = new THREE.Vector3(spot.x + side * 70, spot.y + spot.r * 0.55 + 34, DIVER_Z - 16);
    const f = to.clone().sub(from).normalize();
    const up = new THREE.Vector3(0, 1, 0).sub(f.clone().multiplyScalar(f.y)).normalize();
    const s = new THREE.Vector3().crossVectors(f, up);
    obj.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, up, s));
    obj.root.position.copy(from);
    obj.root.scale.setScalar(0.6);
    this.scene.add(obj.root);
    this.shark = { obj, born: this.uTime.value, from, to };
    this.biteAt = this.uTime.value;
    this.bitePos.set(spot.x, spot.y, 34);
  }

  /** Glow, light, tap targets, number tags and plankton follow the zone being chosen in. */
  private placeActiveZone(zone: number) {
    const caves = zone >= 0 ? cavesFor(zone) : null;
    for (let c = 0; c < 3; c++) {
      const spot = caves?.[c];
      this.glows[c].visible = !!spot;
      this.caveTags[c].visible = false;
      if (!spot) continue;
      this.glows[c].position.set(spot.x, spot.y + spot.r * 0.08, 4);
      this.glows[c].scale.set(spot.r * 2.9, spot.r * 2.9, 1);
      this.glow.pos.value[c].set(spot.x, spot.y + spot.r * 0.2, 46, 230);
      this.hits[c].position.set(spot.x, spot.y, 8);
      this.hits[c].scale.setScalar(spot.r * 1.2);
      this.caveTags[c].position.set(spot.x, spot.y + spot.r * 1.35 + 12, 10);
    }
    this.planktonBase = [];
    if (caves) {
      for (const s of caves) {
        for (let i = 0; i < PLANKTON_PER_CAVE; i++) {
          this.planktonBase.push(new THREE.Vector3(s.x + (Math.random() - 0.5) * s.r * 1.3, s.y + (Math.random() - 0.4) * s.r * 1.1, 10 + Math.random() * 18));
        }
      }
    }
  }

  // ── Picking ───────────────────────────────────────────────────────────

  private canPick() {
    const s = this.state;
    return s.interactive && s.round?.status === 'live' && s.swimming === null;
  }

  private pickTest() {
    let idx = -1;
    if (this.canPick() && this.pointer.x <= 1) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.hits, false)[0];
      if (hit) idx = this.hits.indexOf(hit.object as THREE.Mesh);
    }
    if (idx !== this.hovered) {
      this.hovered = idx;
      this.host.style.cursor = idx >= 0 ? 'pointer' : '';
      if (idx >= 0) sound.hover();
    }
  }

  private setPointer(e: MouseEvent) {
    const r = this.host.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.setPointer(e);
    this.pickTest();
  };

  private onPointerLeave = () => {
    this.pointer.set(9, 9);
    this.pickTest();
  };

  private onClick = (e: MouseEvent) => {
    this.setPointer(e);
    this.pickTest();
    if (this.hovered >= 0 && this.canPick()) this.onPick(this.hovered);
  };

  private onWindowResize = () => this.resize();

  // ── Frame loop ────────────────────────────────────────────────────────

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(now);
    const raw = this.timer.getDelta();
    // Never 0: velocities divide by it (a NaN would stick to the diver for good).
    const dt = Math.min(0.05, Math.max(1e-3, raw));
    const t = (this.uTime.value += dt);
    this.updateDiver(dt, t);
    this.updateCamera(dt, t);
    this.updateGrading();
    this.updateLife(dt, t);
    this.updateEffects(t);
    if (this.canPick()) this.pickTest();
    this.composer.render(dt);
    this.labels.render(this.scene, this.camera);
    this.adaptResolution(Math.min(raw, 0.25));
  };

  /** Step the rendering cost down when frames run slow, and back up when there is headroom. */
  private adaptResolution(frame: number) {
    if (this.uTime.value < this.settleUntil || frame > 0.25) return;
    this.frameTimes.push(frame);
    if (this.frameTimes.length < 100) return;
    // The median shrugs off one-off hitches (a shader compiling, a texture upload): it only moves when
    // most frames are slow.
    const median = this.frameTimes.sort((a, b) => a - b)[this.frameTimes.length >> 1];
    this.frameTimes.length = 0;
    if (median > 1 / 45 && this.level < QUALITY_STEPS.length - 1) {
      this.level++;
      this.ceiling = this.level;
      this.applyResolution();
    } else if (median < 1 / 58 && this.level > this.ceiling) {
      this.level--;
      this.applyResolution();
    }
  }

  private camTop() {
    return SKY_SHOWN - this.focusHalfH;
  }

  private camBottom() {
    return SEABED_Y - 70 + this.focusHalfH;
  }

  private cavePoint(k: number, c: number) {
    const s = cavesFor(k)[c];
    return this.aimTarget.set(s.x, s.y, 10);
  }

  private updateDiver(dt: number, t: number) {
    const { round: r, swimming } = this.state;
    const status = r?.status;
    const p = this.diver.root.position;
    let tx = IDLE_X, ty = -24, rate = 3.2;
    let aim: THREE.Vector3 | null = null;
    if (r && status === 'live') {
      const zone = r.picks.length;
      if (swimming !== null) {
        const f = caveFront(zone, swimming);
        tx = f.x;
        ty = f.y;
        rate = 6.5;
        aim = this.cavePoint(zone, swimming);
      } else {
        tx = 0;
        ty = hoverY(zone);
        rate = zone === 0 ? 2.4 : 3.4;
        if (this.hovered >= 0) aim = this.cavePoint(zone, this.hovered);
      }
    } else if (r && status === 'bitten') {
      const k = r.picks.length - 1;
      const f = caveFront(k, r.picks[k]);
      tx = f.x;
      ty = f.y;
      rate = 6;
      aim = this.cavePoint(k, r.picks[k]);
    } else if (status === 'abyss') {
      tx = -150;
      ty = SEABED_Y + 70;
      rate = 2.4;
      aim = this.aimTarget.copy(this.chest.root.position).add(this.tmp.set(0, 30, 0));
    } else if (status === 'surfaced') {
      rate = 1.15;
    }
    this.lastPos.copy(p);
    p.x += (tx - p.x) * damp(rate, dt);
    p.y += (ty - p.y) * damp(rate, dt);
    const vx = (p.x - this.lastPos.x) / dt;
    const vy = (p.y - this.lastPos.y) / dt;

    // Face the way it swims; while choosing, turn toward the cave the torch is on.
    if (Math.abs(tx - p.x) > 10) this.facing = tx < p.x ? Math.PI : 0;
    else if (aim && Math.abs(aim.x - p.x) > 30) this.facing = aim.x < p.x ? Math.PI : 0;
    else if (status === 'abyss') this.facing = 0;
    // Ease the torch target so the beam sweeps rather than jumps.
    if (aim) {
      if (!this.aimOn) this.aim.copy(aim);
      else this.aim.lerp(aim, damp(7, dt));
    }
    this.aimOn = !!aim;

    const sinceBite = status === 'bitten' && this.biteAt >= 0 ? t - this.biteAt : -1;
    this.diver.update({
      dt,
      t,
      yaw: this.facing,
      speed: clamp01(Math.hypot(vx, vy) / 170),
      climb: THREE.MathUtils.clamp(vy / 240, -1, 1),
      surface: p.y > -70 && (!r || status === 'surfaced'),
      bite: sinceBite,
      aim: aim ? this.aim : null,
      depth: clamp01(-p.y / WORLD_DEPTH),
    });

    // The torch lights the rock through the glow-light term (a real spot light would cost every pixel).
    const dv = this.diver;
    this.glow.torchPos.value.set(dv.torchPos.x, dv.torchPos.y, dv.torchPos.z, 760);
    this.glow.torchDir.value.set(dv.torchDir.x, dv.torchDir.y, dv.torchDir.z, 0.87);
    this.glow.torchCol.value.setRGB(1, 0.93, 0.8).multiplyScalar(dv.torchPower * 2.6);

    // Bubbles leave the regulator on each out-breath.
    if (p.y < -40) {
      this.bubbleTimer -= dt;
      if (this.diver.exhaling(t) && this.bubbleTimer <= 0) {
        this.bubbleTimer = 0.035 + Math.random() * 0.05;
        this.emitBubble(this.diver.exhaustWorld(this.tmp), 0);
      }
    }
  }

  private updateCamera(dt: number, t: number) {
    const status = this.state.round?.status;
    const p = this.diver.root.position;
    const target = THREE.MathUtils.clamp(!status || status === 'surfaced' ? this.camTop() : p.y - 70, this.camBottom(), this.camTop());
    this.camY += (target - this.camY) * damp(status === 'surfaced' ? 1.05 : 2.6, dt);
    // A jolt when the shark strikes.
    let sx = 0, sy = 0;
    const since = this.biteAt >= 0 ? t - this.biteAt : -1;
    if (since >= 0 && since < 0.9) {
      const f = (1 - since / 0.9) ** 2;
      sx = Math.sin(t * 57) * 9 * f;
      sy = Math.cos(t * 49) * 7 * f;
    }
    this.lookX = p.x * 0.06 + sx;
    this.lookY = this.camY + sy;
    this.camera.position.set(Math.sin(t * 0.13) * 12 + p.x * 0.12 + sx, this.lookY + Math.sin(t * 0.21) * 3, this.dist);
    this.camera.lookAt(this.lookX, this.lookY, 0);
  }

  /** Light and water colour follow the camera's depth: bright and sunlit near the top, dark below. */
  private updateGrading() {
    const d = clamp01(-this.camY / WORLD_DEPTH);
    waterColorAt(Math.min(1, d * 1.05 + 0.03), this.fog.color);
    this.hemi.intensity = THREE.MathUtils.lerp(2, 0.8, Math.pow(d, 0.55));
    this.sun.intensity = 1.3 * (1 - THREE.MathUtils.smoothstep(d, 0, 0.42));
    // Sun from the upper left, raking across the cliffs so their relief shows.
    this.sun.position.set(-420, this.camY + 820, 380);
    this.sun.target.position.set(0, this.camY, 0);
    const { w, h, cx, cy } = this.view;
    this.backdrop.uniforms.uOrigin.value.set(this.lookX + (w / 2 - cx) * this.u, this.lookY - (h / 2 - cy) * this.u);
  }

  private updateLife(dt: number, t: number) {
    for (const m of this.ledgeMats.values()) if (m.userData.ready && m.opacity < 1) m.opacity = Math.min(1, m.opacity + dt * 2);

    this.boat.root.position.y = 4 + Math.sin(t * 1.2) * 2.2;
    this.boat.root.rotation.z = Math.sin(t * 0.9) * 0.03;
    this.boat.flag.rotation.y = Math.sin(t * 3) * 0.3;
    for (const s of this.schools) s.update(t);
    this.manta?.update(t);

    for (const { jelly, x, y, phase } of this.jellies) {
      const pulse = Math.sin(t * 2.1 + phase);
      jelly.bell.scale.set(1 - 0.07 * pulse, 1 + 0.1 * pulse, 1 - 0.07 * pulse);
      jelly.root.position.x = x + Math.sin(t * 0.23 + phase) * 14;
      jelly.root.position.y = y + Math.sin(t * 0.5 + phase) * 16;
      jelly.lines.forEach((line, j) => {
        const pos = line.geometry.attributes.position as THREE.BufferAttribute;
        const b = jelly.base[j];
        for (let i = 0; i < pos.count; i++) {
          pos.setXYZ(i, b.x + Math.sin(t * 2 + i * 0.45 + phase + j) * i * 0.45, -i * 4 * (1 + 0.1 * pulse), b.z + Math.cos(t * 1.7 + i * 0.4 + j) * i * 0.3);
        }
        pos.needsUpdate = true;
      });
    }
    this.lures.forEach((l, i) => l.scale.setScalar(1 + 0.3 * Math.sin(t * 2.4 + i * 2)));

    // Bubbles rise, wobble, grow a little and pop at the surface.
    const bp = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    const ba = this.bubbles.geometry.attributes.aAlpha as THREE.BufferAttribute;
    const bs = this.bubbles.geometry.attributes.aSize as THREE.BufferAttribute;
    for (let i = 0; i < BUBBLES; i++) {
      if (this.bubbleLife[i] > 2.6) {
        ba.setX(i, 0);
        continue;
      }
      const life = (this.bubbleLife[i] += dt);
      const seed = this.bubbleSeed[i];
      bp.setXYZ(i, bp.getX(i) + Math.sin(t * 3 + seed * 20) * 14 * dt, bp.getY(i) + (38 + seed * 46) * dt, bp.getZ(i));
      bs.setX(i, bs.getX(i) * (1 + dt * 0.12));
      if (bp.getY(i) > -10) this.bubbleLife[i] = 99;
      ba.setX(i, Math.min(1, life * 6) * (1 - life / 2.6) * 0.9);
    }
    bp.needsUpdate = true;
    ba.needsUpdate = true;
    bs.needsUpdate = true;
  }

  private emitBubble(at: THREE.Vector3, spread: number) {
    const bp = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    const bs = this.bubbles.geometry.attributes.aSize as THREE.BufferAttribute;
    const i = this.nextBubble;
    this.nextBubble = (i + 1) % BUBBLES;
    bp.setXYZ(i, at.x + (Math.random() - 0.5) * (3 + spread), at.y + (Math.random() - 0.5) * (3 + spread), at.z + (Math.random() - 0.5) * 4);
    bs.setX(i, 1.6 + Math.random() * 3.4);
    bs.needsUpdate = true;
    this.bubbleLife[i] = Math.random() * 0.15;
    this.bubbleSeed[i] = Math.random();
  }

  /** A splash of bubbles, e.g. when the diver drops in. */
  private burst(at: THREE.Vector3, n: number) {
    const p = at.clone();
    p.y = Math.min(p.y, -20);
    for (let i = 0; i < n; i++) this.emitBubble(p, 60);
  }

  private updateEffects(t: number) {
    const { round: r, swimming, interactive } = this.state;
    const live = r?.status === 'live';

    for (let c = 0; c < 3; c++) {
      if (!this.glows[c].visible) {
        this.glow.col.value[c].setRGB(0, 0, 0);
        continue;
      }
      let k = 0.85 + 0.25 * Math.sin(t * 2.6 + c * 1.3);
      if (live && swimming === c) k = 1.8 + 1.2 * Math.sin(t * 16);
      else if (live && swimming !== null) k *= 0.35;
      else if (this.hovered === c) k = 2.1;
      this.glows[c].material.uniforms.uIntensity.value = k;
      this.glow.col.value[c].copy(this.caveLight).multiplyScalar(0.85 * k);
      this.caveTags[c].visible = live && swimming === null && interactive;
    }

    const pp = this.plankton.geometry.attributes.position as THREE.BufferAttribute;
    const pa = this.plankton.geometry.attributes.aAlpha as THREE.BufferAttribute;
    const ps = this.plankton.geometry.attributes.aSize as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const b = this.planktonBase[i];
      if (!b) {
        pa.setX(i, 0);
        continue;
      }
      pp.setXYZ(i, b.x + Math.sin(t * 0.9 + i) * 4, b.y + Math.sin(t * 0.7 + i * 1.7) * 5, b.z);
      pa.setX(i, 0.55 + 0.45 * Math.sin(t * 3 + i * 2.3));
      ps.setX(i, 2.2);
    }
    pp.needsUpdate = pa.needsUpdate = ps.needsUpdate = true;

    for (const { k, clam, born } of this.clams) {
      const age = t - born;
      clam.root.scale.setScalar(Math.max(0.001, easeOutBack(clamp01(age / 0.5))));
      clam.hinge.rotation.x = -1.05 * smooth(clamp01((age - 0.15) / 0.6));
      clam.pearl.material.emissiveIntensity = 1.6 + 0.5 * Math.sin(t * 2 + k);
    }
    for (const { k, group, born } of this.eyes) {
      const s = clamp01((t - born) / 0.35);
      const blink = Math.sin(t * 1.1 + k * 2.3) > 0.985 ? 0.15 : 1;
      group.scale.set(Math.max(0.001, s), Math.max(0.001, s * blink), Math.max(0.001, s));
    }

    if (this.shark) {
      const age = t - this.shark.born;
      const root = this.shark.obj.root;
      root.position.lerpVectors(this.shark.from, this.shark.to, easeOutBack(clamp01(age / 0.42)));
      root.position.y += age > 0.42 ? Math.sin(t * 1.5) * 3 : 0;
      root.scale.setScalar(0.6 + 0.65 * clamp01(age / 0.3));
      this.shark.obj.tail.rotation.y = Math.sin(t * 9) * 0.35;
    }
    const sinceBite = this.biteAt >= 0 ? t - this.biteAt : -1;
    const open = this.chestOpenAt >= 0 ? t - this.chestOpenAt : -1;
    // The fourth glow light is the shark's red flash, or the open chest's gold.
    const spare = GLOW_SLOT;
    this.chest.hinge.rotation.x = open < 0 ? 0 : -1.9 * easeOutBack(clamp01((open - 0.35) / 0.9));
    if (sinceBite >= 0) {
      this.glow.pos.value[spare].set(this.bitePos.x, this.bitePos.y, this.bitePos.z, 330);
      this.glow.col.value[spare].copy(this.biteColor).multiplyScalar(1.7 * (sinceBite < 1.4 ? 0.55 + 0.45 * Math.sin(sinceBite * 22) : 0.45));
    } else if (open >= 0) {
      const c = this.chest.root.position;
      this.glow.pos.value[spare].set(c.x, c.y + 55, c.z + 18, 540);
      this.glow.col.value[spare].copy(this.chestColor).multiplyScalar(2.4 * clamp01((open - 0.5) / 1));
    } else this.glow.col.value[spare].setRGB(0, 0, 0);
    this.chest.beam.material.uniforms.uOpacity.value = open < 0 ? 0 : clamp01((open - 0.6) / 1.2) * (0.8 + 0.2 * Math.sin(t * 2));
    this.chest.gold.material.emissiveIntensity = open < 0 ? 0 : 1.2 * clamp01((open - 0.5) / 1);
  }

  // ── Framing ───────────────────────────────────────────────────────────

  /**
   * Fit the camera so the play column fills the focus box (the area between the HUD panels) while the
   * scene runs on under the panels to every edge of the screen: an off-centre view (lens shift) puts the
   * camera's axis on the focus box's centre.
   */
  private resize() {
    const W = this.host.clientWidth, H = this.host.clientHeight;
    if (!W || !H) return;
    let fx = 0, fy = 0, fw = W, fh = H;
    if (this.focus) {
      const hr = this.host.getBoundingClientRect();
      const fr = this.focus.getBoundingClientRect();
      if (fr.width > 40 && fr.height > 40) {
        fx = fr.left - hr.left;
        fy = fr.top - hr.top;
        fw = fr.width;
        fh = fr.height;
      }
    }
    const cx = THREE.MathUtils.clamp(fx + fw / 2, 0, W);
    const cy = THREE.MathUtils.clamp(fy + fh / 2, 0, H);
    this.u = Math.max(FRAME_W / fw, FRAME_H / fh);
    const fullW = 2 * Math.max(cx, W - cx), fullH = 2 * Math.max(cy, H - cy);
    this.dist = ((fullH / 2) * this.u) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.aspect = fullW / fullH;
    this.camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
    this.camera.far = this.dist + 3600;
    this.camera.updateProjectionMatrix();
    this.focusHalfH = (fh / 2) * this.u;
    this.fog.near = this.dist + 60;
    this.fog.far = this.dist + 1900;
    // A new canvas size is a new workload: allow the better steps again.
    if (W !== this.view.w || H !== this.view.h) this.ceiling = this.topLevel;
    this.view = { w: W, h: H, cx, cy };
    this.applyResolution();
  }

  private applyResolution() {
    const { w, h } = this.view;
    const step = QUALITY_STEPS[this.level];
    const pr = this.basePr * step.scale;
    const samples = step.msaa ? this.maxSamples : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    this.fxaa.enabled = !step.msaa;
    this.settleUntil = this.uTime.value + 1;
    this.frameTimes.length = 0;
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.uScale.value = (pr / this.u) * this.dist;
    this.backdrop.uniforms.uHalf.value.set((w / 2) * this.u, (h / 2) * this.u);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.timer.dispose();
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.removeEventListener('click', this.onClick);
    this.host.style.cursor = '';
    disposeTree(this.scene);
    this.rockTex?.dispose();
    this.env.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
