// AG Studio runs the existing server-backed steward without adding a dashboard chat panel.
// All payment tools/proof stay on the server; each temporary run belongs to one current record scope.
const changed = () => new DOMException('The records changed. Check the current record again.', 'AbortError');

export function createTreasuryAgent({ lib = null, studio = null, request, getScope }) {
  let active = null;
  const stats = { source: lib ? 'ag-studio-agent-framework' : 'fallback', state: 'idle', completed: 0, cancelled: 0 };
  const current = (entry) => active === entry && !entry.done && !entry.cancelled && entry.scope === getScope();

  async function* run(input, ctx) {
    const entry = active;
    if (!entry || entry.session?.threadId !== input.threadId) return;
    if (!current(entry)) { cancel(); return; }
    const abort = () => entry.controller.abort();
    ctx.signal.addEventListener('abort', abort, { once: true });
    try {
      yield { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
      const result = await request(entry.payload, { signal: entry.controller.signal });
      if (!current(entry) || ctx.signal.aborted) { if (active === entry) cancel(); return; }
      entry.result = result;
      // Only completed checks returned by the server enter the framework's tool trace.
      for (const check of result.checks ?? []) {
        const id = crypto.randomUUID();
        yield { type: 'TOOL_CALL_START', toolCallId: id, toolCallName: check.tool };
        yield { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: JSON.stringify(check.orderId ? { orderId: check.orderId } : {}) };
        yield { type: 'TOOL_CALL_END', toolCallId: id };
        yield { type: 'TOOL_CALL_RESULT', toolCallId: id, messageId: crypto.randomUUID(), content: JSON.stringify(check) };
      }
      if (result.answer) yield { type: 'TEXT_MESSAGE_CHUNK', messageId: crypto.randomUUID(), role: 'assistant', delta: result.answer };
      yield { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId };
    } catch (error) {
      if (entry.controller.signal.aborted || ctx.signal.aborted) return;
      entry.error = error;
      yield { type: 'RUN_ERROR', message: error.message };
    } finally {
      ctx.signal.removeEventListener('abort', abort);
      if (ctx.signal.aborted && active === entry && !entry.done) cancel();
    }
  }

  const harness = lib?.createAiHarness(studio, () => ({
    primary: 'house-steward',
    agents: [{ id: 'house-steward', name: 'House steward', description: 'Read household records and check a selected PayPal order.', run }],
  }));

  function finish(entry, error) {
    if (entry.done) return;
    entry.done = true;
    entry.session?.removeEventListener('changed', entry.listener);
    entry.session?.close();
    if (entry.session) harness.deleteThread(entry.session.threadId).catch(() => {});
    if (active === entry) { active = null; stats.state = 'idle'; }
    if (error) entry.reject(error);
    else { stats.completed++; entry.resolve(entry.result); }
  }
  function cancel() {
    if (!active || active.cancelled) return;
    const entry = active;
    entry.cancelled = true;
    stats.cancelled++;
    entry.controller.abort();
    entry.session?.cancel();
    finish(entry, changed());
  }

  return {
    harness,
    refreshScope() { if (active && active.scope !== getScope()) cancel(); },
    cancel,
    status: () => ({ ...stats, threads: harness?.threads.length ?? 0 }),
    ask(payload) {
      if (active) return Promise.reject(new Error('A record check is already running.'));
      const entry = { scope: getScope(), payload: { ...payload }, controller: new AbortController(), done: false };
      const answer = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      active = entry;
      stats.state = 'running';
      (async () => {
        if (!harness) {
          entry.result = await request(entry.payload, { signal: entry.controller.signal });
          if (!current(entry)) { if (active === entry) cancel(); return; }
          finish(entry); return;
        }
        const session = await harness.createThread({ agentId: 'house-steward' });
        entry.session = session;
        if (!current(entry)) { session.close(); await harness.deleteThread(session.threadId); if (active === entry) cancel(); return; }
        entry.listener = () => {
          if (entry.done || entry.cancelled) return;
          if (!current(entry)) { if (active === entry) cancel(); return; }
          if (session.status === 'error') finish(entry, entry.error ?? new Error('The record check could not finish.'));
          else if (session.status === 'idle' && entry.result) finish(entry);
        };
        session.addEventListener('changed', entry.listener);
        session.sendMessage(payload.question);
      })().catch((error) => finish(entry, error));
      return answer;
    },
  };
}
