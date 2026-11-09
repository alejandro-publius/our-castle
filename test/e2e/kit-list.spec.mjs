import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { DEFAULT_KIT_MODEL } from '../../server/config.mjs';
import { createKitReader } from '../../server/kit/reader.mjs';
import { createFakeOpenAI, fakeReadingReply } from '../helpers/fake-openai.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person } from './support/family.mjs';

// A family's kit list, in a shared family:
// - two adults and a child, each in their own browser with their own passkey; a family-mode server with in-memory data;
// - photo reading is the real adapter over a FAKE OpenAI transport. Its "reading" is invented test data with one misread
//   count and one count it could not read; it says nothing about how well a model reads a real photo;
// - the list is the task's invented camping list, and the photo is an invented test document drawn by the browser.
test.use({ reducedMotion: 'reduce' });
const evidence = fileURLToPath(new URL('../../test-results/kit-list/', import.meta.url));
const FIXTURE = '1 x 4-person tent; 2 x sleeping bag; 2 x torch; 1 x stove';
const READING = { readable: true, moreLines: false, items: [
  { name: '4-person tent', quantity: 1, needs: null }, { name: 'sleeping bag', quantity: 3, needs: null },
  { name: 'torch', quantity: 2, needs: null }, { name: 'stove', quantity: null, needs: null }] };
const OTHER = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events',
  'goals', 'goal_items', 'plans', 'achievements', 'family_offers', 'family_choices', 'family_preferences'];
