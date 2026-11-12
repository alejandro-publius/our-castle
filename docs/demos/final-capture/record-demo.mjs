// A scripted, captioned screen capture of the locked shot list (docs/SUBMISSION-SHOTLIST.md): the family-trip example,
// then the village fund, then an end card. About two minutes, silent, 1920×1080.
//
//   node docs/demos/final-capture/record-demo.mjs
//
// - It starts its own in-memory demos (invented families and prices, simulated payments, no keys) and refuses every
//   request to any other origin. Nothing is uploaded, and the output folder, test-results/final-video/, is ignored by Git.
// - The browser is hidden. Every press, tick and typed amount goes through the page's own controls.
// - The captions and the pointer ring are drawn by this script over the page. They are not part of the app.
// - With ffmpeg on the PATH the two sessions are trimmed and joined into one MP4; without it the raw recordings and
//   their cut points are left in test-results/final-video/raw/.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startDemo } from '../../../scripts/demo.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${root}test-results/final-video`;
mkdirSync(`${out}/raw`, { recursive: true });
const commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const SIZE = { width: 1920, height: 1080 };
// The map is WebGL. On a Mac the hidden browser can draw it with the real graphics card; elsewhere it is drawn in software.
const gpu = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: gpu });
const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: `${out}/raw`, size: SIZE } });
const origins = new Set();
await context.route('**/*', (route) => (origins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort()));
// Daylight in both sessions, as the recording checklist asks; the weather is left as a fresh browser starts it.
await context.addInitScript(() => {
  try { localStorage.setItem('our-castle:atmosphere:time', 'day'); } catch { /* storage unavailable */ }
  // Both overlays live in the top layer, so an open dialog cannot cover them; showing one again puts it back on top.
  const top = (el) => { try { el.hidePopover(); } catch { /* not shown */ } el.showPopover(); };
  const make = (id, css) => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; el.setAttribute('popover', 'manual'); el.style.cssText = css; document.documentElement.append(el); } return el; };
  window.__caption = (text) => {
    const el = make('__rec-caption', 'position:fixed;inset:auto 0 26px 0;margin:0 auto;width:fit-content;max-width:1500px;padding:14px 26px;border:1px solid #b38a42;border-radius:4px;background:rgba(16,28,34,.94);color:#f6eddb;font:500 27px/1.3 Alegreya,Georgia,serif;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.45)');
    el.textContent = text; if (text) top(el); else { try { el.hidePopover(); } catch { /* not shown */ } }
  };
  window.__pointer = () => top(make('__rec-pointer', 'position:fixed;inset:auto;left:0;top:0;margin:0;width:26px;height:26px;padding:0;border:3px solid #fff1c9;border-radius:50%;background:rgba(179,138,66,.55);box-shadow:0 0 0 2px rgba(16,28,34,.7);pointer-events:none;transform:translate(-100px,-100px);transition:scale .12s'));
  addEventListener('mousemove', (e) => { const el = document.getElementById('__rec-pointer'); if (el) el.style.transform = `translate(${e.clientX - 13}px,${e.clientY - 13}px)`; }, true);
  addEventListener('mousedown', () => { const el = document.getElementById('__rec-pointer'); if (el) { el.style.scale = '0.7'; setTimeout(() => { el.style.scale = '1'; }, 160); } }, true);
});

const marks = {};
function driver(page) {
  const pause = (ms) => page.waitForTimeout(ms);
  const raise = () => page.evaluate(() => { window.__pointer(); const c = document.getElementById('__rec-caption'); if (c?.textContent) window.__caption(c.textContent); });
  const say = async (text, ms = 0) => { await page.evaluate((t) => window.__caption(t), text); if (ms) await pause(ms); };
  const glide = async (locator) => {
    await locator.scrollIntoViewIfNeeded(); await pause(250); await raise();
    const box = await locator.boundingBox();
    if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 }); await pause(260); }
  };
  const press = async (locator, after = 700) => { await glide(locator); await locator.click(); await pause(after); };
  const tick = async (locator, after = 600) => { await glide(locator); await locator.check(); await pause(after); };
  const type = async (locator, text, after = 600) => { await glide(locator); await locator.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(text, { delay: 95 }); await pause(after); };
  const ready = async (url) => { await page.goto(url); await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 90_000 }); };
  // An area that opens announces itself with a deed card once the travelers arrive. Wait for it, show each card for a
  // moment, then close. These checks and presses go around Playwright's own waiting, so the safety net below stays out.
  const showDeeds = async (wait = 9000) => {
    const deed = page.locator('#deed-dialog[open]');
    for (let waited = 0; waited < wait && !(await deed.isVisible()); waited += 250) await pause(250);
    if (!(await deed.isVisible())) return;
    await raise(); await pause(2600);
    if (await page.locator('#deed-next').isVisible()) { await page.evaluate(() => document.getElementById('deed-next').click()); await raise(); await pause(2400); }
    await page.evaluate(() => document.getElementById('deed-close').click()); await pause(600);
  };
  // Safety net: a deed that opens at any other moment is shown briefly and closed, so it cannot block the next press.
  page.addLocatorHandler(page.locator('#deed-dialog[open]'), async () => { await pause(2600); await page.evaluate(() => document.getElementById('deed-close').click()); await pause(500); });
  return { pause, say, press, tick, type, ready, showDeeds };
}

