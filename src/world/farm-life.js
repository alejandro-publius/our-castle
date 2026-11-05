import * as THREE from 'three';
import { FARM_SITES } from './farm-locations.js';

// Original miniature farm architecture and animals; the realm's existing clock animates
// only heads and tails. Static bodies, fences and buildings join its instance batches.
export function createFarmLife({ part, models, colours: C }) {
  const ink = 0x302e36, wheat = 0xcfb46c, pale = 0xf4e4be;
  const box = (g,x,y,z,w,h,d,c,ry=0,rz=0) => part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock = (g,x,y,z,w,h,d,c) => part(g,'rock',x,y,z,w,h,d,c);
  const round = (g,x,y,z,w,h,d,c) => part(g,'round',x,y,z,w,h,d,c);
  let animals = [], buildings = [], last = null, elapsed = 0, ticks = 0;
  const live = (parent,x,y,z) => {
    const g = new THREE.Group(); g.userData.live = true; g.position.set(x,y,z); parent.add(g); return g;
  };
  function pose(animal) {
    const t = elapsed, phase = animal.phase;
    if (animal.kind === 'chicken') {
      const peck = Math.pow(Math.max(0,Math.sin(t*2.1+phase)),6);
      animal.head.rotation.z = -.95*peck;
    } else {
      const cycle = ((t*.3+phase)%7+7)%7;
      const graze = cycle<2.3 ? Math.sin(cycle/2.3*Math.PI) : 0;
      animal.head.rotation.z = -(animal.kind==='horse'?1.12:.78)*graze;
    }
    if (animal.tail) animal.tail.rotation.x = Math.pow(Math.max(0,Math.sin(t*.85+phase)),7)*.3;
  }
  function register(root,head,tail,kind,site,index) {
    const animal = { id:site.id+'-'+kind+'-'+index, kind, district:site.district, root, head, tail, phase:animals.length*1.73+.4 };
    animals.push(animal); pose(animal);
  }
  function fence(g,x,z,w,d,{back=true,front=true}={}) {
    const x0=x-w/2,x1=x+w/2,z0=z-d/2,z1=z+d/2;
    for (const xx of [x0,x1]) for (const zz of [z0,(z0+z1)/2,z1]) {
      box(g,xx,.74,zz,.14,1,.14,C.wood); part(g,'cone',xx,1.3,zz,.21,.17,.21,C.cream);
    }
    for (const y of [.62,1.03]) {
      for (const xx of [x0,x1]) box(g,xx,y,z,.11,.09,d,C.wood);
      if (back) box(g,x,y,z0,w,.09,.11,C.wood);
      if (front) {
        for (const side of [-1,1]) box(g,x+side*(w/4+.45),y,z1,w/2-.9,.09,.11,C.wood);
        // One quiet, closed wooden field gate; this is scenery, not an extra game lock.
        box(g,x,y,z1,1.8,.09,.11,C.soil);
      }
    }
    if (front) box(g,x,.82,z1+.025,1.85,.09,.08,C.soil,0,.38);
  }
  function trough(g,x,z) {
    box(g,x,.48,z,1.35,.42,.75,C.wood);
    box(g,x,.7,z,1.13,.035,.54,C.water);
    for (const xx of [-.65,.65]) box(g,x+xx,.63,z,.1,.33,.8,C.soil);
    for (const zz of [-.37,.37]) box(g,x,.63,z+zz,1.35,.28,.09,C.soil);
  }
  function hay(g,x,z) {
    box(g,x,.65,z,.82,.68,.78,wheat);
    for (const xx of [-.23,.23]) box(g,x+xx,.66,z,.055,.72,.81,C.soil);
    for (let i=0;i<5;i++) box(g,x-.32+i*.16,1.01,z,.045,.05,.66,C.gold);
  }
  function horse(parent,site,index,x,z,angle,coat,mane,blanket) {
    const g=new THREE.Group();g.position.set(x,.27,z);g.rotation.y=angle;parent.add(g);
    rock(g,0,1.35,0,2.18,.94,.83,coat);
    box(g,-.06,1.6,0,1.65,.34,.69,coat);
    rock(g,-.72,1.34,0,.75,.95,.86,coat);rock(g,.66,1.37,0,.7,1,.79,coat);
    for (const xx of [-.72,.68]) for (const zz of [-.27,.27]) {
      box(g,xx,.89,zz,.21,.68,.22,coat,0,xx>0?-.04:.06);
      box(g,xx+(xx>0?.02:-.02),.38,zz,.14,.52,.16,mane);
      box(g,xx+.035,.13,zz,.25,.16,.25,ink);
      if (coat===C.stone) box(g,xx,.48,zz,.17,.16,.19,C.cream);
    }
    if (coat===C.stone) for (const [x,y,z] of [[-.7,1.5,.4],[-.3,1.25,.42],[.15,1.5,.4],[.5,1.18,-.39],[-.6,1.5,-.4]])
      rock(g,x,y,z,.25,.24,.045,C.cream);
    if (blanket) {
      for (const zz of [-.43,.43]) {box(g,-.12,1.28,zz,.9,.61,.045,C.gold);box(g,-.12,1.33,zz*1.05,.75,.52,.035,blanket);}
      box(g,-.12,1.8,0,.78,.12,.63,C.soil);
    }
    const head=live(g,.74,1.32,0);
    rock(head,.05,.35,0,.61,1.02,.58,coat);
    box(head,.14,.45,0,.43,1.1,.48,coat,0,-.28);
    rock(head,.4,.9,0,.65,.51,.49,coat);
    box(head,.67,.77,0,.67,.35,.42,coat,0,-.13);
    rock(head,.98,.69,0,.36,.31,.43,coat===C.cream||coat===C.stone?0x7e8e86:0x65402e);
    for (const side of [-1,1]) {
      part(head,'cone',.27,1.28,side*.18,.17,.39,.14,coat,0,side*.08);
      box(head,.29,1.27,side*.19,.065,.18,.07,pale);
      box(head,.5,.95,side*.25,.075,.085,.035,ink);
      rock(head,1.08,.74,side*.14,.06,.06,.035,ink);
      // Leather cheek straps and a brass bit ring survive a close camera view.
      box(head,.56,.8,side*.26,.055,.31,.035,C.soil,0,.3);
      rock(head,.78,.65,side*.24,.1,.11,.045,C.gold);
    }
    box(head,.84,.75,0,.075,.36,.46,C.soil);
    box(head,.7,.94,0,.07,.05,.34,C.cream);
    for (let i=0;i<5;i++) box(head,-.2+i*.055,.15+i*.19,0,.14,.25,.53,mane,0,-.15);
    part(head,'cone',.37,1.07,.02,.2,.25,.38,mane,0,Math.PI);
    const tail=live(g,-1.05,1.64,0);
    box(tail,-.12,-.24,0,.22,.61,.24,mane,0,-.23);
    box(tail,-.22,-.66,0,.2,.45,.21,mane,0,-.12);
    part(tail,'cone',-.22,-.95,0,.28,.34,.27,mane,0,Math.PI);
    register(g,head,tail,'horse',site,index);
  }
  function chicken(parent,site,index,x,z,angle,color) {
    const g=new THREE.Group();g.position.set(x,.27,z);g.rotation.y=angle;parent.add(g);
    rock(g,0,.5,0,.7,.61,.5,color);
    for (const side of [-1,1]) {
      rock(g,-.02,.53,side*.24,.47,.4,.085,color===C.cream?pale:C.wood);
      box(g,.02,.19,side*.12,.055,.25,.055,C.gold);
      box(g,.13,.07,side*.12,.26,.055,.11,C.gold);
    }
    for(let k=0;k<3;k++) box(g,-.38-k*.04,.66+k*.07,0,.12,.4-k*.07,.18,color,0,-.4-k*.12);
    const head=live(g,.22,.57,0);
    rock(head,.1,.23,0,.32,.44,.3,color);
    box(head,.29,.22,0,.2,.09,.14,C.gold);
    box(head,.13,.51,0,.22,.12,.1,C.red);box(head,.2,.08,0,.09,.13,.07,C.red);
    for (const side of [-1,1]) box(head,.19,.31,side*.155,.045,.05,.022,ink);
    register(g,head,null,'chicken',site,index);
  }
  function smallGrazer(parent,site,index,x,z,angle,kind,scale=1) {
    const g=new THREE.Group();g.position.set(x,.27,z);g.rotation.y=angle;g.scale.setScalar(scale);parent.add(g);
    const wool=kind==='sheep',color=wool?pale:C.cream;
    rock(g,0,.78,0,1.3,.88,.75,color);
    if(wool) for(const xx of [-.4,0,.4]) for(const zz of [-.25,.25]) rock(g,xx,.9,zz,.55,.59,.43,index?C.cream:pale);
    for (const xx of [-.4,.4]) for (const zz of [-.22,.22]) {
      box(g,xx,.32,zz,.13,.55,.13,wool?ink:C.stone);
      box(g,xx+.03,.095,zz,.18,.12,.2,ink);
    }
    const head=live(g,.55,.77,0);
    rock(head,.22,-.03,0,.55,.47,.38,wool?C.soil:C.cream);
    box(head,.47,-.13,0,.26,.22,.32,wool?ink:C.stone);
    for(const side of [-1,1]) {
      rock(head,.07,.08,side*.27,.33,.12,.23,color);
      box(head,.32,.06,side*.2,.055,.06,.03,ink);
      if(!wool){part(head,'cone',.02,.4,side*.13,.11,.5,.11,C.stone,0,-.2);box(head,-.02,.5,side*.13,.09,.2,.09,C.soil,0,-.4);}
    }
    if(!wool) part(head,'cone',.36,-.4,0,.15,.29,.14,C.cream,0,Math.PI);
    const tail=live(g,-.65,.9,0);
    box(tail,-.07,.04,0,.15,wool?.26:.38,.14,color,0,-.5);
    register(g,head,tail,kind,site,index);
  }
  function farmRoof(g,x,y,z,w,h,d,color,finials=false) {
    const pitch=Math.atan2(h,w/2),shade=color===C.blue?0x26405f:0x713c3e;
    part(g,'gable',x,y,z,w,h,d,color);
    for(const side of [-1,1])for(let row=0;row<6;row++) {
      const xx=x+side*(row+.5)*w/12,yy=y+h/2-(row+.5)*h/6+.035;
      const length=w/12/Math.cos(pitch);
      box(g,xx,yy,z,length+.025,.07,d+.035,row%2?color:shade,0,-side*pitch);
      for(let j=1;j<7;j++) {
        const zz=z-d/2+(j+(row%2)*.3)*d/7;
        if(zz<z+d/2-.08)box(g,xx,yy+.045,zz,length,.035,.035,shade,0,-side*pitch);
      }
    }
    // Rakes end at the eaves instead of projecting past the roof silhouette.
    const rake=Math.hypot(w/2,h);
    for(const side of [-1,1]) {
      box(g,x+side*w/2,y-h/2,z,.11,.12,d+.12,C.soil);
      for(const end of [-1,1])box(g,x+side*w/4,y,z+end*(d/2+.045),rake,.105,.1,C.soil,0,-side*pitch);
    }
    box(g,x,y+h/2+.07,z,.16,.13,d+.13,finials?C.gold:C.cream);
    if(finials)for(const end of [-1,1]) {
      round(g,x,y+h/2+.31,z+end*d/2,.065,.4,.065,C.gold);
      rock(g,x,y+h/2+.57,z+end*d/2,.21,.24,.21,C.gold);
    }
  }
  function coop(g) {
    for(const x of [-.85,.85])for(const z of [-.57,.57])box(g,x,.56,z,.15,.8,.15,C.soil);
    box(g,0,1.2,0,2,1.1,1.5,C.cream);
    for(let y=.8;y<1.7;y+=.23)box(g,0,y,.77,2.02,.035,.04,C.wood);
    box(g,.25,1.05,.8,.7,.75,.08,C.soil);box(g,.25,.91,.86,.5,.4,.04,ink);
    for(const x of [-.72,-.55,-.38])box(g,x,1.29,.8,.085,.35,.05,C.soil);
    farmRoof(g,0,2.05,0,2.45,.85,1.95,C.red);
    box(g,.25,.47,1.35,1.25,.09,.68,C.wood,-Math.PI/2,-.45);
    for(let i=0;i<5;i++)box(g,.25,.26+i*.11,1.87-i*.22,.72,.08,.08,C.soil);
    box(g,-.66,.93,.83,.45,.13,.24,wheat);rock(g,-.66,1.06,.88,.15,.2,.13,C.cream);
    round(g,1.4,.45,.8,.56,.3,.56,C.soil);round(g,1.4,.62,.8,.42,.04,.42,wheat);
  }
  function stable(g,site,flag) {
    const roof=site.district==='palace'?C.red:C.blue;
    box(g,0,.35,0,6.7,.18,4.4,C.stone);
    box(g,0,1.73,-1.95,6.4,2.7,.16,C.wood);
    for(const side of [-1,1]) {
      box(g,side*3.1,1.73,0,.16,2.7,4.05,pale);
      for(const z of [-1.9,0,1.9])box(g,side*3.2,1.75,z,.12,2.8,.16,C.soil);
      for(const y of [.58,1.9,3])box(g,side*3.2,y,0,.13,.13,4.1,C.soil);
    }
    for(const x of [-3.1,0,3.1])box(g,x,1.75,2,.2,2.85,.22,C.soil);
    box(g,0,3.03,2,6.5,.2,.24,C.soil);
    for(const x of [-1.55,1.55]) {
      // Open upper stalls, braced half-doors and a hay rack below each opening.
      box(g,x,1.03,2.05,2.7,1.35,.14,C.wood);
      for(const y of [.53,1.56])box(g,x,y,2.15,2.7,.11,.08,C.soil);
      box(g,x,1.04,2.16,2.85,.1,.08,C.soil,0,.35);
      box(g,x,1.04,2.17,2.85,.1,.08,C.soil,0,-.35);
      box(g,x,.74,2.39,1.15,.12,.55,C.soil);box(g,x,.98,2.49,1.08,.35,.06,wheat);
      for(const dx of [-.45,-.15,.15,.45])box(g,x+dx,.94,2.56,.07,.53,.08,C.wood);
      hay(g,x,-1.1);
    }
    farmRoof(g,0,3.85,0,7.1,1.55,4.6,roof,true);
    models.shield(g,0,3.66,2.37,flag,.5);
    // Small horseshoe sign; the silhouette alone names the stable.
    for(let i=0;i<7;i++){const a=Math.PI+i*Math.PI/6;box(g,Math.cos(a)*.27,2.76+Math.sin(a)*.27,2.23,.12,.12,.06,C.gold);}
    for(const x of [-2.85,2.85]) {
      box(g,x,2.36,2.18,.09,.6,.18,C.soil);
      box(g,x,2.45,2.35,.24,.31,.24,models.roles.lamp);
      part(g,'cone',x,2.68,2.35,.4,.22,.4,C.soil);
    }
    fence(g,0,4.75,6.6,4.9,{back:false});trough(g,2.45,6.2);hay(g,-2.65,2.9);
    horse(g,site,0,-1.3,4.0,.35,site.district==='palace'?C.gold:C.wood,site.district==='palace'?C.cream:ink,flag);
    horse(g,site,1,1.2,5.25,Math.PI+.2,site.district==='palace'?C.cream:C.stone,site.district==='palace'?C.stone:ink,null);
  }
  function build(group,district,flag) {
    for(const site of FARM_SITES.filter(s=>s.district===district)) {
      const g=new THREE.Group();g.name=site.id;g.position.set(site.x,0,site.z);g.rotation.y=site.angle;group.add(g);
      if(site.kind==='stable') {stable(g,site,flag);buildings.push({id:site.id,kind:'stable',district});}
      if(site.kind==='coop') {
        coop(g);buildings.push({id:site.id,kind:'coop',district});
        chicken(g,site,0,1.6,-.6,.2,C.cream);
        chicken(g,site,1,2.4,.4,2.5,C.wood);
        chicken(g,site,2,.5,-1.7,-.6,C.gold);
      }
      if(site.kind==='goat') {
        fence(g,0,0,3.2,2.6);smallGrazer(g,site,0,0,0,-.4,'goat');
        trough(g,.7,-.8);
      }
      if(site.kind==='sheep') {
        fence(g,0,0,5.6,4.8);
        smallGrazer(g,site,0,-1,-.5,.3,'sheep');
        smallGrazer(g,site,1,1,.65,2.5,'sheep',.85);trough(g,1.7,-1.8);
      }
    }
  }
  return {
    reset(){animals=[];buildings=[];last=null;},
    build,
    tick(seconds){
      if(last!==null)elapsed+=Math.min(.25,Math.max(0,seconds-last));
      last=seconds;ticks++;for(const animal of animals)pose(animal);
    },
    debug:()=>({animals:animals.map(a=>({id:a.id,kind:a.kind,district:a.district,head:Number(a.head.rotation.z.toFixed(4)),tail:Number((a.tail?.rotation.x??0).toFixed(4))})),buildings:[...buildings],ticks,seconds:Number(elapsed.toFixed(4))}),
  };
}
