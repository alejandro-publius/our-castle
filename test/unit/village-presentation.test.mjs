import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVillageMinor, villageMoney, villageNextStage, villageRailLabel } from '../../src/app/village-fund.js';
import { projectStage } from '../../src/core/family-project.js';

test('fund input preserves whole minor units and rejects ambiguous or unsafe money', () => {
  assert.equal(parseVillageMinor('40.01'), 4001);
  assert.equal(parseVillageMinor('0.000001', 6), 1);
  assert.equal(parseVillageMinor('1.234567', 6), 1234567);
  for (const text of ['0', '-1', '1e3', '1,000', '1.001', '.5', 'Infinity', '', '9007199254740991']) assert.equal(parseVillageMinor(text), null, text);
  assert.equal(parseVillageMinor('0.0000001', 6), null);
  assert.equal(parseVillageMinor('1', 3), null);
  assert.equal(parseVillageMinor('0.00', 2, true), 0);
  assert.equal(parseVillageMinor('0.000000', 6, true), 0);
  for (const text of ['', '0e0', '-1', '0.001']) assert.equal(parseVillageMinor(text, 2, true), null);
});

test('the presentation never calls valueless devnet units dollars or combines rails', () => {
  assert.equal(villageMoney(20000, { rail: 'simulated', decimals: 2 }), '$200.00');
  assert.equal(villageMoney(1, { rail: 'pyusd-devnet', decimals: 6 }), '0.000001 test PYUSD');
  assert.equal(villageMoney(Number.MAX_SAFE_INTEGER, { rail: 'simulated', decimals: 2 }), '$90,071,992,547,409.91');
  assert.equal(villageMoney(Number.MAX_SAFE_INTEGER, { rail: 'pyusd-devnet', decimals: 6 }), '9,007,199,254.740991 test PYUSD');
  assert.match(villageRailLabel('pyusd-devnet'), /no monetary value/);
  assert.match(villageRailLabel('paypal-sandbox'), /test payment/);
  assert.match(villageRailLabel('simulated'), /no money moves/);
  assert.equal(villageMoney(NaN, {}), '—');
});

test('the next-stage hint names the stage and the exact amount that reaches it, by the rule the server uses for the stage', () => {
  const fund = (netMinor, extra = {}) => ({ status: 'open', projectKind: 'schoolhouse', targetMinor: 40000, progress: { netMinor }, ...extra });
  assert.deepEqual(villageNextStage(fund(0)), { name: 'Under construction', awayMinor: 10000 });
  assert.deepEqual(villageNextStage(fund(20000)), { name: 'Finished schoolhouse', awayMinor: 4000 });
  assert.deepEqual(villageNextStage(fund(24000)), { name: 'Gathering place', awayMinor: 16000 });
  assert.equal(villageNextStage(fund(40000)), null, 'a complete project has no next stage');
  assert.equal(villageNextStage(fund(45000)), null, 'nor one funded past its target');
  assert.equal(villageNextStage(fund(20000, { status: 'closed' })), null, 'a closed fund takes no more contributions');
  for (const broken of [null, {}, fund(100, { targetMinor: 0 }), fund(100, { targetMinor: 1.5 })]) assert.equal(villageNextStage(broken), null);
  // Paying exactly the amount named moves the stage the server reports, and one unit less does not, at any target.
  for (const targetMinor of [1, 3, 999, 40000, 123457, 6_000_000_000]) {
    for (const netMinor of [0, Math.floor(targetMinor / 4), Math.floor(targetMinor / 2), Math.floor(targetMinor * 0.6), targetMinor - 1].filter((n) => n >= 0 && n < targetMinor)) {
      const next = villageNextStage(fund(netMinor, { targetMinor })), stage = (n) => projectStage(n, targetMinor, 'schoolhouse');
      assert.ok(stage(netMinor + next.awayMinor).index > stage(netMinor).index, `${netMinor} of ${targetMinor}`); // a tiny target can pass two stages at once
      assert.equal(stage(netMinor + next.awayMinor - 1).index, stage(netMinor).index, `${netMinor} of ${targetMinor}, one unit short`);
      assert.equal(stage(netMinor + next.awayMinor).name, next.name);
    }
  }
});