// ---------- Session 1: one family (shot list beats 1 to 3, and the money trail of beat 5) ----------
const trip = await startDemo({ familyTrip: true });
origins.add(trip.url);
const a = await context.newPage(); marks.a0 = Date.now();
{
  const d = driver(a), kits = a.locator('#kit-plan-kits > li'), oneOff = a.getByLabel('One-off amount'), record = a.locator('#ledger-contributions');
  await d.ready(trip.url + '/'); marks.aReady = Date.now();
  await d.say('Our Castle · an example family, sample prices and simulated payments', 4200);
  await d.press(a.getByRole('button', { name: 'Try a one-off expense' }));
  await d.type(oneOff, '90');
  await d.press(a.getByRole('button', { name: 'See which complete kits fit' }), 500);
  await d.press(a.getByRole('button', { name: 'Compare complete kits' }), 300);
  await kits.nth(1).waitFor();
  await d.say('An unexpected $90 expense. Two complete kits still fit by the date: $150, or $180 for less weight.', 4800);
  await d.press(kits.nth(1).getByRole('button', { name: 'Choose this kit' }));
  await d.press(a.getByRole('button', { name: 'Keep stove as it is' }));
  await d.press(kits.nth(1).getByRole('button', { name: /Preview on map|Shown on map/ }), 400);
  await a.locator('#kit-preview-title', { hasText: 'Your chosen kit · $180.00' }).waitFor();
  await d.say('The family chooses the lighter $180 kit and keeps its stove.', 4200);
  await d.type(oneOff, '120', 300);
  await a.locator('#kit-preview-title', { hasText: 'Proposal · smallest change · $150.00' }).waitFor();
  await d.say('The expense grows to $120. The chosen kit is now $30 short, so the planner proposes the smallest change: switch only the tent.', 6500);
  await d.press(kits.nth(0).getByRole('button', { name: 'Choose this kit' }));
  await d.press(a.getByRole('button', { name: 'Review this kit' }), 1200);
  await d.say('An adult accepts the repair, saves the goal and puts the weekly plan in use. Trying the expense committed the family to nothing.');
  await d.press(a.getByRole('button', { name: 'Save goal and propose this schedule' }), 300);
  await a.waitForFunction(() => document.getElementById('plan-status')?.textContent.includes('Goal saved'));
  await d.showDeeds(6000); // the smaller goal puts the saved $60 past an area's mark
  await d.press(a.locator('#accept-plan'), 300);
  await a.waitForFunction(() => document.getElementById('accept-plan')?.textContent.includes('Plan in use'));
  await d.pause(2400);
  await d.say('A contribution can be held first.');
  await d.press(a.locator('#tab-give'));
  await d.type(a.locator('#give-amount'), '40.00');
  await d.tick(a.locator('#give-hold'));
  await d.tick(a.locator('#give-approve'));
  await d.press(a.locator('#simulate-pay'), 300);
  await a.waitForFunction(() => document.getElementById('give-status')?.textContent.includes('Held.'));
  await d.say('$40 (simulated) is held, and nothing counts: the goal has not moved.', 4800);
  await d.press(a.locator('#tab-ledger'), 900);
  await d.say('Later an adult releases exactly $30 and keeps $10 held.', 1800);
  await d.press(record.locator('[data-hold="release"]'));
  await d.type(record.locator('.hold-amount'), '30.00');
  await d.tick(record.locator('[data-hold="keep-rest"]'));
  await d.press(record.locator('[data-hold="confirm-release"]'), 300);
  await a.waitForFunction(() => document.getElementById('progress-amount')?.textContent.includes('$90.00'));
  await d.say('Only now does the goal move, and the world with it.');
  await d.showDeeds(10_000); // the Stone Keep, then the Starfall Observatory
  await record.locator('.hold-trail').scrollIntoViewIfNeeded();
  await d.say('Every step leaves a record: held, released, and what is still held.', 5600);
  marks.aEnd = Date.now();
}
await trip.close().catch(() => {});

