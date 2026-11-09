import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PointScale, TimeUniform } from './materials';
import { rng } from './noise';

export interface Placement {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

const up = new THREE.Vector3(0, 1, 0);

// ── Kelp and sea grass: ribbons that sway, rooted in the rock ──────────────

/**
 * Swaying blades. Each instance carries its own width, height and phase; the bend is done in the vertex
 * shader so a whole forest costs one draw call.
 */
export function buildKelp(spots: Placement[], uTime: TimeUniform, opts: { h: [number, number]; w: [number, number]; base: string; tip: string; seed: number; top?: number; cluster?: number }) {
  const r = rng(opts.seed);
  // Kelp grows in clumps: several blades from around each holdfast.
  const k = opts.cluster ?? 1;
  if (k > 1) {
    spots = spots.flatMap((s) =>
      Array.from({ length: 1 + Math.floor(r() * k) }, () => ({ p: s.p.clone().add(new THREE.Vector3((r() - 0.5) * 22, (r() - 0.5) * 10, (r() - 0.5) * 22)), n: s.n })),
    );
  }
  const geo = new THREE.PlaneGeometry(1, 1, 1, 20);
  geo.translate(0, 0.5, 0);
  const attr = new Float32Array(spots.length * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const matrices: THREE.Matrix4[] = [];
  spots.forEach((s, i) => {
    // Blades stop short of the surface.
    const h = Math.max(12, Math.min(opts.h[0] + r() * (opts.h[1] - opts.h[0]), (opts.top ?? Infinity) - s.p.y));
    attr.set([opts.w[0] + r() * (opts.w[1] - opts.w[0]), h, r() * 50], i * 3);
    e.set((r() - 0.5) * 0.25, (r() - 0.5) * 1.4, (r() - 0.5) * 0.25);
    q.setFromEuler(e);
    m4.compose(s.p, q, new THREE.Vector3(1, 1, 1));
    matrices.push(m4.clone());
  });
  geo.setAttribute('aKelp', new THREE.InstancedBufferAttribute(attr, 3));
  const base = new THREE.Color(opts.base), tip = new THREE.Color(opts.tip);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uBase = { value: base };
    shader.uniforms.uTip = { value: tip };
    shader.vertexShader = `uniform float uTime;\nattribute vec3 aKelp;\nvarying float vKelpH;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `float hh = position.y;
      float bw = aKelp.x * (1.0 - 0.62 * hh) * (0.8 + 0.35 * sin(hh * 21.0 + aKelp.z * 3.0));
      vec3 transformed = vec3(position.x * bw, hh * aKelp.y, 0.0);
      transformed.x += sin(uTime * 0.8 + aKelp.z + hh * 2.4) * 0.11 * aKelp.y * hh * hh + sin(uTime * 0.31 + aKelp.z * 1.7) * 0.05 * aKelp.y * hh;
      transformed.z += cos(uTime * 0.6 + aKelp.z * 1.3 + hh * 1.7) * 0.05 * aKelp.y * hh * hh;
      vKelpH = hh;`,
    );
    shader.fragmentShader = `uniform vec3 uBase;\nuniform vec3 uTip;\nvarying float vKelpH;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(uBase, uTip, vKelpH);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.22;');
  };
  mat.customProgramCacheKey = () => 'dive-kelp';
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.frustumCulled = false;
  return mesh;
}

// ── Coral: small branching colonies on ledges near the light ───────────────

function coralGeometry(seed: number) {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.72, rad, len, 7, 1, false);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    if (depth === 0) {
      const tipG = new THREE.SphereGeometry(rad * 0.75, 7, 5);
      tipG.translate(to.x, to.y, to.z);
      parts.push(tipG);
      return;
    }
    const n = 2 + (r() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      d.x += (r() - 0.5) * 1.1;
      d.z += (r() - 0.5) * 1.1;
      d.y += 0.25;
      grow(to, d.normalize(), len * (0.62 + r() * 0.2), rad * 0.7, depth - 1);
    }
  };
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + r();
    grow(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3), new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize(), 9 + r() * 4, 2.4, 3);
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  parts.forEach((g) => g.dispose());
  return merged;
}

