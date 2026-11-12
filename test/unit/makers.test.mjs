import test from 'node:test';
import assert from 'node:assert/strict';
import { makerMarks } from '../../src/core/makers.js';
import { districtById } from '../../src/core/realm.js';

// The journal's "who does this work" lines. Each must be true of the session it is shown in: a line never claims a
// provider that this session does not use, and every sign it points to stands in a real district.
const state = (modes) => ({ modes: { payments: { mode: 'example' }, ai: { mode: 'example' }, merchant: { mode: 'off' }, ...modes } });

test('a keyless example says what stands in for each sponsor, and never that one is at work', () => {
  const trip = makerMarks(state({ merchant: { mode: 'sample' } }));
  assert.equal(trip.plan.text, 'In this example an invented catalogue stands in for Channel3 at Market Town. Schedules here come from built-in rules. With a key, Claude proposes them and the server checks the arithmetic.');
  assert.equal(trip.give.text, 'Simulated in this example: no PayPal call is made. With keys, the same step goes to the PayPal sandbox through PayPal’s Server SDK, which APIMatic generates.');
  assert.equal(trip.ledger, null, 'nothing is said about the ledger until its grid has loaded');
  const blank = makerMarks(state({}));
  assert.match(blank.plan.text, /^Market Town is not connected in this session\. With a key, its listings come from Channel3\./);
  for (const marks of [trip, blank]) {
    assert.doesNotMatch(marks.plan.text, /come from Channel3, and|proposed by Claude and kept/);
    assert.doesNotMatch(marks.give.text, /^Contributions go to the PayPal sandbox/);
  }
});

test('a configured session names what is really at work', () => {
  const live = makerMarks(state({ payments: { mode: 'sandbox' }, ai: { mode: 'live', model: 'claude-opus-5-5' }, merchant: { mode: 'live' } }), { grid: 'ag-grid', studio: true });
  assert.equal(live.plan.text, 'Market Town’s listings come from Channel3, and the kit planner compares them within your family’s limit. Schedules are proposed by Claude and kept only if they match the server’s own arithmetic.');
  assert.equal(live.give.text, 'Contributions go to the PayPal sandbox with test money, through PayPal’s Server SDK, which APIMatic generates.');
  assert.equal(live.ledger.text, 'These records are kept in AG Grid, and the next-area plaque below is an AG Studio widget.');
  // Each tool is judged on its own: sandbox payments with the example planner and catalogue.
  const mixed = makerMarks(state({ payments: { mode: 'sandbox' }, merchant: { mode: 'sample' } }));
  assert.match(mixed.give.text, /^Contributions go to the PayPal sandbox/);
  assert.match(mixed.plan.text, /invented catalogue stands in for Channel3.*built-in rules/);
});

test('the ledger line follows what the page really loaded', () => {
  assert.equal(makerMarks(state({}), { grid: 'ag-grid', studio: false }).ledger.text, 'These records are kept in AG Grid.');
  for (const grid of ['fallback', 'loading', undefined]) assert.equal(makerMarks(state({}), { grid, studio: true }).ledger, null, String(grid));
});

test('every line points to signs that really stand, and a missing state says nothing false', () => {
  const marks = makerMarks(state({ merchant: { mode: 'sample' } }), { grid: 'ag-grid' });
  // The same sites as src/world/sponsor-signs.js, and PayPal's wordmark on its hillside, outside every district.
  assert.deepEqual(Object.entries(marks).map(([chapter, m]) => [chapter, ...m.signs.map((s) => [s.id, s.label, s.district && districtById(s.district).name])]), [
    ['plan', ['channel3', 'Channel3’s sign at Market Town', 'Market Town']],
    ['give', ['paypal', 'PayPal’s sign on the hillside', null], ['apimatic', 'APIMatic’s sign at the Starfall Observatory', 'Starfall Observatory']],
    ['ledger', ['ag-grid', 'AG Grid’s sign at the Stone Keep', 'Stone Keep']],
  ]);
  const empty = makerMarks(undefined);
  assert.match(empty.plan.text, /not connected in this session/);
  assert.match(empty.give.text, /^Simulated in this example/);
});
