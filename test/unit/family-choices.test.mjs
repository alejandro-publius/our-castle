import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { browser, familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';

// Family choices over real HTTP. The household, goal and acting member come from each person's session. The merchant is
// the real Channel3 code over a FAKE transport whose tents are invented test data. The example is the task's:
// Nov 8, $60.00 tracked, $30.00 a week, a Dec 20 date and tents at $120.00 / $150.00 / $180.00.
const root = fileURLToPath(new URL('../../', import.meta.url));
const TENTS = [['fakeTentA', 'Test fixture: Two-person tent', 120], ['fakeTentB', 'Test fixture: Four-person tent', 150], ['fakeTentC', 'Test fixture: Six-person tent', 180], ['fakeTentD', 'Test fixture: Eight-person tent', 210]];
const product = ([id, title, price], overrides = {}) => fakeProduct({ id, title,
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency: 'USD' }, availability: 'InStock', condition: 'new', ...overrides }] });
// Searches for "tent" return the first three; "big tent" returns the fourth. A product look-up returns the current price.
function catalog(prices = new Map()) {
  return createFakeChannel3((url, init) => {
    const lookup = /\/v1\/products\/([^?]+)/.exec(url);
    if (lookup) { const t = TENTS.find(([id]) => id === decodeURIComponent(lookup[1])); return product([t[0], t[1], prices.get(t[0]) ?? t[2]]); }
    const query = JSON.parse(init.body).query;
    return fakeSearchResponse((query === 'big tent' ? TENTS.slice(3) : TENTS.slice(0, 3)).map((t) => product(t)));
  });
}
// The money and plan records no planning request may touch.
const money = (db) => JSON.stringify(db.prepare(`SELECT (SELECT COUNT(*) FROM payment_orders) AS orders, (SELECT COUNT(*) FROM payment_captures) AS captures,
  (SELECT COUNT(*) FROM payment_refunds) AS refunds, (SELECT COUNT(*) FROM ledger_entries) AS entries, (SELECT COALESCE(SUM(effect * amount_cents), 0) FROM ledger_entries) AS net,
  (SELECT COUNT(*) FROM plans) AS plans, (SELECT COUNT(*) FROM achievements) AS achievements, (SELECT COUNT(*) FROM goal_items) AS items`).get());
const planning = (db) => JSON.stringify(['family_choices', 'family_offers', 'family_preferences'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));

