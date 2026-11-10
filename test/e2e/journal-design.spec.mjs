import { test, expect } from '@playwright/test';
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
    await page.locator('#tab-house').click();
    expect(await page.locator('.journal-frontispiece img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    expect(await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]))).toBe(before);
    expect(writes).toEqual([]);expect(outside).toEqual([]);expect(errors).toEqual([]);
  }finally{await context.close();await demo.close();}
});
