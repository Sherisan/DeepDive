import type { RoundView } from '../game/engine';
import { ZONES, ZONE_DEPTH, multiplierFor } from '../game/math';
import { formatMultiplier } from '../game/money';
import { sound } from '../game/sound';

// ── World geometry (SVG user units). The view is 600 × 640; the world is taller and the camera follows the diver. ──
const W = 600;
const VIEW_H = 640;
const WATERLINE = 96;
const SURFACE_H = 210;
const ZONE_H = 210;
const SEABED_H = 190;
const WORLD_H = SURFACE_H + ZONES * ZONE_H + SEABED_H;
const CAVE_X = [125, 300, 475];
/** The far background scrolls at this fraction of the camera's speed, for depth. */
const PARALLAX = 0.45;

const zoneTop = (k: number) => SURFACE_H + k * ZONE_H;
const caveY = (k: number) => zoneTop(k) + 140;

/** Deterministic pseudo-random, so the scenery is the same on every render. */
const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const SNOW = Array.from({ length: 160 }, (_, i) => ({
  x: rand(i) * W,
  y: SURFACE_H - 90 + rand(i + 500) * (WORLD_H - SURFACE_H),
  r: 0.5 + rand(i + 900) * 1.5,
  d: rand(i + 1300) * 6,
}));

// ── Rock shelves ─────────────────────────────────────────────────────────

/** Top edge of zone k's shelf: 13 points, every 50 units. */
const shelfTop = (k: number) => Array.from({ length: 13 }, (_, i) => caveY(k) - 64 + (rand(k * 13 + i) - 0.5) * 24);

/** Height of the shelf's top edge at x. */
function shelfY(k: number, x: number) {
  const top = shelfTop(k);
  const i = Math.min(11, Math.floor(x / 50));
  const t = (x - i * 50) / 50;
  return top[i] + (top[i + 1] - top[i]) * t;
}

function shelfPath(k: number, lift = 0) {
  const pts = shelfTop(k).map((y, i) => `${i * 50} ${y - lift}`);
  return `M0 ${caveY(k) + 108} L${pts.join(' L')} L${W} ${caveY(k) + 108} Z`;
}

/** The lit upper edge of a shelf (a stroke along the contour). */
function shelfEdge(k: number) {
  return `M${shelfTop(k).map((y, i) => `${i * 50} ${y}`).join(' L')}`;
}

/** Spots on each shelf between the caves where life grows. */
const DECOR_X = [44, 212, 388, 556];

function Coral({ x, y, hue, seed }: { x: number; y: number; hue: string; seed: number }) {
  const s = 0.8 + rand(seed) * 0.5;
  return (
    <g className="coral" transform={`translate(${x} ${y}) scale(${s})`} style={{ animationDelay: `${-rand(seed + 1) * 4}s` }}>
      <path d="M0 2 C-2 -12 -12 -16 -14 -32 M0 2 C2 -16 7 -24 4 -44 M2 -16 C9 -20 16 -24 18 -36 M-6 -14 C-14 -18 -20 -22 -22 -30" stroke={hue} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      {[
        [-14, -32],
        [4, -44],
        [18, -36],
        [-22, -30],
      ].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r={3.4} fill={hue} />
      ))}
    </g>
  );
}

function Sponges({ x, y, seed }: { x: number; y: number; seed: number }) {
  const tubes = [
    [-12, 26, 9],
    [0, 38, 11],
    [13, 22, 8],
  ];
  return (
    <g className="sponges" transform={`translate(${x} ${y}) scale(${0.8 + rand(seed) * 0.4})`}>
      {tubes.map(([dx, h, w]) => (
        <g key={dx}>
          <rect x={dx - w / 2} y={-h} width={w} height={h + 4} rx={w / 2} fill="url(#sponge)" />
          <ellipse cx={dx} cy={-h + 2} rx={w / 2 - 1.5} ry={2.5} fill="#2a0d33" />
        </g>
      ))}
    </g>
  );
}

function Anemone({ x, y, hue, seed }: { x: number; y: number; hue: string; seed: number }) {
  return (
    <g className="anemone" transform={`translate(${x} ${y})`} style={{ animationDelay: `${-rand(seed) * 3}s` }}>
      <ellipse rx={12} ry={6} fill="#1d2a33" />
      <g filter="url(#glow)">
        {Array.from({ length: 9 }, (_, i) => {
          const a = -150 + i * 15;
          const r = (a * Math.PI) / 180;
          const ex = Math.cos(r) * 24;
          const ey = Math.sin(r) * 26;
          return <path key={i} d={`M0 -2 Q${ex * 0.4} ${ey * 0.8} ${ex} ${ey}`} stroke={hue} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.9} />;
        })}
      </g>
    </g>
  );
}

