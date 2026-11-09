import { useState } from 'react';
import type { RoundView } from '../game/engine';
import { CAVES, payoutFor, roundMoney } from '../game/math';
import { currencySymbol, formatMoney } from '../game/money';
import type { Phase } from '../game/useGame';

export function BetPanel({
  phase,
  round,
  amount,
  setAmount,
  balance,
  currency,
  limits,
  busy,
  onBet,
  onCashOut,
  onRefill,
}: {
  phase: Phase;
  round: RoundView | null;
  amount: number;
  setAmount: (n: number) => void;
  balance: number;
  currency: string;
  limits: { minBet: number; maxBet: number };
  busy: boolean;
  onBet: () => void;
  onCashOut: () => void;
  onRefill?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const live = phase === 'live' && round !== null;
  const clamp = (n: number) => roundMoney(Math.min(limits.maxBet, Math.max(limits.minBet, n || limits.minBet)));

  const commitDraft = () => {
    if (draft !== null) setAmount(clamp(parseFloat(draft)));
    setDraft(null);
  };

  const rung = round?.rung ?? 0;
  const broke = !live && balance < limits.minBet;

  return (
    <section className="panel">
      <div className={`amount-box ${live ? 'locked' : ''}`}>
        <label htmlFor="bet-amount">BET AMOUNT</label>
        <div className="amount-row">
          <button disabled={live} onClick={() => setAmount(clamp(amount - 1))} aria-label="Decrease bet">
            −
          </button>
          <div className="amount-input">
            <span>{currencySymbol(currency)}</span>
            <input
              id="bet-amount"
              inputMode="decimal"
              disabled={live}
              value={draft ?? amount.toFixed(2)}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={commitDraft}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <button disabled={live} onClick={() => setAmount(clamp(amount + 1))} aria-label="Increase bet">
            +
          </button>
        </div>
        <div className="chips">
          <button disabled={live} onClick={() => setAmount(clamp(amount / 2))}>
            ½
          </button>
          <button disabled={live} onClick={() => setAmount(clamp(amount * 2))}>
            ×2
          </button>
          <button disabled={live} onClick={() => setAmount(limits.minBet)}>
            MIN
          </button>
          <button disabled={live} onClick={() => setAmount(clamp(Math.min(limits.maxBet, Math.floor(balance))))}>
            MAX
          </button>
        </div>
      </div>

      {live ? (
        <button className="cta cashout" disabled={busy || rung === 0} onClick={onCashOut}>
          <span className="cta-label">{rung === 0 ? 'PICK A CAVE' : 'SURFACE'}</span>
          <span className="cta-sub">{rung === 0 ? `1 in ${CAVES} hides a shark` : `Cash out ${formatMoney(payoutFor(round.bet, rung), currency)}`}</span>
        </button>
      ) : broke && onRefill ? (
        <button className="cta bet" onClick={onRefill}>
          <span className="cta-label">REFILL</span>
          <span className="cta-sub">Demo balance</span>
        </button>
      ) : (
        <button className="cta bet" disabled={busy || phase === 'loading' || amount > balance} onClick={onBet}>
          <span className="cta-label">DIVE IN</span>
          <span className="cta-sub">BET {formatMoney(amount, currency)}</span>
        </button>
      )}
    </section>
  );
}
