import { DomainError } from '../household.mjs';
import { transaction } from '../db.mjs';
import { DEVNET_LABEL, PYUSD_DEVNET_MINT, validBase58, validateMint, validateTokenAccounts, extractDevnetTransfers } from './devnet.mjs';

export function ensureVaultSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS village_vault_watches (
    fund_id TEXT PRIMARY KEY REFERENCES village_funds(id) ON DELETE CASCADE, address TEXT NOT NULL UNIQUE, recipient_json TEXT NOT NULL,
    baseline_slot INTEGER NOT NULL, cursor_slot INTEGER NOT NULL, last_scan_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS village_vault_accounts (fund_id TEXT NOT NULL REFERENCES village_vault_watches(fund_id) ON DELETE CASCADE, address TEXT NOT NULL, PRIMARY KEY(fund_id,address));
    CREATE TABLE IF NOT EXISTS village_vault_events (
      fund_id TEXT NOT NULL REFERENCES village_vault_watches(fund_id) ON DELETE CASCADE, signature TEXT NOT NULL, instruction_path TEXT NOT NULL,
      slot INTEGER NOT NULL, amount_minor INTEGER NOT NULL, sender_address TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(signature,instruction_path));
    CREATE TABLE IF NOT EXISTS village_vault_issues (
      fund_id TEXT NOT NULL REFERENCES village_vault_watches(fund_id) ON DELETE CASCADE, signature TEXT NOT NULL, instruction_path TEXT NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(fund_id,signature,instruction_path,reason));`);
}
const fail = (status,code,message) => new DomainError(status,code,message);
const finalized = {commitment:'finalized'};

/** No keys, outgoing transfers or automatic startup. root explicitly supplies the read-only RPC. */
export function createVaultWatcher({db,clock,rpc=null,contextFor,recordReceipt,pageSize=100,maxPages=20}) {
  if (!Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>1000 || !Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>20) throw new TypeError('Use bounded vault pagination.');
  const scans = new Map();
  const rowFor = fundId => db.prepare('SELECT * FROM village_vault_watches WHERE fund_id=?').get(fundId);
  function context(scope,fundId) {
    const c = contextFor(scope,fundId,{allowSettled:true});
    if (c.rail!=='pyusd-devnet' || c.currency!=='PYUSD' || c.decimals!==6 || c.recipient?.kind!=='solana-devnet'
      || !validBase58(c.recipient.address) || !Number.isSafeInteger(c.recipient.revision)) throw fail(409,'vault_fund','This fund has no configured PYUSD devnet address.');
    return c;
  }
  function needRpc() { if (typeof rpc!=='function') throw fail(409,'vault_off','The optional devnet watcher is not configured.'); }
  const status = row => row ? {fundId:row.fund_id,address:row.address,mint:PYUSD_DEVNET_MINT,label:DEVNET_LABEL,
    baselineSlot:row.baseline_slot,cursorSlot:row.cursor_slot,lastScanAt:row.last_scan_at,
    transfers:db.prepare('SELECT COUNT(*) AS n FROM village_vault_events WHERE fund_id=?').get(row.fund_id).n,
    reviewCount:db.prepare('SELECT COUNT(*) AS n FROM village_vault_issues WHERE fund_id=?').get(row.fund_id).n,
    custody:'The address is controlled outside Our Castle. Watching does not restrict spending.'} : null;
  return {
    async enroll({scope,fundId}) {
      const c=context(scope,fundId), old=rowFor(fundId); needRpc();
      if (old) {
        if (old.recipient_json!==JSON.stringify(c.recipient)) throw fail(409,'vault_changed','The watched recipient differs from this fund.');
        return status(old);
      }
      await rpc('getAccountInfo',[PYUSD_DEVNET_MINT,{...finalized,encoding:'jsonParsed'}]).then(validateMint);
      const slot=await rpc('getSlot',[finalized]);
      if (!Number.isSafeInteger(slot)||slot<0) throw fail(502,'vault_slot','Devnet did not supply a valid finalized slot.');
      return transaction(db,()=>{
        const prior=rowFor(fundId); if(prior) return status(prior);
        if(db.prepare('SELECT 1 FROM village_vault_watches WHERE address=?').get(c.recipient.address)) throw fail(409,'vault_in_use','Use a separate watched address for each fund.');
        db.prepare('INSERT INTO village_vault_watches(fund_id,address,recipient_json,baseline_slot,cursor_slot,created_at) VALUES(?,?,?,?,?,?)')
          .run(fundId,c.recipient.address,JSON.stringify(c.recipient),slot,slot,clock.iso());
        return status(rowFor(fundId));
      });
    },
    status({scope,fundId}) { context(scope,fundId); return status(rowFor(fundId)); },
    async scan({scope,fundId}) {
      const c=context(scope,fundId), row=rowFor(fundId); needRpc();
      if(!row) throw fail(409,'vault_enroll','Start watching this address before checking new transfers.');
      if(row.recipient_json!==JSON.stringify(c.recipient)) throw fail(409,'vault_changed','The watched recipient differs from this fund.');
      if(scans.has(fundId)) return scans.get(fundId);
      const work=(async()=>{
        await rpc('getAccountInfo',[PYUSD_DEVNET_MINT,{...finalized,encoding:'jsonParsed'}]).then(validateMint);
        const highSlot=await rpc('getSlot',[finalized]);
        if(!Number.isSafeInteger(highSlot)||highSlot<row.cursor_slot) throw fail(502,'vault_slot','Devnet is behind the last completed scan.');
        const current=validateTokenAccounts(await rpc('getTokenAccountsByOwner',[row.address,{mint:PYUSD_DEVNET_MINT},{...finalized,minContextSlot:highSlot,encoding:'jsonParsed'}]),row.address,highSlot);
        const accounts=[...new Set([...current,...db.prepare('SELECT address FROM village_vault_accounts WHERE fund_id=?').all(fundId).map(x=>x.address)])];
        const signatures=new Map();
        // The wallet itself can reveal a token account created and closed between two polls.
        for(const account of [...new Set([row.address,...accounts])]){
          let before, complete=false;
          const seen=new Set();
          for(let page=0;page<maxPages;page++){
            const rows=await rpc('getSignaturesForAddress',[account,{...finalized,minContextSlot:highSlot,limit:pageSize,...(before?{before}:{})}]);
            if(!Array.isArray(rows)||rows.length>pageSize) throw fail(502,'vault_page','The transfer page was incomplete. Nothing advanced.');
            let reached=false;
            for(const info of rows){
              if(!validBase58(info.signature,64)||!Number.isSafeInteger(info.slot)||info.slot<0||info.confirmationStatus!=='finalized') throw fail(502,'vault_signature','Devnet did not return finalized transfer references.');
              if(info.slot<=row.cursor_slot) {reached=true;continue;}
              if(info.slot<=highSlot&&info.err===null) signatures.set(info.signature,info);
            }
            if(reached||rows.length<pageSize){complete=true;break;}
            before=rows.at(-1).signature;
            if(seen.has(before)) throw fail(502,'vault_page','Devnet repeated a transfer page. Nothing advanced.');
            seen.add(before);
          }
          if(!complete) throw fail(409,'vault_backlog','This address has more history than one bounded scan can check. Nothing advanced; review the backlog.');
        }
        if(signatures.size>2000) throw fail(409,'vault_backlog','Too many transfers for one bounded scan. Nothing advanced.');
        const transfers=[],issues=[];
        for(const [signature,info] of [...signatures].sort((a,b)=>a[1].slot-b[1].slot||a[0].localeCompare(b[0]))){
          const tx=await rpc('getTransaction',[signature,{...finalized,encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
          const parsed=extractDevnetTransfers(tx,{signature,wallet:row.address,slot:info.slot});
          transfers.push(...parsed.transfers);issues.push(...parsed.issues.map(i=>({...i,signature})));
        }
        return transaction(db,()=>{
          const changed=new Set();let added=0;
          // All pages and transaction reads succeeded before any receipt or cursor changes.
          for(const transfer of transfers){
            const old=db.prepare('SELECT * FROM village_vault_events WHERE signature=? AND instruction_path=?').get(transfer.eventRef,transfer.eventIndex);
            if(old){if(old.fund_id!==fundId||old.amount_minor!==transfer.amountMinor) throw fail(409,'vault_replay','That transaction was already assigned differently.');continue;}
            const r=recordReceipt({fundId,source:'pyusd-devnet',eventRef:transfer.eventRef,eventIndex:transfer.eventIndex,kind:'transfer',amountMinor:transfer.amountMinor,
              familyHouseholdId:null,recipient:c.recipient,at:clock.iso()});
            for(const id of r.changedHouseholds??[])changed.add(id);
            db.prepare('INSERT INTO village_vault_events VALUES(?,?,?,?,?,?,?)').run(fundId,transfer.eventRef,transfer.eventIndex,transfer.slot,transfer.amountMinor,transfer.senderAddress,clock.iso());added++;
          }
          for(const i of issues) db.prepare('INSERT OR IGNORE INTO village_vault_issues VALUES(?,?,?,?,?)').run(fundId,i.signature,i.eventIndex,i.reason,clock.iso());
          for(const a of accounts)db.prepare('INSERT OR IGNORE INTO village_vault_accounts VALUES(?,?)').run(fundId,a);
          db.prepare('UPDATE village_vault_watches SET cursor_slot=MAX(cursor_slot,?),last_scan_at=? WHERE fund_id=?').run(highSlot,clock.iso(),fundId);
          return {vault:status(rowFor(fundId)),added,unmatched:added,changedHouseholds:[...changed]};
        });
      })().finally(()=>scans.delete(fundId));
      scans.set(fundId,work);return work;
    },
  };
}
