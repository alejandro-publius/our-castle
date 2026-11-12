// "Which holds end soonest?" answered from the contribution views already loaded for this household's active goal:
// the same rows the Treasury shows (server/treasury.mjs `openHolds`), soonest to end first. It reads saved records
// only: no model, no provider call, no write, and no claim that PayPal was asked. Each hold's receipt is returned so
// the interface can open it; releasing or returning stays an adult's own confirmed action there.
import { formatCents } from '../../src/core/rules.js';
import { holdLine } from '../../src/core/hold-line.js';
import { openHolds } from '../treasury.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function holdsAnswer(list, now) {
  const holds = openHolds(list, now);
  const money = (cents, h) => formatCents(cents, h.currency);
  const sentences = [];
  if (!holds.length) {
    sentences.push('Nothing is held for this goal right now.');
  } else {
    const total = holds.reduce((sum, h) => sum + h.remainingCents, 0);
    sentences.push(`${plural(holds.length, 'hold is', 'holds are')} open, with ${money(total, holds[0])} still held. None of it counts toward the goal until an adult releases it.`);
    if (holds.length > 1) sentences.push('Soonest to end first.');
    for (const h of holds) sentences.push(`${money(h.remainingCents, h)} of ${money(h.heldCents, h)}${h.simulated ? ' (simulated)' : ''}: ${holdLine(h)}`);
  }
  sentences.push(`This reads saved records only; ${list.some((c) => !c.simulated && c.hold) ? 'PayPal was not asked' : 'no provider was contacted'}.`);
  return {
    status: 'ok', source: 'local-records', kind: 'holds', answer: sentences.join(' '), warnings: [], model: null, paypalTools: false,
    verification: null, // nothing was looked up; saved records never become fresh verification
    receipts: holds.map((h) => ({ contributionId: h.id, orderId: list.find((c) => c.id === h.id)?.providerOrderId ?? null,
      amount: money(h.remainingCents, h), status: h.phase === 'guaranteed' || h.phase === 'ending' ? 'Held, guaranteed' : 'Held', needsCheck: false })),
    checks: [{ tool: 'read_open_holds', source: 'Saved household records',
      summary: `Read ${plural(holds.length, 'open hold', 'open holds')} for this goal. No provider was contacted.` }],
  };
}
