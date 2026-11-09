import type { DiveApi, Fairness, HistoryEntry, RoundView, Snapshot } from './engine';

// Dev: relative URLs go through the Vite proxy. Production: VITE_API_BASE.
const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';
/** Must match the "Games" entry in the game API config. */
const GAME_ID = 'deep-dive';

// Production: Games-API launches the game as /?token=<jwt>.
// Dev/staging: the API's GET /api/dev-token mints a random player for this game.
let token: string | null = null;

async function getToken(): Promise<string> {
  if (token) return token;
  const fromUrl = new URLSearchParams(window.location.search).get('token');
  if (fromUrl) return (token = fromUrl);
  const res = await fetch(`${API_BASE}/api/dev-token?gameId=${GAME_ID}`);
  if (!res.ok) throw new Error('No session token. Launch the game from the lobby, or run the API in Development mode.');
  token = ((await res.json()) as { token: string }).token;
  return token;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const auth = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Connection lost.');
  }
  if (res.status === 429) throw new Error('Too many requests — slow down a little.');
  if (res.status === 401) throw new Error('Your session has expired. Reopen the game from the lobby.');
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

// ── Wire types (camelCase JSON from DiveController) ────────────────────

interface Info {
  minBet: number;
  maxBet: number;
  currency: string;
}

interface Board {
  round: (RoundView & { balance: number | null; winPending: boolean }) | null;
  fairness: Fairness;
  history: HistoryEntry[];
}

/** Talks to FeedingFranzeeAPI's api/dive; the server owns the seeds and the wallet. */
export function createHttpEngine(): DiveApi {
  let info: Info = { minBet: 1, maxBet: 200, currency: 'ZAR' };
  let balance = 0;

  const toSnapshot = (b: Board): Snapshot => {
    if (b.round?.balance != null) balance = b.round.balance;
    return {
      balance,
      currency: info.currency,
      limits: { minBet: info.minBet, maxBet: info.maxBet },
      fairness: b.fairness,
      round: b.round,
      history: b.history,
    };
  };

  const post = async (path: string, body: unknown = {}) => toSnapshot(await call<Board>(path, body));

  return {
    async init() {
      const [i, wallet, board] = await Promise.all([
        call<Info>('/api/dive/info'),
        call<{ balance: number }>('/api/wallet/balance'),
        call<Board>('/api/dive/state'),
      ]);
      info = i;
      balance = wallet.balance;
      // A finished dive's balance is stale by now; the wallet is the source of truth on load.
      return toSnapshot({ ...board, round: board.round && { ...board.round, balance: null } });
    },
    bet: (stake) => post('/api/dive/bet', { stake }),
    pick: (cave) => post('/api/dive/pick', { cave }),
    cashOut: () => post('/api/dive/cashout'),
    setClientSeed: (clientSeed) => post('/api/dive/seed', { clientSeed }),
  };
}
