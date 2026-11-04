import { test, expect } from '@playwright/test';

// The family's next step through the existing House → Plan → Contribute → receipt flow. Example mode only: payments
// here are simulated by the server. Opening a step must never write; making, accepting and paying stay explicit.

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const card = (page) => page.locator('#next-step');
const go = (page) => page.locator('#next-step-go');
const selectedTab = (page) => page.locator('[role="tab"][aria-selected="true"]');
function trackWrites(page) {
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return writes;
}
// Writes caused by `action` only, so explicit actions elsewhere in a test do not hide a navigation write.
async function writesDuring(page, writes, action) {
  const before = writes.length;
  await action();
  await page.waitForTimeout(300);
  return writes.slice(before);
}
const fullyVisible = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; });

async function foundHouse(page) {
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

test('one next step leads from house to plan to contribution; opening a step never writes', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await expect(card(page)).toHaveAttribute('data-key', 'found-house');
  await expect(page.locator('#next-step-title')).toHaveText('Found your house');
  await expect(go(page)).toHaveText('Set up your house');
  await expect(page.locator('#tab-house')).toHaveClass(/\bnext\b/);
  // Keyboard: the step's heading receives focus and is on screen at once.
  expect(await writesDuring(page, writes, async () => { await go(page).focus(); await page.keyboard.press('Enter'); })).toEqual([]);
  await expect(page.locator('#house-heading')).toBeFocused();
  expect(await fullyVisible(page.locator('#house-heading'))).toBe(true);

  await foundHouse(page);
  await expect(card(page)).toHaveAttribute('data-key', 'make-plan');
  await expect(go(page)).toHaveText('Make your plan');
  await page.getByRole('tab', { name: /Ledger/ }).click();
  expect(await writesDuring(page, writes, () => go(page).click())).toEqual([]);
  await expect(selectedTab(page)).toHaveId('tab-plan');
  await expect(page.locator('#plan-heading')).toBeFocused();

  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(card(page)).toHaveAttribute('data-key', 'review-plan');
  await expect(page.locator('#next-step-why')).toContainText('Eight weeks of $30.00 reaches the Castle');
  await expect(page.locator('#tab-plan')).not.toHaveClass(/\bdone\b/);
  expect(await writesDuring(page, writes, async () => { await go(page).focus(); await page.keyboard.press('Enter'); })).toEqual([]);
  await expect(page.locator('#plan-headline')).toBeFocused();
  await expect(page.locator('#accept-plan')).toHaveText('Use this plan'); // opening the review did not accept it

  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(card(page)).toHaveAttribute('data-key', 'contribute-week');
  await expect(page.locator('#next-step-title')).toHaveText('Week 1: add $30.00');
  await expect(page.locator('#next-step-why')).toContainText('The Manor needs $15.00 more.');
  await expect(page.locator('#tab-plan')).toHaveClass(/\bdone\b/);
  await expect(page.locator('#give-context')).toContainText('Plan in use: “Eight weeks of $30.00 reaches the Castle.”');
  // The quick pick and projection connect the plan to the next milestone, as a projection only.
  await expect(page.locator('#give-amount')).toHaveValue('15.00');
  await expect(page.locator('#give-projection')).toContainText('If the server confirms $15.00: $60.00 → $75.00 tracked (25%). The Manor would rise.');
  await expect(page.locator('#give-projection')).toContainText('Nothing counts until then');
  await expect(page.locator('#give-approve')).not.toBeChecked();
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  expect(writes).toEqual(['POST /api/setup', 'POST /api/plans', expect.stringMatching(/^POST \/api\/plans\/plan_\w+\/accept$/)]);

  // A newer plan that is not accepted yet clears the Plan tab's done mark and asks for review.
  await page.getByRole('tab', { name: /Plan/ }).click();
  await page.locator('#goal-weekly').fill('60.00');
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(card(page)).toHaveAttribute('data-key', 'review-plan');
  await expect(page.locator('#tab-plan')).not.toHaveClass(/\bdone\b/);
});

