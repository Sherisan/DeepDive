import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BetPanel } from './components/BetPanel';
import { Gauges } from './components/Gauges';
import { HistoryModal } from './components/HistoryModal';
import { Hud } from './components/Hud';
import { Ladder } from './components/Ladder';
import { Ocean } from './components/Ocean';
import { ResultOverlay } from './components/ResultOverlay';
import { RulesModal } from './components/RulesModal';
import { createLocalEngine } from './game/engine';
import { createHttpEngine } from './game/httpEngine';
import { CAVES } from './game/math';
import { sound } from './game/sound';
import { useGame } from './game/useGame';
import { webglAvailable } from './scene/support';

// The 3D ocean fills the screen behind the HUD and loads on demand (three.js is most of its size). Without
// WebGL2 (or if it fails to start) the game uses the 2D ocean in a frame instead.
const OceanGL = lazy(() => import('./components/OceanGL').then((m) => ({ default: m.OceanGL })));

// The game API by default; ?demo (or VITE_DEMO=1) plays offline against the in-browser engine with a demo wallet.
const demo = import.meta.env.VITE_DEMO === '1' || new URLSearchParams(window.location.search).has('demo');
const engine = demo ? createLocalEngine() : createHttpEngine();

type ModalKind = 'rules' | 'history' | 'fairness' | null;

export default function App() {
  const game = useGame(engine);
  const { snap, round, phase, busy, swimming, actions } = game;
  const [amount, setAmount] = useState(5);
  const [modal, setModal] = useState<ModalKind>(null);
  const [muted, setMuted] = useState(sound.isMuted());
  const [use3d, setUse3d] = useState(webglAvailable);
  const stageRef = useRef<HTMLDivElement>(null);

  const live = phase === 'live';
  const interactive = live && !busy;
  const currency = snap?.currency ?? 'ZAR';

  // Restart the shake animation on every shark attack.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || game.biteKey === 0) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }, [game.biteKey]);

  // Keyboard: 1–3 cave, Space dive / surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || (e.target as HTMLElement).tagName === 'INPUT') return;
      const n = Number(e.key);
      if (live && n >= 1 && n <= CAVES) actions.pick(n - 1);
      else if (e.code === 'Space') {
        e.preventDefault();
        if (live) {
          if (round!.rung > 0) actions.cashOut();
        } else actions.bet(amount);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, live, round, amount, actions]);

  const toggleSound = () => {
    sound.setMuted(!muted);
    setMuted(!muted);
  };

  return (
    <div className={`game-root${use3d ? ' is-3d' : ''}`}>
      {use3d && (
        <div className="ocean-bg">
          <Suspense fallback={null}>
            <OceanGL round={round} swimming={swimming} interactive={interactive} onPick={actions.pick} focus={stageRef} onFail={() => setUse3d(false)} />
          </Suspense>
        </div>
      )}
      <Hud
        balance={snap?.balance ?? 0}
        currency={currency}
        muted={muted}
        onToggleSound={toggleSound}
        onRules={() => setModal('rules')}
        onHistory={() => setModal('history')}
        onFairness={() => setModal('fairness')}
      />

      <main className="stage" ref={stageRef}>
        <div className="ocean-frame">
          {!use3d && <Ocean round={round} swimming={swimming} interactive={interactive} onPick={actions.pick} />}
          <Gauges round={round} />
          {live && round!.rung === 0 && swimming === null && <div className="hint">Pick a cave to swim into</div>}
          <ResultOverlay round={round} currency={currency} visible={game.showResult} onClose={actions.dismissResult} />
        </div>
      </main>

      <Ladder round={round} previewBet={amount} currency={currency} />

      <BetPanel
        phase={phase}
        round={round}
        amount={amount}
        setAmount={setAmount}
        balance={snap?.balance ?? 0}
        currency={currency}
        limits={snap?.limits ?? { minBet: 1, maxBet: 200 }}
        busy={busy}
        onBet={() => actions.bet(amount)}
        onCashOut={actions.cashOut}
        onRefill={actions.refill}
      />

      {game.biteKey > 0 && <div key={game.biteKey} className="bite-flash" aria-hidden />}

      {game.error && (
        <div className="toast" role="alert">
          {game.error}
        </div>
      )}

      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}
      {(modal === 'history' || modal === 'fairness') && snap && (
        <HistoryModal
          snap={snap}
          initialTab={modal}
          canChangeSeed={!live}
          onSetClientSeed={actions.setClientSeed}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
