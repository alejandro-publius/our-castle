import * as THREE from 'three';
const FAIRY_HOME=Object.freeze({x:-5.2,y:17.8,z:4.3});
// Original folklore miniatures. All parts use the world's shared geometry/material batches.
export function createWoodlandLegends({ part, models, colours: C }) {
  const ivory=0xf4e4be,course=0x88978d,plum=0x686084,plumDark=0x453f61,teal=0x397b73,rose=0xb65d76;
  let mage=null,spell=null,fairy=null,wings=[];
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const round=(g,x,y,z,w,h,d,c)=>part(g,'round',x,y,z,w,h,d,c);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const cone=(g,x,y,z,w,h,d,c)=>part(g,'cone',x,y,z,w,h,d,c);
  const arch=(g,x,y,z,w,h,d,c,ry=0)=>part(g,'arch',x,y,z,w,h,d,c,ry);
  const rod=(g,a,b,w,c)=>{const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz);part(g,'round',(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,w,len,w,c,Math.atan2(dz,-dx),Math.acos(dy/len));};
  function window(g,x,y,z,w=1,h=1.8,ry=0) {
    const sx=Math.sin(ry),sz=Math.cos(ry);
    arch(g,x,y,z,w+.28,h+.24,.14,course,ry);arch(g,x+sx*.1,y,z+sz*.1,w,h,.06,C.dark,ry);
    arch(g,x+sx*.15,y,z+sz*.15,w-.2,h-.16,.035,models.roles.glass,ry);
    box(g,x+sx*.2,y-.1,z+sz*.2,.075,h-.12,.04,C.gold,ry);
    box(g,x+sx*.2,y-.22,z+sz*.2,w-.12,.07,.04,ivory,ry);
    box(g,x+sx*.2,y-h/2-.13,z+sz*.2,w+.4,.13,.3,ivory,ry);
  }
  function star(g,x,y,z,size,colour=C.gold) {
    box(g,x,y,z,size*.28,size,.06,colour,0,.18);
    box(g,x,y,z,size*.8,size*.20,.06,colour,0,.18);
    rock(g,x,y,z,size*.45,size*.45,.12,colour);
  }
  function roofStar(g,x,y,size) {
    const applique=new THREE.Group();
    const radius=(21.85-y)*4.35/5.9;
    applique.position.set(x,y,-1.5+radius-Math.abs(x)*.577+.16);
    applique.rotation.x=-Math.atan(4.35/5.9);g.add(applique);
    star(applique,0,0,0,size);
  }
  function roses(g,x,z) {
    box(g,x,.42,z,2.6,.28,1.3,ivory);box(g,x,.59,z,2.35,.06,1.12,C.soil);
    for(let i=0;i<4;i++){rock(g,x-.85+i*.56,.79,z,.55,.45,.6,C.leaf);rock(g,x-.85+i*.56,1.02,z+.06,.28,.25,.26,i%2?rose:C.red);}
  }
  function towerVines(g) {
    // Two narrow climbers on the stone, not a leafy sleeve around the whole tower.
    const surface = (angle, y, radius = 2.71) => [Math.sin(angle) * radius, y, -1.1 + Math.cos(angle) * radius];
    const leaf = (angle, y, side, size = 1) => {
      const [x, , z] = surface(angle, y, 2.78);
      part(g, 'rock', x, y, z, .5 * size, .63 * size, .14, C.pine, angle, side * .5);
      part(g, 'rock', x + Math.cos(angle) * .035, y + .04, z - Math.sin(angle) * .035, .4 * size, .49 * size, .17, C.leaf, angle, side * .5);
    };
    const flower = (angle, y, pale) => {
      const [x, , z] = surface(angle, y, 2.94);
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5, along = Math.cos(a) * .18;
        rock(g, x + Math.cos(angle) * along, y + Math.sin(a) * .18, z - Math.sin(angle) * along, .29, .29, .24, pale ? ivory : rose);
      }
      rock(g, x + Math.sin(angle) * .06, y, z + Math.cos(angle) * .06, .14, .14, .13, C.gold);
    };
    for (const [stem, count, baseAngle, phase] of [[0, 24, .62, 0], [1, 18, 1.94, 1.7]]) {
      const point = i => {
        const y = .72 + i * .65, angle = baseAngle + Math.sin(i * .48 + phase) * .14 + Math.sin(i * 1.1) * .035;
        return { angle, y, at: surface(angle, y) };
      };
      for (let i = 0; i < count; i++) {
        const a = point(i), b = point(i + 1), side = i % 2 ? -1 : 1;
        rod(g, a.at, b.at, i > count - 5 ? .05 : .085, C.pine);
        leaf(a.angle + side * .075, a.y + .26, side, i > count - 4 ? .7 : 1);
        if (i % 3 === 1) leaf(a.angle - side * .1, a.y + .48, -side, .7);
        if (i % 5 === 2) flower(a.angle + side * .07, a.y + .34, (i + stem) % 3 === 0);
        if (i % 8 === 4) {
          let previous = a.at;
          for (let k = 1; k <= 3; k++) {
            const angle = a.angle + side * k * .11, y = a.y + k * .38, next = surface(angle, y);
            rod(g, previous, next, .05, C.pine); leaf(angle, y, side, .7 - k * .07); previous = next;
          }
        }
      }
    }
  }
  function gardenWizard(g) {
    mage=new THREE.Group();mage.name='observatory-wizard';mage.position.set(-2.1,.28,7.1);mage.rotation.y=.3;mage.scale.setScalar(1.3);g.add(mage);
    for(const side of [-1,1])box(mage,side*.24,.16,.12,.3,.25,.48,plumDark);
    cone(mage,0,1.05,0,1.3,1.8,1.2,plum);round(mage,0,1.63,0,.72,.55,.66,plum);
    round(mage,0,.26,0,1.3,.12,1.2,C.gold);box(mage,0,1.35,.38,.12,.85,.08,C.gold);
    rock(mage,0,2.18,.02,.63,.65,.59,C.skin);
    for(const x of [-.15,.15])box(mage,x,2.26,.32,.06,.07,.04,C.dark);
    rock(mage,0,2.16,.37,.15,.2,.2,C.skin);
    part(mage,'cone',0,1.99,.32,.5,.7,.35,ivory,0,Math.PI);
    round(mage,0,2.55,0,1.26,.12,1.2,plumDark);cone(mage,.1,3.15,0,.94,1.2,.94,plum);
    round(mage,0,2.65,0,.89,.1,.88,C.gold);star(mage,.1,3.12,.4,.3);
    rod(mage,[.4,1.7,.02],[.94,1.57,.12],.25,plum);rock(mage,.95,1.56,.13,.24,.23,.25,C.skin);
    rod(mage,[-.4,1.7,0],[-.65,1.22,.12],.26,plum);rock(mage,-.65,1.22,.15,.22,.22,.23,C.skin);
    // A visible walnut staff with a gilt cradle and cool faceted crystal, separate from garden lamps.
    rod(mage,[1.02,.15,.06],[1.02,2.68,.06],.17,C.wood);
    for(const y of [.5,1.43,2.48])round(mage,1.02,y,.06,.23,.1,.23,C.gold);
    for(const side of [-1,1])rod(mage,[1.02,2.6,.06],[1.02+side*.23,2.95,.06],.1,C.gold);
    rock(mage,1.02,2.97,.06,.45,.68,.43,C.water);rock(mage,1.02,3.12,.27,.18,.29,.1,models.roles.glass);
    spell=new THREE.Group();spell.name='staff-spell';spell.userData.live=true;spell.position.set(1.02,3.05,.06);mage.add(spell);
    for(let i=0;i<2;i++){const spark=new THREE.Group();spell.add(spark);star(spark,0,0,0,i?.23:.33,i?C.gold:models.roles.lamp);}
  }
  function towerFairy(g) {
    fairy=new THREE.Group();fairy.name='rapunzel-fairy';fairy.userData.live=true;fairy.position.set(FAIRY_HOME.x,FAIRY_HOME.y,FAIRY_HOME.z);fairy.rotation.y=.66;fairy.scale.setScalar(1.18);g.add(fairy);
    wings=[];
    for(const side of [-1,1]){
      const wing=new THREE.Group();wing.position.set(side*.12,.95,-.17);fairy.add(wing);wings.push({group:wing,side});
      for(const [x,y,w,h,tilt] of [[.65,.42,1.05,1.65,-.3],[.57,-.48,.85,.94,.38]]){
        part(wing,'rock',side*x,y,0,w,h,.2,C.water,0,side*tilt);
        part(wing,'rock',side*x,y,.1,w*.79,h*.79,.12,models.roles.glass,0,side*tilt);
        rod(wing,[side*.08,0,.19],[side*(x+.15),y+.12,.19],.055,course);
      }
    }
    for(const side of [-1,1]){rod(fairy,[side*.13,.5,0],[side*.2,.12,.05],.12,C.skin);box(fairy,side*.2,.1,.1,.19,.12,.3,teal);}
    cone(fairy,0,.65,0,.83,.66,.7,rose);box(fairy,0,1.02,0,.4,.48,.34,teal);
    for(const x of [-.23,0,.23])rock(fairy,x,.39,.2,.25,.22,.16,rose);
    rock(fairy,0,1.49,-.04,.57,.62,.5,C.gold);rock(fairy,0,1.46,.19,.4,.42,.25,C.skin);
    rock(fairy,.17,1.8,-.08,.29,.29,.3,C.gold);box(fairy,-.06,1.67,.15,.45,.12,.24,C.gold,0,.12);
    for(const side of [-1,1]){rock(fairy,side*.27,1.46,.06,.14,.18,.14,C.skin);box(fairy,side*.1,1.5,.32,.045,.06,.035,C.dark);}
    rod(fairy,[-.25,1.16,.03],[-.45,.83,.17],.13,C.skin);rod(fairy,[.25,1.16,.03],[.55,1.17,.22],.13,C.skin);
    rod(fairy,[.55,1.05,.24],[.98,1.64,.24],.065,C.gold);star(fairy,1.02,1.7,.25,.38,models.roles.lamp);
    for(const [x,y] of [[-.8,-.32],[-.43,-.64]])star(fairy,x,y,.1,.17,C.gold);
  }
  function wizard(g,field) {
    g.name='starfall-observatory';
    for(let i=0;i<3;i++)round(g,0,.3+i*.16,-1.5,8-i*.5,.2,8-i*.5,i%2?ivory:course);
    round(g,0,7.4,-1.5,6.1,14,6.1,C.stone);
    for(let y=1.2;y<14.5;y+=.8)round(g,0,y,-1.5,6.15,.07,6.15,course);
    for(const side of [-1,1])for(let y=1.5;y<13.9;y+=1.6)
      box(g,side*2.2,y,.67,.3,.4,.24,ivory,side*.7);
    for(const y of [4.6,8.6,12.3]){window(g,0,y,1.56,1.15,2);window(g,3.04,y,-1.5,.9,1.8,Math.PI/2);}
    arch(g,0,1.65,1.67,2.1,2.5,.25,ivory);arch(g,0,1.65,1.84,1.7,2.15,.08,plumDark);
    for(let i=0;i<4;i++)box(g,0,.28+i*.13,3.6-i*.45,3.5-i*.3,.2,1.25,ivory);
    models.shield(g,0,3.33,1.82,field,.85);
    // A projecting brass-railed observation deck and angled telescope.
    round(g,0,13.6,-1.5,7.6,.28,7.6,course);round(g,0,13.8,-1.5,7.8,.1,7.8,C.gold);
    for(let i=0;i<14;i++){const a=i*Math.PI/7;round(g,Math.cos(a)*3.65,14.32,-1.5+Math.sin(a)*3.65,.11,1,.11,ivory);}
    round(g,0,14.85,-1.5,7.6,.14,7.6,ivory);
    for(const [dx,dz] of [[-.5,.3],[.5,.3],[0,-.65]])rod(g,[4.6,13.9,-.6],[4.6+dx,12.6,-.6+dz],.11,C.gold);
    rod(g,[3.9,14.0,-.6],[6.9,15.35,-.6],.43,C.gold);
    rod(g,[6.7,15.26,-.6],[7.15,15.46,-.6],.59,C.dark);
    rock(g,7.18,15.48,-.6,.17,.5,.5,models.roles.glass);
    // Slate-plum roof with small star inlays and a crescent finial.
    round(g,0,15.6,-1.5,6.4,1.6,6.4,ivory);
    cone(g,0,18.9,-1.5,8.7,5.9,8.7,plum);round(g,0,16.0,-1.5,8.8,.14,8.8,C.gold);
    cone(g,0,21.6,-1.5,3.3,3.9,3.3,plumDark);round(g,0,23.7,-1.5,.12,.8,.12,C.gold);
    for(const [x,y,size] of [[0,18,1.15],[-1.4,17.2,.8],[1.3,19.1,.8],[-.5,20.5,.65]])roofStar(g,x,y,size);
    for(let i=0;i<10;i++){const a=(-110+i*24)*Math.PI/180;rock(g,Math.cos(a)*1.15,24.8+Math.sin(a)*1.15,-1.5,.65,.65,.43,C.gold);}
    star(g,-.17,24.55,-1.5,.35);
    // Low study garden: an open book, herb beds and one original background wizard.
    for(const x of [-7,7]){models.vegetables(g,x,7,3,2);models.lantern(g,x,4.5,.2,true);}
    box(g,-4,1,5.5,.65,1.6,.65,C.wood);box(g,-4,1.86,5.5,1.5,.16,1,C.gold);
    for(const side of [-1,1])box(g,-4+side*.36,2.02,5.5,.75,.1,.9,ivory,0,-side*.12);
    for(let i=0;i<3;i++)box(g,-4.55,2.08,5.25+i*.2,.4,.025,.025,course);
    gardenWizard(g);
    box(g,-6,.31,6.5,13,.07,2.7,C.dust);
    box(g,-10.5,.31,0,2.7,.07,13.5,C.dust);box(g,-11.75,.31,0,2.5,.07,2.7,C.dust);
  }
  function rapunzel(g,field) {
    g.name='rapunzel-tower';
    for(let i=0;i<3;i++)round(g,0,.38+i*.16,-1.1,7.8-i*.6,.23,7.8-i*.6,i%2?ivory:course);
    round(g,0,10,-1.1,5.2,19.2,5.2,ivory);
    for(let y=1.3;y<19.7;y+=.75)round(g,0,y,-1.1,5.25,.06,5.25,course);
    for(let y=2.2;y<16;y+=2.2){window(g,2.63,y,-1.1,.66,1.2,Math.PI/2);window(g,-1.1,y,1.23,.6,1.05);}
    round(g,0,16.4,-1.1,7.4,.22,7.4,course);round(g,0,16.57,-1.1,7.55,.1,7.55,C.gold);
    round(g,0,18.25,-1.1,6.4,3.4,6.4,ivory);
    for(let i=0;i<16;i++){const a=i*Math.PI/8;round(g,Math.cos(a)*3.45,17.07,-1.1+Math.sin(a)*3.45,.13,.9,.13,ivory);}
    round(g,0,17.58,-1.1,7.2,.13,7.2,ivory);
    for(const side of [-1,1])for(let i=0;i<4;i++){
      const a=side*(.3+i*.25);rock(g,Math.sin(a)*3.45,17.52,-1.1+Math.cos(a)*3.45,.6,.4,.5,C.leaf);
      rock(g,Math.sin(a)*3.5,17.77,-1.1+Math.cos(a)*3.5,.29,.26,.28,i%2?rose:C.red);
    }
    arch(g,0,18.7,2.17,2.3,2.8,.15,course);arch(g,0,18.7,2.29,1.95,2.5,.08,C.dark);
    for(const x of [-.72,.72])arch(g,x,18.6,2.34,.3,1.6,.04,models.roles.glass);
    // Original folklore figure: teal bodice, cream sleeves, long gold braid, no branded costume.
    cone(g,0,17.9,2.66,.9,1,.7,teal);box(g,0,18.25,2.65,.54,.55,.38,teal);
    rock(g,0,18.9,2.7,.57,.62,.5,C.gold);rock(g,0,18.85,2.92,.43,.44,.22,C.skin);
    for(const x of [-.16,.16])box(g,x,18.9,3.04,.04,.055,.03,C.dark);
    for(const side of [-1,1]){rod(g,[side*.32,18.4,2.7],[side*.56,18.05,3.05],.18,ivory);rock(g,side*.56,18.05,3.05,.19,.18,.19,C.skin);}
    for(let i=0;i<39;i++) {
      const y=18.45-i*.44,x=.33+Math.sin(i*.23)*.18,z=2.86+Math.min(1,i/5)*.42;
      for(let strand=0;strand<3;strand++){
        const a=i*1.65+strand*Math.PI*2/3;
        rock(g,x+Math.sin(a)*.24,y,z+Math.cos(a)*.16,.49,.91,.43,strand===1?0xe6b54c:0xc49140);
      }
      if(i%8===7)box(g,x,y,z+.16,.68,.15,.15,teal);
    }
    cone(g,0,22.2,-1.1,8,4.8,8,teal);round(g,0,19.8,-1.1,8.12,.16,8.12,C.gold);
    cone(g,0,24,-1.1,2.65,2.55,2.65,0x28594f);round(g,0,25.55,-1.1,.11,.65,.11,C.gold);rock(g,0,25.98,-1.1,.38,.4,.38,C.gold);
    models.shield(g,0,14.7,1.65,field,.85);
    towerVines(g);
    for(const x of [-7,7])for(const z of [5.6,9.4])roses(g,x,z);
    for(const x of [-4.4,4.4])models.lantern(g,x,5,.2,true);
    towerFairy(g);
    box(g,-6,.31,0,12,.07,2.7,C.dust);box(g,0,.31,6,2.7,.07,10,C.dust);
    for(let i=0;i<5;i++)rock(g,-3.8+i*.9,.36,10.5,.7,.15,.65,course);
  }
  function sword(g) {
    g.name='sword-in-the-stone';
    rock(g,0,.62,0,4.4,1.0,3.7,course);rock(g,.1,1.37,0,3.65,1.9,3.1,C.stone);
    rock(g,-.9,.55,1.1,1.8,.8,1.2,C.stone);rock(g,1.25,.4,-.6,1.45,.55,1.6,course);
    // Steel blade with a dark inset fuller; gold crossguard, leather grip and one small red pommel gem.
    box(g,0,3.05,0,.37,2.4,.15,0xb7c2cb);box(g,-.19,3.05,.015,.055,2.4,.17,ivory);
    box(g,.015,3.1,.085,.07,2.24,.025,0x536979);
    box(g,0,4.27,0,1.9,.19,.35,C.gold);for(const side of [-1,1])box(g,side*.96,4.16,0,.22,.38,.3,C.gold,0,-side*.4);
    rock(g,0,4.29,.2,.28,.29,.12,C.red);box(g,0,4.88,0,.26,1.05,.26,C.soil);
    for(let i=0;i<5;i++)round(g,0,4.5+i*.2,0,.3,.045,.3,C.gold);
    rock(g,0,5.52,0,.55,.5,.4,C.gold);rock(g,0,5.54,.22,.23,.23,.06,models.roles.lamp);
    // Shallow cracks and a carved rune on the face, with moss tucked into the foot of the stone.
    for(const [x,z,rz] of [[-.7,1.22,.45],[.72,1.16,-.5]])box(g,x,1.5,z,.045,.7,.035,course,0,rz);
    box(g,0,1.4,1.5,.055,.52,.04,C.gold);box(g,.13,1.55,1.5,.29,.045,.04,C.gold,0,.5);
    for(let i=0;i<10;i++){const a=i*Math.PI/5;rock(g,Math.cos(a)*2,.44,Math.sin(a)*1.6,.7,.35,.55,C.pine);}
    for(let i=0;i<9;i++){const a=i*2.4;rock(g,Math.sin(a)*4.3,.39,Math.cos(a)*4,.7,.4,.55,C.leaf);if(i%2===0){round(g,Math.sin(a)*4.3,.58,Math.cos(a)*4,.08,.35,.08,ivory);cone(g,Math.sin(a)*4.3,.82,Math.cos(a)*4,.42,.18,.42,C.red);}}
    for(let i=0;i<5;i++)rock(g,-4+i*.65,.31,4-i*.43,.65,.16,.52,course);
  }
  function tick(seconds) {
    if(spell)spell.children.forEach((spark,i)=>{
      const a=seconds*1.15+i*Math.PI;
      spark.position.set(Math.cos(a)*(.57+i*.12),.24+Math.sin(a*1.3)*.36,Math.sin(a)*.43);
      spark.rotation.z=Math.sin(a)*.2;
    });
    if(fairy){
      // One short balcony loop, then a long hover: lively without constant darting.
      const phase=seconds%11,flying=phase<2.6,t=flying?phase/2.6:0;
      const travel=t*t*(3-2*t),angle=travel*Math.PI*2;
      fairy.position.set(FAIRY_HOME.x+Math.sin(angle)*1.8,FAIRY_HOME.y+Math.sin(seconds*1.9)*.18+Math.sin(travel*Math.PI)*.55,FAIRY_HOME.z+(1-Math.cos(angle))*1.25);
      fairy.rotation.y=.66+Math.sin(angle)*.2;fairy.rotation.z=-Math.sin(angle)*.14;
      for(const {group,side} of wings)group.rotation.y=side*(.22+Math.sin(seconds*(flying?8.5:5.8))*.25);
    }
  }
  function reset(){mage=null;spell=null;fairy=null;wings=[];}
  const point=g=>({x:g.position.x,y:g.position.y,z:g.position.z});
  const debug=()=>({wizard:mage?{position:point(mage),sparks:spell.children.map(point)}:null,fairy:fairy?{position:point(fairy),wingAngles:wings.map(w=>w.group.rotation.y)}:null});
  return {wizard,rapunzel,sword,tick,reset,debug};
}
