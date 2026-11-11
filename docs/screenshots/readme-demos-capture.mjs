// README captures of two example routes: the shared village fund (npm run demo -- --village-fund) and a simulated
// hold released in steps (npm run demo). Each runs its own disposable in-memory demo on an unused loopback port.
// Requests leaving the page's origin are refused and counted. Nothing here reads .env, a saved household or a provider.
// Run from the repository root: node docs/screenshots/readme-demos-capture.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from '../../test/e2e/support/deeds.mjs';

const dir = fileURLToPath(new URL('./', import.meta.url));
const shot = (name) => `${dir}${name}`;
// Parchment is costly as PNG, so those captures are JPEG. `from` to `to` crops a region between two elements.
const jpeg = { type: 'jpeg', quality: 92 };
async function crop(page, name, from, to = from, pad = 16) {
  await to.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.screenshot({ path: shot(name), ...jpeg, clip: { x: a.x, y: a.y, width: a.width, height: b.y + b.height + pad - a.y } });
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = {};

/** One disposable demo and one page. `run` drives it; page errors and requests leaving the origin fail the capture. */
async function session(name, demo, contextOptions, run) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...contextOptions });
  const outside = [], errors = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== demo.url) { outside.push(url.href); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await closeDeedsWhenTheyAppear(page);
    const facts = await run(page);
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
    checks[name] = { ...facts, pageErrors: errors.length, requestsLeavingTheOrigin: outside.length };
  } finally { await context.close(); await demo.close(); }
}
const ready = async (page, url) => {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
};
const state = (page) => page.evaluate(async () => (await fetch('/api/state')).json());

try {
  // ---- Five invented families, one shared class trip ----
  const fund = await startDemo({ villageFund: true });
  await session('villageFund', fund, { viewport: { width: 1440, height: 900 } }, async (page) => {
    await ready(page, fund.url);
    await expect(page.locator('#village-fund-dialog')).toBeVisible();
    await expect(page.locator('.village-progress-copy')).toHaveText('$200.00 of $400.00 recorded');
    await page.locator('#village-amount').fill('40.00');
    await page.locator('#village-approve').check();
    await page.locator('#village-contribute').click();
    await expect(page.locator('.village-progress-copy')).toHaveText('$240.00 of $400.00 recorded');
    await expect(page.locator('#village-status')).toContainText('Simulated contribution recorded');
    await page.screenshot({ path: shot('village-fund-desktop-sheet.jpg'), ...jpeg });
    await page.locator('#village-visit').click();
    await expect(page.locator('body')).toHaveAttribute('data-village-square', 'true');
    await expect.poll(async () => (await page.evaluate(() => window.__ourCastle.scene().village)).stage).toBe(2);
    await page.waitForTimeout(1200); // let the still scene finish drawing
    await page.screenshot({ path: shot('village-fund-desktop-square.png') });
    const after = await state(page), shared = after.village.funds.find((f) => f.id === after.village.selectedFundId);
    return { sharedFundCents: shared.progress.netMinor, sharedStage: shared.progress.stage, privateProgressCents: after.progress.progressCents, simulatedContributions: 1 };
  });

  // ---- A simulated hold: held, released in two steps, the rest given back ----
  const plain = await startDemo();
  await session('paymentHold', plain, { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }, async (page) => {
    const setup = await page.request.post(`${plain.url}/api/setup`, { data: { playMode: 'family', name: 'House of Fernhill', crest: { field: 'violet', charge: 'tower' } } });
    expect(setup.status()).toBe(200);
    await ready(page, plain.url);
    const tab = async (name) => {
      if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
      await page.locator(`#tab-${name}`).click();
      await expect(page.locator(`#panel-${name}`)).toBeVisible();
    };
    await tab('give');
    await page.locator('#give-amount').fill('40.00');
    await page.locator('#give-hold').check();
    await page.locator('#give-approve').check();
    await expect(page.locator('#give-approve-text')).toHaveText('I approve holding $40.00 USD (simulated).');
    await crop(page, 'payment-holds-1-hold-it-first.jpg', page.locator('#panel-give'), page.locator('#simulate-pay'), 28);
    await page.locator('#simulate-pay').click();
    await expect(page.locator('#give-status')).toContainText('Held. Nothing is counted');
    await tab('ledger');
    const record = page.locator('#ledger-contributions'), card = record.locator('li[data-contribution]').first(), trail = record.locator('.hold-trail');
    await record.locator('[data-hold="release"]').click();
    await record.locator('.hold-amount').fill('10.00');
    await record.locator('[data-hold="keep-rest"]').check();
    await record.locator('[data-hold="confirm-release"]').click();
    await expect(trail).toHaveText('Held $40.00 → Released $10.00 → $30.00 still held');
    await crop(page, 'payment-holds-2-partly-released.jpg', card);
    await record.locator('[data-hold="release"]').click();
    await record.locator('.hold-amount').fill('15.00');
    await record.locator('[data-hold="confirm-release"]').click();
    await expect(trail).toHaveText('Held $40.00 → Released $10.00 → Released $15.00 → Returned $15.00');
    // The card's own running-total line belongs to one ledger row, so this crop ends at the trail.
    await crop(page, 'payment-holds-3-trail.jpg', card, trail, 5);
    const after = await state(page), held = after.contributions.find((c) => c.hold);
    return { progressCents: after.progress.progressCents, heldCents: held.hold.heldCents, releasedCents: held.hold.releasedCents, trail: held.hold.trail.map((t) => t.step), simulated: held.simulated };
  });

  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  writeFileSync(shot('readme-demos-sources.json'), `${JSON.stringify({
    capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    sourceCommit: git('rev-parse', 'HEAD'),
    whatThisIs: 'Five captures of two real running examples, taken by docs/screenshots/readme-demos-capture.mjs. village-fund-desktop-sheet.jpg and village-fund-desktop-square.png: npm run demo -- --village-fund after one simulated $40 contribution. payment-holds-1-hold-it-first.jpg, payment-holds-2-partly-released.jpg and payment-holds-3-trail.jpg: npm run demo with a simulated $40 hold, $10 released keeping the rest, then $15 released as the final release. The hold captures are crops of the journal; the third ends at the money trail.',
    invented: 'Every family, name, crest, amount and contribution shown. The five village families (Alder, Birch, Maple, Oak, Willow), their $200 of starting contributions and the class trip are the authored example. "House of Fernhill" was created for this capture.',
    notShown: 'No PayPal request of any kind: the contributions, the hold, both releases and the returned remainder are simulated by this server in example mode. No model, catalogue or ranking request. No human playtest and no physical device.',
    environment: `Playwright ${(await import('@playwright/test/package.json', { with: { type: 'json' } })).default.version} / Chromium ${browser.version()} headless with SwiftShader, reduced motion, ${process.platform} ${process.arch}. The hold captures are element crops at device scale 2.`,
    checks,
  }, null, 2)}\n`);
  console.log(JSON.stringify(checks, null, 2));
} finally { await browser.close(); }
