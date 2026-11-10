import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { familyServer } from './support/family.mjs';

async function visitor(browser, info, origin, { reducedMotion = 'no-preference' } = {}) {
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion });
  const outside = [], writes = [], audio = [], errors = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { outside.push(url.origin); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + url.pathname);
    if (/\.(mp3|ogg|wav)$/.test(url.pathname)) audio.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, outside, writes, audio, errors };
}

function gateSession(page) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return page.route('**/api/session', async route => { await gate; await route.continue().catch(() => {}); }).then(() => release);
}

const canvasPixels = page => page.locator('#realm-loader canvas').evaluate(c => c.toDataURL());
function clean(v) {
  expect(v.outside).toEqual([]);
  expect(v.writes).toEqual([]);
  expect(v.audio).toEqual([]);
  expect(v.errors).toEqual([]);
}

test('the silent pixel chase yields to the actual ready realm without waiting for its ending', { tag: '@release' }, async ({ browser }, info) => {
  const demo = await startDemo(), v = await visitor(browser, info, demo.url);
  const { page } = v;
  const release = await gateSession(page);
  try {
    await page.goto(demo.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Opening the gates' })).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('inert', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const first = await canvasPixels(page);
    await expect.poll(() => canvasPixels(page)).not.toBe(first);
    await page.screenshot({ path: info.outputPath('loading.png') });
    // Release a real pending startup read; no animation-ending timer participates in readiness.
    release();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#realm-loader')).toHaveCount(0);
    expect(await page.locator('.shell').evaluate(el => el.inert)).toBe(false);
    await expect(page.locator('#sound-label')).toHaveText('Sound off');
    await page.locator('#journal-toggle').click();
    await expect(page.locator('#journal-toggle')).toBeFocused();
    clean(v);
  } finally { release(); await v.context.close(); await demo.close(); }
});

test('reduced motion stays still and a household read failure is not hidden by the decoration', { tag: '@release' }, async ({ browser }, info) => {
  const demo = await startDemo(), v = await visitor(browser, info, demo.url, { reducedMotion: 'reduce' });
  const { page } = v;
  const release = await gateSession(page);
  try {
    await page.route('**/api/state', route => route.fulfill({ status: 503, json: { error: { message: 'Example household unavailable' } } }));
    await page.goto(demo.url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#realm-loader')).toBeVisible();
    const first = await canvasPixels(page);
    await page.waitForTimeout(350); // More than four animation frames; the reduced-motion scene must not change.
    expect(await canvasPixels(page)).toBe(first);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => canvasPixels(page)).not.toBe(first);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => canvasPixels(page)).toBe(first);
    release();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#realm-loader')).toHaveCount(0);
    await expect(page.locator('#honesty')).toContainText('Could not load the household');
    expect(await page.locator('.shell').evaluate(el => el.inert)).toBe(false);
    clean(v);
  } finally { release(); await v.context.close(); await demo.close(); }
});

test('the loading cover cannot obstruct the real family sign-in dialog', { tag: '@release' }, async ({ browser }, info) => {
  const family = await familyServer(), v = await visitor(browser, info, family.origin);
  const release = await gateSession(v.page);
  try {
    await v.page.goto(family.origin, { waitUntil: 'domcontentloaded' });
    await expect(v.page.locator('#realm-loader')).toBeVisible();
    release();
    await expect(v.page.locator('#access-dialog')).toBeVisible();
    await expect(v.page.locator('#realm-loader')).toHaveCount(0);
    await v.page.getByRole('button', { name: 'Start a new family' }).click();
    await expect(v.page.getByLabel('Your name')).toBeVisible();
    clean(v);
  } finally { release(); await v.context.close(); await family.close(); }
});

test('a stalled app module loses its loading cover after the limit without claiming readiness', { tag: '@release' }, async ({ browser }, info) => {
  const demo = await startDemo(), v = await visitor(browser, info, demo.url, { reducedMotion: 'reduce' });
  const { page } = v;
  try {
    // An empty module models a missing boot; it cannot set ready or make application requests.
    await page.route('**/src/app/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.clock.install();
    await page.goto(demo.url, { waitUntil: 'domcontentloaded' });
    await page.clock.runFor(200);
    await expect(page.locator('#realm-loader')).toBeVisible();
    await page.clock.fastForward(12_000);
    await expect(page.locator('#realm-loader')).toHaveCount(0);
    expect(await page.locator('body').getAttribute('data-ready')).toBeNull();
    expect(await page.locator('.shell').evaluate(el => el.inert)).toBe(false);
    clean(v);
  } finally { await v.context.close(); await demo.close(); }
});

test('the preview shows the chase, shield, hop and escape without delaying the app', async ({ browser }, info) => {
  const demo = await startDemo(), v = await visitor(browser, info, demo.url, { reducedMotion: 'reduce' });
  const { page } = v;
  try {
    await page.goto(demo.url + '/src/ui/dragon-chase-preview.html');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    for (const [name, time] of [['chase', 1600], ['shield', 2800], ['hop', 3750], ['escape', 4700]]) {
      await page.evaluate(async time => {
        const { drawDragonChase } = await import('/src/ui/dragon-chase.js');
        drawDragonChase(document.querySelector('canvas').getContext('2d'), time);
      }, time);
      await page.screenshot({ path: info.outputPath(name + '.png') });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const first = await page.locator('canvas').evaluate(c => c.toDataURL());
    await expect.poll(() => page.locator('canvas').evaluate(c => c.toDataURL())).not.toBe(first);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    clean(v);
  } finally { await v.context.close(); await demo.close(); }
});
