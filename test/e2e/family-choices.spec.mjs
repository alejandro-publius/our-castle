import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person } from './support/family.mjs';

// Family choices in a shared family:
// - two adults and a child, each in their own browser with their own passkey;
// - the real Channel3 merchant code over a FAKE transport (invented tents), a family-mode server and in-memory data.
// The figures are the task's example: Nov 8, $60.00 tracked, $30.00 a week, offers of $20.00 and $10.00, items at
// $120.00 / $150.00 / $180.00 and a Dec 20 date. Test data, not a family's result.
test.use({ reducedMotion: 'reduce' });
const evidence = fileURLToPath(new URL('../../test-results/family-buying-plan/', import.meta.url));
const TENT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><path d="M6 52 32 12l26 40Z" fill="#527557"/></svg>';
const ITEMS = [['fakeTentA', 'Test fixture: Two-person tent', 120], ['fakeTentB', 'Test fixture: Four-person tent', 150], ['fakeTentC', 'Test fixture: Six-person tent', 180]];

// The server's day is Nov 8, 2026 (noon), moving on with real time, so the weekly dates are the example's own.
function exampleClock() {
  const started = Date.now(), base = new Date('2026-11-08T12:00:00').getTime();
  const now = () => new Date(base + (Date.now() - started));
  return { now, iso: () => now().toISOString(), today() { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } };
}
const catalog = () => createFakeChannel3(() => fakeSearchResponse(ITEMS.map(([id, title, price]) => fakeProduct({ id, title,
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency: 'USD' }, availability: 'InStock', condition: 'new' }] }))));
// The money and plan records a planning action must never touch, plus the goal itself.
const records = (db) => JSON.stringify([
  db.prepare(`SELECT (SELECT COUNT(*) FROM payment_orders) AS orders, (SELECT COUNT(*) FROM payment_captures) AS captures, (SELECT COUNT(*) FROM payment_refunds) AS refunds,
    (SELECT COUNT(*) FROM ledger_entries) AS entries, (SELECT COALESCE(SUM(effect * amount_cents), 0) FROM ledger_entries) AS net, (SELECT COUNT(*) FROM plans) AS plans,
    (SELECT COUNT(*) FROM achievements) AS achievements, (SELECT COUNT(*) FROM goal_items) AS items`).get(),
  db.prepare('SELECT name, target_cents, target_date, weekly_budget_cents FROM goals').all(),
]);
const option = (p, title) => p.page.locator('#family-options > li', { hasText: title });

async function openChoices(p) {
  await openTab(p.page, 'plan');
  const box = p.page.locator('#family-choices');
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
}

