import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, readEnvironment } from './config.mjs';
import { databaseFile, openDatabase } from './db.mjs';
import { createApp } from './app.mjs';
import { createClock } from './household.mjs';
import { createPayPalClient } from './payments/paypal-client.mjs';
import { createAnthropicPlanner } from './planner/anthropic-provider.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { env, envFileLoaded } = readEnvironment({ root });
const config = loadConfig(env, { root });
const dbFile = databaseFile(config.dataDir, config.payments.mode);
const db = openDatabase(dbFile);

const paypal = config.payments.mode === 'sandbox'
  ? createPayPalClient({ clientId: config.payments.clientId, clientSecret: config.payments.clientSecret })
  : null;
const aiProvider = config.ai.mode === 'live'
  ? createAnthropicPlanner({ apiKey: config.ai.apiKey, model: config.ai.model })
  : null;

const app = createApp({ config, db, clock: createClock(), paypal, aiProvider, root });
const server = http.createServer(app.handler);

server.listen(config.port, config.host, () => {
  const mask = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
  console.log(`Our House: http://localhost:${config.port}/`);
  console.log(`  Art reference: http://localhost:${config.port}/art-preview.html`);
  console.log(`  .env file: ${envFileLoaded ? 'loaded (server-side only)' : 'not found — using example modes'}`);
  console.log(`  Payments: ${config.payments.mode === 'sandbox'
    ? `PayPal SANDBOX (client ${mask(config.payments.clientId)}; webhooks ${config.payments.webhookId ? 'verified via PAYPAL_WEBHOOK_ID' : 'off'})`
    : 'EXAMPLE mode — simulated, no PayPal calls'}`);
  console.log(`  Planner: ${config.ai.mode === 'live' ? `AI via ${config.ai.provider} (${config.ai.model})` : 'EXAMPLE mode — built-in rules, no AI'}`);
  console.log(`  Data: ${dbFile}`);
  for (const warning of config.warnings) console.warn(`  Warning: ${warning}`);
});

const shutdown = () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
