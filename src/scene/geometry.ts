import { ZONES } from '../game/math';
import { LEDGES, type LedgeId } from './ledges';

/*
 * World layout. The ledges sit on the z = 0 plane in a canyon about 600 wide; the camera fits at least that
 * width into the free part of the screen. The waterline is y = 0 and depth runs down negative y; the camera
 * looks straight down −z.
 */

/** Ledge art is 2:1. It is drawn wider than the canyon so its rough ends tuck in behind the walls. */
export const LEDGE_W = 680;
export const LEDGE_H = LEDGE_W / 2;
export const LEDGE_SPACING = 300;
const FIRST_LEDGE_Y = -335;
/** The canyon walls' inner faces, either side of the ledges (the ledge art's rough ends tuck in behind them). */
export const WALL_INNER = 300;
/** The diver swims this far in front of the cliff face. */
export const DIVER_Z = 72;
/** Sky kept in view above the waterline when the camera is at the surface. */
export const SKY_SHOWN = 115;

export const ledgeY = (k: number) => FIRST_LEDGE_Y - k * LEDGE_SPACING;
export const SEABED_Y = ledgeY(ZONES - 1) - 250;
/** Depth used for colour grading: 0 at the surface, 1 on the seabed. */
export const WORLD_DEPTH = -SEABED_Y;

/** Two art variants per depth band; the third zone of a band reuses the first, mirrored. */
const BANDS: [LedgeId, LedgeId][] = [
  ['shallow-a', 'shallow-b'],
  ['mid-a', 'mid-b'],
  ['deep-a', 'deep-b'],
];
const BAND_START = [0, 3, 6];

export function ledgeFor(k: number): { id: LedgeId; mirror: boolean } {
  const band = k < 3 ? 0 : k < 6 ? 1 : 2;
  const i = k - BAND_START[band];
  return { id: BANDS[band][i % 2], mirror: i >= 2 };
}

export interface CaveSpot {
  x: number;
  y: number;
  /** Half-width of the mouth. */
  r: number;
}

/** The three cave mouths of zone k in world units, left to right (matching cave indices 0, 1, 2). */
export function cavesFor(k: number): CaveSpot[] {
  const { id, mirror } = ledgeFor(k);
  return LEDGES[id].caves
    .map((c) => ({ x: (mirror ? 0.5 - c.u : c.u - 0.5) * LEDGE_W, y: ledgeY(k) + (0.5 - c.v) * LEDGE_H, r: c.r * LEDGE_W }))
    .sort((a, b) => a.x - b.x);
}

/** Top of zone k's art (coral tips) in world y. */
export function ledgeTopY(k: number) {
  return ledgeY(k) + (0.5 - LEDGES[ledgeFor(k).id].top) * LEDGE_H;
}

/** Where the diver hovers while choosing a cave in zone k: open water just above the ledge. */
export const hoverY = (k: number) => ledgeTopY(k) + 44;

/** Where the diver waits in front of a cave mouth while swimming in. */
export function caveFront(k: number, c: number) {
  const spot = cavesFor(k)[c];
  return { x: spot.x, y: spot.y + spot.r * 0.55 };
}
