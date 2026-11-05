import * as THREE from 'three';

export const TAVERN_SITE = Object.freeze({ district:'market', x:-6, z:-1, patioX:-8.7, patioZ:5.6 });
export const inTavernPlot = (district,x,z,pad=0) => district==='market' && x>-11.3-pad && x<-1.4+pad && z>1.6-pad && z<7.6+pad;

// An addition to the existing market house, not a replacement building or a new reward.
// Static furnishings batch with the town; three background townsfolk use its ambient clock.
export function createTavern({part,models,colours:C}) {
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const round=(g,x,y,z,w,h,d,c)=>part(g,'round',x,y,z,w,h,d,c);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const ink=0x302e36, pale=0xf4e4be;
  let people=[],elapsed=0,last=null,ticks=0;
  const live=(parent,x,y,z)=>{
    const g=new THREE.Group();g.userData.live=true;g.position.set(x,y,z);parent.add(g);return g;
  };
  function mug(g,x,y,z,s=1) {
    round(g,x,y,z,.22*s,.27*s,.22*s,pale);
    round(g,x,y+.14*s,z,.17*s,.025*s,.17*s,C.soil);
    for(const yy of [-.085,.085])box(g,x+.16*s,y+yy*s,z,.17*s,.045*s,.07*s,pale);
    box(g,x+.23*s,y,z,.045*s,.2*s,.07*s,pale);
  }
  function barrel(g,x,z) {
    round(g,x,.66,z,.66,.8,.66,C.wood);
    for(const y of [.32,.63,1])round(g,x,y,z,.69,.055,.69,C.soil);
    round(g,x,1.08,z,.59,.05,.59,C.wood);
    for(const dx of [-.14,.14])box(g,x+dx,1.115,z,.025,.025,.51,C.soil);
    rock(g,x+.1,1.13,z-.1,.08,.035,.08,C.gold);
  }
  function bench(g,x,z) {
    box(g,x,.72,z,2.35,.16,.43,C.wood);
    for(const xx of [-.85,.85])box(g,x+xx,.44,z,.18,.48,.3,C.soil);
    box(g,x,.49,z,1.8,.1,.12,C.soil);
    for(const xx of [-1.02,1.02])box(g,x+xx,.81,z,.06,.025,.24,C.gold);
  }
  function table(g,x,z) {
    round(g,x,1.23,z,2.25,.17,1.8,C.wood);
    for(let row=-2;row<=2;row++) {
      const dz=row*.28,width=2*Math.sqrt(Math.max(0,1.09**2-(dz*1.2)**2));
      box(g,x,1.325,z+dz,width,.025,.025,C.soil);
    }
    for(const xx of [-.66,.66])for(const zz of [-.4,.4])box(g,x+xx,.76,z+zz,.18,.82,.18,C.soil);
    box(g,x,.65,z,1.45,.12,.14,C.wood);
    mug(g,x-.42,1.49,z-.24,.85);mug(g,x+.42,1.49,z+.23,.85);
    round(g,x,1.36,z,.57,.04,.51,pale);rock(g,x,1.5,z,.5,.26,.3,C.gold);
    for(const dx of [-.13,0,.13])box(g,x+dx,1.63,z,.045,.025,.18,C.cream,0,-.4);
  }
  function pose(person) {
    person.head.rotation.y=Math.sin(elapsed*.45+person.phase)*.16;
    const cycle=((elapsed*.38+person.phase)%7+7)%7;
    const toast=cycle<1.6?Math.sin(cycle/1.6*Math.PI):0;
    person.arm.rotation.x=-.12-toast*.5;
    person.arm.rotation.z=(person.index===2?-.12:.05)+Math.sin(elapsed*.7+person.phase)*.025;
  }
  function person(g,index,x,z,angle,{sitting=false,cloth=C.blue,skin=0xd9a67f,hair=C.soil,apron=false}={}) {
    const root=new THREE.Group();root.position.set(x,.24,z);root.rotation.y=angle;g.add(root);
    const shoulder=sitting?1.21:1.4,hip=sitting?.7:.9;
    for(const side of [-1,1]) {
      if(sitting) {
        box(root,side*.15,.65,.2,.21,.18,.6,C.soil);
        box(root,side*.15,.38,.43,.16,.47,.18,C.soil);
        box(root,side*.15,.13,.5,.22,.14,.32,ink);
      } else {
        box(root,side*.15,.43,0,.18,.69,.2,C.soil);
        box(root,side*.15,.13,.08,.23,.14,.35,ink);
      }
    }
    box(root,0,hip+.28,0,.56,.59,.37,cloth);
    box(root,0,hip+.06,.22,.58,.085,.05,C.wood);
    box(root,0,hip+.06,.26,.12,.12,.05,C.gold);
    if(apron) {
      box(root,0,hip+.26,.235,.34,.62,.05,pale);
      box(root,0,hip+.43,.265,.24,.12,.035,C.wood);
    }
    box(root,-.34,shoulder-.23,0,.18,.5,.23,cloth,0,-.08);
    rock(root,-.37,shoulder-.5,.03,.18,.19,.19,skin);
    const head=live(root,0,shoulder+.29,0);
    rock(head,0,.12,0,.47,.5,.44,skin);
    box(head,0,.36,-.025,.5,.18,.46,hair);
    box(head,0,.15,-.2,.49,.38,.08,hair);
    for(const side of [-1,1])box(head,side*.105,.15,.22,.055,.065,.03,ink);
    box(head,0,.06,.245,.07,.09,.06,skin);
    box(head,0,-.02,.23,.12,.025,.025,C.soil);
    if(index===0) {
      round(head,-.03,.46,-.02,.66,.19,.57,C.red);
      box(head,.2,.64,-.02,.06,.3,.08,C.cream,0,-.28);
    } else if(index===1) {
      for(const side of [-1,1])box(head,side*.22,.09,-.05,.14,.52,.31,hair);
      box(head,0,.44,0,.52,.06,.45,C.gold);
    } else {
      round(head,0,.42,-.01,.59,.13,.55,pale);
      box(head,0,.52,-.03,.39,.13,.36,pale);
    }
    const arm=live(root,.34,shoulder-.04,0);
    box(arm,0,-.17,0,.18,.4,.23,cloth);
    box(arm,0,-.36,.17,.18,.18,.43,cloth);
    rock(arm,0,-.34,.4,.19,.18,.17,skin);
    mug(arm,.01,-.27,.46,.72);
    const p={id:['tavern-bard','tavern-neighbor','tavern-innkeeper'][index],index,root,head,arm,phase:index*2.1+.35};
    people.push(p);pose(p);
  }
  function sign(g) {
    box(g,2.85,3.5,2.7,.13,.9,.14,C.soil);
    box(g,3.35,3.86,2.7,1.1,.14,.14,C.soil);
    box(g,3.62,3.45,2.7,.06,.77,.06,C.gold);
    box(g,3.62,3.04,2.75,.98,.96,.14,C.gold);
    box(g,3.62,3.04,2.85,.85,.83,.055,C.soil);
    // Carved cream tankard; no paragraph or additional map label.
    box(g,3.55,3.03,2.9,.39,.47,.05,pale);
    box(g,3.55,3.28,2.91,.46,.065,.06,C.cream);
    for(const yy of [2.9,3.16])box(g,3.86,yy,2.91,.22,.06,.05,pale);
    box(g,3.96,3.03,2.91,.055,.3,.05,pale);
  }
  return {
    reset(){people=[];last=null;},
    build(group,flag) {
      const g=new THREE.Group();g.name='market-tavern';g.position.set(TAVERN_SITE.x,0,TAVERN_SITE.z);group.add(g);
      // The original six-metre market cottage, roof and banner are built by realm-models.
      for(let i=0;i<6;i++) {
        const x=-1.375+i*.55,color=i%2?pale:C.red;
        box(g,x,2.69,3.3,.55,.08,1.85,color);
        rock(g,x,2.55,4.24,.55,.26,.17,color);
      }
      for(const x of [-1.65,1.65])box(g,x,1.46,4.2,.13,2.42,.13,C.soil);
      box(g,0,2.63,4.2,3.45,.13,.15,C.soil);
      sign(g);barrel(g,3.55,1.25);barrel(g,4.15,1.05);
      // A small flagged patio; leave the central approach, well and neighboring homes clear.
      for(let i=0;i<5;i++)for(let j=0;j<4;j++)
        box(g,-4.55+i*.9,.3,5.17+j*.87,.86,.065,.82,(i+j)%2?C.stone:C.cream);
      table(g,-2.7,6.6);bench(g,-2.7,5.5);bench(g,-2.7,7.65);
      person(g,0,-2.7,5.5,0,{sitting:true,cloth:C.red,skin:0xc38d6d,hair:C.soil});
      person(g,1,-2.7,7.65,Math.PI,{sitting:true,cloth:C.blue,skin:0x93664f,hair:ink});
      person(g,2,-.4,4.8,-1.0,{cloth:C.pine,skin:0xe3bc91,hair:C.soil,apron:true});
      models.lantern(g,-4.55,4.55,.2,true);
    },
    tick(seconds) {
      if(last!==null)elapsed+=Math.min(.25,Math.max(0,seconds-last));
      last=seconds;ticks++;for(const p of people)pose(p);
    },
    debug:()=>({district:'market',people:people.map(p=>({id:p.id,x:TAVERN_SITE.x+p.root.position.x,z:TAVERN_SITE.z+p.root.position.z,head:Number(p.head.rotation.y.toFixed(4)),arm:Number(p.arm.rotation.x.toFixed(4))})),ticks,seconds:Number(elapsed.toFixed(4))}),
  };
}
