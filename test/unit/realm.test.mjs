import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_SIZE, REALM_DISTRICTS, REALM_ROUTE, homeDistrict, realmAccess, bridgeAccess, journeyPosition } from '../../src/core/realm.js';
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

test('districts occupy separate ground across real water gaps and later buildings have larger grounds',()=>{
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
