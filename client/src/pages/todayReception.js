// Reception's Today (owner, 13 Oct 2026): the number cards at the top and the "Payments to collect" list – worked out
// from what the page already loads (today's patients and call lists, the unpaid bills). No browser needed to test.

/** Today's patients: how many, how many arrived, how many still expected; and the calls to make. */
export function receptionCounts(today) {
  const rows = today?.patients ?? [];
  const arrived = rows.filter((r) => r.arrivedAt).length;
  const lists = [
    ['td-due', today?.dueNow?.length ?? 0],
    ['td-overdue', today?.overdue?.length ?? 0],
    ['td-babies', today?.babiesDue?.length ?? 0],
  ];
  const calls = lists.reduce((s, [, n]) => s + n, 0);
  return {
    patients: rows.length,
    arrived,
    expected: rows.length - arrived,
    calls,
    // The card opens the first call list that has someone in it
    callsList: (lists.find(([, n]) => n > 0) ?? lists[1])[0],
  };
}

/**
 * Bills to settle now (alerts for reception): an unpaid bill of a patient who is here today, or of a stay that has
 * ended (discharged, bill not settled). Most owed first. Each: the bill and why it is listed.
 */
export function paymentsToCollect(unpaidBills = [], todayRows = []) {
  const here = new Set(todayRows.filter((r) => r.arrivedAt).map((r) => r.patient.id));
  return unpaidBills
    .filter((b) => b.balance > 0 && b.patient && !b.cancelled)
    // A stay still going is settled at discharge, so it is not listed yet
    .map((b) => ({ bill: b, why: b.stay ? (b.stay.inHospital ? null : 'discharged') : here.has(b.patient.id) ? 'here' : null }))
    .filter((x) => x.why)
    .sort((a, b) => b.bill.balance - a.bill.balance);
}
