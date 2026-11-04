// One-command live verification with the owner's local .env credentials (sandbox only).
// Runs the AI plan, a real PayPal sandbox order/approval/capture through the Server SDK, replay and
// mismatch checks, PayPal's own view of the order, the AI steward's Agent Toolkit check and a refund.
// The only manual step is approving the order in a browser with a sandbox BUYER account.
// Writes docs/LIVE-VERIFICATION.md. Uses a temporary database, never the app's data files.
//
// --ai-only: check only the runtime AI (planner and steward, with the steward's read-only PayPal Agent Toolkit
// tools). No PayPal order is created, so nothing needs approval. Writes docs/LIVE-VERIFICATION-AI.md, so the
// payment evidence in LIVE-VERIFICATION.md is never overwritten. Without AI_API_KEY it reports the AI checks as
// pending and exits cleanly, without retrying.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, readEnvironment } from '../server/config.mjs';
import { openDatabase } from '../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, createClock, ensureDemoHousehold, progressFor, setupHousehold, updateGoal } from '../server/household.mjs';
import { createContributionService } from '../server/payments/contributions.mjs';
import { createPayPalSdkClient } from '../server/payments/paypal-sdk-client.mjs';
import { createPlanner } from '../server/planner/index.mjs';
import { createAnthropicPlanner } from '../server/planner/anthropic-provider.mjs';
import { createSteward } from '../server/steward/index.mjs';
import { createPayPalReadTools } from '../server/steward/paypal-tools.mjs';
import { addDays } from '../server/household.mjs';
import { formatCents } from '../src/core/rules.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { env, envFileLoaded } = readEnvironment({ root });
const config = loadConfig(env, { root });
const approvalMinutes = Number(process.argv.find((a) => a.startsWith('--wait='))?.slice(7) ?? 10);
const aiOnly = process.argv.includes('--ai-only');
const reportName = aiOnly ? 'LIVE-VERIFICATION-AI.md' : 'LIVE-VERIFICATION.md';
if (aiOnly && config.ai.mode !== 'live') {
  console.log('AI checks: PENDING — no AI_API_KEY in .env (run npm run set-ai-key in your own terminal).');
  console.log('Nothing was called, no PayPal order was created and no report was written.');
  process.exit(0);
}
const report = [];
const results = [];
const log = (line = '') => { console.log(line); report.push(line); };
const record = (name, ok, detail) => { results.push({ name, ok }); log(`- ${ok === null ? 'SKIPPED' : ok ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`); };
const timed = async (fn) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-live-'));
const db = openDatabase(path.join(dir, 'live.sqlite'));
const clock = createClock();
ensureDemoHousehold(db, clock);
setupHousehold(db, DEMO_HOUSEHOLD_ID, { playMode: 'family', name: 'House of Alder', crest: { field: 'emerald', charge: 'leaf' } });
const goalInput = { name: 'Camping trip fund', targetCents: 30000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: addDays(clock.today(), 56) };
updateGoal(db, DEMO_GOAL_ID, goalInput, clock);

log(`# Live verification${aiOnly ? ' (AI only)' : ''} — ${new Date().toISOString()}`);
log();
log(`.env loaded: ${envFileLoaded ? 'yes' : 'no'} · payments: ${config.payments.mode} · AI: ${config.ai.mode}${config.ai.mode === 'live' ? ` (${config.ai.model})` : ''}`);
log('Sandbox only. Temporary database; the app\'s own data files were not touched. No secrets are printed.');
for (const w of config.warnings) log(`Warning: ${w}`);
log();

