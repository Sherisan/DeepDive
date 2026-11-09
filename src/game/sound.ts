/** Tiny Web Audio synth, so the game has sound without needing audio assets. */

const MUTE_KEY = 'dive.muted';
let ctx: AudioContext | null = null;
let muted = localStorage.getItem(MUTE_KEY) === '1';

function audio(): AudioContext | null {
  if (muted) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
}

function tone(freq: number, dur: number, { type = 'sine', gain = 0.15, delay = 0, slideTo }: ToneOpts = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, { gain = 0.3, filter = 'highpass' as BiquadFilterType, freq = 2000, delay = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

/** A rising bubble: a quick upward-sliding blip. */
const bubble = (delay = 0, base = 500) => tone(base + Math.random() * 300, 0.09, { gain: 0.08, slideTo: base * 2.4, delay });

export const sound = {
  hover: () => bubble(0, 900),
  /** Splash in at the surface. */
  splash: () => {
    noise(0.5, { gain: 0.35, filter: 'lowpass', freq: 1400 });
    for (let i = 0; i < 6; i++) bubble(0.15 + i * 0.06, 300);
  },
  /** Swimming into a cave: a trail of bubbles. */
  swim: () => {
    for (let i = 0; i < 5; i++) bubble(i * 0.08);
  },
  /** Safe cave: a pearl chime. */
  pearl: () => {
    tone(1047, 0.25, { type: 'triangle', gain: 0.1 });
    tone(1568, 0.35, { type: 'triangle', gain: 0.08, delay: 0.08 });
  },
  /** Descending to the next zone: a low whoosh. */
  descend: () => noise(0.6, { gain: 0.12, filter: 'lowpass', freq: 400 }),
  /** Shark: a heavy thud and a falling growl. */
  chomp: () => {
    noise(0.12, { gain: 0.7, filter: 'lowpass', freq: 900 });
    tone(90, 0.9, { type: 'sawtooth', gain: 0.18, slideTo: 35 });
    tone(55, 1.2, { gain: 0.4, slideTo: 30, delay: 0.05 });
  },
  /** Surfacing with the loot. */
  surface: () => {
    for (let i = 0; i < 8; i++) bubble(i * 0.05, 400 + i * 60);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.11, delay: 0.3 + i * 0.07 }));
  },
  /** Reaching the abyss: the treasure chest. */
  abyss: () => {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.12, delay: i * 0.08 }));
    tone(1568, 0.8, { gain: 0.08, delay: 0.5 });
  },
  isMuted: () => muted,
  setMuted(next: boolean) {
    muted = next;
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  },
};
