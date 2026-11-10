# Talk to your castle

The local MCP adapter lets an assistant read **one fund selected by a signed-in adult**. It answers from the app's saved fund records and returns a link to review that fund in the browser. It cannot create an order, capture money, approve a payment, subscribe, refund, transfer tokens or change the plan.

The three tools are:

| Tool | Result |
| --- | --- |
| `our_castle_fund_status` | Target, deadline, recorded progress, unit and test-mode label |
| `our_castle_fund_contributions` | Family display references, commitments and receipt display records |
| `our_castle_fund_review_link` | A local browser link; no payment is created |

All tools take an empty object. The connected adult selected the fund when granting access; the assistant cannot choose another household or fund through tool arguments. Commitments remain promises, not payments or debts. Simulated contributions, sandbox payments and valueless devnet test tokens retain separate labels and units. A read makes no PayPal, model or blockchain request.

## Connect a local client

The app's adult-only connection action issues a private token for the selected fund. It lasts at most **15 minutes**, ends when the original session expires or is revoked, and can be disconnected explicitly. Restarting the server invalidates all connections. Keep the token private; it gives its holder this narrow read access until it expires.

Configure a local stdio MCP client to run the entry point directly with Node. Do not use `npm run` for this command: an npm banner would pollute the protocol's standard output. An example client configuration is:

```json
{
  "mcpServers": {
    "our-castle": {
      "command": "node",
      "args": ["/absolute/path/to/our-castle/scripts/mcp.mjs"],
      "env": {
        "OUR_CASTLE_MCP_URL": "http://localhost:3200",
        "OUR_CASTLE_MCP_TOKEN": "<private short-lived token from the adult account>"
      }
    }
  }
}
```

Use the actual origin printed by the local family runner. The adapter accepts HTTP loopback origins on explicit ports 1024–65535; it connects to a literal loopback address even when the origin uses `localhost`. It will not follow redirects or read an arbitrary URL. It never loads a project `.env`, opens a database or looks for another application's credentials.

The connection token is **not** a PayPal, OpenAI, Anthropic or wallet key. Do not put any provider key into this configuration. Remove an expired token and reconnect through the adult account when another session is needed.

This repository implements and tests the stdio adapter; it does not configure the owner's Claude client or connect a ChatGPT account. ChatGPT can reach a private server through [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) when the account/workspace is configured for it. A public integration instead needs an authenticated HTTPS endpoint. Neither connection nor deployment is part of this source change.

## Server integration boundary

`createMcpCapabilities` is injected with two trusted callbacks:

- `resolveSessionScope(sessionId)` returns the **current**, authenticated session scope or `null`, including the current member role. It must not extend the session or return an old cached adult role.
- `readFund(scope, fundId)` rechecks village membership and returns the authorized fund view.

The root app composes the ordinary adult/CSRF routes `POST /api/mcp/grants` and `POST /api/mcp/grants/revoke`. Their bodies are `{fundId}` and `{grantId}` respectively. The returned token appears only in its issue response. The memory store retains its SHA-256 hash and bound session/member/household/fund; at most four connections per session and 128 per app are permitted.

The separate `GET /api/mcp/fund?view=status|contributions|review-link` bridge accepts `Authorization: Bearer <token>` and only reads through that capability. It is a narrow local read bridge, **not** a public MCP endpoint or a substitute for ordinary browser authorization. Never make all API routes accept the token. Revalidate session, role and fund membership for every read; a stale token is not sufficient. Closing or expiring a grant also prevents a pending read from returning afterward.

The adapter rebuilds its output from an allowlist. It omits private household balances, recipient merchant/wallet addresses, raw provider event identifiers, sender wallets, account/session identifiers and approval material. The contributions view returns at most 100 shares and 100 receipts with explicit total counts and a truncation flag. Names and titles are record data, not instructions to an assistant.

## Protocol and evidence

The implementation uses the pinned `@modelcontextprotocol/sdk` **1.32.2** and its negotiated **2025-11-25** protocol support. It is not a claim to implement every newer revision. [The matching transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) defines stdio framing; [the tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) defines schemas, results and annotations. Read-only annotations describe the tools; the server's permission checks actually enforce the boundary.

Run the focused evidence with:

```sh
node --test test/unit/mcp-capabilities.test.mjs test/unit/mcp-protocol.test.mjs
```

Thirteen tests pass on Node 24.22.1: scoped issue/read/revoke/expiry, membership/session/role changes, bounded grants and projections, revoked pending reads, units and labels, SDK tool discovery/validation, secret-safe failures, fixed loopback routing, redirect/body/link rejection and an actual SDK-to-stdio child process. Tests use only invented records and disposable loopback servers. They demonstrate the protocol and its boundaries, not a live Claude/ChatGPT conversation, hosted access or real payment.
