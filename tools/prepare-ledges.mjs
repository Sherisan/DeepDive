#!/usr/bin/env node
/*
 * Prepares the rock-ledge art for the 3D scene.
 *
 *   npm run assets:ledges -- shallow-a=<image> shallow-b=<image> mid-a=<image> mid-b=<image> deep-a=<image> deep-b=<image> [debug=<dir>]
 *
 * Each source image is a ledge with three cave mouths on a white background, with soft white haze
 * at the bottom and glow halos around the anemones. For each one this:
 *   1. Cuts out the background. The white backdrop and any smooth light area connected to it (haze,
 *      glow halos) get a colour-to-alpha unmix against white, so haze becomes a translucent shadow and
 *      halos become translucent colour instead of white. Textured rock is left opaque.
 *   2. Finds the three cave mouths: the three widest dark regions across the middle band.
 *   3. Writes public/ledges/<id>.webp and regenerates src/scene/ledges.ts with the cave positions.
 * With debug=<dir> it also writes previews over dark water with the detected caves outlined.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_W = 1280;
const IDS = ['shallow-a', 'shallow-b', 'mid-a', 'mid-b', 'deep-a', 'deep-b'];

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const missing = IDS.filter((id) => !args[id]);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}\nUsage: npm run assets:ledges -- ${IDS.map((id) => `${id}=<image>`).join(' ')} [debug=<dir>]`);
  process.exit(1);
}

/** Box sum over a (2r+1)² window using an integral image. */
function integral(values, W, H) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += values[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  return (x, y, r) => {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
    return { sum: I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0], n: (x1 - x0) * (y1 - y0) };
  };
}

async function prepare(file) {
  const { data, info } = await sharp(file, { failOn: 'none' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const lum = new Float32Array(N), lum2 = new Float32Array(N), mn = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum2[i] = lum[i] * lum[i];
    mn[i] = Math.min(r, g, b);
  }
  const box = integral(lum, W, H), box2 = integral(lum2, W, H);
  const smooth = (i) => {
    const x = i % W, y = (i / W) | 0;
    const a = box(x, y, 2), b = box2(x, y, 2);
    const mean = a.sum / a.n;
    return Math.sqrt(Math.max(0, b.sum / b.n - mean * mean)) < 6;
  };

  // 1. Background: flood from the border through white, through smooth light pixels (haze, halos),
  //    and below the cave line through smooth colourless pixels (the haze's dark end, down to the rock).
  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const hazeLine = Math.round(H * 0.55);
  const colourless = (i) => {
    const mx = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    return mx === 0 || (mx - mn[i]) / mx < 0.16;
  };
  const candidate = (i) =>
    mn[i] >= 236 || (smooth(i) && (lum[i] >= 110 || (i >= hazeLine * W && lum[i] >= 30 && colourless(i))));
  const push = (i) => {
    if (!bg[i] && candidate(i)) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < N - W) push(i + W);
  }
  // Some haze bands end in a hard edge against the white, which the flood can't cross. Rows below the
  // caves that are mostly smooth and colourless are haze rows: from the first one down, every
  // colourless pixel is haze (rows of textured rock never qualify, so rock is left alone).
  let hazeFrom = H;
  for (let y = hazeLine; y < H && hazeFrom === H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (colourless(i) && lum[i] >= 30 && (smooth(i) || mn[i] >= 200)) n++;
    }
    if (n > W * 0.55 && n < W * 0.98) hazeFrom = y;
  }
  for (let i = hazeFrom * W; i < N; i++) if (!bg[i] && lum[i] >= 30 && colourless(i)) bg[i] = 1;
  // Grow the region 2 px into the rock so anti-aliased edges are unmixed too (no white fringe).
  let region = bg;
  for (let pass = 0; pass < 2; pass++) {
    const next = region.slice();
    for (let i = 0; i < N; i++) {
      if (region[i]) continue;
      const x = i % W;
      if ((x > 0 && region[i - 1]) || (x < W - 1 && region[i + 1]) || (i >= W && region[i - W]) || (i < N - W && region[i + W])) next[i] = 1;
    }
    region = next;
  }

  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    let a = 1;
    if (region[i]) {
      a = (255 - mn[i]) / 255;
      a = a < 0.035 ? 0 : (a - 0.035) / 0.965;
    }
    const o = i * 4;
    if (a <= 0) continue;
    const unmix = (c) => Math.max(0, Math.min(255, Math.round((c - (1 - a) * 255) / a)));
    // Haze below the caves is tinted toward deep water, so it reads as shadow rather than grey or brown.
    const haze = region[i] && i >= hazeLine * W;
    const tint = (c, w) => (haze ? Math.round(c * 0.35 + w * 0.65) : c);
    rgba[o] = tint(region[i] ? unmix(r) : r, 6);
    rgba[o + 1] = tint(region[i] ? unmix(g) : g, 20);
    rgba[o + 2] = tint(region[i] ? unmix(b) : b, 32);
    rgba[o + 3] = Math.round(a * 255);
  }

  // Vertical extent of the art (rows with a meaningful share of opaque pixels).
  const rowOpaque = (y) => { let n = 0; for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 128) n++; return n; };
  let top = 0, bottom = H - 1;
  while (top < H && rowOpaque(top) < W * 0.02) top++;
  while (bottom > 0 && rowOpaque(bottom) < W * 0.02) bottom--;

  // 2. Caves. The art always has its three mouths near 20%, 50% and 80% across, so each is searched for
  //    in its own window: the widest run of columns whose middle band is darker than that window's rock.
  const y0 = Math.round(H * 0.36), y1 = Math.round(H * 0.7);
  const caves = [0.2, 0.5, 0.8].map((centre) => {
    const wa = Math.round((centre - 0.15) * W), wb = Math.round((centre + 0.15) * W);
    const lums = [];
    for (let y = y0; y < y1; y++) for (let x = wa; x <= wb; x++) lums.push(lum[y * W + x]);
    lums.sort((p, q) => p - q);
    // Tighten the darkness test until the mouth comes out cave-sized (very dark rock merges at loose settings).
    let isDark = () => false, xa = wa, xb = wb;
    for (const [pct, add] of [[0.15, 6], [0.1, 4], [0.06, 3], [0.03, 2], [0.015, 1]]) {
      const dark = lums[Math.floor(lums.length * pct)] + add;
      const test = (x, y) => lum[y * W + x] < dark;
      const cols = [];
      for (let x = wa; x <= wb; x++) { let n = 0; for (let y = y0; y < y1; y++) if (test(x, y)) n++; cols.push(n); }
      const sm = cols.map((_, i) => { let s = 0, n = 0; for (let d = -12; d <= 12; d++) if (cols[i + d] !== undefined) { s += cols[i + d]; n++; } return s / n; });
      const peakAt = sm.indexOf(Math.max(...sm));
      let a = peakAt, b = peakAt;
      while (a > 0 && sm[a - 1] > sm[peakAt] * 0.5) a--;
      while (b < sm.length - 1 && sm[b + 1] > sm[peakAt] * 0.5) b++;
      isDark = test;
      xa = wa + a;
      xb = wa + b;
      if (b - a <= W * 0.16) break;
    }
    const w = xb - xa;
    const ia = Math.round(xa + w * 0.3), ib = Math.round(xb - w * 0.3);
    const rows = [];
    for (let y = Math.round(H * 0.2); y < Math.round(H * 0.7); y++) {
      let n = 0;
      for (let x = ia; x <= ib; x++) if (isDark(x, y)) n++;
      if (n > (ib - ia + 1) * 0.5) rows.push(y);
    }
    // Where haze fills the bottom of a mouth only its dark top is found; arches are about as tall as wide.
    const ya = rows[0], yb = Math.max(rows[rows.length - 1], ya + Math.round(w * 0.85));
    return { u: (xa + xb) / 2 / W, v: (ya + yb) / 2 / H, r: w / 2 / W, box: [xa, ya, xb, yb] };
  });
  return { W, H, rgba, top: top / H, bottom: bottom / H, caves };
}

