import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { updateGoal } from '../../server/household.mjs';
import { buildPlanText, rulesAmounts } from '../../server/planner/basis.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Real Plan UI and read-only calculation, isolated example records, no keys or provider/model calls.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const rows = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
let s;
test.afterEach(async () => { if (s) { await s.close(); s = null; } });

async function start(page, { accepted = false, proposed = false, withModel = false, withMerchant = false } = {}) {
  const env = setupDomain({ mode: 'example' });
  const modelCalls = [], fake = createFakeChannel3(() => fakeSearchResponse([fakeProduct({ images: [] })]));
  const aiProvider = withModel ? { provider: 'anthropic', model: 'scripted-test-model', async proposePlan(basis) {
    modelCalls.push(basis);
    return { output: buildPlanText(basis, rulesAmounts(basis)), model: 'scripted-test-model', requestId: 'req_local_fixture' };
  } } : null;
  const merchant = withMerchant ? createMerchant({ apiKey: 'fake-key-not-real', fetch: fake.fetch, clock: env.clock }) : null;
  const app = createApp({ root, db: env.db, clock: env.clock, config: loadConfig(withModel ? { AI_API_KEY: 'fake-key-not-real' } : {}, { root }), aiProvider, merchant });
  let plan = null;
  if (accepted || proposed) {
    plan = app.planner.proposeRules({ householdId: env.householdId, goalId: env.goalId }).plan;
    if (accepted) app.planner.accept({ householdId: env.householdId, goalId: env.goalId, planId: plan.id });
  }
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  s = { env, app, plan, base, modelCalls, fake, writes: [], stateReads: 0, issues: [], close: async () => {
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); env.db.close();
  } };
  page.on('pageerror', error => s.issues.push(error.message));
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== base) { s.issues.push(`${r.method()} ${r.url()}`); return route.abort(); }
    if (r.method() !== 'GET') s.writes.push({ method: r.method(), path: url.pathname, body: r.postDataJSON() });
    else if (url.pathname === '/api/state') s.stateReads++;
    return route.continue();
  });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-plan').click();
}

const check = page => page.getByRole('button', { name: 'Check schedule', exact: true });
const output = page => page.locator('#plan-check-result');
const state = page => page.evaluate(() => window.__ourCastle.state);
function clean(page) {
  expect(s.issues).toEqual([]);
  return expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('trying a weekly amount and later date is read-only until the family explicitly makes a new plan', async ({ page }, info) => {
  await start(page, { accepted: true });
  const before = rows(s.env.db), headline = await page.locator('#plan-headline').innerText();
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan · in use');
  await page.locator('#goal-weekly').fill('20.00');
  await check(page).focus();
  await page.keyboard.press('Enter');
  await expect(output(page)).toContainText('$80.00 short by Dec 29, 2026 at $20.00 a week.');
  await expect(output(page).locator('details')).not.toHaveAttribute('open', '');
  expect(rows(s.env.db)).toBe(before);
  expect((await state(page)).acceptedPlanId).toBe(s.plan.id);
  await expect(page.locator('#plan-headline')).toHaveText(headline);
  await output(page).getByRole('button', { name: 'Try Jan 26, 2027', exact: true }).click();
  await expect(page.locator('#goal-date')).toHaveValue('2027-01-26');
  await expect(page.locator('#goal-date')).toBeFocused();
  await expect(page.locator('#goal-weekly')).toHaveValue('20.00');
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview']);
  await check(page).click();
  await expect(output(page)).toContainText('Up to $20.00 a week, finishing Jan 26, 2027.');
  await output(page).locator('summary').click();
  await expect(output(page).locator('tbody tr')).toHaveCount(12);
  expect(rows(s.env.db)).toBe(before);
  await output(page).locator('summary').click();
  await output(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('remaining-plan-check.png') });

  await page.getByRole('button', { name: 'Make an example plan', exact: true }).click();
  await expect(page.locator('#plan-status')).toContainText('Plan ready. Review it below.');
  const after = await state(page);
  expect(after.goal.weeklyBudgetCents).toBe(2000);
  expect(after.goal.targetDate).toBe('2027-01-26');
  expect(after.plan.status).toBe('proposed');
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan');
  expect(after.acceptedPlanId).toBe(null);
  expect(after.progress.progressCents).toBe(6000);
  expect(after.contributions).toHaveLength(0);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview', '/api/plans/preview', '/api/plans']);
  await clean(page);
});

