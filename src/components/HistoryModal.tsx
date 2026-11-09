import { useState } from 'react';
import type { HistoryEntry, Snapshot } from '../game/engine';
import { sha256Hex, sharksFor } from '../game/fair';
import { ZONE_DEPTH } from '../game/math';
import { formatMoney } from '../game/money';
import { CheckIcon } from './Icons';
import { Modal } from './Modal';

type Tab = 'history' | 'fairness';
type Verdict = 'pending' | 'ok' | 'bad';

const RESULT_LABEL = { surfaced: 'Surfaced', abyss: 'Abyss', bitten: 'Shark' } as const;

async function verify(e: HistoryEntry): Promise<boolean> {
  const [hash, sharks] = await Promise.all([sha256Hex(e.serverSeed), sharksFor(e.serverSeed, e.clientSeed, e.nonce)]);
  return hash === e.serverSeedHash && sharks.every((s, k) => s === e.sharks[k]);
}

export function HistoryModal({
  snap,
  initialTab,
  canChangeSeed,
  onSetClientSeed,
  onClose,
}: {
  snap: Snapshot;
  initialTab: Tab;
  canChangeSeed: boolean;
  onSetClientSeed: (seed: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [seed, setSeed] = useState(snap.fairness.clientSeed);
  const cur = snap.currency;

  const runVerify = async (e: HistoryEntry) => {
    setVerdicts((v) => ({ ...v, [e.id]: 'pending' }));
    const ok = await verify(e);
    setVerdicts((v) => ({ ...v, [e.id]: ok ? 'ok' : 'bad' }));
  };

  return (
    <Modal title={tab === 'history' ? 'DIVE LOG' : 'PROVABLY FAIR'} onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          History
        </button>
        <button className={tab === 'fairness' ? 'on' : ''} onClick={() => setTab('fairness')}>
          Fairness
        </button>
      </div>

      {tab === 'history' ? (
        snap.history.length === 0 ? (
          <p className="muted">No dives yet. Dive in to get started.</p>
        ) : (
          <ul className="history">
            {snap.history.map((e) => (
              <li key={e.id} className={`h-row h-${e.status}`}>
                <button className="h-main" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <span className="h-time">{new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="h-depth">
                    {e.sharks.map((_, k) => (
                      <i key={k} className={k < e.rung ? 'ok' : e.status === 'bitten' && k === e.picks.length - 1 ? 'bad' : ''} />
                    ))}
                  </span>
                  <span className="h-result">
                    {RESULT_LABEL[e.status]} · {(e.status === 'bitten' ? e.picks.length : e.rung) * ZONE_DEPTH} m
                  </span>
                  <span className="h-pay">{e.payout > 0 ? `+${formatMoney(e.payout, cur)}` : `−${formatMoney(e.bet, cur)}`}</span>
                </button>
                {open === e.id && (
                  <div className="h-detail">
                    <dl>
                      <dt>Bet</dt>
                      <dd>{formatMoney(e.bet, cur)}</dd>
                      <dt>Your caves</dt>
                      <dd className="mono">{e.picks.map((p) => p + 1).join(' · ')}</dd>
                      <dt>Sharks</dt>
                      <dd className="mono">{e.sharks.map((s) => s + 1).join(' · ')}</dd>
                      <dt>Server seed</dt>
                      <dd className="mono">{e.serverSeed}</dd>
                      <dt>Seed hash</dt>
                      <dd className="mono">{e.serverSeedHash}</dd>
                      <dt>Client seed</dt>
                      <dd className="mono">{e.clientSeed}</dd>
                      <dt>Nonce</dt>
                      <dd className="mono">{e.nonce}</dd>
                    </dl>
                    <button className={`verify ${verdicts[e.id] ?? ''}`} onClick={() => runVerify(e)} disabled={verdicts[e.id] === 'pending'}>
                      {verdicts[e.id] === 'ok' ? (
                        <>
                          <CheckIcon width={16} height={16} /> Verified
                        </>
                      ) : verdicts[e.id] === 'bad' ? (
                        'Verification failed'
                      ) : (
                        'Verify dive'
                      )}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="fair">
          <p className="muted">
            Before every dive you see a SHA-256 hash of the secret server seed. The shark's cave in zone k is
            <code> (HMAC_SHA256(serverSeed, clientSeed:nonce:k) first 52 bits × 3) &gt;&gt; 52</code>. When the dive ends the server seed
            is revealed, so you can check that it matches the hash and puts every shark in the same cave.
          </p>
          <label>Next server seed (hashed)</label>
          <div className="mono field">{snap.fairness.serverSeedHash}</div>
          <label htmlFor="client-seed">Client seed</label>
          <div className="seed-row">
            <input id="client-seed" className="mono field" value={seed} onChange={(e) => setSeed(e.target.value)} disabled={!canChangeSeed} />
            <button
              className="btn"
              disabled={!canChangeSeed || seed.trim() === snap.fairness.clientSeed}
              onClick={() => onSetClientSeed(seed)}
            >
              Change
            </button>
          </div>
          <label>Nonce</label>
          <div className="mono field">{snap.fairness.nonce}</div>
        </div>
      )}
    </Modal>
  );
}