function Decor({ k }: { k: number }) {
  return (
    <>
      {DECOR_X.map((x, i) => {
        const seed = k * 10 + i;
        if (rand(seed + 77) < 0.25) return null;
        const y = shelfY(k, x) + 3;
        if (k < 3) return <Coral key={i} x={x} y={y} seed={seed} hue={['#ff7a8a', '#ffa94d', '#ff5fa2'][(k + i) % 3]} />;
        if (k < 6) return <Sponges key={i} x={x} y={y} seed={seed} />;
        return <Anemone key={i} x={x} y={y} seed={seed} hue={i % 2 ? '#7cf3ff' : '#ff7ad9'} />;
      })}
    </>
  );
}

// ── Caves ────────────────────────────────────────────────────────────────

/** An arched cave mouth with a flat floor, centred on (0, 0). */
const ARCH = 'M-50 30 C-56 -6 -36 -44 0 -44 C36 -44 56 -6 50 30 Q0 38 -50 30 Z';
const ARCH_INNER = 'M-41 28 C-46 -2 -30 -35 0 -35 C30 -35 46 -2 41 28 Q0 34 -41 28 Z';

type CaveState = 'dark' | 'open' | 'picked' | 'bite' | 'empty' | 'lurk';

function Cave({
  k,
  c,
  state,
  clickable,
  target,
  onPick,
}: {
  k: number;
  c: number;
  state: CaveState;
  clickable: boolean;
  target: boolean;
  onPick: (c: number) => void;
}) {
  const seed = k * 3 + c;
  return (
    <g
      className={`cave ${state} ${clickable ? 'clickable' : ''} ${target ? 'target' : ''}`}
      transform={`translate(${CAVE_X[c]} ${caveY(k)})`}
      onClick={clickable ? () => onPick(c) : undefined}
      onMouseEnter={clickable ? sound.hover : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Swim into cave ${c + 1}` : undefined}
    >
      <ellipse className="cave-glow" rx={80} ry={66} cy={-4} fill="url(#caveGlow)" />
      <path className="cave-rim" d={ARCH} />
      <path className="cave-mouth" d={ARCH_INNER} fill="url(#caveDepth)" />
      {/* Stalactites hanging inside the mouth */}
      <path
        className="stalactites"
        d={`M-26 -28 l4 ${10 + rand(seed) * 8} l4 ${-10 - rand(seed) * 8} M-6 -34 l3 ${8 + rand(seed + 1) * 9} l3 ${-8 - rand(seed + 1) * 9} M14 -31 l4 ${9 + rand(seed + 2) * 8} l4 ${-9 - rand(seed + 2) * 8}`}
      />
      <path className="cave-lip" d="M-46 -2 C-44 -30 -26 -42 0 -42 C26 -42 44 -30 46 -2" />
      {state === 'open' && (
        <g className="plankton">
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={(rand(seed * 5 + i) - 0.5) * 60} cy={(rand(seed * 7 + i) - 0.6) * 40} r={1.6} style={{ animationDelay: `${i * 0.37}s` }} />
          ))}
        </g>
      )}
      {state === 'picked' && (
        <g transform="translate(0 16)">
          <Pearl />
        </g>
      )}
      {state === 'lurk' && (
        <g className="lurk-eyes">
          <ellipse cx={-11} cy={6} rx={4.5} ry={3} />
          <ellipse cx={11} cy={6} rx={4.5} ry={3} />
        </g>
      )}
      {clickable && (
        <g className="cave-tag" transform="translate(0 -60)">
          <circle r={11} />
          <text y={4.5}>{c + 1}</text>
        </g>
      )}
    </g>
  );
}

function Pearl() {
  return (
    <g className="pearl">
      <ellipse cy={10} rx={26} ry={6} fill="rgba(255, 220, 160, 0.25)" filter="url(#glow)" />
      <path d="M-24 6 Q-12 -24 0 -22 Q12 -24 24 6 Z" fill="url(#shellTop)" stroke="#7a4a22" strokeWidth={1.4} />
      <path d="M-16 4 L-8 -16 M0 4 V-20 M16 4 L8 -16" stroke="#9b6534" strokeWidth={1.2} opacity={0.7} />
      <path d="M-24 6 Q0 22 24 6 Z" fill="#b97d45" stroke="#7a4a22" strokeWidth={1.4} />
      <circle cy={4} r={7.5} fill="url(#pearlFill)" className="pearl-glow" />
      <circle cx={-2.5} cy={1.5} r={2} fill="#fff" opacity={0.9} />
    </g>
  );
}

// ── Creatures ────────────────────────────────────────────────────────────

function Diver({ x, y, state }: { x: number; y: number; state: string }) {
  return (
    <g className={`diver ${state}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <g className="diver-body" transform="scale(1.3)">
        <g className="bubbles">
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx={32} cy={-12} r={3.2 - i * 0.6} style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
        </g>
        {/* Legs and fins, kicking */}
        <g className="fin fin-a">
          <path d="M-18 4 L-44 8" stroke="#0f171d" strokeWidth={8} strokeLinecap="round" />
          <path d="M-40 4 L-62 -1 Q-67 6 -63 12 L-40 11 Z" fill="url(#finFill)" />
        </g>
        <g className="fin fin-b">
          <path d="M-18 -2 L-44 -6" stroke="#18232b" strokeWidth={8} strokeLinecap="round" />
          <path d="M-40 -9 L-62 -16 Q-67 -9 -63 -3 L-40 -2 Z" fill="url(#finFill)" opacity={0.85} />
        </g>
        {/* Tank and hose */}
        <rect x={-24} y={-21} width={38} height={12} rx={6} fill="url(#tankFill)" stroke="#6b4c0c" strokeWidth={1.2} />
        <rect x={12} y={-19} width={5} height={8} rx={1.5} fill="#8b939c" />
        <path d="M16 -16 Q30 -20 30 -6" stroke="#2a3640" strokeWidth={2.5} fill="none" />
        {/* Body */}
        <ellipse cx={-2} cy={0} rx={24} ry={11} fill="url(#suitFill)" />
        <path d="M-20 3 Q-2 8 18 2" stroke="#39d0ff" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        {/* Arm and torch */}
        <path d="M10 4 Q24 12 36 12" stroke="#16212a" strokeWidth={6} fill="none" strokeLinecap="round" />
        <rect x={34} y={8} width={11} height={7} rx={2} fill="#3b4650" />
        <circle cx={46} cy={11.5} r={3.2} fill="#fff6d0" className="torch" />
        {/* Head and mask */}
        <circle cx={26} cy={-4} r={10} fill="#141d24" />
        <rect x={27} y={-10} width={12} height={9} rx={3.5} fill="url(#glass)" stroke="#0b1418" strokeWidth={1.4} />
        <path d="M30 -8.5 l3 0" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
      </g>
    </g>
  );
}

function Shark({ x, y }: { x: number; y: number }) {
  return (
    <g className="shark" transform={`translate(${x} ${y})`}>
      <g className="shark-body">
        <path d="M58 -4 L96 -34 L90 -2 L98 30 Z" fill="url(#sharkTop)" stroke="#141b21" strokeWidth={2} />
        <path d="M-6 -24 L14 -60 L28 -20 Z" fill="url(#sharkTop)" stroke="#141b21" strokeWidth={2} />
        <path d="M-84 6 C-62 -30 22 -34 66 -6 C30 30 -50 34 -84 6 Z" fill="url(#sharkTop)" stroke="#141b21" strokeWidth={2} />
        <path d="M-80 10 C-52 28 18 28 58 6 C20 20 -46 22 -80 10 Z" fill="url(#sharkBelly)" />
        <path d="M-6 14 L10 34 L18 12 Z" fill="#46535e" stroke="#141b21" strokeWidth={1.5} />
        {/* Open jaws */}
        <path d="M-86 4 L-58 -2 L-60 18 Z" fill="#3a0a12" />
        <path d="M-82 4 l4 5 l4 -6 l4 6 l4 -6 l4 6 l4 -6 M-80 14 l4 -5 l4 5 l4 -5 l4 5" stroke="#fff" strokeWidth={1.8} fill="none" />
        <circle cx={-54} cy={-8} r={4.5} fill="#0a0d10" />
        <circle cx={-54} cy={-8} r={2} fill="#ff3b4e" className="shark-eye" />
        <path d="M-30 -10 q3 9 0 18 M-23 -10 q3 9 0 18 M-16 -10 q3 9 0 18" stroke="#2c363f" strokeWidth={2} fill="none" />
      </g>
    </g>
  );
}

function Jelly({ x, y, hue, seed }: { x: number; y: number; hue: string; seed: number }) {
  return (
    <g className="jelly" transform={`translate(${x} ${y})`} style={{ animationDelay: `${-rand(seed) * 5}s` }}>
      <g filter="url(#glow)">
        <path d="M-16 0 Q-16 -22 0 -22 Q16 -22 16 0 Q8 4 0 0 Q-8 4 -16 0 Z" fill={hue} opacity={0.55} />
        {[-10, -4, 2, 8].map((dx, i) => (
          <path key={dx} className="tentacle" d={`M${dx} 2 q${i % 2 ? 6 : -6} 14 0 28 q${i % 2 ? -6 : 6} 12 0 22`} stroke={hue} strokeWidth={1.4} fill="none" opacity={0.7} />
        ))}
      </g>
    </g>
  );
}

function Angler({ x, y }: { x: number; y: number }) {
  return (
    <g className="angler" transform={`translate(${x} ${y})`}>
      <path d="M-26 0 Q-20 -18 6 -14 Q20 -10 22 0 Q20 12 6 14 Q-20 18 -26 0 Z M-26 0 L-40 -10 L-38 10 Z" fill="#0a1219" opacity={0.9} />
      <path d="M8 -14 Q18 -34 34 -26" stroke="#0a1219" strokeWidth={2} fill="none" />
      <circle cx={34} cy={-26} r={3.5} fill="#bdf7ff" className="lure" filter="url(#glow)" />
      <path d="M14 4 l4 3 l3 -3 l3 3" stroke="#9aa8b3" strokeWidth={1} fill="none" />
    </g>
  );
}

// ── The scene ────────────────────────────────────────────────────────────

export function Ocean({
  round,
  swimming,
  interactive,
  onPick,
}: {
  round: RoundView | null;
  swimming: number | null;
  interactive: boolean;
  onPick: (cave: number) => void;
}) {
  const status = round?.status ?? 'idle';
  const ended = !!round && round.status !== 'live';
  const zone = round?.picks.length ?? 0;
  const rung = round?.rung ?? 0;

  // Where the diver is.
  let dx = W / 2;
  let dy = WATERLINE + 18;
  let dState = 'idle';
  if (round) {
    if (status === 'live') {
      if (swimming !== null) {
        dx = CAVE_X[swimming];
        dy = caveY(zone) - 78;
        dState = 'swim';
      } else {
        dy = zoneTop(zone) + 34;
        dState = 'hover';
      }
    } else if (status === 'bitten') {
      dx = CAVE_X[round.picks[round.picks.length - 1]];
      dy = caveY(round.picks.length - 1) - 82;
      dState = 'bitten';
    } else if (status === 'abyss') {
      dx = W / 2 - 140;
      dy = WORLD_H - SEABED_H + 30;
      dState = 'abyss';
    } else {
      dState = 'surfaced';
    }
  }

  // The camera follows the diver; when they surface it rises after them.
  const camTarget = status === 'surfaced' ? 0 : dy - 300;
  const camY = Math.max(0, Math.min(WORLD_H - VIEW_H, camTarget));

  const caveState = (k: number, c: number): CaveState => {
    if (!round) return 'dark';
    const picked = round.picks[k] === c;
    if (status === 'bitten' && k === round.picks.length - 1 && picked) return 'bite';
    if (k < rung && picked) return 'picked';
    if (ended && round.sharks?.[k] === c) return 'lurk';
    if (status === 'live' && k === zone) return 'open';
    return k < rung || ended ? 'empty' : 'dark';
  };

  return (
    <svg className={`ocean status-${status}`} viewBox={`0 0 ${W} ${VIEW_H}`} aria-label={`Ocean, ${rung} of ${ZONES} zones cleared`}>
      <defs>
        <linearGradient id="water" x1="0" y1={WATERLINE} x2="0" y2={WORLD_H} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#25c3df" />
          <stop offset="0.08" stopColor="#0f8bb0" />
          <stop offset="0.25" stopColor="#095a80" />
          <stop offset="0.5" stopColor="#053354" />
          <stop offset="0.78" stopColor="#031a30" />
          <stop offset="1" stopColor="#010810" />
        </linearGradient>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a62" />
          <stop offset="0.6" stopColor="#ffc98a" />
          <stop offset="1" stopColor="#ffe7c2" />
        </linearGradient>
        <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b5d6b" />
          <stop offset="0.3" stopColor="#223b47" />
          <stop offset="0.68" stopColor="#0b1820" />
          <stop offset="1" stopColor="#0b1820" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="rockBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a3340" />
          <stop offset="0.65" stopColor="#0a1a24" />
          <stop offset="1" stopColor="#0a1a24" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="caveDepth" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.65" stopColor="#020b12" />
          <stop offset="1" stopColor="#0d2531" />
        </radialGradient>
        <radialGradient id="caveGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.5" stopColor="#39d0ff" stopOpacity="0" />
          <stop offset="0.78" stopColor="#39d0ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#39d0ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6f8ff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#d6f8ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="torchBeam" cx="0" cy="0.5" r="1">
          <stop offset="0" stopColor="#fff4c8" stopOpacity="0.38" />
          <stop offset="1" stopColor="#fff4c8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe48a" />
          <stop offset="1" stopColor="#a86c0c" />
        </linearGradient>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a4a22" />
          <stop offset="1" stopColor="#3f230d" />
        </linearGradient>
        <linearGradient id="sponge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b2470" />
          <stop offset="0.5" stopColor="#a54fc2" />
          <stop offset="1" stopColor="#4a1c5c" />
        </linearGradient>
        <linearGradient id="suitFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b3a46" />
          <stop offset="1" stopColor="#0d151b" />
        </linearGradient>
        <linearGradient id="tankFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe17a" />
          <stop offset="1" stopColor="#d99a1a" />
        </linearGradient>
        <linearGradient id="finFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff7a2e" />
          <stop offset="1" stopColor="#ffc04d" />
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c6f6ff" />
          <stop offset="1" stopColor="#2a9fc4" />
        </linearGradient>
        <linearGradient id="sharkTop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7b8a97" />
          <stop offset="1" stopColor="#465360" />
        </linearGradient>
        <linearGradient id="sharkBelly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4ecf2" />
          <stop offset="1" stopColor="#aebbc6" />
        </linearGradient>
        <radialGradient id="shellTop" cx="0.5" cy="0.9" r="0.9">
          <stop offset="0" stopColor="#f1c18e" />
          <stop offset="1" stopColor="#b97d45" />
        </radialGradient>
        <radialGradient id="pearlFill" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f3ece2" />
          <stop offset="1" stopColor="#d8cdbb" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Speckled rock texture laid over the shelves */}
        <filter id="rockTex" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035 0.07" numOctaves="4" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.02  0 0 0 0 0.06  0 0 0 0 0.08  0 0 0 1.6 -0.55" result="speckle" />
          <feComposite in="speckle" in2="SourceAlpha" operator="in" result="tex" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="tex" />
          </feMerge>
        </filter>
        {/* Rippling light on the water near the surface */}
        <filter id="caustics" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.018 0.03" numOctaves="2" seed="4" result="t" />
          <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.97  0 0 0 0 1  0 0 0 -3.2 1.15" />
        </filter>
        <linearGradient id="causticFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="causticMask">
          <rect y={WATERLINE} width={W} height={420} fill="url(#causticFade)" />
        </mask>
      </defs>

      <rect width={W} height={VIEW_H} fill="#010810" />

      {/* Far background: pillars, a whale, slower than the camera */}
      <g className="far" style={{ transform: `translateY(${-camY * PARALLAX}px)` }}>
        <rect y={WATERLINE} width={W} height={WORLD_H * PARALLAX + VIEW_H} fill="url(#water)" />
        {[60, 230, 420, 560].map((x, i) => (
          <path
            key={x}
            d={`M${x - 40} ${WORLD_H * PARALLAX + VIEW_H} L${x - 26 + rand(i) * 10} ${380 + rand(i + 4) * 200} Q${x} ${320 + rand(i + 8) * 120} ${x + 24} ${400 + rand(i + 12) * 160} L${x + 44} ${WORLD_H * PARALLAX + VIEW_H} Z`}
            fill="#0a3a52"
            opacity={0.35}
          />
        ))}
        <g className="whale" transform="translate(0 300)">
          <path d="M0 0 Q30 -26 90 -20 Q140 -14 160 0 Q140 14 90 18 Q30 22 0 0 Z M160 0 L190 -16 L184 0 L190 16 Z" fill="#0b4a66" opacity={0.55} />
        </g>
      </g>

      <g className="world" style={{ transform: `translateY(${-camY}px)` }}>
        {/* Sky, boat and the waterline */}
        <rect width={W} height={WATERLINE + 10} fill="url(#sky)" />
        <circle cx={480} cy={50} r={28} fill="#fff4d6" opacity={0.95} />
        <path d="M0 74 Q60 60 120 72 T240 70 T380 74 T520 68 T600 72 V106 H0 Z" fill="#e89a6a" opacity={0.35} />
        <g className="boat" transform={`translate(${W / 2 - 10} ${WATERLINE - 6})`}>
          <path d="M-74 -8 H74 L56 18 H-56 Z" fill="#c2412d" stroke="#5a1a10" strokeWidth={2} />
          <path d="M-70 -2 H70" stroke="#f1ece2" strokeWidth={3} />
          <rect x={-22} y={-36} width={46} height={28} rx={3} fill="#f1ece2" stroke="#7b7266" strokeWidth={2} />
          <rect x={-14} y={-30} width={12} height={10} rx={2} fill="#7fd6ee" />
          <rect x={4} y={-30} width={12} height={10} rx={2} fill="#7fd6ee" />
          <path d="M44 -8 V-50" stroke="#5a4636" strokeWidth={3} />
          <path d="M46 -48 L72 -41 L46 -34 Z" fill="#39d0ff" />
          <path d="M-60 -8 Q-70 8 -40 30" stroke="#d8d2c4" strokeWidth={1.5} fill="none" />
        </g>
        <path
          d={`M0 ${WATERLINE} ${Array.from({ length: 13 }, (_, i) => `Q${i * 50 + 25} ${WATERLINE + (i % 2 ? 7 : -7)} ${(i + 1) * 50} ${WATERLINE}`).join(' ')} V${WATERLINE + 30} H0 Z`}
          fill="rgba(37, 195, 223, 0.6)"
          className="wave"
        />
        <path className="wave wave-line" d={`M0 ${WATERLINE} ${Array.from({ length: 13 }, (_, i) => `Q${i * 50 + 25} ${WATERLINE + (i % 2 ? 7 : -7)} ${(i + 1) * 50} ${WATERLINE}`).join(' ')}`} fill="none" stroke="#e8fbff" strokeWidth={3} />

        {/* Caustics and sun rays near the surface */}
        <g mask="url(#causticMask)" className="caustics">
          <rect x={-60} y={WATERLINE} width={W + 120} height={420} filter="url(#caustics)" opacity={0.3} />
        </g>
        <g className="rays">
          {[70, 200, 330, 460].map((x, i) => (
            <path key={x} d={`M${x} ${WATERLINE} L${x + 44} ${WATERLINE} L${x + 140} ${WATERLINE + 560} L${x - 30} ${WATERLINE + 560} Z`} fill="url(#ray)" style={{ animationDelay: `${i * 1.3}s` }} />
          ))}
        </g>

        {/* Marine snow */}
        <g className="snow">
          {SNOW.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.r} style={{ animationDelay: `${-p.d}s` }} />
          ))}
        </g>

        {/* Shallow-water fish, deep-water jellies and an anglerfish */}
        <g className="fishes">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path
              key={i}
              className="fish"
              d={`M0 ${zoneTop(i % 3) + 40 + i * 18} q14 -10 28 0 l10 -7 v14 l-10 -7 q-14 10 -28 0 z`}
              fill={['#ffb347', '#6fe3ff', '#ff8aa8'][i % 3]}
              style={{ animationDelay: `${-i * 3.5}s`, animationDuration: `${14 + i * 2.5}s` }}
            />
          ))}
        </g>
        <Jelly x={60} y={zoneTop(3) + 50} hue="#ff7ad9" seed={1} />
        <Jelly x={545} y={zoneTop(4) + 46} hue="#7cf3ff" seed={2} />
        <Jelly x={70} y={zoneTop(5) + 42} hue="#b98aff" seed={3} />
        <Angler x={520} y={zoneTop(6) + 44} />
        <Angler x={90} y={zoneTop(7) + 40} />

        {/* Zones */}
        {Array.from({ length: ZONES }, (_, k) => {
          const active = status === 'live' && k === zone;
          return (
            <g key={k} className={`zone ${active ? 'active' : ''} ${k < rung ? 'cleared' : ''}`}>
              <g className="zone-tag" transform={`translate(${W - 14} ${zoneTop(k) + 24})`}>
                <text className="mult-label">{formatMultiplier(multiplierFor(k + 1))}</text>
                <text className="depth-label zone-depth" y={18}>
                  {(k + 1) * ZONE_DEPTH} m
                </text>
              </g>
              <path d={shelfPath(k, 14)} fill="url(#rockBack)" transform="translate(18 0)" opacity={0.9} />
              <g style={{ filter: `brightness(${1 - k * 0.07})` }}>
                <path d={shelfPath(k)} fill="url(#rock)" filter="url(#rockTex)" />
              </g>
              <path d={shelfEdge(k)} className="shelf-edge" />
              <Decor k={k} />
              {CAVE_X.map((_, c) => (
                <Cave
                  key={c}
                  k={k}
                  c={c}
                  state={caveState(k, c)}
                  clickable={interactive && active && swimming === null}
                  target={active && swimming === c}
                  onPick={onPick}
                />
              ))}
            </g>
          );
        })}

        {/* Seabed: sand, a lost anchor and the treasure */}
        <path d={`M0 ${WORLD_H - 84} Q150 ${WORLD_H - 116} 300 ${WORLD_H - 92} T${W} ${WORLD_H - 98} V${WORLD_H} H0 Z`} fill="#2a3b3a" />
        <path d={`M0 ${WORLD_H - 60} Q200 ${WORLD_H - 80} 380 ${WORLD_H - 64} T${W} ${WORLD_H - 70} V${WORLD_H} H0 Z`} fill="#3a4c48" />
        <g className="anchor" transform={`translate(500 ${WORLD_H - 104}) rotate(-24)`} opacity={0.75}>
          <path d="M0 -50 V20 M-24 6 Q0 34 24 6 M-10 -40 H10" stroke="#55646a" strokeWidth={6} fill="none" strokeLinecap="round" />
          <circle cy={-56} r={7} stroke="#55646a" strokeWidth={4} fill="none" />
        </g>
        <g className={`chest ${status === 'abyss' ? 'open' : ''}`} transform={`translate(${W / 2 + 20} ${WORLD_H - 110})`}>
          <ellipse className="chest-glow" rx={130} ry={70} fill="#ffd56a" opacity={0.15} />
          <g className="coins">
            {[-52, -38, 40, 54, 30].map((cx, i) => (
              <ellipse key={i} cx={cx} cy={22 - (i % 2) * 4} rx={7} ry={3.5} fill="url(#gold)" stroke="#6b4a08" strokeWidth={1} />
            ))}
          </g>
          <rect x={-44} y={-26} width={88} height={46} rx={6} fill="url(#wood)" stroke="#2a1606" strokeWidth={2} />
          <path d="M-44 -10 H44 M-44 8 H44" stroke="#b47b12" strokeWidth={3} />
          <path className="chest-lid" d="M-46 -26 Q0 -64 46 -26 Z" fill="url(#wood)" stroke="#2a1606" strokeWidth={2} />
          <path d="M-40 -30 Q0 -58 40 -30" stroke="#b47b12" strokeWidth={3} fill="none" className="chest-lid-band" />
          <rect x={-7} y={-32} width={14} height={18} rx={2} fill="url(#gold)" stroke="#6b4a08" />
          <g className="chest-light" filter="url(#glow)">
            <path d="M-34 -26 L-60 -90 L60 -90 L34 -26 Z" fill="#ffe08a" opacity={0.35} />
          </g>
        </g>
        <text className="depth-label abyss-label" x={W / 2} y={WORLD_H - 18}>
          THE ABYSS · {ZONES * ZONE_DEPTH} m
        </text>

        {status === 'bitten' && <Shark x={CAVE_X[round!.picks[round!.picks.length - 1]]} y={caveY(round!.picks.length - 1) - 34} />}

        {(status === 'live' || status === 'abyss') && (
          <path
            className="torch-beam"
            d={`M${dx + 58} ${dy + 15} L${dx + 230} ${dy + 70} L${dx + 190} ${dy + 170} Z`}
            fill="url(#torchBeam)"
          />
        )}
        <Diver x={dx} y={dy} state={dState} />
      </g>

      {/* Lens vignette */}
      <rect width={W} height={VIEW_H} fill="url(#vignette)" pointerEvents="none" />
      <defs>
        <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
    </svg>
  );
}
