import { test, expect } from '@playwright/test';

const ready = async (page) => {
  await page.goto('/'); await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.getByRole('tab',{name:'House',exact:true}).click();
};
const writes = (page) => {
  const list=[];page.on('request',r=>{if(r.method()!=='GET')list.push(r.method()+' '+new URL(r.url()).pathname);});return list;
};
const member = (page,id) => page.locator('.member-choice[data-member="'+id+'"]');
const picker = (page) => page.locator('#avatar-picker');
const save = (page) => page.getByRole('button',{name:'Save avatar',exact:true});

const problems=new WeakMap();
test.beforeEach(async({request,page,baseURL})=>{
  expect((await request.post('/api/demo/reset',{data:{}})).ok()).toBeTruthy();
  const issues=[];problems.set(page,issues);
  page.on('pageerror',e=>issues.push(e.message));
  await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(baseURL).origin){issues.push('External request: '+url.origin);return route.abort();}
    if(req.method()!=='GET'&&!(req.method()==='PUT'&&/^\/api\/members\/[\w-]+\/avatar$/.test(url.pathname))){issues.push('Unexpected write: '+req.method()+' '+url.pathname);return route.abort();}
    return route.continue();
  });
});
test.afterEach(({page})=>{expect(problems.get(page)).toEqual([]);});

test('each member keeps a distinct saved portrait and matching map character after reload',async({page,request})=>{
  const requests=writes(page);await ready(page);
  const before=await (await request.get('/api/state')).json();
  await member(page,'m_rowan').click();
  await page.getByRole('radio',{name:'Wizard',exact:true}).check();
  expect(requests).toEqual([]);
  await save(page).click();
  await expect(page.locator('.avatar-status')).toContainText('Rowan’s avatar saved');
  await expect(member(page,'m_rowan')).toHaveAttribute('data-avatar','wizard');
  await expect(member(page,'m_wren')).toHaveAttribute('data-avatar','bard');
  await member(page,'m_wren').click();
  await page.getByRole('radio',{name:'Royal',exact:true}).check();await save(page).click();
  await expect(member(page,'m_wren')).toHaveAttribute('data-avatar','royal');
  await expect.poll(()=>page.evaluate(()=>window.__ourCastle.scene().familyAvatars.map(m=>m.avatarId))).toEqual(['wizard','royal']);
  await page.reload();await page.waitForFunction(()=>window.__ourCastle?.scene()?.familyAvatars.length===2);
  await expect(member(page,'m_rowan')).toHaveAttribute('data-avatar','wizard');
  await expect(member(page,'m_wren').locator('img')).toHaveAttribute('src','/assets/member-avatars/royal.png');
  const after=await (await request.get('/api/state')).json();
  expect(after.progress).toEqual(before.progress);expect(after.board).toEqual(before.board);
  expect(after.members.map(({avatarId,...m})=>m)).toEqual(before.members.map(({avatarId,...m})=>m));
  expect(requests).toEqual(['PUT /api/members/m_rowan/avatar','PUT /api/members/m_wren/avatar']);
});

test('keyboard browsing and Escape/Cancel do not write and return focus to the member',async({page})=>{
  const requests=writes(page);await ready(page);
  await member(page,'m_rowan').focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('radio',{name:'Ranger',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio',{name:'Knight',exact:true})).toBeChecked();
  await page.keyboard.press('Escape');await expect(picker(page)).toBeHidden();
  await expect(member(page,'m_rowan')).toBeFocused();
  await expect(member(page,'m_rowan')).toHaveAttribute('data-avatar','ranger');
  await member(page,'m_wren').click();await page.getByRole('radio',{name:'Wizard',exact:true}).check();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(member(page,'m_wren')).toBeFocused();
  await expect(member(page,'m_wren')).toHaveAttribute('data-avatar','bard');
  expect(requests).toEqual([]);
});

test('failed saves keep the current avatar and editable choice until an explicit retry',async({page})=>{
  await ready(page);
  const route='**/api/members/m_rowan/avatar';
  await page.route(route,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Could not save. Try again.'}})}));
  await member(page,'m_rowan').click();await page.getByRole('radio',{name:'Knight',exact:true}).check();
  await save(page).click();
  await expect(page.locator('.avatar-status')).toHaveText('Could not save. Try again.');
  await expect(picker(page)).toBeVisible();await expect(save(page)).toBeEnabled();
  await expect(page.getByRole('radio',{name:'Knight',exact:true})).toBeChecked();
  await expect(member(page,'m_rowan')).toHaveAttribute('data-avatar','ranger');
  await page.unroute(route);await save(page).click();
  await expect(picker(page)).toBeHidden();
  await expect(member(page,'m_rowan')).toHaveAttribute('data-avatar','knight');
});

test('all portraits load, touch targets fit and avatars leave child approval locked',async({page,request},testInfo)=>{
  await request.post('/api/setup',{data:{playMode:'family',name:'House of Alder',crest:{field:'cobalt',charge:'stag'}}});
  await ready(page);
  await page.locator('#persona').selectOption('m_wren');
  await member(page,'m_wren').click();await page.getByRole('radio',{name:'Knight',exact:true}).check();
  await expect.poll(()=>page.locator('.avatar-face img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth===96))).toBe(true);
  const metrics=await page.locator('.avatar-face').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  expect(metrics.every(r=>r.width>=44&&r.height>=44)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('avatar-picker.png'),fullPage:true});
  await save(page).click();await expect(member(page,'m_wren')).toHaveAttribute('data-avatar','knight');
  await page.getByRole('tab',{name:'Contribute',exact:true}).click();
  await expect(page.locator('#give-approve')).toBeDisabled();
  const state=await (await request.get('/api/state')).json();
  expect(state.members.find(m=>m.id==='m_wren').role).toBe('child');
  expect(state.contributions).toHaveLength(0);
});
