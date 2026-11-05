import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { openDatabase } from '../server/db.mjs';
import { createClock } from '../server/household.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** A fresh, localhost-only game. Never reads .env, process credentials or an on-disk household. */
export async function startDemo() {
  const config = loadConfig({ PORT: '0' }, { root });
  const db = openDatabase(':memory:');
  let server;
  try {
    const app = createApp({ config, db, clock: createClock(), root });
    server = http.createServer(app.handler);
    await new Promise((resolve, reject) => {
      const fail = (error) => reject(error);
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => { server.off('error', fail); resolve(); });
    });
  } catch (error) { db.close(); throw error; }
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      closing ??= (async () => {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
        db.close();
      })();
      return closing;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = await startDemo();
  console.log(`Our Castle demo: ${demo.url}\nFresh session · simulated payments · rules planner.\nProgress lasts until you close this demo. Press Ctrl+C to finish.`);
  const stop = () => demo.close().catch((error) => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
