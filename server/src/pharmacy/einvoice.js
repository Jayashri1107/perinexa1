// The e-invoice file of a pharmacy sale to a business: the invoice written in the Government of India's e-invoice
// format (schema INV-01, version 1.1 – the JSON the Invoice Registration Portal takes). PURE: no database, no network.
//
// Perinexa does NOT connect to the e-invoice portal. The file is downloaded by the hospital admin and uploaded on the
// portal by hand (bulk upload), after the accountant has checked it; the portal then gives the IRN and the signed QR
// code. Sales to patients need no e-invoice: this is only for a walk-in sale to a business that gave its GSTIN.
//
// How a Perinexa invoice is written in it (the accountant should confirm these – see the owner's questions):
//  - medicines are sold at MRP, GST included: the item's assessable value (AssAmt) is the taxable value worked back
//    from what was charged, exactly as on the printed tax invoice; a discount on the sale is already inside it, so
//    Discount is 0 and UnitPrice is the assessable value per unit;
//  - the tax is CGST + SGST as on the printed invoice, and the place of supply (Pos) is the pharmacy's own state: the
//    medicines are handed over at the pharmacy's counter, whichever state the buyer is registered in;
//  - a credit note (medicines taken back) is its own document of type CRN, naming the invoice it is against;
//  - the HSN code of every item has 6 or 8 digits. A business that must make e-invoices (yearly turnover above
//    ₹5 crore) must also use HSN codes of at least 6 digits (Notification 78/2020 – Central Tax), and the e-invoice
//    portal's own advisory says it does not accept 4-digit codes (read on 5 Oct 2026 at einvoice6.gst.gov.in; the
//    accountant should confirm). The printed tax invoice and the medicine list still take 4.

import { GST_STATES, cleanGstin, gstinProblem } from './gstin.js';

export const EINVOICE_VERSION = '1.1';

// Units of sale as the portal's unit codes (UQC). Anything else is counted in numbers (NOS).
const UNIT_CODES = { tablet: 'TBS', tablets: 'TBS', tab: 'TBS', bottle: 'BTL', bottles: 'BTL', tube: 'TUB', tubes: 'TUB', box: 'BOX', boxes: 'BOX', pack: 'PAC', packet: 'PAC', strip: 'PAC', can: 'CAN', gram: 'GMS', grams: 'GMS', ml: 'MLT', set: 'SET', pair: 'PRS', piece: 'PCS', pieces: 'PCS' };
export const unitCode = (unit) => UNIT_CODES[String(unit ?? '').trim().toLowerCase()] ?? 'NOS';

