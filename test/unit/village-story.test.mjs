import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemo } from '../../scripts/demo.mjs';
import { projectStage } from '../../src/core/family-project.js';
import { nextAction } from '../../src/core/journey.js';

async function story() {
  const demo = await startDemo({ villageStory: true });
  const call = async (path, body) => {
    const response = await fetch(demo.url + path, { method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', Origin: demo.url } : {},
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  return { demo, call, state: async () => (await call('/api/state')).body };
}

test('the library starts half funded by a labeled simulation, with a private book offer and no connected providers', async () => {
  const s = await story();
  try {
    const state = await s.state();
    assert.equal(state.example.id, 'village-story');
    assert.deepEqual([state.goal.name, state.goal.targetCents, state.goal.projectKind], ['Village library', 30000, 'schoolhouse']);
    assert.deepEqual([state.progress.startingCents, state.progress.contributedCents, state.progress.simulatedContributedCents], [0, 0, 15000]);
    assert.equal(projectStage(state.progress.progressCents, state.goal.targetCents, state.goal.projectKind).key, 'construction');
    assert.deepEqual(state.contributions.map(c => [c.amountCents, c.simulated, c.approvedBy, c.lastCheck]), [[15000, true, 'm_ash', null]]);
    assert.deepEqual([state.modes.payments.mode, state.modes.ai.mode, state.modes.merchant.mode, state.modes.kit.mode], ['example', 'example', 'off', 'off']);
    assert.equal(state.plan, null);
    assert.equal(nextAction(state, { persona: state.members[0] }).key, 'contribute-example-project');
    assert.equal(nextAction({ ...state, example: null }, { persona: state.members[0] }).key, 'make-plan');
    assert.equal(nextAction({ ...state, modes: { payments: { mode: 'sandbox' } } }, { persona: state.members[0] }).key, 'make-plan');
    assert.equal(state.goalKit, null);
    assert.equal(state.kitPlan.lines[0].candidates.length, 0);
    assert.equal(state.exchange.available, true);
    assert.equal(state.exchange.neighborhood.households, 2);
    assert.equal(state.exchange.settings.visibility, 'neighborhood');
    assert.deepEqual(state.exchange.requests[0].offers.map(o => [o.family, o.quantity, o.kind, o.status]), [['Willow', 5, 'gift', 'offered']]);
    assert.equal(state.kit.items[0].remaining, 10, 'a book offer is not a handover');
    assert.deepEqual((await s.state()).contributions, state.contributions, 'reading the example never credits again');
  } finally { await s.demo.close(); }
});

test('explicit approval credits $30 once; reset restores exactly the authored library and offer', async () => {
  const s = await story();
  try {
    const initial = await s.state();
    const input = { householdId: initial.household.id, goalId: initial.goal.id, amountCents: 3000,
      approverId: 'm_rowan', approvalConfirmed: true, requestId: 'library_visitor_001' };
    assert.equal((await s.call('/api/example/contributions', { ...input, approvalConfirmed: false })).status, 400);
    assert.equal((await s.call('/api/example/contributions', { ...input, approverId: 'm_wren' })).status, 403);
    assert.equal((await s.state()).progress.progressCents, 15000);
    const paid = await s.call('/api/example/contributions', input);
    assert.equal(paid.status, 200);
    assert.equal(paid.body.state.progress.progressCents, 18000);
    assert.equal(nextAction(paid.body.state, { persona: initial.members[0], receipt: paid.body.contribution }).key, 'receipt-ready');
    assert.equal(projectStage(18000, 30000, 'schoolhouse').key, 'furnished');
    assert.equal((await s.call('/api/example/contributions', input)).body.state.progress.progressCents, 18000);
    const reset = await s.call('/api/demo/reset', {});
    assert.equal(reset.status, 200);
    assert.equal(reset.body.state.progress.progressCents, 15000);
    assert.equal(reset.body.state.contributions.length, 1);
    assert.equal(reset.body.state.exchange.requests.length, 1);
    assert.equal(reset.body.state.exchange.neighborhood.households, 2);
  } finally { await s.demo.close(); }
});

test('conflicting demo stories are refused instead of silently opening the wrong story', async () => {
  for (const options of [{ familyTrip: true }, { villageExchange: true }]) {
    await assert.rejects(startDemo({ ...options, villageStory: true }), /Choose one demo story/);
  }
});
