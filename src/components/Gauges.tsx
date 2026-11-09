import type { RoundView } from '../game/engine';
import { CAVES, ZONES, ZONE_DEPTH, multiplierFor } from '../game/math';
import { formatMultiplier } from '../game/money';

/** Depth read-out, oxygen tank and live odds, laid over the ocean. */
export function Gauges({ round }: { round: RoundView | null }) {
  const live = round?.status === 'live';
  const rung = round?.rung ?? 0;
  const depth = round && round.status !== 'surfaced' ? (round.status === 'live' ? rung : round.picks.length) * ZONE_DEPTH : 0;
  const oxygen = live ? ZONES - rung : round?.status === 'surfaced' ? ZONES - rung : round ? ZONES - round.picks.length : ZONES;
  const low = live && oxygen <= 2;

  const info = !round
    ? 'EIGHT ZONES · A SHARK IN ONE CAVE OF EVERY THREE'
    : live
      ? null
      : round.status === 'bitten'
        ? 'SHARK ATTACK · START A NEW DIVE'
        : round.status === 'abyss'
          ? 'TREASURE FOUND AT THE ABYSS'
          : `SURFACED AT ${formatMultiplier(multiplierFor(rung))}`;

  return (
    <>
      <div className={`status-pill status-${round?.status ?? 'idle'}`}>
        {info ?? (
          <>
            <span>
              ZONE <b>{rung + 1}</b>/{ZONES}
            </span>
            <span className="danger">
              ODDS <b>1 IN {CAVES}</b>
            </span>
            <span>
              NEXT <b>{formatMultiplier(multiplierFor(rung + 1))}</b>
            </span>
          </>
        )}
      </div>

      <div className={`gauge ${low ? 'low' : ''}`} aria-label={`Depth ${depth} metres, oxygen ${oxygen} of ${ZONES}`}>
        <div className="gauge-depth">
          <small>DEPTH</small>
          <b>{depth}</b>
          <small>m</small>
        </div>
        <div className="gauge-tank">
          <small>O₂</small>
          <div className="tank">
            {Array.from({ length: ZONES }, (_, i) => (
              <i key={i} className={ZONES - 1 - i < oxygen ? 'full' : ''} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
