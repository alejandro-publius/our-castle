import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

test('the field journal keeps all chapters reachable and preserves a draft through keyboard navigation', { tag: '@release' }, async ({ browser }, info) => {
  test.setTimeout(120_000);
  const demo=await startDemo({familyTrip:true});
  const {viewport,isMobile,hasTouch,deviceScaleFactor}=info.project.use;
  const context=await browser.newContext({viewport,isMobile,hasTouch,deviceScaleFactor,reducedMotion:'reduce'});
  const outside=[],errors=[],writes=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===demo.url)return route.continue();
    outside.push(url.origin);return route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
  try {
    await closeDeedsWhenTheyAppear(page);await page.goto(demo.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready','true');
    await page.locator('#tab-plan').click();
    await page.locator('#goal-name-input').fill('Our next woodland adventure');
    const before=await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]));
    for(const tab of ['house','plan','give','ledger']) {
      await page.locator('#tab-'+tab).click();
      await expect(page.locator('#panel-'+tab)).toBeVisible();
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const close=await page.locator('#close-journal').boundingBox();
      expect(close.width).toBeGreaterThanOrEqual(44);expect(close.height).toBeGreaterThanOrEqual(44);
      if(!process.env.CI){
        mkdirSync('test-results/parchment-design',{recursive:true});
        await page.screenshot({path:`test-results/parchment-design/${info.project.name}-${tab}.png`});
      }
    }
    // Arrow navigation keeps the original roving-tab pattern and focuses the selected chapter.
    await page.locator('#tab-house').click();await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-plan')).toBeFocused();
    await expect(page.locator('#panel-plan')).toBeVisible();
    await expect(page.locator('#goal-name-input')).toHaveValue('Our next woodland adventure');
    await page.locator('#close-journal').click();
    await expect(page.locator('#journey')).toBeHidden();
    await expect(page.locator('#journal-toggle')).toBeFocused();
    await page.locator('#journal-toggle').click();
    await expect(page.locator('#goal-name-input')).toHaveValue('Our next woodland adventure');
    // Both the generated identity and the independent editable family crest render.
    await expect(page.locator('#brand-crest img')).toBeVisible();
    expect(await page.locator('#brand-crest img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    await expect(page.locator('#house-crest svg')).toHaveCount(1);
    // Each chapter says who does its work in this session. In a keyless example that is what stands in for each sponsor.
    await page.locator('#tab-plan').click();
    await expect(page.locator('#maker-plan')).toHaveText('In this example an invented catalogue stands in for Channel3 at Market Town. Schedules here come from built-in rules. With a key, Claude proposes them and the server checks the arithmetic. See Channel3’s sign at Market Town.');
    await page.locator('#tab-give').click();
    await expect(page.locator('#maker-give')).toHaveText('Simulated in this example: no PayPal call is made. With keys, the same step goes to the PayPal sandbox through PayPal’s Server SDK, which APIMatic generates. See PayPal’s sign on the hillside or APIMatic’s sign at the Starfall Observatory.');
    await page.locator('#tab-ledger').click();
    await expect(page.locator('#maker-ledger')).toHaveText(/^These records are kept in AG Grid.* See AG Grid’s sign at the Stone Keep\.$/); // said once the grid has really loaded
    // A link is camera only: it closes the journal and frames that maker's sign, closer than its district alone.
    await page.locator('#maker-ledger [data-sign="ag-grid"]').click();
    await expect(page.locator('#journey')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>window.__ourCastle.scene().view.focus)).toBe('keep');
    const atSign=await page.evaluate(()=>window.__ourCastle.scene().view);
    await page.locator('#realm-districts [data-district="keep"]').evaluate(b=>b.click()); // the district's own view is wider
    await expect.poll(()=>page.evaluate(()=>window.__ourCastle.scene().view.worldPerPixel)).toBeGreaterThan(atSign.worldPerPixel*1.3);
    if(await page.locator('#journey').isHidden())await page.locator('#journal-toggle').click();
    await page.locator('#tab-house').click();
    expect(await page.locator('.journal-frontispiece img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    expect(await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]))).toBe(before);
    expect(writes).toEqual([]);expect(outside).toEqual([]);expect(errors).toEqual([]);
  }finally{await context.close();await demo.close();}
});
