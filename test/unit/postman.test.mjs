import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const collection = JSON.parse(readFileSync(new URL('../../postman/our-house.postman_collection.json', import.meta.url), 'utf8'));
const environment = JSON.parse(readFileSync(new URL('../../postman/our-house.postman_environment.json', import.meta.url), 'utf8'));
const requests = collection.item.flatMap((folder) => folder.item);

test('Postman collection is a v2.1 collection whose requests all carry assertions', () => {
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.equal(collection.item.length, 2);
  assert.ok(requests.length >= 20);
  for (const r of requests) {
    const tests = (r.event ?? []).find((e) => e.listen === 'test');
    assert.ok(tests?.script.exec.some((line) => line.includes('pm.test(')), `${r.name} has no assertions`);
    const url = typeof r.request.url === 'string' ? r.request.url : r.request.url.raw;
    assert.match(url, /^\{\{(baseUrl|paypalApiBase)\}\}\//, `${r.name} must use a variable base URL`);
  }
});

test('Postman environment is sandbox-only and ships without credentials', () => {
  const values = Object.fromEntries(environment.values.map((v) => [v.key, v]));
  assert.equal(values.paypalApiBase.value, 'https://api-m.sandbox.paypal.com');
  assert.equal(values.paypalClientId.value, '');
  assert.equal(values.paypalClientSecret.value, '');
  assert.equal(values.paypalClientSecret.type, 'secret');
  const text = JSON.stringify({ collection, environment });
  assert.ok(!/api-m\.paypal\.com|api\.paypal\.com/.test(text), 'no live PayPal endpoint appears');
  assert.ok(!/sk-ant-|Bearer [A-Za-z0-9]{20,}/.test(text), 'no keys or tokens are embedded');
});
