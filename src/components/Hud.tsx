import { formatMoney } from '../game/money';
import { ClockIcon, HelpIcon, ShieldIcon, SoundIcon } from './Icons';

export function Logo() {
  return (
    <div className="logo" aria-label="Deep Dive">
      <span className="logo-deep">DEEP</span>
      <span className="logo-dive">
        DIVE
        <svg className="logo-bubbles" viewBox="0 0 20 28" aria-hidden>
          <circle cx="6" cy="22" r="4" />
          <circle cx="13" cy="12" r="3" />
          <circle cx="8" cy="4" r="2" />
        </svg>
      </span>
    </div>
  );
}

export function Hud({
  balance,
  currency,
  muted,
  onToggleSound,
  onRules,
  onHistory,
  onFairness,
}: {
  balance: number;
  currency: string;
  muted: boolean;
  onToggleSound: () => void;
  onRules: () => void;
  onHistory: () => void;
  onFairness: () => void;
}) {
  return (
    <header className="hud">
      <Logo />
      <div className="hud-right">
        <div className="balance">
          <span className="balance-label">BALANCE</span>
          <span className="balance-value">{formatMoney(balance, currency)}</span>
        </div>
        <button className="icon-btn" onClick={onFairness} aria-label="Provably fair" title="Provably fair">
          <ShieldIcon />
        </button>
        <button className="icon-btn" onClick={onHistory} aria-label="Bet history" title="Bet history">
          <ClockIcon />
        </button>
        <button className="icon-btn" onClick={onRules} aria-label="How to play" title="How to play">
          <HelpIcon />
        </button>
        <button className="icon-btn" onClick={onToggleSound} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
          <SoundIcon muted={muted} />
        </button>
      </div>
    </header>
  );
}
