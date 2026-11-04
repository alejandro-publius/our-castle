import {test,expect} from '@playwright/test';
const scene=(page)=>page.evaluate(()=>window.__ourCastle.scene());
test.beforeEach(async({page,request})=>{
  expect((await request.post('/api/demo/reset',{data:{}})).ok()).toBeTruthy();
  await page.goto('/');await page.waitForFunction(()=>document.body.dataset.ready==='true');
});

test('future castles are separate grey destinations with raised bridges; inspecting them cannot unlock them',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const initial=await scene(page),before=await(await request.get('/api/state')).json();
  expect(initial.region).toEqual({width:164,depth:114});
  expect(initial.districts).toHaveLength(6);
  expect(initial.districts.filter(d=>d.open).map(d=>d.id)).toEqual(['cottage']);
  expect(initial.districts.filter(d=>!d.open).every(d=>d.greyPaint&&d.drawMeshes>0)).toBe(true);
  expect(initial.bridges.every(b=>!b.open&&b.raised)).toBe(true);
  await expect(page.locator('.realm-stop[data-district="castle"]')).toContainText('Locked · 100%');
  const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url())});
  await page.locator('.realm-stop[data-district="castle"]').click();
  expect((await scene(page)).view.focus).toBe('castle');
  expect((await scene(page)).districts.find(d=>d.id==='castle').open).toBe(false);
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · Locked');
  await expect(page.locator('#realm-focus-status')).toContainText('$240.00 to go');
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  expect((await scene(page)).view.focus).toBe(null);
  const after=await(await request.get('/api/state')).json();
  expect(after.progress).toEqual(before.progress);expect(after.achievements).toEqual(before.achievements);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('reaching the manor milestone opens its real district and lowers its bridge while the village remains',async({page})=>{
  await page.getByRole('tab',{name:/House/}).click();
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button',{name:'Raise our banner'}).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
  await page.getByRole('tab',{name:/Contribute/}).click();
  await page.locator('#give-amount').fill('15.00');await page.locator('#give-approve').check();
  await page.getByRole('button',{name:'Simulate approved payment'}).click();
  await expect(page.locator('#progress-amount')).toHaveText('$75.00');
  await expect.poll(async()=>(await scene(page)).animating,{timeout:25000}).toBe(false);
  const actual=await scene(page);
  expect(actual.districts.filter(d=>d.open).map(d=>d.id)).toEqual(['cottage','manor']);
  expect(actual.bridges.find(b=>b.id==='manor-bridge')).toMatchObject({open:true,raised:false});
  expect(actual.districts.find(d=>d.id==='castle')).toMatchObject({open:false,greyPaint:true});
  expect(actual.court.guests.filter(p=>p.district==='cottage')).toHaveLength(2);
  expect(actual.court.guests.filter(p=>p.district==='manor')).toHaveLength(4);
  await expect(page.locator('.realm-stop[data-district="manor"]')).toContainText('Open district');
});

test('an explicit art preview opens its bridge and keeps earlier districts; returning restores the real locks',async({page})=>{
  await page.getByRole('tab',{name:/Rewards/}).click();
  await page.locator('[data-reward="home:castle"] .reward-preview').click();
  await expect.poll(async()=>(await scene(page)).districts.find(d=>d.id==='castle').open).toBe(true);
  expect((await scene(page)).districts.filter(d=>d.open).map(d=>d.id)).toEqual(['cottage','manor','market','keep','castle']);
  expect((await scene(page)).bridges.find(b=>b.id==='citadel-bridge')).toMatchObject({open:true,raised:false});
  expect((await scene(page)).court.guests.some(p=>p.district==='cottage')).toBe(true);
  expect((await scene(page)).court.guests.some(p=>p.district==='castle')).toBe(true);
  await expect(page.locator('#world-preview')).toContainText('Art preview');
  await page.getByRole('button',{name:'Return to my estate'}).click();
  await expect.poll(async()=>(await scene(page)).districts.find(d=>d.id==='castle').open).toBe(false);
  expect((await scene(page)).bridges.find(b=>b.id==='citadel-bridge')).toMatchObject({open:false,raised:true});
  expect((await scene(page)).court.capacity).toBe(2);
});
