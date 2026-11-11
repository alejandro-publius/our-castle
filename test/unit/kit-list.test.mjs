import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app.mjs';
import { DEFAULT_KIT_MODEL, loadConfig, publicModes } from '../../server/config.mjs';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createKitReader } from '../../server/kit/reader.mjs';
import { parseKitText } from '../../src/core/kit-list.js';
import { createFakeOpenAI, fakeReadingReply, fixtureJpeg, fixturePng } from '../helpers/fake-openai.mjs';
import { familyWith, mutableClock, startServer } from '../helpers/family-http.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';

// The family kit checklist over real HTTP, in family mode unless stated. Photo reading is the real adapter over a FAKE
// OpenAI transport with an invented reading; nothing here contacts OpenAI or any other provider. The list is the task's
// invented camping list: "1 x 4-person tent; 2 x sleeping bag; 2 x torch; 1 x stove", with two torches already at home.
const root = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = '1 x 4-person tent; 2 x sleeping bag; 2 x torch; 1 x stove';
const READING = { readable: true, moreLines: false, items: [ // as the fake "reads" it: 3 bags (wrong) and no stove count
  { name: '4-person tent', quantity: 1, needs: null }, { name: 'sleeping bag', quantity: 3, needs: null },
  { name: 'torch', quantity: 2, needs: null }, { name: 'stove', quantity: null, needs: null }] };
const IMAGE = fixtureJpeg(640, 480);
const OTHER_TABLES = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events',
  'goals', 'goal_items', 'plans', 'achievements', 'family_choices', 'family_offers', 'family_preferences'];
const records = (db) => JSON.stringify(OTHER_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const kitRows = (db) => db.prepare('SELECT * FROM kit_lists ORDER BY rowid').all().map((r) => ({ ...r }));
const typedItems = (have = {}) => parseKitText(FIXTURE).lines.map((l) => ({ ...l, ownedQuantity: have[l.name] ?? 0, from: 'typed' }));
const shown = (kit) => kit.items.map((i) => [i.name, i.quantity, i.ownedQuantity, i.remaining, i.source]);

async function kitFamily({ reply = () => fakeReadingReply(READING), reader = true } = {}) {
  const openai = createFakeOpenAI(reply);
  const kitReader = reader ? createKitReader({ apiKey: 'fake-kit-openai-key-not-real', model: DEFAULT_KIT_MODEL, fetch: openai.fetch }) : null;
  const s = await startServer({ clock: mutableClock('2026-11-08T12:00:00'), extra: { kitReader } });
  const people = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
  const state = async (b = people.owner) => (await b.call('GET', '/api/state')).json;
  const save = async (b, body) => b.call('PUT', '/api/kit', { goalId: (await state(b)).goal.id, ...body });
  return { s, openai, ...people, state, save };
}

test('a typed list makes no provider call; only Save this list writes, and every member and a reload read exactly that list', async () => {
  const f = await kitFamily();
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    const before = records(s.db), revision = (await f.state()).revision;
    assert.deepEqual((await f.state()).kit, { maxItems: 8, maxQuantity: 20, revision: 0, items: [], savedBy: null, savedAt: null });
    // The page parses typed text itself; the server is first asked anything at "Save this list". Extra fields are dropped.
    const items = typedItems({ torch: 2 }).map((i) => ({ ...i, priceCents: 999, role: 'adult', memberId: 'm_x' }));
    const saved = await f.save(owner, { expectedRevision: 0, items });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const kit = saved.json.state.kit;
    assert.deepEqual(shown(kit), [['4-person tent', 1, 0, 1, 'typed'], ['sleeping bag', 2, 0, 2, 'typed'], ['torch', 2, 2, 0, 'typed'], ['stove', 1, 0, 1, 'typed']]);
    assert.equal(kit.revision, 1);
    assert.equal(kit.savedBy, saved.json.state.access.me.memberId);
    assert.ok(kit.items.every((i) => /^ki_[0-9a-f]{16}$/.test(i.id)));
    assert.deepEqual(JSON.parse(kitRows(s.db)[0].items_json).map((i) => Object.keys(i).join()), Array(4).fill('id,name,needs,quantity,ownedQuantity,source'), 'only reviewed fields are stored');
    for (const b of [ash, wren, owner]) assert.deepEqual((await f.state(b)).kit, kit, 'the other adult, the child and a reload read the same list');
    assert.equal(records(s.db), before, 'no money, goal, item, plan, deed, offer or choice record changed');
    assert.notEqual(saved.json.state.revision, revision, 'the saved list is shared live');
    assert.equal(f.openai.calls.length, 0, 'typing makes no model call');
    // Editing keeps each line's id; a draft based on an older revision is refused whole.
    const edited = kit.items.map(({ id, name, needs, quantity, ownedQuantity }) => ({ id, name, needs, quantity, ownedQuantity: name === 'torch' ? 1 : ownedQuantity }));
    const again = await f.save(owner, { expectedRevision: 1, items: edited });
    assert.deepEqual([again.status, again.json.state.kit.revision, again.json.state.kit.items.map((i) => i.id)], [200, 2, kit.items.map((i) => i.id)]);
    const stale = await f.save(ash, { expectedRevision: 1, items: typedItems() });
    assert.deepEqual([stale.status, stale.json.error.code], [409, 'kit_changed']);
    assert.equal((await f.state(ash)).kit.revision, 2);
  } finally { await s.close(); }
});

