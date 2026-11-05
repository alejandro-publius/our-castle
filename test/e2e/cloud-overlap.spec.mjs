import { test, expect } from '@playwright/test';

test('overlapping cloud bodies fill the surrounding field instead of exposing broad backdrop gaps', async ({ page, request, baseURL }) => {
  const modes=await(await request.get('/api/status')).json();
  expect(modes.payments.mode).toBe('example');expect(modes.ai.mode).toBe('example');
  const issues=[];page.on('pageerror',e=>issues.push(e.message));
  const code=[
    "import * as THREE from 'three';",
    "import { CLOUD_SURROUND_GLSL } from '/src/graphics/cloud-surround.js';",
    "const size=384,renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(size,size);renderer.setPixelRatio(1);document.body.append(renderer.domElement);",
    "const uniforms={cloudLight:{value:new THREE.Vector3(1,1,1)},cloudShade:{value:new THREE.Vector3(.76,.83,.83)},cloudBase:{value:new THREE.Vector3(.88,.92,.85)},probeOffset:{value:new THREE.Vector2()}};",
    "const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';",
    "const fragment='precision highp float;varying vec2 vUv;uniform vec2 probeOffset;'+CLOUD_SURROUND_GLSL+'void main(){float cover=cloudBank((vUv-.5)*vec2(40.0,28.0)+probeOffset).a;gl_FragColor=vec4(vec3(cover),1.0);}';",
    "const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms}),scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));",
    "window.probe=(x,y)=>{uniforms.probeOffset.value.set(x,y);renderer.render(scene,new THREE.Camera());const gl=renderer.getContext(),p=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,p);let holes=0;for(let i=0;i<p.length;i+=4)if(p[i]<240)holes++;return holes/(size*size);};",
    "window.probeReady=true;",
  ].join('\n');
  await page.route('**/*',route=>{
    const r=route.request(),url=new URL(r.url());
    if(r.method()!=='GET'||url.origin!==new URL(baseURL).origin){issues.push(r.method()+' '+r.url());return route.abort();}
    if(url.pathname==='/__cloud_coverage')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><title>Cloud coverage fixture</title><link rel="icon" href="data:,"><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><script type="module">'+code+'</script></html>'});
    return route.continue();
  });
  await page.goto('/__cloud_coverage');await page.waitForFunction(()=>window.probeReady);
  const holes=await page.evaluate(()=>[[0,0],[17.4,-9.2],[-22.8,13.6]].map(([x,y])=>window.probe(x,y)));
  for(const fraction of holes)expect(fraction).toBeLessThan(.0025);
  expect(issues).toEqual([]);
});