const others = (db) => JSON.stringify(OTHER.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const NAMES = ['4-person tent', 'sleeping bag', 'torch', 'stove'];
const COUNTS = ['Need 1 · Have 0 · To get 1', 'Need 2 · Have 0 · To get 2', 'Need 2 · Have 2 · To get 0', 'Need 1 · Have 0 · To get 1'];

async function openKit(p) {
  await openTab(p.page, 'plan');
  const box = p.page.locator('#kit-list');
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
}
const row = (p, i) => p.page.locator('#kit-rows > li').nth(i);
async function expectSaved(p, names, counts) {
  await expect(p.page.locator('#kit-saved .kit-item-name')).toHaveText(names.map((n) => new RegExp(`^${n}`)));
  await expect(p.page.locator('#kit-saved .kit-item-counts')).toHaveText(counts);
}

test('a family makes its kit list from typed text or a photo, fixes what was misread, and every member reads the saved list', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(300_000);
  const openai = createFakeOpenAI(() => fakeReadingReply(READING));
  const s = await familyServer({ kitReader: createKitReader({ apiKey: 'fake-kit-openai-key-not-real', model: DEFAULT_KIT_MODEL, fetch: openai.fetch }), live: { recheckMs: 1_000 } });
  const people = [];
  const join = async (name) => { const p = await person(browser, info, name, { origin: s.origin }); people.push(p); return p; };
  const shot = async (p, name, selector, block = 'start') => {
    await p.page.locator(selector).evaluate((el, b) => el.scrollIntoView({ block: b }), block);
    await p.page.screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  };
  mkdirSync(evidence, { recursive: true });
  try {
    const owner = await join('Rowan');
    await createFamily(owner, s.origin, 'Rowan');
    expect((await csrfFetch(owner.page, 'POST', '/api/setup', { name: 'House of Rowan', crest: { field: 'cobalt', charge: 'stag' } })).status).toBe(200);
    const revision = await owner.page.evaluate(async () => (await (await fetch('/api/state')).json()).merchantGoalRevision);
    expect((await csrfFetch(owner.page, 'PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: revision })).status).toBe(200);
    const ash = await join('Ash'); await accept(ash, await invite(owner, 'Ash', 'adult'));
    const wren = await join('Wren'); await accept(wren, await invite(owner, 'Wren', 'child'));
    for (const p of people) await isLive(p.page);
    const sent = new Map(people.map((p) => [p.name, []]));
    for (const p of people) p.page.on('request', (r) => sent.get(p.name).push(`${r.method()} ${new URL(r.url()).pathname}`));
    const writes = (name) => sent.get(name).filter((r) => !r.startsWith('GET '));
    const before = others(s.db);

    // 1. Typing: the list is checked on the page; nothing is sent until "Save this list".
    for (const p of [owner, ash, wren]) await openKit(p);
    await expect(wren.page.locator('#kit-saved')).toHaveText('No kit list yet. Adults in the family make it.');
    await expect(wren.page.locator('#kit-source')).toBeHidden();
    // Meanwhile Ash starts a list of their own in the same empty box, without checking it.
    await ash.page.getByLabel('Type or paste the list').fill('2 x torch; 1 x stove');
    await owner.page.getByLabel('Type or paste the list').fill(FIXTURE);
    await owner.page.getByRole('button', { name: 'Check this list' }).click();
    await expect(owner.page.locator('#kit-draft-title')).toBeFocused();
    for (const [i, name] of NAMES.entries()) await expect(row(owner, i).getByLabel('Item')).toHaveValue(name);
    for (const [i, n] of ['1', '2', '2', '1'].entries()) await expect(row(owner, i).getByLabel('Need', { exact: true })).toHaveValue(n);
    await row(owner, 2).getByLabel('Have', { exact: true }).fill('2');
    await expect(owner.page.locator('#kit-rows [data-to-get]')).toHaveText(['To get: 1', 'To get: 2', 'To get: 0', 'To get: 1']);
    // Escape keeps its meaning everywhere in the journal (it closes the journal); the unsaved draft is kept as it was.
    await row(owner, 2).getByLabel('Have', { exact: true }).press('Escape');
    await expect(owner.page.locator('#journal-toggle')).toBeFocused();
    await owner.page.locator('#journal-toggle').click();
    await expect(row(owner, 2).getByLabel('Have', { exact: true })).toHaveValue('2');
    await expect(owner.page.locator('#kit-draft')).toBeVisible();
    expect(writes('Rowan')).toEqual([]);
    await shot(owner, 'typed-draft', '#kit-list');
    await owner.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(owner.page.locator('#kit-status')).toHaveText('Saved for the family. Nothing was bought or paid.');
    await expect(owner.page.locator('#kit-saved-title')).toBeFocused();
    for (const p of [owner, ash, wren]) await expectSaved(p, NAMES, COUNTS); // the other pages by live update
    await expect(owner.page.locator('#kit-count')).toHaveText('4 items · 3 still to get');
    await expect(wren.page.locator('#kit-saved-actions')).toBeHidden();
    await expect(wren.page.locator('#kit-saved .kit-saved-note')).toContainText('Typed, checked and saved by Rowan');
    expect(writes('Rowan')).toEqual(['PUT /api/kit']);
    expect(openai.calls).toHaveLength(0);
    // Ash's unsaved text survives Rowan's first save: its box stays open, with Ash's focus, below Rowan's list to compare.
    // Nothing of Ash's is sent until Ash checks it (a draft that says it replaces the saved list) and saves.
    await expect(ash.page.locator('#kit-source')).toBeVisible();
    await expect(ash.page.getByLabel('Type or paste the list')).toHaveValue('2 x torch; 1 x stove');
    await expect(ash.page.getByLabel('Type or paste the list')).toBeFocused();
    await expect(ash.page.locator('#kit-saved-actions')).toBeHidden();
    expect(writes('Ash')).toEqual([]);
    await ash.page.getByRole('button', { name: 'Check this list' }).click();
    await expect(ash.page.locator('#kit-draft-note')).toHaveText('Saving replaces the saved list.');
    await ash.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(ash.page.locator('#kit-status')).toHaveText('Saved for the family. Nothing was bought or paid.');
    for (const p of [owner, ash, wren]) await expectSaved(p, ['torch', 'stove'], ['Need 2 · Have 0 · To get 2', 'Need 1 · Have 0 · To get 1']);
    expect(writes('Ash')).toEqual(['PUT /api/kit']);

    // 2. A photo: chosen and shown on this page only; it is sent only by "Read the photo with OpenAI".
    const photo = `${evidence}${info.project.name}-invented-list.png`;
    const drawing = await browser.newContext({ viewport: { width: 480, height: 300 } });
    const sheet = await drawing.newPage();
    await sheet.setContent('<body style="margin:0;background:#fff"><div style="font:26px Georgia,serif;line-height:1.5;padding:20px 28px;color:#222">Camping kit (invented test list)<br>1 x 4-person tent<br>2 x sleeping bag<br>2 x torch<br>1 x stove</div></body>');
    await sheet.screenshot({ path: photo });
    await drawing.close();
    await owner.page.getByRole('button', { name: 'Start a new list' }).click();
    await expect(owner.page.getByLabel('Type or paste the list')).toBeFocused();
    await owner.page.getByLabel('Or choose a photo of a written list').setInputFiles(photo);
    await expect(owner.page.locator('#kit-photo-preview')).toBeVisible();
    await expect(owner.page.locator('#kit-photo-note')).toHaveText('Reading sends this photo to OpenAI. You check every line before anything is saved.');
    expect(openai.calls).toHaveLength(0);
    // A reading still on its way when the adult changes the list cannot replace that newer work.
    const release = openai.hold();
    await owner.page.getByRole('button', { name: 'Read the photo with OpenAI' }).click();
    await expect.poll(() => openai.calls.length).toBe(1);
    await owner.page.getByLabel('Type or paste the list').fill('1 x lantern');
    release();
    await expect(owner.page.locator('#kit-status')).toHaveText('That reading arrived after you changed the list, so it was not used.');
    await expect(owner.page.locator('#kit-draft')).toBeHidden();
    await expect(owner.page.getByLabel('Type or paste the list')).toHaveValue('1 x lantern');
    await owner.page.getByLabel('Type or paste the list').fill('');
    // Read again: a draft with one misread count (3 bags) and one blank count (the stove), each for the adult to fix.
    await owner.page.getByRole('button', { name: 'Read the photo with OpenAI' }).click();
    await expect(owner.page.locator('#kit-draft')).toBeVisible();
    expect(openai.calls).toHaveLength(2);
    expect(openai.calls[1].body.input[0].content[0].image_url.startsWith('data:image/jpeg;base64,')).toBe(true); // re-encoded here from the PNG
    expect(openai.calls[1].body.store).toBe(false);
    await expect(row(owner, 1).getByLabel('Need', { exact: true })).toHaveValue('3');
    await expect(row(owner, 3).getByLabel('Need', { exact: true })).toHaveValue('');
    await expect(row(owner, 3).getByLabel('Need', { exact: true })).toBeFocused();
    await expect(row(owner, 3).locator('.kit-row-problem')).toHaveText('How many are needed? Enter a number.');
    await expect(owner.page.locator('#kit-draft-note')).toHaveText('Read from the photo: check every line against it. A count that could not be read is left blank. Saving replaces the saved list.');
    await expect(owner.page.locator('#kit-draft-photo')).toBeVisible();
    await owner.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(owner.page.locator('#kit-status')).toHaveText('Some lines need fixing before the list can be saved.');
    await expect(row(owner, 3).getByLabel('Need', { exact: true })).toBeFocused();
    await shot(owner, 'photo-draft', '#kit-draft');
    await row(owner, 1).getByLabel('Need', { exact: true }).fill('2');
    await row(owner, 3).getByLabel('Need', { exact: true }).fill('1');
    await row(owner, 2).getByLabel('Have', { exact: true }).fill('2');
    await expect(owner.page.locator('#kit-rows .kit-row-problem:visible')).toHaveCount(0);
    expect(writes('Rowan')).toEqual(['PUT /api/kit', 'POST /api/kit/read', 'POST /api/kit/read']);
    await owner.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(owner.page.locator('#kit-status')).toHaveText('Saved for the family. Nothing was bought or paid.');
    await expect(owner.page.locator('#kit-photo-preview')).toBeHidden();
    for (const p of [owner, ash, wren]) {
      await expectSaved(p, NAMES, COUNTS);
      await expect(p.page.locator('#kit-saved .kit-saved-note')).toContainText('Read from a photo, checked and saved by Rowan');
    }
    await owner.page.reload();
    await owner.page.waitForFunction(() => Boolean(window.__ourCastle));
    await isLive(owner.page);
    await openKit(owner);
    await expectSaved(owner, NAMES, COUNTS);
    await shot(owner, 'saved', '#kit-list');
    await shot(wren, 'child-saved', '#kit-list');

    // 3. Ash is editing when Rowan saves a change: Ash's typing stays, and Ash decides which list to keep.
    await ash.page.getByRole('button', { name: 'Edit the list' }).click();
    await row(ash, 0).getByLabel('Details').fill('fits two adults and two children');
    await owner.page.getByRole('button', { name: 'Edit the list' }).click();
    await row(owner, 3).getByLabel('Have', { exact: true }).fill('1');
    await owner.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(owner.page.locator('#kit-status')).toHaveText('Saved for the family. Nothing was bought or paid.');
    await expect(ash.page.locator('#kit-conflict-text')).toHaveText('Rowan saved the kit list while you were editing. Your draft is not saved.');
    await expect(row(ash, 0).getByLabel('Details')).toHaveValue('fits two adults and two children');
    await expect(ash.page.getByRole('button', { name: 'Save this list' })).toBeDisabled();
    await expectSaved(ash, NAMES, [COUNTS[0], COUNTS[1], COUNTS[2], 'Need 1 · Have 1 · To get 0']);
    await ash.page.getByRole('button', { name: 'Keep my draft' }).click();
    await ash.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(ash.page.locator('#kit-status')).toHaveText('Saved for the family. Nothing was bought or paid.');
    for (const p of [owner, ash, wren]) {
      await expectSaved(p, NAMES, COUNTS);
      await expect(p.page.locator('#kit-saved .kit-item-needs')).toHaveText(['fits two adults and two children']);
    }

    // Only the explicit saves wrote, and only the kit list: no money, goal, plan, offer, choice or deed record changed.
    expect(others(s.db)).toBe(before);
    expect(s.db.prepare('SELECT revision FROM kit_lists').all().map((r) => r.revision)).toEqual([5]);
    expect(openai.calls).toHaveLength(2);
    for (const p of people) expect(writes(p.name).filter((w) => /paypal|steward|merchant|plans|entries|family-choices|goal/.test(w))).toEqual([]);
    for (const p of people) { expect(p.errors).toEqual([]); expect(p.outside).toEqual([]); }
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