test('a photo reading is one fake OpenAI call that writes nothing; the adult fixes the misread counts, then everyone reads the fixed list', async () => {
  const f = await kitFamily();
  const { s, owner, Ash: ash, Wren: wren } = f;
  const logged = [];
  const originals = ['log', 'warn', 'error', 'info'].map((k) => [k, console[k]]);
  for (const [k] of originals) console[k] = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    const before = records(s.db), revision = (await f.state()).revision;
    const read = await owner.call('POST', '/api/kit/read', { image: IMAGE });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.deepEqual(read.json.reading, { readable: true, moreLines: false, lines: [
      { name: '4-person tent', needs: null, quantity: 1 }, { name: 'sleeping bag', needs: null, quantity: 3 },
      { name: 'torch', needs: null, quantity: 2 }, { name: 'stove', needs: null, quantity: null }] });
    assert.match(read.json.readId, /^kr_[0-9a-f]{24}$/);
    assert.equal(f.openai.calls.length, 1);
    assert.equal(f.openai.calls[0].body.input[0].content[0].image_url, IMAGE, 'the selected image, as the page sent it');
    assert.deepEqual([kitRows(s.db), records(s.db), (await f.state()).revision], [[], before, revision], 'reading wrote nothing and told no page');
    // The adult corrects the bags to 2 and fills in the stove, marks two torches at home, then saves.
    const fixed = read.json.reading.lines.map((l) => ({ ...l, from: 'photo', quantity: l.name === 'sleeping bag' ? 2 : l.name === 'stove' ? 1 : l.quantity, ownedQuantity: l.name === 'torch' ? 2 : 0 }));
    const saved = await f.save(owner, { expectedRevision: 0, readId: read.json.readId, items: fixed });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const expected = [['4-person tent', 1, 0, 1, 'photo'], ['sleeping bag', 2, 0, 2, 'photo'], ['torch', 2, 2, 0, 'photo'], ['stove', 1, 0, 1, 'photo']];
    for (const b of [ash, wren, owner]) assert.deepEqual(shown((await f.state(b)).kit), expected);
    assert.equal(records(s.db), before);
    // Nothing of the photo or the model's answer is kept or logged.
    const everything = JSON.stringify(s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => s.db.prepare(`SELECT * FROM "${name}"`).all()));
    for (const secret of [IMAGE.slice(23, 60), 'moreLines', 'readable', '"quantity":3']) assert.equal(everything.includes(secret), false, secret);
    assert.equal(logged.some((line) => line.includes('base64') || line.includes(IMAGE.slice(23, 60))), false);
    // A reading belongs to the adult who made it, once: reused, forged or another member's id cannot mark lines "photo".
    for (const [who, readId] of [[owner, read.json.readId], [owner, 'kr_000000000000000000000000'], [ash, null]]) {
      const forged = await f.save(who, { expectedRevision: 1, readId, items: [{ name: 'lantern', needs: null, quantity: 1, ownedQuantity: 0, from: 'photo' }] });
      assert.deepEqual([forged.status, forged.json.error.code], [409, 'kit_photo_expired']);
    }
    assert.equal(f.openai.calls.length, 1, 'one call in all');
  } finally {
    for (const [k, fn] of originals) console[k] = fn;
    await s.close();
  }
});

