import { test, expect } from '@playwright/test';

// District deeds: a card for an area the server newly opens. Example mode only; payments here are simulated by the
// server. Viewing, visiting and closing a deed must never write anything.

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const settled = (page) => expect.poll(async () => (await scene(page)).animating, { timeout: 25_000 }).toBe(false);
const dialog = (page) => page.locator('#deed-dialog');
const fullyVisible = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
function trackWrites(page) {
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return writes;
}
async function writesDuring(page, writes, action) {
  const before = writes.length;
  await action();
  await page.waitForTimeout(300);
  return writes.slice(before);
}
// Record whether the board was still animating at the moment a deed opened.
const watchDeedOpening = (page) => page.evaluate(() => {
  window.__deedOpenings = [];
  new MutationObserver(() => { const d = document.querySelector('#deed-dialog'); if (d.open) window.__deedOpenings.push({ animating: window.__ourCastle.scene().animating, name: document.querySelector('#deed-name').textContent }); })
    .observe(document.querySelector('#deed-dialog'), { attributes: true, attributeFilter: ['open'] });
});
async function foundHouse(page) {
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
}
async function pay(page, amount, button = 'Simulate approved payment') {
  await page.getByRole('tab', { name: /Contribute/ }).click();
  await page.locator('#give-amount').fill(amount);
  await page.locator('#give-approve').check();
  if (button !== 'Simulate approved payment' && !(await page.locator('#give-action details').evaluate((d) => d.open))) await page.locator('#give-action summary').click();
  await page.getByRole('button', { name: button }).click();
}
// No deed appears: wait for the board to settle and a little longer, then check.
async function expectNoDeed(page) {
  await settled(page);
  await page.waitForTimeout(600);
  await expect(dialog(page)).not.toHaveAttribute('open', '');
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

test('reaching the manor shows its deed after the board animation; Escape restores focus and a reload shows none', async ({ page }, testInfo) => {
  const writes = trackWrites(page);
  await ready(page);
  await watchDeedOpening(page);
  await foundHouse(page);
  await pay(page, '15.00');
  await expect(dialog(page)).toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.__deedOpenings)).toEqual([{ animating: false, name: 'Manor Gardens' }]);
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await expect(page.locator('#deed-name')).toBeFocused();
  await expect(page.locator('#deed-earned')).toHaveText('Unlocked · 25% milestone');
  const art = page.locator('#deed-art');
  expect(await art.evaluate((img) => [img.naturalWidth, img.naturalHeight, getComputedStyle(img).imageRendering, img.getAttribute('src')])).toEqual([320, 176, 'pixelated', 'assets/area-cards/manor.png']);
  await expect(art).toHaveAttribute('alt', 'Pixel portrait of Manor Gardens');
  await expect(page.locator('#deed-seal svg')).toBeVisible();
  await expect(page.locator('#deed')).not.toContainText(/Evidence:|guests|Deed details|Realm keepsake/);
  await page.locator('#deed').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await page.locator('#deed-dialog').screenshot({ path: testInfo.outputPath('short-deed.png') });
  // Tabbing and closing the compact card write nothing.
  expect(await writesDuring(page, writes, async () => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
  })).toEqual([]);
  await expect(dialog(page)).not.toHaveAttribute('open', '');
  await expect(page.locator('#receipt')).toBeFocused(); // where focus was when the deed opened
  expect(writes).toEqual(['POST /api/setup', 'POST /api/example/contributions']);

  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expectNoDeed(page);
});

test('pending payments, refunds and re-crossing never create a deed; earned map districts reopen them', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await pay(page, '15.00', 'Simulate pending');
  await expect(page.locator('#give-status')).toContainText('Pending');
  await expectNoDeed(page);
  // The server completing it is the unlock.
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Simulate PayPal completing it' }).click();
  await expect(dialog(page)).toHaveAttribute('open', '');
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // A refund leaves the Manor as a keepsake and announces nothing.
  await page.getByRole('button', { name: 'Simulate refund' }).click();
  await page.getByRole('button', { name: /Confirm refund of \$15\.00/ }).click();
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await expectNoDeed(page);
  // Re-crossing the milestone announces nothing either.
  await pay(page, '15.00');
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await expectNoDeed(page);
  // Locked districts keep their condition on the map and cannot open an earned deed.
  await page.locator('#realm-districts [data-district="castle"]').click();
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · Locked · 100%');
  await expect(page.locator('#view-deed')).toBeHidden();
  await expectNoDeed(page);
  await page.locator('#realm-districts [data-district="garden"]').click();
  await expect(page.locator('#realm-focus-status')).toContainText('Record an on-time bill habit');
  await expect(page.locator('#view-deed')).toBeHidden();
  // Earned deeds reopen directly from their district, with keyboard focus returned on Escape.
  await page.locator('#realm-districts [data-district="manor"]').click();
  const view = page.locator('#view-deed');
  await expect(view).toBeVisible();
  await view.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#deed-earned')).toHaveText('Unlocked · 25% milestone');
  await page.keyboard.press('Escape');
  await expect(view).toBeFocused();
});

