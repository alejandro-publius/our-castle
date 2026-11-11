import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createClock } from '../../server/household.mjs';
import { createVaultWatcher, ensureVaultSchema } from '../../server/vault/index.mjs';
import { createDevnetRpc, DEVNET_RPC, PYUSD_DEVNET_MINT, TOKEN_2022_PROGRAM, extractDevnetTransfers, validBase58 } from '../../server/vault/devnet.mjs';

function base58(n,length=32){const bytes=Buffer.alloc(length,n);let value=BigInt(`0x${bytes.toString('hex')}`),out='';const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';while(value){out=alphabet[Number(value%58n)]+out;value/=58n;}return out;}
const wallet=base58(1),sourceOwner=base58(2),destination=base58(3),source=base58(4),signature=n=>base58(n,64);
function transaction(sig,slot,amounts=[15000000],mint=PYUSD_DEVNET_MINT){
  const total=amounts.reduce((a,b)=>a+b,0),balance=(accountIndex,owner,amount)=>({accountIndex,mint,owner,programId:TOKEN_2022_PROGRAM,uiTokenAmount:{amount:String(amount),decimals:6}});
  return {slot,meta:{err:null,preTokenBalances:[balance(0,sourceOwner,total),balance(1,wallet,0)],postTokenBalances:[balance(0,sourceOwner,0),balance(1,wallet,total)],innerInstructions:[]},
    transaction:{signatures:[sig],message:{accountKeys:[{pubkey:source},{pubkey:destination}],instructions:amounts.map(amount=>({programId:TOKEN_2022_PROGRAM,parsed:{type:'transferChecked',info:{source,destination,mint,tokenAmount:{amount:String(amount),decimals:6}}}}))}}};
}
function fixture(options={}){
  const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE village_funds(id TEXT PRIMARY KEY);INSERT INTO village_funds VALUES('fund_test');CREATE TABLE test_receipts(event_ref TEXT,instruction_path TEXT,amount INTEGER,family TEXT,PRIMARY KEY(event_ref,instruction_path));");ensureVaultSchema(db);
  const clock=createClock('2026-11-10T12:00:00Z'),calls=[],state={slot:100,signatures:[],transactions:new Map(),badMint:false,badOwner:false,missing:false,failRecord:false};
  const recipient={kind:'solana-devnet',address:wallet,revision:1};
  const contextFor=(scope,id)=>({fundId:id,rail:'pyusd-devnet',currency:'PYUSD',decimals:6,recipient,revision:99});
  const rpc=async(method,params)=>{
    calls.push({method,params});
    if(method==='getAccountInfo')return{value:{owner:state.badMint?'wrong':TOKEN_2022_PROGRAM,data:{parsed:{type:'mint',info:{decimals:6,isInitialized:true}}}}};
    if(method==='getSlot')return state.slot;
    if(method==='getTokenAccountsByOwner')return{context:{slot:state.slot},value:[{pubkey:destination,account:{owner:TOKEN_2022_PROGRAM,data:{parsed:{type:'account',info:{owner:state.badOwner?sourceOwner:wallet,mint:PYUSD_DEVNET_MINT,tokenAmount:{decimals:6}}}}}}]};
    if(method==='getSignaturesForAddress'){
      const before=params[1].before,start=before?state.signatures.findIndex(s=>s.signature===before)+1:0;
      return state.signatures.slice(start,start+params[1].limit);
    }
    if(method==='getTransaction')return state.missing?null:state.transactions.get(params[0]);
    throw Error(`Unexpected fake RPC ${method}`);
  };
  const recordReceipt=e=>{if(state.failRecord&&e.eventIndex==='1')throw Error('fixture database rejection');db.prepare('INSERT OR IGNORE INTO test_receipts VALUES(?,?,?,?)').run(e.eventRef,e.eventIndex,e.amountMinor,e.familyHouseholdId);return{changedHouseholds:['house_test']};};
  const create=extra=>createVaultWatcher({db,clock,rpc,contextFor,recordReceipt,...options,...extra});
  const add=(n,slot,amounts)=>{const sig=signature(n);state.signatures.unshift({signature:sig,slot,err:null,confirmationStatus:'finalized'});state.transactions.set(sig,transaction(sig,slot,amounts));};
  return{db,clock,calls,state,rpc,create,watcher:create(),recipient,add,input:{scope:{householdId:'house_test',memberId:'adult_test'},fundId:'fund_test'}};
}

test('devnet decoder accepts exact 32-byte public keys and 64-byte signatures only',()=>{
  assert.ok(validBase58(wallet));assert.ok(validBase58(signature(6),64));assert.ok(!validBase58('0'.repeat(44)));assert.ok(!validBase58('1'.repeat(31)));assert.ok(!validBase58(signature(6)));
});

test('watcher enrolls a historical baseline; new finalized deposits preserve micro-units and survive server restart once',async()=>{
  const e=fixture();try{
    e.add(5,99,[5000000]);await e.watcher.enroll(e.input);assert.equal(e.watcher.status(e.input).baselineSlot,100);
    e.state.slot=110;e.add(6,105,[15000001]);const result=await e.watcher.scan(e.input);
    assert.equal(result.added,1);assert.equal(result.unmatched,1);assert.equal(e.db.prepare('SELECT amount,family FROM test_receipts').get().amount,15000001);assert.equal(e.db.prepare('SELECT family FROM test_receipts').get().family,null);
    await e.create().scan(e.input);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,1);assert.equal(e.watcher.status(e.input).cursorSlot,110);
    assert.ok(e.calls.filter(c=>c.method==='getTransaction').every(c=>c.params[1].commitment==='finalized'));
  }finally{e.db.close();}
});

