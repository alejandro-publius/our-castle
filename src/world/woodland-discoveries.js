import * as THREE from 'three';
import { WATERFALLS, WOODLAND_CAMP, WOODLAND_GLADE } from '../core/woodland-discoveries.js';
import { riverAt } from '../core/realm.js';

// Original miniatures in the existing woodland vocabulary. Static scenery is batched by MiniBuilder;
// one small droplet batch and one flame group use the scene's existing, pauseable ambient clock.
export function createWoodlandDiscoveries({group,builder,part,colours:C,lampColour,waterLevel,groundLevel}) {
  const stone=0x88978d,pale=0xf4e4be,water=0x2f6f9f,ripple=0x9abfc1;
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const drops=[],fallDebug=[];
  for(const f of WATERFALLS){
    const fall=new THREE.Group();fall.name=f.id;fall.position.set(f.x,0,f.z);
    if(f.axis==='z')fall.rotation.y=-Math.PI/2;group.add(fall);
    // A spring pool sits on a stepped rock ledge, falls down its exposed face, and joins the real channel below.
    for(const side of [-1,1])for(let step=0;step<3;step++){
      const y=groundLevel+f.height*(.18+step*.27);
      rock(fall,-2.6-step*.75,y,side*(f.width/2+1.15),4.2,f.height*.65,2.7,step%2?C.stone:stone);
      rock(fall,1.1+step,groundLevel+.25,side*(f.width/2+.65),2.1,.85,1.4,C.stone);
    }
    box(fall,-3.2,waterLevel+f.height-.45,0,5.6,.75,f.width+1.6,stone);
    box(fall,-3,waterLevel+f.height,0,5.1,.16,f.width,water);
    box(fall,-.44,waterLevel+f.height/2,0,.24,f.height,f.width,water);
    for(let j=0;j<5;j++)box(fall,-.23,waterLevel+f.height/2,(j-2)*f.width/5,.10,f.height,.14,ripple);
    box(fall,2.2,waterLevel+.05,0,5.1,.11,f.width,water);
    for(let j=0;j<9;j++)rock(fall,.3+(j%3)*.55,waterLevel+.16,(Math.floor(j/3)-1)*f.width*.32,.8,.18,.65,ripple);
    for(let j=0;j<16;j++)drops.push({f,offset:j/16,z:((j*7)%9/8-.5)*f.width*.85});
    const foot={x:f.x+(f.axis==='x'?2.2:0),z:f.z+(f.axis==='z'?2.2:0)};
    fallDebug.push({...f,foot,channel:riverAt(foot.x,foot.z).river,insideWater:riverAt(foot.x,foot.z).depth>0});
  }
  const droplets=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:ripple,transparent:true,opacity:.72,depthWrite:false}),drops.length);
  droplets.name='waterfall-droplets';droplets.frustumCulled=false;droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  droplets.userData.ownedGeometry=true;droplets.userData.ownedMaterial=true;group.add(droplets);
  const camp=new THREE.Group();camp.name='knights-rest';camp.position.set(WOODLAND_CAMP.x,groundLevel,WOODLAND_CAMP.z);group.add(camp);
  // Logs, fire-ring, two resting knights and a small canvas shelter, hidden in a clearing beyond the mountains.
  rock(camp,0,.03,0,7.2,.12,6.7,C.soil);
  for(let j=0;j<9;j++){const a=j*Math.PI*2/9;rock(camp,Math.cos(a)*1.1,.22,Math.sin(a)*1.1,.65,.5,.6,C.stone);}
  box(camp,0,.3,0,1.7,.28,.36,C.wood,.5);box(camp,0,.4,0,1.7,.28,.36,C.wood,-.7);
  const flame=new THREE.Group();flame.name='woodland-campfire';flame.userData.live=true;camp.add(flame);
  part(flame,'cone',0,.98,0,1.2,1.5,1.1,C.red);part(flame,'cone',.14,.86,.15,.72,1.1,.64,C.gold);part(flame,'cone',.08,.65,.25,.38,.66,.3,pale);
  for(const side of [-1,1]){
    box(camp,side*2.7,.36,.6,.8,.65,2.8,C.wood);
    const knight=new THREE.Group();knight.position.set(side*2.7,.55,.55);knight.rotation.y=-side*Math.PI/2;camp.add(knight);
    box(knight,0,.65,0,.75,1.05,.48,side===1?C.blue:C.red);
    rock(knight,0,1.5,0,.68,.72,.62,stone);box(knight,0,1.53,.33,.46,.12,.06,C.dark);box(knight,0,1.72,.32,.09,.45,.07,C.gold);
    for(const x of [-.24,.24]){box(knight,x,.18,.52,.25,.3,.95,stone);box(knight,x,.02,.9,.3,.25,.46,C.dark);box(knight,x*1.8,.66,.25,.22,.6,.25,stone,0,x);}
    part(knight,'round',-.55,.55,.4,.75,.12,.75,C.gold,0,Math.PI/2);
  }
  // A-frame shelter and a rolled pack; no imported art or texture.
  box(camp,0,.12,-4.1,4.7,.18,3.8,C.wood);
  for(const side of [-1,1])box(camp,side*1.15,1.34,-4.1,.15,3.1,3.7,C.cream,0,side*.83);
  box(camp,0,2.35,-4.1,.18,.18,4,C.wood);rock(camp,2.5,.45,-2.7,.8,.9,.65,C.blue);
  // A kettle over the fire, dry wood and a shield resting by the shelter.
  for(const x of [-1.25,1.25])box(camp,x,1.35,0,.13,2.7,.13,C.wood,0,x*.07);
  box(camp,0,2.55,0,2.8,.13,.13,C.wood);box(camp,0,1.95,0,.07,1.1,.07,C.dark);
  rock(camp,0,1.48,0,.65,.6,.65,C.dark);
  for(let k=0;k<4;k++)box(camp,3.7,.24+(k%2)*.32,-3+(k>>1)*.45,1.3,.28,.28,C.wood,.1);
  part(camp,'round',-2.9,.8,-3.2,1.1,.16,1.1,C.blue,0,1.1);
  box(camp,-2.9,.82,-3.05,.12,.75,.12,C.gold);

  const glade=new THREE.Group();glade.name='lantern-glade';glade.position.set(WOODLAND_GLADE.x,groundLevel,WOODLAND_GLADE.z);group.add(glade);
  rock(glade,0,.04,0,12,.13,11,C.grass);
  // A forgotten stone arch, ivy, a hanging lantern and an owl, ringed by mushrooms.
  for(const side of [-1,1]){
    for(let k=0;k<3;k++)rock(glade,side*2.35,.58+k*1.1,-2,1.3,1.2,1.5,k===1?stone:C.stone);
    rock(glade,side*1.45,3.8,-2,2.3,1.1,1.6,stone);
    for(let k=0;k<5;k++)rock(glade,side*(2.25+.18*Math.sin(k)),.6+k*.7,-1.18,.62,.6,.35,C.leaf);
  }
  rock(glade,0,4.1,-2,1.6,.85,1.6,C.stone);
  box(glade,0,3.2,-2,.08,1.3,.08,C.wood);
  box(glade,0,2.55,-2,.65,.75,.65,lampColour??C.gold);
  for(const x of [-.36,.36])for(const z of [-2.36,-1.64])box(glade,x,2.55,z,.1,.85,.1,C.dark);
  box(glade,0,2.1,-2,.86,.13,.86,C.dark);part(glade,'cone',0,3.13,-2,1,.45,1,C.dark);
  rock(glade,2.25,4.85,-2,.9,1.3,.8,C.wood);rock(glade,2.25,5.52,-1.9,1,.8,.75,pale);
  for(const x of [2.01,2.49])rock(glade,x,5.55,-1.52,.22,.26,.12,C.dark);
  part(glade,'cone',2.25,5.3,-1.44,.23,.28,.2,C.gold);
  for(let k=0;k<11;k++){
    const a=k*Math.PI*2/11,x=Math.cos(a)*4.8,z=1+Math.sin(a)*3.7;
    box(glade,x,.3,z,.15,.6,.15,pale);part(glade,'cone',x,.67,z,.8,.35,.8,k%3?C.red:C.gold);
    rock(glade,x+.1,.78,z+.12,.14,.1,.14,pale);
  }
  // Fallen log seat and scattered fern fronds use the same batched miniature geometry.
  box(glade,-3,.42,3,3.7,.7,.8,C.wood,-.22);
  for(let k=0;k<6;k++)part(glade,'cone',5+Math.sin(k)*.5,.4,-3+Math.cos(k)*.5,.6,.6,.3,C.leaf,k,.6);
  builder.flush();
  // Flame colours remain visible at night; their small, owned materials do not relight the whole forest.
  flame.traverse(mesh=>{if(!mesh.isMesh)return;mesh.material=new THREE.MeshBasicMaterial({color:mesh.material.color});mesh.userData.ownedMaterial=true;});
  const glow=new THREE.Mesh(new THREE.CircleGeometry(2.8,20),new THREE.MeshBasicMaterial({color:C.gold,transparent:true,opacity:.19,depthWrite:false}));
  glow.rotation.x=-Math.PI/2;glow.position.y=.11;glow.userData.ownedGeometry=true;glow.userData.ownedMaterial=true;camp.add(glow);
  let elapsed=0,previous=0;const transform=new THREE.Object3D();
  function place(){
    drops.forEach((d,i)=>{const p=(d.offset+elapsed*.43)%1,y=waterLevel+d.f.height*(1-p),x=-.1+p*.45;
      transform.position.set(d.f.x+(d.f.axis==='x'?x:-d.z),y,d.f.z+(d.f.axis==='z'?x:d.z));
      transform.rotation.set(0,0,0);transform.scale.set(.12,.32+p*.6,.12);transform.updateMatrix();droplets.setMatrixAt(i,transform.matrix);});
    droplets.instanceMatrix.needsUpdate=true;
    flame.scale.set(1+Math.sin(elapsed*3.7)*.08,1+Math.sin(elapsed*5.2)*.13,1+Math.cos(elapsed*4.3)*.07);
  }
  place();
  return {tick(seconds){elapsed+=Math.min(.25,Math.max(0,seconds-previous));previous=seconds;place();},
    debug:()=>({waterfalls:fallDebug,camp:{...WOODLAND_CAMP,knights:2,fire:true,kettle:true,flameHeight:flame.scale.y},glade:{...WOODLAND_GLADE,owl:true,mushrooms:11,lantern:true},drops:drops.length,seconds:elapsed})};
}
