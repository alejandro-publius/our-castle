import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import { test, expect } from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// Example-mode journeys through the real server and browser. These prove the product flow, the
// board wiring and the ledger rules. They do not prove a live PayPal sandbox or AI integration.

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const settled = (page) => expect.poll(async () => (await scene(page)).animating, { timeout: 20_000 }).toBe(false);
const isPhone = (testInfo) => testInfo.project.name === 'phone';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // AG Studio prints its own licence banner when no evaluation licence is configured (as in these credential-free
  // tests); with the owner's licence it prints nothing. Only those vendor lines are ignored.
  const studioLicenceNotice = /^\*+$|AG Studio Core License|License Key Not Found|unlocked for trial|hide the watermark/;
  page.on('console', (m) => { if (m.type() === 'error' && !studioLicenceNotice.test(m.text().trim())) errors.push(`console: ${m.text()}`); });
  return errors;
}

async function foundHouse(page, { mode = 'family', name = 'House of Fernhill', field = 'violet', charge = 'tower' } = {}) {
  await page.locator(`input[name="playMode"][value="${mode}"]`).check();
  await page.locator('#house-name').fill(name);
  await page.locator(`input[name="crestField"][value="${field}"]`).check({ force: true });
  await page.locator(`input[name="crestCharge"][value="${charge}"]`).check({ force: true });
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
}

async function acceptExamplePlan(page) {
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan');
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(page.getByRole('tab', { name: /Contribute/ })).toHaveAttribute('aria-selected', 'true');
}

async function contribute(page, button = 'Simulate approved payment') {
  await page.locator('#give-approve').check();
  if (button !== 'Simulate approved payment' && !(await page.locator('#give-action details').evaluate((d) => d.open))) {
    await page.locator('#give-action summary').click();
  }
  await page.getByRole('button', { name: button }).click();
}

// District deeds are tested in area-cards.spec.mjs; here a deed that opens is closed like a family would.
test.beforeEach(({ page }) => closeDeedsWhenTheyAppear(page));
test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/demo/reset', { data: {} });
  expect(response.ok()).toBeTruthy();
});

