import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import {test,expect} from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';
const scene=(page)=>page.evaluate(()=>window.__ourCastle.scene());
// Classify palette-painted world surfaces, excluding the soft non-palette cloud surround and dark outline.
const mapColours=(page)=>page.evaluate(async()=>{
  const {PALETTE}=await import('/src/graphics/palette.js');
  const painted=new Set(PALETTE.map(rgb=>rgb.reduce((n,v)=>(n<<8)|Math.round(v*255),0)));
  const source=document.querySelector('#world canvas'),c=document.createElement('canvas');c.width=source.width;c.height=source.height;
  const g=c.getContext('2d');g.drawImage(source,0,0);const px=g.getImageData(0,0,c.width,c.height).data;
  let drawn=0,green=0,blue=0;
  for(let i=0;i<px.length;i+=4){
    const r=px[i],gg=px[i+1],b=px[i+2];
    if(!painted.has((r<<16)|(gg<<8)|b)||Math.abs(r-14)+Math.abs(gg-18)+Math.abs(b-21)<8)continue;
    drawn++;if(gg>=r+10&&gg>=b+5)green++;else if(b>=gg+10&&b>=r+25)blue++;
  }
  return {drawn,green:green/drawn,blue:blue/drawn};
});
// District deeds are tested in area-cards.spec.mjs; here a deed that opens is closed like a family would.
test.beforeEach(({ page }) => closeDeedsWhenTheyAppear(page));
test.beforeEach(async({page,request})=>{
  expect((await request.post('/api/demo/reset',{data:{}})).ok()).toBeTruthy();
  await page.goto('/');await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
});

test('future castles are separate locked destinations in one green woodland behind raised bridges and gates; inspecting them cannot unlock them',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const initial=await scene(page),before=await(await request.get('/api/state')).json();
  expect(initial.region).toEqual({width:356,depth:260,centerX:32,centerZ:0});
  expect(initial.districts).toHaveLength(9);
  expect(initial.districts.filter(d=>d.open).map(d=>d.id)).toEqual(['cottage']);
  // Locked is shown by labels, raised leaves and closed gates. Every district keeps its full colours.
  expect(initial.districts.every(d=>!d.greyPaint&&d.drawMeshes>0&&d.hues>=4)).toBe(true);
  expect(initial.bridges.every(b=>!b.open&&b.raised&&b.gate)).toBe(true);
  expect(new Set(initial.bridges.map(b=>b.river))).toEqual(new Set(['main','west','east','rose','starfall','braid']));
  expect(initial.landscape.rivers.count).toBe(6);
  expect(initial.landscape.forest.trees).toBeGreaterThan(300);
  // The woodland colour check uses Day explicitly; Auto would follow this machine's clock (atmosphere.spec covers it).
  await openMenu(page, 'world-settings'); await page.selectOption('#time-mode','day');await openMenu(page, 'world-settings'); await page.selectOption('#weather-mode','clear');
  const colours=await mapColours(page);
  expect(colours.green,'the starting realm reads green').toBeGreaterThan(.4);
  expect(colours.blue,'rivers, not an ocean').toBeLessThan(.15);
  await expect(page.locator('.realm-stop[data-district="castle"]')).toContainText('Locked · 100%');
  const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url())});
  await chooseDistrict(page, 'castle');
  expect((await scene(page)).view.focus).toBe('castle');
  expect((await scene(page)).districts.find(d=>d.id==='castle').open).toBe(false);
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · $240.00 to unlock');
  await expect(page.locator('#realm-focus-status')).toContainText('$240.00 to unlock');
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
  expect(actual.districts.find(d=>d.id==='castle')).toMatchObject({open:false,greyPaint:false});
  expect(actual.bridges.filter(b=>b.open).map(b=>b.id)).toEqual(['manor-bridge']);
  expect(actual.bridges.find(b=>b.id==='keep-bridge')).toMatchObject({open:false,raised:true,gate:true});
  expect(actual.bridges.find(b=>b.id==='manor-bridge')).toMatchObject({gate:false});
  expect(actual.court.guests.filter(p=>p.district==='cottage')).toHaveLength(2);
  expect(actual.court.guests.filter(p=>p.district==='manor')).toHaveLength(4);
  await expect(page.locator('.realm-stop[data-district="manor"]')).toContainText('Open district');
});
