import { DomainError } from '../household.mjs';

// Issuer documentation, checked November 10, 2026: https://docs.paxos.com/guides/stablecoin/pyusd/testnet
export const PYUSD_DEVNET_MINT = 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_LABEL = 'PYUSD devnet test tokens · no monetary value';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fail = message => new DomainError(502, 'vault_rpc', message);

export function validBase58(value, bytes = 32) {
  if (typeof value !== 'string' || value.length < bytes || value.length > bytes * 2) return false;
  let number = 0n;
  for (const c of value) { const n = alphabet.indexOf(c); if (n < 0) return false; number = number * 58n + BigInt(n); }
  let size = 0;
  for (; number; number >>= 8n) size++;
  return size + (value.match(/^1*/)?.[0].length ?? 0) === bytes;
}

export function devnetExplorer(signature) {
  if (!validBase58(signature, 64)) throw new DomainError(400,'vault_signature','Use a valid devnet transaction signature.');
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** No constructor I/O. The only transport destination is the public devnet RPC, with redirects refused. */
export function createDevnetRpc({ endpoint = DEVNET_RPC, fetch: transport = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (endpoint !== DEVNET_RPC && endpoint !== `${DEVNET_RPC}/`) throw new DomainError(400,'devnet_only','Only the pinned Solana devnet endpoint is supported.');
  let sequence = 0;
  const methods = new Set(['getSlot','getAccountInfo','getTokenAccountsByOwner','getSignaturesForAddress','getTransaction']);
  return async (method, params = []) => {
    if (!methods.has(method)) throw new DomainError(400,'vault_read_only','The watched vault permits only read operations.');
    const id = ++sequence;
    let response, body;
    try {
      response = await transport(DEVNET_RPC,{ method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw fail('Solana devnet did not answer successfully.');
      const text = await response.text();
      if (text.length > 4_000_000) throw fail('Solana devnet returned too much data for this check.');
      body = JSON.parse(text);
    } catch (error) { if (error instanceof DomainError) throw error; throw fail('Solana devnet could not be checked. Try again later.'); }
    if (body?.jsonrpc !== '2.0' || body.id !== id || body.error || !Object.hasOwn(body,'result')) throw fail('Solana devnet returned an incomplete reply.');
    return body.result;
  };
}

export function validateMint(result) {
  const account = result?.value, info = account?.data?.parsed?.info;
  if (account?.owner !== TOKEN_2022_PROGRAM || account?.data?.parsed?.type !== 'mint' || info?.decimals !== 6
    || info?.isInitialized !== true) throw fail('The pinned devnet mint did not match PYUSD Token-2022.');
}

export function validateTokenAccounts(result, wallet, minSlot = 0) {
  if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < minSlot || !Array.isArray(result?.value) || result.value.length > 100) throw fail('The watched address returned an incomplete token-account list.');
  return result.value.map(row => {
    const info = row?.account?.data?.parsed?.info;
    if (!validBase58(row?.pubkey) || row.account.owner !== TOKEN_2022_PROGRAM || row.account.data.parsed.type !== 'account'
      || info?.owner !== wallet || info.mint !== PYUSD_DEVNET_MINT || info.tokenAmount?.decimals !== 6) throw fail('A watched token account did not match its owner, program and mint.');
    return row.pubkey;
  });
}

/** Parse successful finalized-RPC evidence. Unsupported balance shapes are retained for review, never rounded. */
export function extractDevnetTransfers(result, { signature, wallet, slot }) {
  if (!validBase58(signature,64) || !validBase58(wallet) || !result || result.slot !== slot || result.meta?.err !== null
    || result.transaction?.signatures?.[0] !== signature || !Array.isArray(result.transaction?.message?.accountKeys)) {
    throw fail('The returned transaction did not match successful devnet evidence.');
  }
  const keys = result.transaction.message.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);
  const before = result.meta.preTokenBalances ?? [], after = result.meta.postTokenBalances ?? [];
  const balance = (rows, address) => rows.find(b => keys[b.accountIndex] === address && b.mint === PYUSD_DEVNET_MINT && b.programId === TOKEN_2022_PROGRAM && b.uiTokenAmount?.decimals === 6);
  const candidates = [], issues = [];
  const read = (instruction, path) => {
    if (instruction.programId !== TOKEN_2022_PROGRAM || !['transfer','transferChecked'].includes(instruction.parsed?.type)) return;
    const info = instruction.parsed.info, dest = balance(after,info?.destination), priorDest = balance(before,info?.destination), source = balance(before,info?.source) ?? balance(after,info?.source);
    if (!dest && priorDest?.owner === wallet) { issues.push({eventIndex:path,reason:'closed_destination_requires_review'}); return; }
    if (!dest || dest.owner !== wallet || source?.owner === wallet) return;
    if (instruction.parsed.type === 'transferChecked' && (info.mint !== PYUSD_DEVNET_MINT || info.tokenAmount?.decimals !== 6)) return;
    if (instruction.parsed.type === 'transfer' && !source) { issues.push({eventIndex:path,reason:'source_mint_unproven'}); return; }
    const raw = instruction.parsed.type === 'transferChecked' ? info.tokenAmount?.amount : info.amount;
    if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw))) { issues.push({eventIndex:path,reason:'amount_unsupported'}); return; }
    candidates.push({eventRef:signature,eventIndex:path,amountMinor:Number(raw),destination:info.destination,
      senderAddress:validBase58(source?.owner) ? source.owner : null,slot,explorerUrl:devnetExplorer(signature)});
  };
  const instructions = result.transaction.message.instructions;
  if (!Array.isArray(instructions) || instructions.length > 1000) throw fail('The transaction instruction list is incomplete.');
  instructions.forEach((instruction,i) => read(instruction,String(i)));
  for (const group of result.meta.innerInstructions ?? []) {
    if (!Number.isSafeInteger(group.index) || !Array.isArray(group.instructions) || group.instructions.length > 1000) throw fail('An inner instruction list is incomplete.');
    group.instructions.forEach((instruction,i) => read(instruction,`${group.index}.${i}`));
  }
  const accepted = [];
  for (const destination of new Set(candidates.map(c=>c.destination))) {
    const group = candidates.filter(c=>c.destination===destination), pre = balance(before,destination), post = balance(after,destination);
    const rawPre = pre?.uiTokenAmount?.amount ?? '0', rawPost = post?.uiTokenAmount?.amount;
    if (!/^\d{1,20}$/.test(rawPre) || !/^\d{1,20}$/.test(rawPost ?? '')) { issues.push({eventIndex:'balance',reason:'balance_unsupported'}); continue; }
    const delta = BigInt(rawPost) - BigInt(rawPre), sum = group.reduce((n,c)=>n+BigInt(c.amountMinor),0n);
    // A fee, an outgoing transfer or another unparsed balance change needs review. Do not overstate the amount received.
    if (delta !== sum) { issues.push({eventIndex:'balance',reason:'net_transfer_requires_review'}); continue; }
    accepted.push(...group);
  }
  const ownedTotal = rows => rows.filter(b => b.owner === wallet && b.mint === PYUSD_DEVNET_MINT && b.programId === TOKEN_2022_PROGRAM)
    .reduce((sum,b) => { const raw=b.uiTokenAmount?.amount; if(!/^\d{1,20}$/.test(raw??'')) throw fail('The wallet balance evidence is incomplete.'); return sum+BigInt(raw); },0n);
  // An intermediate account can be created and closed in this same transaction. Its absent owner metadata must not
  // turn a transfer between this wallet's accounts into new money. Confirm the wallet-wide received amount too.
  if (accepted.reduce((sum,t)=>sum+BigInt(t.amountMinor),0n) > ownedTotal(after)-ownedTotal(before)) {
    issues.push({eventIndex:'wallet',reason:'wallet_net_transfer_requires_review'});
    return {transfers:[],issues};
  }
  return {transfers:accepted,issues};
}
