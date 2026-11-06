import { REALM_INTERIOR, riverAt } from './realm.js';

// Empty outer clearings are scenery, not districts, rewards or financial targets.
export const FRONTIER_CLEARINGS = Object.freeze([
  ...[-60,-10,47,119].map(x=>({x,z:-80})),
  ...[-60,-10,47,131].map(x=>({x,z:80})),
  ...[-28,26].map(z=>({x:-98,z})),
  ...[-28,28].map(z=>({x:162,z})),
].map((p,i)=>Object.freeze({...p,id:`frontier-${i}`,width:24,depth:24})));

export const MOUNTAIN_PEAKS = Object.freeze([
  ...[-99,-66,-32,3,38,73,108,143,168].map((x,i)=>({x,z:-94,rx:23,rz:24,height:18+(i*7)%11})),
  ...[-99,-66,-32,3,38,73,108,143,168].map((x,i)=>({x,z:94,rx:22,rz:23,height:7+(i*3)%6})),
  ...[-81,-48,-15,18,51,84].map((z,i)=>({x:-110,z,rx:24,rz:24,height:17+(i*5)%10})),
  ...[-81,-48,-15,18,51,84].map((z,i)=>({x:174,z,rx:24,rz:23,height:8+(i*3)%7})),
  {x:-31,z:-95,rx:34,rz:23,height:26},
].map(Object.freeze));
export const PAYPAL_HILLSIDE = Object.freeze({x:-31,z:-82,width:44});
const smooth=t=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v);};
export function frontierDepth(x,z) {
  return FRONTIER_CLEARINGS.reduce((best,d)=>Math.max(best,Math.min(d.width/2-Math.abs(x-d.x),d.depth/2-Math.abs(z-d.z),(.89-Math.abs(x-d.x)/d.width-Math.abs(z-d.z)/d.depth)*d.width*.7)),-Infinity);
}
export function terrainElevation(x,z,river=null) {
  const oldX=Math.abs(x-REALM_INTERIOR.centerX)-REALM_INTERIOR.width/2;
  const oldZ=Math.abs(z-REALM_INTERIOR.centerZ)-REALM_INTERIOR.depth/2;
  if(Math.max(oldX,oldZ)<=0)return 0; // Every earlier home, grove, bridge and route stays on its original level.
  let height=0;
  for(const p of MOUNTAIN_PEAKS){
    const dx=Math.abs(x-p.x)/p.rx,dz=Math.abs(z-p.z)/p.rz;
    height=Math.max(height,p.height*Math.pow(Math.max(0,1-dx-dz),1.12),p.height*.18*Math.max(0,1-dx*dx/2-dz*dz/2));
  }
  const water=river??riverAt(x,z);
  return height*smooth(Math.max(oldX,oldZ)/8)*smooth((-frontierDepth(x,z)-.25)/4)*smooth((water.distance-water.halfWidth-1.8)/5);
}
