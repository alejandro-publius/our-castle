import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';

// The simple Treasury: records, one next-area milestone (AG Studio custom widget) and receipts on tap. Real app on its own
// port with a fresh in-memory example database; simulated example payments only, no licence, no provider credentials.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/treasury/evidence/', import.meta.url));

let s;
const issues = new WeakMap();
const writes = new WeakMap();
// This suite verifies records and Studio queries, not world animation; keep captures stable on software renderers.
test.use({ reducedMotion: 'reduce' });
test.afterEach(async ({ page }) => { expect(issues.get(page)).toEqual([]); await s?.close(); s = null; });

async function startServer({ plannedWeek = false } = {}) {
  const db = openDatabase(':memory:');
  const clock = createClock(plannedWeek ? '2026-10-30T12:00:00Z' : undefined);
  const app = createApp({ config: loadConfig({}, { root }), db, clock, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${server.address().port}`;
  const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) })).json();
  return { base, post, clock, close: () => new Promise((r) => {
    server.close(() => { db.close(); r(); });
    server.closeAllConnections();
  }) };
}

async function open(page, { studio = true, plannedWeek = false } = {}) {
  s = await startServer({ plannedWeek });
  const list = [], posted = [];
  issues.set(page, list); writes.set(page, posted);
  page.on('pageerror', (e) => list.push(e.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== s.base) { list.push(`${r.method()} ${r.url()}`); return route.abort(); }
    if (!studio && url.pathname === '/vendor/ag-studio/ag-studio.min.js') return route.fulfill({ status: 503, body: 'unavailable' });
    if (r.method() !== 'GET') posted.push(`${r.method()} ${url.pathname}`);
    return route.continue();
  });
  await page.addLocatorHandler(page.locator('#deed-dialog[open]'), async () => { await page.locator('#deed-close').click(); });
  await s.post('/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } }); // example household
  if (plannedWeek) {
    const proposal = await s.post('/api/plans/rules', {});
    const accepted = await s.post(`/api/plans/${proposal.plan.id}/accept`, {});
    expect(accepted.plan.status).toBe('accepted');
    // Advance the isolated fixture to the first due week; no model call or manual plan-row fabrication.
    s.clock.now = () => new Date('2026-11-06T12:00:00Z');
  }
  await page.goto(`${s.base}/`);
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
}
const treasury = (page) => page.evaluate(() => window.__ourCastle.treasury());
async function openLedger(page, source = 'ag-studio') {
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click(); // visiting the map closes it
  await page.locator('#tab-ledger').click();
  await expect.poll(async () => (await treasury(page))?.source).toBe(source);
  await expect(page.locator(`#treasury-next .next-area[data-source="${source}"]`)).toBeVisible();
}
const milestone = (page) => page.locator('#treasury-next .next-area');

test('Ledger: one next area from AG Studio, records and receipts on tap; no questions, model calls or writes', async ({ page }, info) => {
  await open(page);
  // Reopening the Ledger while its first script is still loading must not mount two grids.
  let releaseGrid;
  const gridGate = new Promise((resolve) => { releaseGrid = resolve; });
  await page.route('**/vendor/ag-grid/ag-grid-community.min.js', async (route) => { await gridGate; await route.continue(); });
  await page.locator('#tab-ledger').click();
  await page.locator('#tab-ledger').click();
  releaseGrid();
  await openLedger(page);
  await expect(page.locator('#ledger-goal .ag-root-wrapper')).toHaveCount(1);
  await expect(milestone(page).locator('.next-area-name')).toHaveText('Next area · 25% Manor Gardens');
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$60.00 of $75.00 · $15.00 to go');
  await expect(milestone(page).getByRole('meter', { name: 'Progress toward Manor Gardens' })).toHaveAttribute('aria-valuenow', '6000');
  expect((await treasury(page)).next).toMatchObject({ id: 'manor', thresholdCents: 7500, remainingCents: 1500, share: .8 });
  await expect(milestone(page).locator('.next-area-bar > span')).toHaveCSS('width', /px$/);
  expect(await milestone(page).locator('.next-area-bar > span').evaluate(el => el.style.width)).toBe('80%');

  // The simple design: no question box, Explain button, bridge question, chat or model label in the Treasury.
  const ledger = page.locator('#panel-ledger');
  for (const text of [/What opened/i, /Explain/i, /Ask why/i, /\bAI\b/, /model/i, /chat/i]) {
    await expect(ledger.locator('h3, h4, .next-area, #ledger-goal, #ledger-contributions, button:visible, label:visible').filter({ hasText: text })).toHaveCount(0);
  }
  await expect(page.locator('#steward-block')).not.toHaveAttribute('open', '');
  await expect(page.locator('#steward-form')).toBeHidden();

  // Filtering and searching the records never changes the canonical total or the next area, and asks nobody anything.
  const before = await milestone(page).innerText();
  for (const filter of ['Bills', 'Gifts', 'Goal progress', 'All']) await page.locator('#ledger-filter').getByRole('button', { name: filter, exact: true }).click();
  await page.locator('#ledger-search').fill('reported');
  await expect(page.locator('#ledger-goal')).toContainText('Example starting progress');
  await expect(page.locator('#ledger-goal')).toContainText('Current tracked progress');
  await page.locator('#ledger-search').fill('');
  expect(await milestone(page).innerText()).toBe(before);

  // A receipt on tap: the reported starting progress, with its source.
  await page.locator('#ledger-goal').getByText('Example starting progress', { exact: false }).first().click();
  await expect(page.locator('#ledger-contributions')).toContainText('You reported');
  await expect(page.locator('#ledger-contributions')).toContainText('+$60.00');
  expect(writes.get(page)).toEqual([]);
  mkdirSync(evidence, { recursive: true });
  await page.locator('#panel-ledger h3').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}${info.project.name}-ledger.png` });

  // "View on map" moves the camera to the area and focuses its map control. Nothing is written.
  await milestone(page).getByRole('button', { name: 'View Manor Gardens on the map' }).click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('manor');
  await expect(page.locator('#realm-markers [data-district="manor"]')).toBeFocused();
  expect(writes.get(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a search typed while the records are still loading applies to them when the grid appears', async ({ page }) => {
  await open(page);
  const state = await page.evaluate(() => window.__ourCastle.state);
  await s.post('/api/example/contributions', { householdId: state.household.id, goalId: state.goal.id, amountCents: 500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'treasury-held-search-0001', outcome: 'completed' });
  let releaseGrid;
  const gridGate = new Promise((resolve) => { releaseGrid = resolve; });
  await page.route('**/vendor/ag-grid/ag-grid-community.min.js', async (route) => { await gridGate; await route.continue(); });
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-ledger').click();
  await page.locator('#ledger-search').fill('reported');
  await expect(page.locator('#ledger-goal')).not.toHaveAttribute('data-grid'); // the grid script is still held
  releaseGrid();
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'ag-grid');
  const records = page.locator('#ledger-goal .ag-row:not(.ag-row-pinned)');
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('Example starting progress');
  await expect(page.locator('#ledger-search')).toHaveValue('reported');
  // Both records, the contribution made before the reload included, once the search is cleared.
  await page.locator('#ledger-search').fill('');
  await expect(records).toHaveCount(2);
  expect(writes.get(page)).toEqual([]);
});

// Both optional scripts go unanswered until `release()`, as a request that never settles would.
async function holdBundles(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  for (const path of ['**/vendor/ag-grid/ag-grid-community.min.js', '**/vendor/ag-studio/ag-studio.min.js'])
    await page.route(path, async (route) => { await gate; await route.continue().catch(() => {}); });
  return release;
}
// With the fake clock installed: move it to eight seconds after `t0`, the page's time when the Ledger was requested.
const eightSecondsAfter = async (page, t0) => page.clock.fastForward(Math.max(0, Math.floor(t0 + 8000 - await page.evaluate(() => performance.now()))));
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('if the Grid and Studio scripts never answer, the latest records and milestone are usable within eight seconds; a late load changes nothing', async ({ page }) => {
  await open(page);
  await page.clock.install();
  const release = await holdBundles(page);
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  const t0 = await page.evaluate(() => performance.now());
  await page.locator('#tab-ledger').click();
  // A newer record, a filter and a search, all while neither script has answered.
  await page.locator('#bill-form [name="label"]').fill('Test fixture: water');
  await page.locator('#bill-form [name="amount"]').fill('25');
  await page.locator('#bill-form button').click();
  await expect(page.locator('#ledger-status')).toContainText('Logged');
  await page.locator('#ledger-filter').getByRole('button', { name: 'Bills', exact: true }).click();
  await page.locator('#ledger-search').fill('water');
  await expect(page.locator('#ledger-goal')).not.toHaveAttribute('data-grid');
  await expect(milestone(page)).toHaveCount(0);
  await eightSecondsAfter(page, t0);
  // The existing plain table and milestone, from the latest server state, with the filter and search applied.
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback');
  const rows = page.locator('#ledger-goal tbody tr:not(.total)');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Test fixture: water');
  await expect(page.locator('#ledger-goal tr.total')).toContainText('$60.00');
  await expect(page.locator('#ledger-search')).toHaveValue('water');
  await expect(page.locator('#ledger-search')).toBeFocused();
  await expect(page.locator('#treasury-next .next-area[data-source="fallback"] .next-area-meta')).toHaveText('$60.00 of $75.00 · $15.00 to go');
  expect(await treasury(page)).toMatchObject({ source: 'fallback', error: 'AG Studio did not start in time' });
  await page.locator('#ledger-filter').getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('#ledger-search').fill('');
  await expect(rows).toHaveCount(2);
  // The scripts arrive late: nothing is mounted over the fallback, and focus stays where the family left it.
  release();
  await page.waitForFunction(() => window.agGrid && window.agStudio);
  await frames(page);
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback');
  await expect(page.locator('#ledger-goal .ag-root-wrapper')).toHaveCount(0);
  await expect(page.locator('#treasury-next .ag-studio-root')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#ledger-search')).toBeFocused();
  expect((await treasury(page)).source).toBe('fallback');
  // The existing explicit reload brings both back.
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  await openLedger(page);
  await expect(page.locator('#ledger-goal .ag-root-wrapper')).toHaveCount(1);
  await expect(page.locator('#ledger-goal .ag-row:not(.ag-row-pinned)')).toHaveCount(2);
  expect(writes.get(page)).toEqual(['POST /api/entries']);
});

test('the receipt route reaches its record within eight seconds even if the Grid and Studio scripts never answer', async ({ page }) => {
  await open(page);
  await page.clock.install();
  const release = await holdBundles(page);
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill('5.00');
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment', exact: true }).click();
  await expect(page.locator('#next-step-go')).toHaveText('Review the receipt');
  const contribution = await page.evaluate(() => window.__ourCastle.state.contributions[0]);
  expect(contribution).toMatchObject({ amountCents: 500, status: 'completed', simulated: true });
  await page.locator('#next-step-go').focus();
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Enter');
  await expect(page.locator('#tab-ledger')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ledger-goal')).not.toHaveAttribute('data-grid');
  await eightSecondsAfter(page, t0);
  await expect(page.locator('#ledger-selected-record')).toBeFocused();
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback');
  await expect(page.locator('#ledger-contributions li[data-contribution]')).toHaveAttribute('data-contribution', contribution.id);
  await expect(page.locator('#ledger-goal .ledger-record-button[aria-pressed="true"]')).toHaveText(/Simulated contribution/);
  await expect(page.locator('#treasury-next .next-area[data-source="fallback"] .next-area-meta')).toHaveText('$65.00 of $75.00 · $10.00 to go');
  // A late load keeps the receipt and its focus.
  release();
  await page.waitForFunction(() => window.agGrid && window.agStudio);
  await frames(page);
  await expect(page.locator('#ledger-selected-record')).toBeFocused();
  await expect(page.locator('#ledger-goal .ag-root-wrapper')).toHaveCount(0);
  await expect(page.locator('#treasury-next .ag-studio-root')).toHaveCount(0);
  expect(writes.get(page)).toEqual(['POST /api/example/contributions']);
});

test('a completed contribution opens the Manor once; the Treasury moves on, survives reload, and pending or refunds behave', async ({ page }, info) => {
  await open(page, { plannedWeek: true });
  // The ordinary Contribute flow with adult approval (simulated example payment). The world shows the Manor deed.
  await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill('15.00');
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment' }).click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.state.rewards.realm.districts.find((d) => d.id === 'manor').open)).toBe(true);
  await openLedger(page);
  await expect(milestone(page).locator('.next-area-name')).toHaveText('Next area · 40% Market Town');
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$75.00 of $120.00 · $45.00 to go');
  expect((await treasury(page)).next.share).toBe(.625);
  expect(await milestone(page).locator('.next-area-bar > span').evaluate(el => el.style.width)).toBe('62.5%');
  await expect(milestone(page).locator('.treasury-week-row.recorded')).toHaveText('Simulated$15.00');
  await expect(milestone(page).locator('.treasury-week-row.plan')).toHaveText('Planned$30.00');
  mkdirSync(evidence, { recursive: true });
  await milestone(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}${info.project.name}-week.png` });
  await milestone(page).getByText('1 record', { exact: true }).click();
  await expect(milestone(page)).toContainText('Starting savings ($60.00) are separate.');
  await milestone(page).getByRole('button', { name: 'Contribution · $15.00 · Simulated', exact: true }).click();
  await expect(page.locator('#ledger-contributions li').first()).toBeFocused();

  // The contribution's receipt names its source and status, and leads to the area it opened.
  await page.locator('#ledger-goal').getByText('Simulated contribution', { exact: false }).first().click();
  const receipt = page.locator('#ledger-contributions');
  await expect(receipt).toContainText('$15.00');
  await expect(receipt).toContainText('Completed — counted');
  await expect(receipt).toContainText('simulated');
  await receipt.getByRole('button', { name: 'Visit Manor Gardens' }).click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('manor');

  // Reload: the same server state, the same milestone; no deed is shown again.
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  await openLedger(page);
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$75.00 of $120.00 · $45.00 to go');

  // A pending payment changes nothing; a refund lowers progress but the Manor stays open, so Market Town is still next.
  const state = await page.evaluate(() => window.__ourCastle.state);
  await s.post('/api/example/contributions', { householdId: state.household.id, goalId: state.goal.id, amountCents: 2000, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'treasury-e2e-pending-0001', outcome: 'pending' });
  const capture = state.contributions[0].captures[0].captureId;
  await s.post(`/api/example/captures/${capture}/refund`, { householdId: state.household.id, approverId: 'm_rowan', approvalConfirmed: true });
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  await openLedger(page);
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$60.00 of $120.00 · $60.00 to go');
  await expect(milestone(page).locator('.next-area-name')).toContainText('Market Town');
  expect((await treasury(page)).next.share).toBe(.5);
  expect(await page.evaluate(() => window.__ourCastle.state.rewards.realm.districts.find((d) => d.id === 'manor').open)).toBe(true);
});

