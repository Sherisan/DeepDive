/** Seeded noise for building the world on the CPU (rock walls, textures, placement). */

/** Small fast seeded PRNG: returns a function giving floats in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** 3D simplex noise in about [-1, 1]. */
export function simplex3(seed: number) {
  const r = rng(seed);
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F3 = 1 / 3, G3 = 1 / 6;

  return (x: number, y: number, z: number) => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const corner = (gi: number, cx: number, cy: number, cz: number) => {
      let q = 0.6 - cx * cx - cy * cy - cz * cz;
      if (q < 0) return 0;
      const g = GRAD3[gi % 12];
      q *= q;
      return q * q * (g[0] * cx + g[1] * cy + g[2] * cz);
    };
    const n0 = corner(perm[ii + perm[jj + perm[kk]]], x0, y0, z0);
    const n1 = corner(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1);
    const n2 = corner(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2);
    const n3 = corner(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3);
    return 32 * (n0 + n1 + n2 + n3);
  };
}

/** Fractal sum of a noise function: octaves at doubling frequency and halving weight. */
export function fbm(noise: (x: number, y: number, z: number) => number, x: number, y: number, z: number, octaves: number) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Tileable 2D value noise: a period × period lattice of random values, smoothly interpolated. */
export function periodicValueNoise(period: number, seed: number) {
  const r = rng(seed);
  const v = Float32Array.from({ length: period * period }, () => r());
  const at = (x: number, y: number) => v[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/**
 * Tileable Worley (cell) noise over an n × n grid on the unit square. Returns the distances to the
 * nearest and second-nearest feature points (in cell units) and a random value for the nearest cell.
 */
export function periodicWorley(n: number, seed: number) {
  const r = rng(seed);
  const px = new Float32Array(n * n), py = new Float32Array(n * n), id = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    px[i] = 0.15 + 0.7 * r();
    py[i] = 0.15 + 0.7 * r();
    id[i] = r();
  }
  const out = { f1: 0, f2: 0, id: 0 };
  return (u: number, v: number) => {
    const x = u * n, y = v * n;
    const cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 9, f2 = 9, best = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        const w = (((gy % n) + n) % n) * n + (((gx % n) + n) % n);
        const ddx = gx + px[w] - x, ddy = gy + py[w] - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          best = id[w];
        } else if (d < f2) f2 = d;
      }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = best;
    return out;
  };
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
