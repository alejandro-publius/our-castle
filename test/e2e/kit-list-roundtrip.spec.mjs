import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { DEFAULT_KIT_MODEL } from '../../server/config.mjs';
import { createKitReader } from '../../server/kit/reader.mjs';
import { createFakeOpenAI, fakeReadingReply } from '../helpers/fake-openai.mjs';
import { createFamily, csrfFetch, familyServer, openTab, person } from './support/family.mjs';

// Actual browser and reader adapter, but invented reading responses: draft fidelity, not vision accuracy.
test.use({ reducedMotion: 'reduce' });
const photo = fileURLToPath(new URL('../../docs/evidence/kit-photo-synthetic-20261109.png', import.meta.url));
const untouched = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks',
  'ledger_entries', 'webhook_events', 'goals', 'goal_items', 'plans', 'achievements',
  'family_offers', 'family_choices', 'family_preferences'];
const records = (db) => JSON.stringify(untouched.map((name) => [name, db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));

test('photo corrections survive typed reordering, and literal details stay in the draft without extra writes', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(180_000);
  let reading = { readable: true, moreLines: false, items: [
    { name: 'torch', quantity: 2, needs: null },
    { name: 'stove', quantity: 1, needs: null },
    { name: 'bag', quantity: null, needs: null },
  ] };
  const openai = createFakeOpenAI(() => fakeReadingReply(reading));
  const s = await familyServer({ kitReader: createKitReader({
    apiKey: 'fake-kit-quality-key-not-real', model: DEFAULT_KIT_MODEL, fetch: openai.fetch,
  }) });
  const p = await person(browser, info, 'Rowan', { origin: s.origin });
  try {
    await createFamily(p, s.origin, 'Rowan');
    expect((await csrfFetch(p.page, 'POST', '/api/setup', { name: 'Example kit family', crest: { field: 'cobalt', charge: 'stag' } })).status).toBe(200);
    const revision = await p.page.evaluate(async () => (await (await fetch('/api/state')).json()).merchantGoalRevision);
    expect((await csrfFetch(p.page, 'PUT', '/api/goal', { name: 'Example camping kit', targetCents: 30000,
      startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: revision })).status).toBe(200);
    await p.page.waitForFunction(() => window.__ourCastle?.state?.goal?.name === 'Example camping kit');
    await openTab(p.page, 'plan');
    await p.page.locator('#kit-list > summary').click();
    const before = records(s.db);
    const writes = [];
    p.page.on('request', (r) => { if (r.method() !== 'GET') writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    const rows = () => p.page.locator('#kit-rows > li');
    const field = (i, label) => rows().nth(i).getByLabel(label, { exact: true });
    const read = async () => {
      await p.page.getByLabel('Or choose a photo of a written list').setInputFiles(photo);
      await expect(p.page.locator('#kit-photo-preview')).toBeVisible();
      await p.page.getByRole('button', { name: 'Read the photo with OpenAI' }).click();
      await expect(p.page.locator('#kit-draft')).toBeVisible();
    };
    await read();
    await field(0, 'Have').fill('2');
    await field(1, 'Have').fill('');
    await p.page.getByRole('button', { name: 'Type the list instead' }).click();
    const text = p.page.getByLabel('Type or paste the list');
    await expect(text).toHaveValue('2 x torch [have 2]\n1 x stove [have ?]\n? x bag [have 0]');
    await text.fill('? x bag [have 0]\n2 x torch [have 2]\n1 x stove [have ?]');
    await p.page.getByRole('button', { name: 'Check this list' }).click();
    for (const [i, value] of ['bag', 'torch', 'stove'].entries()) await expect(field(i, 'Item')).toHaveValue(value);
    for (const [i, value] of ['', '2', '1'].entries()) await expect(field(i, 'Need')).toHaveValue(value);
    for (const [i, value] of ['0', '2', ''].entries()) await expect(field(i, 'Have')).toHaveValue(value);
    await expect(p.page.locator('#kit-rows [data-to-get]')).toHaveText(['To get: —', 'To get: 0', 'To get: —']);
    await p.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(p.page.locator('#kit-status')).toContainText('Some lines need fixing');
    expect(writes).toEqual(['POST /api/kit/read']);
    await field(0, 'Need').fill('1');
    await field(2, 'Have').fill('0');
    await p.page.getByRole('button', { name: 'Save this list' }).click();
    await expect(p.page.locator('#kit-status')).toContainText('Saved for the family');
    await expect(p.page.locator('#kit-saved .kit-item-counts')).toHaveText([
      'Need 1 · Have 0 · To get 1', 'Need 2 · Have 2 · To get 0', 'Need 1 · Have 0 · To get 1',
    ]);
    await expect(p.page.locator('#kit-saved .kit-saved-note')).toContainText('Typed, checked and saved');

    reading = { readable: true, moreLines: false, items: [
      { name: 'torch', quantity: 2, needs: 'rated to 0 °C; warm lining' },
      { name: 'stove', quantity: 1, needs: 'fits (wide) pans' },
    ] };
    await p.page.getByRole('button', { name: 'Start a new list' }).click();
    await read();
    const image = await p.page.locator('#kit-draft-photo').getAttribute('src');
    await p.page.getByRole('button', { name: 'Type the list instead' }).click();
    await expect(p.page.locator('#kit-draft')).toBeVisible();
    await expect(p.page.locator('#kit-status')).toContainText('Keep editing the lines here');
    await expect(field(0, 'Item')).toBeFocused();
    await expect(rows()).toHaveCount(2);
    await expect(rows().nth(0).getByLabel('Details')).toHaveValue('rated to 0 °C; warm lining');
    await expect(rows().nth(1).getByLabel('Details')).toHaveValue('fits (wide) pans');
    await expect(p.page.locator('#kit-draft-photo')).toHaveAttribute('src', image);
    expect(writes).toEqual(['POST /api/kit/read', 'PUT /api/kit', 'POST /api/kit/read']);
    expect(openai.calls).toHaveLength(2);
    expect(records(s.db)).toBe(before);
    expect(p.errors).toEqual([]);
    expect(p.outside).toEqual([]);
  } finally {
    await p.context.close();
    await s.close();
  }
});