test('the returned schedule controls the finish date; zero, long horizons and invalid dates save nothing', async ({ page }) => {
  await start(page);
  const before = rows(s.env.db);
  await page.locator('#goal-weekly').fill('100.00');
  await check(page).click();
  await expect(output(page)).toContainText('Up to $100.00 a week, finishing Dec 29, 2026.');
  await expect(output(page).locator('p').first()).not.toContainText('Nov 24'); // other weekly rows still include this date
  await page.locator('#goal-weekly').fill('0.00');
  await expect(output(page)).toBeHidden();
  await check(page).click();
  await expect(output(page)).toContainText('At $0.00 a week, $240.00 remains.');
  await expect(output(page).getByRole('button')).toHaveCount(0);
  await page.locator('#goal-weekly').fill('1.00');
  await check(page).click();
  await expect(output(page)).toContainText('240 weeks, beyond the 52-week planning limit.');
  await expect(output(page).getByRole('button')).toHaveCount(0);
  await page.locator('#goal-date').fill('2026-11-04');
  await check(page).click();
  await expect(output(page)).toContainText('Choose a target date between one week and one year from today.');
  await expect(page.locator('#goal-weekly')).toHaveValue('1.00');
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.every(r => r.path === '/api/plans/preview')).toBe(true);
  await clean(page);
});

test('a proposal accepted after another contribution gets current records and requires a fresh review', async ({ page }) => {
  await start(page, { proposed: true });
  s.env.service.simulateContribution({ ...contribution(), outcome: 'completed' });
  const before = rows(s.env.db), readsBefore = s.stateReads;
  await page.getByRole('button', { name: 'Use this plan', exact: true }).click();
  await expect(page.locator('#plan-review-status')).toContainText('Progress or goal details changed.');
  await expect(page.getByRole('button', { name: 'Use this plan', exact: true })).toBeDisabled();
  // The newly received contribution also opens the real Manor deed. Dismiss it as a family would; focus returns to
  // the recovery action selected before the card opened, and closing the card makes no write.
  await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await page.locator('#deed-close').click();
  await expect(page.locator('#ask-planner')).toBeFocused();
  await expect(page.locator('.week-amount').first()).not.toBeEditable();
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  expect(rows(s.env.db)).toBe(before);
  expect(s.stateReads).toBe(readsBefore + 1);
  expect((await state(page)).acceptedPlanId).toBe(null);
  await page.locator('#goal-weekly').fill('20.00');
  await check(page).click();
  await expect(output(page)).toContainText('$65.00 short');
  expect(rows(s.env.db)).toBe(before);
  await page.getByRole('button', { name: 'Make an example plan', exact: true }).click();
  await expect(page.locator('#plan-status')).toContainText('Plan ready.');
  expect((await state(page)).plan.totals.remainingCents).toBe(22500);
  await expect(page.locator('#plan-review-status')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Use this plan', exact: true })).toBeEnabled();
  await clean(page);
});

test('typing cancels old checks; loading a newer goal preserves the family’s current amount and date', async ({ page }) => {
  await start(page, { accepted: true });
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/plans/preview', async route => {
    const response = await route.fetch(); began(); await gate;
    await route.fulfill({ response }).catch(() => {}); // input changes may have aborted this old request
  }, { times: 1 });
  await page.locator('#goal-weekly').fill('20.00');
  await check(page).click(); await started;
  await page.locator('#goal-weekly').fill('25.00');
  release();
  await expect(output(page)).toBeHidden();
  await expect(check(page)).toBeEnabled();
  await expect(check(page)).not.toHaveAttribute('aria-busy', 'true');

  updateGoal(s.env.db, s.env.goalId, { ...s.app.state().goal, name: 'A shared school trip', targetCents: 40000, startingCents: 6000, weeklyBudgetCents: 3500 }, s.env.clock);
  const before = rows(s.env.db);
  await check(page).click();
  await expect(output(page)).toContainText('Your goal or contributions changed.');
  let releaseRead, readBegan;
  const reading = new Promise(resolve => { readBegan = resolve; });
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  await page.route('**/api/state', async route => {
    const response = await route.fetch(); readBegan(); await readGate; await route.fulfill({ response });
  }, { times: 1 });
  await output(page).getByRole('button', { name: 'Load latest goal' }).click(); await reading;
  await page.locator('#goal-weekly').fill('20.00');
  await page.locator('#goal-date').fill('2027-01-26');
  // The recovery must retain all unsaved choices, including bill rows and edits typed while the read is pending.
  await page.locator('#add-commitment').click();
  await page.getByRole('textbox', { name: 'Bill 1 name', exact: true }).fill('Internet bill');
  await page.getByRole('textbox', { name: 'Bill 1 amount', exact: true }).fill('60.00');
  await page.getByRole('combobox', { name: 'Bill 1 frequency', exact: true }).selectOption('weekly');
  releaseRead();
  await expect(output(page)).toContainText('Latest goal loaded.');
  await expect(page.locator('#goal-name-input')).toHaveValue('A shared school trip');
  await expect(page.locator('#goal-target')).toHaveValue('400.00');
  await expect(page.locator('#goal-weekly')).toHaveValue('20.00');
  await expect(page.locator('#goal-date')).toHaveValue('2027-01-26');
  await expect(page.getByRole('textbox', { name: 'Bill 1 name', exact: true })).toHaveValue('Internet bill');
  await expect(page.getByRole('textbox', { name: 'Bill 1 amount', exact: true })).toHaveValue('60.00');
  await expect(page.getByRole('combobox', { name: 'Bill 1 frequency', exact: true })).toHaveValue('weekly');
  expect(rows(s.env.db)).toBe(before);
  await check(page).click();
  await expect(output(page)).toContainText('$100.00 short by Jan 26, 2027');
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.every(r => r.path === '/api/plans/preview')).toBe(true);
  await page.locator('#ask-planner').click();
  await expect(page.locator('#plan-status')).toContainText('Plan ready.');
  expect(s.writes.at(-1).body.commitments).toEqual([{ label: 'Internet bill', amountCents: 6000, cadence: 'weekly' }]);
  expect((await state(page)).plan.inputs.commitments).toEqual([{ label: 'Internet bill', amountCents: 6000, cadence: 'weekly' }]);
  await clean(page);
});

