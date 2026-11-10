// Our Castle for real families on this computer: passkey sign-in, invitations and per-member permissions.
// Opt-in and separate: it serves only http://localhost:<port>, keeps its own database file
// (<data>/our-castle-family-example.sqlite) and never reads .env or provider keys, so payments are simulated and plans
// use the built-in rules. The example game (npm run demo) and the owner's configured app are unaffected.
//   npm run family -- --port 3200 --data ./data/family
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { databaseFile, openDatabase } from '../server/db.mjs';
import { createClock } from '../server/household.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function startFamily({ port = 3200, dataDir = resolve(root, 'data/family') } = {}) {
  const origin = `http://localhost:${port}`;
  const config = loadConfig({ PORT: String(port), OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: origin, OUR_CASTLE_DATA_DIR: dataDir }, { root });
  const file = databaseFile(config.dataDir, config.payments.mode, config.access.mode);
  const db = openDatabase(file);
  const app = createApp({ config, db, clock: createClock(), root });
  const server = http.createServer(app.handler);
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); }); });
  } catch (error) { db.close(); throw error; }
  let closing;
  return {
    url: origin, file,
    close() {
      closing ??= new Promise((done) => { app.close(); server.close(() => { db.close(); done(); }); server.closeAllConnections(); });
      return closing;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const port = Number.parseInt(arg('port') ?? process.env.FAMILY_PORT ?? '3200', 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3010, 3021].includes(port)) {
    console.error('Choose a free port from 1024 to 65535 other than 3010 and 3021 (for example --port 3200).');
    process.exit(2);
  }
  const app = await startFamily({ port, dataDir: arg('data') ? resolve(arg('data')) : undefined });
  console.log(`Our Castle families: ${app.url}\nPasskey sign-in · simulated payments · built-in planner · no provider keys read.\nData: ${app.file}\nPress Ctrl+C to stop.`);
  const stop = () => app.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