test('two adults and a child shortlist three items, offer weekly amounts, prefer one, try a $90 one-off and hand a choice to the goal form', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(240_000);
  const fake = catalog();
  const clock = exampleClock();
  const s = await familyServer({ clock, merchant: createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: fake.fetch, clock }), live: { recheckMs: 1_000 } });
  const people = [];
  const join = async (name) => { const p = await person(browser, info, name, { origin: s.origin, image: TENT_SVG }); people.push(p); return p; };
  // Captures keep the journal as the family sees it: the comparison from its top, or ending at the one-off trial.
  const shot = async (p, name, { endAt = null } = {}) => {
    if (endAt) await p.page.locator(endAt).evaluate((el) => el.scrollIntoView({ block: 'end' }));
    else await p.page.locator('#family-choices').scrollIntoViewIfNeeded();
    await p.page.screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  };
  mkdirSync(evidence, { recursive: true });
  try {
    const owner = await join('Rowan');
    await createFamily(owner, s.origin, 'Rowan');
    expect((await csrfFetch(owner.page, 'POST', '/api/setup', { name: 'House of Rowan', crest: { field: 'cobalt', charge: 'stag' } })).status).toBe(200);
    const revision = await owner.page.evaluate(async () => (await (await fetch('/api/state')).json()).merchantGoalRevision);
    const goal = await csrfFetch(owner.page, 'PUT', '/api/goal', { name: 'Camping gear', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: '2026-12-20', expectedGoalRevision: revision });
    expect(goal.status).toBe(200);
    const ash = await join('Ash'); await accept(ash, await invite(owner, 'Ash', 'adult'));
    const wren = await join('Wren'); await accept(wren, await invite(owner, 'Wren', 'child'));
    for (const p of people) await isLive(p.page);
    const sent = new Map(people.map((p) => [p.name, []]));
    for (const p of people) p.page.on('request', (r) => sent.get(p.name).push(`${r.method()} ${new URL(r.url()).pathname}`));
    const writes = (name) => sent.get(name).filter((r) => !r.startsWith('GET '));

    // 1. The owner opens Family choices (empty), finds tents in Market Town and adds three. One explicit search.
    await openChoices(owner);
    await expect(owner.page.locator('#family-empty-text')).toHaveText('No choices yet. Find an item in Market Town and add it here.');
    await owner.page.locator('#family-find').click();
    await owner.page.locator('#merchant-query').fill('tent');
    await owner.page.locator('#merchant-search').click();
    await expect(owner.page.locator('#merchant-results .merchant-item')).toHaveCount(3);
    for (const [n, [id]] of ITEMS.entries()) {
      await owner.page.locator(`#merchant-results [data-product="${id}"] .merchant-shortlist`).click();
      await expect(owner.page.locator('#merchant-status')).toHaveText(`Added to the family choices (${n + 1} of 3).`);
    }
    await owner.page.locator('#merchant-close').click();
    expect(fake.calls).toHaveLength(1);
    await expect(owner.page.locator('#family-options > li')).toHaveCount(4); // the current goal and the three choices
    await expect(option(owner, ITEMS[0][1]).locator('.family-option-result')).toHaveText('No finish date until an adult offers a weekly amount.');

    // 2. Each adult saves their own weekly offer; typing alone sends nothing. The other pages update live.
    const beforeTyping = writes('Rowan').length;
    await owner.page.locator('#family-offer-input').fill('20.00');
    expect(writes('Rowan')).toHaveLength(beforeTyping);
    await owner.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-status')).toHaveText('Your offer of $20.00 a week is saved. Your family can see it.');
    await openChoices(ash);
    await expect(ash.page.locator('#family-offer-list')).toHaveText('Rowan: $20.00 a week');
    await expect(ash.page.locator('#family-options > li')).toHaveCount(4);
    await ash.page.locator('#family-offer-input').fill('10.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-offer-list li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $10.00 a week']);

    // 3. The child sees the comparison and may say what they prefer, but offers and trials are adults' own.
    await openChoices(wren);
    await expect(wren.page.locator('#family-my-offer')).toBeHidden();
    await expect(wren.page.locator('#family-offer-note')).toBeVisible();
    await expect(wren.page.locator('#family-trial')).toBeHidden();
    await expect(wren.page.getByRole('button', { name: 'Review this choice' })).toHaveCount(0);
    await option(wren, ITEMS[1][1]).getByRole('button', { name: 'Prefer this' }).click();
    await expect(option(wren, ITEMS[1][1]).getByRole('button', { name: 'Prefer this' })).toHaveAttribute('aria-pressed', 'true');
    // Ash prefers the largest tent, then changes his mind; the owner prefers the smallest.
    await option(ash, ITEMS[2][1]).getByRole('button', { name: 'Prefer this' }).click();
    await expect(option(ash, ITEMS[2][1]).locator('.family-prefs')).toHaveText('1 prefers this: you');
    await option(ash, ITEMS[1][1]).getByRole('button', { name: 'Prefer this' }).click();
    await option(owner, ITEMS[0][1]).getByRole('button', { name: 'Prefer this' }).click();
    // Names follow the family's member order (Ash joined before Wren).
    await expect(option(owner, ITEMS[1][1]).locator('.family-prefs')).toHaveText('2 prefer this: Ash, Wren');
    await expect(option(owner, ITEMS[0][1]).locator('.family-prefs')).toHaveText('1 prefers this: you');
    await expect(option(owner, ITEMS[2][1]).locator('.family-prefs')).toHaveText('No one has said they prefer this yet.');

    // 4. At $30.00 a week, the $60.00, $90.00 and $120.00 still needed take 2, 3 and 4 weeks.
    const results = (p) => ITEMS.map(([, title]) => option(p, title).locator('.family-option-result'));
    const [a, b, c] = results(owner);
    await expect(a).toHaveText('Finishes Nov 22 (week 2), on time for Dec 20.');
    await expect(b).toHaveText('Finishes Nov 29 (week 3), on time for Dec 20.');
    await expect(c).toHaveText('Finishes Dec 6 (week 4), on time for Dec 20.');
    await expect(option(owner, ITEMS[0][1]).locator('.family-split li')).toHaveText(['Weeks 1–2 (Nov 15–Nov 22): Rowan $20.00 · Ash $10.00 a week']);
    await shot(owner, 'three-choices');

    // 5. A one-off $90.00 tried on the owner's page: no request, no saved record. Finishes move to weeks 5, 6 and 7, and
    //    the $180.00 tent misses Dec 20 by $30.00 while the two cheaper ones still fit.
    const before = records(s.db), requestsBefore = sent.get('Rowan').length;
    await owner.page.locator('#family-trial-input').fill('90.00');
    await expect(a).toHaveText('Finishes Dec 13 (week 5), on time for Dec 20.');
    await expect(b).toHaveText('Finishes Dec 20 (week 6), on time for Dec 20.');
    await expect(c).toHaveText('Finishes Dec 27 (week 7): 1 week after Dec 20, $30.00 short by then.');
    await expect(owner.page.locator('#family-trial-note')).toHaveText('Trying a one-off $90.00: it comes out of the first 3 weeks, once, before more goes to the goal. Recorded progress is not touched. Not saved.');
    await expect(owner.page.locator('#family-choice-note')).toContainText(`Still on time for Dec 20: ${ITEMS[0][1]} ($120.00), ${ITEMS[1][1]} ($150.00).`);
    expect(sent.get('Rowan').slice(requestsBefore)).toEqual([]);
    expect(records(s.db)).toBe(before);
    await expect(results(ash)[2]).toHaveText('Finishes Dec 6 (week 4), on time for Dec 20.'); // the trial is the owner's own
    // A syntactically valid amount above the supported range must not break the comparison or drop the last valid trial.
    await owner.page.locator('#family-trial-input').fill('100000.01');
    await expect(owner.page.locator('#family-trial-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(owner.page.locator('#family-status')).toContainText('between $0.00 and $100,000.00');
    await expect(c).toHaveText('Finishes Dec 27 (week 7): 1 week after Dec 20, $30.00 short by then.');
    for (const button of await owner.page.getByRole('button', { name: 'Review this choice' }).all()) await expect(button).toBeDisabled();
    expect(owner.errors).toEqual([]);
    expect(sent.get('Rowan').slice(requestsBefore)).toEqual([]);
    await owner.page.locator('#family-trial-input').fill('90.00');
    await expect(owner.page.locator('#family-trial-input')).not.toHaveAttribute('aria-invalid');
    await expect(option(owner, ITEMS[1][1]).locator('.family-option-change')).toHaveText('Without this expense: Nov 29. This trial adds 3 weeks.');
    await shot(owner, 'one-off-90', { endAt: '#family-trial' });

    // 6. "Review this choice" checks it with the server and fills the goal form as an unsaved draft.
    await option(owner, ITEMS[1][1]).getByRole('button', { name: 'Review this choice' }).click();
    await expect(owner.page.locator('#goal-draft')).toBeVisible();
    await expect(owner.page.locator('#goal-draft-name')).toHaveText(ITEMS[1][1]);
    await expect(owner.page.locator('#goal-target')).toHaveValue('150.00');
    await expect(owner.page.locator('#goal-date')).toHaveValue('2026-12-20');
    await expect(owner.page.locator('#goal-weekly')).toHaveValue('30.00');
    await expect(owner.page.locator('#goal-draft-effect')).toContainText('From family choices: up to $30.00 a week from the adults’ offers, by Dec 20, 2026, allowing for the one-off $90.00 you tried');
    expect(records(s.db)).toBe(before);
    // Ash changes his offer meanwhile: the reviewed draft cannot be saved until the choice is reviewed again.
    await ash.page.locator('#family-offer-input').fill('12.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#goal-draft-save')).toBeDisabled();
    await expect(owner.page.locator('#goal-draft-effect')).toContainText('review the choice again');
    await ash.page.locator('#family-offer-input').fill('10.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-offer-list li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $10.00 a week']);
    await owner.page.locator('#goal-draft-discard').click();
    await option(owner, ITEMS[1][1]).getByRole('button', { name: 'Review this choice' }).click();
    await expect(owner.page.locator('#goal-draft-save')).toBeEnabled();

    // 7. Only the explicit save changes the goal, through the existing Market Town goal save. No money record moves.
    await owner.page.locator('#goal-draft-save').click();
    await expect(owner.page.locator('#plan-status')).toContainText('Goal saved');
    const saved = await owner.page.evaluate(() => window.__ourCastle.state.goal);
    expect([saved.targetCents, saved.targetDate, saved.weeklyBudgetCents]).toEqual([15000, '2026-12-20', 3000]);
    const after = JSON.parse(records(s.db)), was = JSON.parse(before);
    // Orders, captures, refunds, the ledger and plans are unchanged. Deeds follow the existing goal save: milestones the
    // $60.00 already tracked reaches under the new $150.00 amount (10%, 25%, 40%) are recorded, as the Plan editor does.
    expect({ ...after[0], items: was[0].items, achievements: was[0].achievements }).toEqual(was[0]);
    expect(s.db.prepare('SELECT key FROM achievements ORDER BY key').all().map((r) => r.key)).toEqual(['estate:market', 'estate:porch', 'tier:1']);
    expect(after[0].items).toBe(1);
    expect(s.db.prepare('SELECT product_id FROM goal_items').get().product_id).toBe('fakeTentB');
    expect(writes('Rowan').filter((w) => w.startsWith('POST /api/merchant/goal'))).toHaveLength(1);
    await expect(wren.page.locator('#goal-name')).toHaveText(saved.name);

    // 8. A reload shows the same shared choices, offers and preferences.
    await owner.page.reload();
    await owner.page.waitForFunction(() => window.__ourCastle?.state);
    await openChoices(owner);
    await expect(owner.page.locator('#family-options > li')).toHaveCount(4);
    await expect(option(owner, ITEMS[1][1]).locator('.family-prefs')).toHaveText('2 prefer this: Ash, Wren');
    await expect(owner.page.locator('#family-trial-input')).toHaveValue('');

    // Nothing reached a provider but the one search; no payment, refund or model call was made by comparing or voting.
    expect(fake.calls).toHaveLength(1);
    for (const p of people) {
      expect(writes(p.name).filter((w) => /paypal|steward|plans|example\/|entries/.test(w))).toEqual([]);
      expect(p.errors).toEqual([]);
      expect(p.outside).toEqual([]);
    }
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
