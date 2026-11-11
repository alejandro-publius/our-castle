import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import { test, expect } from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// Realm atmosphere: cosmetic time of day and weather. Example mode; Open-Meteo is mocked here, never called for real.
// Atmosphere changes must make no server write and no request to the weather service until a town is searched.

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const sky = (page) => page.evaluate(() => window.__ourCastle.scene().atmosphere);
const status = (page) => page.locator('#atmosphere-status');
function track(page) {
  const writes = [], weather = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname.endsWith('open-meteo.com')) weather.push(`${url.hostname}${url.pathname}`);
    else if (r.method() !== 'GET') writes.push(`${r.method()} ${url.pathname}`);
  });
  return { writes, weather };
}
const LISBON = { id: 2267057, name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal', latitude: 38.71667, longitude: -9.13333, timezone: 'Europe/Lisbon' };
async function mockOpenMeteo(page, { code = 61, hold = null, fail = false } = {}) {
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({ json: { results: [LISBON, { ...LISBON, id: 1, name: 'Lisbon', admin1: 'Maine', country: 'United States', latitude: 44.03, longitude: -70.1, timezone: 'America/New_York' }] } }));
  await page.route('https://api.open-meteo.com/**', async (route) => {
    if (hold) await hold;
    if (fail) return route.abort('internetdisconnected');
    return route.fulfill({ json: { current: { time: Math.floor(Date.now() / 1000), weather_code: code, is_day: 1, cloud_cover: 92, temperature_2m: 14.2 } } });
  });
}
async function chooseLisbon(page) {
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'local');
  await expect(page.locator('#weather-place-query')).toBeFocused();
  await page.locator('#weather-place-query').fill('Lisbon');
  await page.locator('#weather-search').click();
  await page.getByRole('button', { name: 'Lisbon, Portugal' }).click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

test('Snow shows the winter scene and the sleigh, Clear puts them away, and neither writes anything', async ({ page }) => {
  await closeDeedsWhenTheyAppear(page);
  const seen = track(page);
  await ready(page);
  // A browser with no saved choice starts in Snow.
  await expect(page.locator('#weather-mode')).toHaveValue('snow');
  await expect.poll(async () => (await sky(page)).snow.visible).toBe(true);
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'snow');
  await expect(status(page)).toContainText('Snow (chosen by you)');
  const a = await sky(page);
  expect(a).toMatchObject({ weather: 'snow', snow: { visible: true, reindeer: 5 }, rain: { visible: false } });
  await expect.poll(async () => (await sky(page)).snow.x).not.toBe(a.snow.x); // the sleigh is flying
  // The sleigh team carries its own light, so moonlight does not turn it near-black.
  await page.selectOption('#time-mode', 'day'); const byDay = (await sky(page)).snow.glow;
  await page.selectOption('#time-mode', 'night');
  expect((await sky(page)).snow.glow).toBeGreaterThan(byDay);
  await page.selectOption('#weather-mode', 'clear');
  expect(await sky(page)).toMatchObject({ weather: 'clear', snow: { visible: false } });
  expect([...seen.writes, ...seen.weather]).toEqual([]);
});

