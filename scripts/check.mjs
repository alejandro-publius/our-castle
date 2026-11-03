import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PALETTE } from '../src/graphics/palette.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'assets/manifest.json'),'utf8'));
for(const entry of manifest.files){
  const data=await readFile(path.join(root,entry.path));
  if(data.length!==entry.bytes||createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error(`Asset integrity failed: ${entry.path}`);
}
if(PALETTE.length!==90||new Set(PALETTE.map(c=>c.join(','))).size!==90)throw Error('Expected the original 90-color palette');
async function checkJS(directory){
  for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){
    const relative=path.join(directory,entry.name);
    if(entry.isDirectory())await checkJS(relative);
    else if(/\.(?:mjs|js)$/.test(entry.name)){
      const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
      if(result.status!==0)throw Error(result.stderr);
    }
  }
}
await checkJS('src');await checkJS('scripts');
console.log(`Verified ${manifest.files.length} copied art/runtime files, the original 90-color palette and starter JavaScript syntax.`);
