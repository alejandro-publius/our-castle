// Scenic coordinates only: these never become districts, payment milestones or ledger rewards.
export const WOODLAND_CAMP = Object.freeze({x:-154,z:-47,width:16,depth:15,height:5});
export const WOODLAND_GLADE = Object.freeze({x:220,z:-53,width:18,depth:18,height:7});
export const MIST_GROVES = Object.freeze([
  Object.freeze({x:-154,z:-47,rx:24,rz:21}),
  Object.freeze({x:220,z:-53,rx:22,rz:24}),
]);
export const WATERFALLS = Object.freeze([
  Object.freeze({id:'west-spring',x:-141,z:3,axis:'x',height:9,width:3.4,run:5,river:'main'}),
  Object.freeze({id:'rose-spring',x:82,z:-121,axis:'z',height:11,width:2.6,run:5,river:'rose'}),
]);
export const inDiscoveryClearing = (x,z) => Math.hypot(x-WOODLAND_CAMP.x,z-WOODLAND_CAMP.z)<9
  || Math.hypot(x-WOODLAND_GLADE.x,z-WOODLAND_GLADE.z)<10
  || WATERFALLS.some(f=>Math.hypot(x-f.x,z-f.z)<8);