test('Night and Rain light the world, survive refresh, district inspection and a payment, and never write or unlock anything', async ({ page }) => {
  await closeDeedsWhenTheyAppear(page);
  const seen = track(page);
  await ready(page);
  await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'night');
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'rain');
  await expect(status(page)).toHaveText('Night (chosen by you) · Rain (chosen by you)');
  let a = await sky(page);
  // 30 light spots of five rings each: 9 district doors (the only ones with point lights), 18 bridge gates,
  // the 2 royal stables and the tavern patio. Built from the realm layout, so the same in every household.
  expect(a).toMatchObject({ period: 'night', weather: 'rain', pointLights: 9, pointLightCapacity: 9, pools: 150, rain: { visible: true } });
  expect(a.glassGlow).toBeGreaterThan(0);
  expect(a.panes).toBeGreaterThan(40);
  expect(a.lamps).toBeGreaterThan(30);
  await expect(page.locator('#weather-place')).toBeHidden();
  expect(seen.writes).toEqual([]);

  // A refresh restores the choice from browser storage.
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(page.locator('#time-mode')).toHaveValue('night');
  await expect(page.locator('#weather-mode')).toHaveValue('rain');
  expect(await sky(page)).toMatchObject({ period: 'night', weather: 'rain' });

  // Inspecting a locked area and returning to the whole realm keep the atmosphere and actual access.
  await chooseDistrict(page, 'castle');
  expect(await sky(page)).toMatchObject({ period: 'night', weather: 'rain', pointLights: 9 });
  await expect(page.locator('#view-deed')).toBeHidden();
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__ourCastle.scene())).tier).toBe(0);
  const scene = await page.evaluate(() => window.__ourCastle.scene());
  expect(scene.previewFeature).toBe(null);
  expect(scene.atmosphere).toMatchObject({ period: 'night', weather: 'rain' });
  const festival = await page.evaluate(() => window.__ourCastle.state.rewards.entries.find((r) => r.id === 'bill:electricity').status);
  expect(festival).toBe('connection_required');

  // A simulated contribution re-renders the board; the atmosphere stays.
  await page.getByRole('tab', { name: /House/ }).click();
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await page.getByRole('tab', { name: /Contribute/ }).click();
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment' }).click();
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await expect.poll(async () => (await page.evaluate(() => window.__ourCastle.scene())).animating, { timeout: 25_000 }).toBe(false);
  expect(await sky(page)).toMatchObject({ period: 'night', weather: 'rain', pointLights: 9 });
  await expect(page.locator('#time-mode')).toHaveValue('night');
  // Only the house setup and the explicit simulated payment wrote; no weather request was ever made.
  expect(seen.writes).toEqual(['POST /api/setup', 'POST /api/example/contributions']);
  expect(seen.weather).toEqual([]);

  // Back to Day: lights and rain go away.
  await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day');
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'clear');
  a = await sky(page);
  expect(a).toMatchObject({ period: 'day', weather: 'clear', pointLights: 0, pools: 0, glassGlow: 0, rain: { visible: false } });
});

test.describe('Auto in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('follows the device clock and time zone, and updates when the page becomes visible again', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T02:59:00Z')); // 18:59 in Los Angeles
    await ready(page);
    await expect(page.locator('#time-mode')).toHaveValue('auto');
    await expect(status(page)).toHaveText('Afternoon (device clock 18:59, America/Los_Angeles) · Snow (chosen by you)');
    expect((await sky(page)).period).toBe('afternoon');
    await page.clock.setFixedTime(new Date('2026-11-05T03:00:00Z')); // 19:00
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(status(page)).toHaveText('Night (device clock 19:00, America/Los_Angeles) · Snow (chosen by you)');
    expect((await sky(page)).period).toBe('night');
  });
});

test('local weather is opt-in: nothing is requested until a town is searched and chosen; it is remembered and can be disconnected', async ({ page }) => {
  const seen = track(page);
  await mockOpenMeteo(page, { code: 61 });
  await ready(page);
  await page.waitForTimeout(500);
  expect(seen.weather).toEqual([]);
  await chooseLisbon(page);
  await expect(status(page)).toContainText('Rain (Lisbon, Portugal, Open-Meteo report for ');
  expect(await sky(page)).toMatchObject({ weather: 'rain', rain: { visible: true } });
  expect(seen.weather).toEqual(['geocoding-api.open-meteo.com/v1/search', 'api.open-meteo.com/v1/forecast']);
  await expect(page.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'town names from GeoNames' })).toBeVisible();
  await expect(page.locator('#weather-place-name')).toHaveText('Local weather: Lisbon, Portugal');
  await expect(page.locator('#weather-change')).toBeFocused();

  // Remembered after a refresh: the chosen town's weather is loaded again, with no new search.
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(status(page)).toContainText('Rain (Lisbon, Portugal, Open-Meteo report for ');
  expect(seen.weather.slice(2)).toEqual(['api.open-meteo.com/v1/forecast']);

  // Disconnect forgets the town, returns to Clear and stops all weather requests.
  await openMenu(page, 'world-settings');
  await page.locator('#weather-disconnect').click();
  await expect(page.locator('#weather-mode')).toHaveValue('clear');
  await expect(page.locator('#weather-mode')).toBeFocused();
  await expect(page.locator('#weather-place')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('our-castle:atmosphere:place'))).toBe(null);
  const count = seen.weather.length;
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.waitForTimeout(500);
  expect(seen.weather.length).toBe(count);
  expect(seen.writes).toEqual([]);
});

