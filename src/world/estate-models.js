import * as THREE from 'three';

export const ESTATE_SIZE = Object.freeze({ width:42, depth:30 });

export function addEstateGeometry(builder) {
  const vertices = [
    -.5,-.5,.5, .5,-.5,.5, 0,.5,.5, .5,-.5,-.5, -.5,-.5,-.5, 0,.5,-.5,
    -.5,-.5,-.5, .5,-.5,-.5, .5,-.5,.5, -.5,-.5,-.5, .5,-.5,.5, -.5,-.5,.5,
    -.5,-.5,.5, 0,.5,.5, 0,.5,-.5, -.5,-.5,.5, 0,.5,-.5, -.5,-.5,-.5,
    .5,-.5,-.5, 0,.5,-.5, 0,.5,.5, .5,-.5,-.5, 0,.5,.5, .5,-.5,.5,
  ];
  builder.geo.gable=new THREE.BufferGeometry();
  builder.geo.gable.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  builder.geo.gable.computeVertexNormals();
  const shape=new THREE.Shape();shape.moveTo(-.5,-.5);shape.lineTo(.5,-.5);shape.lineTo(.5,0);shape.absarc(0,0,.5,0,Math.PI,false);shape.closePath();
  builder.geo.arch=new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false,steps:1,curveSegments:7});builder.geo.arch.translate(0,0,-.5);
}

