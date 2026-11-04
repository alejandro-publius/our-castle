import test from 'node:test';
import assert from 'node:assert/strict';
import { ESTATE_MILESTONES, REWARD_STATUSES, buildRewards, estateLevelFor, goalEvidenceLabel, newlyEarnedEstate } from '../../src/core/rewards.js';
import { TIERS, milestoneCents } from '../../src/core/rules.js';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, addSelfReportedEntry, builtTier, gardenCount, getAchievements, getGoal, progressFor } from '../../server/household.mjs';
import { contribution, requestId, setupDomain } from '../helpers/setup.mjs';

// Rewards exactly as the server builds them for /api/state.
function rewardsFor(env, paymentsMode = 'example') {
  const goal = getGoal(env.db, DEMO_GOAL_ID);
  const achievements = getAchievements(env.db, DEMO_GOAL_ID);
  return buildRewards({
    progress: progressFor(env.db, DEMO_GOAL_ID), targetCents: goal.targetCents, currency: goal.currency, achievements,
    builtTier: builtTier(achievements), gardenCount: gardenCount(achievements), paymentsMode,
  });
}
const status = (rewards, id) => rewards.entries.find((r) => r.id === id).status;
const zeroProgress = { startingCents: 0, contributedCents: 0, refundedCents: 0, simulatedContributedCents: 0, simulatedRefundedCents: 0, progressCents: 0 };

test('home tiers keep their 0/25/60/100% thresholds; estate additions sit between them at 10/40/80%', () => {
  assert.deepEqual(TIERS.map((t) => t.percent), [0, 25, 60, 100]);
  assert.deepEqual(ESTATE_MILESTONES.map((r) => [r.key, r.percent, r.level]), [['porch', 10, 1], ['market', 40, 2], ['ramparts', 80, 3]]);
  const rewards = buildRewards({ progress: zeroProgress, targetCents: 30000 });
  assert.deepEqual(rewards.entries.slice(0, 7).map((r) => [r.id, r.requiredCents]), [
    ['home:cottage', 0], ['estate:porch', 3000], ['home:manor', 7500], ['estate:market', 12000],
    ['home:keep', 18000], ['estate:ramparts', 24000], ['home:castle', 30000],
  ]);
  // Thresholds round up to whole cents, like the home tiers.
  assert.equal(buildRewards({ progress: zeroProgress, targetCents: 333 }).entries.find((r) => r.id === 'estate:porch').requiredCents, milestoneCents(333, 10));
  assert.equal(milestoneCents(333, 10), 34);
  for (const r of rewards.entries) assert.ok(REWARD_STATUSES.includes(r.status), `${r.id} uses the shared status vocabulary`);
});

test('each estate addition unlocks exactly at its threshold, never one cent early', () => {
  const at = (cents) => buildRewards({ progress: { ...zeroProgress, startingCents: cents, progressCents: cents }, targetCents: 30000 });
  assert.equal(status(at(2999), 'estate:porch'), 'locked');
  assert.equal(status(at(3000), 'estate:porch'), 'unlocked');
  assert.equal(at(2999).estateLevel, 0);
  assert.equal(at(3000).estateLevel, 1);
  assert.equal(at(11999).estateLevel, 1);
  assert.equal(at(12000).estateLevel, 2);
  assert.equal(at(24000).estateLevel, 3);
  const porch = at(1800).entries.find((r) => r.id === 'estate:porch');
  assert.deepEqual([porch.progressCents, porch.requiredCents, porch.remainingCents], [1800, 3000, 1200]);
  assert.match(porch.condition, /10% of the shared goal \(\$30\.00 tracked\)/);
});

test('the evidence label never calls simulated or reported money "confirmed by PayPal"', () => {
  const simulatedOnly = goalEvidenceLabel({ ...zeroProgress, startingCents: 6000, simulatedContributedCents: 4500, progressCents: 10500 });
  assert.equal(simulatedOnly, 'Goal ledger: $60.00 reported by you + $45.00 from simulated example payments');
  assert.doesNotMatch(simulatedOnly, /PayPal/);
  const sandbox = goalEvidenceLabel({ ...zeroProgress, startingCents: 6000, contributedCents: 3000, refundedCents: 1500, progressCents: 7500 });
  assert.equal(sandbox, 'Goal ledger: $60.00 reported by you + $15.00 confirmed by PayPal sandbox captures');
  assert.equal(goalEvidenceLabel(zeroProgress), 'Goal ledger: nothing tracked yet');
});

