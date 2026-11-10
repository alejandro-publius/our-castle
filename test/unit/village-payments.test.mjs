import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createClock, DEMO_HOUSEHOLD_ID } from '../../server/household.mjs';
import { createVillagePayments, ensureVillagePaymentsSchema } from '../../server/payments/village-payments.mjs';
import { createPayPalClient, PayPalError } from '../../server/payments/paypal-client.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { paypalAuthAssertion } from '../../server/payments/recipient.mjs';

const scope={householdId:DEMO_HOUSEHOLD_ID,memberId:'m_rowan'}, recipient={kind:'paypal',merchantId:'TESTMERCHANT01',revision:1};
const outsider={householdId:'hh_outside',memberId:'m_grandma'};
function fixture({rail='paypal-sandbox'}={}) {
  const db=new DatabaseSync(':memory:'),clock=createClock('2026-11-10T12:00:00Z');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE members(id TEXT,household_id TEXT,display_name TEXT,role TEXT,is_example INTEGER,avatar_id TEXT,sort INTEGER);
    INSERT INTO members VALUES('m_rowan','${DEMO_HOUSEHOLD_ID}','Rowan','adult',1,'',0),('m_wren','${DEMO_HOUSEHOLD_ID}','Wren','child',1,'',1),
      ('m_grandma','hh_outside','Grandma','adult',1,'',0),('m_other','hh_outside','Other adult','adult',1,'',1);
    CREATE TABLE ledger_entries(id TEXT);`);
  // B owns fund storage; these tests exercise A against the callback contract with durable receipt facts.
  db.exec("CREATE TABLE IF NOT EXISTS village_funds(id TEXT PRIMARY KEY); INSERT INTO village_funds(id) VALUES('fund_test'); CREATE TABLE test_receipts(event_ref TEXT PRIMARY KEY,kind TEXT,amount INTEGER,family_household_id TEXT);");
  ensureVillagePaymentsSchema(db);
  const c={fundId:'fund_test',rail,targetMinor:3000,currency:'USD',decimals:2,remainingMinor:3000,recipient:rail==='simulated'?null:{...recipient},revision:1,status:'open',published:true};
  const members=new Set([scope.householdId]);
  const calls=[],orders=new Map(); let sequence=0;
  const paypal={environment:'sandbox',async createOrder(input){input.assertAccess?.();calls.push(['create',input]);let data=orders.get(input.requestId);
    if(!data){data={id:`ORDER${++sequence}`,status:'CREATED',purchase_units:[{reference_id:input.localId,custom_id:input.localId,payee:{merchant_id:input.recipient.merchantId},amount:{currency_code:'USD',value:(input.amountCents/100).toFixed(2)}}],links:[{rel:'approve',href:`https://www.sandbox.paypal.com/checkoutnow?token=ORDER${sequence}`}]};orders.set(input.requestId,data);orders.set(data.id,data);}return {data:structuredClone(data)};},
    async getOrder(id,input={}){input.assertAccess?.();calls.push(['read',id]);return{data:structuredClone(orders.get(id))};},
    async captureOrder(id,input){input.assertAccess?.();calls.push(['capture',input]);const d=orders.get(id);d.status='COMPLETED';d.purchase_units[0].payments={captures:[{id:`CAPTURE${id}`,status:'COMPLETED',amount:d.purchase_units[0].amount}]};return{data:structuredClone(d)};}};
  const recordReceipt=e=>{db.prepare('INSERT OR IGNORE INTO test_receipts VALUES(?,?,?,?)').run(e.eventRef,e.kind,e.amountMinor,e.familyHouseholdId);c.remainingMinor=3000-db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0) AS n FROM test_receipts").get().n;c.revision++;return{receipt:{eventRef:e.eventRef,amountMinor:e.amountMinor,familyHouseholdId:e.familyHouseholdId},changedHouseholds:[scope.householdId]};};
  const contextFor=(s,id,{allowSettled=false}={})=>{
    assert.equal(id,c.fundId);const viewerMember=members.has(s.householdId);
    const held=allowSettled&&db.prepare('SELECT 1 FROM village_payment_intents WHERE fund_id=? AND household_id=? AND member_id=?').get(id,s.householdId,s.memberId);
    if(!viewerMember&&!c.published&&!held)throw Object.assign(Error('not published'),{code:'village_fund'});
    if(!allowSettled&&c.remainingMinor<=0)throw Error('full');
    return{...c,viewerMember,attributionHouseholdId:viewerMember?s.householdId:null,recipient:c.recipient&&{...c.recipient}};
  };
  const service=()=>createVillagePayments({db,clock,paypal,contextFor,recordReceipt});
  const input=(extra={})=>({scope,fundId:c.fundId,amountMinor:1500,approvalConfirmed:true,expectedRevision:1,requestId:'request_test_001',...extra});
  return{db,clock,c,members,calls,orders,paypal,service:service(),restart:service,input};
}

