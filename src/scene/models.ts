import * as THREE from 'three';
import type { TimeUniform } from './materials';

const V3 = THREE.Vector3;

function std(color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** A capsule spanning two points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, a.distanceTo(b)), 6, 14), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

// ── Shark ─────────────────────────────────────────────────────────────────

export interface Shark {
  root: THREE.Group;
  tail: THREE.Group;
}

/** Thickness along the body, nose (0) to tail (1). */
const SHARK_PROFILE: [number, number][] = [
  [0, 0.04],
  [0.05, 0.44],
  [0.14, 0.78],
  [0.3, 1],
  [0.55, 0.84],
  [0.8, 0.42],
  [0.94, 0.2],
  [1, 0.14],
];

function profileAt(s: number) {
  for (let i = 1; i < SHARK_PROFILE.length; i++) {
    const [s1, v1] = SHARK_PROFILE[i];
    if (s <= s1) {
      const [s0, v0] = SHARK_PROFILE[i - 1];
      const t = (s - s0) / (s1 - s0);
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
    }
  }
  return SHARK_PROFILE[SHARK_PROFILE.length - 1][1];
}

/** Grey reef shark, nose along +x, dorsal fin up. The body bends side to side in the vertex shader. */
export function buildShark(uTime: TimeUniform): Shark {
  const L = 175, RY = 24, RZ = 18;
  const geo = new THREE.SphereGeometry(1, 56, 28);
  geo.rotateZ(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#556878');
  const belly = new THREE.Color('#e7eef3');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cs = Math.sqrt(Math.max(1e-6, 1 - x * x));
    const s = (1 - x) / 2;
    const k = (profileAt(s) * Math.pow(cs, 0.3)) / cs;
    let ny = y * RY * k;
    const nz = z * RZ * k;
    if (ny < 0) ny *= 0.8;
    pos.setXYZ(i, x * (L / 2), ny, nz);
    c.copy(belly).lerp(top, THREE.MathUtils.smoothstep(y / cs, -0.3, 0.1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed.z += sin(uTime * 9.0 - transformed.x * 0.035) * 13.0 * smoothstep(20.0, -88.0, transformed.x);',
    );
  };
  skin.customProgramCacheKey = () => 'dive-shark';

  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo, skin));

  const finMat = std('#4a5a67', 0.5, 0.05, { side: THREE.DoubleSide });
  const extrude = (shape: THREE.Shape, depth: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const dorsal = new THREE.Shape();
  dorsal.moveTo(-16, 0);
  dorsal.quadraticCurveTo(-2, 18, -2, 40);
  dorsal.quadraticCurveTo(10, 16, 24, 0);
  dorsal.closePath();
  const dorsalFin = new THREE.Mesh(extrude(dorsal, 2.4), finMat);
  dorsalFin.position.set(8, RY * 0.78, 0);
  root.add(dorsalFin);

  const pec = new THREE.Shape();
  pec.moveTo(0, 0);
  pec.quadraticCurveTo(-10, -18, -30, -34);
  pec.quadraticCurveTo(-6, -16, 16, 0);
  pec.closePath();
  for (const side of [1, -1]) {
    const fin = new THREE.Mesh(extrude(pec, 1.6), finMat);
    fin.position.set(30, -RY * 0.42, side * RZ * 0.8);
    fin.rotation.x = side * 0.55;
    root.add(fin);
  }

  const tail = new THREE.Group();
  tail.position.set(-L / 2 + 6, 0, 0);
  const caudal = new THREE.Shape();
  caudal.moveTo(0, 0);
  caudal.quadraticCurveTo(-16, 22, -36, 52);
  caudal.quadraticCurveTo(-24, 18, -15, 3);
  caudal.quadraticCurveTo(-24, -10, -28, -30);
  caudal.quadraticCurveTo(-12, -12, 0, 0);
  tail.add(new THREE.Mesh(extrude(caudal, 2), finMat));
  root.add(tail);

  // Eyes, open jaws and gill slits on both flanks.
  const eyeMat = std('#040506', 0.1, 0.3);
  const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.5) });
  const mouthMat = new THREE.MeshBasicMaterial({ color: '#2a0409', side: THREE.DoubleSide });
  const toothMat = new THREE.MeshBasicMaterial({ color: '#f4f1ea', side: THREE.DoubleSide });
  const mouth = new THREE.Shape();
  mouth.moveTo(L / 2 - 8, -6);
  mouth.quadraticCurveTo(L / 2 - 26, -19, L / 2 - 46, -11);
  mouth.quadraticCurveTo(L / 2 - 28, -9, L / 2 - 8, -6);
  const teeth: THREE.Shape[] = [];
  for (let i = 0; i < 7; i++) {
    const x = L / 2 - 12 - i * 5;
    const y = -7.5 - Math.sin((i / 6) * Math.PI) * 4;
    const t = new THREE.Shape();
    t.moveTo(x - 2, y);
    t.lineTo(x, y - 4);
    t.lineTo(x + 2, y);
    t.closePath();
    teeth.push(t);
  }
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.7, 14, 10), eyeMat);
    eye.position.set(L / 2 - 26, 6.5, side * RZ * 0.62);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), glintMat);
    glint.position.set(L / 2 - 24.6, 7.2, side * (RZ * 0.62 + 1.8));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(mouth), mouthMat);
    const tt = new THREE.Mesh(new THREE.ShapeGeometry(teeth), toothMat);
    m.position.z = tt.position.z = side * RZ * 0.58;
    tt.position.z += side * 0.3;
    root.add(eye, glint, m, tt);
    for (let g = 0; g < 3; g++) {
      const slit = limb(new V3(L / 2 - 52 - g * 6, 6, 0), new V3(L / 2 - 50 - g * 6, -6, 0), 0.7, std('#2b3640', 0.6));
      slit.position.z = side * RZ * 0.86;
      root.add(slit);
    }
  }
  return { root, tail };
}

