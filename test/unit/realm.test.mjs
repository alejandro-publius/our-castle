import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_SIZE, REALM_BOUNDS, REALM_DISTRICTS, REALM_LEGENDS, REALM_BRIDGES, REALM_RIVERS, RIVER_PATHS, REALM_ROUTE, homeDistrict, districtById, viewLocation, realmAccess, bridgeAccess, journeyPosition, riverAt } from '../../src/core/realm.js';
import { courtResidents, courtWorldPose, courtDistrict } from '../../src/core/court.js';

test('nine separate districts remain on the world map while only earned destinations and bridges open',()=>{
  assert.deepEqual(REALM_SIZE,{width:356,depth:260,centerX:32,centerZ:0});
  const start=realmAccess({builtTier:0,estateLevel:1});
  assert.equal(start.length,9);assert.deepEqual(start.filter(d=>d.open).map(d=>d.id),['cottage']);
  assert.ok(bridgeAccess({builtTier:0,estateLevel:1}).every(b=>!b.open));
  const manor={builtTier:1,estateLevel:1};
  assert.ok(bridgeAccess(manor).find(b=>b.id==='manor-bridge').open);
  assert.equal(bridgeAccess(manor).find(b=>b.id==='keep-bridge').open,false);
  assert.equal(realmAccess(manor).find(d=>d.id==='market').open,false);
  assert.ok(realmAccess({...manor,estateLevel:2}).find(d=>d.id==='market').open);
  assert.ok(bridgeAccess({...manor,estateLevel:2}).find(b=>b.id==='market-bridge').open);
  const castle=realmAccess({builtTier:3,estateLevel:3,gardens:0});
  assert.equal(castle.filter(d=>d.open).length,8);
  assert.equal(castle.find(d=>d.id==='garden').open,false,'a castle does not invent a bill habit');
  assert.ok(realmAccess({builtTier:0,gardens:1}).find(d=>d.id==='garden').open);
  assert.match(start.find(d=>d.id==='garden').condition,/reported by you, not provider verified/);
});

test('districts are separate clearings in one woodland and later buildings have larger grounds',()=>{
  for(let i=0;i<REALM_DISTRICTS.length;i++)for(let j=i+1;j<REALM_DISTRICTS.length;j++){
    const a=REALM_DISTRICTS[i],b=REALM_DISTRICTS[j];
    assert.ok(Math.abs(a.x-b.x)>(a.width+b.width)/2||Math.abs(a.z-b.z)>(a.depth+b.depth)/2,`${a.id} and ${b.id} have separate shores`);
  }
  assert.ok(homeDistrict(3).scale>homeDistrict(2).scale);
  assert.ok(homeDistrict(3).width>homeDistrict(0).width);
});

test('the existing 0/5/12/20 journey crosses each corresponding bridge without a teleport',()=>{
  assert.deepEqual(journeyPosition(0),REALM_ROUTE[0]);
  assert.deepEqual(journeyPosition(5),REALM_ROUTE[5]);
  assert.deepEqual(journeyPosition(12),REALM_ROUTE[12]);
  assert.deepEqual(journeyPosition(20),REALM_ROUTE[20]);
  assert.equal(journeyPosition(4.5).z,26);
  assert.ok(journeyPosition(4.5).x>-43&&journeyPosition(4.5).x< -30);
  assert.equal(journeyPosition(11.5).x,-10);
  assert.ok(journeyPosition(11.5).z<8&&journeyPosition(11.5).z> -9);
  let prev=journeyPosition(0);
  for(let i=1;i<=20000;i++){
    const now=journeyPosition(i/1000);
    assert.ok(Math.hypot(now.x-prev.x,now.z-prev.z)<.08,'walking stays continuous, including the final bend around the citadel moat');
    prev=now;
  }
});

test('each generation of guests remains in its own open district as the realm expands',()=>{
  const residents=courtResidents(3);
  for(const person of residents){
    const d=courtDistrict(person),pose=courtWorldPose(person,42);
    assert.equal(pose.district,d.id);
    assert.ok(Math.abs(pose.x-d.x)<d.width/2&&Math.abs(pose.z-d.z)<d.depth/2);
  }
  assert.equal(courtWorldPose(residents[0],42).district,'cottage');
  assert.equal(courtWorldPose(residents.find(p=>p.id==='elowen'),42).district,'manor');
  assert.equal(courtWorldPose(residents.find(p=>p.id==='sorrel'),42).district,'palace');
});

