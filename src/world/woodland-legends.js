import * as THREE from 'three';
// Original folklore miniatures. All parts use the world's shared geometry/material batches.
export function createWoodlandLegends({ part, models, colours: C }) {
  const ivory=0xf4e4be,course=0x88978d,plum=0x686084,plumDark=0x453f61,teal=0x397b73,rose=0xb65d76;
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
    const x=-1.9,z=5.5;
    cone(g,x,.99,z,1.2,1.7,1.2,plum);round(g,x,1.55,z,.6,.55,.6,plum);
    rock(g,x,2.05,z,.56,.59,.55,C.skin);rock(g,x,1.88,z+.27,.38,.55,.3,ivory);
    round(g,x,2.35,z,1.05,.1,1.05,plumDark);cone(g,x+.08,2.86,z,.8,1.05,.8,plum);
    star(g,x+.06,2.8,z+.32,.25);rod(g,[x+.8,.35,z],[x+.8,2.5,z],.1,C.wood);rock(g,x+.8,2.65,z,.42,.5,.42,models.roles.lamp);
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
    // Ivy climbs the stone on the left; garden beds stay clear of the falling braid.
    for(let i=0;i<25;i++){const y=.6+i*.62,x=-1.8+Math.sin(i*.7)*.35;rod(g,[x,y,1.1],[x+.12,y+.65,1.1],.07,C.pine);rock(g,x-.12,y+.3,1.25,.42,.38,.15,C.leaf);if(i%4===0)rock(g,x+.18,y+.44,1.3,.22,.24,.18,rose);}
    for(const x of [-7,7])for(const z of [5.6,9.4])roses(g,x,z);
    for(const x of [-4.4,4.4])models.lantern(g,x,5,.2,true);
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
  return {wizard,rapunzel,sword};
}
