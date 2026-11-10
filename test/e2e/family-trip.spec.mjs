import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { createKitSolver } from '../../server/kit/solver.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// The playable family-trip example (npm run demo -- --family-trip), as a visitor uses it: every step below is a visible
// control on the page. The demo runs in this process on its own loopback port, exactly as the command starts it:
// - the family, the two sample shops and the six listings are the example's own invented data (scripts/family-trip.mjs);
// - the kits, dates, repair and shortfall are computed by the existing planner and solver (the compiled Rust program when
//   built; KIT_SOLVER_REQUIRED=1 makes that mandatory, as CI does);
// - the server's day is pinned to Nov 8, 2026, so the figures are the worked example's (docs/KIT-PLANNER.md);
// - every request that leaves this origin is refused and counted. No provider is contacted and no key is read.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/family-trip/', import.meta.url));
const required = process.env.KIT_SOLVER_REQUIRED === '1';

// The server's day stays Nov 8, 2026 while its time moves on, so listings age as they really would.
function novemberEighth() {
  const start = Date.parse('2026-11-08T18:00:00Z'), real = Date.now();
  return {
    now: () => new Date(start + (Date.now() - real)), iso() { return this.now().toISOString(); },
    today() { const d = this.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  };
}
const state = (page) => page.evaluate(async () => (await fetch('/api/state')).json());
// What no trial, comparison, choice or kept line may change.
const money = (s) => JSON.stringify([s.progress, s.ledger, s.contributions, s.plan, s.acceptedPlanId, s.goal, s.goalKit, s.familyChoices.offers]);

test('a visitor tries a one-off expense, sees the real planner repair the kit, and makes one simulated contribution', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.setTimeout(240_000);
  const kitSolver = createKitSolver({ root, engine: required ? 'native' : 'auto' });
  const demo = await startDemo({ familyTrip: true, clock: novemberEighth(), kitSolver });
  const calls = demo.example.merchant.catalogue.calls;
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const errors = [], outside = [], popups = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === demo.url) return route.continue();
    outside.push(url.href);
    return route.abort();
  });
  context.on('page', (opened) => popups.push(opened.url()));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  popups.length = 0; // the page just opened is the visitor's own
  // Three captures in all: the comparison and the repair on the desktop, and the repair on the 390 px phone.
  const shot = async (name, selector) => {
    if (info.project.name !== 'desktop' && name !== 'repair') return;
    await page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  };
  mkdirSync(evidence, { recursive: true });
  try {
    await page.goto(demo.url + '/');
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await closeDeedsWhenTheyAppear(page);

    // 1. What the visitor is told before touching anything: this family, these shops and these prices are invented.
    await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true'); // the journal opens on Plan
    await expect(page.locator('#house-eyebrow')).toHaveText('House of Alder');
    await expect(page.locator('#header-example')).toBeVisible();
    await expect(page.locator('#header-example')).toHaveText('Example');
    await expect(page.locator('#honesty')).toHaveText('Example family trip · the family, shops, listings and prices are invented · simulated payments. Demo profiles, not sign-in. Reported savings and bills are unverified; progress is not a bank balance.');
    await expect(page.locator('#mode-badges')).toContainText('Example catalogue');
    await expect(page.locator('#persona option')).toHaveText(['Rowan · Adult', 'Ash · Adult', 'Wren · Child']);
    await expect(page.locator('#example-entry-text')).toHaveText('Example family trip: an invented family, two sample shops and invented prices.');
    const first = await state(page);
    const before = money(first);

    // 2. One way in. It opens Family choices and the Kit list and puts the cursor in the one-off field; it fills nothing.
    await page.getByRole('button', { name: 'Try a one-off expense' }).click();
    await expect(page.locator('#family-choices')).toHaveAttribute('open', '');
    await expect(page.locator('#kit-list')).toHaveAttribute('open', '');
    await expect(page.locator('#family-trial-input')).toBeFocused();
    await expect(page.locator('#family-trial-input')).toHaveValue('');
    await expect(page.locator('#family-offer-list > li')).toHaveText(['Rowan (you): $20.00 a week', 'Ash: $10.00 a week']);

    // 3. The example's list and listings, each named as a sample. The torches are at home: no listing, no search.
    await expect(page.locator('#kit-plan-intro')).toContainText('This example’s listings are invented: two sample shops, with invented prices, weights and stock.');
    await expect(page.locator('#kit-plan-lines > li')).toHaveCount(4);
    await expect(page.locator('#kit-plan-lines > li', { hasText: 'torch' })).toContainText('Already at home');
    await expect(page.getByRole('button', { name: /listings? for torch/ })).toHaveCount(0);
    const listings = page.locator('.kit-plan-listing');
    await expect(listings).toHaveCount(6);
    await expect(listings.locator('.kit-plan-listing-name')).toHaveText(['Sample: Dome tent, four-person', 'Sample: Light tent, four-person', 'Sample: Sleeping bag, synthetic',
      'Sample: Sleeping bag, down', 'Sample: Camp stove', 'Sample: Compact stove']);
    for (let i = 0; i < 6; i++) await expect(listings.nth(i).locator('.kit-plan-listing-facts')).toContainText(/sample-shop-(one|two)\.example · \$\d+\.00 a listing · 1 in each \(Rowan’s count\) · listed [\d.]+ k?g · in stock in this example · checked/);
    await expect(listings.nth(2).locator('.kit-plan-listing-buys')).toHaveText('For 2: 2 listings = $40.00');

    // 4. A $90 one-off, typed by the visitor, leaves $180 by Dec 27: the planner finds two different complete kits.
    await page.getByLabel('One-off amount').fill('90.00');
    await expect(page.locator('#kit-plan-ceiling')).toContainText('Up to $180.00 by Dec 27');
    await page.getByRole('button', { name: 'See which complete kits fit' }).click();
    await expect(page.locator('#kit-plan-compare')).toBeFocused(); // the link moves there; it does not press it
    await expect(page.locator('#kit-plan-result')).toBeHidden();
    await page.getByRole('button', { name: 'Compare complete kits' }).click();
    const kits = page.locator('#kit-plan-kits > li');
    await expect(kits).toHaveCount(2);
    await expect(page.locator('#kit-plan-note')).toHaveText('2 different complete kits fit by Dec 27, after the one-off $90.00.');
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toHaveText('Lowest listed total · Fewest shops$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-finish')).toHaveText('Finishes Dec 20 (week 6), on time for Dec 27.');
    await expect(kits.nth(1).locator('.kit-plan-kit-head')).toHaveText('Lower listed weight$180.00');
    await expect(kits.nth(1).locator('.kit-plan-kit-finish')).toHaveText('Finishes Dec 27 (week 7), on time for Dec 27.');
    await expect(kits.nth(1)).toContainText('Items to get weigh 4.0 kg as listed');
    await expect(page.locator('#kit-plan-pool')).toContainText('Compared all 8 complete kits made from the 6 listings added');
    await expect(page.locator('#kit-plan-pool')).toContainText('These are the example’s invented listings, not real shops, prices or stock. Listed prices as last checked; tax and shipping are not included, and stock is not reserved.');
    await expect(page.locator('#kit-plan-prefer')).toBeHidden(); // no preference ordering: Cohere is off in the example
    await shot('comparison', '#kit-plan-result');

    // 5. The visitor chooses the lighter $180 kit and keeps its stove.
    await kits.nth(1).getByRole('button', { name: 'Choose this kit' }).click();
    await expect(page.locator('#kit-plan-chosen-title')).toBeFocused();
    await page.getByRole('button', { name: 'Keep stove as it is' }).click();
    await expect(page.getByRole('button', { name: 'Keep stove as it is' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#kit-plan-chosen-note')).toContainText('listed total $180.00. Finishes Dec 27 (week 7), on time for Dec 27. This page’s estimate, after the one-off $90.00 tried here.');

    // 6. One expense changes: $120 instead of $90. The planner recomputes, with no catalogue call: the chosen kit would be
    // late, and the smallest change that fits switches only the tent and leaves the kept stove.
    const asked = { ...calls };
    await page.getByRole('button', { name: 'Change the one-off expense' }).click();
    await expect(page.locator('#family-trial-input')).toBeFocused();
    await page.getByLabel('One-off amount').fill('120.00');
    await expect(page.locator('#kit-plan-note')).toHaveText('One complete kit fits by Dec 27, after the one-off $120.00.');
    await expect(kits).toHaveCount(1);
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toHaveText('Smallest change · Lowest listed total · Lower listed weight · Fewest shops$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-changes')).toHaveText('Switched 4-person tent: Sample: Light tent, four-person → Sample: Dome tent, four-person, $110.00 → $80.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-lines li', { hasText: 'stove' })).toContainText('Sample: Camp stove');
    await expect(kits.nth(0).locator('.kit-plan-kit-lines li', { hasText: 'stove' })).toContainText('kept');
    await expect(page.locator('#kit-plan-chosen-note')).toContainText('Keeping this kit: finishes Jan 3, 2027, 1 week after Dec 27. Keeping the date: $30.00 short by then. This page’s estimate, after the one-off $120.00 tried here.');
    await shot('repair', '#kit-plan-result');

    // 7. An impossible amount gets no invented answer: nothing fits $70, and the closest kit says what it would take.
    await page.getByLabel('One-off amount').fill('200.00');
    await expect(page.locator('#kit-plan-note')).toHaveText('No complete kit fits $70.00 by Dec 27 after the one-off $200.00. The closest one, and what keeping it or keeping the date would mean:');
    await expect(kits).toHaveCount(1);
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toHaveText('Closest complete kit$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-finish')).toHaveText('Keeping this kit: finishes Jan 17, 2027, 3 weeks after Dec 27. Keeping the date: $80.00 short by then.');
    await expect(kits.nth(0).locator('.kit-plan-kit-lines li', { hasText: 'stove' })).toContainText('kept');

    // Every trial, comparison, choice and kept line so far moved no money and changed no progress, goal, plan or offer,
    // and none of the three recomputations asked the catalogue anything.
    expect(money(await state(page))).toBe(before);
    expect(calls).toEqual(asked);
    expect(calls).toEqual({ search: 3, product: 0, similar: 0, other: 0 });

    // 8. Back to $120: the visitor takes the repair and reviews it. The Plan form shows an unsaved draft; nothing is saved.
    await page.getByLabel('One-off amount').fill('120.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toContainText('Smallest change');
    await kits.nth(0).getByRole('button', { name: 'Choose this kit' }).click();
    await expect(page.locator('#kit-plan-chosen-note')).toContainText('listed total $150.00. Finishes Dec 27 (week 7), on time for Dec 27.');
    await page.getByRole('button', { name: 'Review this kit' }).click();
    await expect(page.locator('#goal-draft-title')).toBeFocused();
    await expect(page.locator('#goal-draft-name')).toHaveText('Chosen kit: 3 items to get');
    await expect(page.locator('#goal-draft-facts')).toContainText('Invented example listings, checked within the last half hour');
    await expect(page.locator('#goal-draft-effect')).toContainText('The listed total excludes tax and shipping; stock is not reserved and nothing is bought.');
    await expect(page.locator('#goal-target')).toHaveValue('150.00');
    await expect(page.locator('#goal-date')).toHaveValue('2026-12-27');
    expect((await state(page)).goal.targetCents).toBe(30000);
    await page.getByRole('button', { name: 'Save goal and propose this schedule' }).click();
    await expect(page.locator('#plan-status')).toContainText('Goal saved and the family schedule proposed');
    await expect(page.locator('#goal-item')).toHaveText('Saved from the chosen kit: 3 items to get, $150.00 listed total (tax and shipping not included).');
    const saved = await state(page);
    expect([saved.goal.targetCents, saved.goalKit.totalCents, saved.plan.status, saved.acceptedPlanId, saved.progress.progressCents, saved.contributions.length]).toEqual([15000, 15000, 'proposed', null, 6000, 0]);

    // 9. One explicit simulated contribution: the approval is never ticked for the visitor, and it credits once.
    await page.locator('#tab-give').click();
    await page.locator('#give-amount').fill('15.00');
    await expect(page.locator('#give-approve')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Simulate approved payment' })).toBeDisabled();
    await expect(page.locator('#give-approve-text')).toHaveText('I approve $15.00 USD (simulated).');
    await page.locator('#give-approve').check();
    await page.getByRole('button', { name: 'Simulate approved payment' }).click();
    await expect(page.locator('#receipt')).toContainText('Simulated · example mode · no PayPal transaction', { timeout: 60_000 });
    await expect(page.locator('#receipt')).toContainText('Rowan (adult, example persona)');
    await expect(page.locator('#next-step-go')).toHaveText('Review the receipt'); // the existing receipt handoff
    const paid = await state(page);
    expect([paid.progress.progressCents, paid.progress.simulatedContributedCents, paid.progress.contributedCents]).toEqual([7500, 1500, 0]);
    expect(paid.contributions.map((c) => [c.amountCents, c.status, c.simulated])).toEqual([[1500, 'completed', true]]);
    expect(paid.ledger.goalEntries.map((e) => [e.kind, e.amountCents])).toEqual([['starting_progress', 6000], ['simulated_contribution', 1500]]);

    // 10. Market Town in the example says what it is, offers no shop link, and goes through the same search route.
    await page.locator('#tab-plan').click();
    await page.getByRole('button', { name: 'Add a listing for stove' }).click();
    const dialog = page.locator('#merchant-dialog');
    await expect(dialog).toBeVisible();
    await page.locator('#merchant-search').click();
    await expect(page.locator('#merchant-status')).toHaveText('2 results for “stove”.');
    await expect(page.locator('#merchant-source')).toContainText('invented shops, listings, prices and stock. Not Channel3 results and not real offers. Tax and shipping are not included.');
    const stove = dialog.locator('.merchant-item', { hasText: 'Sample: Compact stove' });
    await stove.locator('summary').click();
    await expect(stove).toContainText('An invented shop: there is no page to visit.');
    await expect(dialog.getByRole('button', { name: /^Visit / })).toHaveCount(0);
    await expect(dialog.locator('a[href]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Use as goal' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Nothing on the page presents these as Channel3 results: the name appears only where the page says they are not.
    const mentions = await page.evaluate(() => {
      const found = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) if (/Channel3|Cohere|OpenAI/.test(node.textContent) && !node.parentElement.closest('script, style, [hidden]')) found.push(node.textContent.trim());
      return found;
    });
    expect(mentions).toEqual([expect.stringMatching(/^Example catalogue, answered on this computer at .+ Not Channel3 results and not real offers\./)]);

    // 11. Wren, the example child, reads the chosen kit and can change nothing.
    await page.locator('#persona').selectOption({ label: 'Wren · Child' });
    await expect(page.locator('#example-entry-go')).toHaveText('See the kit list');
    await expect(page.locator('#kit-plan-chosen-lines > li')).toHaveCount(3);
    await expect(page.locator('#kit-plan-chosen')).toContainText('· kept');
    await expect(page.locator('#kit-plan').getByRole('button', { name: /Keep|Choose this kit|listing for|Compare complete kits|Review this kit|Remove|Change the one-off/ })).toHaveCount(0);
    await expect(page.locator('#family-trial')).toBeHidden();

    if (required) expect(kitSolver.stats.native).toBeGreaterThan(0);
    expect(kitSolver.stats.native + kitSolver.stats.reference).toBeGreaterThan(3);
    expect(kitSolver.stats.refused).toBe(0);
    expect(errors).toEqual([]);
    expect(outside).toEqual([]); // no weather, provider, shop or CDN request left this origin
    expect(popups).toEqual([]); // and no new tab was opened
  } finally {
    await context.close();
    await demo.close();
  }
});
