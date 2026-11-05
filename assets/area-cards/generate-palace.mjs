// Original Our Castle district portraits, rendered from its own miniature world.
// Run from the checkout: node assets/area-cards/generate-palace.mjs
// Own ephemeral example server/context only; no .env, credentials, ledger writes or owner browser.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)), assets=resolve(root,'assets/area-cards');
const port=3166, origin='http://127.0.0.1:'+port, delay=ms=>new Promise(r=>setTimeout(r,ms));
const out=resolve(root,'test-results/rosewind-card-art'); mkdirSync(out,{recursive:true}); mkdirSync(assets,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD');
await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
const server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,OUR_CASTLE_ENV_FILE:'none',OUR_CASTLE_DATA_DIR:mkdtempSync(join(tmpdir(),'castle-card-art-')),PORT:String(port),HOST:'127.0.0.1',PAYPAL_CLIENT_ID:'',PAYPAL_CLIENT_SECRET:'',PAYPAL_WEBHOOK_ID:'',AI_API_KEY:'',ANTHROPIC_API_KEY:''},stdio:'ignore'});
let browser, sceneInfo; const errors=[],requests=[],images=[];
const districts=['palace'];
try{
 let started=false;
 for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Own art server exited');try{const r=await fetch(origin+'/api/status');if(r.ok){const modes=await r.json();assert.equal(modes.payments.mode,'example');assert.equal(modes.ai.mode,'example');started=true;break;}}catch(e){}await delay(200);}
 assert.ok(started);
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:640,height:352},deviceScaleFactor:1,reducedMotion:'reduce'});
 await context.route('**/*', async route=>{
  if(route.request().method()!=='GET'){requests.push(route.request().method()+' '+route.request().url());return route.abort();}
  const u=new URL(route.request().url()); if(u.origin!==origin){requests.push(u.origin+u.pathname);return route.abort();}
  if(u.pathname==='/__district_art')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><meta charset="utf-8"><title>Our Castle district portrait fixture</title><link rel="icon" href="data:,"><style>html,body{margin:0;overflow:hidden}#portrait{width:640px;height:352px}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><div id="portrait"></div><script type="module">import{createBoardScene}from'/src/world/board-scene.js';window.portraitScene=createBoardScene(document.querySelector('#portrait'),{reducedMotion:true,insets:()=>({top:0.025,bottom:0.025})});await window.portraitScene.update({builtTier:3,estateLevel:3,gardens:0,position:20,crest:{field:'cobalt',charge:'stag'},playMode:'family'},{animate:false});window.artReady=true;</script></html>`});
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__district_art');await page.waitForFunction(()=>window.artReady===true);
 await page.evaluate(()=>window.portraitScene.setAtmosphere({period:'day',weather:'clear'}));
 for(const id of districts){
  await page.evaluate(id=>{window.portraitScene.focusDistrict(id);window.portraitScene.adjustView('in');window.portraitScene.adjustView('in');},id);await delay(220);
  const raw=join(out,id+'-640.png');await page.screenshot({path:raw});
  const data=await page.evaluate(()=>{const src=document.querySelector('#portrait canvas'),c=document.createElement('canvas');c.width=320;c.height=176;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(src,0,0,320,176);return c.toDataURL('image/png').split(',')[1];});
  const buffer=Buffer.from(data,'base64');writeFileSync(join(assets,id+'.png'),buffer);images.push({id,file:id+'.png',width:320,height:176,sha256:createHash('sha256').update(buffer).digest('hex')});
  console.log('Rendered original district portrait:',id,buffer.length,'bytes');
 }
 sceneInfo=await page.evaluate(()=>window.portraitScene.debug());
 await page.evaluate(()=>window.portraitScene.dispose());
 assert.equal(errors.length,0);assert.equal(requests.length,0);
 const paths=['src/world/princess-palace.js','src/core/realm.js','src/graphics/cloud-compositor.js','src/graphics/cloud-surround.js','src/world/board-scene.js','src/world/realm-models.js','src/world/estate-models.js','src/graphics/pixel-renderer.js'];
 const report={createdAt:new Date().toISOString(),sourceCommit,sourceFiles:paths.map(file=>({file,sha256:createHash('sha256').update(readFileSync(join(root,file))).digest('hex')})),author:'Original Our Castle code-rendered art; no external image or generated model',license:'Same as repository LICENSE; preserve bundled source notices',method:'Actual existing 90-colour miniature scene, district-focused orthographic camera, pixel size 2 at 640x352; exact nearest-neighbour 2:1 reduction to 320x176. Rosewind Palace in Day/Clear at zoom 1.44; illustration does not grant access.',previewState:{builtTier:3,estateLevel:3,gardens:0,crest:'cobalt/stag'},images,verification:{pageErrors:errors,externalRequests:requests,paymentCalls:0,aiCalls:0,serverWrites:0,ownerBrowserUsed:false,originalSceneColours:true,allDistricts:sceneInfo.districts.map(d=>d.id)}};
 writeFileSync(join(assets,'palace-provenance.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(join(out,'render-report.json'),JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();server.kill('SIGTERM');}