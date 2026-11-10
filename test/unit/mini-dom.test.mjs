import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFromPage } from '../helpers/mini-dom.mjs';

test('journal icons preserve their attributes and the form siblings that follow them', () => {
  const doc = documentFromPage('kit', '<details id="kit" open><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h1"/><circle cx="2" cy="2" r="1"/></svg><span>Kit list</span></summary><input id="quantity" value="3"></details>');
  const summary = doc.body.querySelector('summary');
  const svg = summary.querySelector('svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.childNodes.length, 2);
  assert.equal(summary.querySelector('span').parentNode, summary);
  assert.equal(doc.getElementById('quantity').parentNode, doc.getElementById('kit'));
  assert.equal(doc.getElementById('quantity').value, '3');
});

test('support for self-closing SVG does not hide mismatched HTML or SVG nesting', () => {
  assert.throws(() => documentFromPage('kit', '<div id="kit"><span/></div>'), /does not close <span>/);
  assert.throws(() => documentFromPage('kit', '<div id="kit"><svg><path></svg></div>'), /does not close <path>/);
});
