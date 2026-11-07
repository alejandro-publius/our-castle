// Live updates for shared families. Each signed-in page may hold one server-sent-events stream (GET /api/events). When a
// household's records change, every stream of that household receives an event name and an opaque revision, nothing
// else: no records, ids, names, amounts or secrets. The page then re-reads /api/state, which is authorized as usual.
//
// A stream is a read of the session, not activity: it never extends the session. Every few seconds each stream's session
// and membership are checked again; expiry, sign-out and removed access end the stream (and the page asks for the
// passkey). Connections are bounded per session, per household and in total, and every stream, listener and the one
// timer are released when the browser goes away or the server closes.
import { randomBytes } from 'node:crypto';

export const STREAMING = Symbol('streaming response');

export function createLive({ checkSession, limits = {} }) {
  const { perSession = 3, perHousehold = 24, total = 200, recheckMs = 15_000, retryMs = 3_000 } = limits;
  const boot = randomBytes(6).toString('base64url'); // a new value after every server start
  const streams = new Set();
  const revisions = new Map();
  let timer = null, closed = false;

  const revisionOf = (householdId) => `${boot}.${revisions.get(householdId) ?? 0}`;
  function write(stream, text) {
    if (stream.closed) return;
    try { stream.res.write(text); } catch { drop(stream); }
  }
  function drop(stream) {
    if (!streams.delete(stream)) return;
    stream.closed = true;
    if (!streams.size && timer) { clearInterval(timer); timer = null; }
  }
  function end(stream, reason) {
    if (stream.closed) return;
    write(stream, `event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
    try { stream.res.end(); } catch { /* already gone */ }
    drop(stream);
  }
  // Re-check every stream's session and membership; a comment line also keeps idle connections open through proxies.
  function tick() {
    for (const stream of [...streams]) {
      const reason = checkSession(stream.sessionId);
      if (reason) end(stream, reason); else write(stream, ': ok\n\n');
    }
  }

  return {
    revisionOf,
    /** Open a stream for an authorized scope. Throws (before any byte is written) when the bounds are reached. */
    subscribe(req, res, scope) {
      if (closed) throw Object.assign(new Error('The server is stopping.'), { status: 503, code: 'live_unavailable' });
      const all = [...streams];
      const mine = all.filter((s) => s.sessionId === scope.sessionId);
      // A member's oldest tab gives way to a new one rather than refusing it.
      if (mine.length >= perSession) end(mine[0], 'replaced');
      if (all.filter((s) => s.householdId === scope.householdId && !s.closed).length >= perHousehold || streams.size >= total) {
        throw Object.assign(new Error('Too many open pages for live updates. Close a tab; updates continue on focus.'), { status: 503, code: 'live_busy' });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      const stream = { res, sessionId: scope.sessionId, memberId: scope.memberId, householdId: scope.householdId, closed: false };
      streams.add(stream);
      req.on('close', () => drop(stream));
      res.on('error', () => drop(stream));
      write(stream, `retry: ${retryMs}\n\nevent: ready\ndata: ${JSON.stringify({ revision: revisionOf(scope.householdId) })}\n\n`);
      timer ??= setInterval(tick, recheckMs);
      timer.unref?.();
      return STREAMING;
    },
    /**
     * A write for this household is about to run. Its state answer then carries a later revision than any state read
     * before it, so a page can tell an older answer that arrives late from a newer one. Nothing is sent yet.
     */
    touch(householdId) {
      if (householdId) revisions.set(householdId, (revisions.get(householdId) ?? 0) + 1);
    },
    /** A household's records changed: tell its open pages, and only them, to read the state again. */
    notify(householdId) {
      if (!householdId) return;
      revisions.set(householdId, (revisions.get(householdId) ?? 0) + 1);
      const data = `event: invalidate\ndata: ${JSON.stringify({ revision: revisionOf(householdId) })}\n\n`;
      for (const stream of streams) if (stream.householdId === householdId) write(stream, data);
    },
    endSession(sessionId, reason) { for (const s of [...streams]) if (s.sessionId === sessionId) end(s, reason); },
    endMember(memberId, reason) { for (const s of [...streams]) if (s.memberId === memberId) end(s, reason); },
    recheck: tick,
    stats() {
      return { streams: streams.size, households: new Set([...streams].map((s) => s.householdId)).size, timer: Boolean(timer), boot };
    },
    close() {
      closed = true;
      for (const s of [...streams]) end(s, 'server_closing');
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
