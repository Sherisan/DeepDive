import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiveApi, Snapshot } from './engine';
import { sound } from './sound';

export type Phase = 'loading' | 'idle' | 'live' | 'ended';

/** Time the diver spends swimming into a cave before the result shows, for suspense. */
const SWIM_SUSPENSE_MS = 650;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useGame(api: DiveApi) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [swimming, setSwimming] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [biteKey, setBiteKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const resultTimer = useRef<number>();

  useEffect(() => {
    api.init().then(setSnap, (e: Error) => setError(e.message));
  }, [api]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3200);
    return () => clearTimeout(t);
  }, [error]);

  const run = useCallback(async (call: () => Promise<Snapshot>, minMs = 0) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      const [next] = await Promise.all([call(), wait(minMs)]);
      setSnap(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /** Sounds and effects for a dive that just ended, then the result card. */
  const finish = useCallback((next: Snapshot) => {
    const status = next.round?.status;
    if (!status || status === 'live') return;
    if (status === 'bitten') {
      sound.chomp();
      setBiteKey((k) => k + 1);
    } else if (status === 'abyss') sound.abyss();
    else sound.surface();
    clearTimeout(resultTimer.current);
    resultTimer.current = window.setTimeout(() => setShowResult(true), status === 'bitten' ? 1300 : status === 'abyss' ? 1400 : 900);
  }, []);

  const bet = useCallback(
    async (amount: number) => {
      clearTimeout(resultTimer.current);
      const next = await run(() => api.bet(amount));
      if (next) {
        setShowResult(false);
        sound.splash();
      }
    },
    [api, run],
  );

  const pick = useCallback(
    async (cave: number) => {
      if (busyRef.current) return;
      setSwimming(cave);
      sound.swim();
      const next = await run(() => api.pick(cave), SWIM_SUSPENSE_MS);
      setSwimming(null);
      if (!next) return;
      if (next.round?.status === 'live') {
        sound.pearl();
        setTimeout(sound.descend, 250);
      } else if (next.round?.status === 'abyss') {
        sound.pearl();
        finish(next);
      } else finish(next);
    },
    [api, run, finish],
  );

  const cashOut = useCallback(async () => {
    const next = await run(() => api.cashOut());
    if (next) finish(next);
  }, [api, run, finish]);

  const setClientSeed = useCallback((seed: string) => run(() => api.setClientSeed(seed)), [api, run]);
  const refill = useCallback(() => (api.refill ? run(api.refill) : null), [api, run]);
  const dismissResult = useCallback(() => setShowResult(false), []);

  const round = snap?.round ?? null;
  const phase: Phase = !snap ? 'loading' : !round ? 'idle' : round.status === 'live' ? 'live' : 'ended';

  return {
    snap,
    round,
    phase,
    busy,
    swimming,
    showResult,
    biteKey,
    error,
    actions: { bet, pick, cashOut, setClientSeed, refill, dismissResult },
  };
}

export type Game = ReturnType<typeof useGame>;
