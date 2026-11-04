// One small event bus so the payment flow, the panels and the 3D board never call each other directly.
const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
  emit(type, detail) {
    if (bus.log) bus.log.push({ type, detail, at: Date.now() });
    for (const fn of listeners.get(type) ?? []) {
      try { fn(detail); } catch (error) { console.error(`[bus] ${type} listener failed`, error); }
    }
  },
  log: null, // set to [] in the console or a test to record every event
};
