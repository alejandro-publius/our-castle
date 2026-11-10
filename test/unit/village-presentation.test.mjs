import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVillageMinor, villageMoney, villageRailLabel } from '../../src/app/village-fund.js';

test('fund input preserves whole minor units and rejects ambiguous or unsafe money', () => {
  assert.equal(parseVillageMinor('40.01'), 4001);
  assert.equal(parseVillageMinor('0.000001', 6), 1);
  assert.equal(parseVillageMinor('1.234567', 6), 1234567);
  for (const text of ['0', '-1', '1e3', '1,000', '1.001', '.5', 'Infinity', '', '9007199254740991']) assert.equal(parseVillageMinor(text), null, text);
  assert.equal(parseVillageMinor('0.0000001', 6), null);
  assert.equal(parseVillageMinor('1', 3), null);
});

test('the presentation never calls valueless devnet units dollars or combines rails', () => {
  assert.equal(villageMoney(20000, { rail: 'simulated', decimals: 2 }), '$200.00');
  assert.equal(villageMoney(1, { rail: 'pyusd-devnet', decimals: 6 }), '0.000001 test PYUSD');
  assert.match(villageRailLabel('pyusd-devnet'), /no monetary value/);
  assert.match(villageRailLabel('paypal-sandbox'), /test payment/);
  assert.match(villageRailLabel('simulated'), /no money moves/);
  assert.equal(villageMoney(NaN, {}), '—');
});
