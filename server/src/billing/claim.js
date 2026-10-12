// The claim form of a bill (billing extras, 4 Oct 2026). PURE.
//
// A claim form shows the bill by GROUP only (Consultation, Lab test, Inpatient …) with totals – never an item's name,
// so a confidential test or a procedure is not named on it. It holds no diagnosis, no notes and no results: that part
// of the form is printed empty, for the treating doctor to fill in and sign by hand.

import { GROUPS, GROUP_LABELS, INSURANCE_FIELDS } from './billingRules.js';
import { liveLines, totals } from './money.js';

/** The bill's live lines summed by group, in the price list's order: [{ group, label, items, amountPaise }]. */
export function groupSummary(bill) {
  const sums = new Map();
  for (const l of liveLines(bill)) {
    const g = sums.get(l.group) ?? { items: 0, amountPaise: 0 };
    g.items += 1;
    g.amountPaise += l.amountPaise;
    sums.set(l.group, g);
  }
  return GROUPS.filter((g) => sums.has(g)).map((g) => ({ group: g, label: GROUP_LABELS[g], ...sums.get(g) }));
}

/** The bill's sums for a claim form: as on the bill, and how much of what was paid came from insurance or a scheme. */
export function claimSums(bill) {
  const { subtotal, discount, total, paid, balance } = totals(bill);
  const paidByInsurance = (bill.payments ?? []).filter((p) => p.mode === 'insurance').reduce((s, p) => s + (p.kind === 'refund' ? -p.amountPaise : p.amountPaise), 0);
  return { subtotal, discount, total, paid, paidByInsurance, balance };
}

/** A bill's insurance details as stored → every field as text ('' = not recorded), or null when there are none. */
export function insuranceView(insurance) {
  if (!insurance) return null;
  const out = Object.fromEntries(Object.keys(INSURANCE_FIELDS).map((k) => [k, insurance[k] ?? '']));
  if (!Object.values(out).some(Boolean)) return null;
  return { ...out, byName: insurance.byName ?? '', at: insurance.at ?? null };
}
