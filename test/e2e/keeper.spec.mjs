import { test, expect } from '@playwright/test';
import { chooseDistrict } from './support/game-controls.mjs';

// Moss, the castle keeper (src/app/keeper.js): an optional authored tour of the example demo. The keeper may only show
// journal tabs and point at the compass and Sound. These checks drive the real page in example mode, with disposable
// data and every outside request refused, and prove the tour writes nothing, calls no provider and leaves drafts, an
// amount approval and focus where the family left them.
const ready = async (page, path = '/') => {
  await page.goto(path);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const keeper = (page) => page.locator('.keeper');
const step = (page) => page.locator('#keeper-step');
const money = (page) => page.evaluate(() => ({ progress: window.__ourCastle.state.progress.progressCents, records: window.__ourCastle.state.contributions.length }));

// Every request from here on: writes to this server, and anything addressed elsewhere (refused by the route below).
function watch(page, baseURL) {
  const seen = { writes: [], outside: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) seen.outside.push(url.origin);
    else if (!['GET', 'HEAD'].includes(request.method())) seen.writes.push(`${request.method()} ${url.pathname}`);
  });
  return seen;
}

async function foundHouse(page) {
  await page.locator('#tab-house').click();
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
  await page.locator('#tab-house').click(); // founding moves the journal on to Plan; come back as a family would
}

test.beforeEach(async ({ page, request, baseURL }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort()));
});

