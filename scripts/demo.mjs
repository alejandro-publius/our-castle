import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { openDatabase } from '../server/db.mjs';
import { createClock } from '../server/household.mjs';
import { createFamilyTrip } from './family-trip.mjs';
import { createVillageExample } from './village-exchange.mjs';
import { createVillageStory } from './village-story.mjs';
import { createVillageFundExample } from './village-fund.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * A fresh, localhost-only game. Never reads .env, process credentials or an on-disk household.
 * - `familyTrip` (`npm run demo -- --family-trip`) starts the playable family-trip example instead: an invented family and
 *   an invented example catalogue for the existing kit planner (scripts/family-trip.mjs). Without it nothing changes:
 *   Market Town stays disconnected and the household is the ordinary example.
 * - `villageStory` opens a half-funded, simulated library project directly at Contribute, with a private book offer.
 *   It is one organizer household's example; it does not create a shared cash fund or route funds to a recipient.
 * - `villageFund` opens five invented families and a genuinely shared, separately accounted simulated class-trip fund.
 * - `clock` and `kitSolver` are for tests: a pinned day, and a solver whose use can be counted.
 * - `host` and `port` are for a container (`--host=0.0.0.0 --port=8080`), where the loopback address of the container
 *   is not reachable from the computer that runs it. Left alone, the demo listens on this computer only, on a free port.
 * Returns the address, `close`, and the authored example it runs (null for the ordinary demo).
 */
export async function startDemo({ familyTrip = false, villageExchange = false, villageStory = false, villageFund = false, clock = createClock(), kitSolver = null, host = '127.0.0.1', port = 0 } = {}) {
  if ([familyTrip, villageExchange, villageStory, villageFund].filter(Boolean).length > 1) throw new Error('Choose one demo story at a time.');
  const config = loadConfig({ PORT: '0' }, { root });
  const db = openDatabase(':memory:');
  let server;
  const example = villageFund ? createVillageFundExample({ clock }) : villageStory ? createVillageStory({ clock }) : villageExchange ? createVillageExample({ clock }) : familyTrip ? createFamilyTrip({ clock }) : null;
  let app;
  try {
    app = createApp({ config, db, clock, root, kitSolver, ...(example ? { example, merchant: example.merchant } : {}) });
    if (example) await app.seedExample();
    server = http.createServer(app.handler);
    await new Promise((resolve, reject) => {
      const fail = (error) => reject(error);
      server.once('error', fail);
      server.listen(port, host, () => { server.off('error', fail); resolve(); });
    });
  } catch (error) { db.close(); throw error; }
  let closing;
  return {
    url: `http://${['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host}:${server.address().port}`,
    example,
    close() {
      closing ??= (async () => {
        app.close();
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
  const options = process.argv.slice(2);
  // `--host=` and `--port=` exist for containers; see startDemo. A port must be a whole number a program may listen on.
  const setting = (name) => options.find((option) => option.startsWith(`--${name}=`))?.slice(name.length + 3);
  const host = setting('host') ?? '127.0.0.1', port = setting('port') === undefined ? 0 : Number(setting('port'));
  if (!host || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Use --host=<address> and --port=<0 to 65535>, for example --host=0.0.0.0 --port=8080 inside a container.');
    process.exit(2);
  }
  const unknown = options.filter((option) => !['--family-trip','--village-exchange','--village-story','--village-fund'].includes(option) && !/^--(host|port)=/.test(option));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.join(' ')}\nUse "npm run demo" for the fresh demo, "npm run demo -- --family-trip" for planning, "--village-exchange" for item sharing, "--village-story" for the earlier library opening, or "--village-fund" for the shared class trip.`);
    process.exit(2);
  }
  const familyTrip = options.includes('--family-trip');
  const villageExchange = options.includes('--village-exchange');
  const villageStory = options.includes('--village-story');
  const villageFund = options.includes('--village-fund');
  if ([familyTrip, villageExchange, villageStory, villageFund].filter(Boolean).length > 1) {
    console.error('Choose one demo story at a time.');
    process.exit(2);
  }
  const demo = await startDemo({ familyTrip, villageExchange, villageStory, villageFund, host, port });
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.log(`Listening on ${host}:${port}, beyond this ${host === '0.0.0.0' ? 'container or ' : ''}computer's loopback address. Publish it to 127.0.0.1 only; this demo has no sign-in.`);
  console.log(villageFund
    ? `Our Castle demo: ${demo.url}\nFive invented families · one $400 class trip · $200 in simulated starting contributions.\nShared village progress is separate from private savings. No real payments, subscriptions or devnet provider is connected.\nNo key or saved record is read. Progress lasts until you close this demo. Press Ctrl+C to finish.`
    : villageStory
    ? `Our Castle demo: ${demo.url}\nExample village library · invented families · $150 of $300 in simulated contributions.\nNo real shared fund or recipient routing. No provider is contacted and no key or saved record is read. Progress lasts until you close this demo. Press Ctrl+C to finish.`
    : familyTrip || villageExchange
    ? `Our Castle demo: ${demo.url}\nExample family trip · an invented family, two sample shops and invented prices · simulated payments · rules planner.\nNo provider is contacted and no key or saved record is read. Progress lasts until you close this demo. Press Ctrl+C to finish.`
    : `Our Castle demo: ${demo.url}\nFresh session · simulated payments · rules planner.\nProgress lasts until you close this demo. Press Ctrl+C to finish.`);
  const stop = () => demo.close().catch((error) => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