test('narrow connected rivers pass under the middle of every bridge and leave the clearings and most of the realm dry',()=>{
  assert.deepEqual(REALM_RIVERS.map(r=>r.id),['main','west','east','rose','starfall','braid']);
  for(const river of REALM_RIVERS)assert.ok(river.halfWidth<=2.5,`${river.id} is a narrow river, not an open sea`);
  const crossing={'garden-bridge':'main','keep-bridge':'main','royal-procession':'main','manor-bridge':'west','citadel-bridge':'east','market-bridge':'east','palace-bridge':'rose','wizard-bridge':'starfall','rapunzel-bridge':'braid'};
  for(const bridge of REALM_BRIDGES){
    const middle=riverAt((bridge.a[0]+bridge.b[0])/2,(bridge.a[1]+bridge.b[1])/2);
    assert.equal(middle.river,crossing[bridge.id],`${bridge.id} crosses the expected river`);
    assert.ok(middle.depth>middle.halfWidth*.9,`water passes under the middle of ${bridge.id}`);
    for(const end of[bridge.a,bridge.b])assert.ok(riverAt(...end).depth< -2,`${bridge.id} lands on a dry bank`);
  }
  for(const d of REALM_DISTRICTS)for(let x=d.x-d.width/2;x<=d.x+d.width/2;x+=1)for(let z=d.z-d.depth/2;z<=d.z+d.depth/2;z+=1)
    assert.ok(riverAt(x,z).depth< -1.5,`${d.id} clearing stays dry at ${x},${z}`);
  // The tributaries join the main river, and every river runs off the board edge rather than ending in a pond.
  const main=RIVER_PATHS.find(r=>r.id==='main');
  for(const id of['west','east','rose','starfall','braid']){
    const path=RIVER_PATHS.find(r=>r.id===id).path;
    assert.ok(Math.min(...path.map(([x,z])=>Math.min(...main.path.map(([mx,mz])=>Math.hypot(x-mx,z-mz)))))<main.halfWidth,`${id} joins the main river`);
  }
  for(const river of RIVER_PATHS)assert.ok(river.path.filter(([x,z])=>x<=REALM_BOUNDS.minX||x>=REALM_BOUNDS.maxX||z<=REALM_BOUNDS.minZ||z>=REALM_BOUNDS.maxZ).length>=2,`${river.id} reaches the edge`);
  let wet=0,total=0;
  for(let x=REALM_BOUNDS.minX;x<=REALM_BOUNDS.maxX;x+=1)for(let z=REALM_BOUNDS.minZ;z<=REALM_BOUNDS.maxZ;z+=1){total++;if(riverAt(x,z).depth>0)wet++;}
  assert.ok(wet/total<.1,`water covers ${(wet/total*100).toFixed(1)}% of the realm, so green land is the great majority`);
});


test('Rosewind adds a royal destination without moving the earlier homes or creating a bill shortcut',()=>{
  assert.deepEqual(['cottage','manor','market','garden','keep','castle'].map(id=>districtById(id)).map(d=>[d.id,d.x,d.z]),[
    ['cottage',-60,26],['manor',-10,26],['market',44,26],['garden',-60,-28],['keep',-10,-28],['castle',47,-28],
  ]);
  const palace=REALM_DISTRICTS.find(d=>d.id==='palace');
  assert.ok(palace.x>homeDistrict(3).x+homeDistrict(3).width);
  for(const d of REALM_DISTRICTS) {
    assert.ok(d.x-d.width/2>=REALM_BOUNDS.minX&&d.x+d.width/2<=REALM_BOUNDS.maxX);
    assert.ok(d.z-d.depth/2>=REALM_BOUNDS.minZ&&d.z+d.depth/2<=REALM_BOUNDS.maxZ);
  }
  assert.equal(realmAccess({builtTier:2,gardens:4,estateLevel:3}).find(d=>d.id==='palace').open,false);
  assert.equal(bridgeAccess({builtTier:2,gardens:4,estateLevel:3}).find(b=>b.id==='palace-bridge').open,false);
  assert.equal(bridgeAccess({builtTier:3,estateLevel:3}).find(b=>b.id==='palace-bridge').open,true);
  assert.equal(homeDistrict(3).id,'castle','existing final journey still arrives at the Citadel');
  assert.equal(courtResidents(3).length,20);
  assert.equal(courtResidents(3).filter(p=>courtDistrict(p).id==='palace').length,4);
});


test('the folklore towers use existing milestones; the hidden sword has no reward or payment gate',()=>{
  const low=realmAccess({builtTier:1,gardens:4,estateLevel:3});
  assert.equal(low.find(d=>d.id==='wizard').open,false);
  assert.equal(low.find(d=>d.id==='rapunzel').open,false);
  const keep=realmAccess({builtTier:2,estateLevel:3});
  assert.equal(keep.find(d=>d.id==='wizard').open,true);
  assert.equal(keep.find(d=>d.id==='rapunzel').open,false);
  assert.equal(bridgeAccess({builtTier:2,estateLevel:3}).find(b=>b.id==='wizard-bridge').open,true);
  assert.equal(bridgeAccess({builtTier:3,estateLevel:3}).find(b=>b.id==='rapunzel-bridge').open,true);
  assert.deepEqual(REALM_LEGENDS.map(d=>d.id),['sword-stone']);
  assert.equal(districtById('sword-stone'),undefined);
  assert.equal(viewLocation('sword-stone').name,'The Sword in the Stone');
  assert.equal(viewLocation('unknown'),undefined);
  for(const d of REALM_LEGENDS)assert.ok(riverAt(d.x,d.z).depth < -3,'the sword grove stays on dry ground');
  assert.deepEqual(REALM_ROUTE[20],{x:47,z:-16.3});
});
