import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { chooseDistrict, openMenu, closeMenu } from './support/game-controls.mjs';

// Fresh local example household only. No provider, account or payment credential.
const fountain = (page) => page.evaluate(() => window.__ourCastle.scene().fountains);
async function journal(page) { if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click(); }
async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true' && window.__ourCastle?.scene());
  await page.locator('#house-name').fill('House of Alder');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
}
async function pay(page, amount, pending = false) {
  await journal(page); await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill(amount); await page.locator('#give-approve').check();
  if (pending) await page.locator('#give-action summary').click();
  await page.getByRole('button', { name: pending ? 'Simulate pending' : 'Simulate approved payment', exact: true }).click();
}
async function closeDeed(page, name) {
  await expect(page.locator('#deed-dialog')).toBeVisible();
  await expect(page.locator('#deed-name')).toHaveText(name);
  await page.locator('#deed-close').click(); // Close all intentionally dismisses sibling cards.
}
test.beforeEach(async ({ request }) => { expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBe(true); });

test.describe('static accessible keepsakes', () => {
  test.use({ reducedMotion: 'reduce' });
  test('only completed credit opens the fountain; map visits, refund and reload never spray again', async ({ page, request }, info) => {
    await ready(page);
    expect(await fountain(page)).toMatchObject({ sites: [], bursts: 0, flyingCoins: 0 });
    await pay(page, '15.00', true);
    expect(await fountain(page)).toMatchObject({ sites: [], bursts: 0 });
    await page.locator('#tab-ledger').click();
    await page.getByRole('button', { name: 'Simulate PayPal completing it', exact: true }).click();
    await closeDeed(page, 'Manor Gardens');
    expect(await fountain(page)).toMatchObject({ bursts: 1, history: ['manor'], active: null, flyingCoins: 0, settledCoins: 30, reducedMotion: true });
    await chooseDistrict(page, 'manor'); await page.locator('#view-deed').click(); await page.keyboard.press('Escape');
    expect((await fountain(page)).bursts).toBe(1);
    await journal(page); await page.locator('#tab-ledger').click();
    await page.getByRole('button', { name: 'Simulate refund', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm refund of $15.00', exact: true }).click();
    await expect(page.locator('#progress-amount')).toHaveText('$60.00');
    expect(await fountain(page)).toMatchObject({ bursts: 1, settledCoins: 30 });
    await pay(page, '15.00');
    await expect(page.locator('#progress-amount')).toHaveText('$75.00');
    await expect.poll(async () => (await page.evaluate(() => window.__ourCastle.scene())).animating).toBe(false);
    expect((await fountain(page)).bursts).toBe(1);
    await page.reload(); await page.waitForFunction(() => window.__ourCastle?.scene()?.fountains?.sites.length === 1);
    expect(await fountain(page)).toMatchObject({ bursts: 0, flyingCoins: 0, settledCoins: 30 });
    await expect(page.locator('#deed-dialog')).toBeHidden();
    const state = await (await request.get('/api/state')).json();
    expect(state.progress.progressCents).toBe(7500);
    expect(state.ledger.goalEntries.map((e) => [e.kind, e.amountCents])).toEqual([
      ['starting_progress', 6000], ['simulated_contribution', 1500], ['simulated_refund', 1500], ['simulated_contribution', 1500],
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await chooseDistrict(page, 'manor');
    await page.screenshot({ path: info.outputPath('earned-fountain.png') });
  });

  test('all four major courtyards keep their ornaments through night, rain and a multi-area completion', async ({ page }, info) => {
    await ready(page);
    for (const [amount, deed] of [['15.00', 'Manor Gardens'], ['45.00', 'Market Town'], ['60.00', 'Stone Keep'], ['120.00', 'Royal Citadel']]) {
      await pay(page, amount); await closeDeed(page, deed);
    }
    expect(await fountain(page)).toMatchObject({ history: ['manor', 'market', 'keep', 'castle'], bursts: 4, settledCoins: 120, flyingCoins: 0 });
    expect((await fountain(page)).sites.map((s) => s.district)).toEqual(['manor', 'market', 'keep', 'castle']);
    await chooseDistrict(page, 'castle');
    await openMenu(page, 'world-settings'); await page.locator('#time-mode').selectOption('night'); await page.locator('#weather-mode').selectOption('rain'); await closeMenu(page, 'world-settings');
    await page.screenshot({ path: info.outputPath('citadel-fountain-night-rain.png') });
    expect(await fountain(page)).toMatchObject({ bursts: 4, settledCoins: 120, flyingCoins: 0 });
    expect(await page.evaluate(() => window.__ourCastle.scene().districts.filter((d) => d.open).map((d) => d.id))).toEqual(['cottage', 'manor', 'market', 'keep', 'wizard', 'castle', 'palace', 'rapunzel']);
  });
});

test('normal motion spills real 3D coins before the single deed, then releases the live batch', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Normal-animation trajectory check once; touch layout and reduced motion covered separately.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ready(page);
  await page.evaluate(() => {
    window.__fountainSamples = []; window.__fountainEvents = []; window.__fountainFrame = null;
    window.__ourCastle.bus.on('scene:fountain:start', (e) => window.__fountainEvents.push(['start', e.district]));
    window.__ourCastle.bus.on('scene:fountain:end', (e) => window.__fountainEvents.push(['end', e.district]));
    window.__fountainTimer = setInterval(() => {
      const f = window.__ourCastle.scene().fountains;
      if (!f.active || !f.sample) return;
      window.__fountainSamples.push({ ...f.sample, phase: f.phase, flying: f.flyingCoins });
      if (!window.__fountainFrame && f.phase > .15 && f.phase < .8) window.__fountainFrame = document.querySelector('#world canvas').toDataURL('image/png');
    }, 60);
  });
  const writes = []; page.on('request', (r) => { if (r.method() !== 'GET') writes.push(new URL(r.url()).pathname); });
  await pay(page, '15.00');
  await expect(page.locator('#deed-dialog')).toBeVisible({ timeout: 45000 });
  const captured = await page.evaluate(() => { clearInterval(window.__fountainTimer); return { samples: window.__fountainSamples, events: window.__fountainEvents, frame: window.__fountainFrame }; });
  expect(captured.events).toEqual([['start', 'manor'], ['end', 'manor']]);
  expect(new Set(captured.samples.map((s) => s.y)).size).toBeGreaterThan(1);
  expect(captured.samples.every((s) => s.flying === 48)).toBe(true);
  expect(await fountain(page)).toMatchObject({ active: null, flyingCoins: 0, settledCoins: 30, bursts: 1 });
  expect(writes).toEqual(['/api/example/contributions']);
  expect(captured.frame).toMatch(/^data:image\/png;base64,/);
  writeFileSync(info.outputPath('gold-spill-canvas.png'), Buffer.from(captured.frame.split(',')[1], 'base64'));
  writeFileSync(info.outputPath('trajectory.json'), JSON.stringify({ ...captured, frame: undefined }, null, 2));
});
