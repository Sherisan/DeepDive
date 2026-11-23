/*
 * Connection guard — the same file in every game frontend (keep the copies identical).
 *
 * While the game can't reach its server it shows a full-screen "Connecting to server…" panel that swallows every
 * click, tap, key and wheel, and API calls fail fast (assertOnline), so nothing can be played. When the server answers
 * again the guard calls POST api/session/recover: the server refunds any bet the drop left open (a step game that had
 * already climbed is cashed out where it stood instead) and says what it did. The player sees that in a notice, then
 * the game reloads its state (onRecovered). The same recovery runs once at start-up, for a drop that ended with the
 * tab closed or reloaded.
 *
 * A drop is noticed from: the browser's offline event, an API call with no response (or 502 / 503 / 504), a failed
 * GET api/ping heartbeat (HTTP games), or the SignalR hub dropping (hub games report it with connectionLost()).
 *
 * Works against an API without these endpoints too: a 404 from api/ping still means "reachable", and a 404 from
 * api/session/recover means "nothing to recover".
 */

export interface RecoveredBet {
  gameId: string;
  roundId: string;
  /** refunded: the stake went back to the wallet. cashed: a climbed round was cashed out for `amount`. */
  kind: 'refunded' | 'cashed';
  stake: number;
  amount: number;
  freeBet: boolean;
  slot: number | null;
}

export interface Recovery {
  refunds: RecoveredBet[];
  balance: number | null;
  currency: string;
}

export interface ConnectionGuardOptions {
  /** '' for same-origin (dev proxy). */
  apiBase: string;
  getToken: () => Promise<string>;
  /** HTTP games: poll api/ping so a drop is noticed while the player is idle. Hub games: the hub is the heartbeat. */
  heartbeat?: boolean;
  /** Hub games: whether the hub is connected right now (checked when the browser comes back online). */
  isHubConnected?: () => boolean;
  /** After a reconnect has been recovered: reload the game's state from the server (balance, round, bets). */
  onRecovered?: (recovery: Recovery) => void | Promise<void>;
}

export class ConnectionLostError extends Error {
  constructor() {
    super('Connection lost — reconnecting…');
    this.name = 'ConnectionLostError';
  }
}

type Status = 'online' | 'offline' | 'recovering' | 'resyncing';

const PING_EVERY_MS = 5000;
const PROBE_EVERY_MS = 2000;
const REQUEST_TIMEOUT_MS = 6000;
const RETRY_STATUSES = new Set([0, 408, 409, 425, 429, 500, 502, 503, 504]);

let opts: ConnectionGuardOptions | null = null;
let status: Status = 'online';
let ready: Promise<Recovery> | null = null;
let recovering: Promise<Recovery> | null = null;
let probeTimer: number | null = null;
let pingFailures = 0;
let pinging = false;
let carried: RecoveredBet[] = [];
const listeners = new Set<(online: boolean) => void>();
const recoveredHandlers = new Set<(recovery: Recovery) => void | Promise<void>>();

const EMPTY: Recovery = { refunds: [], balance: null, currency: 'ZAR' };

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Starts the guard (once; a later call only refreshes the options — e.g. the hub of an engine React re-created — and
 * returns the same promise). The promise is the start-up recovery: it resolves when the server has settled anything a
 * previous connection left open. Games await it before loading their state.
 */
export function startConnectionGuard(options: ConnectionGuardOptions): Promise<Recovery> {
  if (ready) {
    opts = { ...opts, ...options };
    return ready;
  }
  opts = options;
  window.addEventListener('offline', () => connectionLost());
  window.addEventListener('online', () => {
    if (status === 'online') return;
    if (opts?.heartbeat) probeSoon(0);
    else if (opts?.isHubConnected?.()) void recover();
  });
  if (options.heartbeat) {
    window.setInterval(heartbeat, PING_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void heartbeat();
    });
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) connectionLost();
  // Start-up: the game's own load follows, so onRecovered isn't called here.
  ready = recover({ startup: true });
  return ready;
}

/** False while the "Connecting to server…" panel is up. */
export function isOnline(): boolean {
  return status === 'online' || status === 'resyncing';
}

/** Call before every API request: throws ConnectionLostError while offline, so nothing is sent or bet. */
export function assertOnline(): void {
  if (opts && !isOnline()) throw new ConnectionLostError();
}

