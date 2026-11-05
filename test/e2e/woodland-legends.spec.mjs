import { test, expect } from '@playwright/test';
import { chooseDistrict } from './support/game-controls.mjs';
const scene=page=>page.evaluate(()=>window.__ourCastle.scene());
test.use({ reducedMotion:'reduce' });
test.beforeEach(async({request})=>{expect((await request.post('/api/demo/reset',{data:{}})).ok()).toBeTruthy();});

test('both folklore towers are reachable in Areas; exploration and the hidden sword never change progress',async({page,request},info)=>{
 const before=await(await request.get('/api/state')).json(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});
 await page.goto('/');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 if(!await page.locator('#journey').isHidden())await page.locator('#close-journal').click();
 await expect(page.locator('#realm-districts button')).toHaveCount(9);
 await chooseDistrict(page,'wizard');
 await expect(page.locator('#realm-focus-status')).toHaveText('Starfall Observatory · $120.00 to unlock');
 expect((await scene(page)).districts.find(d=>d.id==='wizard')).toMatchObject({open:false,greyPaint:false});
 await chooseDistrict(page,'rapunzel'); // Last item must scroll inside the actual on-screen menu on a phone.
 await expect(page.locator('#realm-focus-status')).toHaveText('Rapunzel’s Tower · $240.00 to unlock');
 await expect(page.locator('#realm-markers [data-district="rapunzel"]')).toBeVisible();
 const map=await scene(page);expect(map.bridges).toHaveLength(9);expect(map.landscape.rivers.count).toBe(6);
 expect(map.bridges.find(b=>b.id==='wizard-bridge')).toMatchObject({open:false,raised:true,gate:true,river:'starfall'});
 expect(map.bridges.find(b=>b.id==='rapunzel-bridge')).toMatchObject({open:false,raised:true,gate:true,river:'braid'});
 await page.getByRole('button',{name:'Whole realm',exact:true}).click();
 const glint=page.getByRole('button',{name:'Investigate the glint in the trees'});await expect(glint).toBeVisible();
 expect(await page.locator('#realm-districts [data-district="sword-stone"]').count()).toBe(0);
 const box=await glint.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
 if(info.project.name==='phone')await glint.tap();else{await glint.focus();await page.keyboard.press('Enter');}
 expect((await scene(page)).view.focus).toBe('sword-stone');
 await expect(glint).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#realm-focus-status')).toHaveText('The Sword in the Stone');
 await expect(page.locator('#view-deed')).toBeHidden();
 await expect(page.locator('#deed-dialog')).not.toHaveAttribute('open','');
 await page.locator('.realm-map').screenshot({path:info.outputPath('sword-discovery.png')});
 await page.getByRole('button',{name:'Whole realm',exact:true}).focus();await page.keyboard.press('Enter');
 expect((await scene(page)).view.focus).toBe(null);
 const labels=await page.locator('#realm-markers [data-district]:visible').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 for(let a=0;a<labels.length;a++)for(let b=a+1;b<labels.length;b++){
  const x=labels[a],y=labels[b];expect(x.x<y.right&&x.right>y.x&&x.y<y.bottom&&x.bottom>y.y).toBe(false);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 const after=await(await request.get('/api/state')).json();expect(after.progress).toEqual(before.progress);expect(after.achievements).toEqual(before.achievements);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});
