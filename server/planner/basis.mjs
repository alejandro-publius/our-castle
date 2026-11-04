import { TIERS, formatCents, milestoneCents } from '../../src/core/rules.js';
import { addDays, daysBetween, isIsoDate } from '../household.mjs';

export const MAX_COMMITMENTS = 8;
export const MAX_PLAN_WEEKS = 52;

export class PlanInputError extends Error {
  constructor(issues) {
    super(issues.map((i) => i.message).join(' '));
    this.status = 400;
    this.code = 'invalid_plan_inputs';
    this.issues = issues;
  }
}

/**
 * Recurring commitments are bills the household already pays. They are context for the planner,
 * never counted as savings, and the planner must not assume anything about whether they are paid.
 */
export function cleanCommitments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PlanInputError([{ code: 'commitments', message: 'Commitments must be a list.' }]);
  if (raw.length > MAX_COMMITMENTS) throw new PlanInputError([{ code: 'commitments', message: `List up to ${MAX_COMMITMENTS} commitments.` }]);
  return raw.map((c, i) => {
    const label = typeof c?.label === 'string' ? c.label.trim().replace(/\s+/g, ' ') : '';
    const cadence = c?.cadence === 'weekly' ? 'weekly' : c?.cadence === 'monthly' ? 'monthly' : null;
    if (label.length < 2 || label.length > 40 || !Number.isSafeInteger(c?.amountCents) || c.amountCents < 0 || c.amountCents > 10_000_000 || !cadence) {
      throw new PlanInputError([{ code: 'commitments', message: `Commitment ${i + 1} needs a 2–40 character label, an amount and weekly/monthly.` }]);
    }
    return { label, amountCents: c.amountCents, cadence };
  });
}

/** Deterministic arithmetic every plan (AI or rules) is checked against. */
export function computeBasis({ goal, progress, commitments = [], today }) {
  if (!isIsoDate(today) || !isIsoDate(goal.targetDate)) throw new PlanInputError([{ code: 'date', message: 'Invalid date.' }]);
  const days = daysBetween(today, goal.targetDate);
  const weeks = Math.min(MAX_PLAN_WEEKS, Math.floor(days / 7));
  if (weeks < 1) throw new PlanInputError([{ code: 'date', message: 'The target date must be at least one week away.' }]);
  const targetCents = goal.targetCents;
  const progressCents = progress.progressCents;
  const remainingCents = Math.max(0, targetCents - progressCents);
  const weeklyBudgetCents = goal.weeklyBudgetCents;
  const maxReachableCents = weeklyBudgetCents * weeks;
  const plannedCents = Math.min(remainingCents, maxReachableCents);
  const shortfallCents = remainingCents - plannedCents;
  const requiredWeeklyCents = Math.ceil(remainingCents / weeks);
  const weeksNeeded = weeklyBudgetCents > 0 ? Math.ceil(remainingCents / weeklyBudgetCents) : null;
  return {
    today,
    goalName: goal.name,
    currency: goal.currency,
    targetDate: goal.targetDate,
    planEndDate: addDays(today, weeks * 7),
    weeks,
    dates: Array.from({ length: weeks }, (_, i) => addDays(today, 7 * (i + 1))),
    targetCents,
    startingCents: progress.startingCents,
    confirmedCents: progress.confirmedNetCents,
    progressCents,
    remainingCents,
    weeklyBudgetCents,
    maxReachableCents,
    plannedCents,
    shortfallCents,
    feasible: shortfallCents === 0,
    requiredWeeklyCents,
    weeksNeeded,
    suggestedDate: weeksNeeded ? addDays(today, weeksNeeded * 7) : null,
    commitments,
    milestones: TIERS.slice(1).map((tier) => {
      const target = milestoneCents(targetCents, tier.percent);
      return { key: tier.key, name: tier.name, percent: tier.percent, targetCents: target, awayCents: Math.max(0, target - progressCents), reached: progressCents >= target };
    }),
  };
}

/** For each milestone, the first planned week whose cumulative total reaches it. */
export function projectMilestones(basis, amounts) {
  let running = basis.progressCents;
  const cumulative = amounts.map((a) => (running += a));
  return basis.milestones.map((m) => {
    if (m.reached) return { ...m, week: 0, date: null };
    const index = cumulative.findIndex((total) => total >= m.targetCents);
    return { ...m, week: index === -1 ? null : index + 1, date: index === -1 ? null : basis.dates[index] };
  });
}