// ---------- Session 2: one village (beat 4, the fund's records, and the end card) ----------
const village = await startDemo({ villageFund: true });
origins.add(village.url);
const b = await context.newPage(); marks.b0 = Date.now();
{
  const d = driver(b);
  await d.ready(village.url + '/'); marks.bReady = Date.now();
  await b.locator('.village-progress-copy', { hasText: '$200.00 of $400.00 recorded' }).waitFor();
  await d.say('A second example: five invented families share one class-trip fund.', 5000);
  await d.type(b.locator('#village-amount'), '40.00');
  await d.tick(b.locator('#village-approve'));
  await d.say('An adult approves exactly $40. It counts once, for the shared fund.');
  await d.press(b.locator('#village-contribute'), 300);
  await b.locator('.village-progress-copy', { hasText: '$240.00 of $400.00 recorded' }).waitFor();
  await d.pause(4200);
  await d.press(b.locator('#village-visit'), 600);
  await d.say('The shared schoolhouse reaches its next stage.', 5200);
  await d.press(b.locator('#village-back'), 600);
  await d.say('This family’s own goal has not moved: $60.00 toward $300.00.', 4600);
  await d.press(b.getByRole('button', { name: 'Village fund', exact: true }), 600);
  await d.press(b.locator('[data-village-tab="records"]'), 400);
  await d.say('The fund keeps its own records, apart from each family’s savings.', 4800);
  await b.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Uncial; src: url('${village.url}/assets/fonts/UncialAntiqua-400.ttf'); }
    @font-face { font-family: Alegreya; font-weight: 500; src: url('${village.url}/assets/fonts/AlegreyaSans-500.ttf'); }
    html, body { height: 100%; margin: 0; background: #101c22; color: #f6eddb; }
    body { display: grid; place-content: center; text-align: center; font: 500 32px/1.5 Alegreya, Georgia, serif; }
    h1 { font: 400 92px/1.1 Uncial, Georgia, serif; color: #e3ba72; margin: 0 0 14px; }
    p { margin: 8px 0; } .mono { font-family: ui-monospace, Menlo, monospace; } .dim { color: #b9bda9; font-size: 25px; }
  </style></head><body>
    <h1>Our Castle</h1>
    <p style="font-size:36px;margin-bottom:38px">Families decide. The castle makes their progress visible.</p>
    <p class="mono" style="font-size:34px">github.com/alejandro-publius/our-castle</p>
    <p class="mono dim">npm run demo -- --family-trip &nbsp;&nbsp;·&nbsp;&nbsp; npm run demo -- --village-fund</p>
    <p class="dim" style="margin-top:38px">Recorded from main at ${commit} · invented families and prices · simulated payments</p>
    <p class="dim">Adults decide. No AI moves money.</p>
  </body></html>`);
  await b.evaluate(() => document.fonts.ready);
  await d.pause(5000);
  marks.bEnd = Date.now();
}
const files = { a: await a.video().path(), b: await b.video().path() };
await context.close(); await browser.close(); await village.close().catch(() => {});

// Seconds into each page's own recording: a little of the loading scene before the first session, none before the second.
const cut = {
  commit,
  a: { file: files.a, from: Math.max(0, (marks.aReady - marks.a0) / 1000 - 2.5), to: (marks.aEnd - marks.a0) / 1000 },
  b: { file: files.b, from: Math.max(0, (marks.bReady - marks.b0) / 1000 + 0.4), to: (marks.bEnd - marks.b0) / 1000 },
};
writeFileSync(`${out}/raw/cut.json`, `${JSON.stringify(cut, null, 2)}\n`);
const seconds = cut.a.to - cut.a.from + cut.b.to - cut.b.from, target = `${out}/our-castle-demo-captioned.mp4`;
const joined = spawnSync('ffmpeg', ['-y', '-loglevel', 'error',
  '-ss', cut.a.from.toFixed(3), '-to', cut.a.to.toFixed(3), '-i', cut.a.file, '-ss', cut.b.from.toFixed(3), '-to', cut.b.to.toFixed(3), '-i', cut.b.file,
  '-filter_complex', '[0:v]fps=30,format=yuv420p[v0];[1:v]fps=30,format=yuv420p[v1];[v0][v1]concat=n=2:v=1:a=0[v]',
  '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', target], { stdio: 'inherit' });
console.log(joined.status === 0
  ? `Recorded ${Math.round(seconds)} seconds from ${commit}: ${target}`
  : `Recorded both sessions from ${commit}. ffmpeg was not available to join them: the raw recordings and their cut points are in ${out}/raw/`);