/** For fetch wrappers: a response status that means the server itself is unreachable. */
export function isUnreachableStatus(httpStatus: number): boolean {
  return httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

/**
 * Report a lost connection: shows the panel and blocks play. HTTP games call it when a request gets no response (or
 * 502 / 503 / 504) and the guard probes until the server answers; hub games call it on the hub's reconnecting / close
 * and call recover() once the hub is connected again.
 */
export function connectionLost(): void {
  if (!opts) return;
  if (status === 'offline') return;
  setStatus('offline');
  if (opts.heartbeat) probeSoon(PROBE_EVERY_MS);
}

/**
 * The server is reachable again (hub games: call it after the hub reconnects, and once after the first connect):
 * asks the server to refund what the drop left open, shows what it did, then lets the game reload (onRecovered).
 */
export function recover(options: { startup?: boolean } = {}): Promise<Recovery> {
  if (!opts) return Promise.resolve(EMPTY);
  if (recovering) return recovering;
  const run = async (): Promise<Recovery> => {
    const result = await postRecover(!!options.startup);
    const handlers = [...recoveredHandlers];
    if (opts?.onRecovered) handlers.push(opts.onRecovered);
    if (!options.startup && handlers.length > 0) {
      setStatus('resyncing'); // API calls allowed, panel still up while the game reloads
      // Errors are the game's to show; the guard only waits for the reload to finish.
      await Promise.all(handlers.map((h) => Promise.resolve().then(() => h(result)).catch(() => undefined)));
    }
    if (status === 'offline') {
      // The connection dropped again while the game reloaded: keep the panel, tell the player on the next recovery.
      carried.push(...result.refunds);
      if (opts?.heartbeat) probeSoon(PROBE_EVERY_MS);
      return result;
    }
    const shown = { ...result, refunds: [...carried, ...result.refunds] };
    carried = [];
    setStatus('online');
    showNotice(shown, !!options.startup);
    return result;
  };
  recovering = run().finally(() => {
    recovering = null;
  });
  return recovering;
}

/**
 * Register a reload to run after every reconnect has been recovered (not at start-up: the game's first load does that).
 * The panel stays up until it finishes. Returns an unsubscribe function, so it fits a React effect.
 */
export function onRecovered(fn: (recovery: Recovery) => void | Promise<void>): () => void {
  recoveredHandlers.add(fn);
  return () => {
    recoveredHandlers.delete(fn);
  };
}

/** Subscribe to online / offline changes (e.g. to pause autoplay). Returns an unsubscribe function. */
export function onConnectionChange(fn: (online: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Endless SignalR reconnect policy for the game hubs (the default gives up after four tries). */
export const hubRetryPolicy = {
  nextRetryDelayInMilliseconds: (ctx: { previousRetryCount: number }) =>
    ctx.previousRetryCount === 0 ? 0 : Math.min(1000 * ctx.previousRetryCount, 5000),
};

/** SignalR liveness to match the server's game hubs (they ping every 5 s and drop a client silent for 20 s). */
export function tuneHub(conn: { serverTimeoutInMilliseconds: number; keepAliveIntervalInMilliseconds: number }): void {
  conn.keepAliveIntervalInMilliseconds = 5000;
  conn.serverTimeoutInMilliseconds = 15000;
}

// ── Internals ─────────────────────────────────────────────────────────────

function setStatus(next: Status) {
  const wasOnline = isOnline();
  status = next;
  renderPanel();
  if (wasOnline !== isOnline()) for (const fn of listeners) fn(isOnline());
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: ctrl.signal });
  } finally {
    window.clearTimeout(t);
  }
}

/** True when the API answered at all (any status but 502-504 — an API without api/ping returns 404, still reachable). */
async function ping(): Promise<boolean> {
  if (!opts) return true;
  try {
    const res = await fetchWithTimeout(`${opts.apiBase}/api/ping`, { method: 'GET' }, 4000);
    return !isUnreachableStatus(res.status);
  } catch {
    return false;
  }
}

async function heartbeat() {
  if (!opts || status !== 'online' || pinging || document.visibilityState !== 'visible') return;
  pinging = true;
  try {
    if (await ping()) pingFailures = 0;
    else if (++pingFailures >= 2 || navigator.onLine === false) {
      pingFailures = 0;
      connectionLost();
    }
  } finally {
    pinging = false;
  }
}

