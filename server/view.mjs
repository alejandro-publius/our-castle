import {
  ROUTE_LENGTH, TIERS, milestoneSpaces, milestoneTargets, nextMilestone, percentTenths, positionForProgress, spaceName, tierForProgress,
} from '../src/core/rules.js';
import {
  builtTier, gardenCount, getAchievements, getActiveGoal, getHousehold, getMembers, ledgerEntries, progressFor,
} from './household.mjs';
import { publicModes } from './config.mjs';
import { MAX_CONTRIBUTION_CENTS, MIN_CONTRIBUTION_CENTS } from './payments/contributions.mjs';

const GOAL_KINDS = new Set(['starting_progress', 'contribution', 'refund', 'simulated_contribution', 'simulated_refund']);

/** Where the household is in its accepted plan, from progress credited since the plan was made. */
function planNextStep(plan, entries) {
  if (!plan || plan.status !== 'accepted') return null;
  const since = entries
    .filter((e) => e.createdAt >= plan.createdAt && ['contribution', 'refund', 'simulated_contribution', 'simulated_refund'].includes(e.kind))
    .reduce((sum, e) => sum + e.effect * e.amountCents, 0);
  let cumulative = 0;
  for (const week of plan.contributions) {
    cumulative += week.amountCents;
    if (week.amountCents > 0 && cumulative > since) {
      return { week: week.week, date: week.date, plannedCents: week.amountCents, dueCents: Math.min(week.amountCents, cumulative - since), contributedSinceCents: since };
    }
  }
  return { week: null, date: null, plannedCents: 0, dueCents: 0, contributedSinceCents: since, complete: true };
}

export function buildState({ db, householdId, planner, contributions, config }) {
  const household = getHousehold(db, householdId);
  const goal = getActiveGoal(db, householdId);
  const progress = progressFor(db, goal.id);
  const achievements = getAchievements(db, goal.id);
  const entries = ledgerEntries(db, goal.id);
  const plan = planner.current(goal.id);
  const position = positionForProgress(progress.progressCents, goal.targetCents);
  const currentTier = tierForProgress(progress.progressCents, goal.targetCents);
  const built = builtTier(achievements);
  return {
    modes: publicModes(config),
    household,
    members: getMembers(db, householdId),
    goal,
    progress: {
      ...progress,
      remainingCents: Math.max(0, goal.targetCents - progress.progressCents),
      percentTenths: percentTenths(progress.progressCents, goal.targetCents),
      note: 'Goal-progress ledger for this app. Not a bank balance or savings account.',
    },
    board: {
      routeLength: ROUTE_LENGTH,
      position,
      spaceName: spaceName(position),
      milestoneSpaces: milestoneSpaces(goal.targetCents),
      currentTier,
      builtTier: built,
      builtTierCommemorative: built > currentTier,
      gardens: gardenCount(achievements),
      tiers: milestoneTargets(goal.targetCents).map((t) => ({ ...t, reachedNow: progress.progressCents >= t.targetCents, built: t.index <= built })),
      nextMilestone: nextMilestone(progress.progressCents, goal.targetCents),
      tierTitle: TIERS[built].title,
    },
    ledger: {
      goalEntries: entries.filter((e) => GOAL_KINDS.has(e.kind)),
      bills: entries.filter((e) => e.kind === 'bill_paid'),
      gifts: entries.filter((e) => e.kind === 'gift_sent'),
    },
    contributions: contributions.contributions(goal.id),
    contributionLimits: { minCents: MIN_CONTRIBUTION_CENTS, maxCents: MAX_CONTRIBUTION_CENTS },
    achievements,
    plan,
    acceptedPlanId: planner.accepted(goal.id)?.id ?? null,
    nextStep: planNextStep(planner.accepted(goal.id), entries),
  };
}
