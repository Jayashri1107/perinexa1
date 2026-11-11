// PH6 (docs/PHARMACY_BUILD_NOTE.md): what was already sold from a prescription, line by line – shown at the counter
// ("Given: 10 on 3 Nov (PH-000412). Still to give: 20.") and used to ask why a line given in full is sold again.
// Sales are found by the prescription's visit (so a sale on her main record counts for a prescription written on her
// earlier, duplicate record); quantities are net of returns.

import { isoDay, toHospitalDate } from '../careplans/dates.js';
import { PharmacyInvoice } from '../models/Pharmacy.js';

/**
 * { byItem: Map rxItemId → [{ number, date, name, qty }], unlinked: Map visitId → [{ number, date }] }. Sales made
 * before 11 Nov 2026 do not say which line they were for: they are listed with the prescription only (never guessed
 * onto a line). A sale with nothing left after returns is left out.
 */
export async function givenFromPrescriptions(tenantId, visitIds) {
  const byItem = new Map();
  const unlinked = new Map();
  if (!visitIds.length) return { byItem, unlinked };
  const invoices = await PharmacyInvoice.find({ tenantId, visitId: { $in: visitIds } }, { number: 1, visitId: 1, lines: 1, created: 1, createdAt: 1 }).sort({ 'created.at': 1 }).lean();
  for (const inv of invoices) {
    const date = isoDay(toHospitalDate(inv.created?.at ?? inv.createdAt));
    let old = false;
    for (const l of inv.lines) {
      const net = l.qty - (l.returnedQty ?? 0);
      if (net <= 0) continue;
      if (!l.rxItemId) {
        old = true;
        continue;
      }
      const k = String(l.rxItemId);
      if (!byItem.has(k)) byItem.set(k, []);
      const list = byItem.get(k);
      const same = list.find((x) => x.number === inv.number && x.name === l.name);
      if (same) same.qty += net;
      else list.push({ number: inv.number, date, name: l.name, qty: net });
    }
    if (old) {
      const k = String(inv.visitId);
      if (!unlinked.has(k)) unlinked.set(k, []);
      unlinked.get(k).push({ number: inv.number, date });
    }
  }
  return { byItem, unlinked };
}

/**
 * A prescription line's sales for the counter: { sold, givenQty, stillToGive, givenInFull }. suggested: the quantity
 * worked out from the prescription (gst.js suggestedQty), or null – then any sale counts as given in full.
 */
export function givenWords(sold, suggested) {
  const givenQty = sold.reduce((n, s) => n + s.qty, 0);
  const stillToGive = suggested != null ? Math.max(0, suggested - givenQty) : null;
  return { sold, givenQty, stillToGive, givenInFull: givenQty > 0 && (suggested == null || givenQty >= suggested) };
}