function probeSoon(ms: number) {
  if (probeTimer != null) window.clearTimeout(probeTimer);
  probeTimer = window.setTimeout(async () => {
    probeTimer = null;
    if (status !== 'offline') return;
    if (await ping()) void recover();
    else probeSoon(PROBE_EVERY_MS);
  }, ms);
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

async function postRecover(startup: boolean): Promise<Recovery> {
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await wait(Math.min(1000 * attempt, 4000));
    // The first start-up try runs behind the game's own loading screen; after that the panel blocks play meanwhile.
    if (!(startup && attempt === 0)) setStatus('recovering');
    let token: string;
    try {
      token = await opts!.getToken();
    } catch {
      return EMPTY; // no session: the game's own calls say so (and a drop is recovered when it's back)
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(`${opts!.apiBase}/api/session/recover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      setStatus('offline'); // still unreachable — keep trying
      continue;
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Partial<Recovery> | null;
      return { refunds: body?.refunds ?? [], balance: body?.balance ?? null, currency: body?.currency ?? 'ZAR' };
    }
    if (res.status === 404 || res.status === 405 || res.status === 401 || res.status === 403) return EMPTY;
    if (!RETRY_STATUSES.has(res.status)) {
      console.warn('Connection recovery failed', res.status);
      return EMPTY;
    }
    if (isUnreachableStatus(res.status)) setStatus('offline');
  }
}

// ── The panel and the notice ──────────────────────────────────────────────

const CSS = `
.cg-panel{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  background:rgba(4,8,16,.74);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);touch-action:none;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;cursor:progress}
.cg-card{display:flex;flex-direction:column;align-items:center;gap:12px;max-width:min(340px,calc(100vw - 32px));
  padding:24px 26px;border-radius:16px;background:rgba(18,24,38,.94);border:1px solid rgba(255,255,255,.14);
  box-shadow:0 18px 48px rgba(0,0,0,.5);text-align:center}
.cg-spin{width:38px;height:38px;border-radius:50%;border:4px solid rgba(255,255,255,.18);border-top-color:#ffd24a;
  animation:cg-spin .9s linear infinite}
.cg-title{font-size:18px;font-weight:700;letter-spacing:.01em}
.cg-sub{font-size:13.5px;line-height:1.45;color:rgba(255,255,255,.74)}
@keyframes cg-spin{to{transform:rotate(360deg)}}
.cg-notice{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);
  z-index:2147483001;width:min(380px,calc(100vw - 32px));padding:14px 16px;border-radius:14px;
  background:rgba(18,24,38,.96);border:1px solid rgba(255,255,255,.16);box-shadow:0 14px 40px rgba(0,0,0,.45);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;animation:cg-in .25s ease-out}
.cg-notice h4{margin:0 0 4px;font-size:15px;font-weight:700}
.cg-notice p{margin:2px 0;font-size:13.5px;line-height:1.4;color:rgba(255,255,255,.82)}
.cg-notice button{margin-top:10px;width:100%;padding:9px 0;border:0;border-radius:9px;background:#ffd24a;
  color:#1a1405;font-weight:700;font-size:14px;cursor:pointer}
@keyframes cg-in{from{opacity:0;transform:translate(-50%,-8px)}}
`;

let panel: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;
let notice: HTMLDivElement | null = null;
let noticeTimer: number | null = null;

function ensureStyles() {
  if (document.getElementById('cg-styles')) return;
  const style = document.createElement('style');
  style.id = 'cg-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function renderPanel() {
  const blocked = status !== 'online';
  if (!blocked) {
    panel?.remove();
    return;
  }
  ensureStyles();
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'cg-panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-live', 'assertive');
    panel.tabIndex = -1;
    const card = document.createElement('div');
    card.className = 'cg-card';
    const spin = document.createElement('div');
    spin.className = 'cg-spin';
    titleEl = document.createElement('div');
    titleEl.className = 'cg-title';
    const sub = document.createElement('div');
    sub.className = 'cg-sub';
    sub.textContent = 'Play is paused until the connection is back.';
    card.append(spin, titleEl, sub);
    panel.append(card);
  }
  titleEl!.textContent = 'Connecting to server…';
  if (!panel.isConnected) {
    document.body.appendChild(panel);
    // A focused stake box would otherwise still take typing behind the panel.
    (document.activeElement as HTMLElement | null)?.blur?.();
    panel.focus({ preventScroll: true });
  }
}

function money(amount: number, currency: string) {
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'ZAR' ? `R${n}` : `${n} ${currency}`;
}

function showNotice(r: Recovery, startup: boolean) {
  const lines = r.refunds.map((b) =>
    b.kind === 'cashed'
      ? `Your round was cashed out where it stood: ${money(b.amount, r.currency)} paid.`
      : b.freeBet
        ? 'Your free bet was returned to you.'
        : `Your bet of ${money(b.stake, r.currency)} was refunded.`,
  );
  if (startup && lines.length === 0) return;
  ensureStyles();
  notice?.remove();
  if (noticeTimer != null) window.clearTimeout(noticeTimer);
  notice = document.createElement('div');
  notice.className = 'cg-notice';
  notice.setAttribute('role', 'status');
  const h = document.createElement('h4');
  h.textContent = startup ? 'Your last session was interrupted' : 'Connection restored';
  notice.append(h);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    notice.append(p);
  }
  const close = () => {
    notice?.remove();
    notice = null;
  };
  if (lines.length > 0) {
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.addEventListener('click', close);
    notice.append(ok);
  }
  document.body.appendChild(notice);
  noticeTimer = window.setTimeout(close, lines.length > 0 ? 9000 : 2500);
}

// ── Input blocking ────────────────────────────────────────────────────────
// Registered when this module loads, before the game adds its own listeners, so these capture-phase handlers run first
// and stop every input while the panel is up — including listeners the game put on window or document.

const BLOCKED_EVENTS = [
  'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu',
  'touchstart', 'touchmove', 'touchend', 'wheel', 'keydown', 'keyup', 'keypress',
];

if (typeof window !== 'undefined') {
  const block = (e: Event) => {
    if (!opts || status === 'online') return;
    e.stopImmediatePropagation();
    // Keep browser shortcuts (reload, zoom, tab switching) working; swallow everything else.
    if (e instanceof KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key) && e.key !== 'Tab') e.preventDefault();
    } else if (e.cancelable) e.preventDefault();
  };
  for (const type of BLOCKED_EVENTS) window.addEventListener(type, block, { capture: true, passive: false });
}
