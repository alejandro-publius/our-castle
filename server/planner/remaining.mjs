import { formatCents } from '../../src/core/rules.js';
import { addDays, daysBetween, isIsoDate } from '../household.mjs';
import { MAX_PLAN_WEEKS, PlanInputError, computeBasis, formatDate, projectMilestones, rulesAmounts } from './basis.mjs';
import { factsRevision, planFacts } from './facts.mjs';

// The same limits the goal editor (updateGoal) enforces, so any previewed choice can be saved unchanged.
const MIN_DAYS = 7;
const MAX_DAYS = 366;

/**
 * Preview revising only what remains, for a weekly amount and/or date the family explicitly chooses.
 *
 * Deterministic and read-only: it uses current server progress, whole cents, the existing milestone rules and real
 * calendar dates, and returns exactly the schedule the built-in planner would propose if the family saved these values.
 * It never infers income or bill payment, never raises the chosen weekly amount, schedules nothing, leaves earlier
 * contributions and the plan in use alone, and grants nothing. The caller writes nothing.
 */
export function previewRemainingPlan({ goal, progress, today, weeklyBudgetCents, targetDate, planInUseId = null }) {
  const chosenWeekly = weeklyBudgetCents ?? goal.weeklyBudgetCents;
  const chosenDate = targetDate ?? goal.targetDate;
  const issues = [];
  if (!Number.isSafeInteger(chosenWeekly) || chosenWeekly < 0 || chosenWeekly > goal.targetCents) {
    issues.push({ code: 'weekly_amount', message: `The weekly amount must be whole cents between ${formatCents(0, goal.currency)} and the goal amount (${formatCents(goal.targetCents, goal.currency)}).` });
  }
  const days = isIsoDate(chosenDate) ? daysBetween(today, chosenDate) : NaN;
  if (!(days >= MIN_DAYS && days <= MAX_DAYS)) {
    issues.push({ code: 'date', message: targetDate == null && isIsoDate(chosenDate)
      ? `The saved target date (${formatDate(chosenDate)}) is less than a week away. Choose a date between one week and one year from today.`
      : 'Choose a target date between one week and one year from today.' });
  }
  if (issues.length) throw new PlanInputError(issues);

  const facts = planFacts({ goal, progress, today });
  const basis = computeBasis({ goal: { ...goal, weeklyBudgetCents: chosenWeekly, targetDate: chosenDate }, progress, today });
  const { remainingCents, weeks } = basis;
  const reached = remainingCents === 0;
  const amounts = reached ? [] : rulesAmounts(basis);
  const plannedCents = amounts.reduce((sum, a) => sum + a, 0);
  const shortfallCents = remainingCents - plannedCents;
  const weeksNeeded = reached ? 0 : chosenWeekly > 0 ? Math.ceil(remainingCents / chosenWeekly) : null;
  const withinPlanningLimit = weeksNeeded !== null && weeksNeeded <= MAX_PLAN_WEEKS;
  const reach = {
    weeklyCents: chosenWeekly,
    weeksNeeded,
    date: reached ? null : withinPlanningLimit ? addDays(today, weeksNeeded * 7) : null,
    withinPlanningLimit: reached || withinPlanningLimit,
  };
  const outcome = reached ? 'reached' : shortfallCents === 0 ? 'on_track' : chosenWeekly === 0 ? 'no_budget' : 'short';
  const milestones = projectMilestones(basis, amounts).map(({ key, name, percent, targetCents, reached: done, week, date }) => ({
    key, name, percent, targetCents, reached: done, week: done ? 0 : week, date: done ? null : date,
  }));

  return {
    kind: 'remaining-plan-preview',
    saved: false,
    outcome,
    facts: {
      factsRevision: factsRevision(facts),
      today,
      goalId: goal.id,
      goalName: goal.name,
      currency: goal.currency,
      targetCents: goal.targetCents,
      startingCents: progress.startingCents,
      confirmedCents: progress.confirmedNetCents,
      progressCents: progress.progressCents,
      remainingCents,
      overfundedCents: Math.max(0, progress.progressCents - goal.targetCents),
    },
    savedSettings: { weeklyBudgetCents: goal.weeklyBudgetCents, targetDate: goal.targetDate },
    requested: {
      weeklyBudgetCents: chosenWeekly,
      targetDate: chosenDate,
      weeklyBudgetChanged: chosenWeekly !== goal.weeklyBudgetCents,
      targetDateChanged: chosenDate !== goal.targetDate,
    },
    weeks: reached ? 0 : weeks,
    planEndDate: reached ? null : basis.planEndDate,
    schedule: amounts.map((amountCents, i) => ({ week: i + 1, date: basis.dates[i], amountCents })),
    totals: { plannedCents, shortfallCents, feasible: shortfallCents === 0, remainingCents },
    requiredWeeklyCents: reached ? 0 : basis.requiredWeeklyCents,
    reach,
    milestones,
    planInUseId,
    notes: previewNotes({ outcome, basis, plannedCents, shortfallCents, reach, milestones, overfundedCents: Math.max(0, progress.progressCents - goal.targetCents) }),
  };
}

function previewNotes({ outcome, basis, plannedCents, shortfallCents, reach, milestones, overfundedCents }) {
  const f = (cents) => formatCents(cents, basis.currency);
  const weekly = f(basis.weeklyBudgetCents);
  const notes = [];
  if (outcome === 'reached') {
    notes.push(`The goal is already reached: ${f(basis.progressCents)} of ${f(basis.targetCents)} is tracked. No more contributions are needed.`);
    if (overfundedCents > 0) notes.push(`Tracked progress is ${f(overfundedCents)} above the goal amount.`);
  } else if (outcome === 'on_track') {
    const castle = milestones.at(-1);
    notes.push(`Up to ${weekly} a week covers the remaining ${f(basis.remainingCents)} by ${formatDate(castle.date)}.`);
  } else {
    notes.push(outcome === 'no_budget'
      ? `With ${weekly} a week nothing more is planned, so ${f(basis.remainingCents)} stays unplanned.`
      : `${capitalWeeks(basis.weeks)} of ${weekly} by ${formatDate(basis.planEndDate)} cover ${f(plannedCents)}, leaving ${f(shortfallCents)}.`);
    notes.push(`Reaching the goal by ${formatDate(basis.targetDate)} needs at least ${f(basis.requiredWeeklyCents)} a week.`);
    if (outcome === 'short') {
      notes.push(reach.withinPlanningLimit
        ? `At ${weekly} a week the remaining ${f(basis.remainingCents)} is covered by ${formatDate(reach.date)} (${reach.weeksNeeded} weeks).`
        : `At ${weekly} a week the remaining ${f(basis.remainingCents)} needs ${reach.weeksNeeded} weeks, longer than the ${MAX_PLAN_WEEKS}-week planning limit.`);
    }
  }
  notes.push('This is a preview: nothing is saved, the plan in use stays as it is, and no money moves.');
  return notes;
}

const capitalWeeks = (n) => (n === 1 ? 'One week' : `${n} weeks`);
