import { REALM_DISTRICTS } from './realm.js';

// A read-only trail through the current server ledger. Provider status never becomes credit here.
// Milestone crossings describe these records; kept buildings still come only from server achievements.
export function ledgerTrail(state) {
  const entries = [...state.ledger.goalEntries].sort((a, b) => a.id - b.id);
  const contributions = state.contributions;
  let progress = 0, high = 0;
  const records = entries.map((entry) => {
    progress += entry.effect * entry.amountCents;
    const afterCents = Math.max(0, progress);
    const districts = entry.effect > 0 ? REALM_DISTRICTS.filter((d) => d.percent > 0
      && high < Math.ceil(state.goal.targetCents * d.percent / 100)
      && afterCents >= Math.ceil(state.goal.targetCents * d.percent / 100)).map((d) => d.id) : [];
    high = Math.max(high, afterCents);
    const contribution = contributions.find((c) => c.captures.some((cap) =>
      entry.sourceRef?.endsWith(':' + cap.captureId)
      || cap.refunds?.some((r) => entry.sourceRef?.endsWith(':' + r.refundId)))) ?? null;
    return { id: String(entry.id), entry, contribution, afterCents, districts, category: 'goal' };
  });
  for (const [category, list] of [['bill', state.ledger.bills], ['gift', state.ledger.gifts]])
    for (const entry of list) records.push({ id: String(entry.id), entry, contribution: null, afterCents: null, districts: [], category });

  // Approval attempts and pending/failed payments belong in the ledger too, with zero credited impact.
  const represented = new Set(records.filter((r) => r.contribution).map((r) => r.contribution.id));
  for (const contribution of contributions) if (!represented.has(contribution.id))
    records.push({ id: 'order:' + contribution.id, entry: null, contribution, afterCents: null, districts: [], category: 'goal' });
  return records;
}