// ---------- AI planner ----------
log('## AI planner');
if (config.ai.mode !== 'live') record('AI plan for the demo goal', null, 'no AI_API_KEY in .env');
else {
  const planner = createPlanner({ db, clock, provider: createAnthropicPlanner({ apiKey: config.ai.apiKey, model: config.ai.model }) });
  const { value: res, ms } = await timed(() => planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [{ label: 'Internet bill', amountCents: 6000, cadence: 'monthly' }] }));
  if (res.status === 'ok') {
    record('AI plan for the demo goal passed server validation', res.plan.source === 'ai', `${res.plan.model}, ${ms} ms, planned ${formatCents(res.plan.totals.plannedCents)}, shortfall ${formatCents(res.plan.totals.shortfallCents)}`);
    log(`  Headline: "${res.plan.headline}"`);
    log(`  Summary: "${res.plan.summary}"`);
  } else record('AI plan for the demo goal', false, res.status === 'invalid_ai_output' ? `rejected by validation: ${res.issues.map((i) => i.message).join(' | ')}` : res.error.message);
  updateGoal(db, DEMO_GOAL_ID, { ...goalInput, weeklyBudgetCents: 1000 }, clock);
  const { value: hard, ms: ms2 } = await timed(() => planner.propose({ householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID, commitments: [] }));
  if (hard.status === 'ok') record('AI plan for an impossible target states the shortfall', hard.plan.totals.feasible === false && hard.plan.totals.shortfallCents === 16000, `${ms2} ms, shortfall ${formatCents(hard.plan.totals.shortfallCents)}; "${hard.plan.headline}"`);
  else record('AI plan for an impossible target', false, hard.status === 'invalid_ai_output' ? `rejected by validation: ${hard.issues.map((i) => i.message).join(' | ')}` : hard.error.message);
  updateGoal(db, DEMO_GOAL_ID, goalInput, clock);
}
log();

// ---------- PayPal sandbox ----------
log('## PayPal sandbox (Server SDK)');
let captureId = null;
let orderId = null;
let service = null;
let paypal = null;
if (aiOnly) log('Not run (--ai-only): no PayPal order was created and nothing needed approval. The buyer-approved payment is verified separately (see VALIDATION.md).');
else if (config.payments.mode !== 'sandbox') record('Sandbox order, approval and capture', null, 'no PayPal sandbox credentials in .env');
else {
  paypal = createPayPalSdkClient({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret });
  service = createContributionService({ db, clock, mode: 'sandbox', paypal, webhookId: config.payments.webhookId });
  const ids = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
  try {
    const created = await service.createPayPalOrder({ ...ids, amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: `live_${Date.now()}` });
    orderId = created.orderId;
    record('Server-created sandbox order', Boolean(orderId), `order ${orderId}`);
    log();
    log(`  ACTION: open this link, log in with a sandbox BUYER account and approve (waiting up to ${approvalMinutes} min):`);
    console.log(`  ${created.approveUrl}`);
    report.push('  (approval link printed to the terminal)');
    log();
    let status = null;
    const deadline = Date.now() + approvalMinutes * 60_000;
    while (Date.now() < deadline) {
      status = (await paypal.getOrder(orderId)).data?.status;
      if (status === 'APPROVED' || status === 'COMPLETED') break;
      await sleep(5000);
    }
    record('Buyer approved the order in PayPal', status === 'APPROVED' || status === 'COMPLETED', `PayPal order status ${status}`);
    if (status === 'APPROVED' || status === 'COMPLETED') {
      const before = progressFor(db, DEMO_GOAL_ID).progressCents;
      const captured = await service.capturePayPalOrder({ providerOrderId: orderId, ...ids });
      captureId = captured.contribution.captures.find((c) => c.credited)?.captureId ?? null;
      record('Capture verified and credited once', captured.outcome === 'completed' && captured.progress.progressCents === before + 1500,
        `capture ${captureId}, progress ${formatCents(before)} → ${formatCents(captured.progress.progressCents)}, tiers awarded ${JSON.stringify(captured.awarded)}`);
      const replay = await service.capturePayPalOrder({ providerOrderId: orderId, ...ids });
      record('Replayed capture is not counted twice', replay.outcome === 'already_completed' && replay.progress.progressCents === before + 1500);
      try { await service.capturePayPalOrder({ providerOrderId: orderId, householdId: 'hh_other', goalId: DEMO_GOAL_ID }); record('Mismatched household refused', false); }
      catch (e) { record('Mismatched household refused', e.code === 'order_mismatch'); }
      const order = (await paypal.getOrder(orderId)).data;
      const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
      record('PayPal\'s own record matches the receipt', cap?.id === captureId && cap?.amount?.value === '15.00' && cap?.amount?.currency_code === 'USD', `PayPal: ${order.status}, ${cap?.id}, ${cap?.amount?.value} ${cap?.amount?.currency_code}`);
    }
  } catch (error) {
    record('Sandbox order flow', false, `${error.message}${error.debugId ? ` (debug id ${error.debugId})` : ''}`);
  }
}
log();