test('Amount sorts displayed pending and declined amounts alongside signed entries without counting them', async ({ page }) => {
  await open(page);
  const state = await page.evaluate(() => window.__ourCastle.state);
  const input = { householdId: state.household.id, goalId: state.goal.id, approverId: 'm_rowan', approvalConfirmed: true };
  const completed = await s.post('/api/example/contributions', { ...input, amountCents: 500, requestId: 'treasury-sort-completed-0001', outcome: 'completed' });
  expect(completed.outcome).toBe('completed');
  for (const [outcome, amountCents, expected] of [['pending', 1500, 'pending'], ['failed', 4000, 'declined']]) {
    const result = await s.post('/api/example/contributions', { ...input, amountCents, requestId: `treasury-sort-${outcome}-0001`, outcome });
    expect(result.outcome).toBe(expected);
  }
  const refund = await s.post(`/api/example/captures/${completed.contribution.captures[0].captureId}/refund`, input);
  expect(refund.outcome).toBe('refunded');
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  await openLedger(page);
  const before = await page.evaluate(() => window.__ourCastle.state);
  const grid = page.locator('#ledger-goal');
  const rows = grid.locator('.ag-row:not(.ag-row-pinned)');
  await expect(rows).toHaveCount(5);
  const amounts = () => rows.evaluateAll((nodes) => [...nodes]
    .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
    .map((row) => row.querySelector('[col-id="amount"]').textContent.trim()));
  const header = grid.locator('.ag-header-cell[col-id="amount"]');
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(amounts).toEqual(['−$5.00', '+$5.00', '$15.00', '$40.00', '+$60.00']);
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(amounts).toEqual(['+$60.00', '$40.00', '$15.00', '+$5.00', '−$5.00']);

  for (const [amount, status] of [['$15.00', 'Pending — not counted yet'], ['$40.00', 'Declined — not counted']]) {
    const row = rows.filter({ has: page.locator('[col-id="amount"]').filter({ hasText: amount }) });
    await expect(row.locator('[col-id="counts"]')).toHaveText('No — not counted');
    await row.locator('[col-id="amount"]').click();
    await expect(page.locator('#ledger-contributions')).toContainText(status);
  }
  await expect(grid.locator('.ag-row[row-id="total"] [col-id="amount"]')).toHaveText('$60.00');
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$60.00 of $75.00 · $15.00 to go');
  expect(await page.evaluate(() => window.__ourCastle.state)).toEqual(before);
  expect(writes.get(page)).toEqual([]);
});

