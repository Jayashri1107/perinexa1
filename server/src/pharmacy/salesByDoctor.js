// PH24 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 5): pharmacy sales by prescribing doctor – seen only by the
// pharmacist (in the hospital) and the super admin (numbers only, per hospital). Not the hospital admin, not the doctors,
// not the hospital's Analytics or export. Outside doctors appear by the name typed at the counter (owner, 10 Nov 2026).
//
// A doctor is the prescription's doctor (`doctor.userId`, kept from 11 Nov 2026); else the registration number typed;
// else the name with case, dots, "Dr" and spaces ignored ("Dr A. Kulkarni" = "dr a kulkarni"). Amounts net of returns.
// The pharmacy's own invoices only; issues to the wards are included (the prescribing doctor is on them). PURE.

import { invoiceTotals } from './pharmacyService.js';

const nameKey = (name) => String(name ?? '').toLowerCase().replace(/\bdr\b\.?/g, ' ').replace(/[^a-z]/g, '');
const regKey = (reg) => String(reg ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The doctor key of an invoice, and the words shown: { key, name, reg, inHospital } – null without a doctor. */
export function doctorOf(inv) {
  const d = inv.doctor;
  if (!d || (!d.name && !d.userId && !d.reg)) return null;
  if (d.userId) return { key: `u:${d.userId}`, name: d.name ?? '', reg: d.reg ?? '', inHospital: true };
  if (regKey(d.reg)) return { key: `r:${regKey(d.reg)}`, name: d.name ?? '', reg: d.reg ?? '', inHospital: false };
  const k = nameKey(d.name);
  return k ? { key: `n:${k}`, name: d.name, reg: '', inHospital: false } : null;
}

/** [{ key, name, reg, inHospital, invoices, amountPaise }] for a list of invoices, largest first. */
export function salesByDoctor(invoices) {
  const by = new Map();
  for (const inv of invoices) {
    const doc = doctorOf(inv);
    if (!doc) continue;
    const net = invoiceTotals(inv).netPaise;
    const row = by.get(doc.key) ?? { ...doc, invoices: 0, amountPaise: 0, names: new Set() };
    row.invoices += 1;
    row.amountPaise += net;
    if (doc.name) row.names.add(doc.name);
    by.set(doc.key, row);
  }
  return [...by.values()]
    .map(({ names, ...r }) => ({ ...r, name: [...names][0] ?? r.name, otherSpellings: [...names].slice(1) }))
    .sort((a, b) => b.amountPaise - a.amountPaise || a.name.localeCompare(b.name));
}

// The super admin's view: a line only from this many invoices – one invoice is one patient's purchase.
export const PLATFORM_DOCTOR_MIN_INVOICES = 5;

/** The super admin's rows: names, counts and amounts only; lines under the minimum added up as "Other doctors". */
export function platformRows(rows) {
  const shown = rows.filter((r) => r.invoices >= PLATFORM_DOCTOR_MIN_INVOICES).map((r) => ({ name: r.name, inHospital: r.inHospital, invoices: r.invoices, amountPaise: r.amountPaise }));
  const rest = rows.filter((r) => r.invoices < PLATFORM_DOCTOR_MIN_INVOICES);
  if (rest.length) shown.push({ name: 'Other doctors', inHospital: null, invoices: rest.reduce((s, r) => s + r.invoices, 0), amountPaise: rest.reduce((s, r) => s + r.amountPaise, 0), others: rest.length });
  return shown;
}
