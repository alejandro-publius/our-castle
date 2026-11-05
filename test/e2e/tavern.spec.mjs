import { test, expect } from '@playwright/test';
import { chooseDistrict } from './support/game-controls.mjs';
const issues=new WeakMap();
test.beforeEach(async({page,request,baseURL})=>{
  const modes=await(await request.get('/api/status')).json();
  expect(modes.payments.mode).toBe('example');expect(modes.ai.mode).toBe('example');
  const list=[];issues.set(page,list);page.on('pageerror',e=>list.push(e.message));
  await page.route('**/*',route=>{
    const r=route.request();if(r.method()!=='GET'||new URL(r.url()).origin!==new URL(baseURL).origin){list.push(r.method()+' '+r.url());return route.abort();}
    return route.continue();
  });
});
test.afterEach(({page})=>expect(issues.get(page)).toEqual([]));
const tavern=page=>page.evaluate(()=>window.__ourCastle.scene().tavern);

test('the tavern gathering animates without changing access, family, farms or financial records',async({page,request})=>{
  const before=await(await request.get('/api/state')).json();
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');
  await page.waitForFunction(()=>window.__ourCastle?.scene()?.tavern.people.length===3);
  const original=await page.evaluate(()=>window.__ourCastle.scene());
  await chooseDistrict(page,'market');
  await expect.poll(()=>page.evaluate(()=>window.__ourCastle.scene().view.focus)).toBe('market');
  const start=await tavern(page);
  await expect.poll(async()=>(await tavern(page)).ticks).toBeGreaterThan(start.ticks+3);
  expect((await tavern(page)).people).not.toEqual(start.people);
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  const hidden=await tavern(page);await page.waitForTimeout(900);expect(await tavern(page)).toEqual(hidden);
  await page.evaluate(()=>{delete document.hidden;});
  await expect.poll(async()=>(await tavern(page)).ticks).toBeGreaterThan(hidden.ticks);
  expect((await tavern(page)).seconds-hidden.seconds).toBeLessThan(.8);
  const after=await page.evaluate(()=>window.__ourCastle.scene());
  expect(after.bridges).toEqual(original.bridges);expect(after.familyAvatars).toEqual(original.familyAvatars);
  expect(after.farm.animals.map(a=>a.id)).toEqual(original.farm.animals.map(a=>a.id));
  expect(after.districts).toHaveLength(9);expect(after.court.capacity).toBe(original.court.capacity);
  expect(await(await request.get('/api/state')).json()).toEqual(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('reduced-motion gathering stays still and visual rebuilds retain three townsfolk without growing geometry',async({page})=>{
  // Pure render fixture: built tiers are art states, never ledger writes or payment evidence.
  await page.route('**/__tavern_scene',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><title>Tavern visual fixture</title><link rel="icon" href="data:,"><style>body{margin:0}#stage{width:100vw;height:100vh}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><div id="stage"></div><script type="module">import{createBoardScene}from"/src/world/board-scene.js";window.world=createBoardScene(document.querySelector("#stage"),{reducedMotion:true});await window.world.update({builtTier:3,estateLevel:3,position:20},{animate:false});window.fixtureReady=true;</script></html>'}));
  await page.goto('/__tavern_scene');await page.waitForFunction(()=>window.fixtureReady);
  const initial=await page.evaluate(()=>window.world.debug());await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.world.debug().tavern)).toEqual(initial.tavern);
  const records=await page.evaluate(async()=>{
    const list=[];
    for(let i=0;i<4;i++){
      await window.world.update({builtTier:i%2?0:3,estateLevel:i%2?0:3,position:i%2?0:20,crest:{field:i%2?'emerald':'cobalt'}},{animate:false});
      const d=window.world.debug();list.push({people:d.tavern.people,geometry:d.render.geometries,farm:d.farm.animals.length,court:d.court.capacity});
    }
    window.world.setAtmosphere({period:'night',weather:'rain'});window.world.dispose();return list;
  });
  for(const r of records){
    expect(r.people).toHaveLength(3);expect(new Set(r.people.map(p=>p.id)).size).toBe(3);
    expect(r.farm).toBe(10);expect(r.geometry).toBeLessThanOrEqual(initial.render.geometries+3);
    expect([2,20]).toContain(r.court);
  }
});
