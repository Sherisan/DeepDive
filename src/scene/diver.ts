import * as THREE from 'three';

/*
 * The scuba diver, built from smooth lofted shapes and jointed so it can swim: flutter kicks with knee
 * bend and flexing fins, a hover pose with the knees up, a torch arm that aims at a point, breathing.
 * Modelled in centimetres, nose (head) along +x, back up (+y), the diver's right side toward +z.
 */

const V = THREE.Vector3;
type Station = [x: number, y: number, ry: number, rz: number];
/** Colour for a point on a loft: x along it, a the angle around it (0 = +y, π/2 = +z). */
type Paint = (x: number, a: number) => THREE.Color;

const CHARCOAL = new THREE.Color('#262e37');
const TEAL = new THREE.Color('#13809c');
const TEAL_DEEP = new THREE.Color('#0d5a70');
const plain: Paint = () => CHARCOAL;

/** A smooth closed tube along +x through elliptical stations (Catmull-Rom between them). */
function loft(stations: Station[], radial = 18, sub = 4, paint?: Paint) {
  const pts: Station[] = [];
  const at = (i: number) => stations[Math.max(0, Math.min(stations.length - 1, i))];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      pts.push(
        p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as Station,
      );
    }
  }
  pts.push(stations[stations.length - 1]);
  const ringN = radial + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const tint = (x: number, a: number) => {
    if (!paint) return;
    const c = paint(x, a);
    col.push(c.r, c.g, c.b);
  };
  pos.push(pts[0][0] - pts[0][2] * 0.3, pts[0][1], 0);
  tint(pts[0][0], Math.PI);
  for (const [x, y, ry, rz] of pts) {
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      pos.push(x, y + Math.cos(a) * Math.max(ry, 0.05), Math.sin(a) * Math.max(rz, 0.05));
      tint(x, a);
    }
  }
  const last = pts[pts.length - 1];
  pos.push(last[0] + last[2] * 0.3, last[1], 0);
  tint(last[0], Math.PI);
  const end = pos.length / 3 - 1;
  for (let k = 0; k < radial; k++) idx.push(0, 1 + k + 1, 1 + k);
  for (let r = 0; r < pts.length - 1; r++) {
    for (let k = 0; k < radial; k++) {
      const a = 1 + r * ringN + k, b = a + 1, c = a + ringN, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const base = 1 + (pts.length - 1) * ringN;
  for (let k = 0; k < radial; k++) idx.push(end, base + k, base + k + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (paint) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Mirror a +x loft so it runs along −x (legs trail behind the hips). */
function backward(geo: THREE.BufferGeometry) {
  geo.scale(-1, 1, 1);
  const index = geo.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geo.computeVertexNormals();
  return geo;
}

function tube(points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 40) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 8), material);
}

function ring(radius: number, thickness: number, material: THREE.Material, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 28), material);
  m.rotation.y = Math.PI / 2;
  m.scale.set(sz, sy, 1);
  return m;
}

/** Orthonormal frame → quaternion (columns are where local x, y, z end up). */
function basis(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

const TORSO: Station[] = [
  [-17, 1, 3, 4],
  [-13.5, 1, 8.5, 12.5],
  [-8, 0.5, 11, 15.6],
  [0, 0.5, 11.8, 16.6],
  [10, 0.9, 10.6, 14.8],
  [22, 0.6, 11.8, 16.6],
  [34, 0, 12.6, 18],
  [44, -0.6, 12.1, 18.6],
  [51, -1.2, 9.8, 16.4],
  [56.5, -1.5, 6.6, 8.6],
  [61, -2, 5.4, 5.6],
  [66, -2.4, 5, 5],
];

/** Torso half-width at x, for placing things on its surface. */
function torsoAt(x: number) {
  for (let i = 1; i < TORSO.length; i++) {
    if (x <= TORSO[i][0]) {
      const a = TORSO[i - 1], b = TORSO[i], t = (x - a[0]) / (b[0] - a[0]);
      return { y: a[1] + (b[1] - a[1]) * t, ry: a[2] + (b[2] - a[2]) * t, rz: a[3] + (b[3] - a[3]) * t };
    }
  }
  const l = TORSO[TORSO.length - 1];
  return { y: l[1], ry: l[2], rz: l[3] };
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
  fin: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  rest: Float32Array;
  side: number;
}

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
}

