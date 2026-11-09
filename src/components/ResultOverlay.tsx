import type { RoundView } from '../game/engine';
import { ZONE_DEPTH, multiplierFor } from '../game/math';
import { formatMoney, formatMultiplier } from '../game/money';

export function ResultOverlay({
  round,
  currency,
  visible,
  onClose,
}: {
  round: RoundView | null;
  currency: string;
  visible: boolean;
  onClose: () => void;
}) {
  if (!visible || !round || round.status === 'live' || !round.sharks) return null;

  const view = {
    surfaced: {
      title: 'SURFACED',
      amount: `+${formatMoney(round.payout, currency)}`,
      meta: `Back from ${round.rung * ZONE_DEPTH} m at ${formatMultiplier(multiplierFor(round.rung))}`,
    },
    abyss: { title: 'TREASURE!', amount: `+${formatMoney(round.payout, currency)}`, meta: `You reached the abyss · ${formatMultiplier(multiplierFor(round.rung))}` },
    bitten: { title: 'SHARK!', amount: `−${formatMoney(round.bet, currency)}`, meta: `Caught at ${round.picks.length * ZONE_DEPTH} m` },
  }[round.status];

  return (
    <div className={`result result-${round.status}`} onClick={onClose} role="status">
      <div className="result-card">
        <div className="result-stripe" />
        <div className="result-title">{view.title}</div>
        <div className="result-amount">{view.amount}</div>
        <div className="result-meta">{view.meta}</div>
        <small>Tap to continue</small>
      </div>
    </div>
  );
}