async function family({ prices } = {}) {
  const fake = catalog(prices);
  const clock = mutableClock('2026-11-08T12:00:00');
  const s = await startServer({ clock, merchant: createMerchant({ apiKey: 'test-key-not-real', fetch: fake.fetch, clock }) });
  const people = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
  const { owner } = people;
  const state = async (b = owner) => (await b.call('GET', '/api/state')).json;
  const goal = await owner.call('PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: (await state()).merchantGoalRevision });
  assert.equal(goal.status, 200, JSON.stringify(goal.json));
  const search = async (b, query = 'tent') => (await b.call('POST', '/api/merchant/search', { query })).json;
  const shortlist = async () => {
    const found = await search(owner);
    for (const r of found.results) assert.equal((await owner.call('POST', '/api/family-choices', { draftId: r.draftId, expectedGoalId: found.goalId })).json.outcome, 'added');
    return (await state()).familyChoices.choices;
  };
  return { s, fake, clock, ...people, state, search, shortlist };
}

test('adults save only their own offers; children and adults state one preference each; children cannot change money or choices', async () => {
  const f = await family();
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    const choices = await f.shortlist();
    assert.deepEqual(choices.map((c) => [c.title, c.priceCents, c.currency, c.merchant, c.condition, c.fresh]), [
      [TENTS[0][1], 12000, 'USD', 'example-outfitter.com', 'new', true], [TENTS[1][1], 15000, 'USD', 'example-outfitter.com', 'new', true], [TENTS[2][1], 18000, 'USD', 'example-outfitter.com', 'new', true]]);
    const before = money(s.db);
    const ids = (await f.state()).access.members;
    const id = (name) => ids.find((m) => m.name === name).id;
    // Own offers only, and only adults.
    assert.equal((await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status, 200);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 200);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 5000, memberId: id('Rowan') })).json.error.code, 'member_mismatch');
    for (const [method, url, body] of [['PUT', '/api/family-choices/offer', { weeklyCents: 500 }], ['POST', '/api/family-choices/offer/withdraw', {}],
      ['POST', '/api/family-choices', { draftId: 'c3d_x', expectedGoalId: 'g' }], ['POST', '/api/family-choices/remove', { choiceId: choices[0].id }],
      ['POST', '/api/family-choices/refresh', { choiceId: choices[0].id }], ['POST', '/api/family-choices/review', { choiceId: choices[0].id, revision: 'x' }]]) {
      const r = await wren.call(method, url, body);
      assert.deepEqual([r.status, r.json.error.code], [403, 'adult_required'], `${method} ${url}`);
    }
    // One preference per member: a child changes theirs, an adult cannot set someone else's.
    assert.equal((await wren.call('PUT', '/api/family-choices/preference', { choiceId: choices[2].id })).status, 200);
    assert.equal((await wren.call('PUT', '/api/family-choices/preference', { choiceId: choices[1].id })).status, 200);
    assert.equal((await ash.call('PUT', '/api/family-choices/preference', { choiceId: choices[1].id })).status, 200);
    assert.equal((await owner.call('PUT', '/api/family-choices/preference', { choiceId: choices[0].id, memberId: id('Wren') })).json.error.code, 'member_mismatch');
    assert.equal((await owner.call('PUT', '/api/family-choices/preference', { choiceId: choices[0].id })).status, 200);
    let view = (await f.state(wren)).familyChoices;
    assert.deepEqual(view.preferences, [{ memberId: id('Rowan'), choiceId: choices[0].id }, { memberId: id('Ash'), choiceId: choices[1].id }, { memberId: id('Wren'), choiceId: choices[1].id }]);
    assert.equal((await owner.call('POST', '/api/family-choices/preference/remove', {})).json.removed, true);
    view = (await f.state(wren)).familyChoices;
    assert.deepEqual(view.preferences.map((p) => p.choiceId), [choices[1].id, choices[1].id]);
    // Everyone sees the same comparison: offers $20.00 + $10.00, finishes in weeks 2, 3 and 4.
    assert.deepEqual(view.offers.map((o) => [o.name, o.weeklyCents]), [['Rowan', 2000], ['Ash', 1000]]);
    assert.deepEqual(view.comparison.options.map((o) => [o.id === 'goal' ? 'goal' : o.priceCents, o.status, o.finishWeek, o.finishDate]),
      [['goal', 'late', 8, '2027-01-03'], [12000, 'fits', 2, '2026-11-22'], [15000, 'fits', 3, '2026-11-29'], [18000, 'fits', 4, '2026-12-06']]);
    // A full shortlist refuses a fourth item until one is named to replace; its preferences go with it.
    const big = await f.search(owner, 'big tent');
    assert.equal((await owner.call('POST', '/api/family-choices', { draftId: big.results[0].draftId, expectedGoalId: big.goalId })).json.error.code, 'choices_full');
    const replaced = await owner.call('POST', '/api/family-choices', { draftId: big.results[0].draftId, expectedGoalId: big.goalId, replaceId: choices[1].id });
    assert.equal(replaced.json.outcome, 'replaced');
    view = replaced.json.state.familyChoices;
    assert.deepEqual(view.choices.map((c) => c.title), [TENTS[0][1], TENTS[2][1], TENTS[3][1]]);
    assert.deepEqual(view.preferences, [], 'the replaced tent took its preferences with it');
    // The same offer again refreshes its line instead of adding a duplicate.
    const again = await f.search(owner);
    assert.equal((await owner.call('POST', '/api/family-choices', { draftId: again.results[0].draftId, expectedGoalId: again.goalId })).json.outcome, 'updated');
    assert.equal((await f.state()).familyChoices.choices.length, 3);
    assert.equal(money(s.db), before, 'no money or plan record changed');
    // Two provider searches ("tent", "big tent"); the repeated "tent" came from the merchant's short cache. Offers,
    // preferences, replacing and reading called no provider.
    assert.equal(f.fake.calls.length, 2);
  } finally { await s.close(); }
});

