import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCastleMcpServer } from '../../server/mcp/tools.mjs';
import { createLocalFundReader, localMcpOrigin } from '../../server/mcp/client.mjs';

const token = 'a'.repeat(43);
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://localhost:${server.address().port}`;
}

test('real SDK client discovers only three read tools; caller identity overrides and writes are rejected', async t => {
  const views = [];
  const server = createCastleMcpServer({ read: async view => { views.push(view); return { fund: { id: 'fund_a' }, view }; } });
  const client = new Client({ name: 'test-reader', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name), ['our_castle_fund_status', 'our_castle_fund_contributions', 'our_castle_fund_review_link']);
  assert.ok(tools.tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint && t.inputSchema.additionalProperties === false));
  for (const [name, args] of [['our_castle_fund_status', { householdId: 'victim' }], ['our_castle_fund_status', { fundId: 'other' }], ['capture_payment', {}]]) {
    const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError, true);
  }
  assert.deepEqual(views, []);
  for (const name of tools.tools.map(t => t.name)) {
    const result = await client.callTool({ name, arguments: {} }); assert.equal(result.isError, undefined); assert.equal(result.structuredContent.fund.id, 'fund_a');
  }
  assert.deepEqual(views, ['status', 'contributions', 'review-link']);
});

test('tool failures cannot leak server exceptions or connection secrets', async t => {
  const server = createCastleMcpServer({ read: () => { throw Error(`private-key ${token}`); } });
  const client = new Client({ name: 'test-reader', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: 'our_castle_fund_status', arguments: {} });
  assert.equal(result.isError, true); assert.doesNotMatch(JSON.stringify(result), /private-key|aaaaaaa/);
});

test('local reader fixes destination, port and headers; malformed or nonloopback URLs never connect', () => {
  for (const origin of ['https://localhost:1234', 'http://example.com:1234', 'http://127.0.0.1.example.com:1234',
    'http://user:pass@localhost:1234', 'http://localhost:1234/path', 'http://localhost:1234/?x=1', 'http://localhost:1234/#x', 'http://localhost:80', 'http://localhost:1023']) {
    assert.throws(() => createLocalFundReader({ origin, token }));
  }
  assert.equal(localMcpOrigin('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
  assert.equal(localMcpOrigin('http://[::1]:1234'), 'http://[::1]:1234');
  assert.throws(() => createLocalFundReader({ origin: 'http://localhost:1234', token: token + '\r\nFoo: bar' }));
});

test('local reader sends only GET to its fixed scoped bridge and resolves review links locally', async t => {
  const requests = [];
  const origin = await fixture(t, (req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, host: req.headers.host, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url.includes('review-link') ? { path: '/?villageFund=fund_a', createsPayment: false } : { fund: { id: 'fund_a' } }));
  });
  const read = createLocalFundReader({ origin, token });
  assert.equal((await read('status')).fund.id, 'fund_a');
  assert.equal((await read('review-link')).url, `${origin}/?villageFund=fund_a`);
  assert.deepEqual(requests.map(r => [r.method, r.url, r.cookie]), [['GET', '/api/mcp/fund?view=status', undefined], ['GET', '/api/mcp/fund?view=review-link', undefined]]);
  assert.ok(requests.every(r => r.auth === `Bearer ${token}` && r.host === new URL(origin).host));
  await assert.rejects(read('payment'));
  assert.equal(requests.length, 2);
});

test('local reader refuses redirects, oversized bodies, non-JSON and arbitrary link targets', async t => {
  let mode = 'redirect', requests = 0;
  const origin = await fixture(t, (_req, res) => {
    requests++;
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://example.com/collect' }); res.end(); }
    else if (mode === 'large') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: 'a'.repeat(1000) })); }
    else if (mode === 'link') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ path: '//example.com/collect' })); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); }
  });
  const read = createLocalFundReader({ origin, token, maxBytes: 500 });
  for (mode of ['redirect', 'large', 'html']) await assert.rejects(read('status'));
  mode = 'link'; await assert.rejects(read('review-link'));
  assert.equal(requests, 4);
});

test('an actual stdio child serves SDK initialization, listing and scoped reads without loading app configuration', async t => {
  const origin = await fixture(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ fund: { id: 'fund_a', label: 'Simulated example contributions; no money moved' } }));
  });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/mcp.mjs', import.meta.url))],
    env: { OUR_CASTLE_MCP_URL: origin, OUR_CASTLE_MCP_TOKEN: token, OUR_CASTLE_ENV_FILE: '/not-an-app-config', OUR_CASTLE_DATA_DIR: '/not-a-database' }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-evidence', version: '1' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 3);
  const result = await client.callTool({ name: 'our_castle_fund_status', arguments: {} });
  assert.equal(result.structuredContent.fund.id, 'fund_a');
  assert.equal(stderr, '');
});
