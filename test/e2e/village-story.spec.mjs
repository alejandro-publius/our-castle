import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

test('the library opens at contribution, grows after explicit approval and selects that receipt', { tag: '@release' }, async ({ browser }, info) => {
  const demo = await startDemo({ villageStory: true });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const outside = [], errors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === demo.url) return route.continue();
    outside.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const read = () => page.evaluate(async () => (await fetch('/api/state')).json());
  try {
    await page.goto(demo.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    await closeDeedsWhenTheyAppear(page);
    await expect(page.locator('#tab-give')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#village-story-intro')).toBeVisible();
    await expect(page.locator('#give-heading')).toHaveText('Village library');
    await expect(page.locator('#give-heading')).toBeInViewport();
    await expect(page.locator('#village-story-progress')).toHaveText('$150.00 of $300.00 recorded · $150.00 to go');
    await expect(page.locator('#give-amount')).toHaveValue('30.00');
    await expect(page.locator('#next-step-go')).toHaveText('Choose a contribution');
    await expect(page.locator('#give-approve')).not.toBeChecked();
    const pay = page.getByRole('button', { name: 'Simulate approved payment', exact: true });
    await expect(pay).toBeDisabled();
    expect((await read()).contributions).toHaveLength(1);
    mkdirSync('test-results/village-story', { recursive: true });
    await page.screenshot({ path: `test-results/village-story/${info.project.name}-opening.png` });

    await page.locator('#give-approve').check();
    await pay.click();
    await expect(page.locator('#receipt')).toContainText('Simulated · example mode · no PayPal transaction');
    await expect(page.locator('#next-step-go')).toHaveText('Review the receipt');
    const paid = await read();
    expect(paid.progress.progressCents).toBe(18000);
    expect(paid.progress.contributedCents).toBe(0);
    expect(paid.contributions).toHaveLength(2);
    const contribution = paid.contributions.find(c => c.amountCents === 3000);
    await page.locator('#next-step-go').click();
    await expect(page.locator('#tab-ledger')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`#ledger-contributions [data-contribution="${contribution.id}"]`)).toBeVisible();
    await expect(page.locator('#ledger-selected-record')).toContainText('$30.00');
    await page.screenshot({ path: `test-results/village-story/${info.project.name}-receipt.png` });
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#tab-ledger')).toHaveAttribute('aria-selected', 'true');
    expect((await read()).contributions).toHaveLength(2);

    await page.locator('#tab-give').click();
    await page.locator('#persona').selectOption('m_wren');
    await expect(page.locator('#give-approve')).toBeDisabled();
    await expect(pay).toBeDisabled();
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); await demo.close(); }
});
