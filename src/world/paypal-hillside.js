import * as THREE from 'three';
import { PAYPAL_WORDMARK } from '../../assets/brand/paypal/wordmark-shapes.js';
import { PAYPAL_HILLSIDE, terrainElevation } from '../core/realm-terrain.js';

// Solid letter silhouettes from PayPal's own outlined artwork, not browser text or a billboard texture.
export function addPayPalHillside(parent,{builder,part,colours:C}) {
  const [left,bottom,right,top]=PAYPAL_WORDMARK.bounds,scale=PAYPAL_HILLSIDE.width/(right-left),mid=(left+right)/2;
  const span=PAYPAL_WORDMARK.shapes.map(s=>{
    const xs=s.outline.map(p=>p[0]);return (Math.min(...xs)+Math.max(...xs))/2;
  });
  const base=Math.max(...span.map(x=>terrainElevation(PAYPAL_HILLSIDE.x+(x-mid)*scale,PAYPAL_HILLSIDE.z)))+1.2;
  const sign=new THREE.Group();sign.name='paypal-hillside-sign';sign.position.set(PAYPAL_HILLSIDE.x,base,PAYPAL_HILLSIDE.z);parent.add(sign);
  const vectors=points=>points.map(([x,y])=>new THREE.Vector2((x-mid)*scale,(y-bottom)*scale));
  const face=builder.material(0xf7f6eb),sides=builder.material(C.stone);
  for(const [i,glyph] of PAYPAL_WORDMARK.shapes.entries()){
    const shape=new THREE.Shape(vectors(glyph.outline));
    for(const hole of glyph.holes)shape.holes.push(new THREE.Path(vectors(hole)));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.65,bevelEnabled:false,steps:1});
    const letter=new THREE.Mesh(geometry,[face,sides]);letter.userData.ownedGeometry=true;sign.add(letter);
    const x=(span[i]-mid)*scale,foot=terrainElevation(sign.position.x+x,sign.position.z-.4)+.25;
    const low=(Math.min(...glyph.outline.map(p=>p[1]))-bottom)*scale,tip=base+low+2.6;
    // Thin, genuinely grounded supports behind each separate letter.
    for(const dx of [-.65,.65])part(sign,'box',x+dx,(foot+tip)/2-base,-.45,.16,tip-foot,.18,C.dark);
    for(let y=foot+.7;y<tip;y+=1.6)part(sign,'box',x,y-base,-.52,1.45,.1,.11,C.stone);
  }
  builder.flush();
  return {x:sign.position.x,z:sign.position.z,base,top:base+(top-bottom)*scale,width:PAYPAL_HILLSIDE.width,letters:6,source:PAYPAL_WORDMARK.source};
}