test('the keeper walks the whole demo from the House journal and writes nothing', { tag: '@release' }, async ({ page, baseURL }) => {
  // Eight steps across the whole journal. On hosted desktop runs this took 45 to 78 seconds when it passed and once ran
  // out of the usual 90, so it gets twice that. Each step still has its own 15-second wait.
  test.setTimeout(180_000);
  await ready(page);
  await foundHouse(page);
  // Unsaved work the tour must leave alone: a house-name draft and a contribution an adult has already approved.
  await page.locator('#house-name').fill('House of Larkspur');
  await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill('12.34');
  await page.locator('#give-approve').check();
  await expect(page.locator('#simulate-pay')).toBeEnabled();
  const before = await money(page);
  const seen = watch(page, baseURL);

  await page.locator('#tab-house').click();
  await page.getByRole('button', { name: 'Meet the Keeper' }).click();
  await expect(page.getByRole('dialog', { name: 'Moss castle keeper' })).toBeVisible();
  await expect(page.locator('#keeper-text')).toContainText('Welcome, traveler');
  await expect(page.locator('#keeper-next')).toBeFocused();

  // Enter on the focused Next, with an approved payment one tab away: the tour moves on and nothing is submitted.
  const expected = [
    { n: 2, tab: 'house', cue: '#tab-house' }, { n: 3, tab: 'plan', cue: '#tab-plan' },
    { n: 4, tab: 'give', cue: '#tab-give' }, { n: 5, tab: 'ledger', cue: '#tab-ledger' },
    { n: 6, cue: '#map-explore' }, { n: 7, cue: '#sound-toggle' }, { n: 8 },
  ];
  for (const want of expected) {
    await page.keyboard.press('Enter');
    await expect(step(page)).toHaveText(`${want.n} of 8`);
    await expect(page.locator('#keeper-next')).toBeFocused();
    if (want.tab) await expect(page.locator(`#tab-${want.tab}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.keeper-cue')).toHaveCount(want.cue ? 1 : 0);
    if (want.cue) await expect(page.locator(want.cue)).toHaveClass(/keeper-cue/);
    if (want.tab === 'give') {
      await expect(page.locator('#give-amount')).toHaveValue('12.34');
      await expect(page.locator('#give-approve')).toBeChecked();
    }
  }
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false'); // pointed at, never pressed
  await expect(page.locator('#keeper-next')).toHaveText('Done');
  await expect(page.locator('#keeper-skip')).toBeHidden();
  await page.keyboard.press('Enter');

  await expect(keeper(page)).toHaveCount(0);
  await expect(page.locator('#tab-house')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Meet the Keeper' })).toBeFocused();
  await expect(page.locator('#house-name')).toHaveValue('House of Larkspur');
  await page.locator('#tab-give').click();
  await expect(page.locator('#give-amount')).toHaveValue('12.34');
  await expect(page.locator('#give-approve')).toBeChecked();
  expect(await money(page)).toEqual(before);
  expect(seen.writes).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('keys: Back and Skip, Escape from inside the keeper, focus returned, and no motion when it is reduced', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const seen = watch(page, baseURL);
  await page.locator('#tab-house').click();
  await page.locator('#keeper-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#keeper-next')).toBeFocused();
  expect(await keeper(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Enter');
  await expect(step(page)).toHaveText('2 of 8');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#keeper-back')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(step(page)).toHaveText('1 of 8');
  // Back is gone on the first step, so it handed focus to Next rather than dropping it.
  await expect(page.locator('#keeper-back')).toBeHidden();
  await expect(page.locator('#keeper-next')).toBeFocused();
  await expect(page.locator('#keeper-text')).not.toHaveClass(/keeper-turn/);
  await page.keyboard.press('Escape');
  await expect(keeper(page)).toHaveCount(0);
  await expect(page.locator('#keeper-open')).toBeFocused();
  // Skip from the middle of the tour returns to where it started.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#keeper-skip').click();
  await expect(keeper(page)).toHaveCount(0);
  await expect(page.locator('#tab-house')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#keeper-open')).toBeFocused();
  expect(seen.writes).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('?tour=1 opens the keeper on a fresh demo; Skip closes it and House replays it', { tag: '@release' }, async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await ready(page, '/?tour=1');
  await expect(keeper(page)).toBeVisible();
  await expect(step(page)).toHaveText('1 of 8');
  await expect(page.locator('#keeper-next')).toBeFocused();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(keeper(page)).toHaveCount(0);
  await expect(page.locator('#keeper-open')).toBeFocused();
  await page.locator('#keeper-open').click();
  await expect(step(page)).toHaveText('1 of 8');
  await expect(page.locator('#keeper-text')).toContainText('Welcome, traveler');
  expect(seen.writes).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('an open deed card puts the keeper aside and it returns without taking focus', async ({ page, baseURL }) => {
  await ready(page);
  const seen = watch(page, baseURL);
  await page.locator('#tab-house').click();
  await page.locator('#keeper-open').click();
  await page.locator('#keeper-next').click();
  await expect(step(page)).toHaveText('2 of 8');
  await chooseDistrict(page, 'cottage');
  await page.locator('#view-deed').click();
  await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  await expect(keeper(page)).toBeHidden();
  await page.locator('#deed-close').click();
  await expect(page.locator('#deed-dialog')).not.toHaveAttribute('open', '');
  await expect(keeper(page)).toBeVisible();
  await expect(step(page)).toHaveText('2 of 8');
  expect(await keeper(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
  expect(seen.writes).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('the keeper never covers the journal or its controls, and nothing scrolls sideways', { tag: '@release' }, async ({ page }, info) => {
  // With reduced motion the keeper's own scrolling is instant, so these measurements do not race a smooth scroll.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await foundHouse(page);
  await page.locator('#keeper-open').click();
  for (let i = 0; i < 3; i++) await page.locator('#keeper-next').click();
  await expect(page.locator('#tab-give')).toHaveAttribute('aria-selected', 'true');
  const box = async (selector) => page.locator(selector).evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (info.project.name === 'phone') {
    // Docked to the bottom of the screen, with its measured height reserved below the page.
    const guide = await box('.keeper');
    expect(Math.round(guide.bottom)).toBeLessThanOrEqual(844);
    expect(Math.round(guide.bottom)).toBeGreaterThan(800);
    // The browser's own scrolling (which honors the reserved space) brings each control fully above the keeper.
    for (const selector of ['#give-amount', '#give-approve-row', '#simulate-pay']) {
      await page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'end' }));
      expect((await box(selector)).bottom).toBeLessThanOrEqual((await box('.keeper')).top);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect((await box('.footer')).bottom).toBeLessThanOrEqual((await box('.keeper')).top);
  } else {
    // Over the map only: clear of the journal, and above whatever the map's own footer is showing.
    const guide = await box('.keeper');
    expect(guide.right).toBeLessThanOrEqual((await box('#journey')).left);
    const footTop = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('.board-foot > *')].filter((el) => el.getClientRects().length && getComputedStyle(el).position !== 'absolute');
      return shown.length ? Math.min(...shown.map((el) => el.getBoundingClientRect().top)) : null;
    });
    if (footTop !== null) expect(guide.bottom).toBeLessThanOrEqual(footTop);
  }
  expect(await sideways()).toBeLessThanOrEqual(0);
});
