// The family's next step through the existing House → Plan → Contribute → receipt/rewards flow, derived only from saved
// server state (and, for a receipt, the server's answer in this session). Shared and dependency-free so it can be tested
// in Node. It never decides money: it only explains what the existing state means and which existing step to open.
import { TIERS, formatCents, formatPercent, milestoneCents, milestoneTargets, nextMilestone, tierForProgress } from './rules.js';
import { ESTATE_MILESTONES } from './rewards.js';

const COUNTED = new Set(['completed', 'refunded', 'partially_refunded']);
const NOT_COUNTED = { approval_canceled: 'canceled before approval', declined: 'declined', failed: 'not completed', rejected: 'rejected because it did not match' };

const dateLabel = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const kindOf = (c) => (c.simulated ? 'simulated example payment' : 'PayPal sandbox payment (test money)');

/**
 * What a contribution of `cents` would do *if the server confirms it*, using only the shared milestone rules.
 * `builtTier` and `earned` (achievement keys) separate a milestone that would rise from one already standing as a keepsake.
 */
export function contributionProjection({ progressCents, targetCents, builtTier = 0, earned = [] }, cents) {
  const afterCents = progressCents + cents;
  const before = tierForProgress(progressCents, targetCents), reached = tierForProgress(afterCents, targetCents);
  const homes = milestoneTargets(targetCents).filter((t) => t.index > before && t.index <= reached);
  const keys = new Set(earned);
  const additions = ESTATE_MILESTONES.filter((r) => {
    const at = milestoneCents(targetCents, r.percent);
    return progressCents < at && afterCents >= at;
  });
  return {
    beforeCents: progressCents,
    afterCents,
    percent: formatPercent(afterCents, targetCents),
    rises: homes.filter((t) => t.index > builtTier).map((t) => t.name),
    alreadyStanding: homes.filter((t) => t.index <= builtTier).map((t) => t.name),
    additions: additions.filter((r) => !keys.has(`estate:${r.key}`)).map((r) => r.name),
    completes: afterCents >= targetCents,
    next: nextMilestone(afterCents, targetCents),
  };
}

/**
 * One next step, with the reasons for it and the existing step it opens. Opening a step never writes anything:
 * making or accepting a plan, approving and paying stay the existing explicit buttons.
 * @param state the server's /api/state view
 * @param options.persona the example persona acting now ({ name, role })
 * @param options.receipt the contribution the server just answered with in this session, if any
 * @param options.receiptReviewed whether that receipt has been shown to the family
 */
export function nextAction(state, { persona = null, receipt = null, receiptReviewed = false } = {}) {
  const { household, goal, progress, plan, acceptedPlanId, nextStep, contributions = [], board } = state;
  const money = (cents) => formatCents(cents, goal.currency);
  // The latest saved payment record, from durable state, so a returning family can always get back to it in the Ledger.
  // It is a secondary link: never shown when the step itself opens the Ledger or the receipt.
  const latestRecord = contributions[0] ? { contributionId: contributions[0].id, amountCents: contributions[0].amountCents, status: contributions[0].status, simulated: contributions[0].simulated } : null;
  const step = (key, tab, title, why, cta, target) => ({ key, step: tab, title, why: why.filter(Boolean), cta, target,
    record: ['payment-pending', 'receipt-ready'].includes(key) ? null : latestRecord });

  if (!household.setupComplete) {
    return step('found-house', 'house', 'Found your house', ['Choose solo or family, a house name and a crest. Nothing is paid here.'], 'Set up your house', '#house-heading');
  }
  if (progress.remainingCents <= 0) {
    return step('goal-complete', 'realm', 'The goal is complete', [`${money(progress.progressCents)} of ${money(goal.targetCents)} is tracked toward ${goal.name}. The castle stands.`],
      'Visit your castle', '#realm-districts [data-district="castle"]');
  }
  // A capture PayPal still reports as pending is the one unfinished payment a family can follow up.
  const pending = contributions.find((c) => c.status === 'pending');
  if (pending) {
    return step('payment-pending', 'ledger', 'A payment is still pending', [
      `${money(pending.amountCents)} (${kindOf(pending)}) is not counted until it completes. Goal progress is still ${money(progress.progressCents)}.`,
      'Its status and the next check are in the Ledger.',
    ], 'Check the pending payment', '#ledger-contrib-title');
  }
  if (receipt && !receiptReviewed) {
    const c = contributions.find((x) => x.id === receipt.id) ?? receipt;
    if (c.status === 'completed') {
      return step('receipt-ready', 'give', `${money(c.amountCents)} was confirmed`, [
        `The server counted this ${kindOf(c)}. Goal progress is now ${money(progress.progressCents)} (${formatPercent(progress.progressCents, goal.targetCents)}).`,
      ], 'Review the receipt', '#receipt');
    }
  }

  // Supporting facts that must not read as credit.
  const notes = [];
  const latest = contributions[0];
  if (latest && NOT_COUNTED[latest.status]) notes.push(`Your last payment of ${money(latest.amountCents)} was ${NOT_COUNTED[latest.status]}, so it was not counted.`);
  if (latest && ['created', 'creating'].includes(latest.status)) notes.push(`A ${money(latest.amountCents)} PayPal sandbox order was not finished, so nothing was counted.`);
  const refunded = contributions.find((c) => ['refunded', 'partially_refunded'].includes(c.status));
  if (refunded && latest === refunded) notes.push(`${money(refunded.amountCents)} was ${refunded.status === 'refunded' ? 'refunded' : 'partly refunded'}; goal progress went down by the refunded amount.`);
  if (board.builtTierCommemorative) {
    notes.push(`The ${TIERS[board.builtTier].name} stands as a keepsake from an earlier milestone. That money is not in the goal now: current progress is ${money(progress.progressCents)}.`);
  }

  if (!plan) {
    return step('make-plan', 'plan', 'Make a plan', [
      'Set the goal, a target date and the weekly amount you choose. The planner shows its arithmetic, and nothing is paid.', ...notes,
    ], 'Make your plan', '#plan-heading');
  }
  if (plan.id !== acceptedPlanId) {
    return step('review-plan', 'plan', 'Review your plan', [
      `“${plan.headline}.” Check the weeks, change any amount, then choose “Use this plan”. Nothing is paid.`, ...notes,
    ], 'Review your plan', '#plan-headline');
  }

  const approval = persona?.role === 'adult' ? null : `${persona?.name ?? 'This persona'} is a child persona: switch “Acting as” to an adult to approve a payment.`;
  const milestone = board.nextMilestone ? `The ${board.nextMilestone.name} needs ${money(board.nextMilestone.awayCents)} more.` : null;
  if (nextStep?.week) {
    return step('contribute-week', 'give', `Week ${nextStep.week}: add ${money(nextStep.dueCents)}`, [
      `Your plan sets ${money(nextStep.plannedCents)} for ${dateLabel(nextStep.date)}.${milestone ? ` ${milestone}` : ''}`, approval, ...notes,
    ], 'Choose a contribution', '#give-heading');
  }
  return step('contribute-more', 'give', 'Your planned weeks are covered', [
    `${money(progress.remainingCents)} is still needed for ${goal.name}.${milestone ? ` ${milestone}` : ''}`, approval, ...notes,
  ], 'Choose a contribution', '#give-heading');
}

/** True when a contribution's money is part of the goal ledger (possibly reduced by a refund). */
export const isCounted = (contribution) => COUNTED.has(contribution.status);
