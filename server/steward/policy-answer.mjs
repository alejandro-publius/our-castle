import { PAYPAL_READ_TOOLS } from '../../src/core/steward-policy.js';

// A deterministic permissions answer, available without AI credentials. No provider lookup, model run, money action
// or fabricated verification/tool trace. The caller still validates the member and any selected order first.
export function readOnlyAnswer() {
  return {
    status: 'ok', source: 'local-policy', kind: 'read-only-boundary',
    answer: 'I can’t make a payment or refund. An adult handles those actions; I can only read records.',
    policy: { paypalReadTools: [...PAYPAL_READ_TOOLS], canMoveMoney: false },
    checks: [], warnings: [], model: null, paypalTools: false, verification: null,
  };
}