test('village sandbox intent freezes recipient and adult-approved amount; capture is checked and credited once across restarts',async()=>{
  const e=fixture();try{
    const {contribution}=await e.service.create(e.input());assert.equal(contribution.status,'created');assert.equal(e.c.remainingMinor,3000);
    assert.equal(e.calls[0][1].recipient.merchantId,recipient.merchantId);
    const out=await e.service.capture({scope,orderId:contribution.id});assert.equal(out.contribution.status,'completed');assert.equal(e.c.remainingMinor,1500);
    e.c.revision+=3; // Another family's share/contribution is unrelated to this frozen payment destination.
    const again=await e.restart().capture({scope,orderId:contribution.id});assert.equal(again.contribution.captureId,out.contribution.captureId);
    await e.restart().create(e.input());await e.restart().check({scope,orderId:contribution.id});
    assert.equal(e.calls.filter(c=>c[0]==='capture').length,1);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,1);
    assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n,0,'no household credit');
  }finally{e.db.close();}
});

test('simulated contribution uses the same approval and durable retry rules after fully funding the project',async()=>{
  const e=fixture({rail:'simulated'});try{
    const input=e.input({amountMinor:3000});const a=await e.service.create(input);assert.equal(a.contribution.status,'completed');assert.equal(e.c.remainingMinor,0);
    const b=await e.restart().create(input);assert.equal(b.contribution.id,a.contribution.id);assert.equal(e.calls.length,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,1);
  }finally{e.db.close();}
});

test('child, missing approval, changed amount and stale new approval are refused before provider calls',async()=>{
  const e=fixture();try{
    await assert.rejects(e.service.create(e.input({scope:{...scope,memberId:'m_wren'}})),x=>x.code==='adult_required');
    await assert.rejects(e.service.create(e.input({approvalConfirmed:false})),x=>x.code==='approval_required');
    await assert.rejects(e.service.create(e.input({expectedRevision:0})),x=>x.code==='fund_changed');assert.equal(e.calls.length,0);
    await e.service.create(e.input());
    await assert.rejects(e.service.create(e.input({amountMinor:1600})),x=>x.code==='request_conflict');assert.equal(e.calls.filter(c=>c[0]==='create').length,1);
  }finally{e.db.close();}
});

test('pending approvals reserve capacity across service instances; unrelated progress does not invalidate an intent',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input({amountMinor:2000}));
    await assert.rejects(e.restart().create(e.input({amountMinor:1500,requestId:'request_test_002'})),x=>x.code==='fund_remaining');
    e.c.revision++;e.c.remainingMinor=2500;
    const out=await e.service.capture({scope,orderId:a.contribution.id});assert.equal(out.contribution.status,'completed');
  }finally{e.db.close();}
});

