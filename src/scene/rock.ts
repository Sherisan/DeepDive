import * as THREE from 'three';
import { CAUSTIC_GLSL, GLOW_GLSL, bindGlow, type GlowLights, type TimeUniform } from './materials';
import { fbm, periodicValueNoise, periodicWorley, simplex3, smoothstep } from './noise';

// ── Rock texture ──────────────────────────────────────────────────────────

/**
 * A tileable rock texture made at start-up, in the style of the ledge art: irregular rounded boulders
 * (domain-warped cells at three sizes) with soft cracks between them and their relief baked in as light
 * from the upper left. Channels: R height (for bump), G occlusion (dark in cracks and hollows), B baked
 * light, A a random value per boulder (colour variation).
 */
export function makeRockTexture(size = 512) {
  const cells = [periodicWorley(5, 11), periodicWorley(11, 23), periodicWorley(24, 37)];
  const warpU = periodicValueNoise(6, 3), warpV = periodicValueNoise(6, 4);
  const g1 = periodicValueNoise(28, 5), g2 = periodicValueNoise(80, 6), g3 = periodicValueNoise(190, 7);
  const n = size * size;
  const h = new Float32Array(n), occ = new Float32Array(n), id = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = y * size + x;
      const wu = u + (warpU(u * 6, v * 6) - 0.5) * 0.12;
      const wv = v + (warpV(u * 6, v * 6) - 0.5) * 0.12;
      let hv = 0, crack = 1;
      const weights = [0.58, 0.28, 0.14];
      let big = 0;
      for (let o = 0; o < 3; o++) {
        const c = cells[o](wu + o * 0.37, wv + o * 0.61);
        const dome = Math.pow(Math.max(0, 1 - (c.f1 / 0.92) ** 2), 0.55);
        const edge = smoothstep(0, o === 0 ? 0.09 : 0.12, c.f2 - c.f1);
        const bump = dome * Math.sqrt(edge);
        if (o === 0) {
          big = bump;
          id[i] = c.id;
        }
        hv += weights[o] * bump * (o === 0 ? 1 : 0.45 + 0.55 * big);
        crack = Math.min(crack, o === 0 ? edge : 0.55 + 0.45 * edge);
      }
      const grain = g1(u * 28, v * 28) * 0.5 + g2(u * 80, v * 80) * 0.32 + g3(u * 190, v * 190) * 0.18;
      hv += 0.07 * grain;
      h[i] = hv;
      occ[i] = crack;
      if (hv < lo) lo = hv;
      if (hv > hi) hi = hv;
    }
  }
  for (let i = 0; i < n; i++) h[i] = (h[i] - lo) / (hi - lo);
  // Bake the relief: light from the upper left (rows run up the rock).
  const L = new THREE.Vector3(-0.5, 0.62, 0.6).normalize();
  const data = new Uint8Array(n * 4);
  const K = 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = y * size + ((x + size - 1) % size), xr = y * size + ((x + 1) % size);
      const yd = ((y + size - 1) % size) * size + x, yu = ((y + 1) % size) * size + x;
      const nx = -(h[xr] - h[xl]) * K, ny = -(h[yu] - h[yd]) * K;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const lit = Math.max(0, (nx * L.x + ny * L.y + L.z) * inv);
      const shade = 0.18 + 0.82 * lit;
      const ao = occ[i] * (0.45 + 0.55 * Math.sqrt(h[i]));
      data[i * 4] = Math.round(h[i] * 255);
      data[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(ao, 0, 1) * 255);
      data[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(shade, 0, 1) * 255);
      data[i * 4 + 3] = Math.round(id[i] * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ── Rock material ─────────────────────────────────────────────────────────

/**
 * Lit rock with no UVs: the texture is projected along the three world axes (triplanar) at two scales,
 * coloured by depth (warm near the surface, blue-grey mid-water, dark slate in the deep, as in the ledge
 * art) and bump-mapped from its height. Near the surface it gets caustics; above the waterline it is dry
 * rock in evening light with no water haze, and a foam line marks where it meets the water.
 */
export function makeRockMaterial(tex: THREE.Texture, uTime: TimeUniform, worldDepth: number, lights: GlowLights) {
  // Lambert: rock is matte, and the cliffs cover much of the screen, so skip the specular maths.
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRockTex = { value: tex };
    shader.uniforms.uTime = uTime;
    shader.uniforms.uDepth = { value: worldDepth };
    shader.uniforms.uBump = { value: 3.2 };
    bindGlow(shader, lights);
    shader.vertexShader = `attribute float aAO;\nvarying vec3 vRockPos;\nvarying vec3 vRockNrm;\nvarying float vRockAO;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vRockNrm = mat3(modelMatrix) * objectNormal;
      vRockAO = aAO;`,
    );
    shader.fragmentShader = `uniform sampler2D uRockTex;
uniform float uTime;
uniform float uDepth;
uniform float uBump;
varying vec3 vRockPos;
varying vec3 vRockNrm;
varying float vRockAO;
float rockH;
${CAUSTIC_GLSL}
${GLOW_GLSL}
${shader.fragmentShader}`
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec3 rn = normalize(vRockNrm);
          vec3 bw = rn * rn;
          bw *= bw;
          bw /= max(bw.x + bw.y + bw.z, 1e-4);
          vec3 p = vRockPos;
          vec4 a = texture2D(uRockTex, p.zy * 0.0047) * bw.x + texture2D(uRockTex, p.xz * 0.0047) * bw.y + texture2D(uRockTex, p.xy * 0.0047) * bw.z;
          rockH = a.r;
          float shadeF = a.b;
          float occF = a.g;
          float d = clamp(-p.y / uDepth, 0.0, 1.0);
          // Rock tone by depth, as in the ledge art: warm sandstone, blue-grey, then dark slate.
          vec3 tone = mix(vec3(0.36, 0.27, 0.17), vec3(0.17, 0.21, 0.25), smoothstep(0.12, 0.4, d));
          tone = mix(tone, vec3(0.07, 0.09, 0.12), smoothstep(0.5, 0.85, d));
          // Large patches and strata break up the tiling.
          float macro = sin(p.x * 0.0041 + p.y * 0.0029 + p.z * 0.0033) * sin(p.y * 0.0052 - p.z * 0.0043 + p.x * 0.0021);
          float strata = 0.93 + 0.07 * sin(p.y * 0.047 + macro * 3.0);
          vec3 col = tone * (0.3 + 0.95 * shadeF) * (0.42 + 0.58 * occF) * mix(0.82, 1.18, a.a) * (1.0 + 0.2 * macro) * strata;
          col *= mix(0.45, 1.0, clamp(vRockAO, 0.0, 1.0));
          // Algae on ledges facing up near the light; pale silt on them in the deep.
          float up = smoothstep(0.35, 0.85, rn.y) * smoothstep(0.35, 0.75, rockH);
          vec3 growth = mix(vec3(0.16, 0.2, 0.07), vec3(0.13, 0.16, 0.18), smoothstep(0.25, 0.6, d));
          col = mix(col, growth * (0.6 + 0.6 * shadeF), up * 0.5 * (0.6 + 0.4 * macro));
          diffuseColor.rgb *= col;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 sp = -vViewPosition;
          vec3 sx = dFdx(sp), sy = dFdy(sp);
          vec2 dh = vec2(dFdx(rockH), dFdy(rockH)) * uBump;
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 nn = abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2);
          float nl = length(nn);
          if (nl > 1e-8) normal = nn / nl;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 rn = normalize(vRockNrm);
          float shallow = (1.0 - smoothstep(30.0, 1150.0, -vRockPos.y)) * step(vRockPos.y, 2.0);
          if (shallow > 0.002) {
            float facing = clamp(0.3 + 0.7 * rn.y, 0.0, 1.0);
            float c = caustic(vRockPos.xz * 0.0037 + vRockPos.y * vec2(0.0012, 0.0007), uTime * 0.5);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.75, 0.95, 1.0) * c * shallow * facing * 1.3;
          }
          totalEmissiveRadiance += diffuseColor.rgb * glowLight(vRockPos, rn);
        }`,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `{
          float wave = 3.5 * sin(vRockPos.x * 0.021 + vRockPos.z * 0.017 + uTime * 1.3) + 1.8 * sin(vRockPos.x * 0.063 - vRockPos.z * 0.04 - uTime * 1.9);
          float above = smoothstep(-1.0, 3.0, vRockPos.y - wave);
          gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.3, 1.0, 0.78), above);
          float foam = 1.0 - smoothstep(0.0, 2.2, abs(vRockPos.y - wave));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.75, 0.92, 1.0), foam * 0.35);
          #ifdef USE_FOG
            // A little water haze even close up, so the walls sit behind the play area.
            float fogFactor = max(smoothstep(fogNear, fogFar, vFogDepth), 0.2) * (1.0 - above);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
          #endif
        }`,
      );
  };
  m.customProgramCacheKey = () => 'dive-rock';
  return m;
}

// ── Canyon walls ──────────────────────────────────────────────────────────

export interface WallSurface {
  positions: Float32Array;
  normals: Float32Array;
  count: number;
}

/**
 * One side of the canyon the ledges span. Seen from the camera it is a cliff face across the edge of the
 * screen (facing +z, in front of the ledges) that turns the corner into the canyon and runs back into the
 * distance. The ledge art's rough ends tuck in behind it. side −1 is the left wall, +1 the right.
 */
export function buildCanyonWall(side: -1 | 1, material: THREE.Material, opts: { inner: number; front: number; top: number; bottom: number; seed: number }) {
  const { inner, front, top, bottom } = opts;
  const n3 = simplex3(opts.seed);
  // Cross-section in x/z for the right wall; the left one is its mirror.
  const ctrl = [
    [1500, front + 10],
    [820, front + 18],
    [470, front + 4],
    [inner + 52, front - 18],
    [inner + 10, front - 74],
    [inner, front - 190],
    [inner + 4, -260],
    [inner + 22, -700],
    [inner + 52, -1150],
    [inner + 96, -1800],
  ].map(([x, z]) => new THREE.Vector3(x * side, 0, z));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const cols = 220;
  const rowStep = 13;
  const rows = Math.ceil((top + 60 - bottom) / rowStep) + 1;
  const path = curve.getSpacedPoints(cols - 1);
  const pos = new Float32Array(cols * rows * 3);
  const ao = new Float32Array(cols * rows);
  const tangent = new THREE.Vector3();

  for (let i = 0; i < cols; i++) {
    const P = path[i];
    curve.getTangentAt(i / (cols - 1), tangent);
    // Outward normal (into the water) of the cross-section.
    const nx = side * tangent.z, nz = -side * tangent.x;
    const nl = Math.hypot(nx, nz) || 1;
    const Nx = nx / nl, Nz = nz / nl;
    // How much this column is the inner face (normal along x) near the ledges, where the rock must not
    // bulge into the play area.
    const innerFace = smoothstep(0.55, 0.85, Math.abs(Nx));
    const nearPlay = innerFace * smoothstep(-520, -260, P.z);
    const capY = top + 130 * fbm(n3, P.x / 380, 7.3, P.z / 380, 2);
    for (let j = 0; j < rows; j++) {
      let y = top + 60 - j * rowStep;
      const big = 54 * fbm(n3, P.x / 520, y / 520, P.z / 520, 4);
      const fine =
        20 * fbm(n3, P.x / 140 + 17.1, y / 140, P.z / 140, 3) +
        8 * n3(P.x / 42, y / 42, P.z / 42 + 5.3) +
        11 * Math.sin(y / 39 + 2.6 * n3(P.x / 300, y / 300, P.z / 300 + 9.1));
      const buttress = 30 * (1 - Math.abs(n3(P.x / 230 + 3.7, y / 1500, P.z / 230))) ** 3;
      let d = big + fine + buttress - 18;
      // The inner face next to the ledges stays within a few units of its line.
      const cap = 10;
      if (d > cap) d = THREE.MathUtils.lerp(d, cap + (d - cap) * 0.12, nearPlay);
      // Round the cliff top back into the rock.
      if (y > capY - 70) {
        const k = (y - (capY - 70)) / 70;
        d -= 95 * k * k;
        if (y > capY) y = capY + (y - capY) * 0.2;
      }
      const v = i * rows + j;
      pos[v * 3] = P.x + Nx * d;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = P.z + Nz * d;
      ao[v] = THREE.MathUtils.clamp(0.62 + fine / 42, 0.15, 1) * THREE.MathUtils.clamp(0.8 + big / 110, 0.45, 1);
    }
  }

  const index: number[] = [];
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = (i + 1) * rows + j, c = i * rows + j + 1, d = (i + 1) * rows + j + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  // Wind the faces so their normals point out of the rock (checked on a quad of the inner face).
  const probe = (Math.floor(cols * 0.8) * rows + Math.floor(rows / 2)) * 3;
  const A = new THREE.Vector3().fromArray(pos, probe);
  const B = new THREE.Vector3().fromArray(pos, probe + rows * 3);
  const C = new THREE.Vector3().fromArray(pos, probe + 3);
  const faceN = B.sub(A).cross(C.sub(A));
  if (Math.sign(faceN.x) !== -side) {
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  const surface: WallSurface = {
    positions: pos,
    normals: (geo.attributes.normal as THREE.BufferAttribute).array as Float32Array,
    count: cols * rows,
  };
  return { mesh, surface };
}

/** Random spots on the walls that pass a test (e.g. a depth band, facing up, in view). */
export function sampleWalls(
  walls: WallSurface[],
  random: () => number,
  count: number,
  test: (p: THREE.Vector3, n: THREE.Vector3) => boolean,
  tries = count * 60,
) {
  const out: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < tries && out.length < count; t++) {
    const w = walls[Math.floor(random() * walls.length)];
    const v = Math.floor(random() * w.count) * 3;
    p.fromArray(w.positions, v);
    n.fromArray(w.normals, v);
    if (test(p, n)) out.push({ p: p.clone(), n: n.clone() });
  }
  return out;
}
