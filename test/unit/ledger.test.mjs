import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import {
  DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, addSelfReportedEntry, getAchievements, getGoal, progressFor, setupHousehold, updateGoal,
} from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

test('example household starts with $60 of user-reported progress toward a $300 goal', () => {
  const { db } = setupDomain();
  const p = progressFor(db, DEMO_GOAL_ID);
  assert.equal(p.startingCents, 6000);
  assert.equal(p.progressCents, 6000);
  assert.equal(getGoal(db, DEMO_GOAL_ID).targetCents, 30000);
  assert.equal(getGoal(db, DEMO_GOAL_ID).targetDate, '2026-12-29');
});

test('bills and gifts are recorded separately and never count as savings', () => {
  const { db, clock } = setupDomain();
  addSelfReportedEntry(db, { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, kind: 'bill_paid', amountCents: 6000, label: 'Internet bill', memberId: 'm_rowan' }, clock);
  addSelfReportedEntry(db, { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, kind: 'gift_sent', amountCents: 2500, label: 'Birthday gift' }, clock);
  const p = progressFor(db, DEMO_GOAL_ID);
  assert.equal(p.progressCents, 6000, 'progress unchanged by bills and gifts');
  assert.deepEqual(p.bills, { count: 1, totalCents: 6000 });
  assert.deepEqual(p.gifts, { count: 1, totalCents: 2500 });
  assert.ok(getAchievements(db, DEMO_GOAL_ID).some((a) => a.key === 'garden:1'), 'a bill habit plants a garden');
  assert.ok(!getAchievements(db, DEMO_GOAL_ID).some((a) => a.key.startsWith('tier:')), 'but no house tier');
});

test('the database itself refuses a bill or gift entry that would count toward the goal', () => {
  const { db } = setupDomain();
  assert.throws(() => db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, created_at)
    VALUES (?, ?, 'bill_paid', 1, 5000, 'USD', 'user-reported', 'bad-bill', '2026-11-03')`).run(DEMO_HOUSEHOLD_ID, DEMO_GOAL_ID), /CHECK constraint/);
  assert.throws(() => db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, created_at)
    VALUES (?, ?, 'refund', 1, 5000, 'USD', 'paypal-sandbox', 'bad-refund', '2026-11-03')`).run(DEMO_HOUSEHOLD_ID, DEMO_GOAL_ID), /CHECK constraint/);
});

test('ledger, receipts and milestones persist after the database is closed and reopened', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-house-'));
  const file = path.join(dir, 'persist.sqlite');
  try {
    const first = setupDomain({ file });
    const result = first.service.simulateContribution(contribution({ amountCents: 1500 }));
    assert.equal(result.outcome, 'completed');
    first.db.close();

    const db = openDatabase(file);
    assert.equal(progressFor(db, DEMO_GOAL_ID).progressCents, 7500);
    assert.ok(getAchievements(db, DEMO_GOAL_ID).some((a) => a.key === 'tier:1'));
    assert.equal(db.prepare("SELECT status FROM payment_orders").get().status, 'completed');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('goal edits validate whole cents, dates and starting progress, and supersede old plans', () => {
  const { db, clock } = setupDomain();
  const base = { name: 'Camping trip fund', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-29' };
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, { ...base, targetCents: 300.5 }, clock), /between \$1.00/);
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, { ...base, startingCents: 40000 }, clock), /Starting progress/);
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, { ...base, targetDate: '2026-11-05' }, clock), /one week/);
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, { ...base, targetDate: '2026-02-30' }, clock), /target date/);
  updateGoal(db, DEMO_GOAL_ID, { ...base, startingCents: 9000 }, clock);
  assert.equal(progressFor(db, DEMO_GOAL_ID).startingCents, 9000);
  assert.ok(getAchievements(db, DEMO_GOAL_ID).some((a) => a.key === 'tier:1'), '$90 of $300 already meets the Manor milestone');
});

test('members cannot be switched between solo and family after a contribution', () => {
  const { db, service } = setupDomain();
  service.simulateContribution(contribution());
  assert.throws(() => setupHousehold(db, DEMO_HOUSEHOLD_ID, { playMode: 'solo', name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } }), /Members can’t change/);
});
