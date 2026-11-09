import { CAVES, LADDER, RTP, ZONES, ZONE_DEPTH, survival } from '../game/math';
import { formatMultiplier } from '../game/money';
import { Modal } from './Modal';

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="HOW TO PLAY" onClose={onClose}>
      <ol className="rules-steps">
        <li>
          <b>Dive in.</b> Pick a bet and press <kbd>DIVE IN</kbd>.
        </li>
        <li>
          <b>Choose a cave.</b> Each of the {ZONES} depth zones has {CAVES} caves, and a shark hides in one of them. Pick a safe cave
          and you collect a pearl and swim {ZONE_DEPTH} m deeper. Every zone is a fresh 1-in-{CAVES} risk.
        </li>
        <li>
          <b>Surface</b> any time after your first zone to cash out. Your oxygen lasts {ZONES} zones: clear them all to reach the
          treasure at the abyss for the max win.
        </li>
        <li>
          <b>Pick the shark's cave</b> and the dive is over. The bet is lost.
        </li>
      </ol>

      <h4>Payout ladder</h4>
      <table className="rules-table">
        <thead>
          <tr>
            <th>Depth</th>
            <th>Chance</th>
            <th>Pays</th>
          </tr>
        </thead>
        <tbody>
          {LADDER.map((m, i) => (
            <tr key={i}>
              <td>{i + 1 === ZONES ? `${(i + 1) * ZONE_DEPTH} m · Abyss` : `${(i + 1) * ZONE_DEPTH} m`}</td>
              <td>{(survival(i + 1) * 100).toFixed(2)}%</td>
              <td>{formatMultiplier(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        The return to player is {(RTP * 100).toFixed(2)}% whenever you surface. Keyboard: <kbd>1</kbd>–<kbd>{CAVES}</kbd> cave,{' '}
        <kbd>Space</kbd> dive / surface.
      </p>
    </Modal>
  );
}