test('estate additions are earned with the tier awards, survive a refund as keepsakes, and keep the ledger arithmetic', () => {
  const env = setupDomain();
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 6000);
  assert.equal(status(rewardsFor(env), 'estate:porch'), 'unlocked', '$60 of $300 already passes the 10% porch');

  const manor = env.service.simulateContribution(contribution({ amountCents: 1500 }));
  assert.deepEqual(manor.awarded, [1], 'tier awards are reported exactly as before');
  const big = env.service.simulateContribution(contribution({ amountCents: 4500 }));
  assert.equal(big.progress.progressCents, 12000);
  let rewards = rewardsFor(env);
  assert.equal(status(rewards, 'estate:market'), 'unlocked');
  assert.equal(rewards.estateLevel, 2);
  assert.ok(getAchievements(env.db, DEMO_GOAL_ID).some((a) => a.key === 'estate:market'));

  const captureId = big.contribution.captures.find((c) => c.credited).captureId;
  const refunded = env.service.simulateRefund({ captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
  assert.equal(refunded.progress.progressCents, 7500, 'the refund lowers current progress by exactly its amount');
  rewards = rewardsFor(env);
  assert.equal(status(rewards, 'estate:market'), 'keepsake', 'the village quarter stays as a labeled keepsake');
  assert.equal(rewards.estateLevel, 2, 'the world keeps the keepsake');
  const market = rewards.entries.find((r) => r.id === 'estate:market');
  assert.equal(market.remainingCents, 4500, 'the card still shows the real distance to the condition');
  const p = progressFor(env.db, DEMO_GOAL_ID);
  assert.equal(p.progressCents, p.startingCents + p.simulatedContributedCents - p.simulatedRefundedCents);
});

test('a replayed contribution request credits once and awards each addition once', () => {
  const env = setupDomain();
  const input = contribution({ amountCents: 6000 });
  const first = env.service.simulateContribution(input);
  const before = getAchievements(env.db, DEMO_GOAL_ID).map((a) => a.key);
  const replay = env.service.simulateContribution(input);
  assert.equal(replay.outcome, 'already_processed');
  assert.equal(replay.progress.progressCents, first.progress.progressCents);
  const after = getAchievements(env.db, DEMO_GOAL_ID).map((a) => a.key);
  assert.deepEqual(after, before);
  assert.equal(after.filter((k) => k === 'estate:market').length, 1);
});

test('PayPal-confirmed sandbox progress is labeled as such and unlocks the same additions', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  const created = await env.service.createPayPalOrder(contribution({ amountCents: 6000 }));
  const captured = await env.service.capturePayPalOrder({ providerOrderId: created.orderId, householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID });
  assert.equal(captured.progress.progressCents, 12000);
  const rewards = rewardsFor(env, 'sandbox');
  assert.equal(status(rewards, 'estate:market'), 'unlocked');
  assert.match(rewards.entries[0].sourceLabel, /\$60\.00 confirmed by PayPal sandbox captures/);
  assert.equal(rewards.paymentEvidenceLabel, 'PayPal sandbox confirmations use test money.');
});

test('recorded bills grow the habit garden only; bill-provider rewards stay locked and savings do not change', () => {
  const env = setupDomain();
  const before = progressFor(env.db, DEMO_GOAL_ID).progressCents;
  addSelfReportedEntry(env.db, { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, kind: 'bill_paid', amountCents: 14200, label: 'SDG&E electricity bill', memberId: 'm_rowan' }, env.clock);
  const rewards = rewardsFor(env);
  assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, before, 'paying a bill never adds to saved progress');
  const garden = rewards.entries.find((r) => r.id === 'habit:garden');
  assert.equal(garden.status, 'unlocked');
  assert.equal(garden.source, 'self_reported');
  assert.match(garden.sourceLabel, /Recorded by you · not verified by any provider/);
  for (const id of ['bill:electricity', 'bill:water']) {
    const reward = rewards.entries.find((r) => r.id === id);
    assert.equal(reward.status, 'connection_required', `${id} stays locked even after a bill named "SDG&E" is recorded`);
    assert.equal(reward.providerVerified, false);
  }
  assert.deepEqual(rewards.billVerification, { connected: false, status: 'not_connected', providers: [], note: rewards.billVerification.note });
  assert.ok(rewards.entries.every((r) => r.providerVerified === false), 'no reward claims provider verification');
});

test('estateLevelFor keeps the highest earned level and ignores unrelated achievements', () => {
  assert.equal(estateLevelFor([{ key: 'estate:ramparts' }], 0, 30000), 3);
  assert.equal(estateLevelFor([{ key: 'garden:1' }, { key: 'tier:3' }], 0, 30000), 0);
  assert.equal(estateLevelFor([], 12000, 30000), 2);
  assert.equal(requestId().startsWith('test-request-'), true);
});

test('only a real locked -> unlocked change announces an estate addition; replay, reload, refund and re-crossing do not', () => {
  const env = setupDomain();
  const start = rewardsFor(env);
  const crossed = env.service.simulateContribution(contribution({ amountCents: 6000 }));
  const afterCross = rewardsFor(env);
  assert.deepEqual(newlyEarnedEstate(start, afterCross).map((r) => r.id), ['estate:market']);
  assert.deepEqual(newlyEarnedEstate(null, afterCross), [], 'a first load or reload has no previous state');
  assert.deepEqual(newlyEarnedEstate(afterCross, rewardsFor(env)), [], 'the same state again (a replayed capture) announces nothing');

  const captureId = crossed.contribution.captures.find((c) => c.credited).captureId;
  env.service.simulateRefund({ captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
  const afterRefund = rewardsFor(env);
  assert.deepEqual(newlyEarnedEstate(afterCross, afterRefund), [], 'a refund turns unlocked into keepsake; nothing is announced');
  env.service.simulateContribution(contribution({ amountCents: 6000 }));
  assert.deepEqual(newlyEarnedEstate(afterRefund, rewardsFor(env)), [], 'crossing again after a refund is not a new reward');
  // A preview never produces a new server state, so it cannot reach this comparison at all.
});