// ── Clam with a pearl ─────────────────────────────────────────────────────

export interface Clam {
  root: THREE.Group;
  hinge: THREE.Group;
  pearl: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
}

export function buildClam(): Clam {
  const shellGeo = new THREE.SphereGeometry(13, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = shellGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const ridge = 1 + 0.06 * Math.cos(Math.atan2(z, x) * 16);
    p.setXYZ(i, x * ridge, p.getY(i), z * ridge);
  }
  shellGeo.scale(1, 0.4, 0.86);
  shellGeo.computeVertexNormals();
  const shell = std('#e3a66a', 0.42, 0.05, { side: THREE.DoubleSide });
  const root = new THREE.Group();
  const bottom = new THREE.Mesh(shellGeo, shell);
  bottom.rotation.x = Math.PI;
  const inside = new THREE.Mesh(new THREE.CircleGeometry(11, 28), std('#f5cdb8', 0.3, 0.1));
  inside.rotation.x = -Math.PI / 2;
  inside.position.y = 0.4;
  const hinge = new THREE.Group();
  hinge.position.set(0, 0, -11);
  const topShell = new THREE.Mesh(shellGeo, shell);
  topShell.position.z = 11;
  hinge.add(topShell);
  const pearl = new THREE.Mesh(
    new THREE.SphereGeometry(5.4, 28, 20),
    new THREE.MeshPhysicalMaterial({ color: '#fff8ee', roughness: 0.12, clearcoat: 1, emissive: new THREE.Color('#fff0d8'), emissiveIntensity: 1.8 }),
  );
  pearl.position.set(0, 5, 1.5);
  root.add(bottom, inside, hinge, pearl);
  return { root, hinge, pearl };
}

// ── Treasure chest ────────────────────────────────────────────────────────

export interface Chest {
  root: THREE.Group;
  hinge: THREE.Group;
  light: THREE.PointLight;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  gold: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
}