export interface DiverPose {
  dt: number;
  t: number;
  /** World-space yaw the diver should face (0 = right, π = left). */
  yaw: number;
  /** 0 hovering still … 1 swimming hard. */
  speed: number;
  /** Vertical speed, roughly −1 (diving) … 1 (rising). */
  climb: number;
  /** Treading water at the surface. */
  surface: boolean;
  /** Seconds since a shark bite, or −1. */
  bite: number;
  /** World point the torch should shine at, or null to point ahead. */
  aim: THREE.Vector3 | null;
  /** 0 at the surface … 1 at the seabed (torch and beam brightness). */
  depth: number;
}

export class Diver {
  readonly root = new THREE.Group();
  /** Bubbles leave from here. */
  readonly exhaust = new THREE.Object3D();
  /** Where the torch is and where it points (world space), and how bright it is (0–1); the scene lights the rock with it. */
  readonly torchPos = new THREE.Vector3();
  readonly torchDir = new THREE.Vector3(1, 0, 0);
  torchPower = 0;
  private readonly torch = new THREE.Group();
  private readonly turn = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly torchArm: Arm;
  private readonly freeArm: Arm;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly lens: THREE.MeshBasicMaterial;
  private readonly chest: THREE.Mesh;
  private kick = 0;
  private torchOn = 0;
  private readonly aimQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  constructor(envMap: THREE.Texture | null) {
    const env = { envMap, envMapIntensity: 0.55 };
    // Neoprene: matt with a soft sheen; the colour comes from the panels painted on each part.
    const suit = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.72, sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color('#5a8fad'), ...env, envMapIntensity: 0.35 });
    const hood = new THREE.MeshPhysicalMaterial({ color: CHARCOAL, roughness: 0.72, sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color('#5a8fad'), ...env, envMapIntensity: 0.35 });
    const maskMat = new THREE.MeshStandardMaterial({ color: '#0f5566', roughness: 0.45, ...env });
    const panel = new THREE.MeshPhysicalMaterial({ color: '#1d3a4d', roughness: 0.6, sheen: 0.8, sheenColor: new THREE.Color('#5aa9cf'), ...env, envMapIntensity: 0.35 });
    const accent = new THREE.MeshStandardMaterial({ color: '#1ab8ee', emissive: new THREE.Color('#2bc8ff'), emissiveIntensity: 1.5, roughness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#0d1115', roughness: 0.55, ...env });
    const vestMat = new THREE.MeshPhysicalMaterial({ color: '#2a3038', roughness: 0.62, sheen: 0.6, sheenColor: new THREE.Color('#61707f'), ...env });
    const webbing = new THREE.MeshStandardMaterial({ color: '#101317', roughness: 0.8 });
    const tankMat = new THREE.MeshPhysicalMaterial({ color: '#e3a52a', metalness: 0.25, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.2, ...env, envMapIntensity: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#c9d2da', metalness: 1, roughness: 0.22, ...env, envMapIntensity: 0.9 });
    const hoseMat = new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.5, ...env });
    const yellow = new THREE.MeshStandardMaterial({ color: '#ffcc1f', roughness: 0.4, ...env });
    const lead = new THREE.MeshStandardMaterial({ color: '#4a525a', metalness: 0.5, roughness: 0.5, ...env });
    const finMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.45, side: THREE.DoubleSide, ...env });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#7fe6ff',
      roughness: 0.04,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      emissive: new THREE.Color('#1688b0'),
      emissiveIntensity: 0.7,
      envMap,
      envMapIntensity: 2,
    });

    this.root.add(this.turn);
    this.turn.add(this.body);
    const B = this.body;

    // Torso with a coloured chest/side panel and glowing piping along the flanks.
    this.chest = new THREE.Mesh(loft(TORSO, 24, 5, (x, a) => (Math.abs(Math.sin(a)) > 0.62 && x > 2 && x < 47 ? TEAL : CHARCOAL)), suit);
    B.add(this.chest);
    for (const s of [1, -1]) {
      const pipe: THREE.Vector3[] = [];
      for (let x = -6; x <= 50; x += 4) {
        const a = torsoAt(x);
        pipe.push(new V(x, a.y - a.ry * 0.25, s * (a.rz * 0.97 + 0.25)));
      }
      B.add(tube(pipe, 0.75, accent, 30));
    }

    // Hood and face: mask on the front of the head looking ahead and down, regulator below it.
    const headC = new V(75, -2.6, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), hood);
    head.scale.set(12, 11, 10.4);
    this.neck.position.set(62, -2, 0);
    head.position.copy(headC).sub(this.neck.position);
    this.neck.add(head);
    B.add(this.neck);
    const face = new V(0.62, -0.78, 0).normalize();
    const faceUp = new V(0.78, 0.62, 0);
    const mask = new THREE.Group();
    mask.position.copy(headC).addScaledVector(face, 11.3).sub(this.neck.position);
    mask.quaternion.copy(basis(new V(0, 0, -1), faceUp, face));
    const rr = (w: number, h: number, r: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2 + r, -h / 2);
      s.lineTo(w / 2 - r, -h / 2);
      s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      s.lineTo(w / 2, h / 2 - r);
      s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      s.lineTo(-w / 2 + r, h / 2);
      s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      s.lineTo(-w / 2, -h / 2 + r);
      s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      return s;
    };
    const frameShape = rr(16.5, 9.6, 3.6);
    frameShape.holes.push(rr(13.4, 7, 2.6));
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 4.4, bevelEnabled: true, bevelSize: 0.7, bevelThickness: 0.7, bevelSegments: 2 }), maskMat);
    frame.position.z = -2.6;
    const lensMesh = new THREE.Mesh(new THREE.ShapeGeometry(rr(13.6, 7.2, 2.6), 4), glass);
    lensMesh.position.z = 1.9;
    mask.add(frame, lensMesh);
    this.neck.add(mask);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(11.2, 0.75, 6, 36), rubber);
    strap.position.copy(headC).addScaledVector(face, 1.5).sub(this.neck.position);
    strap.quaternion.setFromUnitVectors(new V(0, 0, 1), faceUp);
    this.neck.add(strap);

    const mouthDir = new V(0.25, -0.97, 0).normalize();
    const reg = new THREE.Group();
    reg.position.copy(headC).addScaledVector(mouthDir, 11.4).sub(this.neck.position);
    reg.quaternion.setFromUnitVectors(new V(0, 1, 0), mouthDir);
    const regBody = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.2, 4.6, 18), hoseMat);
    const purge = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.8, 18), yellow);
    purge.position.y = 2.6;
    const tee = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 8, 4, 10), hoseMat);
    tee.rotation.x = Math.PI / 2;
    tee.position.set(-2.2, 0.6, 0);
    reg.add(regBody, purge, tee);
    this.exhaust.position.set(-2.8, 1.8, 0);
    reg.add(this.exhaust);
    this.neck.add(reg);

    // BCD vest over the back and sides, with shoulder straps, inflator hose and a trim line.
    const vest = loft(
      TORSO.filter(([x]) => x >= -6 && x <= 50).map(([x, y, ry, rz]) => [x, y + 0.6, ry + 2.3, rz + 2.4] as Station),
      24,
      5,
    );
    B.add(new THREE.Mesh(vest, vestMat));
    for (const s of [1, -1]) {
      B.add(tube([new V(48, 12, s * 7), new V(53, 6, s * 13), new V(51, -6, s * 15), new V(44, -13.5, s * 9)], 1.9, webbing, 20));
      const trim = torsoAt(-4);
      B.add(tube([new V(-4, trim.y + trim.ry + 2.6, s * 3), new V(-4, trim.y + 1, s * (trim.rz + 2.6)), new V(-4, trim.y - trim.ry * 0.6, s * (trim.rz * 0.75 + 2))], 0.7, accent, 12));
    }
    B.add(tube([new V(50, 13, -10), new V(55, 4, -18), new V(50, -8, -16), new V(43, -12, -11)], 1.6, hoseMat, 24));

    // Tank on the back: yellow cylinder, two cam bands, chrome valve with its first stage.
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(8.6, 41, 8, 28), tankMat);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(20.5, 23.6, 0);
    B.add(tank);
    for (const x of [8, 31]) {
      const band = ring(8.95, 1.15, webbing);
      band.position.set(x, 23.6, 0);
      B.add(band);
    }
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 7, 14), chrome);
    valve.rotation.z = Math.PI / 2;
    valve.position.set(53.5, 23.6, 0);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.8, 16), hoseMat);
    knob.position.set(55.5, 28.5, 0);
    const first = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 5.5, 14), chrome);
    first.rotation.x = Math.PI / 2;
    first.position.set(56.5, 23.6, 0);
    B.add(valve, knob, first);
    // Hoses: main regulator over the right shoulder, yellow octopus to the chest, console down the left side.
    const regAt = reg.position.clone().add(this.neck.position);
    // In two parts: on the body up to the neck's turning axis, then turning with the head to the regulator.
    const neckAt = new V(62, -1, 4.5);
    B.add(tube([new V(57, 24, 3), new V(62, 21, 11), new V(66, 10, 12), neckAt], 1.15, hoseMat, 28));
    this.neck.add(tube([neckAt, new V(70, -4, 11), new V(regAt.x + 1, regAt.y + 3, 9), new V(regAt.x - 1, regAt.y, 3)].map((p) => p.clone().sub(this.neck.position)), 1.15, hoseMat, 20));
    B.add(tube([new V(57, 22, 4), new V(55, 14, 17), new V(47, -2, 19), new V(41, -12, 13)], 1, yellow, 30));
    const octo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3.6, 14), yellow);
    octo.position.set(40, -14, 11);
    octo.rotation.x = 0.6;
    B.add(octo);
    B.add(tube([new V(57, 22, -4), new V(54, 12, -19), new V(38, -4, -22), new V(24, -12, -19)], 1, hoseMat, 30));
    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 6), rubber);
    consoleBox.position.set(20, -14.5, -18);
    consoleBox.rotation.z = -0.3;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 1.7) }));
    screen.position.set(20, -14, -21.1);
    screen.rotation.set(0, Math.PI, -0.3);
    B.add(consoleBox, screen);

    // Weight belt with lead blocks and a buckle.
    const hips = torsoAt(-2);
    B.add(new THREE.Mesh(loft([[-4.6, hips.y, hips.ry + 1.3, hips.rz + 1.3], [0.6, hips.y, hips.ry + 1.3, hips.rz + 1.3]], 24, 1), webbing));
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 2.2), lead);
      w.position.set(-2, -3.5, s * 17.2);
      B.add(w);
    }
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 4), chrome);
    buckle.position.set(-2, -12.2, 0);
    B.add(buckle);

    // Arms. The near (right) arm carries the torch; the far one rests forward under the chest.
    const makeArm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(48.5, -3, side * 17.4);
      const upper = new THREE.Mesh(loft([[-2, 0, 5.2, 5.4], [6, 0, 5.8, 5.8], [20, 0, 4.7, 4.9], [29, 0, 4.2, 4.3]], 16, 4, (x, a) => (Math.cos(a) > 0.15 && x > 0 && x < 22 ? TEAL : CHARCOAL)), suit);
      const elbow = new THREE.Group();
      elbow.position.x = 29;
      const fore = new THREE.Mesh(loft([[-1.5, 0, 4.3, 4.4], [8, 0, 4.7, 4.5], [20, 0, 3.6, 3.9], [25, 0, 3.1, 3.4]], 16, 4, plain), suit);
      const cuff = ring(3.7, 0.7, accent, 1, 1.08);
      cuff.position.x = 21;
      const band = ring(5.1, 0.6, panel, 1, 1.05);
      band.position.x = 12;
      const wrist = new THREE.Group();
      wrist.position.x = 25;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), rubber);
      glove.scale.set(6.6, 3, 4.6);
      glove.position.x = 4.5;
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 4, 4, 8), rubber);
      thumb.rotation.z = Math.PI / 2 - 0.5;
      thumb.position.set(4.2, 2.6, 0);
      wrist.add(glove, thumb);
      elbow.add(fore, cuff, wrist);
      upper.add(band);
      shoulder.add(upper, elbow);
      B.add(shoulder);
      return { shoulder, elbow, wrist };
    };
    this.torchArm = makeArm(1);
    this.freeArm = makeArm(-1);
    this.freeArm.shoulder.quaternion.setFromUnitVectors(new V(1, 0, 0), new V(0.42, -0.86, -0.28).normalize());
    this.freeArm.elbow.rotation.z = 1.25;

    // Dive torch in the near hand: barrel, knurled grip, head, and an HDR lens that blooms.
    const torch = this.torch;
    torch.position.x = 3;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 17, 18), new THREE.MeshStandardMaterial({ color: '#2b3239', metalness: 0.75, roughness: 0.32, ...env }));
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.x = 8;
    const grip = ring(2.9, 0.55, rubber);
    grip.position.x = 4;
    const headT = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 3, 5.5, 20), chrome);
    headT.rotation.z = -Math.PI / 2;
    headT.position.x = 18.5;
    this.lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85) });
    const lensDisc = new THREE.Mesh(new THREE.CircleGeometry(3.5, 24), this.lens);
    lensDisc.rotation.y = Math.PI / 2;
    lensDisc.position.x = 21.35;
    torch.add(barrel, grip, headT, lensDisc);
    // A soft cone of light in the water, brightest at the lens.
    const beamGeo = new THREE.CylinderGeometry(2.5, 115, 560, 28, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(280, 0, 0);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        uniforms: { uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.93, 0.8) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying float vAlong;
          varying float vFacing;
          void main() {
            vAlong = clamp(position.x / 560.0, 0.0, 1.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vec3 n = normalize(normalMatrix * normal);
            vFacing = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uIntensity;
          uniform vec3 uColor;
          varying float vAlong;
          varying float vFacing;
          void main() {
            float fall = (1.0 - vAlong);
            float a = fall * fall * fall * vFacing * vFacing * uIntensity;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.beam.position.x = 21.5;
    this.beam.renderOrder = 130;
    torch.add(this.beam);
    this.torchArm.wrist.add(torch);

    // Legs: thigh, knee, shin, bootie and a long fin whose blade is bent every frame.
    const makeLeg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(-10, -1.2, side * 8.4);
      hip.add(new THREE.Mesh(backward(loft([[-2, 0, 8.2, 8], [8, 0.4, 8.2, 7.8], [28, 0, 6.6, 6.4], [42, 0, 5.6, 5.4]], 18, 4, (x, a) => (Math.abs(Math.sin(a)) > 0.55 && x > 5 && x < 35 ? TEAL : CHARCOAL))), suit));
      const knee = new THREE.Group();
      knee.position.x = -42;
      knee.add(new THREE.Mesh(backward(loft([[-1.5, 0, 5.6, 5.4], [8, 0.9, 6, 5.3], [28, 0, 4.1, 4], [38, 0, 3.3, 3.3]], 16, 4, (x, a) => (Math.abs(Math.sin(a)) > 0.72 && x > 6 && x < 29 ? TEAL_DEEP : CHARCOAL))), suit));
      const kneePad = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), panel);
      kneePad.scale.set(5, 3, 5);
      kneePad.position.set(-1, -4.6, 0);
      const ankleCuff = ring(3.6, 0.7, accent);
      ankleCuff.position.x = -33;
      knee.add(kneePad, ankleCuff);
      const ankle = new THREE.Group();
      ankle.position.x = -38;
      ankle.add(new THREE.Mesh(backward(loft([[-1, 0, 3.8, 3.8], [6, -0.6, 3.6, 4.4], [15, -0.9, 2.6, 3.9], [20, -0.9, 1.9, 2.8]], 14, 4)), rubber));
      const pocket = new THREE.Mesh(backward(loft([[2, -0.2, 4.6, 5.2], [10, -0.7, 3.9, 5.4], [18, -0.9, 2.7, 5.2], [21, -0.9, 1.6, 4.2]], 14, 4)), rubber);
      ankle.add(pocket);
      // Blade: 13 × 5 grid from the toes back, with a shallow V at the trailing edge.
      const NA = 14, NC = 5;
      const pos = new Float32Array(NA * NC * 3);
      const col = new Float32Array(NA * NC * 3);
      const c0 = new THREE.Color('#d9480f'), c1 = new THREE.Color('#ff8a2b'), c = new THREE.Color();
      for (let a = 0; a < NA; a++) {
        const u = a / (NA - 1);
        const half = THREE.MathUtils.lerp(5.4, 12, Math.pow(u, 0.65));
        for (let k = 0; k < NC; k++) {
          const v = (k / (NC - 1)) * 2 - 1;
          const len = 52 + 7 * Math.abs(v);
          const i = a * NC + k;
          pos.set([-(14 + u * len), -0.9 + 1.6 * u * u, v * half], i * 3);
          c.copy(c0).lerp(c1, u).multiplyScalar(Math.abs(v) > 0.9 ? 0.55 : 1);
          col.set([c.r, c.g, c.b], i * 3);
        }
      }
      const idx: number[] = [];
      for (let a = 0; a < NA - 1; a++) {
        for (let k = 0; k < NC - 1; k++) {
          const i = a * NC + k;
          idx.push(i, i + 1, i + NC, i + 1, i + NC + 1, i + NC);
        }
      }
      const finGeo = new THREE.BufferGeometry();
      finGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      finGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      finGeo.setIndex(idx);
      finGeo.computeVertexNormals();
      const fin = new THREE.Mesh(finGeo, finMat);
      ankle.add(fin);
      knee.add(ankle);
      hip.add(knee);
      B.add(hip);
      return { hip, knee, ankle, fin, rest: pos.slice(), side };
    };
    this.legs.push(makeLeg(1), makeLeg(-1));

    this.root.scale.setScalar(0.55);
    this.root.traverse((o) => (o.renderOrder = 20));
    this.beam.renderOrder = 130;
  }

  /** Point an arm (its +x) along a direction given in the body frame, smoothly. */
  private aimArm(arm: Arm, dir: THREE.Vector3, rate: number) {
    this.aimQ.setFromUnitVectors(new V(1, 0, 0), dir);
    arm.shoulder.quaternion.slerp(this.aimQ, rate);
  }

  update(p: DiverPose) {
    const { dt, t } = p;
    const k = 1 - Math.exp(-dt * 6);
    // Turn to face the way we swim; lean the back toward the camera so tank and fins read from the side.
    this.turn.rotation.y += (p.yaw - this.turn.rotation.y) * (1 - Math.exp(-dt * 5));
    // Lean the back a little toward the camera, and turn the head the other way so the mask shows.
    const toCam = Math.cos(this.turn.rotation.y);
    const roll = 0.3 * toCam;
    this.neck.rotation.x = -0.75 * toCam;
    const hover = 1 - p.speed;
    let pitch = THREE.MathUtils.clamp(p.climb * 0.62, -0.62, 0.62) + hover * 0.12 + (p.surface ? 0.42 : 0);
    let rollX = roll;
    if (p.bite >= 0 && p.bite < 1.4) {
      const f = 1 - p.bite / 1.4;
      rollX += Math.sin(p.bite * 34) * 0.45 * f;
      pitch += Math.sin(p.bite * 23) * 0.3 * f;
    }
    this.body.rotation.x += (rollX - this.body.rotation.x) * (p.bite >= 0 && p.bite < 1.4 ? 1 : k);
    this.body.rotation.z += (pitch - this.body.rotation.z) * (1 - Math.exp(-dt * 3.5));
    this.body.position.y = Math.sin(t * 1.6) * 1.8;

    // Breathing: the chest swells slowly; the scene emits bubbles on the out-breath.
    const breath = Math.sin(t * ((Math.PI * 2) / 3.4));
    this.chest.scale.set(1, 1 + breath * 0.018, 1 + breath * 0.022);

    // Flutter kick from the hips, knees and fins following; in a hover the knees fold up.
    const thrash = p.bite >= 0 && p.bite < 1.4 ? 1 - p.bite / 1.4 : 0;
    this.kick += dt * (2.4 + p.speed * 6.4 + thrash * 10);
    const amp = 0.11 + p.speed * 0.2 + thrash * 0.25;
    for (const leg of this.legs) {
      const ph = this.kick + (leg.side > 0 ? 0 : Math.PI);
      leg.hip.rotation.z = Math.sin(ph) * amp + hover * 0.22;
      leg.knee.rotation.z = -(0.12 + hover * 0.95) - 0.22 * (0.5 + 0.5 * Math.sin(ph + 1.2)) * (0.4 + p.speed);
      leg.ankle.rotation.z = -0.1 + Math.sin(ph - 0.6) * 0.12 + hover * 0.15;
      const flex = -Math.cos(ph) * (0.28 + p.speed * 0.5);
      const pa = leg.fin.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = leg.rest[i * 3];
        const u = THREE.MathUtils.clamp((-x - 14) / 59, 0, 1);
        pa.setY(i, leg.rest[i * 3 + 1] + flex * u * u * 17);
      }
      pa.needsUpdate = true;
      leg.fin.geometry.computeVertexNormals();
    }

    // Torch arm: aim at the target (in body space), clamped to what an arm can reach.
    const aimDir = new V(0.8, -0.5, 0.1);
    if (p.aim) {
      this.body.updateWorldMatrix(true, false);
      const local = this.body.worldToLocal(this.tmpV.copy(p.aim)).sub(this.torchArm.shoulder.position);
      if (local.lengthSq() > 1) {
        local.normalize();
        // An arm can reach straight down, or a little back, from the shoulder.
        local.x = Math.max(local.x, -0.3);
        local.y = Math.min(local.y, 0.35);
        aimDir.copy(local).normalize();
      }
    }
    this.aimArm(this.torchArm, aimDir.normalize(), 1 - Math.exp(-dt * 7));
    this.torchArm.elbow.rotation.z = 0.18 + Math.sin(t * 1.3) * 0.03;
    this.torchArm.wrist.rotation.z = -0.18;
    if (thrash > 0) {
      this.torchArm.shoulder.rotateZ(Math.sin(t * 29) * 0.25 * thrash);
      this.freeArm.shoulder.rotateZ(Math.sin(t * 31 + 1) * 0.3 * thrash);
    }
    this.freeArm.elbow.rotation.z = 1.2 + Math.sin(t * 1.1) * 0.06;
    // Look a little toward what the torch is on.
    this.neck.rotation.z = THREE.MathUtils.clamp(aimDir.y * 0.25, -0.12, 0.08);

    // Torch: on below the first few metres, the beam showing more as the water darkens.
    const on = p.depth > 0.012 ? 1 : 0;
    this.torchOn += (on - this.torchOn) * (1 - Math.exp(-dt * 3));
    this.torchPower = this.torchOn * (0.4 + 0.6 * Math.min(1, p.depth * 2));
    this.torch.updateWorldMatrix(true, false);
    this.torchPos.set(21.5, 0, 0).applyMatrix4(this.torch.matrixWorld);
    this.torchDir.set(1, 0, 0).transformDirection(this.torch.matrixWorld);
    this.lens.color.setRGB(1 + this.torchOn * 9, 0.95 + this.torchOn * 8, 0.85 + this.torchOn * 6);
    this.beam.material.uniforms.uIntensity.value = this.torchOn * (0.05 + 0.32 * Math.min(1, p.depth * 2.2));
    this.beam.visible = this.torchOn > 0.01;
  }

  /** World position of the regulator's exhaust (for bubbles). */
  exhaustWorld(out: THREE.Vector3) {
    return this.exhaust.getWorldPosition(out);
  }

  /** True during the out-breath, when bubbles leave the regulator. */
  exhaling(t: number) {
    const cycle = (t % 3.4) / 3.4;
    return cycle > 0.55 && cycle < 0.78;
  }
}