test('one transaction with two incoming instructions credits both once using separate paths',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000,2000000]);
    const result=await e.watcher.scan(e.input);assert.equal(result.added,2);assert.deepEqual(e.db.prepare('SELECT instruction_path,amount FROM test_receipts ORDER BY instruction_path').all().map(x=>[x.instruction_path,x.amount]),[['0',1000000],['1',2000000]]);
  }finally{e.db.close();}
});

test('wrong token and failed transfers cannot finance the fund',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);e.state.transactions.set(signature(6),transaction(signature(6),105,[1000000],base58(20)));
    e.add(7,106,[1000000]);e.state.signatures[0].err={InstructionError:[0,'failure']};
    assert.equal((await e.watcher.scan(e.input)).added,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,0);
  }finally{e.db.close();}
});

test('an incomplete transaction read or unfinalized page leaves every receipt and cursor unchanged',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);e.state.missing=true;
    await assert.rejects(e.watcher.scan(e.input),x=>x.code==='vault_rpc');assert.equal(e.watcher.status(e.input).cursorSlot,100);
    e.state.missing=false;e.state.signatures[0].confirmationStatus='confirmed';await assert.rejects(e.watcher.scan(e.input),x=>x.code==='vault_signature');assert.equal(e.watcher.status(e.input).cursorSlot,100);
    assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,0);
  }finally{e.db.close();}
});

test('bounded pagination refuses to skip a backlog and a later complete scan finds all events',async()=>{
  const e=fixture({pageSize:1,maxPages:1});try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);e.add(7,106,[2000000]);
    await assert.rejects(e.watcher.scan(e.input),x=>x.code==='vault_backlog');assert.equal(e.watcher.status(e.input).cursorSlot,100);
    const result=await e.create({maxPages:5}).scan(e.input);assert.equal(result.added,2);assert.equal(result.vault.cursorSlot,110);
  }finally{e.db.close();}
});

test('recipient account-owner and Token-2022 mint checks fail closed',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.state.badOwner=true;
    await assert.rejects(e.watcher.scan(e.input),x=>x.code==='vault_rpc');e.state.badOwner=false;e.state.badMint=true;
    await assert.rejects(e.watcher.scan(e.input),x=>x.code==='vault_rpc');assert.equal(e.watcher.status(e.input).cursorSlot,100);
  }finally{e.db.close();}
});

test('a fee or outgoing amount in the same transaction is retained for review rather than overcredited',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);e.state.transactions.get(signature(6)).meta.postTokenBalances[1].uiTokenAmount.amount='999000';
    const result=await e.watcher.scan(e.input);assert.equal(result.added,0);assert.equal(result.vault.reviewCount,1);assert.equal(result.vault.cursorSlot,110);
  }finally{e.db.close();}
});

test('receipt persistence failure rolls back all transfers and cursor in the batch',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000,2000000]);e.state.failRecord=true;
    await assert.rejects(e.watcher.scan(e.input),/database rejection/);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,0);assert.equal(e.watcher.status(e.input).cursorSlot,100);
    e.state.failRecord=false;assert.equal((await e.watcher.scan(e.input)).added,2);
  }finally{e.db.close();}
});

test('enrollment revoked while the finalized-slot RPC is pending saves no watcher',async()=>{
  const e=fixture();try{
    let release,entered,active=true;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
    const watcher=e.create({rpc:async(method,params)=>{const result=await e.rpc(method,params);if(method==='getSlot'){entered();await gate;}return result;}});
    const enroll=watcher.enroll({...e.input,assertAccess:()=>{if(!active)throw Error('organizer access revoked');}});
    await waiting;active=false;release();
    await assert.rejects(enroll,/organizer access revoked/);
    assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM village_vault_watches').get().n,0);
  }finally{e.db.close();}
});

