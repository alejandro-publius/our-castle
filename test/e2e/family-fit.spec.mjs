import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { fitCatalog } from '../helpers/fit-catalog.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person, settled } from './support/family.mjs';

// Finding a purchase that fits the family, in a shared family:
// - two adults and a child, each in their own browser with their own passkey;
// - the real Channel3 merchant code over a FAKE transport, a family-mode server and in-memory data.
// The catalog's taxonomy, handles, values and products are invented test fixtures, labelled as such; they are not a
// claim about Channel3's live tent category. The figures are the task's example: Nov 8, $60.00 recorded, $30.00 a week,
// offers of $20.00 (Rowan) and $10.00 (Ash), a Dec 20 date, then a one-off $90.00 or $120.00. Test data only.
test.use({ reducedMotion: 'reduce' });
const evidence = fileURLToPath(new URL('../../test-results/family-fit/', import.meta.url));
const A = 'Test fixture: Four-person tent A', B = 'Test fixture: Four-person tent B';

function exampleClock() {
  const started = Date.now(), base = new Date('2026-11-08T12:00:00').getTime();
  const now = () => new Date(base + (Date.now() - started));
  return { now, iso: () => now().toISOString(), today() { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } };
}
const MONEY = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events'];
const money = (db) => JSON.stringify(MONEY.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const option = (p, title) => p.page.locator('#family-options > li', { hasText: title });
const fitLines = (p, id) => p.page.locator(`#merchant-results [data-product="${id}"] .merchant-fit-why li`);

async function openChoices(p) {
  await openTab(p.page, 'plan');
  const box = p.page.locator('#family-choices');
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
}

test('a family finds options that fit its needs and date, keeps why it chose one, and carries it into the family schedule', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(300_000);
  const catalog = fitCatalog();
  const clock = exampleClock();
  // This journey makes seven explicit catalog calls in a few minutes; the per-minute limit itself is covered by unit tests.
  const s = await familyServer({ clock, merchant: createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: catalog.fetch, clock, maxSearchesPerMinute: 12 }), live: { recheckMs: 1_000 } });
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
    // The existing own offers, each saved by its adult.
    expect((await csrfFetch(owner.page, 'PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status).toBe(200);
    expect((await csrfFetch(ash.page, 'PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status).toBe(200);
    const sent = new Map(people.map((p) => [p.name, []]));
    for (const p of people) p.page.on('request', (r) => sent.get(p.name).push(`${r.method()} ${new URL(r.url()).pathname}`));
    const writes = (name) => sent.get(name).filter((r) => !r.startsWith('GET '));
    const ledger = money(s.db);

    // 1. With a one-off $90.00 tried, the planning price ceiling is $150.00. The child sees choices but not this search.
    for (const p of [owner, ash, wren]) await openChoices(p);
    await owner.page.locator('#family-trial-input').fill('90.00');
    await expect(owner.page.locator('#family-fit-text')).toHaveText('Options up to $150.00 can be planned by Dec 20, after the one-off $90.00.');
    await expect(wren.page.locator('#family-fit')).toBeHidden();
    expect(writes('Rowan')).toEqual([]);

    // 2. Market Town in family-fit mode: the limit line, then an explicit look-up of kinds of item and must-haves.
    await owner.page.locator('#family-fit-find').click();
    await expect(owner.page.locator('#merchant-fit-limit')).toHaveText('Family fit · Up to $150.00 by Dec 20: the $60.00 already recorded plus $90.00 the adults’ offers can add after the one-off $90.00. A planning limit, not money in hand.');
    await expect(owner.page.locator('#merchant-search')).toHaveText('Find options that fit');
    await owner.page.locator('#merchant-query').fill('tent');
    expect(catalog.calls).toHaveLength(0);
    await owner.page.getByRole('button', { name: 'Find kinds of item' }).click();
    await expect(owner.page.locator('#merchant-kind option')).toHaveText(['Any kind of item (price and date only)',
      'Tents (test fixture) — Outdoor (test fixture)', 'Tarps (test fixture) — Outdoor (test fixture)']);
    await owner.page.locator('#merchant-kind').selectOption('fixture-tents');
    await owner.page.getByRole('button', { name: 'Show must-haves' }).click();
    const must = owner.page.locator('#merchant-must-haves select').first();
    await expect(must.locator('option')).toHaveText(['None', 'Sleeps (test fixture)', 'Season rating (test fixture)']);
    await must.selectOption('fixture-capacity');
    for (const v of ['4 person', '6 person']) await owner.page.locator('#merchant-must-haves').getByLabel(v, { exact: true }).check();
    expect(catalog.calls.map((c) => c.url.replace('https://api.trychannel3.com', ''))).toEqual(['/v1/categories/search?query=tent&limit=5', '/v1/categories/fixture-tents']);

    // 3. Only the suitable on-time tents are suggested, each with why; the other six are counted with one reason each.
    await owner.page.locator('#merchant-search').click();
    await expect(owner.page.locator('#merchant-status')).toHaveText('2 options fit the family’s needs by Dec 20 within $150.00 (8 checked).');
    await expect(owner.page.locator('#merchant-results .merchant-item')).toHaveCount(2);
    await expect(fitLines(owner, 'fixtureTent4pA')).toHaveText(['Kind: Tents (test fixture)', 'Sleeps (test fixture): 4 person (needed: 4 person or 6 person)', 'Finishes Dec 13 at the adults’ offers, within $150.00']);
    await expect(fitLines(owner, 'fixtureTent4pB').last()).toHaveText('Finishes Dec 20 at the adults’ offers, within $150.00');
    await owner.page.locator('.merchant-fit-others summary').click();
    await expect(owner.page.locator('.merchant-fit-others li')).toHaveText([
      'Test fixture: Two-person tent: Sleeps (test fixture) does not match',
      'Test fixture: Tent with no capacity fact: Sleeps (test fixture) not reported',
      'Test fixture: Four-person tent priced in euros: priced in EUR',
      'Test fixture: Six-person tent, out of stock: out of stock',
      'Test fixture: Six-person tent: over $150.00',
      'Test fixture: Four-person tarp shelter: not in Tents (test fixture)']);
    expect(catalog.calls.at(-1).body).toEqual({ query: 'tent', limit: 12, filters: { category_ids: ['fixture-tents'], attributes: { 'fixture-capacity': ['4 person', '6 person'] }, price: { max_price: 150 } },
      config: { country: 'US', currency: 'USD', language: 'en' } });
    expect(money(s.db)).toBe(ledger);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM family_choices').get().n).toBe(0);
    await shot(owner, 'fit-results', '#merchant-fit-limit');

    // Review F2: results answer one exact need. (a) Typing a lower price limit clears them, sending nothing. (b) A search
    //    answer that arrives after the accepted values changed is not shown. Either way a new explicit search is needed.
    const fitRequests = () => writes('Rowan').filter((w) => w === 'POST /api/family-choices/fit').length;
    const searched = fitRequests();
    await owner.page.locator('#merchant-budget').fill('130');
    await expect(owner.page.locator('#merchant-results .merchant-item')).toHaveCount(0);
    await expect(owner.page.locator('#merchant-status')).toHaveText('The search changed. Choose “Find options that fit” to see options for it.');
    await expect(owner.page.locator('#merchant-budget')).toBeFocused();
    await owner.page.locator('#merchant-budget').fill('');
    expect(fitRequests()).toBe(searched);
    const late = catalog.hold();
    const calls = catalog.calls.length;
    await owner.page.locator('#merchant-search').click();
    await expect.poll(() => catalog.calls.length).toBe(calls + 1);
    // The page may drop the stale answer when it arrives, or abort the request first; either way it must not be shown.
    const isFit = (url) => new URL(url).pathname === '/api/family-choices/fit';
    const answered = new Promise((resolve) => {
      owner.page.on('response', (r) => { if (isFit(r.url())) resolve(); });
      owner.page.on('requestfailed', (r) => { if (isFit(r.url())) resolve(); });
    });
    await owner.page.locator('#merchant-must-haves').getByLabel('6 person', { exact: true }).uncheck();
    late();
    await answered;
    await owner.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(owner.page.locator('#merchant-results .merchant-item')).toHaveCount(0);
    await expect(owner.page.locator('#merchant-status')).toHaveText('The search changed. Choose “Find options that fit” to see options for it.');
    await owner.page.locator('#merchant-must-haves').getByLabel('6 person', { exact: true }).check();
    await owner.page.locator('#merchant-search').click();
    await expect(owner.page.locator('#merchant-status')).toHaveText('2 options fit the family’s needs by Dec 20 within $150.00 (8 checked).');

    // 4. "Add to family choices" keeps why it was chosen; every member reads it.
    await owner.page.locator('#merchant-results [data-product="fixtureTent4pA"] .merchant-shortlist').click();
    await expect(owner.page.locator('#merchant-status')).toHaveText('Added to the family choices (1 of 3).');
    await owner.page.locator('#merchant-close').click();
    const reason = 'Meets the family’s needs: Tents (test fixture) · Sleeps (test fixture): 4 person (needed: 4 person or 6 person). Found within $150.00 for Dec 20.';
    for (const p of [owner, ash, wren]) await expect(option(p, A).locator('.family-need')).toHaveText(reason);

    // 5. A provider answer arriving after Ash changed his offer is refused, not shown as current.
    await owner.page.locator('#family-fit-find').click();
    await expect(owner.page.locator('#merchant-must-haves select').first()).toHaveValue('fixture-capacity'); // the need is kept on this page
    const release = catalog.hold();
    const before = catalog.calls.length;
    await owner.page.locator('#merchant-search').click();
    await expect.poll(() => catalog.calls.length).toBe(before + 1);
    await ash.page.locator('#family-offer-input').fill('15.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-offer-list li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $15.00 a week']);
    release();
    await expect(owner.page.locator('#merchant-status')).toHaveText('The family’s offers, goal or progress changed. Search again with the latest figures.');
    await expect(owner.page.locator('#merchant-results .merchant-item')).toHaveCount(0);
    await owner.page.locator('#merchant-close').click();
    await ash.page.locator('#family-offer-input').fill('10.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-offer-list li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $10.00 a week']);

    // 6. A one-off $120.00 lowers the ceiling to $120.00. Another explicit search: tent A still finishes Dec 20, tent B no
    //    longer fits that date, and the two-person tent never fills the gap. Updating the choice keeps this newer reason.
    await owner.page.locator('#family-trial-input').fill('120.00');
    await expect(owner.page.locator('#family-fit-text')).toHaveText('Options up to $120.00 can be planned by Dec 20, after the one-off $120.00.');
    await owner.page.locator('#family-fit-find').click();
    await owner.page.locator('#merchant-search').click();
    await expect(owner.page.locator('#merchant-status')).toHaveText('1 option fits the family’s needs by Dec 20 within $120.00 (8 checked).');
    await expect(fitLines(owner, 'fixtureTent4pA').last()).toHaveText('Finishes Dec 20 at the adults’ offers, within $120.00');
    await expect(owner.page.locator(`#merchant-results [data-product="fixtureTent4pB"], #merchant-results [data-product="fixtureTent2p"]`)).toHaveCount(0);
    await owner.page.locator('#merchant-results [data-product="fixtureTent4pA"] .merchant-shortlist').click();
    await expect(owner.page.locator('#merchant-status')).toHaveText('Family choice updated with this price.');
    await owner.page.locator('#merchant-close').click();
    await expect(option(owner, A).locator('.family-need')).toHaveText(reason.replace('$150.00', '$120.00'));
    await shot(owner, 'fit-need', '#family-options');

    // 7. The existing explicit path: review, save the goal with its schedule, use the plan. The reason travels with it.
    await option(owner, A).getByRole('button', { name: 'Review this choice' }).click();
    await expect(owner.page.locator('#goal-draft-effect')).toContainText('Meets the family’s needs: Tents (test fixture) · Sleeps (test fixture): 4 person (needed: 4 person or 6 person). Found within $120.00 for Dec 20');
    await owner.page.getByRole('button', { name: 'Save goal and propose this schedule' }).click();
    await owner.page.getByRole('button', { name: 'Close all' }).click(); // the existing goal save's deed card
    await expect(owner.page.locator('#plan-source')).toHaveText('Family schedule');
    const chosen = `${A}: Meets the family’s needs: Tents (test fixture) · Sleeps (test fixture): 4 person (needed: 4 person or 6 person). Found within $120.00 for Dec 20.`;
    await expect(owner.page.locator('#plan-chosen-for')).toHaveText(chosen);
    await owner.page.locator('#accept-plan').click();
    await expect(owner.page.locator('#plan-status')).toHaveText('Plan in use. Each contribution still needs an adult’s approval.');
    expect(await owner.page.evaluate(() => window.__ourCastle.state.nextStep)).toEqual({ week: 5, date: '2026-12-13', plannedCents: 3000, dueCents: 3000, contributedSinceCents: 0 });
    await openTab(owner.page, 'plan');
    await shot(owner, 'chosen-for', '#plan-result');

    // 8. A reload and the other adult see the same reason with the plan in use.
    await owner.page.reload();
    await settled(owner.page);
    await openTab(owner.page, 'plan');
    for (const p of [owner, ash]) {
      await expect(p.page.locator('#plan-source')).toHaveText('Family schedule · in use');
      await expect(p.page.locator('#plan-chosen-for')).toHaveText(chosen);
    }

    // Only explicit look-ups and searches reached the catalog. No payment, steward, model or ordinary-plan request was made,
    // no money record moved, and only Ash's own explicit edits touched an offer.
    expect(catalog.calls.map((c) => `${c.method} ${c.url.replace('https://api.trychannel3.com', '').split('?')[0]}`)).toEqual([
      'GET /v1/categories/search', 'GET /v1/categories/fixture-tents', 'POST /v1/search', 'POST /v1/search', 'POST /v1/search', 'POST /v1/search', 'POST /v1/search']);
    expect(writes('Rowan').filter((w) => /plans|merchant\/goal|family-choices$/.test(w))).toEqual(['POST /api/family-choices', 'POST /api/family-choices', 'POST /api/merchant/goal', expect.stringMatching(/^POST \/api\/plans\/plan_[\w-]+\/accept$/)]);
    for (const p of people) {
      expect(writes(p.name).filter((w) => /paypal|steward|example\/|entries|\/api\/plans$|plans\/rules|plans\/family/.test(w))).toEqual([]);
      expect(p.errors).toEqual([]);
      expect(p.outside).toEqual([]);
    }
    expect(money(s.db)).toBe(ledger);
    expect(s.db.prepare('SELECT weekly_cents FROM family_offers ORDER BY rowid').all().map((r) => r.weekly_cents)).toEqual([2000, 1000]);
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
