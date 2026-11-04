import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_SIZE, REALM_DISTRICTS, REALM_BRIDGES, REALM_RIVERS, RIVER_PATHS, REALM_ROUTE, homeDistrict, realmAccess, bridgeAccess, journeyPosition, riverAt } from '../../src/core/realm.js';
import { courtResidents, courtWorldPose } from '../../src/core/court.js';

test('six separate districts remain on the world map while only earned destinations and bridges open',()=>{
  assert.deepEqual(REALM_SIZE,{width:164,depth:114});
  const start=realmAccess({builtTier:0,estateLevel:1});
  assert.equal(start.length,6);assert.deepEqual(start.filter(d=>d.open).map(d=>d.id),['cottage']);
  assert.ok(bridgeAccess({builtTier:0,estateLevel:1}).every(b=>!b.open));
  const manor={builtTier:1,estateLevel:1};
  assert.ok(bridgeAccess(manor).find(b=>b.id==='manor-bridge').open);
  assert.equal(bridgeAccess(manor).find(b=>b.id==='keep-bridge').open,false);
  assert.equal(realmAccess(manor).find(d=>d.id==='market').open,false);
  assert.ok(realmAccess({...manor,estateLevel:2}).find(d=>d.id==='market').open);
  assert.ok(bridgeAccess({...manor,estateLevel:2}).find(b=>b.id==='market-bridge').open);
  const castle=realmAccess({builtTier:3,estateLevel:3,gardens:0});
  assert.equal(castle.filter(d=>d.open).length,5);
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
    const d=homeDistrict(person.tier),pose=courtWorldPose(person,42);
    assert.equal(pose.district,d.id);
    assert.ok(Math.abs(pose.x-d.x)<d.width/2&&Math.abs(pose.z-d.z)<d.depth/2);
  }
  assert.equal(courtWorldPose(residents[0],42).district,'cottage');
  assert.equal(courtWorldPose(residents.find(p=>p.id==='elowen'),42).district,'manor');
  assert.equal(courtWorldPose(residents.find(p=>p.id==='sorrel'),42).district,'castle');
});

test('narrow connected rivers pass under the middle of every bridge and leave the clearings and most of the realm dry',()=>{
  assert.deepEqual(REALM_RIVERS.map(r=>r.id),['main','west','east']);
  for(const river of REALM_RIVERS)assert.ok(river.halfWidth<=2.5,`${river.id} is a narrow river, not an open sea`);
  const crossing={'garden-bridge':'main','keep-bridge':'main','royal-procession':'main','manor-bridge':'west','citadel-bridge':'east','market-bridge':'east'};
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
  for(const id of['west','east']){
    const path=RIVER_PATHS.find(r=>r.id===id).path;
    assert.ok(Math.min(...path.map(([x,z])=>Math.min(...main.path.map(([mx,mz])=>Math.hypot(x-mx,z-mz)))))<main.halfWidth,`${id} joins the main river`);
  }
  for(const river of RIVER_PATHS)assert.ok(river.path.filter(([x,z])=>Math.abs(x)>=REALM_SIZE.width/2||Math.abs(z)>=REALM_SIZE.depth/2).length>=2,`${river.id} reaches the edge`);
  let wet=0,total=0;
  for(let x=-82;x<=82;x+=.5)for(let z=-57;z<=57;z+=.5){total++;if(riverAt(x,z).depth>0)wet++;}
  assert.ok(wet/total<.1,`water covers ${(wet/total*100).toFixed(1)}% of the realm, so green land is the great majority`);
});
