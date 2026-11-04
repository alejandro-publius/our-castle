// Reproducible, isolated app-demo capture. This never controls the owner's browser.
// macOS: node docs/demos/woodland-review/capture.mjs
// Starts its OWN example-only server on unused 3141 with a fresh database and no keys.
// The original continuous recording and reports stay in git-ignored test-results.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const base='http://127.0.0.1:3141', port=3141;
const out=resolve(root,'test-results','family-woodland-capture',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(out,{recursive:true});
const data=mkdtempSync(join(tmpdir(),'our-castle-family-film-'));
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD');
assert.equal(git('diff','--name-only','HEAD','--','src','server','app.css','index.html','package.json','package-lock.json'),'','Commit the app source before filming.');
// Refuse to reuse any process on the port, even if it is an example server.
await new Promise((ok,fail)=>{const probe=createServer();probe.once('error',fail);probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
const serverLog=createWriteStream(join(out,'server.log'));
const server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,OUR_CASTLE_ENV_FILE:'none',OUR_CASTLE_DATA_DIR:data,PAYPAL_CLIENT_ID:'',PAYPAL_CLIENT_SECRET:'',PAYPAL_WEBHOOK_ID:'',AI_API_KEY:'',ANTHROPIC_API_KEY:'',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);
let browser,context,page,rawVideo,start=0,mode,finalState,finalScene;
const phases=[],errors=[],writes=[],externalRequests=[],navigationChecks=[];
const state=async()=>{const r=await fetch(base+'/api/state');assert.ok(r.ok);return r.json();};
const marker=(id)=>{const m={id,node_seconds:(performance.now()-start)/1000};phases.push(m);console.log('Capture phase',id,m.node_seconds.toFixed(3));return m;};
const show=async(sel)=>{await page.locator(sel).scrollIntoViewIfNeeded();await delay(400);};
const guide=async()=>{await show('#next-step');const before=writes.length;await page.locator('#next-step-go').focus();await page.keyboard.press('Enter');await delay(500);navigationChecks.push({key:await page.locator('#next-step').getAttribute('data-key'),newWrites:writes.length-before});assert.equal(writes.length,before,'Opening a step wrote to the server');};
try{
  let owned=false;
  for(let i=0;i<80;i++){
    if(server.exitCode!==null)throw Error('Own capture server exited; do not reuse the port.');
    let pids=[];try{pids=execFileSync('/usr/sbin/lsof',['-tiTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);}catch{}
    if(pids.includes(String(server.pid))){owned=true;break;}
    if(pids.some(Boolean))throw Error('Another process owns the capture port.');
    await delay(200);
  }
  assert.ok(owned,'Own capture server did not start');
  mode=await(await fetch(base+'/api/status')).json();
  assert.equal(mode.payments.mode,'example');assert.equal(mode.ai.mode,'example');
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  context=await browser.newContext({viewport:{width:1760,height:760},deviceScaleFactor:1,recordVideo:{dir:out,size:{width:1760,height:760}}});
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==base&&!['data:','blob:','about:'].includes(url.protocol)){externalRequests.push(url.origin+url.pathname);return route.abort();}return route.continue();});
  start=performance.now();page=await context.newPage();rawVideo=page.video();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()!=='GET'&&r.url().startsWith(base+'/'))writes.push({method:r.method(),path:new URL(r.url()).pathname,at:(performance.now()-start)/1000});});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.ready==='true');
  assert.equal(await page.locator('#next-step').count(),1,'The checked family-journey feature is missing');
  const initial=await state();assert.equal(initial.progress.progressCents,6000);assert.equal(initial.goal.targetCents,30000);assert.equal(initial.contributions.length,0);
  await show('.realm-map');marker('realm-intro');await delay(8500);
  await page.locator('[data-district="castle"].realm-stop').click();await show('.realm-map');marker('locked-citadel');await delay(6500);
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  await page.locator('#tab-house').click();await show('#house-heading');
  await page.locator('#house-name').fill('House of Alder');await delay(1200);await page.locator('#save-house').click();
  await page.waitForFunction(()=>document.querySelector('#next-step').dataset.key==='make-plan');
  await show('#next-step');marker('family-journey');await delay(1800);await guide();
  await page.locator('#goal-name-input').fill('Camping trip fund');await page.locator('#goal-target').fill('300.00');await page.locator('#goal-starting').fill('60.00');
  const target=new Date();target.setUTCDate(target.getUTCDate()+56);await page.locator('#goal-date').fill(target.toISOString().slice(0,10));await page.locator('#goal-weekly').fill('30.00');
  await delay(1800);await page.locator('#ask-planner').click();await page.locator('#plan-result').waitFor({state:'visible'});
  await show('#next-step');await delay(1400);await guide();await delay(2400);await show('#accept-plan');await delay(1800);await page.locator('#accept-plan').click();
  await page.waitForFunction(()=>document.querySelector('#next-step').dataset.key==='contribute-week');await show('#next-step');await delay(1800);await guide();
  marker('example-contribution');await page.locator('#give-amount').fill('15.00');await delay(2600);await page.locator('#give-approve').check();await show('#give-projection');await delay(6000);
  await page.locator('#simulate-pay').click();await page.locator('#receipt').waitFor({state:'visible'});
  await show('.realm-map');marker('simulated-open');await delay(16500);
  let s=await state();assert.equal(s.progress.progressCents,7500);assert.equal(s.progress.simulatedContributedCents,1500);assert.equal(s.progress.contributedCents,0);assert.equal(s.contributions.length,1);assert.equal(s.contributions[0].status,'completed');assert.equal(s.contributions[0].simulated,true);
  let sc=await page.evaluate(()=>window.__ourCastle.scene());assert.equal(sc.court.capacity,6);assert.equal(sc.bridges.find(b=>b.id==='manor-bridge').raised,false);assert.ok(sc.districts.find(d=>d.id==='cottage').open);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await show('#next-step');marker('saved-record');await delay(1800);
  const before=writes.length;const recordButton=page.locator('#next-step-record button');await recordButton.focus();await page.keyboard.press('Enter');await delay(450);assert.equal(writes.length,before);await delay(6500);
  const recordId=await page.locator('#next-step-record').getAttribute('data-contribution');
  const recordVisible=await page.locator(`#ledger-contributions [data-contribution="${recordId}"]`).evaluate(el=>{const r=el.getBoundingClientRect();return document.activeElement===el&&r.top>=0&&r.bottom<=innerHeight;});
  assert.ok(recordVisible,'The saved payment record must remain fully visible after the lazy grid layout');
  await page.locator('#tab-rewards').click();const preview=page.locator('[data-reward="home:castle"] .reward-preview');await preview.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__ourCastle.scene().tier===3);await show('.realm-map');marker('castle-preview');await delay(9500);
  const exit=page.getByRole('button',{name:'Return to my estate'});await exit.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__ourCastle.scene().tier===1);
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();await show('.realm-map');marker('closing');await delay(10500);
  finalState=await state();finalScene=await page.evaluate(()=>window.__ourCastle.scene());
  assert.equal(finalState.progress.progressCents,7500);assert.equal(finalState.contributions.length,1);assert.equal(finalScene.court.capacity,6);assert.equal(finalScene.districts.filter(d=>d.open).length,2);
  await page.locator('.board-shell').screenshot({path:join(out,'forest-end.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  const allowed=/^\/api\/(setup|plans(?:\/[^/]+\/accept)?|example\/contributions)$/;
  assert.ok(writes.every(w=>allowed.test(w.path)),'Unexpected app write during example recording');
  await context.close();context=null;const raw=await rawVideo.path();
  const report={source_commit:sourceCommit,recorder_sha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),base,server_pid:server.pid,data_dir:data,raw_video:raw,viewport:{width:1760,height:760},method:'Continuous isolated headless Chromium recording; SwiftShader; scripted real app UI; example-only server; no user browser or credentials',node_wall_seconds:(performance.now()-start)/1000,phases,navigationChecks,errors,writes,externalRequests,modes:mode,finalProgress:finalState.progress,finalScene,new_paypal_calls:0,new_paid_ai_calls:0,note:'The $15 contribution is simulated. Starting $60 is self-reported. No PayPal popup, approval, capture or same-order steward check is claimed. Source times are recorder marks; edit ranges must be visually checked.'};
  writeFileSync(join(out,'recording-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,raw,source_commit:sourceCommit,phases,writes:writes.map(w=>w.path)},null,2));
}catch(error){
  writeFileSync(join(out,'capture-failure.json'),JSON.stringify({error:String(error),source_commit:sourceCommit,phases,writes,errors,externalRequests,base,server_pid:server.pid,data_dir:data},null,2)+'\n');throw error;
}finally{
  if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});server.kill('SIGTERM');serverLog.end();
}