test('children, a spoofed member, a missing CSRF token, another household and a wrong goal are refused before any provider call', async () => {
  const f = await kitFamily();
  const { s, owner, Ash: ash, Wren: wren } = f;
  try {
    const st = await f.state();
    const ashId = st.members.find((m) => m.name === 'Ash').id;
    const body = { goalId: st.goal.id, expectedRevision: 0, items: typedItems() };
    assert.deepEqual((await wren.call('POST', '/api/kit/read', { image: IMAGE })).json.error.code, 'adult_required');
    assert.deepEqual((await wren.call('PUT', '/api/kit', body)).json.error.code, 'adult_required');
    assert.deepEqual((await owner.call('PUT', '/api/kit', { ...body, memberId: ashId })).json.error.code, 'member_mismatch');
    assert.deepEqual((await owner.call('POST', '/api/kit/read', { image: IMAGE, memberId: ashId })).json.error.code, 'member_mismatch');
    const noCsrf = await owner.call('PUT', '/api/kit', body, { csrf: false });
    assert.deepEqual([noCsrf.status, noCsrf.json.error.code], [403, 'csrf_failed']);
    assert.deepEqual((await owner.call('PUT', '/api/kit', { ...body, goalId: undefined })).json.error.code, 'goal_changed');
    assert.equal(f.openai.calls.length, 0);
    // A second household on the same server can neither read nor write this one's list, nor use its reading.
    assert.equal((await f.save(owner, { expectedRevision: 0, items: typedItems() })).status, 200);
    const read = await ash.call('POST', '/api/kit/read', { image: IMAGE });
    const other = await familyWith(s, []);
    const otherState = (await other.owner.call('GET', '/api/state')).json;
    assert.deepEqual([otherState.kit.revision, otherState.kit.items], [0, []]);
    const foreign = await other.owner.call('PUT', '/api/kit', { ...body, goalId: st.goal.id });
    assert.deepEqual([foreign.status, foreign.json.error.code], [403, 'scope_mismatch']);
    const borrowed = await other.owner.call('PUT', '/api/kit', { goalId: otherState.goal.id, expectedRevision: 0, readId: read.json.readId,
      items: [{ name: 'torch', needs: null, quantity: 2, ownedQuantity: 0, from: 'photo' }] });
    assert.deepEqual([borrowed.status, borrowed.json.error.code], [409, 'kit_photo_expired']);
    assert.deepEqual((await f.state()).kit.revision, 1, 'this household’s list is untouched');
    assert.deepEqual(kitRows(s.db).map((r) => r.household_id), [st.household.id]);
  } finally { await s.close(); }
});

test('missing or out-of-range counts, too many or repeated lines and unknown ids are refused whole, with what to fix', async () => {
  const f = await kitFamily();
  const { s, owner } = f;
  try {
    const line = (over = {}) => ({ name: 'torch', needs: null, quantity: 2, ownedQuantity: 0, from: 'typed', ...over });
    const cases = [
      [[line({ quantity: null })], 'kit_quantity_missing', /How many are needed/],
      [[line({ quantity: 0 })], 'kit_quantity_range', /from 1 to 20/],
      [[line({ quantity: 21 })], 'kit_quantity_range', /from 1 to 20/],
      [[line({ ownedQuantity: 3 })], 'kit_owned_range', /Have can be 0 up to the number needed/],
      [[line({ name: ' ' })], 'kit_name_missing', /name/],
      [[line(), line({ name: 'Torch' })], 'kit_duplicate', /listed twice/],
      [Array.from({ length: 9 }, (_, i) => line({ name: `item ${i}` })), 'kit_too_many', /has 9: remove 1/],
      [[], 'kit_empty', /at least one/],
      [[line({ id: 'ki_0000000000000000' })], 'kit_item_unknown', /no longer matches/],
      [[line({ from: 'model' })], 'invalid_kit', /typed or read/],
      ['torch', 'invalid_kit', /name/],
    ];
    for (const [items, code, message] of cases) {
      const r = await f.save(owner, { expectedRevision: 0, items });
      assert.deepEqual([r.status, r.json.error.code], [400, code], code);
      assert.match(r.json.error.message, message);
    }
    assert.deepEqual(kitRows(s.db), [], 'nothing was written');
    assert.equal(f.openai.calls.length, 0);
  } finally { await s.close(); }
});