const rupees = (paise) => Math.round(paise) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
/** A date-only value (midnight UTC, as Perinexa keeps dates) → "DD/MM/YYYY". */
export const portalDate = (date) => {
  const iso = new Date(date).toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pinOk = (pin) => /^[1-9]\d{5}$/.test(String(pin ?? ''));
/** Is this HSN code long enough for the e-invoice portal: 6 or 8 digits (4 is enough only for the printed invoice)? */
export const einvoiceHsnOk = (hsn) => /^(\d{6}|\d{8})$/.test(String(hsn ?? ''));
/**
 * The HSN code an invoice line goes into the file with: the one kept on the line when it was sold – or the medicine's
 * present one when none was kept, or when the present one is the same code written out longer (3004 → 300490). So a
 * 4-digit code on an invoice already made can be put right by changing the medicine; a different code never replaces
 * the one on the invoice.
 */
export function einvoiceHsn(kept, present) {
  const [k, p] = [String(kept ?? '').trim(), String(present ?? '').trim()];
  if (!k) return p;
  return p.length > k.length && p.startsWith(k) ? p : k;
}
const docNoOk = (no) => /^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/.test(String(no ?? ''));

/**
 * What stops the file from being made, in plain words ([] when nothing does). seller: the pharmacy's details
 * (settingsOf); buyer: the invoice's business buyer; lines: [{ name, hsn }]; number: the document's number.
 */
export function einvoiceProblems({ seller, buyer, lines, number }) {
  const out = [];
  const sellerGstin = gstinProblem(seller?.gstin);
  if (sellerGstin) out.push(`The pharmacy’s GSTIN is missing or not right (Pharmacy → Settings). ${seller?.gstin ? sellerGstin : ''}`.trim());
  if (text(seller?.name, 100).length < 3) out.push('The pharmacy’s name is missing (Pharmacy → Settings).');
  if (!text(seller?.address, 100)) out.push('The address is missing (Hospital admin → Letterhead).');
  if (text(seller?.place, 50).length < 3) out.push('The pharmacy’s city or town is missing (Pharmacy → Settings).');
  if (!pinOk(seller?.pin)) out.push('The pharmacy’s PIN code is missing (Pharmacy → Settings).');
  if (!buyer?.gstin || gstinProblem(buyer.gstin)) out.push('The buyer’s GSTIN is missing or not right: this invoice cannot have an e-invoice.');
  else {
    if (text(buyer.name, 100).length < 3) out.push('The buyer’s name is missing.');
    if (!text(buyer.address, 100)) out.push('The buyer’s address is missing.');
    if (text(buyer.place, 50).length < 3) out.push('The buyer’s city or town is missing.');
    if (!pinOk(buyer.pin)) out.push('The buyer’s PIN code is missing.');
  }
  const names = (list) => [...new Set(list.map((l) => l.name))].join(', ');
  const noHsn = lines.filter((l) => !String(l.hsn ?? '').trim());
  if (noHsn.length) out.push(`No HSN code for ${names(noHsn)}: add one of 6 or 8 digits under Pharmacy → Medicines.`);
  const shortHsn = lines.filter((l) => String(l.hsn ?? '').trim() && !einvoiceHsnOk(l.hsn));
  if (shortHsn.length) out.push(`The e-invoice portal needs an HSN code of 6 or 8 digits for ${names(shortHsn)}: write the longer code under Pharmacy → Medicines (a code that starts with the same digits is then used for this invoice too).`);
  if (!docNoOk(number)) out.push(`The number ${number} is longer than the portal takes (16 characters).`);
  return out;
}

function party(p, { withPhone = false } = {}) {
  const gstin = cleanGstin(p.gstin);
  const address = text(p.address, 200);
  const rest = address.slice(100).trim();
  const phone = String(p.phone ?? '').replace(/\D/g, '');
  return {
    Gstin: gstin,
    LglNm: text(p.name, 100),
    Addr1: address.slice(0, 100).trim(),
    ...(rest.length >= 3 ? { Addr2: rest } : {}),
    Loc: text(p.place, 50),
    Pin: Number(p.pin),
    Stcd: gstin.slice(0, 2),
    ...(withPhone && /^\d{6,12}$/.test(phone) ? { Ph: phone } : {}),
  };
}

function item(l, i) {
  const desc = text([l.name, l.generic].filter(Boolean).join(' – '), 300);
  const batch = text(l.batch, 20);
  const assessable = rupees(l.taxablePaise);
  return {
    SlNo: String(i + 1),
    PrdDesc: desc.length >= 3 ? desc : `${desc} (medicine)`,
    IsServc: 'N',
    HsnCd: String(l.hsn),
    ...(batch.length >= 3 && batch === String(l.batch).trim() ? { BchDtls: { Nm: batch, ...(l.expiry ? { ExpDt: portalDate(l.expiry) } : {}) } } : {}),
    Qty: l.qty,
    Unit: unitCode(l.unit),
    UnitPrice: round3(assessable / l.qty),
    TotAmt: assessable,
    Discount: 0,
    AssAmt: assessable,
    GstRt: l.gstRate,
    IgstAmt: 0,
    CgstAmt: rupees(l.cgstPaise),
    SgstAmt: rupees(l.sgstPaise),
    TotItemVal: rupees(l.amountPaise),
  };
}

/**
 * One document in the e-invoice format.
 *  seller: the pharmacy { name, gstin, address, place, pin, phone }
 *  buyer:  the business { name, gstin, address, place, pin }
 *  doc:    { type: 'INV' | 'CRN', number, date (date-only), against?: { number, date } – the invoice a credit note is for }
 *  lines:  [{ name, generic, hsn, unit, batch, expiry, qty, gstRate, amountPaise, taxablePaise, cgstPaise, sgstPaise }]
 * Call einvoiceProblems first: this does not check again.
 */
export function einvoiceOf({ seller, buyer, doc, lines }) {
  const sellerDtls = party(seller, { withPhone: true });
  const total = (key) => lines.reduce((s, l) => s + (l[key] ?? 0), 0);
  return {
    Version: EINVOICE_VERSION,
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: doc.type, No: doc.number, Dt: portalDate(doc.date) },
    SellerDtls: sellerDtls,
    // Place of supply: the pharmacy's state (handed over at its counter)
    BuyerDtls: { ...party(buyer), Pos: sellerDtls.Stcd },
    ItemList: lines.map(item),
    ValDtls: {
      AssVal: rupees(total('taxablePaise')),
      CgstVal: rupees(total('cgstPaise')),
      SgstVal: rupees(total('sgstPaise')),
      IgstVal: 0,
      TotInvVal: rupees(total('amountPaise')),
    },
    ...(doc.against ? { RefDtls: { PrecDocDtls: [{ InvNo: doc.against.number, InvDt: portalDate(doc.against.date) }] } } : {}),
  };
}

/** The buyer's state from its GSTIN, as kept on the invoice: { state, stateCode }. */
export function buyerState(gstin) {
  const code = cleanGstin(gstin).slice(0, 2);
  return { state: GST_STATES[code] ?? '', stateCode: code };
}
