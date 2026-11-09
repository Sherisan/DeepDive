/** Depth zones from the surface to the abyss; the diver has oxygen for no more. */
export const ZONES = 8;
/** Caves per zone; a shark hides in one of them. */
export const CAVES = 3;
export const RTP = 0.97;
/** Metres per zone, for the depth gauge. */
export const ZONE_DEPTH = 25;

/**
 * A "rung" is the number of zones cleared. Each zone is a fresh 1-in-3 risk, so reaching rung k has
 * probability (2/3)^k and the fair multiplier is (3/2)^k. It is scaled by the RTP and floored to
 * 2 dp so rounding never pushes the return above target.
 */
export function multiplierFor(rung: number): number {
  if (rung <= 0) return 1;
  return Math.floor((RTP * 100 * CAVES ** rung) / (CAVES - 1) ** rung + 1e-9) / 100;
}

/** 1.45, 2.18, 3.27, 4.91, 7.36, 11.04, 16.57, 24.86 */
export const LADDER = Array.from({ length: ZONES }, (_, i) => multiplierFor(i + 1));

export function roundMoney(amount: number): number {
  return Math.round(amount * 100 + 1e-9) / 100;
}

export function payoutFor(bet: number, rung: number): number {
  return roundMoney(bet * multiplierFor(rung));
}

/** Chance of clearing k zones in a row. */
export function survival(rung: number): number {
  return ((CAVES - 1) / CAVES) ** rung;
}
