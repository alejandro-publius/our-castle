import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createKitSolver } from '../../server/kit/solver.mjs';
import { createKitReranker } from '../../server/kit/rerank.mjs';
import { kitCatalog } from '../helpers/kit-catalog.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person, root } from './support/family.mjs';

// Complete kits for a family's kit list (task 019), in a shared family:
// - two adults and a child, each in their own browser with their own passkey; an in-process family-mode server;
// - Market Town is the real merchant code over a FAKE catalog of six invented listings (the acceptance example's tents,
//   sleeping bags and stoves from two invented shops), with listed weights in Channel3's documented offer shape;
// - the solver is the compiled Rust program when built (KIT_SOLVER_REQUIRED=1 makes that mandatory, as CI does);
// - ordering by a preference is the real Cohere adapter over a FAKE transport whose order is written below;
// - the server's clock is pinned to Nov 8, 2026, so the figures are kit-planning-acceptance-20261109.json's.
test.use({ reducedMotion: 'reduce' });
const evidence = fileURLToPath(new URL('../../test-results/kit-planner/', import.meta.url));
const required = process.env.KIT_SOLVER_REQUIRED === '1';
const MONEY = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events', 'family_offers', 'family_choices'];
const money = (db) => JSON.stringify(MONEY.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));

// The server's day stays Nov 8, 2026 while its time moves on (sessions and catalog answers age normally).
function novemberEighth() {
  const start = Date.parse('2026-11-08T18:00:00Z'), real = Date.now();
  return {
    now: () => new Date(start + (Date.now() - real)), iso() { return this.now().toISOString(); },
    today() { const d = this.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  };
}
// The invented Cohere order: kits whose text mentions "ultralight" first, with that tent's title as the matched span.
function fakeCohere(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const light = (i) => Number(body.documents[i].includes('ultralight'));
    const order = body.documents.map((_, i) => i).sort((a, b) => light(b) - light(a) || a - b);
    const results = order.map((index, rank) => {
      const doc = body.documents[index], at = doc.indexOf('Tent B');
      if (rank > 0 || at < 0) return { index, relevance_score: 0.5 - rank / 20 };
      const start = Array.from(doc.slice(0, at)).length, end = start + Array.from('Tent B, four-person ultralight').length;
      return { index, relevance_score: 0.9, relevant_spans: [{ start, end, score: 0.8 }] };
    });
    return new Response(JSON.stringify({ id: 'fake-rerank', results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function openDisclosure(p, id) {
  const box = p.page.locator(`#${id}`);
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
}
async function openKit(p) { await openTab(p.page, 'plan'); await openDisclosure(p, 'kit-list'); }
// "Find listings for <item>": search Market Town, then add the named results with the adult's own count of 1 per listing.
async function addListings(p, item, titles) {
  await p.page.getByRole('button', { name: `Find listings for ${item}` }).click();
  const dialog = p.page.locator('#merchant-dialog');
  await expect(dialog).toBeVisible();
  await expect(p.page.locator('#merchant-query')).toHaveValue(item);
  await expect(p.page.locator('#merchant-status')).toContainText(`enter how many ${item} one listing gives`);
  await p.page.locator('#merchant-search').click();
  for (const title of titles) {
    const row = dialog.locator('.merchant-item', { hasText: title });
    await expect(row.getByRole('button', { name: 'Use as goal' })).toHaveCount(0); // a kit listing is never the goal on its own
    await row.getByRole('button', { name: `Add for ${item}` }).click();
    await expect(p.page.locator('#merchant-status')).toContainText(`Enter how many ${item} one listing gives`); // no default count
    await row.getByLabel('Items in one listing').fill('1');
    await row.getByRole('button', { name: `Add for ${item}` }).click();
    await expect(p.page.locator('#merchant-status')).toContainText(`Added for ${item}`);
  }
  await p.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('a family compares complete kits within its own figures, keeps what it agreed, sees the smallest change and saves the kit as its goal', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.setTimeout(300_000);
  const clock = novemberEighth();
  const catalog = kitCatalog();
  const cohere = [];
  const kitSolver = createKitSolver({ root, engine: required ? 'native' : 'auto' });
  const s = await familyServer({ clock, merchant: createMerchant({ apiKey: 'fake-channel3-key-not-real', fetch: catalog.fetch, clock }), kitSolver,
    kitReranker: createKitReranker({ apiKey: 'fake-kit-cohere-key-not-real', fetch: fakeCohere(cohere) }), live: { recheckMs: 1_000 } });
  const people = [];
  const join = async (name) => { const p = await person(browser, info, name, { origin: s.origin }); people.push(p); return p; };
  const shot = async (p, name, selector) => {
    await p.page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await p.page.screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  };
  mkdirSync(evidence, { recursive: true });
  try {
    // The family and its figures: $60 recorded, $30 a week, Rowan $20 + Ash $10 a week, Camping gear by Dec 27.
    const owner = await join('Rowan');
    await createFamily(owner, s.origin, 'Rowan');
    expect((await csrfFetch(owner.page, 'POST', '/api/setup', { name: 'House of Rowan', crest: { field: 'cobalt', charge: 'stag' } })).status).toBe(200);
    const first = await owner.page.evaluate(async () => (await fetch('/api/state')).json());
    expect((await csrfFetch(owner.page, 'PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-27',
      expectedGoalRevision: first.merchantGoalRevision })).status).toBe(200);
    const ash = await join('Ash'); await accept(ash, await invite(owner, 'Ash', 'adult'));
    const wren = await join('Wren'); await accept(wren, await invite(owner, 'Wren', 'child'));
    expect((await csrfFetch(owner.page, 'PUT', '/api/family-choices/offer', { weeklyCents: 2000 })).status).toBe(200);
    expect((await csrfFetch(ash.page, 'PUT', '/api/family-choices/offer', { weeklyCents: 1000 })).status).toBe(200);
    expect((await csrfFetch(owner.page, 'PUT', '/api/kit', { goalId: first.goal.id, expectedRevision: 0, items: [
      { name: '4-person tent', quantity: 1, ownedQuantity: 0, from: 'typed' }, { name: 'sleeping bag', quantity: 2, ownedQuantity: 0, from: 'typed' },
      { name: 'torch', quantity: 2, ownedQuantity: 2, from: 'typed' }, { name: 'stove', quantity: 1, ownedQuantity: 0, from: 'typed' }] })).status).toBe(200);
    for (const p of people) await isLive(p.page);
    for (const p of [owner, ash, wren]) await openKit(p);
    const before = money(s.db);

    // 1. Listings for each item still to get. The torches are at home: no listing, no search.
    await expect(owner.page.locator('#kit-plan-lines > li')).toHaveCount(4);
    await expect(owner.page.locator('#kit-plan-lines > li', { hasText: 'torch' })).toContainText('Already at home');
    await expect(owner.page.getByRole('button', { name: 'Find listings for torch' })).toHaveCount(0);
    await addListings(owner, '4-person tent', ['Tent A', 'Tent B']);
    await expect(owner.page.getByRole('button', { name: 'Add a listing for 4-person tent' })).toBeFocused(); // focus returns to the item
    await addListings(owner, 'sleeping bag', ['Sleeping bag A', 'Sleeping bag B']);
    await addListings(owner, 'stove', ['Stove A', 'Stove B']);
    expect(catalog.count('/v1/search')).toBe(3);
    const bags = owner.page.locator('#kit-plan-lines > li', { hasText: 'sleeping bag' });
    await expect(bags.locator('.kit-plan-listing').first()).toContainText('1 in each (Rowan’s count)');
    await expect(bags.locator('.kit-plan-listing-buys').first()).toHaveText('For 2: 2 listings = $40.00');
    await shot(owner, 'listings', '#kit-plan-title');

    // 2. Compare against the family's figures with the $90 one-off being tried in Family choices: two different kits fit.
    await openDisclosure(owner, 'family-choices');
    await owner.page.getByLabel('One-off amount').fill('90.00');
    await expect(owner.page.locator('#kit-plan-ceiling')).toContainText('Up to $180.00 by Dec 27');
    const calls = catalog.calls.length;
    await owner.page.getByRole('button', { name: 'Compare complete kits' }).click();
    const kits = owner.page.locator('#kit-plan-kits > li');
    await expect(kits).toHaveCount(2);
    await expect(owner.page.locator('#kit-plan-note')).toBeFocused();
    await expect(owner.page.locator('#kit-plan-note')).toHaveText('2 different complete kits fit by Dec 27, after the one-off $90.00.');
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toHaveText('Lowest listed total · Fewest shops$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-finish')).toHaveText('Finishes Dec 20 (week 6), on time for Dec 27.');
    await expect(kits.nth(1).locator('.kit-plan-kit-head')).toHaveText('Lower listed weight$180.00');
    await expect(kits.nth(1).locator('.kit-plan-kit-finish')).toHaveText('Finishes Dec 27 (week 7), on time for Dec 27.');
    await expect(kits.nth(1)).toContainText('Items to get weigh 4.0 kg as listed');
    await expect(owner.page.locator('#kit-plan-pool')).toContainText('Compared all 8 complete kits made from the 6 listings added');
    // 3. An explicit ordering by a preference: the invented Cohere order labels the kit already shown, and quotes its match.
    await owner.page.getByLabel('Order the kits that fit by').selectOption('light');
    await owner.page.getByRole('button', { name: 'Order with Cohere' }).click();
    await expect(kits.nth(1).locator('.kit-plan-kit-head')).toHaveText('Lower listed weight · Closest to your preference$180.00');
    await expect(kits.nth(1)).toContainText('Cohere’s match in the listing titles: “Tent B, four-person ultralight”');
    expect(cohere).toHaveLength(1);
    expect(JSON.stringify(cohere[0])).not.toMatch(/Rowan|Ash|Wren|Camping gear|House of|2026-12|9000|180/);
    await shot(owner, 'kits-compared', '#kit-plan-result');

    // 4. Rowan chooses the lighter kit and keeps its stove. Ash's page shows the choice live; Wren can only read it.
    await kits.nth(1).getByRole('button', { name: 'Choose this kit' }).click();
    await expect(owner.page.locator('#kit-plan-chosen-title')).toBeFocused();
    await owner.page.getByRole('button', { name: 'Keep stove as it is' }).click();
    await expect(owner.page.getByRole('button', { name: 'Keep stove as it is' })).toHaveAttribute('aria-pressed', 'true');
    for (const p of [ash, wren]) await expect(p.page.locator('#kit-plan-chosen-lines > li')).toHaveCount(3);
    await expect(wren.page.locator('#kit-plan-chosen')).toContainText('· kept');
    await expect(wren.page.getByRole('button', { name: /Keep|Choose this kit|Find listings|Compare complete kits|Review this kit/ })).toHaveCount(0);
    await shot(wren, 'child-chosen', '#kit-plan-chosen');

    // 5. A larger one-off ($120) changes what fits. The comparison follows it without any catalog or model call: the chosen
    // kit would finish Jan 3, and the smallest change, switching only the tent, still finishes by Dec 27.
    await owner.page.getByLabel('One-off amount').fill('120.00');
    await expect(owner.page.locator('#kit-plan-note')).toHaveText('One complete kit fits by Dec 27, after the one-off $120.00.');
    await expect(kits).toHaveCount(1);
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toHaveText('Smallest change · Lowest listed total · Lower listed weight · Fewest shops$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-changes')).toHaveText('Switched 4-person tent: Test fixture: Tent B, four-person ultralight → Test fixture: Tent A, four-person dome, $110.00 → $80.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-lines li', { hasText: 'stove' })).toContainText('kept');
    await expect(owner.page.locator('#kit-plan-chosen-note')).toContainText('Keeping this kit: finishes Jan 3, 2027, 1 week after Dec 27. Keeping the date: $30.00 short by then.');
    expect(catalog.calls.length).toBe(calls);
    expect(cohere).toHaveLength(1);
    await shot(owner, 'smallest-change', '#kit-plan-result');

    // 6. Choosing the repair and reviewing it: an unsaved goal draft in the Plan form, then the goal and its family schedule.
    await kits.nth(0).getByRole('button', { name: 'Choose this kit' }).click();
    await expect(owner.page.locator('#kit-plan-chosen-note')).toContainText('listed total $150.00. Finishes Dec 27 (week 7), on time for Dec 27.');
    await owner.page.getByRole('button', { name: 'Review this kit' }).click();
    await expect(owner.page.locator('#goal-draft-title')).toBeFocused();
    await expect(owner.page.locator('#goal-draft-name')).toHaveText('Chosen kit: 3 items to get');
    await expect(owner.page.locator('#goal-target')).toHaveValue('150.00');
    await expect(owner.page.locator('#goal-date')).toHaveValue('2026-12-27');
    await expect(owner.page.locator('#goal-weekly')).toHaveValue('30.00');
    await expect(owner.page.locator('#goal-draft-effect')).toContainText('nothing is bought');
    await shot(owner, 'kit-goal-draft', '#goal-draft');
    await owner.page.getByRole('button', { name: 'Save goal and propose this schedule' }).click();
    await expect(owner.page.locator('#plan-status')).toContainText('Goal saved and the family schedule proposed');
    await expect(owner.page.locator('#goal-item')).toHaveText('Saved from the chosen kit: 3 items to get, $150.00 listed total (tax and shipping not included).');
    const after = await owner.page.evaluate(async () => (await fetch('/api/state')).json());
    expect([after.goal.targetCents, after.goalKit.totalCents, after.plan.status, after.plan.family.kit]).toEqual([15000, 15000, 'proposed', { totalCents: 15000, lineCount: 3 }]);
    expect(money(s.db)).toBe(before); // no payment, ledger entry, offer or family choice was created or changed
    if (required) expect(kitSolver.stats.native).toBeGreaterThan(0);
    expect(kitSolver.stats.refused).toBe(0);
    for (const p of people) { expect(p.errors).toEqual([]); expect(p.outside).toEqual([]); }
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
