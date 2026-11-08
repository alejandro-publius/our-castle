import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person, settled } from './support/family.mjs';

// A family's reviewed choice carried into a proposed, then accepted, weekly schedule in a shared family:
// - two adults and a child, each in their own browser with their own passkey;
// - the real Channel3 merchant code over a FAKE transport (invented tents), a family-mode server and in-memory data.
// The figures are the task's example: Nov 8, $60.00 tracked, $30.00 a week, offers of $20.00 (Rowan) and $10.00 (Ash), the
// $150.00 tent, a Dec 20 date and a one-off $90.00. Test data, not a family's result.
test.use({ reducedMotion: 'reduce' });
const evidence = fileURLToPath(new URL('../../test-results/family-schedule/', import.meta.url));
const TENT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><path d="M6 52 32 12l26 40Z" fill="#527557"/></svg>';
const ITEMS = [['fakeTentA', 'Test fixture: Two-person tent', 120], ['fakeTentB', 'Test fixture: Four-person tent', 150], ['fakeTentC', 'Test fixture: Six-person tent', 180]];
const DAY = 86_400_000;

// The server's day starts at Nov 8, 2026 (noon) and moves on with real time; the test can also move it forward.
function exampleClock() {
  const started = Date.now(), base = new Date('2026-11-08T12:00:00').getTime();
  let offset = 0;
  const now = () => new Date(base + offset + (Date.now() - started));
  return { now, iso: () => now().toISOString(), advance(ms) { offset += ms; },
    today() { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } };
}
const catalog = () => createFakeChannel3(() => fakeSearchResponse(ITEMS.map(([id, title, price]) => fakeProduct({ id, title,
  offers: [{ url: `https://buy.trychannel3.com/fake/${id}`, domain: 'example-outfitter.com', price: { price, currency: 'USD' }, availability: 'InStock', condition: 'new' }] }))));
