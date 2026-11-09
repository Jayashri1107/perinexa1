// The IPD desk (Billing → IPD – docs/IPD_DISCHARGE_BILLING_PLAN.md, 9 Nov 2026): where a stay is in the HIMS order
// (in hospital → card signed → discharge recorded → final bill → cleared), and the three ways the bill prints. PURE.

import { BedDouble, ClipboardCheck, DoorOpen, FileCheck, FileClock } from 'lucide-react';
import { GROUP_LABELS } from './billingFormat.js';

/** Where the stay is: { key, tone, icon, label, next } – status is colour + icon + word. */
export function stayStep(stay, bill) {
  if (stay.status === 'admitted') return { key: 'in', tone: 'admitted', icon: BedDouble, label: 'In hospital', next: 'Interim bill and advances while she is in hospital.' };
  if (stay.cleared || stay.clearance) return { key: 'cleared', tone: 'stable', icon: DoorOpen, label: 'Cleared – gate pass', next: '' };
  if (bill?.final) return { key: 'final', tone: 'due', icon: FileCheck, label: 'Final bill', next: 'Take the balance or settle it, then clear her for leaving.' };
  if (stay.discharge) return { key: 'recorded', tone: 'watch', icon: FileClock, label: 'Final bill due', next: 'Check the items, then make the final bill.' };
  return { key: 'card', tone: 'watch', icon: ClipboardCheck, label: 'Discharge card signed', next: 'Record the discharge: type, doctor and remark.' };
}

// How the bill prints (the HIMS's three choices)
export const BILL_LAYOUTS = [
  { key: 'datewise', label: 'Date-wise draft' },
  { key: 'details', label: 'Details' },
  { key: 'summary', label: 'Summary' },
];

/** What the printed bill is called: interim while in hospital, draft after the discharge until it is final. */
export function billTitle(stay, bill) {
  if (bill?.final) return 'Final bill';
  return stay.status === 'admitted' ? 'Interim bill' : 'Draft bill – not final';
}

/** The day (YYYY-MM-DD, local) an item was added. */
const dayOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Items by the day they were added, oldest first: [{ day, lines, amountPaise }]. */
export function linesByDate(lines) {
  const map = new Map();
  for (const l of lines) {
    const day = dayOf(l.addedAt);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(l);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, lines: list, amountPaise: list.reduce((s, l) => s + l.amountPaise, 0) }));
}

/** The summary: one row per group with its items and amount, in the price list's order. */
export function summaryByGroup(lines) {
  const order = Object.keys(GROUP_LABELS);
  const map = new Map();
  for (const l of lines) {
    const row = map.get(l.group) ?? { group: l.group, label: GROUP_LABELS[l.group] ?? 'Other', items: 0, amountPaise: 0 };
    row.items += 1;
    row.amountPaise += l.amountPaise;
    map.set(l.group, row);
  }
  return [...map.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** Money in for the stay: deposits and payments add, refunds take away. */
export const advanceTotal = (payments) => payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amountPaise : p.amountPaise), 0);

/** The administrative charges on the bill now (paise; 0 when none). */
export const adminChargeOf = (lines) => lines.filter((l) => l.key === 'admin-charge' && !l.removed).reduce((s, l) => s + l.amountPaise, 0);