test('a returning family resumes, keeps its chosen tab and unsaved amount, and can reopen the saved payment record', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await foundHouse(page);
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(selectedTab(page)).toHaveId('tab-give');

  // An unsaved amount survives a state refresh caused by an explicit action on another tab.
  await page.locator('#give-amount').fill('12.34');
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.locator('#bill-form input[name="label"]').fill('Water bill');
  await page.locator('#bill-form input[name="amount"]').fill('40.00');
  await page.locator('#bill-form button[type="submit"]').click();
  await expect(page.locator('#ledger-status')).toContainText('Logged');
  await expect(selectedTab(page)).toHaveId('tab-ledger');
  await page.getByRole('tab', { name: /Contribute/ }).click();
  await expect(page.locator('#give-amount')).toHaveValue('12.34');
  await expect(page.locator('#give-projection')).toContainText('If the server confirms $12.34: $60.00 → $72.34 tracked');

  // A pending payment is the next step; it is not credit.
  await page.locator('#give-approve').check();
  await page.locator('#give-action summary').click();
  await page.getByRole('button', { name: 'Simulate pending' }).click();
  await expect(card(page)).toHaveAttribute('data-key', 'payment-pending');
  await expect(page.locator('#next-step-why')).toContainText('$12.34 (simulated example payment) is not counted until it completes. Goal progress is still $60.00.');
  await expect(page.locator('#next-step-record')).toBeHidden();
  expect(await writesDuring(page, writes, async () => { await go(page).focus(); await page.keyboard.press('Enter'); })).toEqual([]);
  await expect(selectedTab(page)).toHaveId('tab-ledger');
  await expect(page.locator('#ledger-contrib-title')).toBeFocused();
  expect(await fullyVisible(page.locator('#ledger-contrib-title'))).toBe(true);

  // Completed while the family is on the Ledger: the receipt is the next step until it is shown.
  await page.getByRole('button', { name: 'Simulate PayPal completing it' }).click();
  await expect(card(page)).toHaveAttribute('data-key', 'receipt-ready');
  await expect(page.locator('#next-step-title')).toHaveText('$12.34 was confirmed');
  await go(page).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#receipt')).toBeFocused();
  await expect(card(page)).toHaveAttribute('data-key', 'contribute-week');
  await expect(page.locator('#receipt')).not.toContainText('null');

  // Refresh: the chosen tab is restored and the saved record is one GET-only link away.
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(selectedTab(page)).toHaveId('tab-give');
  await expect(page.locator('#next-step-record')).toContainText('Last payment: $12.34 · Completed — counted · simulated.');
  const record = page.locator('#next-step-record-go');
  expect(await writesDuring(page, writes, async () => { await record.focus(); await page.keyboard.press('Enter'); })).toEqual([]);
  await expect(selectedTab(page)).toHaveId('tab-ledger');
  const row = page.locator('#ledger-contributions li[data-contribution]').first();
  await expect(row).toBeFocused();
  await expect(row).toContainText('Completed — counted');
});

test('a new visit resumes at the next step, and a child persona is told an adult approves', async ({ page, context }) => {
  await ready(page);
  await foundHouse(page);
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await page.getByRole('button', { name: 'Use this plan' }).click();
  // A fresh browser tab has no chosen tab: it opens the step that is next, not House.
  const second = await context.newPage();
  await second.goto('/');
  await second.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(second.locator('[role="tab"][aria-selected="true"]')).toHaveId('tab-give');
  await second.locator('#persona').selectOption({ label: 'Wren (child, example)' });
  await expect(second.locator('#next-step-why')).toContainText('Wren is a child persona: switch “Acting as” to an adult to approve a payment.');
  await expect(second.locator('#give-approve')).toBeDisabled();
});

test.describe('at 320 by 568', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test('the next step stays readable with no horizontal overflow', async ({ page }) => {
    await ready(page);
    await foundHouse(page);
    await expect(card(page)).toHaveAttribute('data-key', 'make-plan');
    const box = await go(page).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Every step tab label fits inside its tab, including the bold selected one.
    await page.getByRole('tab', { name: /Contribute/ }).click();
    expect(await page.evaluate(() => [...document.querySelectorAll('.steps button')].every((b) => b.scrollWidth <= b.clientWidth))).toBe(true);
  });
});

