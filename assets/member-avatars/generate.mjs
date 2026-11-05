// Original portraits from the same geometry as each household traveler.
// node assets/member-avatars/generate.mjs -- no credentials, app data or provider calls.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { FAMILY_AVATARS } from '../../src/core/avatars.js';
const root=fileURLToPath(new URL('../../',import.meta.url)), out=join(root,'assets/member-avatars');
const fixture='<!doctype html><html lang="en"><meta charset="utf-8"><title>Member portrait rendering</title><link rel="icon" href="data:,"><style>html,body{margin:0;overflow:hidden}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><script type="module" src="/assets/member-avatars/portrait-scene.js"></script></html>';
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/__member_art'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root)||!['/src/','/assets/','/vendor/'].some(p=>path.startsWith(p))){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const errors=[],external=[],writes=[],images=[];let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:192,height:192},deviceScaleFactor:1});
 await context.route('**/*',route=>{
  if(route.request().method()!=='GET'){writes.push(route.request().url());return route.abort();}
  if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__member_art');await page.waitForFunction(()=>window.portraitsReady);
 await mkdir(out,{recursive:true});
 for(const avatar of FAMILY_AVATARS){
  const raw=await page.evaluate(id=>window.renderMemberPortrait(id),avatar.id);
  const bytes=Buffer.from(raw,'base64');await writeFile(join(out,avatar.id+'.png'),bytes);
  images.push({id:avatar.id,file:avatar.id+'.png',width:96,height:96,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
 const sourceFiles=[];
 for(const file of ['src/core/avatars.js','src/world/member-models.js','assets/member-avatars/portrait-scene.js','assets/member-avatars/generate.mjs','src/graphics/pixel-renderer.js','src/graphics/palette.js'])
  sourceFiles.push({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')});
 await writeFile(join(out,'provenance.json'),JSON.stringify({
  author:'Original Our Castle code-rendered character art',license:'Repository LICENSE; retain bundled renderer/palette notices',
  method:'Same original member-models geometry used by the map; original 90-colour PixelRenderer; orthographic 192x192 at pixel size 2, nearest-neighbour reduction to 96x96.',
  sourceFiles,images,verification:{pageErrors:errors,externalRequests:external,serverWrites:writes.length,paymentCalls:0,aiCalls:0,ownerBrowserUsed:false}
 },null,2)+'\n');
 console.log('Rendered '+images.length+' original member portraits; no external requests or app writes.');
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
