// The stdio process reads one fixed loopback application, not databases or a caller-supplied network destination.
import http from 'node:http';
import { MCP_VIEWS } from './capabilities.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function localMcpOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set OUR_CASTLE_MCP_URL to the local Our Castle origin.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port
    || !/^\d+$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535) {
    throw new Error('OUR_CASTLE_MCP_URL must be an HTTP loopback origin with an explicit port from 1024 to 65535.');
  }
  return url.origin;
}

export function createLocalFundReader({ origin, token, timeoutMs = 5000, maxBytes = 128 * 1024 } = {}) {
  const base = new URL(localMcpOrigin(origin));
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('Set OUR_CASTLE_MCP_TOKEN to the private, short-lived connection token.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new Error('Invalid local reader limits.');
  return async (view) => {
    if (!MCP_VIEWS.includes(view)) throw new Error('Unsupported assistant view.');
    const data = await new Promise((resolve, reject) => {
      // Explicit loopback IP avoids DNS/proxy resolution even when the app's passkey origin uses localhost.
      const req = http.request({ hostname: base.hostname === '[::1]' ? '::1' : '127.0.0.1', port: base.port,
        method: 'GET', path: `/api/mcp/fund?view=${view}`, headers: { Host: base.host, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }, (res) => {
        if (res.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')) {
          res.resume(); reject(new Error('The local assistant view was not available.')); return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); reject(new Error('The local assistant view exceeded its limit.')); }
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
            resolve(value);
          } catch { reject(new Error('The local assistant view was not valid JSON.')); }
        });
        res.on('error', () => reject(new Error('The local assistant view ended early.')));
      });
      const timer = setTimeout(() => { req.destroy(); reject(new Error('The local assistant view timed out.')); }, timeoutMs);
      timer.unref?.();
      req.on('close', () => clearTimeout(timer));
      req.on('error', () => { clearTimeout(timer); reject(new Error('The local Our Castle server could not be reached.')); });
      req.end();
    });
    if (view === 'review-link') {
      // Only the app's fixed review route may become a clickable link, even if a local response is malformed.
      const match = typeof data.path === 'string' && /^\/\?villageFund=([A-Za-z0-9_-]{1,100})$/.exec(data.path);
      if (!match) throw new Error('The local review link was not valid.');
      return { ...data, url: `${base.origin}${data.path}` };
    }
    return data;
  };
}
