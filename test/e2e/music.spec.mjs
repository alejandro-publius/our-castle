import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import { test, expect } from '@playwright/test';

// Real local media, with the browser output muted by the test runner. No streaming/provider calls.
test.use({ reducedMotion: 'reduce' });
const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await openMenu(page, 'world-settings');
  await page.selectOption('#time-mode', 'day');
  await closeMenu(page, 'world-settings');
};
const audioState = (page) => page.evaluate(() => {
  const audio = window.__musicElements.at(-1);
  return audio && { paused: audio.paused, muted: audio.muted, loop: audio.loop, volume: audio.volume,
    currentTime: audio.currentTime, duration: audio.duration, readyState: audio.readyState, src: audio.src };
});

test.beforeEach(async ({ page, request, baseURL }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL).origin ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__musicElements = [];
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.__musicElements.push(audio);
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
  });
});

test('header music is opt-in, rotates local recordings, stops, and opens silent again after reload', { tag: '@release' }, async ({ page }, info) => {
  const audioRequests = [], errors = [];
  page.on('request', (request) => { if (request.url().includes('/assets/music/')) audioRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const toggle = page.locator('#sound-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(audioRequests).toEqual([]);
  expect(await page.evaluate(() => window.__musicElements.length)).toBe(0);
  const layout = await toggle.evaluate((button) => {
    const box = button.getBoundingClientRect(), brand = document.querySelector('.brand').getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, width: box.width, height: box.height, brandRight: brand.right, brandBottom: brand.bottom,
      viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  // The brass sound control stays to the right of the brand, including the phone's first row.
  expect(layout.x).toBeGreaterThanOrEqual(layout.brandRight);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.width).toBeGreaterThanOrEqual(44);
  expect(layout.height).toBeGreaterThanOrEqual(44);
  expect(layout.y).toBeLessThan(120);
  const progress = await page.locator('#progress-amount').textContent();
  const response = page.waitForResponse((res) => res.url().includes('/assets/music/hydrogene/peaceful-village.mp3'));
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await response).headers()['content-type']).toBe('audio/mpeg');
  await expect.poll(async () => (await audioState(page))?.currentTime).toBeGreaterThan(1);
  expect(await audioState(page)).toMatchObject({ paused: false, muted: false, loop: false, volume: 0.16 });
  expect(new URL((await audioState(page)).src).pathname).toBe('/assets/music/hydrogene/peaceful-village.mp3');
  // Accelerate real decoding to its native ending; no synthetic event or unsupported range seek.
  await page.evaluate(() => { const audio = window.__musicElements.at(-1); audio.addEventListener('ended', () => { audio.playbackRate = 1; }, { once: true }); audio.playbackRate = 16; });
  await expect.poll(async () => (await audioState(page)).src).toContain('/bitbybit/farm-life.ogg');
  await expect.poll(async () => (await audioState(page)).currentTime).toBeGreaterThan(.1);
  expect(await page.evaluate(() => window.__musicElements.length)).toBe(1);
  await page.screenshot({ path: info.outputPath('music-on.png'), fullPage: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  await expect(page.locator('#progress-amount')).toHaveText(progress);
  const requestsBeforeReload = audioRequests.length;
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__musicElements.length)).toBe(0);
  expect(audioRequests.length).toBe(requestsBeforeReload);
  expect(errors).toEqual([]);
});

test('a blocked play reports sound off, can retry, and pauses while hidden', async ({ page }) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    let block = true;
    HTMLMediaElement.prototype.play = function () {
      if (block) { block = false; return Promise.reject(new DOMException('Test browser refused playback', 'NotAllowedError')); }
      return nativePlay.call(this);
    };
  });
  await ready(page);
  const toggle = page.locator('#sound-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sound-status')).toContainText('could not start');
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await audioState(page)).currentTime).toBeGreaterThan(0.1);
  await page.evaluate(() => {
    window.__testHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true'); // opt-in is retained while paused
  await page.evaluate(() => { window.__testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await toggle.click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('turning sound off wins over a late native play completion', async ({ page }) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return new Promise((resolve, reject) => {
        window.__finishMusicPlay = () => nativePlay.call(this).then(resolve, reject);
      });
    };
  });
  await ready(page);
  const toggle = page.locator('#sound-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await page.evaluate(async () => { await window.__finishMusicPlay(); await Promise.resolve(); });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  expect(await page.evaluate(() => window.__ourCastle.sound().enabled)).toBe(false);
});

test('a failed music download can retry from the same Sound button', async ({ page }, info) => {
  let fail = true;
  await page.route('**/assets/music/**/*.mp3', (route) => fail ? route.abort('failed') : route.continue());
  await ready(page);
  await page.locator('.topbar').screenshot({ path: info.outputPath('music-header-off.png') });
  const toggle = page.locator('#sound-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sound-status')).toContainText('could not start');
  fail = false;
  await toggle.click();
  await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 5000 }).toBeGreaterThan(0.1);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
});


test('all six recordings play; map and night changes take effect only at a natural ending', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = [], writes = [], files = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'GET') writes.push(request.method() + ' ' + request.url());
    if (request.url().includes('/assets/music/')) files.add(new URL(request.url()).pathname);
  });
  await ready(page);
  await page.locator('#sound-toggle').click();
  const playing = async path => {
    await expect.poll(async () => (await audioState(page))?.src).toContain(path);
    await expect.poll(async () => (await audioState(page)).currentTime).toBeGreaterThan(1);
    expect(await audioState(page)).toMatchObject({ paused: false, muted: false, loop: false, volume: .16 });
    // Ogg duration estimates can change while buffering; require a usable duration, not an arbitrary song length.
    const duration = (await audioState(page)).duration;
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
  };
  const finish = async () => {
    await page.evaluate(() => { const audio = window.__musicElements[0]; audio.addEventListener('ended', () => { audio.playbackRate = 1; }, { once: true }); audio.playbackRate = 16; });
  };
  await playing('peaceful-village.mp3');
  await finish(); await playing('farm-life.ogg');
  const before = await audioState(page);
  await chooseDistrict(page, 'garden');
  await clickView(page, 'Zoom in');
  const after = await audioState(page);
  expect(after.src).toBe(before.src);
  expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime);
  await finish(); await playing('wood-forest-town.mp3');
  await finish(); await playing('spirits-forest.mp3');
  await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'night'); await closeMenu(page, 'world-settings');
  expect((await audioState(page)).src).toContain('spirits-forest.mp3');
  await finish(); await playing('ancient-library.mp3');
  await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day'); await closeMenu(page, 'world-settings');
  await chooseDistrict(page, 'market');
  expect((await audioState(page)).src).toContain('ancient-library.mp3');
  await finish(); await playing('welcome-to-the-item-shop.mp3');
  expect(files.size).toBe(6);
  expect(await page.evaluate(() => window.__musicElements.length)).toBe(1);
  await page.locator('#sound-toggle').click();
  expect(await audioState(page)).toMatchObject({ paused: true, muted: true });
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await expect(page.getByRole('link', { name: 'Music composed by Bert Cole' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
