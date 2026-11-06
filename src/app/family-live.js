// Live updates on a shared family's page: one EventSource. Its events carry only an event name and the household's
// revision ("something changed"); the page then re-reads its own state through the normal authorized route, so no
// record travels here. When the stream drops, the browser retries on its own; when the server refuses or stays away,
// retries back off (1 s doubling to 30 s, with jitter) and check the session first, so an ended session goes to
// sign-in instead of retrying forever.
export function createFamilyLive({ onChange, onEnded, onStatus, checkSession, url = '/api/events' }) {
  let source = null, stopped = false, opened = false, retries = 0, retryTimer = null, downSince = null, replaced = false;
  const revisionIn = (event) => { try { return JSON.parse(event.data).revision ?? null; } catch { return null; } };

  function down() { downSince ??= Date.now(); onStatus('down', downSince); }
  function connect() {
    if (stopped) return;
    source?.close();
    const current = source = new EventSource(url);
    current.addEventListener('ready', (event) => {
      if (current !== source) return;
      // The first ready covers what changed between the page's first read and the stream opening; a later one covers
      // anything committed while the page was away. Either way the page re-reads only if the revision moved.
      onChange(opened ? 'reconnected' : 'ready', revisionIn(event));
      opened = true; retries = 0; downSince = null; replaced = false;
      onStatus('live');
    });
    current.addEventListener('invalidate', (event) => { if (current === source) onChange('changed', revisionIn(event)); });
    current.addEventListener('end', (event) => {
      if (current !== source) return;
      let reason = 'expired';
      try { reason = JSON.parse(event.data).reason ?? reason; } catch { /* keep the default */ }
      current.close();
      // The server is restarting, or this browser signed in again (a new session): check the session, then reconnect.
      if (reason === 'server_closing' || reason === 'rotated') { down(); retry(); return; }
      // Another tab of this sign-in took the stream: this tab keeps its focus and timed re-reads without one.
      if (reason === 'replaced') { replaced = true; onStatus('polling'); return; }
      stop(); onEnded(reason);
    });
    current.onerror = () => {
      if (current !== source || stopped) return;
      down();
      // CONNECTING: the browser retries by itself. CLOSED: refused (session, limits) or unreachable; decide after a pause.
      if (current.readyState === EventSource.CLOSED) retry();
    };
  }
  function retry() {
    clearTimeout(retryTimer);
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retries++, 5)) * (0.8 + Math.random() * 0.4);
    retryTimer = setTimeout(async () => {
      let verdict = 'unreachable';
      try { verdict = await checkSession(); } catch { /* unreachable */ }
      if (stopped) return;
      if (verdict === 'signed-out') { stop(); onEnded('expired'); return; }
      if (verdict === 'unreachable') { retry(); return; }
      connect();
    }, delay);
  }
  function stop() { stopped = true; clearTimeout(retryTimer); source?.close(); source = null; }

  connect();
  return {
    stop,
    /** Reconnect now (the page's Reconnect button, or a replaced tab shown again). */
    retryNow() { if (stopped) return; clearTimeout(retryTimer); retries = 0; connect(); },
    status: () => ({ connected: source?.readyState === EventSource.OPEN, retries, downSince, replaced, stopped }),
  };
}