const outDir = join(ROOT, 'public', 'ledges');
mkdirSync(outDir, { recursive: true });
if (args.debug) mkdirSync(resolve(args.debug), { recursive: true });
const manifest = {};

for (const id of IDS) {
  const ledge = await prepare(resolve(args[id]));
  const outW = Math.min(OUT_W, ledge.W), outH = Math.round((ledge.H * outW) / ledge.W);
  await sharp(ledge.rgba, { raw: { width: ledge.W, height: ledge.H, channels: 4 } })
    .resize(outW, outH)
    .webp({ quality: 82, alphaQuality: 90, effort: 5 })
    .toFile(join(outDir, `${id}.webp`));
  manifest[id] = {
    top: +ledge.top.toFixed(4),
    bottom: +ledge.bottom.toFixed(4),
    caves: ledge.caves.map(({ u, v, r }) => ({ u: +u.toFixed(4), v: +v.toFixed(4), r: +r.toFixed(4) })),
  };
  console.log(id.padEnd(10), 'top', manifest[id].top, 'bottom', manifest[id].bottom, 'caves', manifest[id].caves.map((c) => `u${c.u} v${c.v} r${c.r}`).join(' | '));

  if (args.debug) {
    // Preview: the cut-out over dark water, with the detected caves outlined in red.
    const { W, H, rgba } = ledge;
    const prev = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const a = rgba[i * 4 + 3] / 255;
      prev[i * 3] = rgba[i * 4] * a + 6 * (1 - a);
      prev[i * 3 + 1] = rgba[i * 4 + 1] * a + 45 * (1 - a);
      prev[i * 3 + 2] = rgba[i * 4 + 2] * a + 70 * (1 - a);
    }
    for (const { box: [xa, ya, xb, yb] } of ledge.caves) {
      for (let x = xa; x <= xb; x++) for (const y of [ya, yb]) prev.set([255, 40, 40], (y * W + x) * 3);
      for (let y = ya; y <= yb; y++) for (const x of [xa, xb]) prev.set([255, 40, 40], (y * W + x) * 3);
    }
    await sharp(prev, { raw: { width: W, height: H, channels: 3 } }).resize(720).png().toFile(join(resolve(args.debug), `${id}.png`));
  }
}

const ts = `// Generated by tools/prepare-ledges.mjs from the source art. Do not edit by hand: re-run \`npm run assets:ledges\`.
// Positions are normalised to the image (u across, v down); r is a cave's half-width as a share of the image width.

export type LedgeId = ${IDS.map((id) => `'${id}'`).join(' | ')};

export interface LedgeInfo {
  /** First and last rows with art in them. */
  top: number;
  bottom: number;
  /** The three cave mouths, left to right. */
  caves: { u: number; v: number; r: number }[];
}

export const LEDGE_IDS: LedgeId[] = ${JSON.stringify(IDS)};

export const LEDGES: Record<LedgeId, LedgeInfo> = ${JSON.stringify(manifest, null, 2)};
`;
writeFileSync(join(ROOT, 'src', 'scene', 'ledges.ts'), ts);
console.log('wrote public/ledges/*.webp and src/scene/ledges.ts');
