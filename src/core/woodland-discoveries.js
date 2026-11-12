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
// A few hand-placed wayside miniatures. Their footprint clears undergrowth only;
// none is a district, a reward, a payment destination or a new map control.
export const WAYSIDE_SITES = Object.freeze([
  Object.freeze({id:'woodcutters-shelter',kind:'shelter',x:-67,z:-57,radius:6}),
  Object.freeze({id:'wayfarers-well',kind:'well',x:-78,z:46,radius:3.6}),
  Object.freeze({id:'alder-outrider',kind:'rider',x:-47,z:-55,radius:3.5}),
  Object.freeze({id:'village-fallen-oak',kind:'timber',x:-51,z:12,radius:3,angle:.24}),
  Object.freeze({id:'keep-fallen-birch',kind:'timber',x:-30,z:-20,radius:3,angle:-.35}),
  // Outer meadows: each sits in the centre of an existing frontier clearing.
  Object.freeze({id:'tourney-field',kind:'tourney',x:47,z:80,radius:11}),
  Object.freeze({id:'hay-meadow',kind:'hay',x:-10,z:80,radius:10}),
  Object.freeze({id:'standing-stones',kind:'stones',x:131,z:80,radius:8.5}),
  Object.freeze({id:'border-watchtower',kind:'watchtower',x:162,z:-28,radius:6}),
  Object.freeze({id:'shepherds-fold',kind:'fold',x:-60,z:-80,radius:9}),
  Object.freeze({id:'apple-orchard',kind:'orchard',x:-10,z:-80,radius:9}),
  Object.freeze({id:'archery-butts',kind:'butts',x:47,z:-80,radius:9}),
  Object.freeze({id:'ruined-chapel',kind:'ruin',x:119,z:-80,radius:8}),
  Object.freeze({id:'mill-pond',kind:'pond',x:-98,z:-28,radius:8}),
  Object.freeze({id:'border-windmill',kind:'windmill',x:162,z:28,radius:7}),
]);
export const inDiscoveryClearing = (x,z) => Math.hypot(x-WOODLAND_CAMP.x,z-WOODLAND_CAMP.z)<9
  || Math.hypot(x-WOODLAND_GLADE.x,z-WOODLAND_GLADE.z)<10
  || WATERFALLS.some(f=>Math.hypot(x-f.x,z-f.z)<8)
  || WAYSIDE_SITES.some(s=>Math.hypot(x-s.x,z-s.z)<s.radius+1.3);
