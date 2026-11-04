import test from 'node:test';
import assert from 'node:assert/strict';
import { COURT_CAST, courtForTier, courtPose, courtResidents } from '../../src/core/court.js';
import { buildRewards } from '../../src/core/rewards.js';

test('larger home tiers unlock a growing cast with distinct royal guests', () => {
  assert.deepEqual([0, 1, 2, 3].map((tier) => courtForTier(tier).capacity), [2, 6, 12, 20]);
  assert.deepEqual([0, 1, 2, 3].map((tier) => courtForTier(tier).princesses.length), [0, 1, 2, 3]);
  assert.equal(new Set(COURT_CAST.map((p) => p.id)).size, 20);
  assert.ok(courtResidents(3).some((p) => p.role === 'musician'));
  assert.ok(courtResidents(3).some((p) => p.role === 'gardener'));
  assert.deepEqual(courtResidents(2).slice(0, 6), courtResidents(1), 'existing guests remain as more arrive');
  assert.equal(courtResidents(-1).length, 2);
  assert.equal(courtResidents(99).length, 20);
  assert.equal(courtResidents(NaN).length, 2);
});

test('every guest stays on a safe, continuous lane through many walk-and-pause cycles', () => {
  for (const person of COURT_CAST) {
    let previous = courtPose(person, 0);
    let moved = false, paused = false;
    for (let i = 1; i <= 2000; i++) {
      const pose = courtPose(person, i * .25);
      const distance = Math.hypot(pose.x - previous.x, pose.z - previous.z);
      assert.ok(distance < .151, `${person.id} never teleports at a stop, reversal or loop boundary`);
      assert.ok(Math.abs(pose.x) < 12.5 && Math.abs(pose.z) < 11, 'inside the estate');
      assert.ok(Math.abs(pose.x) > 9 || pose.z > 7.5, 'outside the castle walls and moat');
      assert.ok(!(pose.x > 6 && pose.x < 11.6 && pose.z > 1 && pose.z < 7.3), 'outside the market buildings');
      assert.ok(Math.hypot(pose.x + 9.2, pose.z - 3.2) > 2, 'clear of the water-reward fountain');
      assert.ok(Number.isFinite(pose.heading));
      moved ||= distance > .02;
      paused ||= !pose.moving;
      previous = pose;
    }
    assert.ok(moved && paused, `${person.name} both strolls and stops to visit`);
  }
});

test('court size follows the built keepsake home, while locked previews and bill conditions stay honest', () => {
  const progress = { startingCents: 6000, contributedCents: 0, refundedCents: 0, progressCents: 6000 };
  const rewards = buildRewards({ progress, targetCents: 30000, builtTier: 2 });
  assert.equal(courtForTier(2).capacity, 12, 'a kept home retains its guests after a refund');
  const manor = rewards.entries.find((r) => r.id === 'home:manor');
  const keep = rewards.entries.find((r) => r.id === 'home:keep');
  const castle = rewards.entries.find((r) => r.id === 'home:castle');
  assert.equal(manor.status, 'keepsake');
  assert.equal(keep.court.capacity, 12);
  assert.equal(castle.court.capacity, 20, 'a locked card explains its future court');
  assert.equal(castle.status, 'locked', 'describing that future court does not earn it');
  for (const r of rewards.entries.filter((r) => r.id.startsWith('bill:'))) {
    assert.equal(r.status, 'connection_required');
    assert.equal(r.providerVerified, false);
  }
  assert.equal(progress.progressCents, 6000);
});