export function buildCoral(spots: Placement[], palette: string[], seed: number) {
  const r = rng(seed);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62 });
  const mesh = new THREE.InstancedMesh(coralGeometry(seed), mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  spots.forEach((s, i) => {
    q.setFromUnitVectors(up, s.n.clone().lerp(up, 0.6).normalize());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28));
    const k = 0.55 + r() * 0.85;
    m4.compose(s.p, q, new THREE.Vector3(k, k * (0.8 + r() * 0.5), k));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, c.set(palette[Math.floor(r() * palette.length)]));
  });
  mesh.frustumCulled = false;
  return mesh;
}

// ── Sea fans: lacy gorgonians mid-water ───────────────────────────────────

function fanTexture(seed: number) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  const r = rng(seed);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const tips: [number, number][] = [];
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.3, (y + y2) / 2, x2, y2);
    g.stroke();
    tips.push([x2, y2]);
    if (depth === 0) return;
    const n = depth > 4 ? 2 : 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * (0.34 + r() * 0.22);
      const na = THREE.MathUtils.clamp(a + spread + (r() - 0.5) * 0.18, 0.25, Math.PI - 0.25);
      branch(x2, y2, na, len * (0.74 + r() * 0.1), Math.max(0.8, w * 0.7), depth - 1);
    }
  };
  branch(S / 2, S - 4, Math.PI / 2, 40, 6, 7);
  // The mesh between the branches.
  g.lineWidth = 0.9;
  for (let i = 0; i < tips.length * 1.6; i++) {
    const a = tips[Math.floor(r() * tips.length)];
    let best: [number, number] | null = null, bd = 1e9;
    for (let k = 0; k < 12; k++) {
      const b = tips[Math.floor(r() * tips.length)];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d > 4 && d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best && bd < 26) {
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(best[0], best[1]);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSeaFans(spots: Placement[], palette: string[], uTime: TimeUniform, seed: number) {
  const r = rng(seed);
  const geo = new THREE.PlaneGeometry(1, 1, 1, 6);
  geo.translate(0, 0.5, 0);
  const phase = new Float32Array(spots.length);
  const mat = new THREE.MeshStandardMaterial({ map: fanTexture(seed), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\nattribute float aPhase;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed.z += sin(uTime * 0.7 + aPhase) * position.y * position.y * 0.12;\n  transformed.x += sin(uTime * 0.5 + aPhase * 1.3) * position.y * 0.03;',
    );
  };
  mat.customProgramCacheKey = () => 'dive-fan';
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  spots.forEach((s, i) => {
    phase[i] = r() * 30;
    // Fans face the open water (the camera), standing out from the rock with a little lean.
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.2, (r() - 0.5) * 0.9, (r() - 0.5) * 0.35));
    const k = 45 + r() * 85;
    m4.compose(s.p.clone().addScaledVector(s.n, 4), q, new THREE.Vector3(k, k * (0.8 + r() * 0.3), k));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, c.set(palette[Math.floor(r() * palette.length)]));
  });
  mesh.frustumCulled = false;
  return mesh;
}

// ── Tube sponges with glowing rims, for the deep ───────────────────────────

export function buildTubeSponges(spots: Placement[], palette: string[], seed: number) {
  const r = rng(seed);
  const tubes: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const q = new THREE.Quaternion();
  for (const s of spots) {
    const n = 2 + Math.floor(r() * 4);
    const color = new THREE.Color(palette[Math.floor(r() * palette.length)]);
    const axis = s.n.clone().lerp(up, 0.7).normalize();
    for (let k = 0; k < n; k++) {
      const tilt = axis.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5)).normalize();
      q.setFromUnitVectors(up, tilt);
      const rad = 3.2 + r() * 3.6, h = 12 + r() * 30;
      const at = s.p.clone().add(new THREE.Vector3((r() - 0.5) * 16, 0, (r() - 0.5) * 12));
      tubes.push({ m: new THREE.Matrix4().compose(at, q, new THREE.Vector3(rad, h, rad)), c: color.clone().multiplyScalar(0.8 + r() * 0.4) });
    }
  }
  const geo = new THREE.CylinderGeometry(1, 0.78, 1, 12, 3, true);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float vTubeY;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTubeY = position.y;');
    shader.fragmentShader = `varying float vTubeY;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance += vColor * (smoothstep(0.82, 1.0, vTubeY) * 2.6 + 0.05);
      #endif
      if (!gl_FrontFacing) diffuseColor.rgb *= 0.25;`,
    );
  };
  mat.customProgramCacheKey = () => 'dive-tube';
  const mesh = new THREE.InstancedMesh(geo, mat, tubes.length);
  tubes.forEach((t, i) => {
    mesh.setMatrixAt(i, t.m);
    mesh.setColorAt(i, t.c);
  });
  mesh.frustumCulled = false;
  return mesh;
}

