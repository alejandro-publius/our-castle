// Reproducible, isolated app-demo capture. This never controls the owner's browser.
// macOS: node docs/demos/earned-realm-review/capture.mjs
// Starts its OWN example-only server on unused 3164 with a fresh database and no keys.
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
const base='http://127.0.0.1:3164', port=3164;
const out=resolve(root,'test-results','earned-realm-capture',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(out,{recursive:true});
const data=mkdtempSync(join(tmpdir(),'our-castle-earned-film-'));
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
  await context.addInitScript(() => {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C || !window.MediaRecorder) return;
    const original = C.prototype.createDynamicsCompressor;
    C.prototype.createDynamicsCompressor = function (...args) {
      const node = original.apply(this, args);
      if (!window.__finishAppAudio) {
        const sink = this.createMediaStreamDestination(); node.connect(sink);
        const chunks = [], recorder = new MediaRecorder(sink.stream, { mimeType: 'audio/webm;codecs=opus' });
        const started = performance.now();
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        window.__finishAppAudio = () => new Promise((resolve) => {
          recorder.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
            let text = ''; for (let i=0;i<bytes.length;i+=32768) text += String.fromCharCode(...bytes.subarray(i,i+32768));
            resolve({ base64: btoa(text), pageStartSeconds: started/1000, mime: recorder.mimeType });
          };
          recorder.stop();
        });
        recorder.start();
      }
      return node;
    };
  });
  start=performance.now();page=await context.newPage();rawVideo=page.video();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()!=='GET'&&r.url().startsWith(base+'/'))writes.push({method:r.method(),path:new URL(r.url()).pathname,at:(performance.now()-start)/1000});});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const clockNode=(performance.now()-start)/1000, clockPage=await page.evaluate(()=>performance.now()/1000), pageOffset=clockNode-clockPage;
  const initial=await state();assert.equal(initial.progress.progressCents,6000);assert.equal(initial.goal.targetCents,30000);assert.equal(initial.contributions.length,0);
  const hold=async(m,seconds)=>delay(Math.max(0,seconds*1000-((performance.now()-start)-m.node_seconds*1000)));
  await page.locator('#world-settings > summary').click();await page.locator('#time-mode').selectOption('day');await page.locator('#sound-toggle').click();await page.keyboard.press('Escape');
  await page.locator('#close-journal').click();await page.getByRole('button',{name:'Whole realm',exact:true}).click();
  let m=marker('realm-intro');await hold(m,8.7);
  await page.locator('#journal-toggle').click();await page.locator('#tab-house').click();m=marker('family-goal');
  await page.locator('#house-name').fill('House of Alder');await delay(700);await page.locator('#save-house').click();
  await page.waitForFunction(()=>window.__ourCastle.state.household.setupComplete);await page.locator('#tab-plan').click();
  await page.locator('#goal-name-input').fill('Camping trip fund');await page.locator('#goal-target').fill('300.00');await page.locator('#goal-starting').fill('60.00');
  const target=new Date();target.setUTCDate(target.getUTCDate()+56);await page.locator('#goal-date').fill(target.toISOString().slice(0,10));await page.locator('#goal-weekly').fill('30.00');
  await delay(600);await page.locator('#ask-planner').click();await page.locator('#plan-result').waitFor({state:'visible'});await delay(1400);
  await show('#accept-plan');await page.locator('#accept-plan').click();await page.waitForFunction(()=>Boolean(window.__ourCastle.state.acceptedPlanId));await hold(m,14.8);
  await page.locator('#tab-give').click();m=marker('example-contribution');
  await page.locator('#give-amount').fill('15.00');await delay(1700);await page.locator('#give-approve').check();await hold(m,8.6);
  await page.evaluate(()=>{window.__filmEvents=[];for(const type of ['scene:bridge:start','scene:bridge:open','scene:hop','scene:rise','scene:arrival'])window.__ourCastle.bus.on(type,detail=>window.__filmEvents.push({type,detail,at:performance.now()/1000}));});
  m=marker('simulated-open');await page.getByRole('button',{name:'Simulate approved payment',exact:true}).click();
  await page.locator('#deed-dialog[open]').waitFor();await page.locator('#deed-dialog').screenshot({path:join(out,'unlock-card.png')});await hold(m,8.4);await page.locator('#deed-close').click();await hold(m,10.8);
  const paid=await state();assert.equal(paid.progress.progressCents,7500);assert.equal(paid.progress.contributedCents,0);assert.equal(paid.progress.simulatedContributedCents,1500);assert.equal(paid.contributions.length,1);assert.equal(paid.contributions[0].simulated,true);
  await page.locator('#tab-ledger').click();await page.locator('#ledger-goal[data-grid="ag-grid"]').waitFor();m=marker('saved-record');
  await show('#ledger-contributions');await page.locator('#ledger-contributions').screenshot({path:join(out,'ledger-record.png')});await delay(2500);
  await show('#ledger-search');await page.locator('#ledger-search').fill(paid.contributions[0].captures[0].captureId);await delay(2300);await page.locator('#ledger-search').fill('');
  const entry=paid.ledger.goalEntries.find(e=>e.kind==='simulated_contribution');
  await page.locator(`.ag-row[row-id="${entry.id}"] [col-id="entry"]`).click();await show('#ledger-contributions');await delay(2800);
  await page.getByRole('button',{name:'Visit Manor Gardens',exact:true}).click();await hold(m,18.8);
  await page.locator('#district-menu > summary').click();await page.locator('#realm-districts [data-district="castle"]').click();
  const box=await page.locator('.realm-map').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.wheel(0,-570);await delay(300);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(x+box.width*.04,y-box.height*.35,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');await page.mouse.move(x,y);await page.mouse.wheel(0,-1500);
  m=marker('citadel');await delay(3500);await page.locator('#world-settings > summary').click();await page.locator('#time-mode').selectOption('night');await page.keyboard.press('Escape');await delay(1200);await page.locator('.realm-map').screenshot({path:join(out,'citadel-night.png')});await hold(m,9.2);
  await page.getByRole('button',{name:'Whole realm',exact:true}).click();m=marker('closing');await hold(m,6.8);
  finalState=await state();finalScene=await page.evaluate(()=>window.__ourCastle.scene());
  assert.equal(finalState.progress.progressCents,7500);assert.equal(finalState.contributions.length,1);assert.equal(finalScene.court.capacity,6);assert.equal(finalScene.districts.filter(d=>d.open).length,2);
  await page.locator('.board-shell').screenshot({path:join(out,'forest-end.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  const allowed=/^\/api\/(setup|plans(?:\/[^/]+\/accept)?|example\/contributions)$/;
  assert.ok(writes.every(w=>allowed.test(w.path)),'Unexpected app write during example recording');
  const capturedAudio=await page.evaluate(()=>window.__finishAppAudio?.());assert.ok(capturedAudio,'App audio capture unavailable');
  const audio=join(out,'app-audio.webm');writeFileSync(audio,Buffer.from(capturedAudio.base64,'base64'));
  const audioReport={file:audio,sha256:createHash('sha256').update(readFileSync(audio)).digest('hex'),mime:capturedAudio.mime,start_node_seconds:pageOffset+capturedAudio.pageStartSeconds,method:'Actual app Web Audio graph captured with MediaRecorder; no microphone or system audio'};
  await context.close();context=null;const raw=await rawVideo.path();
  const report={source_commit:sourceCommit,recorder_sha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),base,server_pid:server.pid,data_dir:data,audio:audioReport,raw_video:raw,raw_sha256:createHash('sha256').update(readFileSync(raw)).digest('hex'),viewport:{width:1760,height:760},method:'Continuous isolated headless Chromium recording; current compact game UI and record-to-realm integration; SwiftShader; example-only server; no user browser or credentials',node_wall_seconds:(performance.now()-start)/1000,phases,navigationChecks,errors,writes,externalRequests,modes:mode,finalProgress:finalState.progress,finalScene,new_paypal_calls:0,new_paid_ai_calls:0,note:'The $15 contribution is simulated. Starting $60 is self-reported. No PayPal popup, approval, capture or same-order steward check is claimed. Source times are recorder marks; edit ranges must be visually checked.'};
  writeFileSync(join(out,'recording-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,raw,source_commit:sourceCommit,phases,writes:writes.map(w=>w.path)},null,2));
}catch(error){
  writeFileSync(join(out,'capture-failure.json'),JSON.stringify({error:String(error),source_commit:sourceCommit,phases,writes,errors,externalRequests,base,server_pid:server.pid,data_dir:data},null,2)+'\n');throw error;
}finally{
  if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});server.kill('SIGTERM');serverLog.end();
}