test('invalid, foreign, stale and signed-out requests are refused cleanly with no partial write or provider call', async () => {
  const f = await family();
  const other = await familyWith(f.s); // a separate household on the same server
  const { s, owner, Ash: ash } = f;
  try {
    const choices = await f.shortlist();
    const theirs = (await other.owner.call('GET', '/api/state')).json;
    const before = [money(s.db), planning(s.db)], calls = f.fake.calls.length;
    for (const [url, body, status, code] of [
      ['/api/family-choices/offer', { weeklyCents: 99 }, 400, 'invalid_offer'], ['/api/family-choices/offer', { weeklyCents: 12.5 }, 400, 'invalid_offer'],
      ['/api/family-choices/offer', { weeklyCents: '2000' }, 400, 'invalid_offer'], ['/api/family-choices/offer', { weeklyCents: 10_000_001 }, 400, 'invalid_offer'],
      ['/api/family-choices/offer', {}, 400, 'invalid_offer'], ['/api/family-choices/preference', { choiceId: 'x' }, 400, 'invalid_choice'],
      ['/api/family-choices/preference', { choiceId: 7 }, 400, 'invalid_choice'], ['/api/family-choices/preference', { choiceId: 'fc_000000000000000000000000' }, 404, 'choice_gone'],
      ['/api/family-choices/offer', { weeklyCents: 2000, householdId: theirs.household.id }, 403, 'scope_mismatch'],
      ['/api/family-choices/offer', { weeklyCents: 2000, goalId: theirs.goal.id }, 403, 'scope_mismatch'],
    ]) {
      const r = await owner.call('PUT', url, body);
      assert.deepEqual([r.status, r.json.error.code], [status, code], `${url} ${JSON.stringify(body)}`);
    }
    for (const [url, body, status, code] of [
      ['/api/family-choices', { draftId: 'c3d_not_shown_to_this_family', expectedGoalId: theirs.goal.id }, 410, 'merchant_draft_expired'],
      ['/api/family-choices/remove', { choiceId: 'fc_000000000000000000000000' }, 404, 'choice_gone'],
      ['/api/family-choices/review', { choiceId: choices[0].id, revision: 'fc1_not_current', reserveCents: 0 }, 409, 'choices_changed'],
      ['/api/family-choices/review', { choiceId: choices[0].id, revision: 'x', reserveCents: -1 }, 400, 'invalid_one_off'],
      ['/api/family-choices/review', { choiceId: choices[0].id, revision: 'x', reserveCents: 9.5 }, 400, 'invalid_one_off'],
    ]) {
      const r = await owner.call('POST', url, body);
      assert.deepEqual([r.status, r.json.error.code], [status, code], `${url} ${JSON.stringify(body)}`);
    }
    // Another household's choice and draft are not usable here. (An identical search would re-show the merchant's cached
    // result, and its drafts, to both households; this one is shown to theirs only.)
    const found = await f.search(other.owner, 'big tent');
    const otherAdd = await other.owner.call('POST', '/api/family-choices', { draftId: found.results[0].draftId, expectedGoalId: found.goalId });
    assert.equal(otherAdd.status, 200);
    const theirChoice = otherAdd.json.state.familyChoices.choices[0].id;
    for (const [method, url, body] of [['PUT', '/api/family-choices/preference', { choiceId: theirChoice }], ['POST', '/api/family-choices/remove', { choiceId: theirChoice }]]) {
      assert.deepEqual([(await owner.call(method, url, body)).status], [404], `${method} ${url}`);
    }
    assert.equal((await owner.call('POST', '/api/family-choices', { draftId: found.results[0].draftId, expectedGoalId: (await f.state()).goal.id })).json.error.code, 'merchant_draft_expired');
    assert.equal(JSON.stringify(await f.state()).includes(theirChoice), false);
    // A search bound to an older goal is refused as stale.
    const mine = await f.search(owner);
    assert.equal((await owner.call('POST', '/api/family-choices', { draftId: mine.results[0].draftId, expectedGoalId: 'goal_not_this_one' })).json.error.code, 'goal_changed');
    // No session, or a session that has ended: refused before any work.
    const stranger = browser(s.origin);
    assert.deepEqual([(await stranger.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status], [401]);
    assert.equal((await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 }, { csrf: false })).json.error.code, 'csrf_failed');
    assert.deepEqual([money(s.db), planning(s.db).length > 0], [before[0], true]);
    assert.equal(planning(s.db).includes('"weekly_cents"'), false, 'no refused offer was written');
    assert.equal(f.fake.calls.length, calls + 1, 'only their "big tent" search reached the provider; the repeated "tent" search was cached');
    f.clock.advance(31 * 60_000);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).json.error.code, 'session_expired');
  } finally { await s.close(); }
});

