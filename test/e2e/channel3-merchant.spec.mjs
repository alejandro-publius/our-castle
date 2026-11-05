import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { chooseDistrict } from './support/game-controls.mjs';

// The real app and browser flow, with a FAKE Channel3 transport (documented response shape, invented products) on its
// own port and an in-memory example database. This proves the UI/route behaviour, not a live Channel3 answer.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/channel3-merchant/evidence/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TENT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><path d="M6 52 32 12l26 40Z" fill="#527557"/><path d="M32 12v40" stroke="#2c3b2e" stroke-width="2"/><path d="M26 52l6-14 6 14Z" fill="#2c3b2e"/></svg>';

function respond(_url, init) {
  const { query, filters } = JSON.parse(init.body);
  if (query.startsWith('slow')) return sleep(1500).then(() => fakeSearchResponse([fakeProduct({ id: 'fakeLantern', title: 'Test fixture: Slow lantern' })]));
  if (query === 'nothing') return { products: [], next_page_token: null };
  if (query === 'broken') return new Response('{"detail":"Internal Server Error"}', { status: 500 });
  expect(filters?.price?.max_price ?? null).not.toBeUndefined();
  return fakeSearchResponse([
    fakeProduct(),
    fakeProduct({ id: 'fakeBag03', title: 'Test fixture: Sleeping bag', images: [], offers: [] }),
    fakeProduct({ id: 'fakeStove04', title: 'Test fixture: Two-burner camp stove', images: [], offers: [
      { url: 'https://buy.trychannel3.com/fake/stove', domain: 'example-stoves.com', price: { price: 260, currency: 'USD' }, availability: 'OutOfStock', condition: 'new' },
    ] }),
  ]);
}

