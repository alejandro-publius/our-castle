// Keyless, reproducible walkthrough of plan freshness and the remaining-plan preview over the real HTTP routes.
// A fresh in-memory example household on 127.0.0.1 and a fixed server date (Nov 3, 2026, local noon). It never reads .env,
// uses no PayPal, AI or other provider, and the one contribution is an explicitly simulated example payment.
//   node scripts/plan-revision-example.mjs          readable summary
//   node scripts/plan-revision-example.mjs --json   every request and full response body
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { openDatabase } from '../server/db.mjs';
import { createClock } from '../server/household.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const asJson = process.argv.includes('--json');
const db = openDatabase(':memory:');
const app = createApp({ config: loadConfig({ PORT: '0' }, { root }), db, clock: createClock('2026-11-03T12:00:00'), root });
const server = http.createServer(app.handler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const log = [];

async function call(method, path, body) {
  const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  log.push({ request: `${method} ${path}`, body, status: response.status, response: json });
  return { status: response.status, json };
}
const tables = () => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()));
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const say = (line) => { if (!asJson) console.log(line); };

try {
  await call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } });
  const proposed = (await call('POST', '/api/plans/rules', { commitments: [] })).json;
  say(`1. Built-in proposal ${proposed.plan.id}: ${money(proposed.plan.totals.remainingCents)} remaining, not accepted yet.`);

  await call('POST', '/api/example/contributions', { householdId: 'hh_demo', goalId: 'goal_demo', amountCents: 1500, approverId: 'm_rowan', approvalConfirmed: true, requestId: 'plan-revision-example-1' });
  const { planReview, progress } = (await call('GET', '/api/state')).json;
  say(`2. A simulated ${money(1500)} example contribution: ${money(progress.remainingCents)} now remains. planReview.needsRefresh = ${planReview.needsRefresh}`);
  for (const change of planReview.changes) say(`   - ${change.message}`);

  const before = tables();
  const refused = await call('POST', `/api/plans/${proposed.plan.id}/accept`, {});
  say(`3. Accepting the old proposal: HTTP ${refused.status} ${refused.json.error.code}. ${refused.json.error.message}`);

  const short = (await call('POST', '/api/plans/preview', { weeklyBudgetCents: 2000 })).json.preview;
  say(`4. Preview at ${money(2000)} a week to ${short.requested.targetDate}: ${short.outcome}, ${money(short.totals.plannedCents)} planned, ${money(short.totals.shortfallCents)} short; `
    + `${money(short.requiredWeeklyCents)} a week would be needed; at ${money(2000)} the remainder is covered by ${short.reach.date} (${short.reach.weeksNeeded} weeks).`);
  const later = (await call('POST', '/api/plans/preview', { weeklyBudgetCents: 2000, targetDate: short.reach.date })).json.preview;
  say(`5. Preview at ${money(2000)} a week to ${later.requested.targetDate}: ${later.outcome}; weeks ${later.schedule.map((w) => money(w.amountCents)).join(', ')}.`);
  say(`   Milestones: ${later.milestones.map((m) => `${m.name} ${m.reached ? 'already reached' : `${m.date} (week ${m.week})`}`).join('; ')}.`);
  const none = (await call('POST', '/api/plans/preview', { weeklyBudgetCents: 0 })).json.preview;
  say(`6. Preview at ${money(0)} a week: ${none.outcome}; ${none.notes[0]}`);
  const invalid = await call('POST', '/api/plans/preview', { weeklyBudgetCents: -5, targetDate: '2026-11-04' });
  say(`7. Invalid preview input: HTTP ${invalid.status} ${invalid.json.error.code} (${invalid.json.error.issues.map((i) => i.code).join(', ')}).`);
  say(`8. Every table is byte-for-byte unchanged by steps 3–7: ${tables() === before}.`);

  const fresh = (await call('POST', '/api/plans/rules', { commitments: [] })).json;
  const accepted = await call('POST', `/api/plans/${fresh.plan.id}/accept`, {});
  say(`9. A fresh proposal for ${money(fresh.plan.totals.remainingCents)} is accepted: HTTP ${accepted.status}, acceptedPlanId = ${accepted.json.state.acceptedPlanId}.`);
  if (asJson) console.log(JSON.stringify(log, null, 2));
} finally {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  db.close();
}
