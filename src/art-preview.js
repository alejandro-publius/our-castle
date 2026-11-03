import * as THREE from 'three';
import { PixelRenderer } from './graphics/pixel-renderer.js';

// Original code-native woodland vocabulary, using the existing pixel pipeline.
const world=document.querySelector('#world');
const colours={grass:0x527557,leaf:0x86a56c,pine:0x425b47,dark:0x1d3030,soil:0x65402e,wood:0x9e714b,stone:0xacb7a2,cream:0xeddcb4,gold:0xddba79,red:0x9d3e46,blue:0x355f93,water:0x6ca8b1};
const tierNames=['The first cottage','A place to grow','A house with its own walls','A castle built together'];
let renderer,pipeline,scene,camera,builder,castle,observer;
let tier=0;

class MiniBuilder{
  constructor(){
    this.geo={box:new THREE.BoxGeometry(1,1,1),round:new THREE.CylinderGeometry(.5,.5,1,10),cone:new THREE.ConeGeometry(.5,1,6),rock:new THREE.IcosahedronGeometry(.5,0)};
    this.materials=new Map();this.groups=new Map();
  }
  part(group,kind,x,y,z,w,h,d,colour,ry=0,rz=0){
    let buckets=this.groups.get(group);if(!buckets)this.groups.set(group,buckets=new Map());
    const key=kind+':'+colour;if(!buckets.has(key))buckets.set(key,{kind,colour,parts:[]});
    buckets.get(key).parts.push([x,y,z,w,h,d,ry,rz]);
  }
  flush(){
    const transform=new THREE.Object3D();
    for(const [group,buckets]of this.groups)for(const {kind,colour,parts}of buckets.values()){
      if(!this.materials.has(colour))this.materials.set(colour,new THREE.MeshStandardMaterial({color:colour,roughness:.87,flatShading:true}));
      const mesh=new THREE.InstancedMesh(this.geo[kind],this.materials.get(colour),parts.length);
      parts.forEach(([x,y,z,w,h,d,ry,rz],i)=>{transform.position.set(x,y,z);transform.scale.set(w,h,d);transform.rotation.set(0,ry,rz);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix)});
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
    }
    this.groups.clear();
  }
  dispose(){Object.values(this.geo).forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose())}
}
const part=(...args)=>builder.part(...args);
function tree(group,x,z,size,pine=false){
  part(group,'round',x,.7*size,z,.3*size,1.4*size,.3*size,colours.soil);
  for(let k=0;k<3;k++)part(group,pine?'cone':'rock',x+(pine?0:Math.sin(k*3)*.35*size),(1.6+k*.42)*size,z+(pine?0:Math.cos(k*3)*.25*size),(pine?1.7-k*.25:1.8)*size,1.5*size,(pine?1.7-k*.25:1.8)*size,k%2?colours.leaf:colours.pine);
}
function deer(group,x,z,angle=0){
  const d=new THREE.Group();d.position.set(x,.16,z);d.rotation.y=angle;group.add(d);
  part(d,'box',0,.68,0,.9,.48,.36,colours.wood);part(d,'box',.43,1.0,0,.25,.58,.26,colours.wood);part(d,'box',.56,1.23,0,.38,.26,.26,colours.wood);
  for(const x of [-.29,.29])for(const z of [-.12,.12])part(d,'box',x,.28,z,.08,.55,.08,colours.soil);
  for(const z of [-.1,.1]){part(d,'box',.47,1.5,z,.04,.4,.04,colours.cream,0,-.2);part(d,'box',.55,1.6,z,.17,.04,.04,colours.cream,0,.5)}
  part(d,'box',.71,1.25,.14,.045,.045,.025,colours.dark);
}
function tower(group,x,z,height){
  part(group,'round',x,height/2+.16,z,1.25,height,1.25,colours.stone);
  part(group,'round',x,height+.15,z,1.4,.3,1.4,colours.cream);
  for(let k=0;k<6;k++){const a=k*Math.PI/3;part(group,'box',x+Math.cos(a)*.55,height+.43,z+Math.sin(a)*.55,.3,.35,.3,colours.cream,a)}
  part(group,'box',x,height*.65,z+.62,.22,.45,.05,colours.dark);
  part(group,'round',x,height+1,z,.055,1.2,.055,colours.gold);part(group,'box',x+.32,height+1.3,z,.6,.35,.06,colours.red);
}
function buildCastle(){
  castle.children.forEach(child=>child.dispose?.());
  castle.clear();
  const w=tier===0?3.0:4.8,h=tier===0?1.65:2.55;
  part(castle,'box',0,.14,0,6.8,.18,5.0,colours.cream);
  part(castle,'box',0,h/2+.25,0,w,h,2.6,colours.stone);
  part(castle,'box',-.05,.9,1.32,.68,1.45,.08,colours.soil);
  part(castle,'box',.12,.93,1.38,.04,.06,.04,colours.gold);
  for(const x of [-.96,.96]){part(castle,'box',x,1.42,1.34,.47,.6,.08,colours.dark);part(castle,'box',x,1.42,1.4,.05,.6,.04,colours.gold)}
  if(tier<2){
    // A faceted native roof keeps a readable overhang without sprite textures.
    const roof=new THREE.Mesh(new THREE.ConeGeometry(1,1,4),new THREE.MeshStandardMaterial({color:colours.red,roughness:.9,flatShading:true}));
    roof.position.set(0,h+.6,0);roof.rotation.y=Math.PI/4;roof.scale.set(w*.85,1.4,2.3);castle.add(roof);
    roof.userData.ownedRoof=true;
    part(castle,'box',w*.28,h+1.2,-.4,.42,1.5,.42,colours.stone);
  }else{
    part(castle,'box',0,h+.35,0,w+.2,.3,2.9,colours.cream);
    for(const x of [-2,-1,0,1,2])part(castle,'box',x,h+.65,1.35,.45,.38,.3,colours.cream);
    tower(castle,-2.65,-1.5,tier===3?4.5:3.1);tower(castle,2.65,-1.5,tier===3?4.5:3.1);
    if(tier===3){tower(castle,-2.65,1.65,3.5);tower(castle,2.65,1.65,3.5);part(castle,'box',0,1.05,2.12,4.2,1.7,.35,colours.stone);part(castle,'box',0,.9,2.32,.95,1.4,.08,colours.soil)}
  }
  if(tier>0){part(castle,'box',-2.0,.3,2.1,.9,.3,.9,colours.soil);for(const x of [-2.25,-1.8])part(castle,'rock',x,.7,2.1,.45,.6,.45,colours.leaf)}
  builder.flush();
}
function buildLandscape(){
  const land=new THREE.Group();scene.add(land);
  part(land,'box',0,-.65,0,24,1.4,18,colours.soil);part(land,'box',0,.08,0,24.1,.18,18.1,colours.grass);
  for(let i=0;i<20;i++){
    const side=Math.floor(i/5),t=(i%5)/5;
    const [x,z]=side===0?[-8+16*t,-5.3]:side===1?[8,-5.3+10.6*t]:side===2?[8-16*t,5.3]:[-8,5.3-10.6*t];
    part(land,'box',x,.23,z,side%2?1.7:2.5,.16,side%2?1.5:1.65,i%5===0?colours.gold:i%2?colours.cream:colours.stone);
    if(i%5===0){part(land,'round',x,.68,z,.06,.8,.06,colours.gold);part(land,'box',x+.2,.9,z,.4,.25,.06,colours.blue)}
  }
  for(let i=0;i<26;i++){
    const angle=i*Math.PI*2/26,x=Math.cos(angle)*10.5,z=Math.sin(angle)*7.7;
    if(z>5.9&&Math.abs(x)<4.5)continue;
    tree(land,x,z,.7+(i%4)*.12,i%3===0);
  }
  part(land,'round',-4.8,.2,-2.6,3.1,.09,2.1,colours.water);
  for(let i=0;i<5;i++)part(land,'rock',-6.0+i*.62,.25,-3.4,.5,.32,.45,colours.stone);
  deer(land,-5.0,2.7,-.4);deer(land,5.5,-2.6,2.6);
  for(let i=0;i<22;i++){
    const x=Math.sin(i*2.17)*5.4,z=Math.cos(i*3.13)*3.4;if(Math.abs(x)<3.7&&Math.abs(z)<2.8)continue;
    part(land,'round',x,.35,z,.055,.4,.055,colours.pine);part(land,'rock',x,.59,z,.23,.23,.23,i%2?colours.gold:colours.red);
  }
  for(const sign of [-1,1])for(let i=0;i<9;i++)part(land,'box',sign*11.95,-.25,-7.4+i*1.8,.2,.4,1.2,i%2?colours.stone:colours.soil);
  builder.flush();
  castle=new THREE.Group();castle.position.z=.15;scene.add(castle);buildCastle();
}
function draw(){if(renderer&&pipeline)pipeline.render(scene,camera)}
function resize(){
  const width=world.clientWidth,height=world.clientHeight,aspect=width/height,viewHeight=Math.max(24,34/aspect);
  camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);pipeline.setSize(width,height);draw();
}
function disposeRoofs(){castle.traverse(part=>{if(part.userData.ownedRoof){part.geometry.dispose();part.material.dispose()}})}
try{
  renderer=new THREE.WebGLRenderer({antialias:false,alpha:false});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  renderer.domElement.setAttribute('aria-label','Original 3D woodland board with deer, trees and a growing castle');renderer.domElement.dataset.ready='true';world.append(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0x112830);scene.add(new THREE.HemisphereLight(0xeaf6ff,0x65714f,2.7));
  const sunlight=new THREE.DirectionalLight(0xffe9bf,3.4);sunlight.position.set(-12,25,17);scene.add(sunlight);
  camera=new THREE.OrthographicCamera(-18,18,12,-12,.1,120);camera.position.set(29,30,36);camera.lookAt(0,.4,0);
  builder=new MiniBuilder();pipeline=new PixelRenderer(renderer);pipeline.configure({pixelSize:2,pixelMode:true,outlines:true,dither:true,exposure:1.05});
  buildLandscape();observer=new ResizeObserver(resize);observer.observe(world);resize();world.dataset.tier='0';world.setAttribute('aria-busy','false');
}catch(error){
  world.hidden=true;document.querySelector('#fallback').hidden=false;world.setAttribute('aria-busy','false');document.querySelectorAll('button').forEach(button=>button.disabled=true);
  document.querySelector('#status').textContent='Art preview only. 3D is unavailable; the bundled reference images remain available.';
}
document.querySelectorAll('[data-tier]').forEach(button=>button.addEventListener('click',()=>{
  tier=Number(button.dataset.tier);disposeRoofs();buildCastle();world.dataset.tier=String(tier);document.querySelector('#tier-name').textContent=tierNames[tier];
  document.querySelectorAll('[data-tier]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelector('#status').textContent=`${tierNames[tier]} · art preview only; no payment or earned reward.`;draw();
}));
document.querySelector('#pixel').addEventListener('click',event=>{
  const pixel=event.currentTarget.getAttribute('aria-pressed')!=='true';pipeline.configure({pixelMode:pixel});event.currentTarget.setAttribute('aria-pressed',String(pixel));event.currentTarget.textContent=pixel?'Pixel art':'Raw 3D';draw();
});
window.addEventListener('pagehide',()=>{observer?.disconnect();if(castle)disposeRoofs();builder?.dispose();pipeline?.dispose();renderer?.dispose()},{once:true});
