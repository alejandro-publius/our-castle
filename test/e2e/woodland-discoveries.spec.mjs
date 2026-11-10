import {test,expect} from '@playwright/test';
import {REALM_BOUNDS} from '../../src/core/realm.js';
import {openMenu,closeMenu} from './support/game-controls.mjs';
const scene=page=>page.evaluate(()=>window.__ourCastle.scene());
test('a quiet camp is found while exploring, its waterfalls meet rivers and reduced motion survives reload', {tag:'@release'}, async({page,request},info)=>{
  test.setTimeout(150000);
  await request.post('/api/demo/reset',{data:{}});
  const errors=[],writes=[],outside=[],origin=new URL(info.project.use.baseURL).origin;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!==origin){outside.push(q.url());return r.abort();}if(q.method()!=='GET')writes.push(q.url());return r.continue();});
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});
  const before=await(await request.get('/api/state')).json();
  if(await page.locator('#journey').isVisible())await page.locator('#journal-toggle').click();
  await openMenu(page,'world-settings');await page.locator('#time-mode').selectOption('day');await closeMenu(page,'world-settings');
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  await expect(page.locator('#realm-markers .realm-marker-caption:visible')).toHaveCount(0);
  await page.getByRole('button',{name:'Explore map',exact:true}).click();
  await page.getByRole('button',{name:'Visit the forest camp'}).click();
  await expect(page.locator('#realm-focus-status')).toContainText('Knights’ Rest');
  const initial=await scene(page);
  expect(initial.region).toEqual({width:452,depth:356,centerX:32,centerZ:0});
  expect(initial.discoveries.waterfalls).toHaveLength(2);
  expect(initial.discoveries.waterfalls.every(f=>f.insideWater&&f.channel===f.river)).toBe(true);
  expect(initial.discoveries.camp.knights).toBe(2);
  expect(initial.discoveries.waysides.pennants).toBe(1);
  expect(initial.surround.mistGroves).toHaveLength(2);
  await expect.poll(async()=>(await scene(page)).discoveries.seconds).toBeGreaterThan(initial.discoveries.seconds);
  await expect.poll(async()=>(await scene(page)).discoveries.waysides.pennantAngle).not.toBe(initial.discoveries.waysides.pennantAngle);
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  await page.getByRole('button',{name:'Explore map',exact:true}).click();
  await page.getByRole('button',{name:'Visit the lantern glade'}).click();
  await expect(page.locator('#realm-focus-status')).toContainText('Lantern Glade');
  expect((await scene(page)).render.geometries).toBe(initial.render.geometries);
  // Retain the live-scene reload that timed out in CI. Image captures are kept
  // in the separate visual pass so readback does not consume this test's budget.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const reloaded=await scene(page);expect(reloaded.ambient).toBe(false);
  await page.waitForTimeout(650);
  expect((await scene(page)).discoveries.seconds).toBe(reloaded.discoveries.seconds);
  expect((await scene(page)).discoveries.waysides).toEqual(reloaded.discoveries.waysides);
  expect((await scene(page)).surround.seconds).toBe(reloaded.surround.seconds);
  expect(await(await request.get('/api/state')).json()).toEqual(before);
  expect([...errors,...writes,...outside]).toEqual([]);
});

// Reduced motion is read when the scene is created. Use a fresh page, just as a
// visitor with that preference does; screenshots belong to the separate visual
// evidence pass, not this animation assertion on a software-rendered CI runner.
test('waterfalls and camp fire stay still for a visitor requesting reduced motion', {tag:'@release'}, async({page,request},info)=>{
  await request.post('/api/demo/reset',{data:{}});
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[],writes=[],outside=[],origin=new URL(info.project.use.baseURL).origin;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!==origin){outside.push(q.url());return r.abort();}if(q.method()!=='GET')writes.push(q.url());return r.continue();});
  const before=await(await request.get('/api/state')).json();
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});
  const still=await scene(page);expect(still.ambient).toBe(false);
  expect(still.discoveries.waterfalls).toHaveLength(2);
  expect(still.discoveries.camp.knights).toBe(2);
  await page.waitForTimeout(650);
  expect((await scene(page)).discoveries.seconds).toBe(still.discoveries.seconds);
  expect((await scene(page)).discoveries.waysides).toEqual(still.discoveries.waysides);
  expect(await(await request.get('/api/state')).json()).toEqual(before);
  expect([...errors,...writes,...outside]).toEqual([]);
});


test('the compass reaches the added outer landscape and remains bounded by the actual board', {tag:'@release'}, async({page,request},info)=>{
  await request.post('/api/demo/reset',{data:{}});
  await page.emulateMedia({reducedMotion:'reduce'});
  const outside=[],errors=[],writes=[],origin=new URL(info.project.use.baseURL).origin;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!==origin){outside.push(q.url());return r.abort();}if(q.method()!=='GET')writes.push(q.url());return r.continue();});
  const before=await(await request.get('/api/state')).json();
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});
  if(await page.locator('#journey').isVisible())await page.locator('#journal-toggle').click();
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  const compass=page.getByRole('button',{name:'Explore map',exact:true});await compass.click();
  await openMenu(page,'camera-menu');const controls=page.getByRole('button',{name:'Zoom in',exact:true});
  for(let i=0;i<20;i++)await controls.press('ArrowUp');
  const north=(await scene(page)).view.free;
  expect(north.z).toBeCloseTo(REALM_BOUNDS.minZ,3);
  expect(north.x).toBeGreaterThanOrEqual(REALM_BOUNDS.minX);
  for(let i=0;i<40;i++)await controls.press('ArrowDown');
  const south=(await scene(page)).view.free;
  expect(south.z).toBeCloseTo(REALM_BOUNDS.maxZ,3);
  expect(south.x).toBeLessThanOrEqual(REALM_BOUNDS.maxX);
  expect([...outside,...errors,...writes]).toEqual([]);
  expect(await(await request.get('/api/state')).json()).toEqual(before);
});
