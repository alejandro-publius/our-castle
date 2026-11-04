// Reset the local example household. Sandbox records are kept unless --include-sandbox is passed.
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, readEnvironment } from '../server/config.mjs';
import { databaseFile } from '../server/db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { env } = readEnvironment({ root });
const { dataDir } = loadConfig(env, { root });
const targets = [databaseFile(dataDir, 'example')];
if (process.argv.includes('--include-sandbox')) targets.push(databaseFile(dataDir, 'sandbox'));
for (const file of targets) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(file + suffix)) rmSync(file + suffix);
  }
  console.log(`Reset ${file}`);
}
console.log('Stop and restart the server so it re-creates the example household.');
