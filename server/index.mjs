import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, readEnvironment } from './config.mjs';
import { databaseFile, openDatabase } from './db.mjs';
import { createApp } from './app.mjs';
import { createClock } from './household.mjs';
import { createPayPalSdkClient } from './payments/paypal-sdk-client.mjs';
import { createPayPalReadTools } from './steward/paypal-tools.mjs';
import { createAnthropicPlanner } from './planner/anthropic-provider.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { env, envFileLoaded } = readEnvironment({ root });
const config = loadConfig(env, { root });
const dbFile = databaseFile(config.dataDir, config.payments.mode, config.access.mode);
const db = openDatabase(dbFile);

const sandbox = config.payments.mode === 'sandbox';
// PayPal's official Server SDK for orders, capture and refunds (sandbox environment only).
const paypal = sandbox ? createPayPalSdkClient({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret }) : null;
// PayPal Agent Toolkit, read-only (get_order, list_transactions), for the AI house steward.
const paypalTools = sandbox ? createPayPalReadTools({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret }) : null;
const live = config.ai.mode === 'live';
const aiProvider = live ? createAnthropicPlanner({ apiKey: config.ai.apiKey, model: config.ai.model }) : null;
const stewardAi = live ? { apiKey: config.ai.apiKey, model: config.ai.model } : null;

const app = createApp({ config, db, clock: createClock(), paypal, aiProvider, stewardAi, paypalTools, root });
const server = http.createServer(app.handler);

server.listen(config.port, config.host, () => {
  const mask = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
  console.log(`Our Castle: http://localhost:${config.port}/`);
  console.log(`  Art reference: http://localhost:${config.port}/art-preview.html`);
  console.log(`  .env file: ${envFileLoaded ? 'loaded (server-side only)' : 'not found — using example modes'}`);
  console.log(`  Payments: ${config.payments.mode === 'sandbox'
    ? `PayPal SANDBOX via the PayPal Server SDK (client ${mask(config.payments.clientId)}; webhooks ${config.payments.webhookId ? 'verified via PAYPAL_WEBHOOK_ID' : 'off'})`
    : 'EXAMPLE mode — simulated, no PayPal calls'}`);
  console.log(`  Planner: ${config.ai.mode === 'live' ? `AI via ${config.ai.provider} (${config.ai.model})` : 'EXAMPLE mode — built-in rules, no AI'}`);
  console.log(`  Merchant: ${config.merchant.mode === 'live' ? 'Channel3 product search (CHANNEL3_API_KEY set, server-side only)' : 'off — Channel3 not connected (needs CHANNEL3_API_KEY)'}`);
  console.log(`  Treasury: ${config.studio ? 'AG Studio evaluation licence set (local evaluation only)' : 'AG Studio unlicensed (local trial watermark)'}`);
  console.log(`  Steward: ${live ? `AI (${config.ai.model})${sandbox ? ' with read-only PayPal Agent Toolkit tools' : ', ledger only (payments in example mode)'}` : 'off — needs AI_API_KEY'}`);
  console.log(`  Data: ${dbFile}`);
  for (const warning of config.warnings) console.warn(`  Warning: ${warning}`);
});

const shutdown = () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