// ── Glowing anemones for the deep, like the ones on the deep ledge art ─────

function anemoneGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const tipAttr = (g: THREE.BufferGeometry, f: (y: number) => number) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    g.setAttribute('aTip', new THREE.BufferAttribute(Float32Array.from({ length: p.count }, (_, i) => f(p.getY(i))), 1));
    return g;
  };
  const stalk = new THREE.CylinderGeometry(3.2, 4.4, 6, 12, 1);
  stalk.translate(0, 3, 0);
  parts.push(tipAttr(stalk, () => 0));
  const disc = new THREE.CircleGeometry(3.4, 14);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, 6.01, 0);
  parts.push(tipAttr(disc, () => 0.35));
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ring = i % 2 ? 2.4 : 3.1;
    const len = i % 2 ? 7 : 9.5;
    const cone = new THREE.ConeGeometry(0.75, len, 5, 1);
    cone.translate(0, len / 2, 0);
    tipAttr(cone, (y) => Math.max(0, y / len));
    cone.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), 0.55 + (i % 3) * 0.18));
    cone.translate(Math.cos(a) * ring, 5.6, Math.sin(a) * ring);
    parts.push(cone);
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  parts.forEach((g) => g.dispose());
  return merged;
}

export function buildAnemones(spots: Placement[], palette: string[], uTime: TimeUniform, seed: number) {
  const r = rng(seed);
  const items: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const q = new THREE.Quaternion();
  for (const s of spots) {
    const axis = s.n.clone().lerp(up, 0.55).normalize();
    const color = new THREE.Color(palette[Math.floor(r() * palette.length)]);
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      q.setFromUnitVectors(up, axis).multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28));
      const size = 1.7 + r() * 1.6;
      const at = s.p.clone().add(new THREE.Vector3((r() - 0.5) * 26, (r() - 0.5) * 8, (r() - 0.5) * 18));
      items.push({ m: new THREE.Matrix4().compose(at, q, new THREE.Vector3(size, size, size)), c: color.clone().multiplyScalar(0.8 + r() * 0.4) });
    }
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, color: '#5c6d80' });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\nattribute float aTip;\nvarying float vTip;\nvarying float vPulse;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      vTip = aTip;
      float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].y * 0.05;
      transformed.x += sin(uTime * 1.3 + ph + position.y * 0.4) * aTip * aTip * 1.6;
      transformed.z += cos(uTime * 1.1 + ph + position.y * 0.3) * aTip * aTip * 1.2;
      vPulse = 0.75 + 0.25 * sin(uTime * 1.6 + ph * 3.0);`,
    );
    shader.fragmentShader = `varying float vTip;\nvarying float vPulse;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance += vColor * (vTip * vTip * 4.6 + 0.2) * vPulse;
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => 'dive-anemone';
  const mesh = new THREE.InstancedMesh(anemoneGeometry(), mat, items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, it.c);
  });
  mesh.frustumCulled = false;
  return mesh;
}

// ── Bioluminescent specks on the deep rock ────────────────────────────────

export function buildGlowSpecks(spots: Placement[], colors: string[], uTime: TimeUniform, uScale: PointScale, seed: number) {
  const r = rng(seed);
  const pos = new Float32Array(spots.length * 3);
  const col = new Float32Array(spots.length * 3);
  const seedA = new Float32Array(spots.length);
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    const p = s.p.clone().addScaledVector(s.n, 3);
    pos.set([p.x, p.y, p.z], i * 3);
    c.set(colors[Math.floor(r() * colors.length)]).multiplyScalar(2.2);
    col.set([c.r, c.g, c.b], i * 3);
    seedA[i] = r();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uScale;
      attribute vec3 aColor;
      attribute float aSeed;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 40.0);
        gl_PointSize = (2.2 + 2.6 * aSeed) * uScale / max(-mv.z, 1.0);
        vColor = aColor * tw * tw;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.05, 0.5, d);
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 110;
  return points;
}
