#!/usr/bin/env node
// Run directly with node, not `npm run`, whose banner would corrupt MCP stdout. No .env or database is loaded.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCastleMcpServer } from '../server/mcp/tools.mjs';
import { createLocalFundReader } from '../server/mcp/client.mjs';

try {
  const read = createLocalFundReader({ origin: process.env.OUR_CASTLE_MCP_URL, token: process.env.OUR_CASTLE_MCP_TOKEN });
  const server = createCastleMcpServer({ read });
  await server.connect(new StdioServerTransport());
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await server.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  process.stderr.write('Our Castle MCP could not start. Configure its local origin and short-lived assistant token; never use provider keys.\n');
  process.exitCode = 1;
}
