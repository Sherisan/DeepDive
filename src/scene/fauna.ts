import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeUniform } from './materials';
import { rng } from './noise';

// ── Schooling fish ────────────────────────────────────────────────────────

/** A small reef fish, nose along +x, about 26 long: a flattened lathe body, forked tail and dorsal fin. */
function fishGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    const r = Math.sin(Math.PI * Math.pow(u, 0.72)) * 4.2 * (1 - 0.45 * u) + 0.15;
    pts.push(new THREE.Vector2(r, 11 - u * 21));
  }
  const body = new THREE.LatheGeometry(pts, 12);
  body.rotateZ(-Math.PI / 2);
  body.scale(1, 1.18, 0.5);
  const tail = new THREE.Shape();
  tail.moveTo(-9.5, 0);
  tail.lineTo(-16.5, 6.2);
  tail.quadraticCurveTo(-14, 0, -16.5, -6.2);
  tail.closePath();
  const dorsal = new THREE.Shape();
  dorsal.moveTo(3, 4.4);
  dorsal.quadraticCurveTo(-1, 9, -6, 3.2);
  dorsal.closePath();
  const fins = new THREE.ShapeGeometry([tail, dorsal]);
  const merged = mergeGeometries([body.toNonIndexed(), fins.toNonIndexed()])!;
  body.dispose();
  fins.dispose();
  return merged;
}

function fishMaterial(uTime: TimeUniform, envMap: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35, side: THREE.DoubleSide, envMap, envMapIntensity: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\nattribute float aPhase;\nvarying float vFishY;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      float back = clamp(-position.x / 16.0, 0.0, 1.0);
      transformed.z += sin(uTime * 13.0 + aPhase - position.x * 0.22) * (back * back * 2.6 + 0.25);
      vFishY = position.y;`,
    );
    // Countershading: dark back, pale belly.
    shader.fragmentShader = `varying float vFishY;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.35, 0.55, smoothstep(-3.0, 3.5, vFishY));',
    );
  };
  m.customProgramCacheKey = () => 'dive-fish';
  return m;
}

export interface SchoolSpec {
  count: number;
  palette: string[];
  scale: number;
  /** Centre of the loop the school swims. */
  y: number;
  z: number;
  /** Half-extents of the loop. */
  ax: number;
  ay: number;
  az: number;
  speed: number;
  seed: number;
}

export class School {
  readonly mesh: THREE.InstancedMesh;
  private readonly offsets: THREE.Vector3[] = [];
  private readonly lags: number[] = [];
  private readonly wobble: number[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly spec: SchoolSpec,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    const r = rng(spec.seed);
    const geo = geometry.clone();
    const phase = new Float32Array(spec.count);
    this.mesh = new THREE.InstancedMesh(geo, material, spec.count);
    const c = new THREE.Color();
    for (let i = 0; i < spec.count; i++) {
      // A loose lens of fish, wider than tall.
      this.offsets.push(new THREE.Vector3((r() - 0.5) * 120, (r() - 0.5) * 46, (r() - 0.5) * 80));
      this.lags.push(r() * 1.4);
      this.wobble.push(r() * 40);
      this.prev.push(new THREE.Vector3());
      phase[i] = r() * 40;
      this.mesh.setColorAt(i, c.set(spec.palette[i % spec.palette.length]).multiplyScalar(0.85 + r() * 0.3));
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.mesh.frustumCulled = false;
  }

  private centre(t: number, out: THREE.Vector3) {
    const s = this.spec, w = s.speed / Math.max(s.ax, 1);
    return out.set(s.ax * Math.sin(w * t + s.seed), s.y + s.ay * Math.sin(w * 0.73 * t + s.seed * 2), s.z + s.az * Math.sin(w * 0.51 * t + s.seed * 3));
  }

  update(t: number) {
    const k = this.spec.scale;
    for (let i = 0; i < this.offsets.length; i++) {
      const tt = t - this.lags[i];
      const o = this.offsets[i], ph = this.wobble[i];
      this.centre(tt, this.p);
      this.p.x += o.x + Math.sin(tt * 0.9 + ph) * 10;
      this.p.y += o.y + Math.sin(tt * 1.3 + ph) * 6;
      this.p.z += o.z + Math.cos(tt * 0.7 + ph) * 10;
      this.v.subVectors(this.p, this.prev[i]);
      this.prev[i].copy(this.p);
      const yaw = Math.atan2(-this.v.z, this.v.x);
      const pitch = Math.atan2(this.v.y, Math.hypot(this.v.x, this.v.z) + 1e-4);
      this.dummy.position.copy(this.p);
      this.dummy.rotation.set(0, yaw, THREE.MathUtils.clamp(pitch, -0.6, 0.6), 'YZX');
      this.dummy.scale.setScalar(k);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function buildSchools(specs: SchoolSpec[], uTime: TimeUniform, envMap: THREE.Texture | null) {
  const geo = fishGeometry();
  const mat = fishMaterial(uTime, envMap);
  return specs.map((s) => new School(s, geo, mat));
}

// ── Manta ray, gliding through mid-water ──────────────────────────────────

export class Manta {
  readonly root = new THREE.Group();
  private readonly prev = new THREE.Vector3();

  constructor(
    uTime: TimeUniform,
    private readonly y0: number,
    private readonly z0: number,
  ) {
    // Body in x/z (x forward), flapped in the vertex shader. Wingspan 190.
    const geo = new THREE.PlaneGeometry(1, 1, 24, 16);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) * 2, v = pos.getZ(i) * 2; // −1..1
      const span = Math.abs(v);
      // Diamond with swept-back wing tips.
      const lead = 0.55 - 0.85 * span * span;
      const trail = -0.5 + 0.55 * span;
      const x = THREE.MathUtils.lerp(trail, lead, (u + 1) / 2) * 92 - span * span * 22;
      const z = v * 95;
      const thick = Math.max(0, 1 - span * 1.6) * (1 - Math.abs(u) * 0.6) * 7;
      pos.setXYZ(i, x, thick, z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float sp = abs(position.z) / 95.0;
        transformed.y += sin(uTime * 1.5 - sp * 1.6) * sp * sp * 30.0;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= gl_FrontFacing ? vec3(0.05, 0.07, 0.09) : vec3(0.55, 0.62, 0.66);',
      );
    };
    mat.customProgramCacheKey = () => 'dive-manta';
    const body = new THREE.Mesh(geo, mat);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 70, 6), new THREE.MeshStandardMaterial({ color: '#0c1116', roughness: 0.6 }));
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -78;
    // Cephalic fins either side of the mouth.
    const lobeMat = new THREE.MeshStandardMaterial({ color: '#0d1318', roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.CapsuleGeometry(3, 16, 4, 8), lobeMat);
      lobe.rotation.z = Math.PI / 2 - 0.2;
      lobe.position.set(50, 0, s * 13);
      this.root.add(lobe);
    }
    this.root.add(body, tail);
  }

  update(t: number) {
    const x = 175 * Math.sin(t * 0.045);
    const z = this.z0 + 170 * Math.cos(t * 0.045);
    const y = this.y0 + 46 * Math.sin(t * 0.11);
    this.root.position.set(x, y, z);
    const dx = x - this.prev.x, dz = z - this.prev.z, dy = y - this.prev.y;
    if (Math.hypot(dx, dz) > 1e-3) {
      this.root.rotation.set(0, Math.atan2(-dz, dx), 0, 'YZX');
      this.root.rotation.z = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.3, 0.3);
      this.root.rotation.x = -Math.sin(t * 0.045) * 0.25;
    }
    this.prev.set(x, y, z);
  }
}
