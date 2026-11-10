import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startDemo } from '../../scripts/demo.mjs';
import { openMenu } from './support/game-controls.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';
import { familyServer, person, createFamily, openTab, csrfFetch, isLive } from './support/family.mjs';
const read = page=>page.evaluate(async()=>(await fetch('/api/state')).json());
const openExchange=async page=>{await page.locator('#open-exchange').click();await page.locator('#exchange-manage > summary').click();};
const selectNeed=async(page,name)=>{await page.locator('#exchange-list').getByRole('button',{name:new RegExp(`View ${name}`)}).click();};

test('received neighbor tent changes the actual kit comparison from $150 to $70; no cash credit', {tag:'@release'}, async({browser},info)=>{
  test.setTimeout(180_000);
  const demo=await startDemo({villageExchange:true});
  const {viewport,isMobile,hasTouch,deviceScaleFactor}=info.project.use;
  const context=await browser.newContext({viewport,isMobile,hasTouch,deviceScaleFactor,reducedMotion:'reduce'});
  const page=await context.newPage(),outside=[],errors=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin===demo.url)return r.continue();outside.push(r.request().url());return r.abort();});
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(demo.url);await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:30000});await closeDeedsWhenTheyAppear(page);
    await page.locator('#kit-list > summary').click();await page.locator('#kit-plan-compare').click();
    await expect(page.locator('#kit-plan-kits > li').first()).toContainText('$150.00');
    const before=await read(page);
    await page.locator('#journal-toggle').click();
    await openMenu(page,'district-menu');await page.locator('#realm-districts [data-district="market"]').click();
    await expect(page.locator('#open-exchange')).toBeVisible();
    await page.locator('#open-exchange').click();
    await expect(page.locator('#exchange-dialog')).toHaveAttribute('open','');
    await selectNeed(page,'4-person tent');
    await page.getByRole('button',{name:'Accept offer',exact:true}).click();
    await expect(page.locator('#exchange-board')).toContainText('waiting for handover');
    expect((await read(page)).kit.items.find(i=>i.name.includes('tent')).remaining).toBe(1);
    await page.getByRole('button',{name:'I received the item',exact:true}).click();
    await expect(page.locator('#exchange-board')).toContainText('Received');
    await page.getByRole('button',{name:'Compare what is left to buy'}).click();await page.locator('#kit-plan-compare').click();
    await expect(page.locator('#kit-plan-kits > li').first()).toContainText('$70.00');
    const after=await read(page);expect(after.progress).toEqual(before.progress);expect(after.contributions).toEqual(before.contributions);
    await page.locator('#open-exchange').click();await selectNeed(page,'4-person tent');
    mkdirSync('test-results/village-exchange-20261110',{recursive:true});
    await page.screenshot({path:`test-results/village-exchange-20261110/${info.project.name}-received.png`});
    await page.getByRole('button',{name:'I returned the item'}).click();
    await expect(page.locator('#exchange-board')).toContainText('Returned');
    expect((await read(page)).kit.items.find(i=>i.name.includes('tent')).remaining).toBe(1);
    expect(errors).toEqual([]);expect(outside).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();await demo.close();}
});

test('two signed-in households join privately, offer and receive through the journal with live updates', {tag:'@release'}, async({browser},info)=>{
  test.setTimeout(180_000);const s=await familyServer();
  const a=await person(browser,info,'Rowan',{origin:s.origin}),b=await person(browser,info,'Willow',{origin:s.origin});
  a.page.setDefaultTimeout(15000);b.page.setDefaultTimeout(15000);
  try{
    await createFamily(a,s.origin,'Rowan');await createFamily(b,s.origin,'Willow');
    // Fixture: one saved kit item. All exchange steps below use visible controls.
    const initial=await read(a.page);
    expect((await csrfFetch(a.page,'PUT','/api/kit',{goalId:initial.goal.id,expectedRevision:0,items:[{name:'Four-person tent',needs:'Rain cover',quantity:1,ownedQuantity:0,from:'typed'}]})).status).toBe(200);
    await a.page.reload();await expect(a.page.locator('body')).toHaveAttribute('data-ready','true');
    await openExchange(a.page);
    await a.page.getByText('Start a neighborhood',{exact:true}).click();
    await a.page.getByLabel('Neighborhood name',{exact:true}).fill('Woodland neighbors');
    await a.page.getByLabel('Your shared family name',{exact:true}).first().fill('Alder');
    await a.page.getByRole('button',{name:'Create neighborhood',exact:true}).click();
    await a.page.getByText('Invite another family',{exact:true}).click();
    await a.page.locator('#exchange-dialog').getByRole('button',{name:'Create invitation',exact:true}).click();
    const code=await a.page.getByLabel('Invitation code to share',{exact:true}).inputValue();
    await openExchange(b.page);await b.page.getByText('Join with an invitation',{exact:true}).click();
    await b.page.getByLabel('Invitation code',{exact:true}).fill(code);
    await b.page.getByLabel('Your shared family name',{exact:true}).last().fill('Willow');
    await b.page.getByRole('button',{name:'Review invitation'}).click();await b.page.getByRole('button',{name:'Join this neighborhood'}).click();
    await expect(b.page.locator('#exchange-summary')).toContainText('2 families');
    await a.page.getByText('Ask neighbors for an item',{exact:true}).click();
    await a.page.getByLabel('A note for neighbors').fill('For our camping weekend');
    await a.page.getByLabel('Share this item’s name', {exact:false}).check();
    await a.page.getByRole('button',{name:'Share this need'}).click();
    await expect(b.page.locator('#exchange-list')).toContainText('Four-person tent',{timeout:20000});
    await selectNeed(b.page,'Four-person tent');
    await b.page.locator('#exchange-board summary').filter({hasText:'Offer an item'}).click();await b.page.getByLabel('Item details for this family').fill('Tent with all pegs');
    await b.page.getByRole('button',{name:'Offer item',exact:true}).click();
    await selectNeed(a.page,'Four-person tent');
    await expect(a.page.locator('#exchange-board')).toContainText('Tent with all pegs');
    await a.page.getByRole('button',{name:'Accept offer'}).click();await a.page.getByRole('button',{name:'I received the item'}).click();
    await expect(b.page.locator('#exchange-board')).toContainText('Received');
    const final=await read(a.page);expect(final.kit.items[0].remaining).toBe(0);expect(final.progress.progressCents).toBe(initial.progress.progressCents);
    await a.page.screenshot({path:`test-results/village-exchange-20261110/${info.project.name}-two-families.png`});
    expect([...a.errors,...b.errors,...a.outside,...b.outside]).toEqual([]);
    // The Exchange windows live outside the map shell; losing access must close them too.
    expect((await csrfFetch(a.page,'POST','/api/auth/signout',{})).status).toBe(200);
    await expect(a.page.locator('#access-dialog')).toBeVisible();
    await expect(a.page.locator('#exchange-detail-dialog')).not.toHaveAttribute('open','');
    await expect(a.page.locator('#exchange-dialog')).not.toHaveAttribute('open','');
  }finally{await a.context.close();await b.context.close();await s.close();}
});