// Every money record, row by row, which no planning step may change; the deeds; and the plan records.
const MONEY = ['payment_orders', 'payment_captures', 'payment_refunds', 'deferred_refunds', 'order_checks', 'ledger_entries', 'webhook_events'];
const money = (db) => JSON.stringify(MONEY.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const deeds = (db) => db.prepare('SELECT key FROM achievements ORDER BY key').all().map((r) => r.key);
const plans = (db) => db.prepare('SELECT status, plan_json FROM plans ORDER BY rowid').all().map((r) => [r.status, JSON.parse(r.plan_json).kind ?? 'ordinary']);
const option = (p, title) => p.page.locator('#family-options > li', { hasText: title });
// The plan table as the family reads it: week, date, amount and the line under it.
const scheduleRows = (p) => p.page.locator('#plan-schedule tr').evaluateAll((rows) => rows.map((r) => [r.cells[0].textContent, r.cells[1].textContent,
  r.cells[2].querySelector('.schedule-amount')?.textContent ?? null, r.cells[2].querySelector('.schedule-share')?.textContent ?? '']));
const ONE_OFF = 'This week’s $30.00 goes to the one-off expense.', SHARES = 'Rowan $20.00 · Ash $10.00';
const EXPECTED_ROWS = [['Week 1', 'Nov 15, 2026', '$0.00', ONE_OFF], ['Week 2', 'Nov 22, 2026', '$0.00', ONE_OFF], ['Week 3', 'Nov 29, 2026', '$0.00', ONE_OFF],
  ['Week 4', 'Dec 6, 2026', '$30.00', SHARES], ['Week 5', 'Dec 13, 2026', '$30.00', SHARES], ['Week 6', 'Dec 20, 2026', '$30.00', SHARES]];

async function openChoices(p) {
  await openTab(p.page, 'plan');
  const box = p.page.locator('#family-choices');
  if (!(await box.evaluate((el) => el.open))) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
}

test('a family carries a reviewed one-off $90 into a proposed, then accepted, weekly schedule with each adult’s share', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(240_000);
  const fake = catalog();
  const clock = exampleClock();
  const s = await familyServer({ clock, merchant: createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: fake.fetch, clock }), live: { recheckMs: 1_000 } });
  const people = [];
  const join = async (name) => { const p = await person(browser, info, name, { origin: s.origin, image: TENT_SVG }); people.push(p); return p; };
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
    const ledger = money(s.db);

    // 1. The existing shortlist and offers: three tents from one explicit search, then each adult's own weekly offer.
    await openChoices(owner);
    await owner.page.locator('#family-find').click();
    await owner.page.locator('#merchant-query').fill('tent');
    await owner.page.locator('#merchant-search').click();
    for (const [n, [id]] of ITEMS.entries()) {
      await owner.page.locator(`#merchant-results [data-product="${id}"] .merchant-shortlist`).click();
      await expect(owner.page.locator('#merchant-status')).toHaveText(`Added to the family choices (${n + 1} of 3).`);
    }
    await owner.page.locator('#merchant-close').click();
    await owner.page.locator('#family-offer-input').fill('20.00');
    await owner.page.locator('#family-offer-save').click();
    await openChoices(ash);
    await ash.page.locator('#family-offer-input').fill('10.00');
    await ash.page.locator('#family-offer-save').click();
    await expect(owner.page.locator('#family-offer-list li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $10.00 a week']);
    await openChoices(wren);
    // Adults may also propose a schedule for the current goal as it is; a child may not.
    await expect(option(owner, 'Current goal').getByRole('button', { name: 'Propose this schedule' })).toBeVisible();
    await expect(option(wren, 'Current goal').getByRole('button', { name: 'Propose this schedule' })).toHaveCount(0);

    // 2. The owner tries a one-off $90.00 (no request) and reviews the $150.00 tent: an unsaved goal draft whose family
    //    schedule preview shows the dated weeks and each adult's share. Nothing is written.
    const before = sent.get('Rowan').length;
    await owner.page.locator('#family-trial-input').fill('90.00');
    await expect(option(owner, ITEMS[1][1]).locator('.family-option-result')).toHaveText('Finishes Dec 20 (week 6), on time for Dec 20.');
    expect(sent.get('Rowan').slice(before)).toEqual([]);
    await option(owner, ITEMS[1][1]).getByRole('button', { name: 'Review this choice' }).click();
    await expect(owner.page.locator('#goal-draft')).toBeVisible();
    expect(writes('Rowan').slice(-1)).toEqual(['POST /api/family-choices/review']);
    await expect(owner.page.locator('#goal-draft-weeks li')).toHaveText([
      'Weeks 1–3 (Nov 15–Nov 29): $0.00 to the goal; each week’s $30.00 goes to the one-off expense',
      'Weeks 4–6 (Dec 6–Dec 20): $30.00 a week — Rowan $20.00 · Ash $10.00',
    ]);
    await expect(owner.page.locator('#goal-draft-schedule-note')).toHaveText('These weeks cover the $90.00 still needed by Dec 20. Saving proposes them; “Use this plan” is still a separate choice. Nothing is paid or held.');
    const propose = owner.page.getByRole('button', { name: 'Save goal and propose this schedule' });
    await expect(propose).toBeEnabled();
    await expect(owner.page.getByRole('button', { name: 'Save as our goal' })).toBeEnabled();
    // Editing the reviewed amount means these weeks no longer apply, so only the goal itself could be saved.
    await owner.page.locator('#goal-target').fill('160.00');
    await expect(propose).toBeDisabled();
    await expect(owner.page.locator('#goal-draft-schedule-note')).toContainText('so these weeks no longer apply');
    await owner.page.locator('#goal-target').fill('150.00');
    await expect(propose).toBeEnabled();
    expect([money(s.db), plans(s.db), deeds(s.db)]).toEqual([ledger, [], ['estate:porch']]);
    await shot(owner, 'schedule-preview', '#goal-draft');

    // 3. "Save goal and propose this schedule": the goal and the reviewed weeks as a PROPOSAL, in one save. Nothing is in use yet.
    await propose.click();
    await expect(owner.page.locator('#plan-status')).toHaveText('Goal saved and the family schedule proposed. Check its weeks below, then choose “Use this plan”. Nothing is paid.');
    // The existing goal save records the milestones $60.00 already reaches under $150.00, and shows their deed card.
    await owner.page.getByRole('button', { name: 'Close all' }).click();
    await expect(owner.page.locator('#plan-source')).toHaveText('Family schedule');
    await expect(owner.page.locator('#plan-headline')).toHaveText('After the one-off $90.00, three weeks of $30.00 reach the Castle');
    await expect.poll(() => scheduleRows(owner)).toEqual(EXPECTED_ROWS);
    await expect(owner.page.locator('#plan-total')).toHaveText('$90.00');
    await expect(owner.page.locator('#plan-schedule-help')).toHaveText('— from each adult’s own offer; nothing is paid or held');
    await expect(owner.page.locator('#save-edits')).toBeHidden();
    await expect(owner.page.locator('#accept-plan')).toHaveText('Use this plan');
    expect(await owner.page.evaluate(() => [window.__ourCastle.state.acceptedPlanId, window.__ourCastle.state.nextStep])).toEqual([null, null]);
    expect([money(s.db), plans(s.db), deeds(s.db)]).toEqual([ledger, [['proposed', 'family']], ['estate:market', 'estate:porch', 'tier:1']]);
    // The other adult sees the same proposal live; the child sees it but cannot use it.
    await expect(ash.page.locator('#plan-source')).toHaveText('Family schedule');
    await expect.poll(() => scheduleRows(ash)).toEqual(EXPECTED_ROWS);
    await expect(wren.page.locator('#plan-source')).toHaveText('Family schedule');
    await expect(wren.page.locator('#accept-plan')).toBeDisabled();

    // 4. "Use this plan". The next positive contribution is week 4 (Dec 6, $30.00); the reserved weeks are not $0 payments.
    await owner.page.locator('#accept-plan').click();
    await expect(owner.page.locator('#plan-status')).toHaveText('Plan in use. Each contribution still needs an adult’s approval.');
    await expect(owner.page.locator('#panel-give')).toBeVisible();
    await expect(owner.page.locator('#give-amount')).toHaveValue('30.00');
    expect(await owner.page.evaluate(() => window.__ourCastle.state.nextStep)).toEqual({ week: 4, date: '2026-12-06', plannedCents: 3000, dueCents: 3000, contributedSinceCents: 0 });
    await openTab(owner.page, 'plan');
    await expect(owner.page.locator('#plan-source')).toHaveText('Family schedule · in use');
    await expect(owner.page.locator('#accept-plan')).toHaveText('Plan in use ✓');
    await shot(owner, 'plan-in-use', '#plan-result');
    // The Treasury's week (Nov 2-8) plans nothing; Ash and Wren read the same accepted weeks.
    await openTab(owner.page, 'ledger');
    await expect(owner.page.locator('#treasury-next .treasury-week-row.plan')).toHaveText('Planned$0.00');
    for (const p of [ash, wren]) {
      await expect(p.page.locator('#plan-source')).toHaveText('Family schedule · in use');
      await expect.poll(() => scheduleRows(p)).toEqual(EXPECTED_ROWS);
    }
    expect([money(s.db), plans(s.db), deeds(s.db)]).toEqual([ledger, [['accepted', 'family']], ['estate:market', 'estate:porch', 'tier:1']]);

    // 5. A reload keeps the accepted weeks; the one-off trial was never saved, and the page does not claim it was.
    await owner.page.reload();
    await settled(owner.page);
    await openChoices(owner);
    await expect(owner.page.locator('#family-trial-input')).toHaveValue('');
    await expect(owner.page.locator('#plan-source')).toHaveText('Family schedule · in use');
    await expect.poll(() => scheduleRows(owner)).toEqual(EXPECTED_ROWS);

    // 6. A week later the server day is Nov 15, a week the expense takes: Ash signs in again and reads the same dated weeks,
    //    and the Treasury plans $0.00 for that week. On Dec 1 its week holds week 4's $30.00. Nothing restarts the $90.00.
    clock.advance(7 * DAY);
    await ash.page.reload();
    await ash.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await settled(ash.page);
    await openTab(ash.page, 'plan');
    await expect(ash.page.locator('#plan-source')).toHaveText('Family schedule · in use');
    await expect.poll(() => scheduleRows(ash)).toEqual(EXPECTED_ROWS);
    await openTab(ash.page, 'ledger');
    await expect(ash.page.locator('#treasury-next .treasury-week-head')).toContainText('Week of Nov 9');
    await expect(ash.page.locator('#treasury-next .treasury-week-row.plan')).toHaveText('Planned$0.00');
    await shot(ash, 'treasury-reserved-week', '#treasury-next', 'center');
    clock.advance(16 * DAY);
    await ash.page.reload();
    await ash.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await settled(ash.page);
    await openTab(ash.page, 'ledger');
    await expect(ash.page.locator('#treasury-next .treasury-week-head')).toContainText('Week of Nov 30');
    await expect(ash.page.locator('#treasury-next .treasury-week-row.plan')).toHaveText('Planned$30.00');
    expect(await ash.page.evaluate(() => [window.__ourCastle.state.nextStep.date, window.__ourCastle.state.nextStep.plannedCents])).toEqual(['2026-12-06', 3000]);
    // A later family schedule is an explicit new proposal. Ash enters no one-off amount now, so none is assumed; the accepted
    // weeks stay in use until someone chooses "Use this plan".
    await openChoices(ash);
    await expect(ash.page.locator('#family-trial-input')).toHaveValue('');
    await option(ash, 'Current goal').getByRole('button', { name: 'Propose this schedule' }).click();
    await expect(ash.page.locator('#family-status')).toHaveText(`Family schedule proposed for ${ITEMS[1][1]}. Check its weeks in the plan below, then choose “Use this plan”. Nothing is paid.`);
    await expect(ash.page.locator('#plan-source')).toHaveText('Family schedule');
    await expect.poll(() => scheduleRows(ash)).toEqual([['Week 1', 'Dec 8, 2026', '$30.00', SHARES], ['Week 2', 'Dec 15, 2026', '$30.00', SHARES]]);
    await expect(ash.page.locator('#accept-plan')).toHaveText('Use this plan');
    const later = await ash.page.evaluate(() => { const st = window.__ourCastle.state; return [st.plan.id !== st.acceptedPlanId, st.nextStep.date, st.plan.family.reserveCents]; });
    expect(later).toEqual([true, '2026-12-06', 0]);

    // Only the explicit search reached a provider. No payment, steward, model or ordinary-plan request was made, and the only
    // plan writes were the one save with its proposal and the one "Use this plan".
    expect(fake.calls).toHaveLength(1);
    expect(writes('Rowan').filter((w) => /plans|merchant\/goal/.test(w))).toEqual(['POST /api/merchant/goal', expect.stringMatching(/^POST \/api\/plans\/plan_[\w-]+\/accept$/)]);
    expect(writes('Ash').filter((w) => /plans|merchant\/goal/.test(w))).toEqual(['POST /api/plans/family']);
    for (const p of people) {
      expect(writes(p.name).filter((w) => /paypal|steward|example\/|entries|\/api\/plans$|plans\/rules/.test(w))).toEqual([]);
      expect(p.errors).toEqual([]);
      expect(p.outside).toEqual([]);
    }
    expect([money(s.db), plans(s.db), deeds(s.db)]).toEqual([ledger, [['accepted', 'family'], ['proposed', 'family']], ['estate:market', 'estate:porch', 'tier:1']]);
    expect(await ash.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
