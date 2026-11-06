// Stable-id row changes for Studio live data and the ledger grid. No amounts or entitlement are computed here.
export function rowChanges(previous, next) {
  const before = new Map(previous.map((r) => [String(r.id), r]));
  const after = new Map(next.map((r) => [String(r.id), r]));
  return {
    add: next.filter((r) => !before.has(String(r.id))),
    update: next.filter((r) => before.has(String(r.id)) && JSON.stringify(before.get(String(r.id))) !== JSON.stringify(r)),
    remove: previous.filter((r) => !after.has(String(r.id))).map((r) => String(r.id)),
  };
}
export const hasChanges = (delta) => delta.add.length + delta.update.length + delta.remove.length > 0;
