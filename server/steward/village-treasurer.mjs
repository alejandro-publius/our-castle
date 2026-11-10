import { DomainError } from '../household.mjs';

const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = (code, message, status = 400) => new DomainError(status, code, message);
const money = (value, currency, decimals, rail) => {
  const scale = 10 ** decimals, whole = Math.floor(value / scale), fraction = String(value % scale).padStart(decimals, '0');
  return rail === 'pyusd-devnet' ? `${whole}.${fraction} PYUSD test tokens` : `$${whole}.${fraction}`;
};

/** Build answers from the service's net projection, never by adding raw capture/refund events together. */
export function villageTreasurerAnswer(fund, question, asOf) {
  if (typeof question !== 'string' || question.trim().length < 3 || question.length > 300 || /[\x00-\x1f\x7f]/.test(question))
    throw fail('village_question', 'Ask a question of 3–300 characters.');
  const tokens = fund?.rail === 'pyusd-devnet';
  if (!fund || !['simulated', 'paypal-sandbox', 'pyusd-devnet'].includes(fund.rail) ||
      fund.currency !== (tokens ? 'PYUSD' : 'USD') || fund.decimals !== (tokens ? 6 : 2) ||
      !integer(fund.targetMinor) || !integer(fund.progress?.netMinor) || !Array.isArray(fund.shares) || fund.shares.length > 50)
    throw fail('village_projection', 'The fund summary is not available in a supported form.', 409);
  const households = fund.shares.map(share => {
    if (typeof share.familyReference !== 'string' || typeof share.alias !== 'string' || !integer(share.committedMinor) || !integer(share.paidMinor))
      throw fail('village_projection', 'A family share is not available in a supported form.', 409);
    return { familyReference: share.familyReference, alias: share.alias, committedMinor: share.committedMinor, paidMinor: share.paidMinor };
  });
  const remainingMinor = Math.max(0, fund.targetMinor - fund.progress.netMinor);
  const pendingCommitmentsMinor = households.reduce((total, share) => total + Math.max(0, share.committedMinor - share.paidMinor), 0);
  if (!integer(pendingCommitmentsMinor)) throw fail('village_projection', 'The fund summary exceeds the supported range.', 409);
  // B owns matching and reversals. A missing unmatched projection is unknown, not a fabricated zero.
  const unmatched = integer(fund.progress.unmatchedMinor) && integer(fund.progress.unmatchedCount)
    ? { count: fund.progress.unmatchedCount, totalMinor: fund.progress.unmatchedMinor } : null;
  const facts = { targetMinor: fund.targetMinor, netMinor: fund.progress.netMinor, remainingMinor, currency: fund.currency,
    decimals: fund.decimals, rail: fund.rail, deadline: fund.deadline, revision: fund.revision, households, unmatched,
    pendingCommitmentsMinor, unpromisedMinor: Math.max(0, remainingMinor - pendingCommitmentsMinor) };
  const f = value => money(value, fund.currency, fund.decimals, fund.rail);
  const source = { mode: 'records', label: tokens ? 'Recorded Solana devnet transfers; test tokens have no monetary value'
    : fund.rail === 'simulated' ? 'Simulated village records; no money moved' : 'Recorded PayPal sandbox receipts; no fresh provider lookup' };
  const questionText = question.toLowerCase();
  let answer;
  if (/unmatched|unassigned|unidentified|can.t match|cannot match/.test(questionText)) {
    answer = unmatched ? `${unmatched.count} unmatched deposit${unmatched.count === 1 ? '' : 's'} ${unmatched.count === 1 ? 'has' : 'have'} ${f(unmatched.totalMinor)} still recorded. An unmatched deposit is not assigned to a family by this answer.`
      : 'This fund does not supply an unmatched-deposit summary. I cannot infer one from the receipt list.';
  } else if (/who|which famil|chipped|contributed|has paid/.test(questionText)) {
    const paid = households.filter(share => share.paidMinor > 0);
    answer = paid.length ? `${paid.length} famil${paid.length === 1 ? 'y has' : 'ies have'} net recorded contributions: ${paid.slice(0, 8).map(share => `${share.alias}: ${f(share.paidMinor)}`).join('; ')}${paid.length > 8 ? `; and ${paid.length - 8} more in the fund list` : ''}.`
      : 'No participating family has a net recorded contribution yet.';
    answer += ' A promised share is not a payment.';
  } else if (/pay|send|charge|refund|subscribe|subscription|match|assign|transfer/.test(questionText)) {
    answer = `I can read this fund and help prepare a plan. I cannot move money, assign deposits or start recurring charges. The fund has ${f(fund.progress.netMinor)} recorded toward ${f(fund.targetMinor)}.`;
  } else {
    answer = `${f(fund.progress.netMinor)} is recorded toward ${f(fund.targetMinor)}; ${f(remainingMinor)} remains.`;
    if (remainingMinor > 0) answer += ` Unpaid family commitments total ${f(pendingCommitmentsMinor)}. Commitments do not guarantee the ${fund.deadline} target.`;
    else answer += ' The recorded funding target is reached; this does not confirm a purchase or completed construction.';
  }
  answer += tokens ? ' These are devnet test tokens with no monetary value.' : fund.rail === 'simulated' ? ' These records are simulated.' : ' These are saved sandbox records, not a new PayPal check.';
  return { answer, source, facts, asOf, paymentScheduled: false };
}

/** readAuthorizedFund must authorize neighborhood membership on every call. No model or provider transport is used. */
export function createVillageTreasurer({ readAuthorizedFund, clock }) {
  if (typeof readAuthorizedFund !== 'function' || typeof clock?.iso !== 'function') throw new Error('The village treasurer requires a scoped fund reader and clock.');
  return { async ask({ scope, fundId, question, assertAccess = () => {} }) {
    assertAccess();
    const fund = await readAuthorizedFund(scope, fundId);
    assertAccess();
    const result = villageTreasurerAnswer(fund, question, clock.iso());
    assertAccess();
    return result;
  } };
}