test('a different server-resolved merchant or provider payee is refused before charging',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input());e.c.recipient={...recipient,merchantId:'OTHERSELLER01'};
    await assert.rejects(e.service.capture({scope,orderId:a.contribution.id}),x=>x.code==='recipient_changed');
    e.c.recipient={...recipient};e.orders.get(a.contribution.providerOrderId).purchase_units[0].payee.merchant_id='OTHERSELLER01';
    await assert.rejects(e.service.capture({scope,orderId:a.contribution.id}),x=>x.code==='village_provider_mismatch');
    assert.equal(e.calls.filter(c=>c[0]==='capture').length,0);assert.equal(e.c.remainingMinor,3000);
  }finally{e.db.close();}
});

test('provider timeout after capture reconciles the same order without a second payment',async()=>{
  const e=fixture();try{
    const original=e.paypal.captureOrder;e.paypal.captureOrder=async(...args)=>{await original(...args);throw new PayPalError('fixture',{name:'TIMEOUT'});};
    const a=await e.service.create(e.input());const out=await e.service.capture({scope,orderId:a.contribution.id});assert.equal(out.contribution.status,'completed');assert.equal(e.c.remainingMinor,1500);
  }finally{e.db.close();}
});

test('resume uses only the stored approval and durable provider key after a lost response and restart',async()=>{
  const e=fixture();try{
    const create=e.paypal.createOrder;let first=true;e.paypal.createOrder=async input=>{const result=await create(input);if(first){first=false;throw new PayPalError('fixture',{name:'TIMEOUT'});}return result;};
    const a=await e.service.create(e.input());assert.equal(a.outcome,'unknown');assert.equal(a.contribution.providerOrderId,null);
    const b=await e.restart().resume({scope,orderId:a.contribution.id,amountMinor:9999,requestId:'different_request',fundId:'wrong_fund'});assert.equal(b.contribution.id,a.contribution.id);assert.equal(b.contribution.providerOrderId,'ORDER1');
    assert.equal(new Set(e.calls.filter(c=>c[0]==='create').map(c=>c[1].requestId)).size,1);
    assert.equal(b.contribution.amountMinor,1500);assert.equal(Object.hasOwn(b.contribution,'requestId'),false);
  }finally{e.db.close();}
});

test('an unknown create outcome cannot replay after six hours and its reservation stays held',async()=>{
  const e=fixture();try{
    const create=e.paypal.createOrder;e.paypal.createOrder=async input=>{await create(input);throw new PayPalError('fixture',{name:'TIMEOUT'});};
    const a=await e.service.create(e.input());assert.equal(a.outcome,'unknown');
    e.clock.now=()=>new Date('2026-11-10T18:00:00Z');
    await assert.rejects(e.restart().resume({scope,orderId:a.contribution.id}),x=>x.code==='village_reconcile_required');
    await assert.rejects(e.restart().create(e.input()),x=>x.code==='village_reconcile_required');
    await assert.rejects(e.service.create(e.input({requestId:'another_request',amountMinor:2000})),x=>x.code==='fund_remaining');
    assert.equal(e.calls.filter(c=>c[0]==='create').length,1);assert.equal(e.service.list({scope,fundId:'fund_test'})[0].status,'pending');
    assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,0);
  }finally{e.db.close();}
});

test('an existing provider order remains checkable and capturable after the create replay window',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input());e.clock.now=()=>new Date('2026-11-11T12:00:00Z');
    await e.restart().resume({scope,orderId:a.contribution.id});
    const out=await e.restart().capture({scope,orderId:a.contribution.id});assert.equal(out.contribution.status,'completed');
    assert.equal(e.calls.filter(c=>c[0]==='create').length,1);assert.equal(e.calls.filter(c=>c[0]==='capture').length,1);
  }finally{e.db.close();}
});