test('full journey: house and crest, example plan, adult approval, receipt, board move and Manor, persists after reload', async ({ page }) => {
  // This journey verifies the actual unlock card; other journeys may dismiss it automatically.
  await page.removeLocatorHandler(page.locator('#deed-dialog[open]'));
  const errors = trackErrors(page);
  await ready(page);
  await expect(page.locator('#honesty')).toContainText('Demo mode · simulated payments.');
  await openMenu(page, 'world-settings');
  await expect(page.getByText('Built-in planner', { exact: true })).toBeVisible();
  await closeMenu(page, 'world-settings');
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await expect(page.locator('#target-amount')).toHaveText('$300.00');
  expect(await scene(page)).toMatchObject({ position: 4, tier: 0 });

  await foundHouse(page);
  await expect(page.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#house-eyebrow')).toHaveText('House of Fernhill');

  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan');
  await expect(page.locator('#plan-headline')).toHaveText('Eight weeks of $30.00 reaches the Castle');
  await expect(page.locator('#plan-schedule tr')).toHaveCount(8);
  await expect(page.locator('#plan-total')).toHaveText('$240.00');
  await expect(page.locator('#plan-explanation')).toContainText('Goal $300.00 − tracked progress $60.00 = $240.00 still to save.');
  await expect(page.locator('#plan-milestones')).toContainText('Manor ($75.00) — week 1');
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(page.getByRole('tab', { name: /Contribute/ })).toHaveAttribute('aria-selected', 'true');

  await expect(page.locator('#give-context')).toBeHidden();
  await expect(page.locator('#give-amount')).toHaveValue('15.00');
  await expect(page.locator('#quick-picks')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate approved payment' })).toBeDisabled();
  await expect(page.locator('#give-approve-text')).toContainText('I approve $15.00 USD (simulated).');

  const before = await page.locator('#world canvas').screenshot();
  await contribute(page);
  await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await expect(page.locator('#deed-earned')).toHaveText('Unlocked · 25% milestone');
  await expect(page.locator('#celebration')).toBeHidden(); // one unlock card, no duplicate banner
  await page.locator('#deed-close').click();
  await expect(page.locator('#give-status')).toContainText('Confirmed by the server');
  const receipt = page.locator('#receipt');
  await expect(receipt).toContainText('Simulated · example mode · no PayPal transaction');
  await expect(receipt).toContainText('$15.00 USD');
  await expect(receipt).toContainText('$60.00 → $75.00 (25%)');
  await expect(receipt).toContainText('Manor raised');
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await expect(page.locator('#board-title')).toHaveText('Your connected realm');
  await settled(page);
  expect(await scene(page)).toMatchObject({ position: 5, tier: 1, crest: { field: 'violet', charge: 'tower' }, playMode: 'family' });
  await expect(receipt).toBeVisible();
  await expect(receipt).toBeFocused(); // closing the deed returns to the contribution receipt
  const after = await page.locator('#world canvas').screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await expect(page.locator('#board-status')).toContainText('space 5 of 20 · Manor Gate');

  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  expect(await scene(page)).toMatchObject({ position: 5, tier: 1 });
  await expect(page.getByRole('tab', { name: /Contribute/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.locator('#ledger-goal')).toContainText('Current tracked progress');
  await expect(page.locator('#ledger-goal')).toContainText('You reported');
  await expect(page.locator('#ledger-goal[data-grid="ag-grid"] .ag-root')).toBeVisible();
  await expect(page.locator('#ledger-contributions')).toContainText('Completed — counted');
  await expect(page.locator('#achievements')).toContainText('Manor raised');
  expect(errors).toEqual([]);
});

test('keyboard only: found the house, plan, approve and contribute', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'keyboard path is checked on desktop');
  await ready(page);
  const tabTo = async (selector, max = 80) => {
    for (let i = 0; i < max; i++) {
      if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Could not reach ${selector} with the keyboard`);
  };
  await tabTo('#save-house');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
  await tabTo('#ask-planner');
  await page.keyboard.press('Enter');
  await expect(page.locator('#plan-total')).toHaveText('$240.00');
  await tabTo('#accept-plan');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Contribute/ })).toHaveAttribute('aria-selected', 'true');
  await tabTo('#give-approve');
  await page.keyboard.press('Space');
  await tabTo('#simulate-pay');
  await page.keyboard.press('Enter');
  await expect(page.locator('#receipt')).toBeFocused();
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  // Arrow keys move between journey tabs.
  await page.locator('#tab-give').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-ledger')).toBeFocused();
  await expect(page.locator('#panel-ledger')).toBeVisible();
});

test('a child persona cannot approve a payment', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await acceptExamplePlan(page);
  await page.locator('#persona').selectOption('m_wren');
  await expect(page.locator('#give-approve')).toBeDisabled();
  await expect(page.locator('#give-approve-text')).toContainText('Switch to an adult');
  await expect(page.getByRole('button', { name: 'Simulate approved payment' })).toBeDisabled();
  await page.locator('#persona').selectOption('m_rowan');
  await expect(page.locator('#give-approve')).toBeEnabled();
});

test('an impossible target shows the exact shortfall and how to close it', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await page.locator('#goal-weekly').fill('10.00');
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(page.locator('#plan-headline')).toHaveText(/\$160\.00 short/);
  await expect(page.locator('#plan-shortfall')).toContainText('$160.00 short of the goal');
  await expect(page.locator('#plan-cautions')).toContainText('raise the weekly amount to $30.00');
  await expect(page.locator('#plan-milestones')).toContainText('Castle ($300.00) — not reached by this schedule');
});

test('household edits are re-checked and saved as an edited plan', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await page.getByLabel('Week 2 amount').fill('10.00');
  await expect(page.locator('#plan-total')).toHaveText('$220.00');
  await expect(page.getByRole('button', { name: 'Use this plan' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.locator('#plan-source')).toHaveText('Household plan');
  await expect(page.locator('#plan-shortfall')).toContainText('$20.00 short');
  await page.getByLabel('Week 3 amount').fill('-5');
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.locator('#plan-status')).toContainText('Each week needs an amount');
});

test('bills and gifts are logged separately, grow a garden, and never move the travelers', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await page.getByRole('tab', { name: /Ledger/ }).click();
  const bill = page.locator('#bill-form');
  await bill.getByLabel('Bill paid on time').fill('Internet bill');
  await bill.getByLabel('Amount').fill('60.00');
  await bill.getByRole('button', { name: 'Log bill' }).click();
  await expect(page.locator('#ledger-status')).toContainText('do not count toward the goal');
  const gift = page.locator('#gift-form');
  await gift.getByLabel('Gift sent').fill('Birthday gift');
  await gift.getByLabel('Amount').fill('25.00');
  await gift.getByRole('button', { name: 'Log gift' }).click();
  const grid = page.locator('#ledger-goal');
  await expect(grid).toContainText('Birthday gift');
  await expect(grid).toContainText('Internet bill');
  await expect(grid.getByText('No — not savings')).toHaveCount(2);
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  // The record filter narrows the grid to one category; the total row still shows tracked progress.
  await page.locator('#ledger-filter').getByRole('button', { name: 'Bills' }).click();
  await expect(grid).toContainText('Internet bill');
  await expect(grid).not.toContainText('Birthday gift');
  await expect(grid).toContainText('Current tracked progress');
  await page.locator('#ledger-filter').getByRole('button', { name: 'All' }).click();
  await settled(page);
  expect(await scene(page)).toMatchObject({ position: 4, tier: 0, gardens: 1 });
  await expect(page.locator('#achievements')).toContainText('Garden bed 1 planted');
});

test('cancel, decline and pending outcomes leave progress unchanged until completion', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await acceptExamplePlan(page);
  await contribute(page, 'Simulate cancel');
  await expect(page.locator('#give-status')).toContainText('Nothing was charged');
  await contribute(page, 'Simulate decline');
  await expect(page.locator('#give-status')).toContainText('Declined');
  await contribute(page, 'Simulate pending');
  await expect(page.locator('#give-status')).toContainText('Pending');
  await expect(page.locator('#receipt')).toContainText('Pending — not counted');
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Simulate PayPal completing it' }).click();
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  // The Treasury shows one selected receipt. Failed attempts remain in the grid with no credit;
  // selecting them must not change the total or bring back completion/refund actions.
  const receipt = page.locator('#ledger-contributions');
  await expect(receipt).toContainText('Completed — counted');
  for (const status of ['Canceled — nothing charged', 'Declined — not counted']) {
    const row = page.locator('#ledger-goal').getByRole('row').filter({ hasText: status });
    await expect(row).toContainText('No — not counted');
    await row.getByText(status, { exact: true }).click();
    await expect(receipt).toContainText(status);
    await expect(receipt.locator('li')).toHaveCount(1);
    await expect(receipt.getByRole('button', { name: /Simulate refund|Simulate PayPal completing it/ })).toHaveCount(0);
    await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  }
  expect(await page.evaluate(() => window.__ourCastle.state.contributions.flatMap((c) => c.captures).filter((c) => c.credited).length)).toBe(1);
});

test('a refund lowers progress and moves the travelers back; the Manor stays as an explained keepsake', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await acceptExamplePlan(page);
  await contribute(page);
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await settled(page);
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Simulate refund' }).click();
  await page.getByRole('button', { name: 'Confirm refund of $15.00' }).click();
  await expect(page.locator('#ledger-status')).toContainText('went down by exactly that amount');
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await settled(page);
  expect(await scene(page)).toMatchObject({ position: 4, tier: 1 });
  await expect(page.locator('#board-status')).toContainText('commemorates a milestone reached earlier');
  await expect(page.locator('#achievements')).toContainText('Raised buildings stay as keepsakes');
  await expect(page.locator('#ledger-contributions')).toContainText('Refunded — progress reversed');
});

test('without an AI key model questions stay disabled while saved confirmations remain local', async ({ page }) => {
  await ready(page);
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.locator('#steward-note')).toHaveText('Saved confirmations');
  await expect(page.locator('#steward-ask')).toBeDisabled();
  await expect(page.locator('#steward-suggestions button').first()).toBeDisabled();
  await expect(page.locator('#ledger-goal[data-grid="ag-grid"]')).toBeVisible();
  await page.locator('#steward-block > summary').click();
  await page.getByRole('button', { name: 'Last confirmation', exact: true }).click();
  await expect(page.locator('#steward-answer')).toContainText('There is no saved PayPal confirmation for this goal.');
  await expect(page.locator('#steward-answer')).toContainText('No new PayPal check was made.');
  await expect(page.locator('#steward-answer .verification-title')).toHaveText('Saved confirmation');
});

test('layout: no horizontal overflow in any step and amounts stay readable', async ({ page }) => {
  await ready(page);
  for (const tab of ['House', 'Plan', 'Contribute', 'Ledger']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} overflow`).toBeLessThanOrEqual(0);
  }
  const size = async (selector) => page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size('#progress-amount')).toBeGreaterThanOrEqual(24);
  await page.getByRole('tab', { name: /Contribute/ }).click();
  expect(await size('#give-amount')).toBeGreaterThanOrEqual(16);
  const box = await page.locator('#world canvas').boundingBox();
  expect(box.width).toBeGreaterThan(300);
});

test('the world keeps living, and board events drive synthesized sound through the bus', async ({ page }) => {
  const errors = trackErrors(page);
  await ready(page);
  const first = await scene(page);
  expect(first).toMatchObject({ ambient: true, grazers: 4, butterflies: 4 });
  await expect.poll(async () => (await scene(page)).ambientFrames, { timeout: 5000 }).toBeGreaterThan(first.ambientFrames + 3);
  await openMenu(page, 'world-settings');
  const toggle = page.locator('#sound-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('Sound on');
  expect((await page.evaluate(() => window.__ourCastle.sound())).enabled).toBe(true);
  await page.evaluate(() => { window.__ourCastle.bus.log = []; });
  await foundHouse(page);
  await acceptExamplePlan(page);
  await contribute(page);
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await settled(page);
  const types = await page.evaluate(() => window.__ourCastle.bus.log.map((e) => e.type));
  expect(types).toContain('scene:hop');
  expect(types).toContain('scene:rise');
  expect(types).toContain('contribution:result');
  const played = (await page.evaluate(() => window.__ourCastle.sound())).played;
  expect(played).toEqual(expect.arrayContaining(['chime', 'hop', 'fanfare']));
  expect(errors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no ambient loop, and the board updates instantly', async ({ page }) => {
    await ready(page);
    expect(await scene(page)).toMatchObject({ ambient: false, position: 4 });
    await foundHouse(page);
    await acceptExamplePlan(page);
    await contribute(page);
    await expect(page.locator('#progress-amount')).toHaveText('$75.00');
    await settled(page);
    expect(await scene(page)).toMatchObject({ ambient: false, position: 5, tier: 1 });
  });
});

test('the original art preview is preserved and still renders', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/art-preview.html');
  await expect(page.locator('#world canvas[data-ready="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'IV · Castle' }).click();
  await expect(page.locator('#tier-name')).toHaveText('A castle built together');
  expect(errors).toEqual([]);
});
