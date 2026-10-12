// GST for pharmacy invoices. PURE. Medicines are sold at MRP, which already includes GST: the taxable value is worked
// back from the amount, and the GST is split equally into CGST and SGST (a sale inside the state). Amounts in paise.

/** A line's money: amount (after the sale's discount %), taxable value, GST, CGST, SGST. */
export function lineMoney({ qty, mrpPaise, gstRate, discountPercent = 0 }) {
  const gross = qty * mrpPaise;
  const amount = Math.round((gross * (100 - discountPercent)) / 100);
  const taxable = Math.round((amount * 100) / (100 + gstRate));
  const gst = amount - taxable;
  const cgst = Math.floor(gst / 2);
  return { grossPaise: gross, amountPaise: amount, taxablePaise: taxable, gstPaise: gst, cgstPaise: cgst, sgstPaise: gst - cgst };
}

/** The same for part of a line (a return of `qty` of its units), in proportion to what was charged. */
export function partOf(line, qty) {
  const amount = Math.round((line.amountPaise * qty) / line.qty);
  const taxable = Math.round((amount * 100) / (100 + line.gstRate));
  const gst = amount - taxable;
  const cgst = Math.floor(gst / 2);
  return { amountPaise: amount, taxablePaise: taxable, gstPaise: gst, cgstPaise: cgst, sgstPaise: gst - cgst };
}

/** Sums of lines (or returned parts): { amountPaise, taxablePaise, gstPaise, cgstPaise, sgstPaise }. */
export function sum(rows) {
  const out = { amountPaise: 0, taxablePaise: 0, gstPaise: 0, cgstPaise: 0, sgstPaise: 0 };
  for (const r of rows) for (const k of Object.keys(out)) out[k] += r[k] ?? 0;
  return out;
}

/** GST by rate: [{ rate, taxablePaise, cgstPaise, sgstPaise, amountPaise }] for the invoice's tax table. */
export function byRate(lines) {
  const map = new Map();
  for (const l of lines) {
    const r = map.get(l.gstRate) ?? { rate: l.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, amountPaise: 0 };
    r.taxablePaise += l.taxablePaise;
    r.cgstPaise += l.cgstPaise;
    r.sgstPaise += l.sgstPaise;
    r.amountPaise += l.amountPaise;
    map.set(l.gstRate, r);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

/**
 * Suggested quantity from a prescription line (visits/rxCodes.js): dose a time × times a day × days, or null when it
 * can't be worked out (SOS, the doctor's own words, "till delivery", no duration).
 */
const DAYS = { days: 1, weeks: 7, months: 30 };
const COUNTED = ['tab', 'cap', 'sachet', 'pessary', 'suppository']; // sold by the piece (syrups, creams: by the pack)
export function suggestedQty(rx) {
  if (!COUNTED.includes(rx.form)) return null;
  const dose = Number.parseFloat(String(rx.dose ?? '').replace('½', '0.5'));
  const each = Number.isFinite(dose) && dose > 0 && dose <= 10 ? dose : 1;
  if (rx.frequency === 'stat') return Math.ceil(each);
  let perDay = null;
  if (/^[01](-[01]){2,3}$/.test(rx.frequency ?? '')) perDay = rx.frequency.split('-').reduce((n, x) => n + Number(x), 0);
  else if (rx.frequency === 'weekly') perDay = 1 / 7;
  else if (rx.frequency === 'alternate') perDay = 1 / 2;
  const days = rx.durationValue && DAYS[rx.durationUnit] ? rx.durationValue * DAYS[rx.durationUnit] : null;
  if (!perDay || !days) return null;
  return Math.ceil(each * perDay * days);
}

/**
 * The money of a line on a debit note (stock returned to a supplier). The rate is the purchase price per unit BEFORE
 * GST, as on the purchase; GST is added on top – as IGST when the supplier is in another state, else split equally
 * into CGST and SGST.
 */
export function debitMoney({ qty, ratePaise, gstRate, interState = false }) {
  const taxable = qty * ratePaise;
  const gst = Math.round((taxable * gstRate) / 100);
  const cgst = interState ? 0 : Math.floor(gst / 2);
  return { taxablePaise: taxable, gstPaise: gst, cgstPaise: cgst, sgstPaise: interState ? 0 : gst - cgst, igstPaise: interState ? gst : 0, amountPaise: taxable + gst };
}
