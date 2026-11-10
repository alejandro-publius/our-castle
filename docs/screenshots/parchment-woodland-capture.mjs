import { chromium, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from '../../test/e2e/support/deeds.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir='test-results/parchment-design';mkdirSync(dir,{recursive:true});
const demo=await startDemo({villageExchange:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const records=[];
try {
 for(const [name,viewport,isMobile] of [['desktop',{width:1440,height:1000},false],['phone',{width:390,height:844},true]]) {
  const context=await browser.newContext({viewport,isMobile,hasTouch:isMobile,reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],outside=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await context.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!==demo.url){outside.push(q.url());return r.abort();}if(q.method()!=='GET')writes.push(q.method()+' '+new URL(q.url()).pathname);return r.continue();});
  await closeDeedsWhenTheyAppear(page);await page.goto(demo.url);await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});
  const before=await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]));
  const mode=async value=>{await page.locator('#world-settings > summary').click();await page.locator('#time-mode').selectOption(value);await page.locator('#world-settings > summary').click();};
  const capture=async suffix=>{const path=`${dir}/${name}-${suffix}.png`;await page.screenshot({path});records.push({path,viewport,scene:await page.evaluate(()=>window.__ourCastle.scene())});};
  if(await page.locator('#journey').isVisible())await page.locator('#journal-toggle').click();
  await mode('day');await page.getByRole('button',{name:'Whole realm',exact:true}).click();await capture('realm');
  await page.getByRole('button',{name:'Explore map',exact:true}).click();await page.getByRole('button',{name:'Visit the lantern glade'}).click();await capture('glade-day');
  await mode('night');await capture('glade-night');
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();await page.getByRole('button',{name:'Explore map',exact:true}).click();await page.getByRole('button',{name:'Visit the forest camp'}).click();await capture('camp-night');
  await mode('day');await page.locator('#journal-toggle').click();await page.locator('#tab-plan').click();await capture('journal');
  await page.locator('#open-exchange').click();await expect(page.locator('#exchange-list > li')).toHaveCount(8);await page.locator('#exchange-list > li').first().getByRole('button').focus();await capture('exchange');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);expect(errors).toEqual([]);expect(outside).toEqual([]);expect(writes).toEqual([]);
  expect(await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]))).toBe(before);
  records.push({name,errors,outside,writes,overflow});await context.close();console.log(name+' visual pass complete');
 }
 writeFileSync(dir+'/visual.json',JSON.stringify(records,null,2)+'\n');
} finally {await browser.close();await demo.close();}
