import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser, familyWith } from '../helpers/family-http.mjs';
const read = async b => (await b.call('GET','/api/state')).json;
const act = (b,action,input={}) => b.call('POST','/api/exchange',{action,...input});
const ok = r => { assert.equal(r.status,200,JSON.stringify(r.json)); return r.json; };
async function village(s) {
  const { owner, Wren } = await familyWith(s,[['Wren','child']]);
  const neighbor=browser(s.origin); await neighbor.createFamily('Willow');
  ok(await act(owner,'create',{name:'Woodland neighbors',alias:'Alder'}));
  const inv=ok(await act(owner,'invite')).invitation;
  ok(await act(neighbor,'join',{token:inv.token,alias:'Willow',confirmed:true}));
  const state=await read(owner);
  ok(await owner.call('PUT','/api/kit',{goalId:state.goal.id,expectedRevision:0,items:[{name:'Tent',needs:'Four people',quantity:1,ownedQuantity:0,from:'typed'}]}));
  const fresh=await read(owner);
  const request=ok(await act(owner,'request',{kitRevision:fresh.kit.revision,lineId:fresh.kit.items[0].id,quantity:1,neededUntil:fresh.goal.targetDate,note:'Weekend camping',confirmed:true}));
  return {owner,neighbor,Wren,requestId:request.requestId,until:fresh.goal.targetDate};
}
test('two families: only handover lowers kit need; duplicate receipt is harmless; return restores need, never money',async()=>{
  const s=await startServer();try{
    const {owner,neighbor,requestId,until}=await village(s), before=await read(owner);
    const offerId=ok(await act(neighbor,'offer',{requestId,quantity:1,kind:'loan',returnBy:until,note:'Tent with pegs'})).offerId;
    assert.equal((await read(owner)).kit.items[0].remaining,1);
    ok(await act(owner,'accept',{requestId,offerId}));
    assert.equal((await read(owner)).kit.items[0].remaining,1);
    assert.equal((await act(neighbor,'receive',{requestId,offerId})).status,403);
    ok(await act(owner,'receive',{requestId,offerId}));ok(await act(owner,'receive',{requestId,offerId}));
    const received=await read(owner);
    assert.equal(received.kit.items[0].remaining,0);assert.equal(received.kit.items[0].sharedQuantity,1);
    assert.equal(received.kit.items[0].ownedQuantity,0);assert.equal(received.kit.revision,before.kit.revision+1);
    assert.deepEqual(received.progress,before.progress);
    assert.equal((await owner.call('PUT','/api/kit',{goalId:before.goal.id,expectedRevision:before.kit.revision,items:before.kit.items})).status,409);
    assert.equal((await act(neighbor,'leave')).status,409);
    assert.equal((await owner.call('PUT','/api/kit',{goalId:before.goal.id,expectedRevision:received.kit.revision,items:[{...received.kit.items[0],name:'Different tent'}]})).status,409);
    ok(await act(owner,'return',{requestId,offerId}));assert.equal((await read(owner)).kit.items[0].remaining,1);
    assert.deepEqual((await read(owner)).progress,before.progress);
    ok(await act(owner,'close',{requestId}));ok(await act(neighbor,'leave'));
    assert.equal((await read(neighbor)).exchange.neighborhood,null);
  }finally{await s.close();}
});
test('invite secrecy, single use, expiry, revocation and explicit consent; outsider and child requests fail closed',async()=>{
  const s=await startServer();try{
    const {owner,neighbor,Wren,requestId,until}=await village(s), outsider=browser(s.origin);await outsider.createFamily('Outsider');
    const token=ok(await act(owner,'invite')).invitation.token;
    assert.ok(!JSON.stringify((await read(owner)).exchange).includes(token));
    assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM exchange_invites').all()).includes(token));
    assert.equal((await act(outsider,'join',{token,alias:'Birch'})).status,400);
    ok(await act(outsider,'preview',{token}));ok(await act(outsider,'join',{token,alias:'Birch',confirmed:true}));
    const stranger=browser(s.origin);await stranger.createFamily('Stranger');
    assert.equal((await act(stranger,'join',{token,alias:'No',confirmed:true})).status,404);
    assert.equal((await act(stranger,'offer',{requestId,quantity:1,kind:'gift'})).status,403);
    assert.equal((await act(Wren,'invite')).status,403);
    assert.equal((await owner.call('POST','/api/exchange',{action:'invite'},{csrf:false})).status,403);
    const offerId=ok(await act(neighbor,'offer',{requestId,quantity:1,kind:'loan',returnBy:until,note:'Only the recipient sees this note'})).offerId;
    const third=(await read(outsider)).exchange;
    assert.doesNotMatch(JSON.stringify(third),/Only the recipient|household_id|goal_id|capture|targetCents/);
    assert.equal(third.requests[0].offers.length,0);
    assert.equal((await act(outsider,'accept',{requestId,offerId})).status,404);
    const inv=ok(await act(owner,'invite')).invitation;ok(await act(owner,'revoke-invite',{inviteId:inv.id}));
    assert.equal((await act(stranger,'preview',{token:inv.token})).status,404);
    const expired=ok(await act(owner,'invite')).invitation;s.clock.advance(25*3600_000);await stranger.signIn();
    assert.equal((await act(stranger,'preview',{token:expired.token})).status,404);
  }finally{await s.close();}
});
test('concurrent accept cannot overfill a need',async()=>{
  const s=await startServer();try{
    const {owner,neighbor,requestId,until}=await village(s), second=browser(s.origin);await second.createFamily('Birch');
    const token=ok(await act(owner,'invite')).invitation.token;ok(await act(second,'join',{token,alias:'Birch',confirmed:true}));
    const a=ok(await act(neighbor,'offer',{requestId,quantity:1,kind:'loan',returnBy:until})).offerId;
    const b=ok(await act(second,'offer',{requestId,quantity:1,kind:'gift'})).offerId;
    const results=await Promise.all([act(owner,'accept',{requestId,offerId:a}),act(owner,'accept',{requestId,offerId:b})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const accepted=s.db.prepare("SELECT id FROM exchange_offers WHERE status='accepted'").get().id;
    ok(await act(owner,'receive',{requestId,offerId:accepted}));
    assert.equal((await read(owner)).kit.items[0].remaining,0);
  }finally{await s.close();}
});

test('a giver may leave after handover without removing the gift or disclosing an alias from a different neighborhood',async()=>{
 const s=await startServer();try{
  const {owner,neighbor,requestId}=await village(s);
  const offerId=ok(await act(neighbor,'offer',{requestId,quantity:1,kind:'gift'})).offerId;
  ok(await act(owner,'accept',{requestId,offerId}));ok(await act(owner,'receive',{requestId,offerId}));
  ok(await act(neighbor,'leave'));ok(await act(neighbor,'create',{name:'Another neighborhood',alias:'PRIVATE_NEW_ALIAS'}));
  const state=await read(owner);assert.equal(state.kit.items[0].remaining,0);
  assert.doesNotMatch(JSON.stringify(state.exchange),/PRIVATE_NEW_ALIAS/);
  assert.equal(state.exchange.requests[0].offers[0].family,'Former neighbor');
  ok(await act(owner,'return',{requestId,offerId}));assert.equal((await read(owner)).kit.items[0].remaining,1);
 }finally{await s.close();}
});


test('a received loan stops covering a goal moved past the return date and invalidates an earlier comparison',async()=>{
  const s=await startServer();try{
    const {owner,neighbor,requestId,until}=await village(s);
    const offerId=ok(await act(neighbor,'offer',{requestId,quantity:1,kind:'loan',returnBy:until})).offerId;
    ok(await act(owner,'accept',{requestId,offerId}));ok(await act(owner,'receive',{requestId,offerId}));
    const before=await read(owner);assert.equal(before.kit.items[0].remaining,0);
    s.db.prepare("UPDATE goals SET target_date='2027-12-31' WHERE id=?").run(before.goal.id);
    const after=await read(owner);assert.equal(after.kit.items[0].remaining,1);
    assert.notEqual(after.kitPlan.revision,before.kitPlan.revision);
    assert.deepEqual(after.progress,before.progress);
  }finally{await s.close();}
});
