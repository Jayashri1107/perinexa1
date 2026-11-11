// PH17 (docs/PHARMACY_BUILD_NOTE.md): the order suggestion follows the last weeks' use. PURE.
//
//   use per day = (sold + issued − returned) over the look-back period ÷ the days the medicine WAS in stock then
//                 (a week out of stock must not lower the figure – it would hide that more was needed)
//   to order    = use per day × (the supplier's days + the days to cover) − usable stock − on order,
//                 never below what the fixed reorder level asks (ordersService.js suggestedOrderQty)
// A medicine with no history falls back to its reorder level. Held and expired stock is not usable (PH5).

const DAY = 86_400_000;

/**
 * moves: this medicine's stock moves in the window and the last one before it ({ kind, qty, balanceAfter, at }),
 * sorted by time; from / to: the window (instants). Returns { netOut, daysInStock, perDay }.
 */
export function useOf(moves, from, to) {
  let netOut = 0;
  for (const m of moves) {
    if (m.at < from || m.at >= to) continue;
    if (m.kind === 'sale' || m.kind === 'issue') netOut += -m.qty;
    else if (m.kind === 'return') netOut -= m.qty;
  }
  // Days in stock: the balance after each move, from the last move before the window
  const before = moves.filter((m) => m.at < from).at(-1);
  let balance = before ? before.balanceAfter : 0;
  let since = from;
  let inMs = 0;
  for (const m of moves) {
    if (m.at < from || m.at >= to) continue;
    if (balance > 0) inMs += m.at - since;
    balance = m.balanceAfter;
    since = m.at;
  }
  if (balance > 0) inMs += to - since;
  const daysInStock = Math.max(0, inMs / DAY);
  const perDay = netOut > 0 && daysInStock >= 1 ? netOut / daysInStock : 0;
  return { netOut: Math.max(0, netOut), daysInStock: Math.round(daysInStock), perDay };
}

/** The quantity to order by use (whole units), never below the fixed-level figure `byLevel`. */
export function orderByUse({ perDay, leadDays, coverDays, usable, onOrder, byLevel }) {
  const want = Math.ceil(perDay * (leadDays + coverDays)) - usable - onOrder;
  return Math.max(0, want, byLevel);
}