export function buildChest(): Chest {
  const wood = std('#6e4120', 0.78);
  const band = std('#d9a43a', 0.3, 0.85);
  const root = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(76, 40, 46), wood);
  box.position.y = 20;
  root.add(box);
  for (const x of [-27, 27]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(5, 41, 47), band);
    b.position.set(x, 20, 0);
    root.add(b);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(11, 13, 2), band);
  plate.position.set(0, 31, 23.6);
  root.add(plate);
  const gold = new THREE.Mesh(
    new THREE.SphereGeometry(30, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    std('#ffcc45', 0.25, 0.9, { emissive: new THREE.Color('#ffae1f'), emissiveIntensity: 0 }),
  );
  gold.scale.set(1.15, 0.38, 0.68);
  gold.position.y = 39;
  root.add(gold);
  const hinge = new THREE.Group();
  hinge.position.set(0, 40, -23);
  const lidGeo = new THREE.CylinderGeometry(23, 23, 76, 28, 1, false, 0, Math.PI);
  lidGeo.rotateZ(Math.PI / 2);
  const lid = new THREE.Mesh(lidGeo, wood);
  lid.position.z = 23;
  hinge.add(lid);
  for (const x of [-27, 27]) {
    const g = new THREE.CylinderGeometry(23.6, 23.6, 5, 28, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    const b = new THREE.Mesh(g, band);
    b.position.set(x, 0, 23);
    hinge.add(b);
  }
  root.add(hinge);
  const light = new THREE.PointLight('#ffc45a', 0, 520, 1);
  light.position.set(0, 55, 18);
  root.add(light);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(78, 30, 300, 32, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.4, 1.05, 0.45) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
        void main() { gl_FragColor = vec4(uColor, (1.0 - vUv.y) * pow(max(sin(3.14159 * fract(vUv.x * 2.0)), 0.0), 0.6) * 0.22 * uOpacity); }`,
    }),
  );
  beam.position.y = 190;
  beam.renderOrder = 70;
  root.add(beam);
  return { root, hinge, light, beam, gold };
}

// ── Dive boat ─────────────────────────────────────────────────────────────

export interface Boat {
  root: THREE.Group;
  flag: THREE.Mesh;
}

export function buildBoat(): Boat {
  const noFog = { fog: false };
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-82, 8);
  hullShape.lineTo(86, 8);
  hullShape.quadraticCurveTo(74, -14, 56, -22);
  hullShape.lineTo(-64, -22);
  hullShape.quadraticCurveTo(-78, -14, -82, 8);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 44, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 2 });
  hullGeo.translate(0, 0, -22);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(hullGeo, std('#c8432e', 0.5, 0.05, noFog)));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(164, 3, 48.5), std('#f2ede3', 0.5, 0, noFog), 2, 3);
  add(new THREE.BoxGeometry(150, 2, 40), std('#e3d6bd', 0.7, 0, noFog), 0, 9.5);
  add(new THREE.BoxGeometry(46, 26, 30), std('#f2ede3', 0.55, 0, noFog), -8, 23);
  const glassMat = std('#6fd3ec', 0.1, 0.2, { ...noFog, emissive: new THREE.Color('#3fb7d6'), emissiveIntensity: 0.4 });
  add(new THREE.BoxGeometry(11, 8, 31), glassMat, -18, 25);
  add(new THREE.BoxGeometry(11, 8, 31), glassMat, 2, 25);
  add(new THREE.BoxGeometry(52, 3, 34), std('#b23725', 0.5, 0, noFog), -8, 37.5);
  add(new THREE.CylinderGeometry(1.6, 1.6, 58, 10), std('#5a4636', 0.6, 0, noFog), 32, 38);
  const flag = add(new THREE.PlaneGeometry(26, 14, 8, 1), std('#39d0ff', 0.5, 0, { ...noFog, side: THREE.DoubleSide }), 45, 59);
  return { root, flag };
}

// ── Jellyfish ─────────────────────────────────────────────────────────────

export interface Jelly {
  root: THREE.Group;
  bell: THREE.Mesh;
  lines: THREE.Line[];
  base: { x: number; z: number }[];
}

export function buildJelly(color: string): Jelly {
  const c = new THREE.Color(color);
  const root = new THREE.Group();
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(16, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5, transparent: true, opacity: 0.55, roughness: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.4), transparent: true, opacity: 0.55, depthWrite: false }),
  );
  core.position.y = -2;
  root.add(bell, core);
  const lineMat = new THREE.LineBasicMaterial({ color: c.clone().multiplyScalar(1.8), transparent: true, opacity: 0.6, depthWrite: false });
  const lines: THREE.Line[] = [];
  const base: { x: number; z: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 9, z = Math.sin(a) * 9;
    const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 14 }, (_, j) => new V3(x, -j * 4, z)));
    const line = new THREE.Line(geo, lineMat);
    lines.push(line);
    base.push({ x, z });
    root.add(line);
  }
  root.traverse((o) => (o.renderOrder = 4));
  return { root, bell, lines, base };
}

// ── Anglerfish (just a lure and a shadow in the dark) ─────────────────────

export function buildAngler() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), std('#0d161d', 0.75));
  body.scale.set(26, 18, 14);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(12, 22, 10), std('#0d161d', 0.75));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -32;
  const stalk = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(12, 14, 0), new V3(22, 34, 0), new V3(38, 30, 0)]), 16, 0.8, 6),
    std('#1a2630', 0.7),
  );
  const lure = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 6, 7) }));
  lure.position.set(38, 30, 0);
  root.add(body, tail, stalk, lure);
  return { root, lure };
}

// ── Seabed ────────────────────────────────────────────────────────────────

/** The sand tilts up away from the camera; this is its height (relative to the seabed root) at depth z. */
const SAND_TILT = 0.22;
export const sandHeight = (z: number) => -(z + 150) * Math.tan(SAND_TILT);

/** The canyon floor. patchSand lets the scene add its own lighting to the sand. */
export function buildSeabed(patchSand?: (m: THREE.MeshStandardMaterial) => void) {
  const root = new THREE.Group();
  const sandGeo = new THREE.PlaneGeometry(3400, 1900, 130, 60);
  const p = sandGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, Math.sin(x * 0.012) * 9 + Math.sin(x * 0.031 + y * 0.02) * 5 + Math.sin(y * 0.05) * 3);
  }
  sandGeo.computeVertexNormals();
  const sandMat = std('#6b7f72', 0.95);
  patchSand?.(sandMat);
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.rotation.x = -Math.PI / 2 + SAND_TILT;
  sand.position.set(0, 0, -150);
  root.add(sand);
  const rockMat = std('#1d2b30', 0.9);
  for (let i = 0; i < 12; i++) {
    const r = 12 + Math.random() * 26;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockMat);
    rock.scale.set(1.3, 0.6, 1);
    const z = -40 - Math.random() * 420;
    rock.position.set(-270 + i * 48 + Math.random() * 30, sandHeight(z) + r * 0.2, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    root.add(rock);
  }
  const iron = std('#4d5b5f', 0.55, 0.6);
  const anchor = new THREE.Group();
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 92, 12), iron);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 2.2, 8, 20), iron);
  ring.position.y = 54;
  const arms = new THREE.Mesh(new THREE.TorusGeometry(32, 3.4, 8, 28, Math.PI), iron);
  arms.rotation.z = Math.PI;
  arms.position.y = -14;
  const stock = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 34, 10), iron);
  stock.rotation.z = Math.PI / 2;
  stock.position.y = 38;
  anchor.add(shank, ring, arms, stock);
  anchor.rotation.set(0.2, 0.5, -0.55);
  anchor.position.set(225, sandHeight(-30) + 22, -30);
  root.add(anchor);
  return root;
}