test('Enter in a trial weekly amount or date checks without invoking a model or setting aside the plan in use', async ({ page }) => {
  await start(page, { accepted: true, withModel: true });
  const before = rows(s.env.db);
  await page.locator('#goal-weekly').fill('20.00');
  await page.locator('#goal-weekly').press('Enter');
  await expect(output(page)).toContainText('$80.00 short');
  await page.locator('#goal-date').fill('2027-01-26');
  await page.locator('#goal-date').press('Enter');
  await expect(output(page)).toContainText('finishing Jan 26, 2027');
  expect(s.modelCalls).toEqual([]);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview', '/api/plans/preview']);
  expect(rows(s.env.db)).toBe(before);
  expect((await state(page)).acceptedPlanId).toBe(s.plan.id);
  // An explicit Make-plan button remains an intentional write and calls only the injected scripted model.
  await page.locator('#ask-planner').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#plan-status')).toContainText('The AI plan passed every server check.');
  expect(s.modelCalls).toHaveLength(1);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview', '/api/plans/preview', '/api/plans']);
  expect((await state(page)).acceptedPlanId).toBe(null);
  await clean(page);
});

async function selectMarketDraft(page) {
  await page.locator('#find-goal-item').click();
  await page.locator('#merchant-query').fill('four person tent');
  await page.locator('#merchant-budget').fill('200');
  await page.locator('#merchant-search').click();
  await page.locator('#merchant-results').getByRole('button', { name: 'Use as goal', exact: true }).click();
  await expect(page.locator('#goal-draft')).toBeVisible();
  await expect(page.locator('#goal-target')).toHaveValue('189.50');
}

test('selecting a market draft immediately removes the previous goal calculation and disables its check', async ({ page }) => {
  await start(page, { accepted: true, withMerchant: true });
  const before = rows(s.env.db);
  await page.locator('#goal-weekly').fill('20.00');
  await check(page).click();
  await expect(output(page)).toContainText('$80.00 short');
  await selectMarketDraft(page);
  await expect(output(page)).toBeHidden();
  await expect(check(page)).toBeDisabled();
  await expect(page.locator('#ask-planner')).toBeDisabled();
  expect(rows(s.env.db)).toBe(before);
  expect(s.fake.calls).toHaveLength(1);
  await page.locator('#goal-weekly').press('Enter');
  await expect(output(page)).toHaveText('Save or discard the market draft first.');
  await expect(page.locator('#goal-draft-title')).toBeFocused();
  await expect(check(page)).toBeDisabled();
  expect(rows(s.env.db)).toBe(before);
  await page.locator('#goal-draft-discard').click();
  await expect(check(page)).toBeEnabled();
  await expect(output(page)).toBeHidden();
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview', '/api/merchant/search']);
  await clean(page);
});