async function startServer({ withKey = true } = {}) {
  const db = openDatabase(':memory:');
  const clock = createClock();
  const fake = createFakeChannel3(respond);
  const merchant = withKey ? createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: fake.fetch, clock }) : null;
  const app = createApp({ config: loadConfig({}, { root }), db, clock, merchant, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://localhost:${server.address().port}`, fake, db, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

let s;
const issues = new WeakMap();
const searches = new WeakMap();
test.afterEach(async ({ page }) => { expect(issues.get(page)).toEqual([]); await s?.close(); s = null; });

async function open(page, { withKey = true } = {}) {
  s = await startServer({ withKey });
  const list = [], posted = [];
  issues.set(page, list); searches.set(page, posted);
  page.on('pageerror', (e) => list.push(e.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin === s.base) {
      if (r.method() !== 'GET') {
        posted.push(`${r.method()} ${url.pathname}`);
        if (!['/api/merchant/search', '/api/merchant/goal'].includes(url.pathname)) list.push(`unexpected write ${url.pathname}`);
      }
      return route.continue();
    }
    // Product images come from Channel3's CDN in a real answer; here the test serves a drawn stand-in.
    if (url.hostname === 'cdn.trychannel3.com') return route.fulfill({ contentType: 'image/svg+xml', body: TENT_SVG });
    list.push(`${r.method()} ${r.url()}`);
    return route.abort();
  });
  await page.goto(`${s.base}/`);
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  await chooseDistrict(page, 'market');
  await expect(page.locator('#open-merchant')).toBeVisible();
}
const stateOf = async (page) => (await page.request.get(`${s.base}/api/state`)).json();

test('Market Town merchant: explicit search, at most three honest rows, a draft that saves only when confirmed', async ({ page }, info) => {
  await open(page);
  const before = await stateOf(page);
  expect(before.modes.merchant.mode).toBe('live');
  // Market Town is still locked: the merchant entry is there, and browsing does not change access.
  await expect(page.locator('#realm-focus-status')).toContainText('Market Town');
  const trigger = page.locator('#open-merchant');
  await trigger.click();
  const dialog = page.locator('#merchant-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#merchant-query')).toBeFocused();

  // Typing sends nothing; only Search does.
  await page.locator('#merchant-query').pressSequentially('four person tent', { delay: 20 });
  await page.locator('#merchant-budget').fill('200');
  await page.waitForTimeout(300);
  expect(searches.get(page)).toEqual([]);
  await page.locator('#merchant-budget').press('Enter');
  const rows = page.locator('#merchant-results > li');
  await expect(rows).toHaveCount(3);
  expect(searches.get(page)).toEqual(['POST /api/merchant/search']);
  expect(s.fake.calls).toHaveLength(1);
  expect(s.fake.calls[0].body).toEqual({ query: 'four person tent', limit: 3, config: { country: 'US', currency: 'USD', language: 'en' }, filters: { price: { max_price: 200 } } });

  const [tent, bag, stove] = [rows.nth(0), rows.nth(1), rows.nth(2)];
  await expect(tent.locator('.merchant-item-meta')).toHaveText('$189.50 USD · example-outfitter.com · In stock');
  await expect(tent.locator('img')).toHaveAttribute('src', 'https://cdn.trychannel3.com/fake-test-image-0001');
  await expect.poll(() => tent.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(bag.locator('.merchant-item-meta')).toContainText('No price returned');
  await expect(bag.getByRole('button', { name: 'Use as goal' })).toBeDisabled();
  await expect(stove.locator('.merchant-item-meta')).toHaveText('$260.00 USD · example-stoves.com · Out of stock');
  await expect(stove.locator('.merchant-item-note')).toHaveText('Over your budget');
  // The retailer link is secondary, safe and disclosed once near the links.
  await tent.locator('summary').click();
  const link = tent.getByRole('link', { name: /View at example-outfitter\.com/ });
  await expect(link).toHaveAttribute('href', 'https://buy.trychannel3.com/fake/tent-a');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(page.locator('#merchant-source')).toContainText('tax and shipping not included. We may earn a commission when you buy through links on this page.');
  expect(await dialog.evaluate((d) => d.getBoundingClientRect().right <= innerWidth && d.scrollWidth <= d.clientWidth + 1)).toBe(true);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}${info.project.name}-results.png` });

  // "Use as goal" fills the Plan form as a draft. Nothing is written yet.
  await tent.getByRole('button', { name: 'Use as goal' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#goal-draft-title')).toBeFocused();
  await expect(page.locator('#goal-name-input')).toHaveValue('Test fixture: Four-person dome tent');
  await expect(page.locator('#goal-target')).toHaveValue('189.50');
  await expect(page.locator('#goal-draft-facts')).toContainText('$189.50 USD · example-outfitter.com · In stock · Channel3, checked');
  await expect(page.locator('#goal-draft-effect')).toContainText('Not saved yet. Saving replaces “Camping trip fund” ($300.00)');
  await expect(page.locator('#goal-draft-effect')).toContainText('the $60.00 already tracked stays and counts toward the new amount');
  await expect(page.locator('#ask-planner')).toBeDisabled();
  expect(await stateOf(page)).toEqual(before);
  await page.locator('#goal-draft').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}${info.project.name}-draft.png` });

  // A refused save changes nothing and keeps the draft: the amount cannot go below the item's price.
  await page.locator('#goal-target').fill('150.00');
  await page.locator('#goal-draft-save').click();
  await expect(page.locator('#plan-status')).toContainText('The goal amount cannot be lower than the item’s price ($189.50).');
  await expect(page.locator('#goal-draft')).toBeVisible();
  expect(await stateOf(page)).toEqual(before);

  // Saving at the actual price is the ordinary goal edit: with $60 already reported, $189.50 passes 25%, so the Manor
  // opens with its usual deed card, exactly as the Plan editor would for the same edit. No money moves.
  await page.locator('#goal-target').fill('189.50');
  await page.locator('#goal-draft-save').click();
  await expect(page.locator('#plan-status')).toContainText('Goal saved: Test fixture: Four-person dome tent, $189.50.');
  await expect(page.locator('#deed-dialog')).toBeVisible();
  await expect(page.locator('#deed-name')).toHaveText('Manor Gardens');
  await page.locator('#deed-close').click();
  await expect(page.locator('#deed-dialog')).toBeHidden();
  await expect(page.locator('#goal-name')).toHaveText('Test fixture: Four-person dome tent');
  await expect(page.locator('#goal-draft')).toBeHidden();
  await expect(page.locator('#goal-item')).toContainText('Goal item: Test fixture: Four-person dome tent · $189.50 at example-outfitter.com, Channel3 price checked');
  await expect(page.locator('#ask-planner')).toBeEnabled();

  const after = await stateOf(page);
  expect(after.goal.targetCents).toBe(18950);
  expect(after.goalItem).toMatchObject({ provider: 'Channel3', productId: 'fakeTent01', priceCents: 18950, currency: 'USD', merchant: 'example-outfitter.com' });
  expect(after.progress.progressCents).toBe(before.progress.progressCents);
  // No ledger entry is added or changed in amount; the existing goal save only relabels the example starting row.
  const money = (l) => l.goalEntries.concat(l.bills, l.gifts).map((e) => [e.id, e.kind, e.effect, e.amountCents, e.source]);
  expect(money(after.ledger)).toEqual(money(before.ledger));
  expect(after.contributions).toEqual([]);
  expect(after.rewards.realm.districts.filter((d) => d.open).map((d) => d.id)).toEqual(['cottage', 'manor']);
  expect(searches.get(page)).toEqual(['POST /api/merchant/search', 'POST /api/merchant/goal', 'POST /api/merchant/goal']);
  expect(s.fake.calls).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Reload: the confirmed goal and its item persist; the deed is not shown again.
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-plan').click();
  await expect(page.locator('#goal-name')).toHaveText('Test fixture: Four-person dome tent');
  await expect(page.locator('#goal-target')).toHaveValue('189.50');
  await expect(page.locator('#goal-item')).toContainText('$189.50 at example-outfitter.com');
  await page.waitForTimeout(1500);
  await expect(page.locator('#deed-dialog')).toBeHidden();
  expect(await stateOf(page)).toEqual(after);
});

