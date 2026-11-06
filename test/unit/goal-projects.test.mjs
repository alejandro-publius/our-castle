import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import {
  DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, DomainError, createClock, getAchievements, getGoal, ledgerEntries, progressFor, updateGoal, updateGoalProject,
} from '../../server/household.mjs';
import { createPlanner } from '../../server/planner/index.mjs';
import { PlannerProviderError } from '../../server/planner/anthropic-provider.mjs';
import { merchantGoalRevision, saveGoalFromItem } from '../../server/merchant/goal-item.mjs';
import { FIXED_NOW, setupDomain } from '../helpers/setup.mjs';

// What the goal builds in the meadow (Campsite / Garden / Schoolhouse): an explicit, validated family choice saved with
// the goal. It is a picture only; these checks pin that it never moves money, dates, plans, milestones or provider calls.
const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = (db) => ({
  goal: (({ projectKind, ...rest }) => rest)(getGoal(db, DEMO_GOAL_ID)),
  progress: progressFor(db, DEMO_GOAL_ID),
  achievements: getAchievements(db, DEMO_GOAL_ID),
  ledger: ledgerEntries(db, DEMO_GOAL_ID),
  plans: db.prepare('SELECT id, status, plan_json, basis_json FROM plans ORDER BY rowid').all().map((r) => ({ ...r })),
  goalItems: db.prepare('SELECT * FROM goal_items').all().map((r) => ({ ...r })),
  orders: db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n,
});
const goalInput = (db, extra = {}) => {
  const g = getGoal(db, DEMO_GOAL_ID);
  return { name: g.name, targetCents: g.targetCents, startingCents: progressFor(db, g.id).startingCents, weeklyBudgetCents: g.weeklyBudgetCents, targetDate: g.targetDate, ...extra };
};

