import { test, expect } from '@playwright/test';

// Real local media, with the browser output muted by the test runner. No streaming/provider calls.
test.use({ reducedMotion: 'reduce' });
const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
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

test('header music is opt-in, loops locally, stops, and opens silent again after reload', { tag: '@release' }, async ({ page }, info) => {
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
    return { x: box.x, y: box.y, right: box.right, width: box.width, height: box.height, brandRight: brand.right,
      viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.x).toBeGreaterThanOrEqual(layout.brandRight);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.width).toBeGreaterThanOrEqual(44);
  expect(layout.height).toBeGreaterThanOrEqual(44);
  expect(layout.y).toBeLessThan(120);
  const progress = await page.locator('#progress-amount').textContent();
  const response = page.waitForResponse((res) => res.url().includes('/assets/music/welcome-to-the-item-shop.mp3'));
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await response).headers()['content-type']).toBe('audio/mpeg');
  await expect.poll(async () => (await audioState(page))?.currentTime).toBeGreaterThan(0.15);
  expect(await audioState(page)).toMatchObject({ paused: false, muted: false, loop: true, volume: 0.16 });
  expect(new URL((await audioState(page)).src).pathname).toBe('/assets/music/welcome-to-the-item-shop.mp3');
  // Exercise a real native loop boundary, not only the loop flag.
  await page.evaluate(() => { const audio = window.__musicElements.at(-1); audio.currentTime = audio.duration - 0.2; });
  await expect.poll(async () => (await audioState(page)).currentTime).toBeLessThan(2);
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
  await page.route('**/assets/music/*.mp3', (route) => fail ? route.abort('failed') : route.continue());
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
