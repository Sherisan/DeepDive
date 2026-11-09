import { randomHex, sha256Hex, sharksFor } from './fair';
import { CAVES, ZONES, payoutFor, roundMoney } from './math';

export type RoundStatus = 'live' | 'surfaced' | 'bitten' | 'abyss';

/** What the client is allowed to see of a dive. `sharks` stays null until the dive is over. */
export interface RoundView {
  id: string;
  bet: number;
  /** Cave chosen in each zone so far, in order. When bitten, the last one is the shark's cave. */
  picks: number[];
  rung: number;
  payout: number;
  status: RoundStatus;
  /** The shark's cave in every zone, revealed once the dive is over. */
  sharks: number[] | null;
}

export interface Fairness {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface HistoryEntry {
  id: string;
  time: number;
  bet: number;
  picks: number[];
  rung: number;
  payout: number;
  status: Exclude<RoundStatus, 'live'>;
  sharks: number[];
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface Snapshot {
  balance: number;
  currency: string;
  limits: { minBet: number; maxBet: number };
  fairness: Fairness;
  /** Current dive, or the last finished one (kept so the ocean can show the reveal). */
  round: RoundView | null;
  history: HistoryEntry[];
}

/** The contract a real backend needs to satisfy. Every call returns the full new state. */
export interface DiveApi {
  init(): Promise<Snapshot>;
  bet(amount: number): Promise<Snapshot>;
  pick(cave: number): Promise<Snapshot>;
  cashOut(): Promise<Snapshot>;
  setClientSeed(seed: string): Promise<Snapshot>;
  /** Demo only: top the wallet back up. */
  refill?(): Promise<Snapshot>;
}

interface InternalRound extends Omit<RoundView, 'sharks' | 'rung'> {
  sharks: number[];
}

interface Stored {
  balance: number;
  clientSeed: string;
  nonce: number;
  serverSeed: string;
  round: InternalRound | null;
  history: HistoryEntry[];
}

const STORAGE_KEY = 'dive.demo.v1';
const DEMO_BALANCE = 1000;
const LIMITS = { minBet: 1, maxBet: 200 };
const HISTORY_LIMIT = 50;

/** Zones cleared so far. The cave with the shark doesn't count. */
const rungOf = (r: InternalRound) => (r.status === 'bitten' ? r.picks.length - 1 : r.picks.length);

/**
 * In-browser stand-in for the game server so the frontend is fully playable without a
 * backend. It holds the secret seed and only exposes the hash until a dive ends.
 */
export function createLocalEngine(): DiveApi {
  let s: Stored = load();
  let seedHash = '';

  function load(): Stored {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Stored;
    } catch {
      /* corrupt storage, start fresh */
    }
    return { balance: DEMO_BALANCE, clientSeed: randomHex(8), nonce: 0, serverSeed: randomHex(), round: null, history: [] };
  }

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

  async function snapshot(): Promise<Snapshot> {
    seedHash ||= await sha256Hex(s.serverSeed);
    const r = s.round;
    return {
      balance: s.balance,
      currency: 'ZAR',
      limits: LIMITS,
      fairness: { serverSeedHash: seedHash, clientSeed: s.clientSeed, nonce: s.nonce },
      round: r && {
        id: r.id,
        bet: r.bet,
        picks: [...r.picks],
        rung: rungOf(r),
        payout: r.payout,
        status: r.status,
        sharks: r.status === 'live' ? null : [...r.sharks],
      },
      history: s.history,
    };
  }

  function live(): InternalRound {
    if (s.round?.status !== 'live') throw new Error('No dive in progress');
    return s.round;
  }

  /** Close the dive, reveal the seed into history and rotate to a fresh one. */
  async function settle(r: InternalRound, status: Exclude<RoundStatus, 'live'>) {
    r.status = status;
    r.payout = status === 'bitten' ? 0 : payoutFor(r.bet, rungOf(r));
    s.balance = roundMoney(s.balance + r.payout);
    s.history = [
      {
        id: r.id,
        time: Date.now(),
        bet: r.bet,
        picks: [...r.picks],
        rung: rungOf(r),
        payout: r.payout,
        status,
        sharks: [...r.sharks],
        serverSeed: s.serverSeed,
        serverSeedHash: await sha256Hex(s.serverSeed),
        clientSeed: s.clientSeed,
        nonce: s.nonce,
      },
      ...s.history,
    ].slice(0, HISTORY_LIMIT);
    s.serverSeed = randomHex();
    s.nonce += 1;
    seedHash = '';
  }

  return {
    init: snapshot,

    async bet(amount) {
      if (s.round?.status === 'live') throw new Error('Finish the current dive first');
      if (!(amount >= LIMITS.minBet && amount <= LIMITS.maxBet)) {
        throw new Error(`Bet must be between ${LIMITS.minBet} and ${LIMITS.maxBet}`);
      }
      amount = roundMoney(amount);
      if (amount > s.balance) throw new Error('Insufficient balance');
      s.balance = roundMoney(s.balance - amount);
      s.round = {
        id: randomHex(6),
        bet: amount,
        picks: [],
        payout: 0,
        status: 'live',
        sharks: await sharksFor(s.serverSeed, s.clientSeed, s.nonce),
      };
      save();
      return snapshot();
    },

    async pick(cave) {
      const r = live();
      if (!Number.isInteger(cave) || cave < 0 || cave >= CAVES) throw new Error('Unknown cave');
      const zone = r.picks.length;
      r.picks.push(cave);
      if (cave === r.sharks[zone]) await settle(r, 'bitten');
      else if (r.picks.length === ZONES) await settle(r, 'abyss');
      save();
      return snapshot();
    },

    async cashOut() {
      const r = live();
      if (rungOf(r) === 0) throw new Error('Clear at least one zone first');
      await settle(r, 'surfaced');
      save();
      return snapshot();
    },

    async setClientSeed(seed) {
      if (s.round?.status === 'live') throw new Error('Change seeds between dives');
      const clean = seed.trim().slice(0, 64);
      if (!clean) throw new Error('Client seed cannot be empty');
      s.clientSeed = clean;
      save();
      return snapshot();
    },

    async refill() {
      if (s.round?.status === 'live') throw new Error('Finish the current dive first');
      s.balance = DEMO_BALANCE;
      save();
      return snapshot();
    },
  };
}
