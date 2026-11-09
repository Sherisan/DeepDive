import * as THREE from 'three';

export type TimeUniform = { value: number };

// ── Water colour by depth ─────────────────────────────────────────────────

/** Water colour from the surface (0) to the seabed (1). */
const WATER: [number, THREE.Color][] = [
  [0, new THREE.Color('#2fc7e1')],
  [0.05, new THREE.Color('#1597bb')],
  [0.2, new THREE.Color('#0b5f88')],
  [0.45, new THREE.Color('#06385c')],
  [0.72, new THREE.Color('#031d34')],
  [1, new THREE.Color('#010b15')],
];

export function waterColorAt(d: number, out = new THREE.Color()) {
  const t = THREE.MathUtils.clamp(d, 0, 1);
  for (let i = 1; i < WATER.length; i++) {
    const [d1, c1] = WATER[i];
    if (t <= d1) {
      const [d0, c0] = WATER[i - 1];
      return out.copy(c0).lerp(c1, (t - d0) / (d1 - d0));
    }
  }
  return out.copy(WATER[WATER.length - 1][1]);
}

// ── Glow lights ───────────────────────────────────────────────────────────

/**
 * Coloured light from the caves, the shark's red flash and the open chest. Real point lights cost every lit
 * pixel on screen, so instead the big surfaces (ledges, cliffs, sand) add this cheap diffuse term.
 * pos is xyz and radius; col is colour × strength (black = off).
 */
export interface GlowLights {
  pos: { value: THREE.Vector4[] };
  col: { value: THREE.Color[] };
  /** The diver's torch: lens position and range, beam direction and cos(cone half-angle), colour × strength. */
  torchPos: { value: THREE.Vector4 };
  torchDir: { value: THREE.Vector4 };
  torchCol: { value: THREE.Color };
}

export const GLOW_COUNT = 4;

export function makeGlowLights(): GlowLights {
  return {
    pos: { value: Array.from({ length: GLOW_COUNT }, () => new THREE.Vector4(0, 0, 0, 1)) },
    col: { value: Array.from({ length: GLOW_COUNT }, () => new THREE.Color(0, 0, 0)) },
    torchPos: { value: new THREE.Vector4(0, 0, 0, 1) },
    torchDir: { value: new THREE.Vector4(1, 0, 0, 0.9) },
    torchCol: { value: new THREE.Color(0, 0, 0) },
  };
}

/** Hook a shader up to the glow lights (it must include GLOW_GLSL). */
export function bindGlow(shader: { uniforms: Record<string, THREE.IUniform> }, lights: GlowLights) {
  shader.uniforms.uGlowPos = lights.pos;
  shader.uniforms.uGlowCol = lights.col;
  shader.uniforms.uTorchPos = lights.torchPos;
  shader.uniforms.uTorchDir = lights.torchDir;
  shader.uniforms.uTorchCol = lights.torchCol;
}

export const GLOW_GLSL = /* glsl */ `
uniform vec4 uGlowPos[${GLOW_COUNT}];
uniform vec3 uGlowCol[${GLOW_COUNT}];
uniform vec4 uTorchPos;
uniform vec4 uTorchDir;
uniform vec3 uTorchCol;
vec3 glowLight(vec3 p, vec3 n) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${GLOW_COUNT}; i++) {
    vec3 d = uGlowPos[i].xyz - p;
    float dist = length(d);
    float fall = clamp(1.0 - dist / uGlowPos[i].w, 0.0, 1.0);
    float facing = clamp(dot(n, d / max(dist, 1e-3)), 0.0, 1.0);
    sum += uGlowCol[i] * (fall * fall) * (0.3 + 0.7 * facing);
  }
  // The torch: a soft-edged cone from the lens.
  vec3 t = p - uTorchPos.xyz;
  float td = length(t);
  vec3 l = t / max(td, 1e-3);
  float cone = smoothstep(uTorchDir.w, mix(uTorchDir.w, 1.0, 0.6), dot(l, uTorchDir.xyz));
  float tf = clamp(1.0 - td / uTorchPos.w, 0.0, 1.0);
  sum += uTorchCol * cone * (tf * tf) * (0.25 + 0.75 * clamp(-dot(n, l), 0.0, 1.0));
  return sum;
}
`;

// ── Rock ledges: caustic light near the surface, bioluminescence in the deep ──

export const CAUSTIC_GLSL = /* glsl */ `
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(max(c, 0.0), 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
`;

/**
 * Standard lit material for a ledge texture, with two additions in the shader: rippling caustic light that
 * fades out with depth, and (for the deep ledges) saturated colours glowing, so anemones bloom.
 */
