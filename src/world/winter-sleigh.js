import * as THREE from 'three';

// Winter scenery shown only while the Weather setting is Snow: a sleigh circling above the realm and a decorated
// tree with a snowman in one outer meadow. Cosmetic only: never a district, reward, payment or ledger state.
const WHITE=0xffffff,TREE_SITE=Object.freeze({x:-60,z:80});
const FLIGHT=Object.freeze({x:32,z:0,rx:105,rz:52,height:30,speed:.1});
// The flying team's own colours: a red driver in a green sleigh, so he stands out against it, behind brown reindeer.
const SANTA=0xb8323d,SLEIGH=0x3d7a56,DEER=0x9a6646,HOOF=0x6b4630,NOSE=0xd22f3b;
// How strongly the team glows in its own colours. Moonlight alone turns it near-black, so the glow is strongest at night.
const GLOW=Object.freeze({day:.1,afternoon:.22,night:.55});
export function createWinterSleigh({group,builder,colours:C,groundLevel=0}) {
  const root=new THREE.Group();root.name='winter-scenery';root.visible=false;group.add(root);
  const part=(...a)=>builder.part(...a);
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const gift=(g,x,y,z,s,c,ry=0)=>{box(g,x,y,z,s,s,s,c,ry);box(g,x,y,z,s*1.04,s*1.04,s*.2,C.gold,ry);box(g,x,y,z,s*.2,s*1.04,s*1.04,C.gold,ry);};

  // The sleigh faces +x. Runners, body, driver, then the sack: taller than the sleigh back, with gifts showing at its mouth.
  const sleigh=new THREE.Group();sleigh.scale.setScalar(3.5);root.add(sleigh);
  for(const z of [-.8,.8]) {
    box(sleigh,0,.1,z,4.6,.14,.16,C.gold);box(sleigh,2.45,.42,z,.14,.8,.16,C.gold,0,-.6);
    for(const x of [-1.3,1.3])box(sleigh,x,.32,z,.12,.4,.12,C.gold);
    box(sleigh,0,1.38,z*1.08,3.6,.12,.06,C.gold);
    box(sleigh,5.9,1.6,z*.95,8.6,.05,.05,C.soil);
  }
  box(sleigh,0,.9,0,3.6,.9,1.7,SLEIGH);box(sleigh,1.75,1.35,0,.4,1.3,1.7,SLEIGH);box(sleigh,-1.75,1.6,0,.4,1.8,1.7,SLEIGH);
  // The driver: red coat and hat, white trim and beard, dark belt and mittens.
  rock(sleigh,.6,1.95,0,1.2,1.3,1.2,SANTA);box(sleigh,.6,1.6,0,1.1,.16,1.1,C.dark);box(sleigh,1.12,1.6,0,.1,.22,.3,C.gold);
  for(const z of [-.55,.55]){box(sleigh,1.15,2.05,z,.9,.26,.26,SANTA,0,-.3);rock(sleigh,1.6,1.9,z,.3,.3,.3,C.dark);}
  rock(sleigh,.7,2.75,0,.68,.68,.68,C.skin);rock(sleigh,.96,2.52,0,.5,.6,.62,WHITE);
  part(sleigh,'round',.66,3.04,0,.82,.18,.82,WHITE);part(sleigh,'cone',.56,3.4,0,.72,.8,.72,SANTA,0,.35);rock(sleigh,.3,3.72,0,.26,.26,.26,WHITE);
  rock(sleigh,-.75,2.2,0,2.3,2.7,2,C.wood);rock(sleigh,-.75,3.3,0,1.7,.7,1.5,C.soil);
  gift(sleigh,-1.05,3.62,-.3,.7,C.blue,.3);gift(sleigh,-.4,3.6,.32,.6,SANTA,-.4);gift(sleigh,-.95,3.5,.5,.5,C.cream,.8);
  // Two harnessed pairs and a lead: brown coats, a slim gold collar and bell each, and the lead's red nose.
  const deer=(x,z,lead=false)=>{
    rock(sleigh,x,1.15,z,1.7,.8,.7,DEER);box(sleigh,x+.42,1.22,z,.1,.86,.76,C.gold);rock(sleigh,x+.42,.72,z,.2,.2,.2,C.gold);
    for(const [dx,lean] of [[-.55,.45],[.55,-.45]])for(const side of [-.2,.2])box(sleigh,x+dx,.5,z+side,.14,.95,.14,HOOF,0,lean);
    box(sleigh,x+.8,1.65,z,.3,.9,.34,DEER,0,-.5);rock(sleigh,x+1.15,2.08,z,.62,.45,.42,DEER);
    if(lead)rock(sleigh,x+1.52,2.03,z,.46,.46,.46,NOSE);else rock(sleigh,x+1.47,2.03,z,.2,.2,.2,C.dark);
    rock(sleigh,x-.85,1.3,z,.25,.25,.25,C.cream);
    for(const side of [-1,1]){box(sleigh,x+1.02,2.55,z+side*.17,.08,.6,.08,C.cream,0,side*.25);box(sleigh,x+.9,2.72,z+side*.2,.3,.08,.08,C.cream);}
  };
  for(const x of [4.6,7.3])for(const z of [-.75,.75])deer(x,z);
  deer(10,0,true);

  // The meadow: a decorated tree with a star and gifts beneath, and a snowman in a scarf.
  const yard=new THREE.Group();yard.position.set(TREE_SITE.x,groundLevel,TREE_SITE.z);yard.scale.setScalar(2.4);root.add(yard);
  part(yard,'round',0,.5,0,.5,1,.5,C.soil);
  for(let k=0;k<4;k++)part(yard,'cone',0,1.5+k*1.05,0,3.6-k*.8,1.6,3.6-k*.8,C.pine);
  rock(yard,0,5.7,0,.5,.5,.5,C.gold);
  for(let i=0;i<9;i++){const a=i*2.4,r=1.45-(i%3)*.38;rock(yard,Math.cos(a)*r,1.3+(i%3)*1.05,Math.sin(a)*r,.26,.26,.26,[C.red,C.gold,C.blue][i%3]);}
  gift(yard,1.5,.35,1.3,.7,C.red,.3);gift(yard,.4,.3,1.9,.6,C.blue,-.2);gift(yard,-1.3,.25,1.5,.5,C.gold,.6);
  rock(yard,-3.4,.7,.6,1.5,1.4,1.5,WHITE);rock(yard,-3.4,1.75,.6,1.1,1,1.1,WHITE);rock(yard,-3.4,2.55,.6,.75,.75,.75,WHITE);
  box(yard,-3.4,2.2,.6,.95,.16,.95,C.red);part(yard,'round',-3.4,3.1,.6,.6,.5,.6,C.dark);part(yard,'round',-3.4,2.88,.6,.85,.06,.85,C.dark);
  part(yard,'cone',-3.4,2.55,1.05,.14,.4,.14,C.gold,0,0);
  builder.flush();

  // The team carries its own light. Its meshes get their own copies of the shared materials, each glowing in its own
  // colour, so the shared scenery materials are untouched. The lead's nose always glows.
  const own=new Map();
  sleigh.traverse((mesh)=>{
    if(!mesh.isInstancedMesh)return;
    if(!own.has(mesh.material)){const copy=mesh.material.clone();copy.emissive.copy(copy.color);own.set(mesh.material,copy);}
    mesh.material=own.get(mesh.material);mesh.userData.ownedMaterial=true;
  });
  const nose=own.get(builder.material(NOSE));
  let glow=GLOW.day;
  function light(period) {
    glow=GLOW[period]??GLOW.day;
    for(const material of own.values())material.emissiveIntensity=material===nose?.4+glow*.9:glow;
  }
  light('day');

  // The flight is an ellipse above the built interior, clear of the mountain rim; reduced motion leaves it at its start.
  function tick(seconds) {
    const a=seconds*FLIGHT.speed,vx=-FLIGHT.rx*Math.sin(a),vz=FLIGHT.rz*Math.cos(a);
    sleigh.position.set(FLIGHT.x+FLIGHT.rx*Math.cos(a),groundLevel+FLIGHT.height+Math.sin(seconds*1.3)*.8,FLIGHT.z+FLIGHT.rz*Math.sin(a));
    sleigh.rotation.y=Math.atan2(-vz,vx);
  }
  tick(0);
  return {root,light,tick:(seconds)=>{if(root.visible)tick(seconds);},debug:()=>({visible:root.visible,reindeer:5,glow,x:sleigh.position.x,z:sleigh.position.z})};
}
