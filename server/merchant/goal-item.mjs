// Saving a Market Town merchant result as the household goal, only after the family confirms it.
// The goal itself is changed by the existing updateGoal (same validation and plan handling as the Plan form). The
// merchant path adds three guards and keeps the item's provenance: a Channel3 result this server showed, its price,
// currency, merchant link and the time Channel3 answered. It never credits money, buys anything or opens an area.

import { DomainError, getAchievements, getGoal, progressFor, updateGoal } from '../household.mjs';
import { transaction } from '../db.mjs';
import { TIERS, formatCents, milestoneCents } from '../../src/core/rules.js';
import { ESTATE_MILESTONES } from '../../src/core/rewards.js';

/**
 * Milestones a goal change would newly reach with progress already tracked, and the smallest goal amount that reaches
 * none. A merchant price may not lower the goal far enough to open areas by itself; areas open only through progress.
 * Already-open means recorded as achieved or reached by current progress against the current goal (as the realm shows).
 */
export function milestonesReachedBy(db, goal, { targetCents, startingCents }) {
  const progress = progressFor(db, goal.id);
  const before = progress.progressCents;
  const after = before - progress.startingCents + startingCents;
  const earned = new Set(getAchievements(db, goal.id).map((a) => a.key));
  const open = (key, percent) => earned.has(key) || before >= milestoneCents(goal.targetCents, percent);
  const reached = [];
  let minTargetCents = 0;
  const check = (key, name, percent) => {
    if (open(key, percent)) return;
    minTargetCents = Math.max(minTargetCents, Math.ceil((100 * after + 1) / percent)); // smallest T with milestone(T) > after
    if (after >= milestoneCents(targetCents, percent)) reached.push(name);
  };
  for (const tier of TIERS.slice(1)) check(`tier:${tier.index}`, tier.name, tier.percent);
  for (const r of ESTATE_MILESTONES) check(`estate:${r.key}`, r.name, r.percent);
  return { reached, minTargetCents };
}

/** Save the confirmed draft: the goal through updateGoal, then the item provenance, in one transaction. */
export function saveGoalFromItem(db, { householdId, goalId, expectedGoalId, item, goal: input }, clock) {
  const goal = getGoal(db, goalId);
  if (!goal || goal.householdId !== householdId) throw new DomainError(404, 'not_found', 'Goal not found.');
  if (expectedGoalId !== goal.id) throw new DomainError(409, 'goal_changed', 'The household goal changed since this draft was made. Review it again before saving.');
  if (!input || typeof input !== 'object') throw new DomainError(400, 'invalid_goal', 'Review the goal before saving.');
  if (!item?.usable || item.currency !== goal.currency || !Number.isSafeInteger(item.priceCents)) {
    throw new DomainError(400, 'merchant_price_unusable', 'This result has no price in the goal currency, so it cannot set the goal amount.');
  }
  if (!Number.isSafeInteger(input.targetCents) || input.targetCents < item.priceCents) {
    throw new DomainError(400, 'merchant_goal_below_price', `The goal amount cannot be lower than the item’s price (${formatCents(item.priceCents, item.currency)}).`);
  }
  const starting = Number.isSafeInteger(input.startingCents) ? input.startingCents : 0;
  const { reached, minTargetCents } = milestonesReachedBy(db, goal, { targetCents: input.targetCents, startingCents: starting });
  if (reached.length) {
    throw new DomainError(409, 'merchant_would_open_areas', `Saving ${formatCents(input.targetCents, goal.currency)} would open ${reached.join(', ')} from progress already tracked. Areas open only through progress, so use a goal amount of at least ${formatCents(minTargetCents, goal.currency)} or keep the current goal.`, { minTargetCents });
  }
  return transaction(db, () => {
    const saved = updateGoal(db, goal.id, input, clock); // Existing goal validation; earlier plans are set aside as before.
    db.prepare(`INSERT INTO goal_items (goal_id, provider, product_id, title, merchant, url, price_cents, currency, availability, checked_at, goal_name, saved_at)
      VALUES (?, 'channel3', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(goal_id) DO UPDATE SET product_id = excluded.product_id, title = excluded.title, merchant = excluded.merchant, url = excluded.url,
        price_cents = excluded.price_cents, currency = excluded.currency, availability = excluded.availability, checked_at = excluded.checked_at,
        goal_name = excluded.goal_name, saved_at = excluded.saved_at`)
      .run(goal.id, item.productId, item.title, item.merchant, item.url, item.priceCents, item.currency, item.availability, item.checkedAt, saved.name, clock.iso());
    return saved;
  });
}

/** The saved item behind the current goal, while the goal still carries the name it was saved with. */
export function goalItemFor(db, goal) {
  const row = db.prepare('SELECT * FROM goal_items WHERE goal_id = ?').get(goal.id);
  if (!row || row.goal_name !== goal.name) return null;
  return {
    provider: 'Channel3',
    productId: row.product_id,
    title: row.title,
    merchant: row.merchant,
    url: row.url,
    priceCents: row.price_cents,
    currency: row.currency,
    availability: row.availability,
    checkedAt: row.checked_at,
    savedAt: row.saved_at,
  };
}