// ---------- Steward ----------
log('## AI house steward (PayPal Agent Toolkit, read-only)');
if (aiOnly) {
  const sandbox = config.payments.mode === 'sandbox';
  const readService = createContributionService({ db, clock, mode: sandbox ? 'sandbox' : 'example', paypal: sandbox ? createPayPalSdkClient({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret }) : null, webhookId: config.payments.webhookId });
  const paypalTools = sandbox ? createPayPalReadTools({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret }) : null;
  const steward = createSteward({ db, contributions: readService, householdId: DEMO_HOUSEHOLD_ID, ai: { apiKey: config.ai.apiKey, model: config.ai.model }, paypalTools, clock });
  const question = sandbox
    ? 'How close are we to the Manor? Please also check PayPal for any sandbox transactions in the last 7 days.'
    : 'How close are we to the Manor?';
  try {
    const { value: res, ms } = await timed(() => steward.ask({ question, memberId: 'm_wren' }));
    if (res.status !== 'ok') record('Steward answered with live AI', false, `${res.error.kind}: ${res.error.message}`);
    else {
      record('Steward answered with live AI', true, `${res.model}, ${ms} ms`);
      const ledgerCheck = res.checks.find((c) => c.tool === 'read_household_ledger');
      record('Steward read the household ledger', Boolean(ledgerCheck), ledgerCheck?.summary);
      if (sandbox) {
        const txCheck = res.checks.find((c) => c.tool === 'list_transactions');
        record('Steward listed PayPal transactions through the Agent Toolkit (read-only)', Boolean(txCheck), txCheck?.summary ?? 'the model did not call list_transactions');
      } else record('Steward used the PayPal Agent Toolkit', null, 'no PayPal sandbox credentials in .env');
      record('Steward answer had no unverified figures', res.warnings.length === 0, res.warnings.join(' '));
      log(`  Question: "${question}"`);
      log(`  Answer: "${res.answer}"`);
    }
  } catch (error) { record('Steward answered with live AI', false, error.message); }
  record('Steward reconciles a real household order with PayPal (get_order)', null, 'needs a household PayPal order; check it in the app after the next in-page payment (Ledger tab → "Did PayPal confirm our last contribution?")');
} else if (config.ai.mode !== 'live' || !service) record('Steward verifies the payment with PayPal', null, 'needs both AI_API_KEY and PayPal sandbox credentials');
else if (!captureId) record('Steward verifies the payment with PayPal', null, 'no captured order to verify');
else {
  const steward = createSteward({ db, contributions: service, householdId: DEMO_HOUSEHOLD_ID, ai: { apiKey: config.ai.apiKey, model: config.ai.model }, paypalTools: createPayPalReadTools({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret }), clock });
  const { value: res, ms } = await timed(() => steward.ask({ question: 'Did PayPal confirm the $15.00 contribution?', memberId: 'm_wren', focusOrderId: orderId }));
  if (res.status !== 'ok') record('Steward verifies the payment with PayPal', false, res.error.message);
  else {
    const check = res.checks.find((c) => c.tool === 'get_order');
    record('Steward looked the order up through the Agent Toolkit', Boolean(check), check?.summary);
    record('Server reconciliation: PayPal and the ledger agree', check?.reconciliation?.verdict === 'match', check?.reconciliation?.note);
    record('Steward answer had no unverified figures', res.warnings.length === 0, res.warnings.join(' '));
    log(`  Answer (${ms} ms): "${res.answer}"`);
  }
}
log();

// ---------- Refund ----------
if (!aiOnly) log('## Sandbox refund');
if (aiOnly) { /* no order, so nothing to refund */ }
else if (!service || !captureId) record('Refund reverses progress once', null, 'no captured order');
else {
  try {
    const before = progressFor(db, DEMO_GOAL_ID).progressCents;
    const refunded = await service.refundPayPalCapture({ captureId, householdId: DEMO_HOUSEHOLD_ID, approverId: 'm_rowan', approvalConfirmed: true });
    record('Refund reverses progress once', refunded.outcome === 'refunded' && refunded.progress.progressCents === before - 1500, `${refunded.outcome}, progress ${formatCents(before)} → ${formatCents(refunded.progress.progressCents)}`);
  } catch (error) { record('Refund reverses progress once', false, error.message); }
}
if (!aiOnly) log();

const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
log(`**${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped.** Still manual: the browser PayPal button (JS SDK v6)${aiOnly ? ', the steward\'s get_order reconciliation after a real in-app payment' : ''} and webhooks through a tunnel.`);
writeFileSync(path.join(root, 'docs', reportName), `${report.join('\n')}\n`);
console.log(`\nReport written to docs/${reportName}`);
db.close();
process.exit(failed ? 1 : 0);