test('an outside adult can contribute without exposing payer identity or attributing it to an unrelated family',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input({scope:outsider}));
    const row=e.db.prepare('SELECT household_id,member_id,attribution_household_id FROM village_payment_intents WHERE id=?').get(a.contribution.id);
    assert.equal(row.household_id,outsider.householdId);assert.equal(row.member_id,outsider.memberId);assert.equal(row.attribution_household_id,null);
    // Joining later cannot change the meaning of a previously approved outside contribution.
    e.members.add(outsider.householdId);
    const out=await e.restart().capture({scope:outsider,orderId:a.contribution.id});assert.equal(out.receipt.familyHouseholdId,null);
    const unit=e.orders.get(a.contribution.providerOrderId).purchase_units[0];unit.payments.captures[0].status='REFUNDED';unit.payments.refunds=[{id:'OUTSIDE_REFUND',status:'COMPLETED',amount:unit.amount}];
    await e.restart().check({scope:outsider,orderId:a.contribution.id});
    assert.deepEqual(e.db.prepare('SELECT family_household_id FROM test_receipts').all().map(r=>r.family_household_id),[null,null]);
    assert.equal(JSON.stringify(out).includes(outsider.householdId),false);assert.equal(JSON.stringify(out).includes(outsider.memberId),false);
    const before=e.calls.length;
    for(const otherScope of [scope,{...outsider,memberId:'m_other'}]){
      await assert.rejects(e.service.check({scope:otherScope,orderId:a.contribution.id}),x=>x.code==='village_order');
      await assert.rejects(e.service.resume({scope:otherScope,orderId:a.contribution.id}),x=>x.code==='village_order');
      assert.deepEqual(e.service.list({scope:otherScope,fundId:'fund_test'}),[]);
    }
    assert.equal(e.calls.length,before);
  }finally{e.db.close();}
});

test('unpublishing blocks new outside approvals and capture dispatch but preserves existing provider truth',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input({scope:outsider}));e.c.published=false;
    await assert.rejects(e.service.create(e.input({scope:outsider,requestId:'outside_new_request'})),x=>x.code==='village_fund');
    await assert.rejects(e.service.capture({scope:outsider,orderId:a.contribution.id}),x=>x.code==='fund_unpublished');
    assert.equal(e.calls.filter(c=>c[0]==='capture').length,0);
    // The organizer can stop new dispatch; already-completed provider facts must still be reconciled.
    await e.paypal.captureOrder(a.contribution.providerOrderId,{});
    const out=await e.restart().check({scope:outsider,orderId:a.contribution.id});assert.equal(out.contribution.status,'completed');assert.equal(out.receipt.familyHouseholdId,null);
    assert.equal(e.service.list({scope:outsider,fundId:'fund_test'}).length,1);
  }finally{e.db.close();}
});

test('outside create and capture guards recheck publication after asynchronous provider authentication',async()=>{
  const e=fixture();try{
    const create=e.paypal.createOrder;e.paypal.createOrder=async input=>{e.c.published=false;return create(input);};
    await assert.rejects(e.service.create(e.input({scope:outsider})),x=>x.code==='fund_unpublished');assert.equal(e.calls.length,0);
    const pending=e.service.list({scope:outsider,fundId:'fund_test'})[0];
    await assert.rejects(e.restart().resume({scope:outsider,orderId:pending.id}),x=>x.code==='fund_unpublished');
    e.c.published=true;e.paypal.createOrder=create;
    const a=await e.restart().resume({scope:outsider,orderId:pending.id});
    const capture=e.paypal.captureOrder;e.paypal.captureOrder=async(id,input)=>{e.c.published=false;return capture(id,input);};
    await assert.rejects(e.service.capture({scope:outsider,orderId:a.contribution.id}),x=>x.code==='fund_unpublished');
    assert.equal(e.calls.filter(c=>c[0]==='capture').length,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,0);
  }finally{e.db.close();}
});

test('simulated outside contributions preserve null attribution with no provider request',async()=>{
  const e=fixture({rail:'simulated'});try{
    const a=await e.service.create(e.input({scope:outsider}));assert.equal(a.contribution.status,'completed');assert.equal(a.receipt.familyHouseholdId,null);
    assert.equal(e.db.prepare('SELECT attribution_household_id FROM village_payment_intents').get().attribution_household_id,null);assert.equal(e.calls.length,0);
  }finally{e.db.close();}
});

