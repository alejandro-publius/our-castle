// Saving a Market Town merchant result as the household goal, only after the family confirms it.
// Searching and preparing a draft change nothing. On "Save as our goal" the goal is changed by the same updateGoal the
// Plan editor uses (same validation, plan handling and milestone rules), so the item's actual price can be the goal.
// The merchant adds only these checks: the draft is a Channel3 result this server showed (not expired), its price is in
// the goal currency, the goal amount is not below that price, and the goal has not changed since the draft was made.
// It keeps the item's provenance. It never credits, captures or pays out money and never buys the item.

import { createHash } from 'node:crypto';
import { DomainError, getGoal, progressFor, updateGoal } from '../household.mjs';
import { transaction } from '../db.mjs';
import { formatCents } from '../../src/core/rules.js';

// Revision of the fields a merchant draft can replace. It is an optimistic-concurrency check, not an auth token.
// Include the separately stored starting report; exclude payments, so a new contribution cannot block a goal edit.
export function merchantGoalRevision(goal, startingCents) {
  return createHash('sha256').update(JSON.stringify([
    goal.id, goal.householdId, goal.name, goal.targetCents, goal.currency, goal.targetDate, goal.weeklyBudgetCents, startingCents,
  ])).digest('hex');
}

/** Save the confirmed draft: the goal through updateGoal, then the item provenance, in one transaction. */
export function saveGoalFromItem(db, { householdId, goalId, expectedGoalId, expectedGoalRevision, item, goal: input }, clock) {
  const goal = getGoal(db, goalId);
  if (!goal || goal.householdId !== householdId) throw new DomainError(404, 'not_found', 'Goal not found.');
  if (expectedGoalId !== goal.id) throw new DomainError(409, 'goal_changed', 'The household goal changed since this draft was made. Review it again before saving.');
  if (expectedGoalRevision !== merchantGoalRevision(goal, progressFor(db, goal.id).startingCents))
    throw new DomainError(409, 'goal_changed', 'The household goal changed. Review the latest goal before saving this item.');
  if (!input || typeof input !== 'object') throw new DomainError(400, 'invalid_goal', 'Review the goal before saving.');
  if (!item?.usable || item.currency !== goal.currency || !Number.isSafeInteger(item.priceCents)) {
    throw new DomainError(400, 'merchant_price_unusable', 'This result has no price in the goal currency, so it cannot set the goal amount.');
  }
  // The actual price is the default; a family may deliberately choose more (tax, shipping, a broader goal), never less.
  if (!Number.isSafeInteger(input.targetCents) || input.targetCents < item.priceCents) {
    throw new DomainError(400, 'merchant_goal_below_price', `The goal amount cannot be lower than the item’s price (${formatCents(item.priceCents, item.currency)}).`);
  }
  return transaction(db, () => {
    // The ordinary goal edit: existing validation; earlier plans set aside; milestones that progress already tracked
    // reaches under the new amount are recorded exactly as the Plan editor would. No ledger entry is written.
    const saved = updateGoal(db, goal.id, input, clock);
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
