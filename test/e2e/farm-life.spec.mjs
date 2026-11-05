import { test, expect } from '@playwright/test';
import { chooseDistrict } from './support/game-controls.mjs';

const problems = new WeakMap();
test.beforeEach(async ({ page, request, baseURL }) => {
  const modes=await (await request.get('/api/status')).json();
  expect(modes.payments.mode).toBe('example'); expect(modes.ai.mode).toBe('example');
  const issues=[];problems.set(page,issues);page.on('pageerror',e=>issues.push(e.message));
  await page.route('**/*',route=>{
    const r=route.request();
    if(r.method()!=='GET'||new URL(r.url()).origin!==new URL(baseURL).origin){issues.push(r.method()+' '+r.url());return route.abort();}
    return route.continue();
  });
});
test.afterEach(({page})=>expect(problems.get(page)).toEqual([]));
const ready=async(page)=>{
  await page.goto('/');await page.waitForFunction(()=>window.__ourCastle?.scene()?.farm.animals.length===10);
};
const farm=page=>page.evaluate(()=>window.__ourCastle.scene().farm);

test('stables and farm animals remain scenery while locked areas, family and financial state stay intact',async({page,request})=>{
  const before=await (await request.get('/api/state')).json();
  await page.emulateMedia({reducedMotion:'reduce'});await ready(page);
  const scene=await page.evaluate(()=>window.__ourCastle.scene());
  expect(scene.farm.buildings.filter(b=>b.kind==='stable').map(b=>b.district)).toEqual(['castle','palace']);
  expect(scene.farm.buildings.filter(b=>b.kind==='coop')).toHaveLength(1);
  const counts=scene.farm.animals.reduce((a,b)=>(a[b.kind]=(a[b.kind]??0)+1,a),{});
  expect(counts).toEqual({chicken:3,goat:1,sheep:2,horse:4});
  expect(scene.districts).toHaveLength(9);expect(scene.bridges).toHaveLength(9);
  for(const id of ['castle','palace','cottage','manor']){
    await chooseDistrict(page,id);
    await expect.poll(()=>page.evaluate(()=>window.__ourCastle.scene().view.focus)).toBe(id);
  }
  const after=await page.evaluate(()=>window.__ourCastle.scene());
  expect(after.bridges).toEqual(scene.bridges);expect(after.familyAvatars).toEqual(scene.familyAvatars);
  expect(after.court).toEqual(scene.court);
  expect(await (await request.get('/api/state')).json()).toEqual(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('rebuilding the visual realm retains ten animals without accumulating geometry or altering the court',async({page})=>{
  // Visual-only fixture: no payment, ledger, unlock API or household mutation.
  await page.route('**/__farm_scene',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><title>Farm geometry fixture</title><link rel="icon" href="data:,"><style>body{margin:0}#stage{width:100vw;height:100vh}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><div id="stage"></div><script type="module">import{createBoardScene}from"/src/world/board-scene.js";window.world=createBoardScene(document.querySelector("#stage"),{reducedMotion:true});await window.world.update({builtTier:3,estateLevel:3,gardens:0,position:20},{animate:false});window.fixtureReady=true;</script></html>'}));
  await page.goto('/__farm_scene');await page.waitForFunction(()=>window.fixtureReady);
  const result=await page.evaluate(async()=>{
    const initial=window.world.debug(),checks=[];
    for(let i=0;i<4;i++){
      await window.world.update({builtTier:0,estateLevel:0,position:0,crest:{field:i%2?'rose':'emerald'}},{animate:false});
      await window.world.update({builtTier:3,estateLevel:3,position:20,crest:{field:'cobalt'}},{animate:false});
      const d=window.world.debug();checks.push({farm:d.farm,geometry:d.render.geometries,court:d.court.capacity,districts:d.districts.length,bridges:d.bridges.length});
    }
    window.world.dispose();return{initial:initial.render.geometries,checks};
  });
  for(const c of result.checks){
    expect(c.farm.animals).toHaveLength(10);expect(new Set(c.farm.animals.map(a=>a.id)).size).toBe(10);
    expect(c.farm.buildings).toHaveLength(3);expect(c.geometry).toBeLessThanOrEqual(result.initial+3);
    expect(c.court).toBe(20);expect(c.districts).toBe(9);expect(c.bridges).toBe(9);
  }
});

test('animal motion respects reduced motion and pauses in hidden tabs without a clock jump',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await ready(page);
  const still=await farm(page);await page.waitForTimeout(650);expect(await farm(page)).toEqual(still);
  await page.emulateMedia({reducedMotion:'no-preference'});await ready(page);
  const start=await farm(page);
  await expect.poll(async()=>(await farm(page)).ticks).toBeGreaterThan(start.ticks+3);
  const moving=await farm(page);expect(moving.animals).not.toEqual(start.animals);
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  const paused=await farm(page);await page.waitForTimeout(1100);expect(await farm(page)).toEqual(paused);
  await page.evaluate(()=>{delete document.hidden;});
  await expect.poll(async()=>(await farm(page)).ticks).toBeGreaterThan(paused.ticks);
  const resumed=await farm(page);expect(resumed.seconds-paused.seconds).toBeLessThan(.8);
});