test('a review checks the comparison, the price and the draft again; only the reviewed choice can be saved, through the existing goal save', async () => {
  const prices = new Map();
  const f = await family({ prices });
  const { s, owner, Ash: ash } = f;
  try {
    const choices = await f.shortlist();
    await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 });
    await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 });
    let view = (await f.state()).familyChoices;
    const before = money(s.db);
    // With a one-off $90.00 the $180.00 tent finishes Dec 27, a week after Dec 20: the draft offers that date at $30.00 a week.
    const late = await owner.call('POST', '/api/family-choices/review', { choiceId: choices[2].id, revision: view.revision, reserveCents: 9000 });
    assert.equal(late.status, 200, JSON.stringify(late.json));
    assert.deepEqual([late.json.saved, late.json.option.status, late.json.option.shortfallCents, late.json.goal], [false, 'late', 3000, { targetCents: 18000, targetDate: '2026-12-27', weeklyBudgetCents: 3000 }]);
    const fits = await owner.call('POST', '/api/family-choices/review', { choiceId: choices[1].id, revision: view.revision, reserveCents: 9000 });
    assert.deepEqual([fits.json.option.status, fits.json.goal], ['fits', { targetCents: 15000, targetDate: '2026-12-20', weeklyBudgetCents: 3000 }]);
    assert.equal(money(s.db), before, 'reviewing saved nothing');
    // Another adult's newer offer makes the reviewed comparison stale, at review and at save.
    await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1200 });
    assert.equal((await owner.call('POST', '/api/family-choices/review', { choiceId: choices[1].id, revision: view.revision })).json.error.code, 'choices_changed');
    const goalRevision = (await f.state()).merchantGoalRevision;
    const draft = { draftId: fits.json.item.draftId, goalId: (await f.state()).goal.id, expectedGoalRevision: goalRevision,
      goal: { name: 'Four-person tent', targetCents: 15000, startingCents: 6000, targetDate: '2026-12-20', weeklyBudgetCents: 3000 } };
    assert.equal((await owner.call('POST', '/api/merchant/goal', { ...draft, familyChoice: { choiceId: choices[1].id, revision: view.revision } })).json.error.code, 'choices_changed');
    view = (await f.state()).familyChoices;
    // The draft of one choice cannot be saved as another.
    assert.equal((await owner.call('POST', '/api/merchant/goal', { ...draft, familyChoice: { choiceId: choices[0].id, revision: view.revision } })).json.error.code, 'choices_changed');
    // After the merchant's own draft lifetime, the price must be checked again before review.
    f.clock.advance(20 * 60_000); await owner.call('GET', '/api/state'); await ash.call('GET', '/api/state');
    f.clock.advance(15 * 60_000);
    view = (await f.state()).familyChoices;
    assert.deepEqual(view.choices.map((c) => c.fresh), [false, false, false]);
    assert.equal((await owner.call('POST', '/api/family-choices/review', { choiceId: choices[1].id, revision: view.revision })).json.error.code, 'choice_needs_check');
    prices.set('fakeTentB', 140); // the retailer lowered the price meanwhile
    const calls = f.fake.calls.length;
    const checked = await owner.call('POST', '/api/family-choices/refresh', { choiceId: choices[1].id });
    assert.deepEqual([checked.status, checked.json.usable, checked.json.previousPriceCents, checked.json.priceCents], [200, true, 15000, 14000]);
    assert.equal(f.fake.calls.length, calls + 1, 'one explicit product look-up');
    view = checked.json.state.familyChoices;
    const fresh = await owner.call('POST', '/api/family-choices/review', { choiceId: choices[1].id, revision: view.revision });
    assert.deepEqual([fresh.status, fresh.json.goal.targetCents, fresh.json.goal.weeklyBudgetCents], [200, 14000, 3000]);
    const saved = await owner.call('POST', '/api/merchant/goal', { ...draft, draftId: fresh.json.item.draftId, expectedGoalRevision: (await f.state()).merchantGoalRevision,
      goal: { ...draft.goal, targetCents: 14000 }, familyChoice: { choiceId: choices[1].id, revision: view.revision } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.state.goal.targetCents, { ...s.db.prepare('SELECT product_id, price_cents FROM goal_items').get() }], [14000, { product_id: 'fakeTentB', price_cents: 14000 }]);
    const after = JSON.parse(money(s.db)), was = JSON.parse(before);
    assert.deepEqual([after.orders, after.captures, after.refunds, after.entries, after.net, after.plans], [was.orders, was.captures, was.refunds, was.entries, was.net, was.plans]);
  } finally { await s.close(); }
});

