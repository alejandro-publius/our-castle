import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEEPER_STEPS } from '../../src/app/keeper.js';

// Moss, the castle keeper: the tour is authored text that may only show journal tabs and point at the compass and
// Sound. These check the script, and add a narrow source guard against direct calls. The actual zero-write evidence is
// the browser checks in test/e2e/keeper.spec.mjs; a pattern check cannot prove every possible behavior.
const source = readFileSync(new URL('../../src/app/keeper.js', import.meta.url), 'utf8');

test('the keeper tells eight short steps in the demo order, pointing only at navigation', () => {
  assert.deepEqual(KEEPER_STEPS.map((step) => step.id), ['welcome', 'house', 'plan', 'give', 'ledger', 'compass', 'sound', 'finish']);
  for (const step of KEEPER_STEPS) {
    assert.ok(step.text.length > 0 && step.text.length <= 160, `${step.id} is short`);
    if (step.tab) assert.ok(['house', 'plan', 'give', 'ledger'].includes(step.tab), `${step.id} shows a journal tab`);
    if (step.cue) assert.match(step.cue, /^#(tab-(house|plan|give|ledger)|map-explore|sound-toggle)$/, `${step.id} points at navigation`);
  }
  assert.ok(Object.isFrozen(KEEPER_STEPS));
});

test('source guard: the keeper module makes no direct network, click, submit, field, event or storage call', () => {
  const forbidden = [/\bfetch\s*\(/, /\bapi\b/, /XMLHttpRequest|sendBeacon|WebSocket|EventSource/, /\.click\s*\(/, /requestSubmit|\.submit\s*\(/,
    /\.checked\s*=/, /\.value\s*=/, /dispatchEvent\s*\(/, /localStorage|sessionStorage|indexedDB|document\.cookie/];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern, String(pattern));
  // Every button it creates is an explicit type="button", so Enter can never submit a form through it.
  const buttons = source.match(/<button\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) assert.match(button, /type="button"/);
});
