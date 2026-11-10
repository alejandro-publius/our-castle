import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// Real page and server, invented family/catalogue, disposable in-memory state. Only the delivery of a loopback
// response is delayed: each request still goes through the actual route once. No payment or provider is called.
test.use({ reducedMotion: 'reduce' });
const state = (page) => page.evaluate(async () => (await fetch('/api/state')).json());
const money = (s) => JSON.stringify([s.progress, s.ledger, s.contributions, s.plan, s.acceptedPlanId, s.goal, s.goalKit]);
const clock = () => {
  const start = Date.parse('2026-11-08T18:00:00Z'), real = Date.now();
  return { now: () => new Date(start + Date.now() - real), iso() { return this.now().toISOString(); }, today: () => '2026-11-08' };
};

async function session(browser, info) {
  const demo = await startDemo({ familyTrip: true, clock: clock() });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const errors = [], outside = [], gates = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === demo.url) return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  async function open() {
    await page.goto(demo.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await closeDeedsWhenTheyAppear(page);
    await page.getByRole('button', { name: 'Try a one-off expense' }).click();
  }
  // Wait for the real server response, then hold it until the next user edit is made.
  async function hold(path) {
    let entered, release;
    const ready = new Promise((r) => { entered = r; });
    const released = new Promise((r) => { release = r; });
    gates.push(release);
    await page.route(demo.url + path, async (route) => {
      const response = await route.fetch();
      entered();
      await released;
      await route.fulfill({ response });
    }, { times: 1 });
    return { ready, async finish() {
      const response = page.waitForResponse((r) => r.url() === demo.url + path);
      release();
      await (await response).finished();
      // Let the page consume the delivered JSON and draw; no arbitrary slow-network timeout.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } };
  }
  await open();
  return { page, demo, open, hold, async close() {
    gates.forEach((release) => release());
    await context.close();
    await demo.close();
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
  } };
}

async function compare(page) {
  await page.getByLabel('One-off amount').fill('90.00');
  await page.getByRole('button', { name: 'Compare complete kits', exact: true }).click();
  await expect(page.locator('#kit-plan-note')).toHaveText('2 different complete kits fit by Dec 27, after the one-off $90.00.');
}

test('a weekly offer typed while the previous save finishes stays unsaved until its own explicit save', { tag: '@kit-planner' }, async ({ browser }, info) => {
  const s = await session(browser, info), { page } = s;
  try {
    const before = money(await state(page));
    const held = await s.hold('/api/family-choices/offer');
    await page.getByLabel('Your weekly offer').fill('10.00');
    await page.getByRole('button', { name: 'Save my offer', exact: true }).click();
    await held.ready;
    await page.getByLabel('Your weekly offer').fill('25.00');
    await page.getByLabel('One-off amount').focus(); // another field, while the response is still on its way
    await held.finish();
    await expect(page.locator('#family-offer-list')).toContainText('Rowan (you): $10.00 a week');
    await expect(page.getByLabel('Your weekly offer')).toHaveValue('25.00');
    await expect(page.locator('#family-status')).toContainText('newer edit is not saved');
    await page.getByRole('button', { name: 'Save my offer', exact: true }).click();
    await expect(page.locator('#family-offer-list')).toContainText('Rowan (you): $25.00 a week');
    await expect(page.getByLabel('Your weekly offer')).toHaveValue('25.00');
    const withdrawn = await s.hold('/api/family-choices/offer/withdraw');
    await page.getByRole('button', { name: 'Withdraw my offer', exact: true }).click();
    await withdrawn.ready;
    await page.getByLabel('Your weekly offer').fill('30.00');
    await page.getByLabel('One-off amount').focus();
    await withdrawn.finish();
    await expect(page.locator('#family-offer-list')).not.toContainText('Rowan');
    await expect(page.getByLabel('Your weekly offer')).toHaveValue('30.00');
    await expect(page.locator('#family-status')).toContainText('newer edit is not saved');
    await page.getByRole('button', { name: 'Save my offer', exact: true }).click();
    await expect(page.locator('#family-offer-list')).toContainText('Rowan (you): $30.00 a week');
    expect(money(await state(page))).toBe(before);
  } finally { await s.close(); }
});

test('an invalid expense while the first comparison is pending cannot reveal an actionable old answer', { tag: '@kit-planner' }, async ({ browser }, info) => {
  const s = await session(browser, info), { page } = s;
  try {
    const before = money(await state(page));
    await page.getByLabel('One-off amount').fill('90.00');
    const held = await s.hold('/api/kit/compare');
    await page.getByRole('button', { name: 'Compare complete kits', exact: true }).click();
    await held.ready;
    await page.getByLabel('One-off amount').fill('-1');
    await held.finish();
    await expect(page.locator('#kit-plan-status')).toContainText('Fix the one-off amount');
    await expect(page.locator('#kit-plan-result')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Compare complete kits', exact: true })).toBeDisabled();
    await compare(page);
    expect(money(await state(page))).toBe(before);
  } finally { await s.close(); }
});

test('an invalid expense keeps old comparison figures for reading but disables choosing and map previews', { tag: '@kit-planner' }, async ({ browser }, info) => {
  const s = await session(browser, info), { page } = s;
  try {
    const before = money(await state(page));
    await compare(page);
    await page.getByLabel('One-off amount').fill('-1');
    for (const button of await page.locator('#kit-plan-kits button').all()) await expect(button).toBeDisabled();
    await expect(page.locator('#kit-plan-status')).toContainText('Fix the one-off amount');
    await expect(page.locator('#kit-plan-note')).toContainText('last valid one-off amount');
    await page.getByLabel('One-off amount').fill('120.00');
    await expect(page.locator('#kit-plan-note')).toHaveText('One complete kit fits by Dec 27, after the one-off $120.00.');
    await expect(page.locator('#kit-plan-kits').getByRole('button', { name: 'Choose this kit' })).toBeEnabled();
    expect(money(await state(page))).toBe(before);
    expect((await state(page)).kitPlan.selection).toBeNull();
  } finally { await s.close(); }
});

test('editing an expense during review after reload leaves the goal form alone until a fresh review', { tag: '@kit-planner' }, async ({ browser }, info) => {
  const s = await session(browser, info), { page } = s;
  try {
    await compare(page);
    await page.locator('#kit-plan-kits > li').nth(0).getByRole('button', { name: 'Choose this kit' }).click();
    await expect(page.locator('#kit-plan-chosen-note')).toContainText('listed total $150.00');
    await s.open(); // the saved choice remains, but this new page has never compared
    await expect(page.locator('#kit-plan-result')).toBeHidden();
    const before = money(await state(page));
    await page.getByLabel('One-off amount').fill('90.00');
    const held = await s.hold('/api/kit/review');
    await page.getByRole('button', { name: 'Review this kit', exact: true }).click();
    await held.ready;
    await page.getByLabel('One-off amount').fill('-1');
    await held.finish();
    await expect(page.locator('#kit-plan-status')).toContainText('Fix the one-off amount');
    await expect(page.locator('#goal-draft')).toBeHidden();
    await expect(page.locator('#goal-target')).toHaveValue('300.00');
    await page.getByLabel('One-off amount').fill('120.00');
    await page.getByRole('button', { name: 'Review this kit', exact: true }).click();
    await expect(page.locator('#goal-draft')).toBeVisible();
    await expect(page.locator('#goal-target')).toHaveValue('150.00');
    await expect(page.locator('#goal-draft-effect')).toContainText('one-off $120.00');
    expect(money(await state(page))).toBe(before);
  } finally { await s.close(); }
});
