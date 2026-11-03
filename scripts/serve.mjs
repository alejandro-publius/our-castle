import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ttf':'font/ttf','.glb':'model/gltf-binary','.json':'application/json'};
const port=Number(process.env.PORT||3010);
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const relative=decodeURIComponent(url.pathname==='/'?'/art-preview.html':url.pathname).slice(1);
    const allowed=['art-preview.html','art-preview.css'].includes(relative)||['src/','assets/','vendor/','references/'].some(prefix=>relative.startsWith(prefix));
    const file=path.resolve(root,relative);
    if(!allowed||relative.split('/').some(part=>part.startsWith('.'))||!file.startsWith(root)||!(await stat(file)).isFile())throw Error('Not found');
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(await readFile(file));
  }catch{res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Our House art preview: http://localhost:${port}/art-preview.html`));