test('scan rechecks organizer access and the current recipient after delayed transaction reads',async()=>{
  for(const revoke of ['session','recipient']){
    const e=fixture();try{
      await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);
      let release,entered,active=true;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
      const watcher=e.create({rpc:async(method,params)=>{const result=await e.rpc(method,params);if(method==='getTransaction'){entered();await gate;}return result;}});
      const scan=watcher.scan({...e.input,assertAccess:()=>{if(!active)throw Error('organizer access revoked');}});
      await waiting;if(revoke==='session')active=false;else e.recipient.revision++;release();
      await assert.rejects(scan,e=>revoke==='session'?/organizer access revoked/.test(e.message):e.code==='vault_changed');
      assert.equal(e.db.prepare('SELECT cursor_slot FROM village_vault_watches').get().cursor_slot,100);
      for(const table of ['test_receipts','village_vault_events','village_vault_accounts','village_vault_issues'])assert.equal(e.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
    }finally{e.db.close();}
  }
});

test('a coalesced scan caller must still have access when the shared result completes',async()=>{
  const e=fixture();try{
    await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);
    let release,entered,secondActive=true;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
    const watcher=e.create({rpc:async(method,params)=>{const result=await e.rpc(method,params);if(method==='getTransaction'){entered();await gate;}return result;}});
    const first=watcher.scan({...e.input,assertAccess:()=>{}});await waiting;
    const second=watcher.scan({...e.input,assertAccess:()=>{if(!secondActive)throw Error('second session revoked');}});
    const refusal=assert.rejects(second,/second session revoked/);secondActive=false;release();
    assert.equal((await first).added,1);await refusal;
    assert.equal(e.calls.filter(c=>c.method==='getTransaction').length,1);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM test_receipts').get().n,1);
  }finally{e.db.close();}
});

test('inner transfer path remains distinct from a top-level transfer and self-transfers are not contributions',()=>{
  const tx=transaction(signature(6),105,[1000000,2000000]);tx.meta.innerInstructions=[{index:0,instructions:[tx.transaction.message.instructions.pop()]}];
  const parsed=extractDevnetTransfers(tx,{signature:signature(6),wallet,slot:105});assert.deepEqual(parsed.transfers.map(x=>x.eventIndex),['0','0.0']);
  tx.meta.preTokenBalances[0].owner=wallet;assert.equal(extractDevnetTransfers(tx,{signature:signature(6),wallet,slot:105}).transfers.length,0);
});

test('an intermediate account with absent owner metadata cannot disguise a wallet self-transfer',()=>{
  const tx=transaction(signature(6),105,[1000000]);
  tx.transaction.message.accountKeys.push({pubkey:base58(30)});
  tx.meta.preTokenBalances[0].owner=base58(31); // intermediate source cannot establish the original owner
  tx.meta.preTokenBalances.push({accountIndex:2,mint:PYUSD_DEVNET_MINT,owner:wallet,programId:TOKEN_2022_PROGRAM,uiTokenAmount:{amount:'1000000',decimals:6}});
  const parsed=extractDevnetTransfers(tx,{signature:signature(6),wallet,slot:105});assert.equal(parsed.transfers.length,0);assert.equal(parsed.issues.at(-1).reason,'wallet_net_transfer_requires_review');
});

test('devnet RPC has no constructor traffic, rejects mainnet/custom hosts and refuses outgoing methods',async()=>{
  let calls=0;const fetch=async(url,options)=>{calls++;assert.equal(url,DEVNET_RPC);assert.equal(options.redirect,'error');const body=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:123}));};
  const rpc=createDevnetRpc({fetch});assert.equal(calls,0);assert.throws(()=>createDevnetRpc({endpoint:'https://api.mainnet-beta.solana.com',fetch}),x=>x.code==='devnet_only');
  await assert.rejects(rpc('sendTransaction',['no']),x=>x.code==='vault_read_only');assert.equal(calls,0);assert.equal(await rpc('getSlot',[{commitment:'finalized'}]),123);assert.equal(calls,1);
});

test('example fund deletion cascades only its watcher records',async()=>{
  const e=fixture();try{await e.watcher.enroll(e.input);e.state.slot=110;e.add(6,105,[1000000]);await e.watcher.scan(e.input);
    e.db.prepare('DELETE FROM village_funds WHERE id=?').run('fund_test');assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM village_vault_watches').get().n,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM village_vault_events').get().n,0);
  }finally{e.db.close();}
});