for (const trial of [false, true]) test(`loading newer saved settings refreshes untouched fields${trial ? ' while retaining a chosen weekly trial' : ' before a deliberate new plan'}`, async ({ page }) => {
  await start(page, { accepted: true });
  if (trial) await page.locator('#goal-weekly').fill('20.00');
  updateGoal(s.env.db, s.env.goalId, { ...s.app.state().goal, startingCents: 6000, weeklyBudgetCents: 4000, targetDate: '2027-01-05' }, s.env.clock);
  const before = rows(s.env.db);
  await check(page).click();
  await expect(output(page)).toContainText('Your goal or contributions changed.');
  await output(page).getByRole('button', { name: 'Load latest goal' }).click();
  await expect(output(page)).toContainText('Latest goal loaded.');
  await expect(page.locator('#goal-weekly')).toHaveValue(trial ? '20.00' : '40.00');
  await expect(page.locator('#goal-date')).toHaveValue('2027-01-05');
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.map(r => r.path)).toEqual(['/api/plans/preview']);
  await check(page).click();
  await expect(output(page)).toContainText(trial ? '$60.00 short by Jan 5, 2027' : 'finishing Jan 5, 2027');
  expect(rows(s.env.db)).toBe(before);
  await page.locator('#ask-planner').click();
  await expect(page.locator('#plan-status')).toContainText('Plan ready.');
  const saved = await state(page);
  expect(saved.goal.weeklyBudgetCents).toBe(trial ? 2000 : 4000);
  expect(saved.goal.targetDate).toBe('2027-01-05');
  expect(s.writes.at(-1).body.goal.weeklyBudgetCents).toBe(trial ? 2000 : 4000);
  expect(saved.progress.progressCents).toBe(6000);
  expect(saved.contributions).toHaveLength(0);
  await clean(page);
});

for (const failedRead of [false, true]) test(`a market selection during ${failedRead ? 'a failed refresh' : 'loading the latest goal'} keeps its draft and cannot revive the old calculation`, async ({ page }) => {
  await start(page, { accepted: true, withMerchant: true });
  updateGoal(s.env.db, s.env.goalId, { ...s.app.state().goal, name: 'Newer shared trip', targetCents: 40000, startingCents: 6000 }, s.env.clock);
  await check(page).click();
  await expect(output(page)).toContainText('Your goal or contributions changed.');
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/state', async route => {
    const response = await route.fetch(); began(); await gate;
    if (failedRead) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'fixture_unavailable', message: 'Fixture local read unavailable.' } }) });
    else await route.fulfill({ response });
  }, { times: 1 });
  const readFinished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/state');
  await output(page).getByRole('button', { name: 'Load latest goal' }).click(); await started;
  await selectMarketDraft(page);
  const before = rows(s.env.db);
  release();
  await (await readFinished).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (failedRead) await expect(page.locator('#goal-name')).toHaveText('Camping trip fund');
  else await expect(page.locator('#goal-name')).toHaveText('Newer shared trip');
  await expect(page.locator('#goal-name-input')).toHaveValue('Test fixture: Four-person dome tent');
  await expect(page.locator('#goal-target')).toHaveValue('189.50');
  await expect(page.locator('#goal-draft')).toBeVisible();
  await expect(check(page)).toBeDisabled();
  await expect(output(page)).toBeHidden();
  expect(rows(s.env.db)).toBe(before);
  await clean(page);
});

test('a refused week edit keeps the choices and explains the overage once', async ({ page }) => {
  await start(page, { proposed: true });
  const before = rows(s.env.db);
  await page.locator('#plan-result details').evaluate(el => { el.open = true; });
  await page.locator('.week-amount').first().fill('300.00');
  await page.locator('#save-edits').click();
  const message = 'These weeks add up to $510.00, more than the $240.00 still needed.';
  await expect(page.locator('#plan-status')).toHaveText(message);
  await expect(page.locator('.week-amount').first()).toHaveValue('300.00');
  expect(rows(s.env.db)).toBe(before);
  expect(s.writes.map(r => r.method)).toEqual(['PUT']);
  await clean(page);
});