export function createEstateModels({part,builder,colours:c}) {
  const C={...c,grass2:0x66864f,grass3:0x789954,leaf2:0xa3b97c,brick:0x9c5948,roof:0xb44d46,roofDark:0x713c3e,slate:0x3f6388,
    pale:0xf4e4be,stone2:0x88978d,water2:0x91c9d0,iron:0x374d56,flower:0xd9b0b9,purple:0x81739c,wheat:0xcfb46c};
  const box=(g,x,y,z,w,h,d,color,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,color,ry,rz);
  const round=(g,x,y,z,w,h,d,color)=>part(g,'round',x,y,z,w,h,d,color);
  const rock=(g,x,y,z,w,h,d,color)=>part(g,'rock',x,y,z,w,h,d,color);
  function window(g,x,y,z,w=.48,h=.64,lit=true){
    box(g,x,y,z,w+.16,h+.16,.13,C.wood);box(g,x,y,z+.075,w,h,.04,C.dark);
    box(g,x,y,z+.105,w-.08,h-.08,.035,lit?C.pale:C.blue);
    box(g,x,y,z+.14,.055,h,.035,C.soil);box(g,x,y,z+.14,w,.055,.035,C.soil);
    box(g,x,y-h/2-.12,z+.17,w+.3,.15,.32,C.wood);
    for(let i=0;i<3;i++)rock(g,x+(i-1)*w*.28,y-h/2-.05,z+.25,.14,.2,.14,i%2?C.flower:C.leaf);
  }
  function doorway(g,x,y,z,w=1,h=1.7){
    part(g,'arch',x,y,z,w+.3,h+.25,.18,C.cream);part(g,'arch',x,y-.04,z+.105,w,h,.08,C.soil);
    for(let i=-2;i<=2;i++)box(g,x+i*w*.16,y-h*.15,z+.16,.025,h*.55,.02,C.wood);
    box(g,x,y-h*.06,z+.17,w*.9,.075,.03,C.iron);box(g,x,y-h*.32,z+.17,w*.9,.075,.03,C.iron);
    round(g,x+w*.25,y-h*.08,z+.2,.08,.08,.07,C.gold);
  }
  function roof(g,x,y,z,w,h,d,color=C.roof){
    part(g,'gable',x,y,z,w,h,d,color);
    const pitch=Math.atan2(h,w/2);
    for(const sign of[-1,1])for(let row=1;row<=5;row++){
      const xx=x+sign*(row-.5)/5*w/2, yy=y+h/2-(row-.5)/5*h;
      box(g,xx,yy+.035,z,w/9,.085,d+.06,row%2?color:C.roofDark,0,-sign*pitch);
    }
    for(let i=0;i<7;i++)for(const sign of[-1,1])box(g,x+sign*w*.25,y+.035,z-d/2+i*d/6,w*.55,.035,.035,C.roofDark,0,-sign*pitch);
    box(g,x,y+h/2+.065,z,.17,.14,d+.2,C.cream);
    for(const sign of[-1,1])box(g,x,y,z+sign*d/2,w+.12,.075,.1,C.soil,0,sign*.0);
  }
  function chimney(g,x,y,z){
    box(g,x,y,z,.52,1.6,.52,C.brick);for(let j=0;j<4;j++)box(g,x,y-.6+j*.36,z+.27,.54,.045,.025,C.cream);
    box(g,x,y+.8,z,.7,.16,.7,C.stone2);box(g,x,y+.9,z,.34,.08,.34,C.dark);
  }
  function lantern(g,x,z,y=.2,on=false){
    box(g,x,y+1.15,z,.12,2.3,.12,C.soil);box(g,x+.28,y+2.22,z,.65,.12,.15,C.wood);
    box(g,x+.5,y+1.93,z,.42,.5,.4,C.dark);box(g,x+.5,y+1.94,z+.02,.29,.34,.3,on?C.pale:C.gold);
    part(g,'cone',x+.5,y+2.26,z,.6,.3,.6,C.iron);box(g,x+.5,y+1.65,z,.52,.1,.5,C.iron);
  }
  function banner(g,x,y,z,flag,w=.65,h=1.15){
    box(g,x,y,z,w+.14,h+.1,.1,C.gold);box(g,x,y,z+.065,w,h,.045,flag);
    box(g,x,y+.08,z+.105,w*.27,h*.36,.035,C.gold);for(const dx of[-.16,0,.16])box(g,x+dx*w,y+h*.28,z+.11,.12,.18,.035,C.gold);
  }
  function cottage(g,x,z,{w=3.2,h=2,d=2.6,color=C.cream,roofColor=C.roof,timber=true,scale=1}={}){
    const house=new THREE.Group();house.position.set(x,.18,z);house.scale.setScalar(scale);g.add(house);
    box(house,0,.05,0,w+.4,.18,d+.4,C.stone2);box(house,0,h/2+.15,0,w,h,d,color);
    if(timber){
      for(const xx of[-w/2,0,w/2])box(house,xx,h/2+.15,d/2+.025,.14,h,.12,C.soil);
      for(const yy of[.35,h*.52,h])box(house,0,yy,d/2+.055,w,.12,.12,C.soil);
      for(const xx of[-w/2,w/2])for(const zz of[-d/2,d/2])box(house,xx,h/2,zz,.15,h,.15,C.soil);
    }
    roof(house,0,h+.85,0,w+.7,1.5,d+.7,roofColor);chimney(house,-w*.28,h+1.4,-d*.23);
    doorway(house,0,.99,d/2+.09,.8,1.65);
    for(const xx of[-w*.3,w*.3])window(house,xx,1.38,d/2+.08,.48,.62);
    if(h>2.6)for(const xx of[-w*.3,0,w*.3])window(house,xx,h-.45,d/2+.09,.56,.72);
    return house;
  }
  function fence(g,x,z,w,d,gate=true){
    for(const side of[-1,1]){
      for(let i=0;i<=Math.floor(w/.65);i++)box(g,x-w/2+i*.65,.66,z+side*d/2,.11,1,.11,C.wood);
      for(const yy of[.5,.85]){
        box(g,x,yy,z-d/2,w,.09,.1,C.soil);
        if(!gate)box(g,x,yy,z+d/2,w,.09,.1,C.soil);
        else for(const s of[-1,1])box(g,x+s*(w/4+.35),yy,z+d/2,w/2-.7,.09,.1,C.soil);
      }
      for(const yy of[.5,.85])box(g,x+side*w/2,yy,z,.1,.09,d,C.soil);
    }
  }
  function vegetables(g,x,z,w=2.5,d=2){
    box(g,x,.22,z,w,.25,d,C.soil);for(let row=0;row<4;row++){
      box(g,x,.36,z-d*.38+row*d*.25,w-.12,.035,.07,C.wood);
      for(let col=0;col<5;col++)rock(g,x-w*.39+col*w*.19,.53,z-d*.34+row*d*.23,.3,.3,.3,row%2?C.leaf2:col%2?C.roof:C.gold);
    }
  }
  function well(g,x,z){
    round(g,x,.45,z,1.6,.6,1.6,C.stone2);round(g,x,.77,z,1.2,.08,1.2,C.water);
    for(const xx of[-.7,.7])box(g,x+xx,1.4,z,.15,1.7,.15,C.soil);roof(g,x,2.45,z,2,.7,1.7,C.slate);
    box(g,x,1.75,z,1.7,.12,.12,C.wood);box(g,x,1.35,z,.035,.8,.035,C.gold);
  }
  function villager(g,x,z,color=C.red){
    round(g,x,.75,z,.44,.85,.44,color);rock(g,x,1.38,z,.46,.46,.46,C.skin);part(g,'cone',x,1.67,z,.68,.3,.68,C.wheat);
    for(const xx of[-.13,.13])box(g,x+xx,.3,z,.13,.4,.17,C.soil);
  }
  function wall(g,x,z,length,h,alongX=true){
    box(g,x,h/2+.18,z,alongX?length:.48,h,alongX?.48:length,C.stone2);
    box(g,x,h+.15,z,alongX?length+.12:.68,.22,alongX?.68:length+.12,C.cream);
    for(let i=0;i<=Math.floor(length/.7);i++)box(g,x+(alongX?i*.7-length/2:0),h+.48,z+(alongX?0:i*.7-length/2),alongX?.35:.62,.48,alongX?.62:.35,C.cream);
    for(let j=1;j<Math.floor(h/.55);j++)box(g,x,.25+j*.55,z+(alongX?.25:0),alongX?length:.51,.035,alongX?.025:length,C.stone);
  }
  function tower(g,x,z,height,flag,pointed=false){
    round(g,x,height/2+.2,z,1.75,height,1.75,C.stone);round(g,x,.35,z,2.1,.4,2.1,C.stone2);
    for(let y=.9;y<height;y+=.65)round(g,x,y,z,1.79,.07,1.79,C.stone2);
    for(const y of[height*.38,height*.7]){box(g,x,y,z+.87,.22,.68,.045,C.dark);box(g,x+.86,y,z,.045,.68,.22,C.dark);}
    round(g,x,height+.2,z,2,.35,2,C.cream);
    for(let j=0;j<8;j++){const a=j*Math.PI/4;box(g,x+Math.cos(a)*.8,height+.62,z+Math.sin(a)*.8,.36,.5,.36,C.cream,a);}
    if(pointed)part(g,'cone',x,height+1.6,z,2.15,2.2,2.15,C.slate);
    const pole=height+(pointed?3:1.65);round(g,x,pole,z,.065,1.8,.065,C.gold);box(g,x+.43,pole+.55,z,.85,.47,.07,flag);
  }
  function home(g,tier,flag,estateLevel=0){
    box(g,0,.18,0,tier<2?9.4:12,.2,tier<2?7:10,C.stone2);
    for(let i=0;i<8;i++)for(let j=0;j<5;j++)box(g,-3.8+i*1.05,.295,-2.5+j*1.1,.97,.045,1.03,(i+j)%2?C.cream:C.stone);
    if(tier<2){
      cottage(g,0,-.5,{w:tier===0?4.5:6.4,h:tier===0?2.45:4,d:tier===0?3.4:4.4});
      if(tier===1){cottage(g,4,-.4,{w:2.2,h:2.6,d:3.3,roofColor:C.slate});banner(g,0,3.2,1.84,flag,.8,1.3);fence(g,0,2.6,9.2,2.2);vegetables(g,-3.6,2.2,1.5,1.5);}
      if(estateLevel>=1||tier>0){
        roof(g,0,2.6,tier===0?2.3:3,2.9,.8,1.8,C.slate);
        for(const x of[-1.2,1.2])box(g,x,1.35,tier===0?2.8:3.5,.17,2.3,.17,C.soil);
        for(let i=0;i<3;i++)box(g,0,.27+i*.12,3.7-i*.38,2.7,.18,.5,C.cream);
        lantern(g,-2.3,2.5,.1,true);
      }
      round(g,-3.4,1.3,1.3,.07,2.3,.07,C.gold);box(g,-3,2.15,1.3,.75,.48,.07,flag);
    }else{
      const high=tier===3;
      cottage(g,0,-1.4,{w:high?6.6:6,h:high?5.2:3.8,d:4.4,color:C.stone,roofColor:high?C.roof:C.slate,timber:false});
      for(const x of[-4.5,4.5])for(const z of[-3.4,3.4])tower(g,x,z,high?(z<0?7.1:5.5):(z<0?4.8:3.8),flag,high&&z<0);
      for(const x of[-4.5,4.5])wall(g,x,0,6.9,high?3.1:2.2,false);wall(g,0,-3.5,9,high?3.2:2.1);
      for(const x of[-3,3])wall(g,x,3.5,3.2,high?3.3:2.5);
      box(g,0,2.4,3.6,2.5,4.3,1.2,C.stone);doorway(g,0,1.7,4.26,1.8,2.8);banner(g,0,3.65,4.27,flag,.75,.8);
      for(let i=0;i<5;i++)box(g,-.68+i*.34,1.8,4.45,.055,2.4,.045,C.iron);
      roof(g,0,4.95,3.6,3,1.1,1.9,C.slate);
      if(high){
        tower(g,1.5,-2.4,8.9,flag,true);window(g,-1.5,3.8,.86,.65,1.2);window(g,1.5,3.8,.86,.65,1.2);
        for(const x of[-6.2,6.2])box(g,x,.19,0,.75,.08,11.2,C.water);for(const z of[-5.6,5.6])box(g,0,.19,z,13,.08,.75,C.water);
        for(let i=0;i<7;i++)box(g,0,.33,4.8+i*.3,2.3,.13,.25,C.wood);
        round(g,-2.5,.5,1.6,1.8,.4,1.8,C.cream);round(g,-2.5,.73,1.6,1.45,.06,1.45,C.water);round(g,-2.5,1.15,1.6,.2,.9,.2,C.stone);
        for(const x of[-3.3,3.3])vegetables(g,x,2.2,1.3,1.3);
      }
    }
    builder.flush();
  }
  function landscape(scene,{tree,deer,butterflies,rotators}){
    const land=new THREE.Group();scene.add(land);
    box(land,0,-.9,0,42,1.9,30,C.soil);box(land,0,.08,0,42.15,.2,30.15,C.grass);
    for(let i=0;i<26;i++){
      const x=-20.3+i*1.62;box(land,x,-.45,14.95,1.5,.65,.16,i%3?C.wood:C.stone2);
      box(land,x,-1.05,14.97,1.5,.3,.2,i%4?C.soil:C.stone2);
    }
    for(let i=0;i<50;i++){
      const side=i<26;const x=side?-19.5+i*1.55:((i%2)?-19.5:19.5);const z=side?-13.1+Math.sin(i*2.1)*.45:-11+(i-26)*.98;
      if(side&&x<-15)continue; // the bluff stands here
      if(!side&&x<0&&z<-9.5)continue;
      tree(land,x,z,1.05+(i%4)*.13,i%3!==0);
    }
    // The northwest bluff: terraced stone with a grassy top, a channel and a waterfall over its face.
    const bluff={x0:-21,x1:-15.2,z0:-15,z1:-10.9,h:3.3};
    const bx=(bluff.x0+bluff.x1)/2,bz=(bluff.z0+bluff.z1)/2,bw=bluff.x1-bluff.x0,bd=bluff.z1-bluff.z0;
    box(land,bx,bluff.h/2,bz,bw,bluff.h,bd,C.stone2);
    box(land,bx+.4,bluff.h*.35,bluff.z1+.25,bw-1.2,bluff.h*.7,.5,C.stone);   // lower terrace
    for(const y of[.75,1.55,2.35])box(land,bx,y,bluff.z1+.02,bw,.08,.06,C.stone);
    for(const y of[.6,1.4])box(land,bx+.4,y,bluff.z1+.52,bw-1.2,.07,.05,C.stone2);
    box(land,bx,bluff.h+.1,bz,bw+.1,.2,bd+.1,C.grass2);
    for(let i=0;i<5;i++)rock(land,bluff.x0+.8+i*1.05,.35,bluff.z1+.9+(i%2)*.25,.8,.6,.7,i%2?C.stone:C.stone2);
    const top=new THREE.Group();top.position.y=bluff.h+.2;land.add(top);
    for(const[x,z,sz,pine]of[[-20.3,-14.2,1.1,true],[-19.1,-14.5,1.2,true],[-16,-14.3,1.0,false],[-15.8,-12.5,.85,true],[-20.2,-12,.95,false]])tree(top,x,z,sz,pine);
    const wx=-17;
    box(land,wx,bluff.h+.24,bz,1.5,.06,bd,C.water);                        // channel on top
    box(land,wx,bluff.h/2+.12,bluff.z1+.14,1.7,bluff.h+.1,.22,C.water2);   // falling sheet
    for(const dx of[-.55,-.15,.25,.6])box(land,wx+dx,bluff.h/2+.1,bluff.z1+.27,.09,bluff.h-.2,.04,C.pale);
    round(land,wx,.21,bluff.z1+1.25,3.6,.08,2.3,C.water);                  // plunge pool
    for(let i=0;i<6;i++)rock(land,wx-1.1+i*.44,.32,bluff.z1+.45,.3,.22,.26,C.pale);
    // The river runs south along the west edge to the dock.
    for(let i=0;i<15;i++){
      const z=bluff.z1+2.2+i*1.6,x=wx+Math.sin(i*.63)*.55;
      box(land,x,.19,z,1.75,.07,1.75,i%2?C.water:C.water2);
      if(i%2===0)for(const sgn of[-1,1])rock(land,x+sgn*1.12,.28,z,.48,.42,.62,C.stone2);
    }
    // A brook branches east, under the plank bridge where the route crosses, into a reed pond.
    const brookZ=-3.84;
    box(land,-13.9,.2,brookZ,6.4,.07,1.0,C.water);
    round(land,-11.2,.2,brookZ,2.9,.09,2.5,C.water);
    for(let i=0;i<7;i++){const a=i*.9;round(land,-11.2+Math.cos(a)*1.45,.5,brookZ+Math.sin(a)*1.25,.06,.6,.06,C.pine);rock(land,-11.2+Math.cos(a)*1.45,.82,brookZ+Math.sin(a)*1.25,.12,.18,.12,C.soil);}
    box(land,-13.8,.4,brookZ,2.5,.14,2.7,C.wood);                          // bridge deck
    for(let i=0;i<7;i++)box(land,-13.8,.48,brookZ-1.2+i*.4,2.5,.04,.06,C.soil);  // planks across the deck
    for(const x of[-15.05,-12.55]){
      box(land,x,.88,brookZ,.1,.1,2.75,C.soil);                            // rails along the walking direction
      for(const dz of[-1.3,0,1.3])box(land,x,.64,brookZ+dz,.14,.5,.14,C.wood);
    }
    // A mill and turning waterwheel beside the brook.
    cottage(land,-19.75,5,{w:1.9,h:2.4,d:2.8,roofColor:C.slate});
    const wheel=new THREE.Group();wheel.position.set(-18.3,1.3,5);wheel.rotation.y=Math.PI/2;land.add(wheel);
    for(let i=0;i<10;i++){const a=i*Math.PI/5;box(wheel,Math.cos(a)*1.1,Math.sin(a)*1.1,0,.35,.28,.6,C.wood,0,a);box(wheel,0,0,0,2.3,.08,.12,C.soil,0,a);}
    rotators.push({group:wheel,axis:'z',speed:.13});
    // Small neighboring hamlet, orchard, fenced farm plots and a dock.
    for(let i=0;i<4;i++){cottage(land,-8.5+i*4.1,12.5,{w:2.3,h:1.6+(i%2)*.4,d:2,roofColor:i%2?C.slate:C.roof});villager(land,-7.2+i*4.1,10.9,i%2?C.blue:C.red);}
    for(let i=0;i<6;i++){
      const x=10.1+(i%3)*2.8,z=-5.8+Math.floor(i/3)*2.7;tree(land,x,z,.68,false);
      for(let j=0;j<4;j++)rock(land,x+Math.sin(j*2)*.65,1.5+(j%2)*.4,z+Math.cos(j*2)*.6,.24,.24,.24,C.roof);
    }
    for(let i=0;i<3;i++)vegetables(land,16.8,1.3+i*3,2.4,2.3);fence(land,16.8,4.3,3.6,9);
    well(land,8.8,5.7);cottage(land,16.7,-9.6,{w:2.5,h:2.4,d:2.4,roofColor:C.slate});
    // A windmill with a separately animated, batched sail group.
    round(land,16.8,2.9,-8.8,1.65,5.3,1.65,C.cream);part(land,'cone',16.8,6,-8.8,2.25,1.5,2.25,C.slate);
    const sails=new THREE.Group();sails.position.set(16.8,4.5,-7.8);land.add(sails);
    for(let i=0;i<4;i++){const a=i*Math.PI/2;box(sails,Math.sin(a)*1.35,Math.cos(a)*1.35,0,.55,2.4,.12,C.cream,0,-a);box(sails,0,0,0,.1,4.9,.15,C.soil,0,-a);}
    rotators.push({group:sails,axis:'z',speed:.09});
    for(let i=0;i<6;i++)box(land,-18.75+i*.7,.34,11.6,.62,.14,2.4,C.wood);for(const z of[10.35,12.85]){box(land,-17,.82,z,4.3,.1,.1,C.soil);for(const x of[-18.9,-17,-15.1])box(land,x,.58,z,.14,.5,.14,C.wood);}
    round(land,-14.9,1.1,13.4,.08,1.8,.08,C.soil);box(land,-14.55,1.6,13.4,.75,.45,.07,C.cream);
    for(let i=0;i<100;i++){
      const x=Math.sin(i*2.17)*18.7,z=Math.cos(i*3.13)*13.4;
      if(Math.abs(x)<8.3&&Math.abs(z)<7.3||Math.abs(Math.abs(x)-13.8)<1.7||Math.abs(Math.abs(z)-9.6)<1.4||x< -14||x>14)continue;
      rock(land,x,.28,z,.45,.3,.4,C.leaf);rock(land,x+.12,.48,z,.2,.24,.2,i%4===0?C.flower:i%3===0?C.gold:C.purple);
    }
    deer(land,-9.4,-5.6,-.4);deer(land,-9.6,-2.1,-.9,.7);deer(land,9,-.4,2.6);deer(land,9.5,11.5,.25);butterflies(land);
    builder.flush();return land;
  }
  function extras(g,level,flag,previewFeature=null){
    if(level>=2){
      cottage(g,9,2.8,{w:2.4,h:2,d:2.1,roofColor:C.slate});
      for(let i=0;i<2;i++){
        const x=7.7+i*3.3,z=6;
        box(g,x,.7,z,2.35,1.1,1.3,C.wood);
        for(const xx of[-1,1])box(g,x+xx,1.5,z,.1,2.4,.1,C.soil);
        for(let j=0;j<6;j++)box(g,x-1.05+j*.42,2.65,z, .42,.12,2,j%2?C.cream:flag,0,.12);
        for(let j=0;j<4;j++)rock(g,x-.8+j*.48,1.35,z+.35,.35,.3,.35,j%2?C.leaf:C.roof);
        villager(g,x+1.2,z+1.5,i%2?C.blue:C.red);
      }
      box(g,7,.55,3,1.4,.6,1.7,C.wood);for(const x of[6.3,7.7])for(const z of[2.5,3.5])round(g,x,.42,z,.5,.16,.5,C.soil);
    }
    if(level>=3){
      for(const x of[-8.3,8.3])wall(g,x,0,13,1.7,false);wall(g,0,-6.5,16.6,1.7);
      for(const x of[-5,5])wall(g,x,6.5,6.5,1.7);
      for(const x of[-8.3,8.3])for(const z of[-6.5,6.5]){round(g,x,1.3,z,1.2,2.2,1.2,C.stone);part(g,'cone',x,3,z,1.7,1.4,1.7,flag);}
    }
    if(previewFeature==='electricity')for(const[x,z]of[[-10,7],[10,7],[-10,-7],[10,-7],[-5,10],[5,10]])lantern(g,x,z,.2,true);
    if(previewFeature==='water'){
      round(g,-9.2,.45,3.2,3,.45,3,C.cream);round(g,-9.2,.72,3.2,2.65,.07,2.65,C.water2);round(g,-9.2,1.35,3.2,.28,1.4,.28,C.stone);
      round(g,-9.2,1.95,3.2,1.2,.12,1.2,C.cream);
      for(let i=0;i<3;i++){vegetables(g,-8.8,5.4+i*1.4,2.1,1.1);box(g,-10.3,.24,5.4+i*1.4,.24,.08,1.5,C.water);}
    }
    builder.flush();
  }
  return {landscape,home,extras};
}