test('upgrading an existing database keeps every goal a campsite and changes nothing else (temporary file only)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-goal-projects-'));
  const file = path.join(dir, 'before-upgrade.sqlite');
  try {
    // A database exactly as the previous release left it: the earlier migrations, an existing goal and an accepted plan.
    const old = new DatabaseSync(file);
    const before5 = MIGRATIONS.findIndex((sql) => sql.includes('ADD COLUMN project_kind'));
    MIGRATIONS.slice(0, before5).forEach((sql, i) => { old.exec(sql); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at)
      VALUES ('hh_old', 'House of Alder', 'family', 'cobalt', 'stag', 1, 1, '2026-11-01T12:00:00.000Z');
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at)
      VALUES ('goal_old', 'hh_old', 'Garden shed fund', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T12:00:00.000Z');
      INSERT INTO plans (id, goal_id, source, inputs_json, basis_json, plan_json, status, created_at)
      VALUES ('plan_old', 'goal_old', 'rules', '{}', '{}', '{}', 'accepted', '2026-11-01T12:00:00.000Z');`);
    const before = old.prepare('SELECT * FROM goals').get();
    assert.equal(old.prepare('PRAGMA user_version').get().user_version, before5);
    old.close();

    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    const after = db.prepare('SELECT * FROM goals').get();
    assert.deepEqual({ ...after }, { ...before, project_kind: 'campsite' }, 'only the new column, set to the campsite');
    // Never inferred from the goal's name: "Garden shed fund" is still a campsite until the family chooses otherwise.
    assert.equal(getGoal(db, 'goal_old').projectKind, 'campsite');
    assert.equal(db.prepare('SELECT status FROM plans').get().status, 'accepted');
    // The database itself refuses anything but the listed choices.
    assert.throws(() => db.prepare("UPDATE goals SET project_kind = 'castle'").run(), /CHECK constraint/);
    db.close();
    // Opening again runs nothing twice.
    const again = openDatabase(file);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.equal(getGoal(again, 'goal_old').projectKind, 'campsite');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('choosing the project changes only the picture: figures, plans (the accepted one too), milestones and ledger stay', () => {
  const { db, clock } = setupDomain();
  const planner = createPlanner({ db, clock });
  const { plan } = planner.proposeRules({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] });
  planner.accept({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, planId: plan.id });
  const reviewBefore = planner.review(DEMO_GOAL_ID);
  const before = snapshot(db);
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'campsite', 'new example households start as a campsite');

  for (const kind of ['garden', 'schoolhouse', 'campsite', 'garden']) {
    assert.equal(updateGoalProject(db, DEMO_GOAL_ID, kind).projectKind, kind);
    assert.deepEqual(snapshot(db), before, `${kind}: nothing else changed`);
  }
  assert.deepEqual(planner.review(DEMO_GOAL_ID), reviewBefore, 'the accepted plan still matches its facts');
  assert.equal(planner.accepted(DEMO_GOAL_ID).id, plan.id);

  for (const bad of ['castle', 'Garden', 'school house', '', null, 7, { kind: 'garden' }, ['garden']]) {
    assert.throws(() => updateGoalProject(db, DEMO_GOAL_ID, bad), (e) => e instanceof DomainError && e.status === 400 && e.code === 'invalid_project', JSON.stringify(bad));
  }
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'garden', 'a refused choice leaves the saved one');
  assert.deepEqual(snapshot(db), before);
  assert.throws(() => updateGoalProject(db, 'goal_missing', 'garden'), (e) => e.status === 404);
  db.close();
});

test('with a goal edit the choice is saved by the same validated update, all or nothing; left out, it is kept', () => {
  const { db, clock } = setupDomain();
  const before = snapshot(db);
  // An unsupported choice beside valid new figures: refused before anything is written.
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, goalInput(db, { targetCents: 45000, projectKind: 'castle' }), clock), (e) => e.code === 'invalid_project');
  assert.deepEqual(snapshot(db), before, 'no partial update');
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'campsite');
  // Valid figures and a valid choice are saved together.
  updateGoal(db, DEMO_GOAL_ID, goalInput(db, { targetCents: 45000, projectKind: 'schoolhouse' }), clock);
  assert.equal(getGoal(db, DEMO_GOAL_ID).targetCents, 45000);
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'schoolhouse');
  // A later edit that does not mention the choice keeps it.
  updateGoal(db, DEMO_GOAL_ID, goalInput(db, { weeklyBudgetCents: 2500 }), clock);
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'schoolhouse');
  // Invalid figures with a valid choice: the existing validation refuses the whole edit.
  assert.throws(() => updateGoal(db, DEMO_GOAL_ID, goalInput(db, { targetCents: -1, projectKind: 'garden' }), clock), (e) => e.code === 'invalid_goal');
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'schoolhouse');
  db.close();
});

test('a confirmed market item saves the family\'s choice with the goal and keeps the item\'s provenance', () => {
  const { db, clock } = setupDomain();
  const goal = getGoal(db, DEMO_GOAL_ID);
  const revision = merchantGoalRevision(goal, progressFor(db, goal.id).startingCents);
  const item = { usable: true, productId: 'fixture-tent', title: 'Test fixture: dome tent', merchant: 'example-outfitter.test', url: 'https://buy.trychannel3.com/fake/tent', priceCents: 18950, currency: 'USD', availability: 'InStock', checkedAt: FIXED_NOW };
  const draft = (extra) => ({ householdId: DEMO_HOUSEHOLD_ID, goalId: goal.id, expectedGoalId: goal.id, expectedGoalRevision: revision, item, goal: goalInput(db, { name: 'Dome tent', targetCents: 18950, ...extra }) });
  // An unsupported choice refuses the whole save: no goal change and no item provenance.
  assert.throws(() => saveGoalFromItem(db, draft({ projectKind: 'tent' }), clock), (e) => e.code === 'invalid_project');
  assert.equal(getGoal(db, DEMO_GOAL_ID).name, 'Camping trip fund');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM goal_items').get().n, 0);
  // The family's choice and the item are saved together; the choice is never derived from the item.
  saveGoalFromItem(db, draft({ projectKind: 'garden' }), clock);
  const saved = getGoal(db, DEMO_GOAL_ID);
  assert.deepEqual([saved.name, saved.targetCents, saved.projectKind], ['Dome tent', 18950, 'garden']);
  assert.equal(db.prepare('SELECT product_id FROM goal_items').get().product_id, 'fixture-tent');
  // Without a choice in the draft, a later item keeps what the family chose earlier (a tent does not make a campsite).
  const next = getGoal(db, DEMO_GOAL_ID);
  saveGoalFromItem(db, { ...draft({}), expectedGoalRevision: merchantGoalRevision(next, progressFor(db, next.id).startingCents), goal: goalInput(db, { targetCents: 19000 }) }, clock);
  assert.equal(getGoal(db, DEMO_GOAL_ID).projectKind, 'garden');
  db.close();
});

async function startApp({ file = ':memory:', aiProvider = null } = {}) {
  const db = openDatabase(file);
  const app = createApp({ config: loadConfig({}, { root }), db, clock: createClock(FIXED_NOW), aiProvider, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, body) => {
    const res = await fetch(base + pathname, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  return { db, call, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { db.close(); resolve(); }); }) };
}
const formGoal = (s, extra = {}) => ({ name: s.goal.name, targetCents: s.goal.targetCents, startingCents: s.progress.startingCents, weeklyBudgetCents: s.goal.weeklyBudgetCents, targetDate: s.goal.targetDate, ...extra });

test('Plan save over HTTP: a changed Build choice persists across a restart and keeps the plan in use; a bad one changes nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-goal-projects-'));
  const file = path.join(dir, 'example.sqlite');
  try {
    let s = await startApp({ file });
    await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'emerald', charge: 'leaf' } });
    const initial = (await s.call('GET', '/api/state')).json;
    let { json } = await s.call('POST', '/api/plans', { goal: formGoal(initial), commitments: [] });
    assert.equal(json.status, 'ok');
    const accepted = (await s.call('POST', `/api/plans/${json.plan.id}/accept`, {})).json.state;
    assert.equal(accepted.goal.projectKind, 'campsite');

    // Only the choice changed: the plan in use stays in use and its facts still hold; figures and milestones are untouched.
    ({ json } = await s.call('POST', '/api/plans', { goal: formGoal(accepted, { projectKind: 'schoolhouse' }), commitments: [] }));
    assert.equal(json.status, 'ok');
    assert.equal(json.state.goal.projectKind, 'schoolhouse');
    assert.equal(json.state.acceptedPlanId, accepted.acceptedPlanId);
    assert.deepEqual(json.state.progress, accepted.progress);
    assert.deepEqual(json.state.achievements, accepted.achievements);
    assert.deepEqual((({ projectKind, ...g }) => g)(json.state.goal), (({ projectKind, ...g }) => g)(accepted.goal));
    assert.equal(json.state.planReview.factsChanged, false);
    assert.equal(json.plan.totals.plannedCents, accepted.plan.totals.plannedCents, 'the same arithmetic');

    // An unsupported value is refused cleanly: no goal change, no new plan, the saved choice stays.
    const plansBefore = s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n;
    for (const goal of [formGoal(json.state, { projectKind: 'castle' }), formGoal(json.state, { projectKind: 'castle', targetCents: 50000 }), formGoal(json.state, { projectKind: null })]) {
      const bad = await s.call('POST', '/api/plans', { goal, commitments: [] });
      assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'invalid_project');
    }
    const now = (await s.call('GET', '/api/state')).json;
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n, plansBefore);
    assert.equal(now.goal.projectKind, 'schoolhouse');
    assert.equal(now.goal.targetCents, accepted.goal.targetCents);
    // A form that does not mention the choice (the family left Build alone) keeps the saved one.
    ({ json } = await s.call('POST', '/api/plans', { goal: formGoal(now, { weeklyBudgetCents: 2500 }), commitments: [] }));
    assert.equal(json.state.goal.projectKind, 'schoolhouse');
    await s.close();

    // A restart reads the saved choice back from the database.
    s = await startApp({ file });
    assert.equal((await s.call('GET', '/api/state')).json.goal.projectKind, 'schoolhouse');
    await s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the AI planner is asked exactly the same thing whatever the family builds; the choice never reaches a provider', async () => {
  const asked = [];
  const aiProvider = { provider: 'anthropic', model: 'fake-model-for-tests', proposePlan: async (basis) => { asked.push(JSON.stringify(basis)); throw new PlannerProviderError('unavailable', 'Fake provider: no call is made.'); } };
  const s = await startApp({ aiProvider });
  try {
    await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'emerald', charge: 'leaf' } });
    const state = (await s.call('GET', '/api/state')).json;
    for (const kind of ['campsite', 'garden', 'schoolhouse']) {
      const { json } = await s.call('POST', '/api/plans', { goal: formGoal(state, { projectKind: kind }), commitments: [] });
      assert.equal(json.status, 'provider_error');
      assert.equal(json.state.goal.projectKind, kind);
    }
    assert.equal(asked.length, 3, 'one request per explicit Plan action, as before');
    assert.equal(new Set(asked).size, 1, 'identical planner input');
    for (const word of ['campsite', 'garden', 'schoolhouse', 'projectKind']) assert.ok(!asked[0].toLowerCase().includes(word.toLowerCase()), word);
  } finally { await s.close(); }
});