test('a slow answer never overrides a newer choice, and an unreachable service is labelled, not shown as rain', async ({ page }) => {
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  await mockOpenMeteo(page, { code: 61, hold });
  await ready(page);
  await chooseLisbon(page);
  await expect(status(page)).toContainText('Lisbon, Portugal: loading local weather');
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'clear'); // a newer choice while the forecast is still on its way
  release();
  await page.waitForTimeout(600);
  await expect(status(page)).toHaveText(/· Clear \(chosen by you\)$/);
  expect((await sky(page)).weather).toBe('clear');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockOpenMeteo(page, { fail: true });
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'local');
  await expect(status(page)).toContainText('Lisbon, Portugal: local weather unavailable (The weather service could not be reached.');
  expect((await sky(page)).weather).toBe('clear');
});

test('after a failed load, scheduled refreshes wait 15 minutes; an explicit choice can retry sooner', async ({ page }) => {
  const seen = track(page);
  await page.clock.setFixedTime(new Date());
  await mockOpenMeteo(page, { fail: true });
  await ready(page);
  await chooseLisbon(page);
  await expect(status(page)).toContainText('local weather unavailable');
  const forecasts = () => seen.weather.filter((r) => r.endsWith('/v1/forecast')).length;
  expect(forecasts()).toBe(1);
  // The minute tick and the page becoming visible both run the scheduled load: nothing within 15 minutes.
  const visible = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  for (const minutes of [1, 5, 14]) {
    await page.clock.setFixedTime(new Date(Date.now() + minutes * 60_000));
    await visible();
  }
  await page.waitForTimeout(300);
  expect(forecasts()).toBe(1);
  await page.clock.setFixedTime(new Date(Date.now() + 16 * 60_000));
  await visible();
  await expect.poll(forecasts).toBe(2);
  // Choosing Local weather again is an explicit request and may retry at once.
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'clear');
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'local');
  await expect.poll(forecasts).toBe(3);
  expect(seen.writes).toEqual([]);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('rain stays still, with no animation timer', async ({ page }) => {
    await ready(page);
    await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'rain');
    const a = await sky(page);
    expect(a.rain).toMatchObject({ visible: true, animated: false });
    expect((await page.evaluate(() => window.__ourCastle.scene())).ambient).toBe(false);
  });
});

test('a hidden page stops the ambient rain frames, and they resume when it is visible', async ({ page }) => {
  await ready(page);
  await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'rain');
  const frames = () => page.evaluate(() => window.__ourCastle.scene().ambientFrames);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenStart = await frames();
  await page.waitForTimeout(1200);
  expect(await frames()).toBe(hiddenStart);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(frames).toBeGreaterThan(hiddenStart);
});

test.describe('at 320 by 568', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test('the controls are keyboard-usable 44 px targets with no overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'checked on the phone project');
    await ready(page);
    await openMenu(page, 'world-settings');
    for (const id of ['#time-mode', '#weather-mode']) expect((await page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.locator('#time-mode').focus();
    await page.keyboard.press('ArrowDown'); // Auto → Day
    await expect(page.locator('#time-mode')).toHaveValue('day');
    await expect(status(page)).toHaveText(/^Day \(chosen by you\)/);
    await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode', 'local');
    await expect(page.locator('#weather-place-query')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