export function makeLedgeMaterial(uTime: TimeUniform, glow: number, bottom: number, lights: GlowLights) {
  const m = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
    bumpScale: 3,
    alphaTest: 0.01,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uGlow = { value: glow };
    shader.uniforms.uFadeLo = { value: 1 - bottom };
    bindGlow(shader, lights);
    shader.vertexShader = `varying vec3 vCausticPos;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = `uniform float uTime;\nuniform float uGlow;\nuniform float uFadeLo;\nvarying vec3 vCausticPos;\n${CAUSTIC_GLSL}\n${GLOW_GLSL}\n${shader.fragmentShader}`
      // Fade out the bottom of the art, so the haze under each ledge has no hard lower edge.
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n  diffuseColor.a *= smoothstep(uFadeLo, uFadeLo + 0.11, vMapUv.y);\n#endif')
      .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      {
        float shallow = 1.0 - smoothstep(150.0, 1150.0, -vCausticPos.y);
        if (shallow > 0.002) {
          float c = caustic(vCausticPos.xy * 0.0042, uTime * 0.5);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.7, 0.95, 1.0) * c * shallow * 1.1;
        }
        totalEmissiveRadiance += diffuseColor.rgb * glowLight(vCausticPos, vec3(0.0, 0.0, 1.0));
        vec3 col = diffuseColor.rgb;
        float mx = max(col.r, max(col.g, col.b));
        float sat = (mx - min(col.r, min(col.g, col.b))) / max(mx, 1e-4);
        totalEmissiveRadiance += col * smoothstep(0.5, 0.85, sat) * smoothstep(0.12, 0.5, mx) * uGlow;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'dive-ledge';
  return m;
}

// ── Background: sky above the waterline, water graded by depth below ───────

/**
 * Full-screen quad behind everything. It maps each pixel back to the world x/y it covers on the z = 0 plane, so
 * its waterline lines up exactly with the surface band in front.
 */
export function makeBackdrop() {
  const uniforms = {
    uOrigin: { value: new THREE.Vector2(0, -300) },
    uHalf: { value: new THREE.Vector2(800, 450) },
    uSun: { value: new THREE.Vector2(205, 66) },
    uSkyLow: { value: new THREE.Color('#ffe2b6') },
    uSkyHigh: { value: new THREE.Color('#ff9458') },
    uWater: { value: WATER.map(([, c]) => c) },
    uStops: { value: WATER.map(([d]) => d) },
    uDepth: { value: 2700 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uOrigin;
      uniform vec2 uHalf;
      uniform vec2 uSun;
      uniform vec3 uSkyLow;
      uniform vec3 uSkyHigh;
      uniform vec3 uWater[6];
      uniform float uStops[6];
      uniform float uDepth;
      varying vec2 vNdc;
      vec3 water(float d) {
        vec3 c = uWater[0];
        for (int i = 1; i < 6; i++) c = mix(c, uWater[i], clamp((d - uStops[i - 1]) / (uStops[i] - uStops[i - 1]), 0.0, 1.0));
        return c;
      }
      void main() {
        float y = uOrigin.y + vNdc.y * uHalf.y;
        float x = uOrigin.x + vNdc.x * uHalf.x;
        vec3 col;
        if (y > 0.0) {
          col = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 260.0, y));
          float r = length(vec2(x, y) - uSun);
          col += vec3(1.0, 0.93, 0.78) * (smoothstep(31.0, 27.0, r) * 2.4 + exp(-r / 55.0) * 0.55);
        } else {
          col = water(clamp(-y / uDepth, 0.0, 1.0));
          col += vec3(0.05, 0.16, 0.2) * exp(y / 90.0);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  // Last of the opaque objects and depth-tested at the far plane, so only the sky and water actually seen
  // (not what the cliffs cover) gets shaded.
  mesh.renderOrder = 1000;
  return { mesh, uniforms };
}

// ── The waterline: a wavy band drawn in front of everything at y = 0 ───────

export function makeSurfaceBand(uTime: TimeUniform) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uTop: { value: waterColorAt(0) }, uFoam: { value: new THREE.Color(1.5, 1.75, 1.85) } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uFoam;
      varying vec3 vWorld;
      void main() {
        float x = vWorld.x;
        float wave = 5.0 * sin(x * 0.026 + uTime * 1.3) + 2.6 * sin(x * 0.067 - uTime * 1.9) + 1.1 * sin(x * 0.16 + uTime * 2.8);
        float below = wave - vWorld.y;
        if (below < 0.0) discard;
        vec3 col = mix(uFoam, uTop, smoothstep(0.0, 4.5, below));
        float a = 1.0 - smoothstep(12.0, 46.0, below);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 80), material);
  mesh.renderOrder = 200;
  return mesh;
}

// ── Sun shafts ─────────────────────────────────────────────────────────────

export function makeGodRay(uTime: TimeUniform, seed: number) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uSeed: { value: seed }, uColor: { value: new THREE.Color('#c9f6ff') } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 uv = clamp(vUv, 0.0, 1.0);
        float s = sin(3.14159 * uv.x);
        float edge = s * s;
        float len = pow(uv.y, 1.8);
        float flicker = 0.55 + 0.45 * sin(uTime * 0.6 + uSeed * 7.0) * sin(uTime * 0.37 + uSeed * 3.0);
        gl_FragColor = vec4(uColor, edge * len * flicker * 0.16);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 5;
  return mesh;
}

// ── Particles ─────────────────────────────────────────────────────────────

/** Shared scale for point sizes: device pixels per world unit on the ledge plane, times the camera distance. */
export type PointScale = { value: number };

/** Soft drifting marine snow through the whole water column. */
export function makeSnow(count: number, bounds: { x: number; yTop: number; yBottom: number; zFar: number; zNear: number }, uTime: TimeUniform, uScale: PointScale) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * bounds.x;
    pos[i * 3 + 1] = bounds.yBottom + Math.random() * (bounds.yTop - bounds.yBottom);
    pos[i * 3 + 2] = bounds.zFar + Math.random() * (bounds.zNear - bounds.zFar);
    size[i] = 1.4 + Math.random() * 2.6;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uScale;
      attribute float aSize;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.23 + aSeed * 40.0) * 8.0;
        p.y += sin(uTime * 0.17 + aSeed * 17.0) * 10.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
        vA = 0.5 * (1.0 - smoothstep(1300.0, 2600.0, -mv.z)) * (0.6 + 0.4 * sin(uTime * 1.3 + aSeed * 30.0));
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(0.72, 0.92, 1.0), smoothstep(0.5, 0.05, d) * vA);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 100;
  return points;
}

/** A pool of points whose positions/alpha are written from the CPU each frame (bubbles, plankton, sparks). */
export function makePointPool(count: number, color: THREE.Color, uScale: PointScale, ring: boolean, additive: boolean) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale, uColor: { value: color } },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: ring ? { RING: 1 } : {},
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float aSize;
      attribute float aAlpha;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
        vA = aAlpha;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        #ifdef RING
          float a = smoothstep(0.5, 0.42, d) * (0.35 + 0.65 * smoothstep(0.2, 0.42, d));
          a += smoothstep(0.16, 0.0, length(q - vec2(-0.14, -0.14))) * 0.9;
        #else
          float a = smoothstep(0.5, 0.0, d);
        #endif
        gl_FragColor = vec4(uColor, a * vA);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 120;
  return points;
}

// ── Cave glow: an arch-shaped halo around a mouth ──────────────────────────

export function makeCaveGlow(uTime: TimeUniform) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uIntensity: { value: 0 }, uColor: { value: new THREE.Color('#3fd4ff') } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        p.y *= 1.08;
        float d = length(p);
        float q = (d - 0.72) / 0.13;
        float ring = exp(-q * q);
        float inner = smoothstep(0.75, 0.2, d) * 0.12;
        float arch = smoothstep(-0.75, -0.2, p.y);
        gl_FragColor = vec4(uColor, (ring + inner) * arch * uIntensity);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 60;
  return mesh;
}

// ── Canvas textures ───────────────────────────────────────────────────────

export function radialTexture(stops: [number, string][], size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Reflections ───────────────────────────────────────────────────────────

/** A soft underwater environment (bright surface above, deep blue around, dark below) for reflections. */
export function makeEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 top = vec3(1.0, 1.2, 1.3), mid = vec3(0.05, 0.2, 0.3), bottom = vec3(0.005, 0.02, 0.035);
        vec3 c = mix(mid, top, pow(max(y, 0.0), 0.7));
        c = mix(c, bottom, pow(max(-y, 0.0), 0.6));
        c += vec3(1.4, 1.3, 1.15) * pow(max(dot(vDir, normalize(vec3(0.3, 1.0, 0.4))), 0.0), 40.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0);
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return target;
}

/** Give every standard material under root the reflection map. */
export function applyEnvironment(root: THREE.Object3D, envMap: THREE.Texture, intensity: number) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial && !m.envMap) {
        m.envMap = envMap;
        m.envMapIntensity = intensity;
        m.needsUpdate = true;
      }
    }
  });
}