test('Studio live transactions and grid updates preserve sorting, filters, selection and instance', async ({ page }) => {
  await open(page); await openLedger(page);
  await page.locator('#ledger-filter').getByRole('button', { name: 'Goal progress', exact: true }).click();
  await page.locator('#ledger-search').fill('reported');
  await page.locator('#ledger-goal').getByText('Example starting progress', { exact: false }).first().click();
  await page.locator('#ledger-goal .ag-header-cell[col-id="amount"]').click();
  const sort = await page.locator('#ledger-goal .ag-header-cell[col-id="amount"]').getAttribute('aria-sort');
  const selected = await page.locator('#ledger-goal .ag-row-selected').getAttribute('row-id');
  await page.evaluate(() => { window.__testTreasuryRoot = document.querySelector('#treasury-next .ag-studio-root'); window.__testGridRoot = document.querySelector('#ledger-goal .ag-root-wrapper'); });
  const state = await page.evaluate(() => window.__ourCastle.state);
  const response = await page.request.put(`${s.base}/api/goal`, { data: { name: state.goal.name, targetCents: 40000, startingCents: 6000, weeklyBudgetCents: state.goal.weeklyBudgetCents, targetDate: state.goal.targetDate } });
  expect(response.ok()).toBe(true);
  // Logging a local example bill returns the latest state, including the changed target; no provider is involved.
  await page.locator('#bill-form [name="label"]').fill('Test fixture: water');
  await page.locator('#bill-form [name="amount"]').fill('25');
  await page.locator('#bill-form button').click();
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$60.00 of $100.00 · $40.00 to go');
  expect((await treasury(page)).transactions).toBeGreaterThan(0);
  await expect(page.locator('#ledger-search')).toHaveValue('reported');
  await expect(page.locator('#ledger-filter').getByRole('button', { name: 'Goal progress', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ledger-goal .ag-header-cell[col-id="amount"]')).toHaveAttribute('aria-sort', sort);
  await expect(page.locator('#ledger-goal .ag-row-selected')).toHaveAttribute('row-id', selected);
  expect(await page.evaluate(() => window.__testGridRoot === document.querySelector('#ledger-goal .ag-root-wrapper'))).toBe(true);
  expect(await page.evaluate(() => window.__testTreasuryRoot === document.querySelector('#treasury-next .ag-studio-root'))).toBe(true);
  await expect(milestone(page).locator('.treasury-week-row.recorded')).toContainText('$0.00');
  await expect(milestone(page).locator('.next-area-art')).toHaveAttribute('src', 'assets/area-cards/manor.png');
});

test('if AG Studio cannot load, the same milestone is drawn from the same server data; keyboard reaches it', async ({ page }) => {
  await open(page, { studio: false });
  await openLedger(page, 'fallback');
  await expect(milestone(page).locator('.next-area-meta')).toHaveText('$60.00 of $75.00 · $15.00 to go');
  expect(await milestone(page).locator('.next-area-bar > span').evaluate(el => el.style.width)).toBe('80%');
  expect((await treasury(page)).error).toBe('AG Studio could not be loaded');
  // Keyboard: from the Ledger tab, Tab reaches the milestone's map button.
  await page.locator('#tab-ledger').focus();
  const visit = milestone(page).getByRole('button', { name: 'View Manor Gardens on the map' });
  for (let i = 0; i < 6 && !(await visit.evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(visit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('manor');
  expect(writes.get(page)).toEqual([]);
});
