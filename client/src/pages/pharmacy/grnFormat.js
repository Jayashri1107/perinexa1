// The purchase bill (GRN) as the pharmacy's earlier software kept it (owner, 26 Oct 2026): each line as written on the
// supplier's invoice – a pack (ConvF units of sale), its quantity and free quantity, MRP and rate per pack, a discount
// and the GST rate – and the bill's own discounts and charges, worked out to the net amount to pay. PURE; a copy of
// server/src/pharmacy/grn.js (the server works the saved bill out again). Amounts in paise.
//
//   line:   total = rate × qty;  item discount = total × disc %;  taxable = total − item discount;  GST = taxable × GST %
//   bill:   discount amount = (total − item discounts) × disc %
//           less = item discounts + scheme discount + discount amount + credit note adjusted
//           add  = other charges + surcharge + freight
//           net  = total − less + add + GST, rounded to the rupee (rounding = net − exact)
//   GST is CGST + SGST (half each) from a supplier in the same state, IGST from another state.

export const TAX_TYPES = ['cgst_sgst', 'igst'];
export const PAYMENT_MODES = ['credit', 'cash'];

const pct = (amount, percent) => Math.round((amount * (Number(percent) || 0)) / 100);

/** One line's sums (per pack as entered). */
export function grnLine({ qty = 0, ratePaise = 0, discPercent = 0, gstRate = 0 }) {
  const totalPaise = Math.round(ratePaise * qty);
  const discPaise = pct(totalPaise, discPercent);
  const taxablePaise = totalPaise - discPaise;
  return { totalPaise, discPaise, taxablePaise, gstPaise: pct(taxablePaise, gstRate) };
}

/** The whole bill's sums. bill: { taxType, schemeDiscPaise, discPercent, crnAdjPaise, otherChargesPaise, surchargePaise, freightPaise } */
export function grnTotals(lines, bill = {}) {
  const each = lines.map(grnLine);
  const sum = (key) => each.reduce((s, l) => s + l[key], 0);
  const totalPaise = sum('totalPaise');
  const itemDiscPaise = sum('discPaise');
  const gstPaise = sum('gstPaise');
  const discPaise = pct(totalPaise - itemDiscPaise, bill.discPercent);
  const lessPaise = itemDiscPaise + (bill.schemeDiscPaise ?? 0) + discPaise + (bill.crnAdjPaise ?? 0);
  const addPaise = (bill.otherChargesPaise ?? 0) + (bill.surchargePaise ?? 0) + (bill.freightPaise ?? 0);
  const exact = totalPaise - lessPaise + addPaise + gstPaise;
  const netPaise = Math.round(exact / 100) * 100;
  const igst = bill.taxType === 'igst';
  const cgstPaise = igst ? 0 : Math.floor(gstPaise / 2);
  return {
    lines: each,
    totalPaise,
    itemDiscPaise,
    discPaise,
    lessPaise,
    addPaise,
    gstPaise,
    cgstPaise,
    sgstPaise: igst ? 0 : gstPaise - cgstPaise,
    igstPaise: igst ? gstPaise : 0,
    roundingPaise: netPaise - exact,
    netPaise,
  };
}

/**
 * A line as the stock keeps it: per unit of sale. A pack of `conv` units: quantity and free quantity × conv; rate and
 * MRP ÷ conv (the MRP rounded down, so a unit is never sold above the pack's MRP).
 */
export function perUnit(line) {
  const conv = line.conv ?? 1;
  return {
    qty: line.qty * conv,
    freeQty: (line.freeQty ?? 0) * conv,
    ratePaise: Math.round(line.ratePaise / conv),
    mrpPaise: Math.floor(line.mrpPaise / conv),
  };
}

/**
 * The figures the medicine's pop-up shows as it is filled in (website only; laid out like the pharmacy's earlier
 * software): the line's total, discount, GST and net, the units of sale received with the free ones, the sale rate
 * and the landed rate per unit (net ÷ units, the free units bring it down), and the profit on the MRP in %.
 * line: { conv, qty, freeQty, ratePaise, mrpPaise, discPercent, gstRate } as numbers; null where not yet known.
 */
export function grnLineFigures({ conv = 1, qty = 0, freeQty = 0, ratePaise = 0, mrpPaise = 0, discPercent = 0, gstRate = 0 }) {
  const { totalPaise, discPaise, taxablePaise, gstPaise } = grnLine({ qty, ratePaise, discPercent, gstRate });
  const netPaise = taxablePaise + gstPaise;
  const units = (qty + freeQty) * conv;
  const unit = conv >= 1 ? perUnit({ conv, qty, freeQty, ratePaise, mrpPaise }) : null;
  const landedPaise = units > 0 ? Math.round(netPaise / units) : null;
  const saleRatePaise = unit && mrpPaise > 0 ? unit.mrpPaise : null;
  const profitPercent = landedPaise && saleRatePaise != null ? Math.round(((saleRatePaise - landedPaise) / landedPaise) * 1000) / 10 : null;
  return { totalPaise, discPaise, gstPaise, netPaise, units, landedPaise, saleRatePaise, profitPercent };
}
