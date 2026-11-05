// Original miniature architecture for Rosewind. Shared geometry/material batches, like the older estates.
// Front (+z) promenade and side lanes remain clear for the existing four palace residents.
export function createPrincessPalace({ part, models, colours: C }) {
  const ivory = 0xf4e4be, shade = 0xacb7a2, rose = 0xb65d76, wine = 0x823f55, blush = 0xd9b0b9;
  const box = (g,x,y,z,w,h,d,c,ry=0,rz=0) => part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const round = (g,x,y,z,w,h,d,c) => part(g,'round',x,y,z,w,h,d,c);
  const jewel = (g,x,y,z,w,h,d,c) => part(g,'rock',x,y,z,w,h,d,c);
  const arch = (g,x,y,z,w,h,d,c,ry=0) => part(g,'arch',x,y,z,w,h,d,c,ry);
  function window(g,x,y,z,w=1,h=1.9,ry=0) {
    // A recessed arch, ivory surround, amber glass and mullions. Glass uses the shared night-light role.
    const cx = Math.sin(ry), cz = Math.cos(ry);
    arch(g,x,y,z,w+.28,h+.26,.16,shade,ry);
    arch(g,x+cx*.09,y,z+cz*.09,w,h,.07,C.dark,ry);
    arch(g,x+cx*.14,y+.02,z+cz*.14,w-.22,h-.18,.035,models.roles.glass,ry);
    box(g,x+cx*.18,y-.12,z+cz*.18,.075,h-.15,.055,C.gold,ry);
    box(g,x+cx*.18,y-.24,z+cz*.18,w-.13,.075,.055,ivory,ry);
    box(g,x+cx*.2,y-h*.51-.1,z+cz*.2,w+.4,.13,.3,ivory,ry);
  }
  function roof(g,x,y,z,w,h,d) {
    part(g,'gable',x,y,z,w,h,d,rose);
    const pitch=Math.atan2(h,w/2);
    for(const s of [-1,1]) {
      for(let row=1;row<=6;row++) {
        const t=(row-.5)/6;
        box(g,x+s*t*w/2,y+h/2-t*h+.03,z,w/11,.08,d+.04,row%2?rose:wine,0,-s*pitch);
      }
      box(g,x+s*w/2,y-h/2-.04,z,.19,.14,d+.25,C.gold);
      for(const end of [-1,1])box(g,x+s*w*.25,y+.03,z+end*d/2,w*.56,.1,.16,ivory,0,-s*pitch);
    }
    box(g,x,y+h/2+.05,z,.18,.16,d+.35,C.gold);
    for(const end of [-1,1]) {
      round(g,x,y+h/2+.39,z+end*d*.5,.08,.6,.08,C.gold);
      jewel(g,x,y+h/2+.72,z+end*d*.5,.27,.3,.27,C.gold);
    }
  }
  function spire(g,x,z,h,r) {
    round(g,x,h/2+.35,z,r*2,h,r*2,ivory);
    round(g,x,.55,z,r*2+.45,.48,r*2+.45,shade);
    for(let y=1.7;y<h;y+=1.7)round(g,x,y,z,r*2+.06,.07,r*2+.06,shade);
    for(const y of [h*.37,h*.69]) {
      window(g,x,y,z+r,.55,1.25);
      window(g,x+r,y,z,.55,1.25,Math.PI/2);
    }
    round(g,x,h+.28,z,r*2+.27,.28,r*2+.27,shade);
    round(g,x,h+.48,z,r*2+.45,.14,r*2+.45,C.gold);
    // Flared lower roof and a slender cap make a different silhouette from the military Citadel.
    part(g,'cone',x,h+1.3,z,r*2+1,1.6,r*2+1,wine);
    part(g,'cone',x,h+2.75,z,r*2+.55,4.4,r*2+.55,rose);
    round(g,x,h+1.1,z,r*2+.7,.1,r*2+.7,C.gold);
    round(g,x,h+5.02,z,.09,.65,.09,C.gold);
    jewel(g,x,h+5.4,z,.31,.35,.31,C.gold);
  }
  function parterre(g,x,z) {
    box(g,x,.4,z,4.1,.22,3.3,shade); box(g,x,.54,z,4.25,.07,3.45,C.gold);
    box(g,x,.68,z,3.8,.3,3, C.pine);box(g,x,.87,z,3,.2,2.25,C.leaf);
    for(let i=0;i<10;i++) {
      const a=i*Math.PI/5,xx=x+Math.cos(a)*1.45,zz=z+Math.sin(a)*1.02;
      jewel(g,xx,1.02,zz,.45,.36,.43,i%3?rose:blush);
      jewel(g,xx+.06,1.19,zz+.03,.15,.12,.15,C.gold);
    }
  }
  return function palace(g,field) {
    g.name='rosewind-palace';
    // Stepped terrace, contrasting plinth and a slim warm string course define the walls.
    box(g,0,.38,-2,23.5,.3,16,shade);box(g,0,.6,-2,23,.16,15.5,ivory);
    box(g,0,5.1,-2.6,11.2,8.9,8,ivory);
    for(const x of [-7.8,7.8])box(g,x,3.8,-1.5,5.2,6.3,6.2,ivory);
    for(const x of [-5.55,5.55])for(const z of [-6.58,1.42])for(let y=1;y<9.5;y+=.8)
      box(g,x,y,z,.37,.27,.35,shade);
    for(const y of [1.2,4.7,9.65])box(g,0,y,1.48,11.4,.14,.19,y===4.7?C.gold:shade);
    roof(g,0,11.55,-2.6,12.7,4.4,9);
    for(const x of [-7.8,7.8]) {
      roof(g,x,8.15,-1.5,5.9,2.8,7);
      window(g,x,3,1.68,1.15,2);window(g,x,5.65,1.68,1.15,1.6);
    }
    for(const x of [-3.55,0,3.55])window(g,x,7.05,1.48,1.3,2.1);
    for(const x of [-3.65,3.65])window(g,x,2.8,1.48,1.05,2.05);
    for(const z of [-4.8,-1.1])window(g,5.62,7.05,z,1.1,1.95,Math.PI/2);
    // Balcony with individual balusters; open sightline to the rose-window and crest above the entrance.
    box(g,0,5.32,2.15,5.8,.25,1.9,shade);box(g,0,5.5,2.2,5.9,.1,2,C.gold);
    for(let x=-2.5;x<=2.5;x+=.5)round(g,x,5.98,3.06,.13,.85,.13,ivory);
    box(g,0,6.43,3.06,5.8,.13,.19,ivory);
    arch(g,0,2.1,1.7,2.8,3.2,.3,shade);arch(g,0,2.1,1.91,2.35,2.9,.1,wine);
    for(const x of [-.72,-.24,.24,.72])box(g,x,1.86,2.0,.035,2,.025,C.gold);
    box(g,0,1.92,2.03,.07,2.55,.05,C.gold);
    for(const x of [-.25,.25])round(g,x,2.06,2.08,.1,.18,.07,C.gold);
    for(let i=0;i<3;i++)box(g,0,.32+i*.12,3.2-i*.4,4.9-i*.3,.18,1.4,ivory);
    models.shield(g,0,9.22,1.65,field,1.25);
    // Five unequal spires: tall central crown and four corner turrets, no copied branded castle silhouette.
    spire(g,0,-6.5,18,1.7);
    for(const x of [-9.1,9.1])for(const z of [-5.7,3.1])spire(g,x,z,z<0?12.3:10.3,1.4);
    // A single household pennant on an entrance standard; sponsor branding is deliberately not assumed.
    round(g,14.5,4.7,5.4,.14,8.9,.14,C.gold);jewel(g,14.5,9.35,5.4,.36,.4,.36,C.gold);
    box(g,15.85,8.05,5.4,2.7,1.65,.12,field);
    models.shield(g,15.85,8.2,5.49,field,1.05);
    box(g,15.85,7.22,5.4,2.85,.09,.18,C.gold);
    // The western arrival walk joins the bridge without crossing the promenade, garden or guest lanes.
    box(g,-20,.31,-2,10,.07,2.7,C.dust);box(g,-16,.31,4.3,2.7,.07,12.7,C.dust);
    box(g,0,.31,9.5,31.5,.07,5,C.dust);box(g,0,.31,5.1,3.6,.07,4.5,C.dust);
    box(g,0,.31,14.5,3.2,.07,7.5,C.dust);
    for(const x of [-9.2,9.2])for(const z of [13.9,18.3])parterre(g,x,z);
    models.fountain(g,0,17.2,1.05);
    for(const x of [-4.7,4.7])models.lantern(g,x,5.3,.2,true);
    // Low garden seats, kept off the residents' clear lanes.
    for(const x of [-15,15]) {
      box(g,x,1.02,16,2.8,.18,.85,ivory);
      for(const dx of [-1,1])box(g,x+dx,.67,16,.24,.6,.6,shade);
    }
  };
}
