import * as THREE from 'three';
import { WAYSIDE_SITES } from '../core/woodland-discoveries.js';

// Original miniatures, using the estate's existing materials and farm-horse proportions.
// Static parts join the woodland's instance batches; only the small pennant moves.
export function createWaysideDetails({group,builder,part,models,colours:C,groundLevel}) {
  const root=new THREE.Group();root.name='woodland-waysides';group.add(root);
  const stone=0x88978d,pale=0xf4e4be,wheat=0xcfb46c;
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
  // A small live pennant on a pole top; it shares the outrider's sway in tick().
  function pennant(g,x,y,z,colour) {
    const flag=new THREE.Group();flag.position.set(x,y,z);flag.userData.live=true;g.add(flag);
    box(flag,-.6,-.25,0,1.2,.5,.055,colour);box(flag,-.6,-.48,0,1.2,.08,.07,C.gold);
    flags.push(flag);
  }
  function pavilion(g,x,z,colour) {
    round(g,x,1.1,z,3.2,2.2,3.2,C.cream);
    for(let i=0;i<8;i++){const a=i*Math.PI/4+.39;box(g,x+Math.cos(a)*1.52,1.1,z+Math.sin(a)*1.52,.5,2.2,.12,colour,Math.PI/2-a);}
    round(g,x,2.25,z,3.45,.14,3.45,C.gold);part(g,'cone',x,3.3,z,3.8,2,3.8,colour);
    box(g,x,.85,z+1.6,.9,1.7,.1,C.dark);
    round(g,x,4.9,z,.08,1.4,.08,C.wood);pennant(g,x,5.55,z,colour);
  }
  function tourney(g) {
    rock(g,0,.02,0,15,.1,5,C.road);
    // The lists: a tilt rail between two striped pavilions, a quintain and a rack of shields.
    for(let i=-3;i<=3;i++)box(g,i*2,.55,0,.2,1.1,.2,C.wood);
    box(g,0,1.05,0,12.4,.16,.16,C.cream);box(g,0,.62,0,12.4,.12,.1,C.red);
    pavilion(g,-5,-5.2,C.red);pavilion(g,5,-5.2,C.blue);
    box(g,3,1.3,3.4,.2,2.6,.2,C.wood);box(g,3,2.5,3.4,2.2,.14,.14,C.wood);
    models.shield(g,3.95,2.05,3.48,C.red,.8);rock(g,2.05,1.95,3.4,.5,.75,.5,C.soil);
    for(const x of [-5.2,-2.8])box(g,x,.75,3.6,.14,1.5,.14,C.wood);
    box(g,-4,1.4,3.6,2.8,.12,.12,C.wood);
    [C.blue,C.red,C.gold].forEach((c,i)=>models.shield(g,-4.8+i*.8,.95,3.7,c,.8));
    for(const z of [5.6,6.6])box(g,-3.5,z===5.6?.3:.55,z,5,.18,.6,C.wood);
  }
  function hay(g) {
    rock(g,0,.02,0,13,.1,9,wheat);
    for(const [x,z,s] of [[-3.6,-1.6,1.25],[.2,-2.6,1],[3.4,-.6,1.1]]) {
      round(g,x,.55*s,z,2.3*s,1.1*s,2.3*s,wheat);part(g,'cone',x,1.75*s,z,2.6*s,1.4*s,2.6*s,wheat);
      round(g,x,1.08*s,z,2.45*s,.08,2.45*s,C.road);
    }
    for(let row=0;row<2;row++)for(let i=0;i<5;i++)part(g,'cone',-4+i*1.5+row*.7,.45,2+row*1.3,.55,.9,.55,C.road);
    // A scarecrow in a cream shirt and straw hat, and a split-rail fence along the back.
    box(g,4.6,1.2,2.6,.14,2.4,.14,C.wood);box(g,4.6,1.75,2.6,1.9,.12,.12,C.wood);
    box(g,4.6,1.55,2.6,.75,.9,.35,C.cream);rock(g,4.6,2.3,2.6,.5,.5,.5,wheat);part(g,'cone',4.6,2.65,2.6,.85,.35,.85,C.road);
    for(let i=-3;i<=3;i++)box(g,i*2,.5,-4.3,.18,1,.18,C.wood);
    for(const y of [.45,.8])box(g,0,y,-4.3,12.2,.1,.1,C.wood);
  }
  function stones(g) {
    // A ring of weathered uprights, one pair still carrying its lintel, around a low altar.
    const at=i=>i*Math.PI*2/9+.2;
    for(let i=0;i<9;i++) {
      const a=at(i),h=i<2?3.4:2.3+(i*7%4)*.4,x=Math.cos(a)*5,z=Math.sin(a)*5;
      box(g,x,h/2,z,1.5,h,.9,i%3?C.stone:stone,Math.PI/2-a);
      if(i%4===2)rock(g,x,h+.03,z,.8,.2,.6,C.leaf);
    }
    const mid=(at(0)+at(1))/2;
    box(g,Math.cos(mid)*5,3.7,Math.sin(mid)*5,5,.6,1.1,C.stone,Math.PI/2-mid);
    rock(g,0,.4,0,2.4,.8,1.5,C.stone);rock(g,.3,.86,0,.3,.14,.3,C.gold);
    rock(g,-3.1,.3,2.2,1.6,.6,.9,stone);
  }
  function watchtower(g) {
    rock(g,0,.02,0,7,.12,7,C.soil);
    models.tower(g,0,0,6.5,C.blue,true,{banner:true});
    for(let i=0;i<7;i++){const a=.9+i*.55;part(g,'cone',Math.cos(a)*3.6,.8,Math.sin(a)*3.6,.4,1.6,.4,C.wood);}
  }
  function sheep(g,x,z,a=0) {
    const s=new THREE.Group();s.position.set(x,0,z);s.rotation.y=a;g.add(s);
    rock(s,0,.72,0,1.3,.8,.85,C.cream);rock(s,.72,.95,0,.45,.42,.4,C.dark);
    for(const lx of [-.38,.38])for(const lz of [-.24,.24])box(s,lx,.2,lz,.13,.4,.13,C.dark);
  }
  function fold(g) {
    rock(g,0,.02,0,14,.1,10,C.leaf);
    // A dry-stone fold with a hurdle gate, a shepherd's hut, a trough and a small flock, two of them out grazing.
    for(let i=0;i<16;i++) {
      const a=i*Math.PI/8,x=-2.4+Math.cos(a)*4,z=Math.sin(a)*3.6;
      if(i===4){for(const y of [.55,.95])box(g,x,y,z,1.7,.1,.1,C.wood);continue;}
      part(g,'rock',x,.5,z,1.75,1+(i%3)*.14,.8,i%2?C.stone:stone,Math.PI/2-a);
    }
    [[-3.6,-.8,.4],[-2.2,1.2,2.2],[-1.2,-1.4,-1],[-3.2,1.6,3.6],[2.6,3.3,.7],[4.6,2.4,-2.4]].forEach(([x,z,a])=>sheep(g,x,z,a));
    box(g,4.6,1,-1.8,3,2,2.6,C.cream);box(g,4.6,.75,-.46,.7,1.5,.08,C.soil);
    models.roof(g,4.6,2.6,-1.8,3.6,1.3,3.1,0x3f6388);
    box(g,2.2,.3,-3.4,.9,.6,2,stone);box(g,2.2,.62,-3.4,.7,.04,1.8,C.water);
  }
  function orchard(g) {
    rock(g,0,.02,0,14,.1,9.5,C.leaf);
    // Two rows of apple trees, a picking ladder, two full baskets and three straw skeps on a bench.
    for(let row=0;row<2;row++)for(let i=0;i<4;i++) {
      const x=-5.2+i*3+row*.7,z=-2.6+row*3.4;
      part(g,'trunk',x,.8,z,.4,1.6,.4,C.wood);rock(g,x,2.4,z,2.4,1.9,2.4,(row+i)%2?C.leaf:C.pine);
      for(const [ax,ay,az] of [[.8,-.2,.75],[-.7,.25,.8],[.15,-.5,1.05],[-.95,-.3,-.4],[.5,.5,.6]])rock(g,x+ax,2.4+ay,z+az,.3,.3,.3,C.red);
    }
    for(const z of [-.5,0])box(g,5.4,1.25,z+3.4,.1,2.7,.1,C.wood,0,.25);
    for(let k=0;k<4;k++)box(g,5.6-k*.14,.45+k*.55,3.15,.08,.08,.5,C.wood);
    for(const x of [-4.4,-3.2]){round(g,x,.3,3.6,.85,.6,.85,C.road);for(let k=0;k<3;k++)rock(g,x-.2+k*.2,.66,3.6+(k%2)*.15,.28,.28,.28,C.red);}
    box(g,1.2,.5,4,3.6,.12,1,C.wood);for(const x of [-.4,2.8])box(g,x,.25,4,.14,.5,.9,C.wood);
    for(const x of [.1,1.2,2.3]){round(g,x,.82,4,.85,.5,.85,wheat);round(g,x,1.2,4,.65,.32,.65,wheat);rock(g,x,1.44,4,.4,.26,.4,wheat);box(g,x,.72,4.43,.16,.14,.03,C.dark);}
  }
  function butts(g) {
    rock(g,0,.02,0,15,.1,7.5,C.road);
    // Three straw targets on trestles, a chalk shooting line, a bow rack, a quiver barrel and spare bales.
    for(const x of [-4,0,4]) {
      for(const s of [-1,1])box(g,x+s*.6,.85,-2.7,.12,1.8,.12,C.wood,0,s*.2);
      [[1.9,wheat],[1.5,C.cream],[1.1,C.blue],[.7,C.red],[.3,C.gold]].forEach(([w,c],k)=>round(g,x,1.65,-2.55+k*.035,w,k?.06:.32,w,c,Math.PI/2,Math.PI/2));
    }
    box(g,0,.07,3,12,.04,.2,C.cream);
    for(const x of [-6,-4])box(g,x,.7,3.3,.14,1.4,.14,C.wood);box(g,-5,1.35,3.3,2.3,.12,.12,C.wood);
    for(let k=0;k<3;k++){box(g,-5.6+k*.6,.85,3.42,.07,1.5,.07,C.soil,0,.12);box(g,-5.55+k*.6,.85,3.46,.03,1.3,.03,C.cream);}
    round(g,5,.45,3.2,.8,.9,.8,C.wood);for(const y of [.2,.7])round(g,5,y,3.2,.84,.07,.84,stone);
    for(let k=0;k<4;k++)box(g,4.85+k*.1,1.15,3.1+(k%2)*.16,.05,.7,.05,k%2?C.red:C.cream);
    for(const [x,y,z] of [[6.4,.35,-.6],[6.4,.35,.6],[6.4,1.05,0]])box(g,x,y,z,1.5,.7,1,wheat);
  }
  function ruin(g) {
    rock(g,0,.02,0,11,.1,9,C.dustStone);
    // A roofless chapel: the gable still stands with its window, the side walls step down, one column has fallen.
    box(g,0,2.4,-3,5,4.8,.8,C.stone);part(g,'gable',0,5.55,-3,5,1.5,.8,C.stone);
    box(g,0,3,-2.58,1,2.2,.06,C.dark);box(g,0,4.25,-2.58,.6,.5,.06,C.dark);
    [[3.6,2.8,1.7,.8],[2.5,3.1,1.2,.5]].forEach((heights,side)=>heights.forEach((h,i)=>
      box(g,side?2.5:-2.5,h/2,-1.85+i*1.5,.8,h,1.5,(i+side)%2?C.stone:stone)));
    for(const [x,z,h] of [[-1.2,1.2,2.6],[1.2,1.2,1.1]]){round(g,x,h/2,z,.7,h,.7,C.cream);round(g,x,.12,z,1,.24,1,stone);}
    round(g,-1.2,2.7,1.2,.95,.2,.95,stone);round(g,1.9,.36,3,.7,2.2,.7,C.cream,.5,Math.PI/2);
    box(g,0,.45,-1.6,1.8,.9,1,stone);rock(g,0,.98,-1.6,.3,.16,.3,C.gold);
    for(const [x,y,z,w] of [[-2.5,3.7,-1.8,1.3],[-2.1,2,-2.9,1.5],[2.5,3.2,-.3,1.2],[1.6,4.9,-2.9,1.4],[2.6,.7,2.7,1]])rock(g,x,y,z,w,w*.6,w*.8,C.leaf);
    for(const [x,z] of [[-3.6,2.6],[-.4,3.4],[3.4,1]])rock(g,x,.2,z,.3,.3,.3,C.red);
  }
  function pond(g) {
    // A still pond with a stone rim, a short jetty and moored skiff, reeds, lily pads, two ducks and a shade tree.
    round(g,0,.06,0,11.4,.12,8.8,stone);round(g,0,.1,0,10.6,.12,8,C.water);
    box(g,3.6,.45,1.4,3.8,.14,1.2,C.wood);for(const x of [2.2,4.8])for(const z of [.9,1.9])box(g,x,.25,z,.16,.6,.16,C.soil);
    box(g,.6,.3,2.2,2.3,.4,.9,C.wood);box(g,.6,.44,2.2,1.9,.16,.6,C.soil);box(g,.6,.56,2.2,.12,.08,1.1,C.wood);
    box(g,1.2,.62,1.9,2.2,.06,.1,C.cream,.5);
    for(const [x,z] of [[-4.6,-1.2],[-4.2,1.6],[-1.6,-3.4],[2.4,-3.2]])for(let k=0;k<4;k++) {
      part(g,'cone',x+k*.28,.8,z+(k%2)*.3,.2,1.5+(k%3)*.3,.2,C.pine);rock(g,x+k*.28,1.55+(k%3)*.3,z+(k%2)*.3,.16,.4,.16,C.soil);
    }
    for(const [x,z,f] of [[-2,.6,1],[-1,-1.4,0],[.8,-.6,1],[-2.8,-1,0],[1.8,-1.8,0]]){round(g,x,.18,z,.75,.04,.75,C.leaf);if(f)rock(g,x,.28,z,.26,.18,.26,C.cream);}
    for(const [x,z,a] of [[-.4,.9,.3],[.5,1.3,.9]]) {
      const d=new THREE.Group();d.position.set(x,.2,z);d.rotation.y=a;g.add(d);
      rock(d,0,.16,0,.6,.32,.4,C.cream);rock(d,.3,.4,0,.26,.26,.24,C.pine);box(d,.48,.38,0,.16,.07,.12,C.gold);
    }
    part(g,'trunk',-4.4,1.4,3.4,.55,2.8,.55,C.wood);rock(g,-4.4,3.5,3.4,3.4,2,3.4,C.leaf);
    box(g,4.6,.5,-3.6,1.8,.12,.6,C.wood);for(const x of [3.9,5.3])box(g,x,.25,-3.6,.12,.5,.5,C.wood);
  }
  function windmill(g) {
    rock(g,0,.02,0,9.5,.12,8.5,C.soil);
    // A stone tower mill with a timber cap and four lattice sails, a leaning millstone and sacks of grain.
    round(g,0,1.2,0,4.4,2.4,4.4,C.stone);round(g,0,3.4,0,3.9,2,3.9,C.cream);round(g,0,5.3,0,3.4,1.8,3.4,C.cream);
    round(g,0,2.4,0,4.5,.14,4.5,stone);part(g,'cone',0,7.1,0,4,1.8,4,C.red);
    box(g,0,.9,2.2,.9,1.8,.12,C.soil);for(const y of [3.4,5.2])box(g,0,y,y<4?1.95:1.7,.5,.7,.1,C.dark);
    const sails=new THREE.Group();sails.name='windmill-sails';sails.position.set(0,6.1,2.1);sails.rotation.z=.4;g.add(sails);
    round(sails,0,0,-.3,.5,.9,.5,C.soil,Math.PI/2,Math.PI/2);
    for(let k=0;k<4;k++) {
      const arm=new THREE.Group();arm.rotation.z=k*Math.PI/2;sails.add(arm);
      box(arm,0,2.4,0,.16,4.8,.12,C.wood);box(arm,.52,2.9,0,.9,3.4,.05,C.cream);
      for(let r=0;r<4;r++)box(arm,.52,1.5+r*.95,.02,.9,.07,.06,C.wood);
    }
    round(g,3,.75,2.2,1.5,.28,1.5,stone,.4,1.2);round(g,3.05,.76,2.25,.3,.32,.3,C.dark,.4,1.2);
    for(const [x,z,y] of [[-2.8,2.4,.4],[-3.5,1.6,.4],[-3.1,2,1.05],[-2.4,-2.6,.4]]){rock(g,x,y,z,.8,.8,.7,C.cream);rock(g,x,y+.42,z,.3,.2,.3,C.road);}
  }
  const meadows={tourney,hay,stones,watchtower,fold,orchard,butts,ruin,pond,windmill};
  for(const site of WAYSIDE_SITES) {
    const g=new THREE.Group();g.name=site.id;g.position.set(site.x,groundLevel,site.z);root.add(g);
    if(site.kind==='shelter')shelter(g);
    if(site.kind==='well')well(g);
    if(site.kind==='rider')rider(g);
    // Meadow pieces are drawn a little larger so they read from the whole-realm view.
    if(meadows[site.kind]){g.scale.setScalar(1.4);meadows[site.kind](g);}
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