test('several new areas queue one at a time, and Visit focuses the right district', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await foundHouse(page);
  await pay(page, '135.00'); // $60 → $195: the Manor, the Market and the Keep
  await expect(dialog(page)).toHaveAttribute('open', '');
  await expect(page.locator('#deed-count')).toHaveText('1 / 3');
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  const before = writes.length;
  await page.getByRole('button', { name: 'Next deed (2 of 3)' }).click();
  await expect(page.locator('#deed-name')).toHaveText('Market Town');
  await expect(page.locator('#deed-earned')).toHaveText('Unlocked · 40% milestone');
  await page.getByRole('button', { name: 'Next deed (3 of 3)' }).click();
  await expect(page.locator('#deed-name')).toHaveText('Stone Keep');
  await expect(page.locator('#deed-next')).toBeHidden();
  await expect(page.locator('#deed-close')).toHaveText('Close');
  await page.locator('#deed-visit').focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).not.toHaveAttribute('open', '');
  const keep = page.locator('#realm-districts [data-district="keep"]');
  await expect(keep).toBeFocused();
  await expect(keep).toHaveAttribute('aria-pressed', 'true');
  expect((await scene(page)).view.focus).toBe('keep');
  expect(await fullyVisible(keep)).toBe(true);
  expect(writes.slice(before)).toEqual([]);
});

test('a deed opened from the map visits the earned district with no write', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await foundHouse(page);
  await pay(page, '15.00');
  await expect(dialog(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await page.locator('#realm-districts [data-district="manor"]').click();
  await page.locator('#view-deed').click();
  const before = writes.length;
  await page.getByRole('button', { name: 'Visit Manor Gardens' }).click();
  await expect.poll(async () => (await scene(page)).tier).toBe(1);
  await expect(page.locator('#realm-districts [data-district="manor"]')).toBeFocused();
  expect((await scene(page)).view.focus).toBe('manor');
  expect(writes.slice(before)).toEqual([]);
});

test('a new area that arrives while a map deed is open replaces it in place without losing the queue', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await pay(page, '15.00', 'Simulate pending');
  await expect(page.locator('#give-status')).toContainText('Pending');
  await page.locator('#realm-districts [data-district="cottage"]').click();
  await page.locator('#view-deed').click();
  await expect(page.locator('#deed-name')).toHaveText('Hearth Village');
  // The server's completion arrives while the deed is open (as a PayPal result can); the Ledger button is behind the
  // modal, so it is pressed by script here.
  await page.evaluate(() => [...document.querySelectorAll('#ledger-contributions button')].find((b) => b.textContent === 'Simulate PayPal completing it').click());
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await page.waitForTimeout(500); // any stale close event has run by now
  await expect(dialog(page)).toHaveAttribute('open', '');
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await page.getByRole('button', { name: 'Visit Manor Gardens' }).click();
  await expect(page.locator('#realm-districts [data-district="manor"]')).toBeFocused();
});

for (const [label, viewport, project] of [['390 by 844', { width: 390, height: 844 }, 'phone'], ['320 by 568', { width: 320, height: 568 }, 'phone']]) {
  test.describe(`deed layout at ${label}`, () => {
    test.use({ viewport });
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `checked on the ${project} project`));
    test('the deed fits the width, its buttons are reachable 44 px targets, and nothing overflows', async ({ page }) => {
      await ready(page);
      await foundHouse(page);
      await pay(page, '15.00');
      await expect(dialog(page)).toHaveAttribute('open', '');
      // Measure the card at rest, after its short entrance animation (scale .94 → 1).
      await page.locator('#deed').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const box = await dialog(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const id of ['#deed-visit', '#deed-close']) expect((await page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
      if (viewport.height >= 844) {
        // The whole face, with Visit and Close, is on screen without scrolling.
        expect(await fullyVisible(page.locator('#deed-visit'))).toBe(true);
        expect(await fullyVisible(page.locator('#deed-close'))).toBe(true);
      }
      await page.locator('#deed-close').scrollIntoViewIfNeeded();
      expect(await fullyVisible(page.locator('#deed-close'))).toBe(true);
      await page.locator('#deed-close').click();
      await expect(dialog(page)).not.toHaveAttribute('open', '');
    });
  });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the deed appears without animation', async ({ page }) => {
    await ready(page);
    await foundHouse(page);
    await pay(page, '15.00');
    await expect(dialog(page)).toHaveAttribute('open', '');
    expect(await page.locator('#deed').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});


test('four journey tabs recover an old Rewards selection and a completed goal visits the castle', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await page.evaluate(() => sessionStorage.setItem('our-castle:tab', 'rewards'));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-rewards')).toHaveCount(0);
  await expect(page.locator('#reward-list')).toHaveCount(0);
  await pay(page, '240.00');
  await expect(page.locator('#progress-amount')).toHaveText('$300.00');
  // This jump walks all remaining spaces; wait for that animation before checking the queued cards.
  await settled(page);
  await expect(dialog(page)).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Close all' }).click();
  await expect(page.locator('#next-step-go')).toHaveText('Visit your castle');
  await page.locator('#next-step-go').focus();
  await page.keyboard.press('Enter');
  const castle = page.locator('#realm-districts [data-district="castle"]');
  await expect(castle).toBeFocused();
  await expect(castle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · Open district');
});
