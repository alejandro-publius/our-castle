import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser, familyWith } from '../helpers/family-http.mjs';

const state=async b=>(await b.call('GET','/api/state')).json;
const act=(b,action,data={})=>b.call('POST','/api/exchange',{action,...data});
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.json));return r.json;};
const browse=async(b,q='')=>ok(await b.call('GET',`/api/exchange/requests${q}`));
async function request(b,{alias='Alder',country='Canada',visibility='neighborhood',note='An electric stove'}={}){
  ok(await act(b,'settings',{alias,country,visibility,confirmed:visibility==='worldwide'}));
  let s=await state(b);
  ok(await b.call('PUT','/api/kit',{goalId:s.goal.id,expectedRevision:0,items:[{name:'Stove',quantity:1,ownedQuantity:0,from:'typed'}]}));
  s=await state(b);
  return ok(await act(b,'request',{kitRevision:s.kit.revision,lineId:s.kit.items[0].id,quantity:1,neededUntil:s.goal.targetDate,note,confirmed:true})).requestId;
}

test('worldwide is explicit adult opt-in; private requests, identifiers and notes never enter directory reads',async()=>{
  const s=await startServer();try{
    const {owner,Wren}=await familyWith(s,[['Wren','child']]);
    const visitor=browser(s.origin);await visitor.createFamily('Visitor');
    const id=await request(owner,{note:'PRIVATE_NEIGHBOR_NOTE'});
    assert.deepEqual((await browse(visitor)).requests,[]);
    assert.equal((await visitor.call('GET',`/api/exchange/requests/${id}`)).status,404);
    assert.equal((await browser(s.origin).call('GET','/api/exchange/requests')).status,401);
    assert.equal((await act(Wren,'settings',{alias:'Alder',visibility:'worldwide',confirmed:true})).status,403);
    assert.equal((await act(owner,'settings',{alias:'Alder',visibility:'worldwide'})).status,400);
    assert.equal((await owner.call('POST','/api/exchange',{action:'settings',alias:'Alder',visibility:'worldwide',confirmed:true},{csrf:false})).status,403);
    assert.deepEqual((await browse(visitor)).requests,[]);
    ok(await act(owner,'settings',{alias:'Alder shared name',country:'Canada',visibility:'worldwide',confirmed:true}));
    const published=(await browse(visitor)).requests[0];
    assert.equal(published.id,id);assert.equal(published.family,'Alder shared name');assert.equal(published.note,'PRIVATE_NEIGHBOR_NOTE');
    assert.doesNotMatch(JSON.stringify(published),/household_id|goal_id|targetCents|payment_orders|ledger_entries/);
    assert.equal((await browse(Wren)).requests.length,1);
  }finally{await s.close();}
});

test('same item and same alias still have distinct stable family and request references, searchable by their displayed ID',async()=>{
  const s=await startServer();try{
    const a=browser(s.origin),b=browser(s.origin);await a.createFamily('One');await b.createFamily('Two');
    await request(a,{alias:'Alder',visibility:'worldwide'});await request(b,{alias:'Alder',country:'Portugal',visibility:'worldwide'});
    const rows=(await browse(a,'?q=stove')).requests;
    assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.reference)).size,2);assert.equal(new Set(rows.map(r=>r.familyReference)).size,2);
    for(const r of rows){
      assert.equal((await browse(a,`?q=${r.reference}`)).requests[0].id,r.id);
      assert.equal((await browse(a,`?q=${r.familyReference}`)).requests[0].id,r.id);
      assert.equal(ok(await a.call('GET',`/api/exchange/requests/${r.id}`)).request.reference,r.reference);
    }
    assert.equal((await browse(a,'?q=Portugal')).requests.length,1);
  }finally{await s.close();}
});

test('cross-neighborhood offers stay private, survive unpublishing for participants, and never become money',async()=>{
  const s=await startServer();try{
    const a=browser(s.origin),b=browser(s.origin),c=browser(s.origin);
    for(const [p,name] of [[a,'Alder'],[b,'Willow'],[c,'Other']])await p.createFamily(name);
    const id=await request(a,{visibility:'worldwide'});
    ok(await act(b,'settings',{alias:'Willow',country:'Canada',visibility:'neighborhood'}));
    const before=await state(a);
    const offerId=ok(await act(b,'offer',{requestId:id,kind:'gift',quantity:1,note:'PRIVATE_OFFER_DETAILS'})).offerId;
    assert.doesNotMatch(JSON.stringify(await browse(c)),/PRIVATE_OFFER_DETAILS/);
    assert.equal((await browse(c)).requests[0].offers.length,0);
    assert.match(JSON.stringify((await state(a)).exchange),/PRIVATE_OFFER_DETAILS/);
    ok(await act(a,'settings',{alias:'Alder',visibility:'neighborhood'}));
    assert.equal((await browse(c)).requests.length,0);
    assert.equal((await c.call('GET',`/api/exchange/requests/${id}`)).status,404);
    assert.equal((await b.call('GET',`/api/exchange/requests/${id}`)).status,200);
    assert.equal((await act(b,'offer',{requestId:id,kind:'gift',quantity:1})).status,404);
    ok(await act(a,'accept',{requestId:id,offerId}));ok(await act(a,'receive',{requestId:id,offerId}));
    ok(await act(a,'receive',{requestId:id,offerId}));
    const after=await state(a);assert.equal(after.kit.items[0].remaining,0);
    assert.deepEqual(after.progress,before.progress);assert.deepEqual(after.contributions,before.contributions);
    assert.equal((await act(b,'receive',{requestId:id,offerId})).status,403);
    ok(await act(a,'return',{requestId:id,offerId}));assert.equal((await state(a)).kit.items[0].remaining,1);
  }finally{await s.close();}
});

test('directory pages are bounded; private rows do not leak through search, page counts or detail IDs',async()=>{
  const s=await startServer();try{
    const a=browser(s.origin),b=browser(s.origin),c=browser(s.origin);
    for(const [p,name] of [[a,'One'],[b,'Two'],[c,'Private']])await p.createFamily(name);
    for(const p of [a,b]){
      const id=await request(p,{visibility:'worldwide'});
      // Additional independent directory fixtures under two groups, each below the 24-open-request cap.
      const r=s.db.prepare('SELECT * FROM exchange_requests WHERE id=?').get(id);
      const insert=s.db.prepare('INSERT INTO exchange_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
      for(let i=0;i<15;i++)insert.run(`need_${r.id.slice(5)}_${i}`,r.circle_id,r.household_id,r.goal_id,`line_${i}`,`Item ${i}`,null,1,r.needed_until,'Sample directory fixture','open',r.created_at);
    }
    await request(c,{note:'HIDDEN_NEED'});
    const first=await browse(a);assert.equal(first.requests.length,30);assert.equal(first.nextOffset,30);
    const second=await browse(a,'?offset=30');assert.equal(second.requests.length,2);assert.equal(second.nextOffset,null);
    assert.equal(new Set([...first.requests,...second.requests].map(r=>r.id)).size,32);
    assert.deepEqual((await browse(a,'?q=HIDDEN_NEED')).requests,[]);
    assert.equal((await a.call('GET','/api/exchange/requests?offset=-1')).status,400);
  }finally{await s.close();}
});