test('stale answers are dropped; empty, error, discard, Escape and focus return behave', async ({ page }) => {
  await open(page);
  const before = await stateOf(page);
  await page.locator('#open-merchant').click();
  const query = page.locator('#merchant-query');
  // A slow search is overtaken by a newer one: only the newer answer is shown, even after the slow one returns.
  await query.fill('slow lantern');
  await query.press('Enter');
  await expect(page.locator('#merchant-status')).toHaveText('Asking Channel3…');
  await query.fill('tent');
  await query.press('Enter');
  await expect(page.locator('#merchant-results > li')).toHaveCount(3);
  await page.waitForTimeout(1800);
  await expect(page.locator('#merchant-results')).not.toContainText('Slow lantern');
  await expect(page.locator('#merchant-results > li')).toHaveCount(3);

  await query.fill('nothing');
  await query.press('Enter');
  await expect(page.locator('#merchant-status')).toHaveText('No matches for “nothing”. Try other words.');
  await expect(page.locator('#merchant-results > li')).toHaveCount(0);
  await expect(page.locator('#merchant-source')).toBeHidden();
  await query.fill('broken');
  await query.press('Enter');
  await expect(page.locator('#merchant-status')).toHaveText('Channel3 did not answer properly (HTTP 500). Try again later.');
  // A link is refused before anything is sent.
  await query.fill('https://example.com/tent');
  await query.press('Enter');
  await expect(page.locator('#merchant-status')).toHaveText('Describe the item in words rather than pasting a link.');
  const sent = s.fake.calls.length;

  await page.keyboard.press('Escape');
  await expect(page.locator('#merchant-dialog')).toBeHidden();
  await expect(page.locator('#open-merchant')).toBeFocused();

  // A draft can be discarded: the form returns to the saved goal and nothing was written.
  await page.locator('#open-merchant').press('Enter');
  await query.fill('tent');
  await query.press('Enter');
  await page.locator('#merchant-results > li').first().getByRole('button', { name: 'Use as goal' }).click();
  await expect(page.locator('#goal-draft')).toBeVisible();
  await page.locator('#goal-draft-discard').click();
  await expect(page.locator('#goal-draft')).toBeHidden();
  await expect(page.locator('#goal-name-input')).toHaveValue('Camping trip fund');
  await expect(page.locator('#goal-target')).toHaveValue('300.00');
  await expect(page.locator('#plan-status')).toHaveText('Draft discarded. The goal is unchanged.');
  expect(s.fake.calls.length).toBe(sent); // the repeated "tent" came from the short server cache
  expect(await stateOf(page)).toEqual(before);
});

test('without a Channel3 key the merchant says so plainly and searches nothing', async ({ page }, info) => {
  await open(page, { withKey: false });
  await page.locator('#open-merchant').click();
  await expect(page.locator('#merchant-status')).toHaveText('The merchant isn’t open yet: product search is not connected.');
  await expect(page.locator('#merchant-query')).toBeDisabled();
  await expect(page.locator('#merchant-search')).toBeDisabled();
  await expect(page.locator('#merchant-title')).toBeFocused();
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}${info.project.name}-not-connected.png` });
  await page.locator('#merchant-close').click();
  await expect(page.locator('#open-merchant')).toBeFocused();
  expect(searches.get(page)).toEqual([]);
  expect(s.fake.calls).toEqual([]);
});