test('a removed member’s offer and preference stop counting, and their session ends', async () => {
  const f = await family();
  const { s, owner, Ash: ash } = f;
  try {
    const choices = await f.shortlist();
    await owner.call('PUT', '/api/family-choices/offer', { weeklyCents: 2000 });
    await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 });
    await ash.call('PUT', '/api/family-choices/preference', { choiceId: choices[1].id });
    const ashId = (await f.state()).access.members.find((m) => m.name === 'Ash').id;
    assert.equal((await owner.call('POST', `/api/family/members/${ashId}/revoke`, {})).status, 200);
    const view = (await f.state()).familyChoices;
    assert.deepEqual(view.offers.map((o) => o.name), ['Rowan']);
    assert.deepEqual(view.preferences, []);
    // $20.00 a week alone: $60.00 takes 3 weeks, $90.00 5, $120.00 6.
    assert.deepEqual(view.comparison.options.slice(1).map((o) => [o.finishWeek, o.finishDate]), [[3, '2026-11-29'], [5, '2026-12-13'], [6, '2026-12-20']]);
    assert.equal((await ash.call('PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status, 401);
  } finally { await s.close(); }
});

test('example mode shows the same flow with its labelled example people; the persona must be a member and only adults offer', async () => {
  const fake = catalog();
  const clock = mutableClock('2026-11-08T12:00:00');
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock, root, merchant: createMerchant({ apiKey: 'test-key-not-real', fetch: fake.fetch, clock }) });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try {
    const found = (await call('POST', '/api/merchant/search', { query: 'tent' })).json;
    const added = await call('POST', '/api/family-choices', { draftId: found.results[0].draftId, expectedGoalId: found.goalId, memberId: 'm_rowan' });
    assert.equal(added.json.outcome, 'added');
    const choice = added.json.state.familyChoices.choices[0].id;
    assert.equal((await call('POST', '/api/family-choices', { draftId: found.results[1].draftId, expectedGoalId: found.goalId, memberId: 'm_wren' })).json.error.code, 'adult_required');
    assert.equal((await call('PUT', '/api/family-choices/offer', { weeklyCents: 2000, memberId: 'm_rowan' })).status, 200);
    assert.equal((await call('PUT', '/api/family-choices/offer', { weeklyCents: 500, memberId: 'm_wren' })).json.error.code, 'adult_required');
    assert.equal((await call('PUT', '/api/family-choices/offer', { weeklyCents: 500, memberId: 'm_nobody' })).json.error.code, 'invalid_member');
    assert.equal((await call('PUT', '/api/family-choices/preference', { choiceId: choice, memberId: 'm_wren' })).status, 200);
    const view = (await call('GET', '/api/state')).json.familyChoices;
    assert.deepEqual([view.offers.map((o) => [o.name, o.weeklyCents]), view.preferences], [[['Rowan', 2000]], [{ memberId: 'm_wren', choiceId: choice }]]);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); db.close();
  }
});

test('a schema-8 database gains only the three planning tables (and the later kit-list table), with every earlier row unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-family-choices-migration-'));
  const file = path.join(dir, 'before.sqlite');
  try {
    const step = MIGRATIONS.findIndex((s) => s.id === 'family-choices');
    assert.equal(step, 8, 'the family choices are step 9');
    const old = new DatabaseSync(file);
    MIGRATIONS.slice(0, step).forEach((s, i) => { if (typeof s === 'string') old.exec(s); else s.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_old', 'House of Alder', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T12:00:00.000Z');
      INSERT INTO members (id, household_id, display_name, role, is_example, sort) VALUES ('m_old', 'hh_old', 'Rowan', 'adult', 0, 0);
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_old', 'hh_old', 'Garden', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T12:00:00.000Z');
      INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, label, created_at) VALUES ('hh_old', 'goal_old', 'starting_progress', 1, 6000, 'USD', 'user-reported', 'starting:goal_old', 'Start', '2026-11-01T12:00:00.000Z');
      INSERT INTO deferred_refunds (refund_id, capture_id, amount_cents, currency, received_at) VALUES ('R1', 'C1', 500, 'USD', '2026-11-02T12:00:00.000Z');`);
    const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
    const beforeTables = tables(old), before = rows(old, beforeTables);
    assert.equal(old.prepare('PRAGMA user_version').get().user_version, 8);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length); // later steps add one column and the kit list
    assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)), ['family_choices', 'family_offers', 'family_preferences', 'kit_lists']);
    assert.deepEqual(rows(db, beforeTables), before, 'every earlier table and row identical');
    db.close();
    const again = openDatabase(file); // opening again changes nothing
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.deepEqual(rows(again, beforeTables), before);
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
