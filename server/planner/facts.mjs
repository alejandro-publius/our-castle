import { createHash } from 'node:crypto';
import { formatCents } from '../../src/core/rules.js';
import { formatDate } from './basis.mjs';

// The server facts a plan's arithmetic was built from. A proposal is usable only while these still hold: a counted
// contribution, a refund, a goal or starting-progress edit, or a new calendar day changes them. Bills, gifts, pending or
// canceled orders and member changes do not, because they never change goal progress.
const FACT_KEYS = ['householdId', 'goalId', 'goalName', 'currency', 'targetCents', 'targetDate', 'weeklyBudgetCents',
  'startingCents', 'confirmedCents', 'progressCents', 'today'];

/** Current facts for one household goal. */
export function planFacts({ goal, progress, today }) {
  return {
    householdId: goal.householdId,
    goalId: goal.id,
    goalName: goal.name,
    currency: goal.currency,
    targetCents: goal.targetCents,
    targetDate: goal.targetDate,
    weeklyBudgetCents: goal.weeklyBudgetCents,
    startingCents: progress.startingCents,
    confirmedCents: progress.confirmedNetCents,
    progressCents: progress.progressCents,
    today,
  };
}

/**
 * The facts a stored plan used, read back from its existing basis_json (no new column). The plan row is bound to its
 * goal, and the goal to its household, so scope comes from the goal the caller already verified.
 */
export function factsFromBasis(basis, goal) {
  return {
    householdId: goal.householdId,
    goalId: goal.id,
    goalName: basis.goalName,
    currency: basis.currency,
    targetCents: basis.targetCents,
    targetDate: basis.targetDate,
    weeklyBudgetCents: basis.weeklyBudgetCents,
    startingCents: basis.startingCents,
    confirmedCents: basis.confirmedCents,
    progressCents: basis.progressCents,
    today: basis.today,
  };
}

/** Opaque optimistic-concurrency token for a set of facts. Not an authorization token. */
export function factsRevision(facts) {
  const digest = createHash('sha256').update(JSON.stringify(['plan-facts-v1', ...FACT_KEYS.map((k) => facts[k] ?? null)])).digest('hex');
  return `pf1_${digest.slice(0, 32)}`;
}

/** What changed between the facts a plan used and the facts now, in plain words. Empty when nothing did. */
export function describeFactChanges(was, now) {
  const f = (cents) => formatCents(cents, now.currency);
  const changes = [];
  const add = (code, message) => changes.push({ code, message });
  if (was.householdId !== now.householdId || was.goalId !== now.goalId) add('goal', 'This plan belongs to a different goal.');
  if (was.goalName !== now.goalName) add('goal_name', `The goal is now called “${now.goalName}”.`);
  if (was.currency !== now.currency) add('currency', `The goal currency changed from ${was.currency} to ${now.currency}.`);
  if (was.targetCents !== now.targetCents) add('target', `The goal amount changed from ${f(was.targetCents)} to ${f(now.targetCents)}.`);
  if (was.targetDate !== now.targetDate) add('target_date', `The target date changed from ${formatDate(was.targetDate)} to ${formatDate(now.targetDate)}.`);
  if (was.weeklyBudgetCents !== now.weeklyBudgetCents) add('weekly_amount', `The weekly amount changed from ${f(was.weeklyBudgetCents)} to ${f(now.weeklyBudgetCents)}.`);
  if (was.startingCents !== now.startingCents) add('starting', `Reported starting progress changed from ${f(was.startingCents)} to ${f(now.startingCents)}.`);
  if (was.confirmedCents !== now.confirmedCents) {
    add('contributions', now.confirmedCents > was.confirmedCents
      ? `Counted contributions rose from ${f(was.confirmedCents)} to ${f(now.confirmedCents)}.`
      : `A refund lowered counted contributions from ${f(was.confirmedCents)} to ${f(now.confirmedCents)}.`);
  }
  if (was.progressCents !== now.progressCents) add('progress', `Tracked progress is now ${f(now.progressCents)}; this plan used ${f(was.progressCents)}.`);
  if (was.today !== now.today) add('date', `This plan was made on ${formatDate(was.today)}. Today is ${formatDate(now.today)}, so its weekly dates no longer line up.`);
  return changes;
}