/** Every dollar figure a plan's prose may cite. Anything else is treated as fabricated. */
export function allowedAmounts(basis, amounts = []) {
  const set = new Set([0, basis.targetCents, basis.startingCents, basis.confirmedCents, basis.progressCents, basis.remainingCents,
    basis.weeklyBudgetCents, basis.maxReachableCents, basis.plannedCents, basis.shortfallCents, basis.requiredWeeklyCents]);
  let commitmentsTotal = 0;
  for (const c of basis.commitments) { set.add(c.amountCents); commitmentsTotal += c.amountCents; }
  set.add(commitmentsTotal);
  const milestoneTargets = [basis.progressCents, ...basis.milestones.map((m) => m.targetCents)];
  for (const m of basis.milestones) { set.add(m.targetCents); set.add(m.awayCents); }
  for (let i = 0; i < milestoneTargets.length; i++) {
    for (let j = i + 1; j < milestoneTargets.length; j++) set.add(Math.abs(milestoneTargets[j] - milestoneTargets[i]));
  }
  let sum = 0;
  for (const a of amounts) { set.add(a); sum += a; set.add(sum); set.add(basis.progressCents + sum); }
  set.add(basis.remainingCents - sum);
  return set;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const word = (n) => (['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n));
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Built-in, deterministic schedule: even whole-dollar weeks within the chosen weekly amount. */
export function rulesAmounts(basis) {
  const { weeks, remainingCents, weeklyBudgetCents, feasible } = basis;
  if (!feasible) return Array(weeks).fill(weeklyBudgetCents);
  const even = Math.ceil(remainingCents / weeks / 100) * 100;
  const weekly = Math.min(weeklyBudgetCents, Math.max(even, 0));
  let left = remainingCents;
  return Array.from({ length: weeks }, () => {
    const amount = Math.min(weekly, left);
    left -= amount;
    return amount;
  });
}

/** Plain-language explanation with arithmetic that only cites figures derived from the inputs. */
export function buildPlanText(basis, amounts, { edited = false } = {}) {
  const f = (c) => formatCents(c, basis.currency);
  const sum = amounts.reduce((a, b) => a + b, 0);
  const shortfall = basis.remainingCents - sum;
  const projections = projectMilestones(basis, amounts);
  const castle = projections.at(-1);
  const distinct = [...new Set(amounts.filter((a) => a > 0))];
  const steady = distinct.length === 1 ? distinct[0] : null;
  const count = amounts.filter((a) => a > 0).length;

  let headline;
  if (basis.remainingCents === 0) headline = 'The goal is already reached';
  else if (shortfall === 0) headline = steady !== null ? `${capital(word(count))} weeks of ${f(steady)} reaches the Castle` : `This schedule reaches the Castle by week ${castle.week}`;
  else headline = `${f(shortfall)} short by ${formatDate(basis.planEndDate)}`;

  const summary = basis.remainingCents === 0
    ? `You've tracked ${f(basis.progressCents)} of your ${f(basis.targetCents)} ${basis.goalName}. No more contributions are needed.`
    : `You've tracked ${f(basis.progressCents)} of your ${f(basis.targetCents)} ${basis.goalName}. `
      + (shortfall === 0
        ? `This plan covers the remaining ${f(basis.remainingCents)} by ${formatDate(basis.planEndDate)}.`
        : `${edited ? 'This edited plan' : `Setting aside ${f(basis.weeklyBudgetCents)} a week`} covers ${f(sum)}, leaving ${f(shortfall)} to find.`);

  const explanation = [
    `Goal ${f(basis.targetCents)} − tracked progress ${f(basis.progressCents)} = ${f(basis.remainingCents)} still to save.`,
    `${capital(word(basis.weeks))} weekly contribution${basis.weeks === 1 ? '' : 's'} fit before your target date (${formatDate(basis.targetDate)}).`,
  ];
  if (basis.remainingCents > 0) {
    explanation.push(`${f(basis.remainingCents)} ÷ ${basis.weeks} week${basis.weeks === 1 ? '' : 's'} needs at least ${f(basis.requiredWeeklyCents)} a week; you chose to set aside ${f(basis.weeklyBudgetCents)}.`);
    explanation.push(`The schedule totals ${f(sum)}, so the shortfall is ${f(Math.max(0, shortfall))}.`);
  }

  const milestoneNotes = projections.map((p) => ({
    milestone: p.key,
    note: p.reached ? `${p.name} (${f(p.targetCents)}) is already reached.`
      : p.week ? `${p.name} (${f(p.targetCents)}) is ${f(p.awayCents)} away, reached in week ${p.week}.`
        : `${p.name} (${f(p.targetCents)}) is not reached by this schedule.`,
  }));

  const cautions = [
    'Nothing is paid automatically. Each contribution needs an adult’s approval in PayPal.',
    'This tracks progress toward one goal. It is not a bank balance or savings account.',
  ];
  if (basis.commitments.length) {
    cautions.push(`Commitments you listed (${basis.commitments.map((c) => `${c.label} ${f(c.amountCents)} a ${c.cadence === 'weekly' ? 'week' : 'month'}`).join(', ')}) stay separate and aren't counted as savings.`);
  }
  if (shortfall > 0 && basis.weeksNeeded) {
    cautions.push(`To close the gap, raise the weekly amount to ${f(basis.requiredWeeklyCents)}, or move the date to ${formatDate(basis.suggestedDate)}.`);
  } else if (shortfall > 0) {
    cautions.push(`To close the gap, choose a weekly amount of at least ${f(basis.requiredWeeklyCents)}.`);
  }

  return {
    headline,
    summary,
    explanation,
    milestoneNotes,
    cautions,
    contributions: amounts.map((amountCents, i) => ({ week: i + 1, date: basis.dates[i], amountCents, note: '' })),
    claimedTotals: { plannedCents: sum, shortfallCents: Math.max(0, shortfall), feasible: shortfall <= 0 },
  };
}