test('only an explicitly chosen PNG or JPEG within bounds is read; anything else is refused before OpenAI is called', async () => {
  const f = await kitFamily();
  const { s, owner } = f;
  try {
    const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from(IMAGE.slice(23), 'base64'), Buffer.alloc(1_400_001 - 41)]).toString('base64')}`;
    const cases = [
      ['https://example.com/list.jpg', 400, 'kit_image_invalid'],
      ['/Users/someone/list.jpg', 400, 'kit_image_invalid'],
      [`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`, 400, 'kit_image_invalid'],
      [`data:image/png;base64,${Buffer.from('<html>not an image</html>').toString('base64')}`, 400, 'kit_image_invalid'],
      [`data:image/png;base64,${IMAGE.slice(23)}`, 400, 'kit_image_invalid'], // JPEG bytes labelled PNG
      ['data:image/png;base64,***', 400, 'kit_image_invalid'],
      [fixturePng(1601, 900), 413, 'kit_image_large'],
      [fixturePng(20, 20), 400, 'kit_image_invalid'],
      [big, 413, 'kit_image_large'],
      [undefined, 400, 'kit_image_invalid'],
    ];
    for (const [image, status, code] of cases) {
      const r = await owner.call('POST', '/api/kit/read', { image });
      assert.deepEqual([r.status, r.json.error.code], [status, code], String(image).slice(0, 40));
    }
    assert.equal(f.openai.calls.length, 0);
    assert.equal((await owner.call('POST', '/api/kit/read', { image: fixturePng(1600, 1200) })).status, 200, 'the bounds themselves are allowed');
  } finally { await s.close(); }
});

test('a refusal, an unfinished answer or no reader at all leaves typing available; a slow reading cannot outlive the member’s access', async () => {
  const refusing = await kitFamily({ reply: () => ({ ...fakeReadingReply(READING), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }) });
  try {
    const r = await refusing.owner.call('POST', '/api/kit/read', { image: IMAGE });
    assert.deepEqual([r.status, r.json.error.code], [422, 'kit_reader_refused']);
    assert.match(r.json.error.message, /type the list instead/);
    assert.equal((await refusing.save(refusing.owner, { expectedRevision: 0, items: typedItems() })).status, 200);
  } finally { await refusing.s.close(); }
  const off = await kitFamily({ reader: false });
  try {
    assert.deepEqual((await off.state()).modes.kit, { mode: 'off', label: 'Photo reading is not set up' });
    const r = await off.owner.call('POST', '/api/kit/read', { image: IMAGE });
    assert.deepEqual([r.status, r.json.error.code], [503, 'kit_reader_off']);
    assert.equal((await off.save(off.owner, { expectedRevision: 0, items: typedItems() })).status, 200);
  } finally { await off.s.close(); }
  // Ash's reading is held at OpenAI while the owner ends Ash's access: the late answer is refused, and no id is issued.
  const f = await kitFamily();
  try {
    const release = f.openai.hold();
    const ashId = (await f.state()).members.find((m) => m.name === 'Ash').id;
    const pending = f.Ash.call('POST', '/api/kit/read', { image: IMAGE });
    while (f.openai.calls.length < 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await f.owner.call('POST', `/api/family/members/${ashId}/revoke`, {})).status, 200);
    release();
    const late = await pending;
    assert.ok([401, 403, 409].includes(late.status), JSON.stringify(late.json));
    assert.equal(JSON.stringify(late.json).includes('readId'), false);
    assert.deepEqual(kitRows(f.s.db), []);
  } finally { await f.s.close(); }
});

test('photo readings are bounded per household: a fifth in one minute is refused before OpenAI is called', async () => {
  const f = await kitFamily();
  try {
    for (let i = 0; i < 4; i++) assert.equal((await f.owner.call('POST', '/api/kit/read', { image: IMAGE })).status, 200);
    const busy = await f.Ash.call('POST', '/api/kit/read', { image: IMAGE });
    assert.deepEqual([busy.status, busy.json.error.code], [429, 'kit_reader_busy']);
    assert.equal(f.openai.calls.length, 4);
    const other = await familyWith(f.s, []);
    assert.equal((await other.owner.call('POST', '/api/kit/read', { image: IMAGE })).status, 200, 'another household has its own bound');
    f.s.clock.advance(61_000);
    assert.equal((await f.owner.call('POST', '/api/kit/read', { image: IMAGE })).status, 200);
    assert.equal(f.openai.calls.length, 6);
  } finally { await f.s.close(); }
});

test('photo reading needs its own KIT_OPENAI_API_KEY: an ambient OPENAI_API_KEY or the planner key never turns it on', () => {
  const off = loadConfig({ OPENAI_API_KEY: 'sk-ambient-not-for-kit', AI_API_KEY: 'sk-ant-planner-not-for-kit' }, { root });
  assert.deepEqual(off.kit, { mode: 'off' });
  assert.equal(off.ai.mode, 'live', 'the planner is unaffected');
  assert.deepEqual(loadConfig({ KIT_OPENAI_API_KEY: 'kit-key' }, { root }).kit, { mode: 'live', provider: 'openai', apiKey: 'kit-key', model: 'gpt-6-sol' });
  assert.equal(loadConfig({ KIT_OPENAI_API_KEY: 'kit-key', KIT_OPENAI_MODEL: 'gpt-6.1-sol' }, { root }).kit.model, 'gpt-6.1-sol');
  const modelOnly = loadConfig({ KIT_OPENAI_MODEL: 'gpt-6-sol' }, { root });
  assert.deepEqual(modelOnly.kit, { mode: 'off' });
  assert.match(modelOnly.warnings.join(' '), /KIT_OPENAI_MODEL is set without KIT_OPENAI_API_KEY/);
  assert.equal(JSON.stringify(publicModes(loadConfig({ KIT_OPENAI_API_KEY: 'kit-key-value-9f1' }, { root }))).includes('kit-key-value-9f1'), false);
});

// Example mode: one local example household, no sessions. Every write reads its body before any route runs, so it shows the
// body limits directly: 64 KiB everywhere, and 2 MiB only for the photo route.
async function exampleServer({ kitReader = null } = {}) {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock: createClock(FIXED_NOW), kitReader, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, body) => {
    const res = await fetch(base + pathname, { method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  return { app, db, call, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

test('the larger body limit is the photo route’s alone: every other write still refuses more than 64 KiB', async () => {
  const s = await exampleServer();
  try {
    const writes = s.app.routes.filter((r) => r.method !== 'GET');
    const sample = (p) => (typeof p === 'string' ? p : p.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace(/\(\[\\w-\]\+\)/g, 'x'));
    const tooBig = JSON.stringify({ pad: 'x'.repeat(70_000) });
    for (const route of writes) {
      const r = await s.call(route.method, sample(route.pattern), tooBig);
      if (route.pattern === '/api/kit/read') assert.notEqual(r.status, 413, 'a 70 kB photo body is within its own bound');
      else assert.deepEqual([r.status, r.json?.error?.code], [413, 'too_large'], `${route.method} ${sample(route.pattern)}`);
    }
    assert.ok(writes.length > 40);
    const over = await s.call('POST', '/api/kit/read', JSON.stringify({ image: 'x'.repeat(2 * 1024 * 1024) }));
    assert.deepEqual([over.status, over.json.error.code], [413, 'too_large']);
  } finally { await s.close(); }
});

test('example mode: the labelled example adult can save and read a photo; a child persona cannot', async () => {
  const openai = createFakeOpenAI(() => fakeReadingReply(READING));
  const s = await exampleServer({ kitReader: createKitReader({ apiKey: 'fake-kit-openai-key-not-real', model: DEFAULT_KIT_MODEL, fetch: openai.fetch }) });
  try {
    const st = (await s.call('GET', '/api/state')).json;
    const adult = st.members.find((m) => m.role === 'adult'), child = st.members.find((m) => m.role === 'child');
    const body = { goalId: st.goal.id, expectedRevision: 0, items: typedItems({ torch: 2 }) };
    assert.deepEqual((await s.call('PUT', '/api/kit', { ...body, memberId: child.id })).json.error.code, 'adult_required');
    assert.deepEqual((await s.call('POST', '/api/kit/read', { image: IMAGE, memberId: child.id })).json.error.code, 'adult_required');
    const saved = await s.call('PUT', '/api/kit', { ...body, memberId: adult.id });
    assert.deepEqual(shown(saved.json.state.kit).map((r) => r[3]), [1, 2, 0, 1]);
    assert.equal((await s.call('POST', '/api/kit/read', { image: IMAGE, memberId: adult.id })).status, 200);
    assert.equal(openai.calls.length, 1);
  } finally { await s.close(); }
});

test('a schema-10 database gains the kit_lists table (and the later kit-planner/exchange/village tables); every earlier row is unchanged', () => {
  // A disposable file in the system's temporary folder (left in place), never a saved household database.
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'our-castle-kit-migration-')), 'before.sqlite');
  const step = MIGRATIONS.findIndex((m) => m.id === 'kit-lists');
  assert.deepEqual([step, MIGRATIONS.length], [10, 18], 'the kit list is step 11 of 18');
  const old = new DatabaseSync(file);
  MIGRATIONS.slice(0, step).forEach((m, i) => { if (typeof m === 'string') old.exec(m); else m.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
  old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_old', 'House of Alder', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T12:00:00.000Z');
    INSERT INTO members (id, household_id, display_name, role, is_example, sort) VALUES ('m_old', 'hh_old', 'Rowan', 'adult', 0, 0);
    INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES ('goal_old', 'hh_old', 'Camping gear', 30000, 'USD', '2026-12-20', 3000, '2026-11-01T12:00:00.000Z');
    INSERT INTO family_offers (goal_id, member_id, weekly_cents, updated_at) VALUES ('goal_old', 'm_old', 2000, '2026-11-01T12:00:00.000Z');
    INSERT INTO family_choices (id, household_id, goal_id, product_id, title, merchant, url, price_cents, currency, availability, condition, selection_json, checked_at, draft_id, added_by, added_at, need_json)
      VALUES ('fc_000000000000000000000001', 'hh_old', 'goal_old', 'p1', 'Old choice', 'example-outfitter.com', 'https://buy.trychannel3.com/fake/p1', 12000, 'USD', 'InStock', 'new', '[]', '2026-11-01T12:00:00.000Z', NULL, 'm_old', '2026-11-01T12:00:00.000Z', '{"check":null}');`);
  const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
  const beforeTables = tables(old), before = rows(old, beforeTables);
  old.close();
  const db = openDatabase(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.deepEqual(tables(db), [...beforeTables, 'exchange_circles', 'exchange_invites', 'exchange_members', 'exchange_offers', 'exchange_profiles', 'exchange_requests', 'goal_kits', 'kit_candidates', 'kit_lists', 'kit_selections', 'payment_holds', 'village_funds', 'village_payment_intents', 'village_presentations', 'village_receipts', 'village_shares', 'village_subscriptions', 'village_vault_accounts', 'village_vault_events', 'village_vault_issues', 'village_vault_watches'].sort());
  assert.equal(tables(db).length, 44);
  assert.deepEqual(rows(db, beforeTables), before, 'every earlier row is unchanged');
  assert.deepEqual(rows(db, ['kit_lists']).kit_lists, []);
  db.close();
  const again = openDatabase(file);
  assert.equal(again.prepare('PRAGMA user_version').get().user_version, 18);
  again.close();
});