test('a fund closed while awaiting PayPal review cannot dispatch a fresh capture',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input());e.c.status='closed';e.c.revision++;
    await assert.rejects(e.service.capture({scope,orderId:a.contribution.id}),x=>x.code==='fund_closed');
    assert.equal(e.calls.filter(c=>c[0]==='capture').length,0);
  }finally{e.db.close();}
});

test('verified refunds are recorded before a late completion, and a provider mismatch produces no receipt',async()=>{
  const e=fixture();try{
    const a=await e.service.create(e.input()),id=a.contribution.providerOrderId;await e.paypal.captureOrder(id,{});
    const unit=e.orders.get(id).purchase_units[0];unit.payments.captures[0].status='REFUNDED';unit.payments.refunds=[{id:'REFUND01',status:'COMPLETED',amount:unit.amount}];
    const out=await e.service.check({scope,orderId:a.contribution.id});assert.equal(out.contribution.status,'completed');assert.equal(e.c.remainingMinor,3000);
    assert.deepEqual(e.db.prepare('SELECT kind FROM test_receipts ORDER BY rowid').all().map(x=>x.kind),['refund','capture']);
    unit.amount.value='99.99';await assert.rejects(e.service.check({scope,orderId:a.contribution.id}),x=>x.code==='village_provider_mismatch');
  }finally{e.db.close();}
});

test('access lost during an asynchronous approval cannot dispatch a payment',async()=>{
  const e=fixture();try{
    let active=true;const p=e.service.create(e.input({assertAccess:()=>{if(!active)throw Error('signed out');}}));active=false;
    await assert.rejects(p,/signed out/);assert.equal(e.calls.length,0);
  }finally{e.db.close();}
});

for(const adapter of ['rest','sdk']) test(`${adapter} recipient wire contract preserves merchant, scoped assertion and access guard`,async()=>{
  const calls=[];const body={id:'ORDER1',status:'CREATED',purchase_units:[]};
  const answer=(url,method,headers,data)=>{calls.push({url,method,headers,data});return url.endsWith('/oauth2/token')?{access_token:'fake-token',expires_in:3600,token_type:'Bearer'}:body;};
  const fetch=async(url,init)=>new Response(JSON.stringify(answer(url,init.method,init.headers,init.body)),{status:200,headers:{'content-type':'application/json'}});
  const httpAdapter=async config=>({config,status:200,statusText:'OK',headers:{'content-type':'application/json'},data:JSON.stringify(answer(config.url,config.method,config.headers.toJSON(),config.data))});
  const args={clientId:'fake-id',clientSecret:'fake-secret'};
  const client=adapter==='rest'?createPayPalClient({...args,fetch}):createPayPalSdkClient({...args,httpAdapter,restFetch:fetch});
  let guards=0;const guard=()=>{guards++;};
  await client.createOrder({localId:'vpay_fixture',amountCents:1500,currency:'USD',description:'Village',requestId:'create-fixture',recipient,assertAccess:guard});
  await client.getOrder('ORDER1',{recipient,assertAccess:guard});await client.captureOrder('ORDER1',{recipient,requestId:'capture-fixture',assertAccess:guard});
  const operations=calls.filter(c=>!c.url.endsWith('/oauth2/token'));const request=JSON.parse(operations[0].data);
  assert.deepEqual(request.purchase_units[0].payee,{merchant_id:recipient.merchantId});
  for(const c of operations){const h=Object.fromEntries(Object.entries(c.headers).map(([k,v])=>[k.toLowerCase(),v]));assert.equal(h['paypal-auth-assertion'],paypalAuthAssertion('fake-id',recipient));assert.equal(new URL(c.url).origin,'https://api-m.sandbox.paypal.com');}
  assert.ok(guards>=3);
});
