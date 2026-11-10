// Disposable example data, blocked outside browser traffic, no app mutations.
import { chromium, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from '../../test/e2e/support/deeds.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir='test-results/castle-header';mkdirSync(dir,{recursive:true});
const demo=await startDemo({villageExchange:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const records=[];
try {
 for(const [name,widths,height,mobile] of [['desktop',[1440,1100,768],1000,false],['phone',[390,320],844,true]]) {
  const context=await browser.newContext({viewport:{width:widths[0],height},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],outside=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!==demo.url){outside.push(q.url());return r.abort();}if(q.method()!=='GET')writes.push(q.method()+' '+new URL(q.url()).pathname);return r.continue();});
  await closeDeedsWhenTheyAppear(page);await page.goto(demo.url);
  await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});
  const before=await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]));
  for(const width of widths) {
   await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
   await expect.poll(()=>page.locator('.topbar img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
   const metrics=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,brand:rect('.brand'),sound:rect('#sound-toggle'),journal:rect('#journal-toggle'),member:rect('.member-control'),goal:rect('.quest'),header:rect('.topbar'),images:[...document.querySelectorAll('.topbar img')].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),label:document.querySelector('#sound-label').textContent};
   });
   expect(metrics.overflow).toBe(false);expect(metrics.images.every(i=>i.loaded)).toBe(true);
   expect(metrics.sound.x).toBeGreaterThanOrEqual(metrics.brand.right);
   for(const box of [metrics.sound,metrics.journal]){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.right).toBeLessThanOrEqual(width);}
   expect(metrics.label).toBe('Sound off');
   await page.locator('.topbar').screenshot({path:`${dir}/${name}-${width}-header.png`});
   if(width===widths[0])await page.screenshot({path:`${dir}/${name}-journal.png`});
   records.push({name,width,height,metrics});
  }
  // Stress presentation with a long label only; no save and no fake financial evidence.
  await page.evaluate(()=>{document.querySelector('#house-eyebrow').textContent='House of the Very Long Woodland Family Name';document.querySelector('#goal-name').textContent='An unusually long shared family project title for a narrow screen';});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.topbar').screenshot({path:`${dir}/${name}-long-labels.png`});
  expect(await page.evaluate(()=>JSON.stringify([window.__ourCastle.state.goal,window.__ourCastle.state.progress]))).toBe(before);
  expect(errors).toEqual([]);expect(outside).toEqual([]);expect(writes).toEqual([]);
  records.push({name,errors,outside,writes});await context.close();console.log(name+' header visuals passed');
 }
 writeFileSync(dir+'/visual.json',JSON.stringify(records,null,2)+'\n');
} finally {await browser.close();await demo.close();}