// The Ledger's AG Grid script loads lazily on the first visit and then sizes itself, pushing the contributions list
// down. A saved-record or Ledger destination must be focused and fully on screen after that layout, not before it.
// The grid script is held back deterministically until the test releases it.
async function householdWithPayment(request) {
  const json = async (res) => { expect(res.ok()).toBeTruthy(); return res.json(); };
  let state = (await json(await request.post('/api/setup', { data: { playMode: 'family', name: 'House of Rivergate', crest: { field: 'cobalt', charge: 'stag' } } }))).state;
  const { goal, progress } = state;
  state = (await json(await request.post('/api/plans', { data: { goal: { name: goal.name, targetCents: goal.targetCents, startingCents: progress.startingCents, targetDate: goal.targetDate, weeklyBudgetCents: goal.weeklyBudgetCents }, commitments: [] } }))).state;
  state = (await json(await request.post(`/api/plans/${state.plan.id}/accept`, { data: {} }))).state;
  const adult = state.members.find((m) => m.role === 'adult');
  return (await json(await request.post('/api/example/contributions', { data: { householdId: state.household.id, goalId: state.goal.id, amountCents: 1500, approverId: adult.id, approvalConfirmed: true, requestId: `record-focus-${Date.now()}`, outcome: 'completed' } }))).state;
}
async function holdLedgerGrid(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/vendor/ag-grid/**', async (route) => { await gate; await route.continue(); });
  return release;
}
const gridState = (page) => page.locator('#ledger-goal').getAttribute('data-grid');

for (const [label, viewport, project] of [['1760 by 760', { width: 1760, height: 760 }, 'desktop'], ['320 by 568', { width: 320, height: 568 }, 'phone']]) {
  test.describe(`saved record after the lazy Ledger grid, at ${label}`, () => {
    test.use({ viewport });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `checked on the ${project} project`));

    test('the record is focused and fully visible once the grid has loaded and sized', async ({ page, request }) => {
      await householdWithPayment(request);
      const release = await holdLedgerGrid(page);
      const writes = trackWrites(page);
      await ready(page);
      await expect(page.locator('#next-step-record')).toContainText('Last payment: $15.00 · Completed — counted · simulated.');
      await page.locator('#next-step-record-go').focus();
      await page.keyboard.press('Enter');
      await expect(selectedTab(page)).toHaveId('tab-ledger');
      expect(await gridState(page)).toBeNull(); // still loading
      release();
      await expect.poll(() => gridState(page)).toBe('ag-grid');
      const row = page.locator('#ledger-contributions li[data-contribution]').first();
      await expect(row).toBeFocused();
      await expect.poll(() => fullyVisible(row), { message: 'the focused record is fully on screen after the grid settles' }).toBe(true);
      // It stays there: nothing below the settled grid moves it off screen afterwards.
      await page.waitForTimeout(500);
      expect(await fullyVisible(row)).toBe(true);
      await expect(row).toContainText('Completed — counted');
      expect(writes).toEqual([]);
    });

    test('choosing another tab while the grid loads keeps the family there', async ({ page, request }) => {
      await householdWithPayment(request);
      const release = await holdLedgerGrid(page);
      const writes = trackWrites(page);
      await ready(page);
      await page.locator('#next-step-record-go').click();
      await expect(selectedTab(page)).toHaveId('tab-ledger');
      await page.getByRole('tab', { name: /Contribute/ }).click();
      const scrollBefore = await page.evaluate(() => scrollY);
      release();
      // The grid finishes loading in the background; it must not pull the family back to the Ledger or its record.
      await page.waitForResponse('**/vendor/ag-grid/**');
      await page.waitForTimeout(800);
      await expect(selectedTab(page)).toHaveId('tab-give');
      expect(await page.evaluate(() => document.activeElement?.closest('#panel-ledger') === null)).toBe(true);
      expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
      expect(writes).toEqual([]);
    });
  });
}
