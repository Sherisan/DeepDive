import type { RoundView } from '../game/engine';
import { LADDER, RTP, ZONES, ZONE_DEPTH, roundMoney } from '../game/math';
import { formatMoney, formatMultiplier } from '../game/money';

type RungState = 'locked' | 'next' | 'current' | 'passed' | 'failed';

export function Ladder({ round, previewBet, currency }: { round: RoundView | null; previewBet: number; currency: string }) {
  const stake = round?.status === 'live' ? round.bet : previewBet;
  const rung = round?.rung ?? 0;

  const stateOf = (r: number): RungState => {
    if (!round) return 'locked';
    if (r < rung) return 'passed';
    if (r === rung) return round.status === 'bitten' ? 'passed' : 'current';
    if (r === rung + 1) return round.status === 'live' ? 'next' : round.status === 'bitten' ? 'failed' : 'locked';
    return 'locked';
  };

  return (
    <aside className="ladder">
      <h3>PAYOUT LADDER</h3>
      <ol>
        {LADDER.map((m, i) => ({ r: i + 1, m }))
          .reverse()
          .map(({ r, m }) => (
            <li key={r} className={`rung ${stateOf(r)} ${r === ZONES ? 'max' : ''}`}>
              <span className="rung-label">{r === ZONES ? 'THE ABYSS' : `${r * ZONE_DEPTH} M`}</span>
              <span className="rung-mult">{formatMultiplier(m)}</span>
              <span className="rung-pay">{formatMoney(roundMoney(stake * m), currency)}</span>
            </li>
          ))}
      </ol>
      <p className="ladder-foot">RTP {(RTP * 100).toFixed(2)}% · Provably fair</p>
    </aside>
  );
}
