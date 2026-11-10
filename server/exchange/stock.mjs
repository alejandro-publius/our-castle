// Item availability is a planning fact. It never writes financial records or turns a promise into stock.
export function sharedItems(db, goal) {
  const rows = db.prepare(`SELECT r.line_id, r.item_name, r.needs, o.quantity, o.kind, o.return_by
    FROM exchange_offers o JOIN exchange_requests r ON r.id = o.request_id
    WHERE r.goal_id = ? AND o.status = 'received'`).all(goal.id);
  return rows.filter(r => r.kind === 'gift' || (goal.targetDate && r.return_by >= goal.targetDate));
}
export function sharedQuantity(rows, item) {
  return rows.filter(r => r.line_id === item.id && r.item_name === item.name && (r.needs ?? null) === (item.needs ?? null))
    .reduce((n, r) => n + r.quantity, 0);
}
export function guardSharedEdits(db, goal, saved, fail) {
  const holds = db.prepare(`SELECT r.line_id, r.item_name, r.needs, SUM(o.quantity) AS quantity
    FROM exchange_offers o JOIN exchange_requests r ON r.id = o.request_id
    WHERE r.goal_id = ? AND o.status IN ('accepted', 'received') GROUP BY r.line_id, r.item_name, r.needs`).all(goal.id);
  for (const hold of holds) {
    const line = saved.find(l => l.id === hold.line_id);
    if (!line || line.name !== hold.item_name || (line.needs ?? null) !== hold.needs || line.quantity - line.ownedQuantity < hold.quantity)
      throw fail(409, 'exchange_item_in_use', 'Resolve the accepted or received neighbor item before removing it, changing its requirements or reducing how many you need.');
  }
}
