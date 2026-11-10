import * as THREE from 'three';
import { WAYSIDE_SITES } from '../core/woodland-discoveries.js';

// Original miniatures, using the estate's existing materials and farm-horse proportions.
// Static parts join the woodland's instance batches; only the small pennant moves.
export function createWaysideDetails({group,builder,part,models,colours:C,groundLevel}) {
  const root=new THREE.Group();root.name='woodland-waysides';group.add(root);
  const stone=0x88978d,pale=0xf4e4be;
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const round=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'round',x,y,z,w,h,d,c,ry,rz);
  const flags=[];

  function log(g,x,y,z,length,angle=0,birch=false) {
    const timber=new THREE.Group();timber.position.set(x,y,z);timber.rotation.y=angle;g.add(timber);
    part(timber,'trunk',0,0,0,.56,length,.56,birch?pale:C.wood,0,Math.PI/2);
    for(const side of [-1,1]) {
      round(timber,side*(length/2+.015),0,0,.45,.035,.45,C.cream,0,Math.PI/2);
      round(timber,side*(length/2+.04),0,0,.2,.04,.2,C.soil,0,Math.PI/2);
    }
    box(timber,-.3,.22,0,.2,.65,.2,birch?pale:C.wood,0,-.7);
    if(birch)for(const x of [-.9,-.3,.55])box(timber,x,0,.285,.12,.24,.025,C.soil,0,.25);
  }
  function stump(g,x,z) {
    part(g,'trunk',x,.4,z,.85,.8,.85,C.wood);
    round(g,x,.82,z,.72,.035,.72,C.cream);
    round(g,x,.84,z,.32,.025,.32,C.soil);
    for(const a of [0,2.1,4.2])box(g,x+Math.cos(a)*.38,.13,z+Math.sin(a)*.38,.7,.2,.24,C.wood,-a);
  }
  function shelter(g) {
    rock(g,0,.02,0,10,.12,8,C.soil);
    // Small timber store: an open front, raised planks and a slate roof with a mossy ridge.
    box(g,-.8,.21,-.6,4.6,.32,3.8,C.wood);
    for(const x of [-2.8,1.2])for(const z of [-2.2,1])box(g,x,1.9,z,.23,3.6,.23,C.soil);
    for(let row=0;row<6;row++) {
      box(g,-.8,.6+row*.43,-2.15,4.35,.36,.14,row%2?C.wood:C.soil);
      box(g,-2.75,.6+row*.43,-.6,.15,.36,3.25,C.wood);
    }
    models.roof(g,-.8,4.15,-.6,5.3,1.55,4.6,0x3f6388);
    for(let i=0;i<4;i++)rock(g,-1.4+i*.35,4.99,-1.8,.5,.14,.6,C.leaf);
    box(g,-.8,3.45,1.06,4.35,.23,.22,C.soil);
    box(g,-2.1,2.8,1.1,.18,1.6,.18,C.wood,0,-.7);
    box(g,.5,2.8,1.1,.18,1.6,.18,C.wood,0,.7);
    for(let row=0;row<2;row++)for(let col=0;col<3-row;col++)log(g,-1.5+col*.68+row*.34,.55+row*.5,-1.35,1.7,Math.PI/2);
    // A chopping block, a safely resting axe, a handcart and a bundle of split firewood.
    stump(g,2.8,1.7);box(g,2.8,1.45,1.7,.11,1.25,.11,C.wood,0,-.3);
    box(g,2.62,1.84,1.7,.63,.39,.13,stone,0,-.3);
    const cart=new THREE.Group();cart.position.set(2.7,0,-1.5);cart.rotation.y=.3;g.add(cart);
    box(cart,0,.75,0,1.4,.17,1.8,C.wood);
    for(const x of [-.66,.66])box(cart,x,1.04,0,.12,.5,1.8,C.soil);
    box(cart,0,1.04,-.85,1.4,.5,.12,C.soil);
    for(const x of [-.88,.88]) {
      round(cart,x,.48,.1,.95,.14,.95,C.soil,0,Math.PI/2);
      round(cart,x*1.09,.48,.1,.7,.04,.7,C.wood,0,Math.PI/2);
      round(cart,x*1.12,.48,.1,.2,.06,.2,stone,0,Math.PI/2);
      box(cart,x*.6,.65,1.6,.13,.13,1.9,C.wood);
    }
    for(let i=0;i<3;i++)log(cart,-.4+i*.4,1.05,0,1.35,Math.PI/2);
  }
  function well(g) {
    rock(g,0,.02,0,5.4,.12,4.9,C.soil);
    const roofed=new THREE.Group();roofed.scale.setScalar(1.5);g.add(roofed);models.well(roofed,0,0);
    // A bucket on the rim, its handle, and a low drinking trough beside the path.
    round(g,1,.95,.7,.52,.55,.52,C.wood);
    for(const y of [.74,1.12])round(g,1,y,.7,.55,.06,.55,stone);
    for(const x of [.78,1.22])box(g,x,1.39,.7,.05,.55,.05,C.soil);
    box(g,1,1.65,.7,.48,.05,.05,C.soil);
    box(g,-1.95,.38,.2,.85,.65,1.9,stone);box(g,-1.95,.72,.2,.63,.04,1.62,C.water);
    box(g,1.8,1.27,-1.6,.15,2.55,.15,C.wood);
    box(g,1.55,2.25,-1.6,1.3,.38,.12,C.wood);box(g,1.55,2.26,-1.52,.65,.09,.04,C.cream);
  }
  function rider(g) {
    g.rotation.y=-.42;
    const coat=C.wood,mane=C.soil;
    rock(g,0,1.52,0,2.25,1.05,.9,coat);rock(g,-.75,1.52,0,.8,1,.92,coat);
    for(const x of [-.75,.72])for(const z of [-.29,.29]) {
      box(g,x,1,z,.22,.75,.23,coat,0,x<0?.06:-.04);
      box(g,x,.43,z,.15,.48,.17,mane);box(g,x+.035,.14,z,.26,.16,.26,C.dark);
    }
    box(g,.86,2.02,0,.5,1.32,.56,coat,0,-.28);
    rock(g,1.16,2.62,0,.72,.62,.58,coat);box(g,1.53,2.43,0,.79,.39,.47,coat,0,-.13);
    rock(g,1.9,2.34,0,.35,.31,.47,mane);
    for(const side of [-1,1]) {
      part(g,'cone',1.1,3.02,side*.18,.17,.43,.15,coat);
      box(g,1.35,2.68,side*.29,.09,.085,.035,C.dark);
      box(g,1.48,2.49,side*.28,.06,.5,.035,mane,0,.3);
      box(g,1.05,2.15,side*.29,1.25,.04,.04,mane,0,.32);
      box(g,-.1,1.44,side*.48,1.05,.75,.055,C.gold);
      box(g,-.1,1.5,side*.52,.9,.63,.04,C.blue);
    }
    box(g,1.7,2.43,0,.075,.42,.5,mane);
    for(let i=0;i<5;i++)box(g,.57+i*.06,1.68+i*.23,0,.17,.31,.59,mane,0,-.15);
    box(g,-1.16,1.12,0,.24,1.4,.25,mane,0,-.25);
    box(g,-.1,2.02,0,.88,.18,.72,mane);
    // Seated outrider with a visor, blue surcoat and the same gold shield as the estates.
    box(g,-.1,2.65,0,.65,1.05,.48,C.blue);box(g,-.1,2.35,0,.69,.12,.51,C.gold);
    for(const side of [-1,1]) {
      box(g,-.1,1.94,side*.55,.26,1,.26,stone,0,side*.12);
      box(g,.08,1.47,side*.58,.55,.25,.3,C.dark);
      box(g,.15,2.62,side*.35,.65,.24,.25,stone,0,-.38);
    }
    rock(g,-.1,3.45,0,.73,.8,.69,stone);
    box(g,.26,3.47,0,.06,.13,.5,C.dark);box(g,.29,3.48,0,.055,.43,.08,C.gold);
    box(g,-.18,3.94,0,.64,.28,.14,C.red,0,-.2);
    models.shield(g,-.25,2.55,.65,C.blue,.8,.2);
    box(g,.58,3.24,-.44,.09,4.3,.09,C.wood);
    part(g,'cone',.58,5.6,-.44,.25,.5,.25,C.gold);
    const flag=new THREE.Group();flag.position.set(.58,5.21,-.44);flag.userData.live=true;flag.name='outrider-pennant';g.add(flag);
    box(flag,-.7,-.3,0,1.4,.65,.055,C.blue);
    box(flag,-.72,-.54,0,1.42,.09,.07,C.gold);
    box(flag,-.55,-.28,.04,.1,.4,.025,C.gold);box(flag,-.55,-.23,.04,.38,.1,.025,C.gold);
    // Split tail: a small swallowtail pennant rather than another large banner over a home.
    for(const side of [-1,1])box(flag,-1.55,-.3+side*.21,0,.4,.2,.055,C.blue,0,side*.24);
    flags.push(flag);
  }
  for(const site of WAYSIDE_SITES) {
    const g=new THREE.Group();g.name=site.id;g.position.set(site.x,groundLevel,site.z);root.add(g);
    if(site.kind==='shelter')shelter(g);
    if(site.kind==='well')well(g);
    if(site.kind==='rider')rider(g);
    if(site.kind==='timber') {
      log(g,0,.4,0,3.3,site.angle,site.id.includes('birch'));stump(g,1.55,1.15);
      for(let i=0;i<3;i++)part(g,'cone',-.7+i*.35,.25,-.55,.6,.5,.35,C.leaf,i,.5);
    }
  }
  builder.flush();
  let elapsed=0,previous=null;
  return {root,tick(seconds){
    if(previous!==null)elapsed+=Math.min(.25,Math.max(0,seconds-previous));previous=seconds;
    for(const flag of flags){flag.rotation.y=Math.sin(elapsed*1.4)*.12;flag.rotation.z=Math.sin(elapsed*1.9)*.035;}
  },debug:()=>({sites:WAYSIDE_SITES.map(s=>({...s})),pennants:flags.length,pennantAngle:flags[0]?.rotation.y??0,seconds:elapsed})};
}
