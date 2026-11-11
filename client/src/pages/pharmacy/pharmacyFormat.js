import { FilePen, PackageCheck, PackageOpen, Send, ShieldAlert, TriangleAlert } from 'lucide-react';
import { allergyNames, termMatches } from '../medsafety/medSafety.js';

// Pharmacy (docs/PHARMACY_PLAN.md): words and lists shared by the pharmacy pages. Same role lists as
// server/src/pharmacy/pharmacyRules.js. Amounts come in paise (billing/billingFormat.js formats them).

export const PHARMACY_ROLES = ['pharmacist', 'admin'];
export const DESK_ROLES = ['pharmacist'];

export const SCHEDULE_LABELS = { '': 'None', G: 'Schedule G', H: 'Schedule H', H1: 'Schedule H1', X: 'Schedule X', narcotic: 'Narcotic (NDPS)' };
export const CONTROLLED = ['X', 'narcotic'];
export const FORM_LABELS = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup',
  suspension: 'Suspension',
  drops: 'Drops',
  injection: 'Injection',
  infusion: 'Infusion',
  cream: 'Cream',
  ointment: 'Ointment',
  gel: 'Gel',
  pessary: 'Pessary',
  suppository: 'Suppository',
  inhaler: 'Inhaler',
  sachet: 'Sachet',
  other: 'Other',
};
export const MOVE_LABELS = { opening: 'Opening stock', purchase: 'Received', purchase_cancelled: 'Purchase cancelled', sale: 'Sold', issue: 'Issued (inpatient)', return: 'Returned', writeoff: 'Written off', count: 'Stock count', supplier_return: 'Returned to supplier', supplier_return_cancelled: 'Return to supplier cancelled', transfer_out: 'Moved out', transfer_in: 'Moved in' };
export const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', neft: 'NEFT / RTGS' };
export const FREQUENCY_WORDS = { '1-0-0': 'morning', '0-1-0': 'afternoon', '0-0-1': 'night', '1-0-1': 'twice a day', '1-1-1': 'three times a day', '1-1-1-1': 'four times a day', sos: 'when needed', stat: 'once, now', weekly: 'weekly', alternate: 'alternate days', custom: '' };

/** The schedule mark: controlled medicines (X, narcotic) stand out. */
export const scheduleLook = (schedule) =>
  CONTROLLED.includes(schedule) ? { tone: 'high', icon: ShieldAlert, label: SCHEDULE_LABELS[schedule] } : schedule ? { tone: 'watch', icon: TriangleAlert, label: SCHEDULE_LABELS[schedule] } : null;

/** What was sold on a bill, for the Sold list: "Dolo 650 × 6, Folvite 5 × 10" (the medicines as on the bill). */
export const soldItems = (lines = []) => lines.map((l) => `${l.name} × ${l.qty}`).join(', ');

/** "Folvite 5 · Folic acid 5 mg" */
export const medicineLabel = (m) => [m.name, [m.generic, m.strength].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

// Buying from suppliers: purchases (their invoices), purchase orders and returns to a supplier share the Purchases tab.
export const BUYING_PATHS = ['/pharmacy/purchases', '/pharmacy/orders', '/pharmacy/supplier-returns'];
/**
 * One "Sales bill" page with two tabs (owner's developer, 9 Nov 2026): making a bill, and the list of bills (Sold) –
 * as the store's earlier Sales Bill screen with its Bill List. Issue to ward is the New bill tab's IPD.
 */
export const salesBillSections = () => [
  { label: 'New bill', to: '/pharmacy', end: true, activeFor: '/pharmacy/issue' },
  { label: 'Bill list', to: '/pharmacy/invoices', end: false },
];

export const buyingSections = () => [
  { label: 'Purchase bills', to: '/pharmacy/purchases', end: false },
  { label: 'Orders', to: '/pharmacy/orders', end: false },
  { label: 'Returns to supplier', to: '/pharmacy/supplier-returns', end: false },
];

/** The pharmacy pages' tabs: the desk for pharmacists; stock, medicines, suppliers and reports for both. */
export const pharmacyTabs = (roles = []) => [
  ...(roles.includes('pharmacist')
    ? [
        { label: 'Sell', to: '/pharmacy', end: true },
        { label: 'Issue to ward', to: '/pharmacy/issue', end: true },
      ]
    : []),
  { label: 'Sold', to: '/pharmacy/invoices', end: false },
  { label: 'Stock', to: '/pharmacy/stock', end: false },
  { label: 'Purchases', to: '/pharmacy/purchases', activeFor: BUYING_PATHS },
  { label: 'Medicines', to: '/pharmacy/medicines', end: true },
  { label: 'Suppliers', to: '/pharmacy/suppliers', end: true },
  { label: 'Reports', to: '/pharmacy/reports', end: true },
  { label: 'Settings', to: '/pharmacy/settings', end: true },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-03-31" → "Mar 2027" (how expiry is written on packs). */
export function expiryLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The day something was done ("4 Oct 2026"), from its moment, in this computer's time zone – as formatDateTime shows it. */
export function momentDay(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------- Pharmacy extras (4 Oct 2026): purchase orders, returns to a supplier, barcodes ----------

/** How a purchase order's status looks (colour + icon + word). A part-received order that was closed says so. */
const ORDER_LOOKS = {
  draft: { tone: 'neutral', icon: FilePen, label: 'Draft' },
  sent: { tone: 'due', icon: Send, label: 'Sent' },
  part_received: { tone: 'watch', icon: PackageOpen, label: 'Part received' },
  received: { tone: 'stable', icon: PackageCheck, label: 'Received' },
  cancelled: { tone: 'inactive', label: 'Cancelled' },
};
export function orderLook(order) {
  if (order?.status === 'part_received' && order.closed) return { tone: 'inactive', icon: PackageOpen, label: 'Part received – closed' };
  return ORDER_LOOKS[order?.status] ?? { tone: 'neutral', label: order?.status ?? '' };
}

export const SUPPLIER_RETURN_REASONS = { expired: 'Expired', damaged: 'Damaged', recalled: 'Recalled', excess: 'Excess stock', wrong_item: 'Wrong item' };

/** A barcode as it is kept and looked up: no spaces, capitals (the same as the server). */
export const cleanBarcode = (text) => String(text ?? '').replace(/\s+/g, '').toUpperCase();
/** Is it a barcode Perinexa can hold: 4 to 32 digits or letters (hyphens allowed inside)? */
export const isBarcode = (text) => /^[0-9A-Z][0-9A-Z-]{3,31}$/.test(cleanBarcode(text));

/**
 * The barcodes waiting to be looked up – one after another, in the order they were scanned. A scanner can type the
 * next pack's digits and press Enter while the last lookup is still on its way: that scan waits its turn here. It is
 * never dropped and never joined to the scan after it.
 *   lookup(code) → a promise of the medicine (it fails with an Error when no medicine holds the barcode)
 *   onPick(medicine) → a sentence to show, or { error } when the medicine cannot be used here
 *   onSaid({ ok, text }) – what to show under the box; onBusy(true | false) – while lookups are running
 * A scan that failed stays in what is shown until the run of scans is over, so a later "… added" does not hide it.
 * → { add(code) – a promise that ends when nothing is waiting, waiting() – how many are still to be looked up }
 */
export function scanQueue({ lookup, onPick, onSaid, onBusy = () => {} }) {
  const waiting = [];
  let running = null;
  const run = async () => {
    const failed = [];
    onBusy(true);
    while (waiting.length) {
      const code = waiting.shift();
      try {
        const medicine = await lookup(code);
        const answer = onPick(medicine);
        if (answer?.error) failed.push(answer.error);
        const text = answer?.error ? '' : typeof answer === 'string' ? answer : `${medicineLabel(medicine)} found.`;
        onSaid(failed.length ? { ok: false, text: [...failed, text && `After that: ${text}`].filter(Boolean).join(' ') } : { ok: true, text });
      } catch (err) {
        failed.push(err.message);
        onSaid({ ok: false, text: failed.join(' ') });
      }
    }
    onBusy(false);
    running = null;
  };
  return {
    add(code) {
      waiting.push(code);
      running ??= run();
      return running;
    },
    waiting: () => waiting.length,
  };
}

/**
 * What a scanned medicine does on a list of medicines to sell or issue: it is added – unless it is no longer in use,
 * or already on the list. → { add, said } (said: the sentence under the box, or { error }).
 */
export function scannedForList(medicine, alreadyOnList) {
  if (!medicine.active) return { add: false, said: { error: `${medicine.name} is no longer in use (Medicines → Use again).` } };
  if (alreadyOnList) return { add: false, said: `${medicine.name} is already on the list: change its quantity there.` };
  return { add: true, said: `${medicineLabel(medicine)} added.` };
}

/**
 * The bill's lines with a prescription's medicines on it (`rx` from /pharmacy/patients/:id/prescriptions): each
 * prescribed medicine is matched to the stock list (one in stock first) with its suggested quantity and marked
 * `prescribed` – it cannot be taken off the bill. The medicines of a prescription chosen before are replaced; those
 * the pharmacist added stay (one already on the bill becomes prescribed). A medicine not on the stock list is left out.
 */
export function prescribedLines(lines, rx) {
  const out = lines.filter((l) => !l.prescribed);
  for (const it of rx.items) {
    const best = it.matches.find((m) => m.inStock > 0) ?? it.matches[0];
    if (!best) continue;
    // PH6 (docs/PHARMACY_BUILD_NOTE.md): the line remembers the prescription line it is sold from; what is still to give
    // is the quantity; a line already given in full needs a reason to be sold again
    const rx6 = { rxItemId: it.id, givenInFull: Boolean(it.givenInFull), sold: it.sold ?? [], repeatReason: '' };
    const qty = it.stillToGive > 0 ? it.stillToGive : (it.suggestedQty ?? 1);
    const i = out.findIndex((l) => l.medicine.id === best.id);
    if (i >= 0) out[i] = { ...out[i], prescribed: true, ...rx6 };
    else out.push({ key: `${best.id}-rx-${rx.visitId}`, medicine: best, qty: String(qty), batchId: null, prescribed: true, ...rx6, ...(it.dose ? { dose: it.dose } : {}) });
  }
  return out;
}

/**
 * PH7 (docs/PHARMACY_BUILD_NOTE.md): does a medicine's brand or generic name match her allergy line? Text against text
 * – it will miss, so her allergy line is always shown and this warning is an extra (the doctors' matcher,
 * medsafety/medSafety.js). Returns the allergy group or word matched, or null. No reason is asked (owner, 10 Nov 2026).
 */
export function allergyClash(medicine, allergyText) {
  const { groups, words } = allergyNames(allergyText ?? '');
  const name = `${medicine?.name ?? ''} ${medicine?.generic ?? ''}`.toLowerCase();
  const group = groups.find((g) => g.members.some((m) => termMatches(name, m)) || g.words.some((w) => termMatches(name, w)));
  if (group) return group.name;
  return words.find((w) => termMatches(name, w)) ?? null;
}

/** PH6: "Given: 10 on 2026-11-03 (PH-000412). Still to give: 20." – '' when nothing was sold from the line. */
export function givenLine(it) {
  if (!it?.sold?.length) return '';
  const given = it.sold.map((s) => `${s.qty} on ${s.date} (${s.number})`).join(', ');
  if (it.givenInFull) return `Given: ${given}. Given in full.`;
  return `Given: ${given}.${it.stillToGive != null ? ` Still to give: ${it.stillToGive}.` : ''}`;
}
/** The same for a new purchase, where a medicine may be on the list more than once (one line for each batch). */
export function scannedForPurchase(medicine) {
  if (!medicine.active) return { add: false, said: { error: `${medicine.name} is no longer in use (Medicines → Use again).` } };
  return { add: true, said: `${medicineLabel(medicine)} added: fill in its batch, expiry, quantity and prices.` };
}

/** Is this HSN code long enough for the e-invoice portal: 6 or 8 digits (the same rule as the server)? */
export const einvoiceHsnOk = (hsn) => /^(\d{6}|\d{8})$/.test(String(hsn ?? '').trim());

/**
 * Medicines whose details are all empty: no generic name, strength, HSN code, schedule or reorder level. Until
 * 4 Oct 2026 a fault emptied exactly these when a medicine was stopped or used again, so a prescription medicine or
 * a narcotic may have lost its schedule. They are listed for a person to check – nothing is guessed or changed.
 */
/**
 * PH2 (docs/PHARMACY_BUILD_NOTE.md): a medicine's pack in words – "Strip of 10 tablets", "not split" when a pack is sold
 * whole only.
 */
export const packWords = (m) => {
  if (!(m?.packSize > 1)) return '';
  const name = m.packName || 'pack';
  return `${name[0].toUpperCase()}${name.slice(1)} of ${m.packSize} ${m.unit || 'unit'}s${m.looseSale === false ? ' – not split' : ''}`;
};

/**
 * PH2: what `qty` units of a batch cost at MRP – as the server works it out (server/src/pharmacy/gst.js grossOf): from
 * the pack's MRP when the batch was bought by the pack (a whole pack exactly its MRP, loose units rounded down), else
 * the unit MRP × qty. null when the price is not known yet.
 */
/** PH24: who sees pharmacy sales by doctor in a hospital (server: pharmacyRules.js PHARMACY_DOCTOR_SALES_ROLES). */
export const PHARMACY_DOCTOR_SALES_ROLES = ['pharmacist'];

export function priceOf(b, qty) {
  if (!Number.isFinite(qty)) return null;
  if (b?.packMrpPaise && b?.unitsPerPack > 1) return Math.floor((qty * b.packMrpPaise) / b.unitsPerPack);
  return b?.mrpPaise ? b.mrpPaise * qty : null;
}

/** PH2: a quantity that breaks a pack of a medicine that is not sold loose – the words to show, else null. */
export const looseProblem = (m, qty) =>
  m?.looseSale === false && m?.packSize > 1 && Number.isFinite(qty) && qty % m.packSize !== 0 ? `Sold in whole ${m.packName || 'pack'}s of ${m.packSize} only.` : null;

/** PH2: units in packs and loose units: 143 tablets in strips of 10 → "14 strips and 3 tablets". */
export function inPacks(units, m) {
  const size = m?.packSize ?? 1;
  const unit = m?.unit || 'unit';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!(size > 1) || !Number.isFinite(units)) return plural(units, unit);
  const packs = Math.floor(units / size);
  const loose = units % size;
  const name = m.packName || 'pack';
  if (!packs) return plural(loose, unit);
  return loose ? `${plural(packs, name)} and ${plural(loose, unit)}` : plural(packs, name);
}

export const medicinesToCheck = (medicines) => (medicines ?? []).filter((m) => !m.generic && !m.strength && !m.hsn && !m.schedule && !(m.reorderLevel > 0));

/** "12 tablets", "1 bottle" */
export const unitsLabel = (n, unit) => `${n} ${unit}${Number(n) === 1 ? '' : 's'}`;

/**
 * "Suggest from low stock": the suggestions that become new lines of an order – those with something to order whose
 * medicine is not on the order yet. → { add: [{ medicine, qty }], onList, onOrder } (onList: left out because already
 * on this order; onOrder: left out because enough is already on an order that was sent).
 */
export function linesFromSuggestions(suggestions, lines) {
  const have = new Set(lines.map((l) => l.medicine.id));
  const add = [];
  let onList = 0;
  let onOrder = 0;
  for (const s of suggestions) {
    if (have.has(s.medicine.id)) onList += 1;
    else if (s.suggestedQty < 1) onOrder += 1;
    else add.push({ medicine: s.medicine, qty: s.suggestedQty, note: suggestionNote(s) });
  }
  return { add, onList, onOrder };
}
/** "3 in stock · reorder at 20 · 10 on order (PO-000002) · last bought from Sample Distributors" */
export function suggestionNote(s) {
  return [
    `${s.inStock} in stock`,
    `reorder at ${s.reorderLevel}`,
    s.onOrder ? `${s.onOrder} on order (${s.onOrders.join(', ')})` : null,
    s.perDay ? `uses about ${s.perDay} a day` : null,
    s.lastSupplier ? `${s.lastSupplier.preferred ? 'usually ordered from' : 'last bought from'} ${s.lastSupplier.name}` : null,
    s.lastPrice ? `last paid ₹${(s.lastPrice.ratePaise / 100).toFixed(2)}${s.lastPrice.conv > 1 ? ` a pack of ${s.lastPrice.conv}` : ''} (${s.lastPrice.date})` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
/** What "Suggest from low stock" did, in a sentence. */
export function suggestionSummary({ add, onList, onOrder }, total) {
  if (!total) return 'Nothing is at or below its reorder level.';
  const parts = [`${add.length} medicine${add.length === 1 ? '' : 's'} added`];
  if (onList) parts.push(`${onList} already on this order`);
  if (onOrder) parts.push(`${onOrder} left out: enough is already on an order that was sent`);
  return `${parts.join(' · ')}.`;
}

/** The lines of a new purchase received against an order: what is still to come of each medicine. */
export const receiveLines = (order) => order.lines.filter((l) => l.outstanding > 0 && l.medicine?.active !== false).map((l) => ({ medicine: l.medicine ?? { id: l.medicineId, name: l.name }, qty: l.outstanding }));

/**
 * What to say after a purchase was saved against an order: the order's new status – or, when the order was cancelled
 * or closed at that very moment, that the purchase is in stock but not counted against it. → { text, warning }
 */
export function receivedFlash({ purchase, order }) {
  const saved = `Purchase ${purchase.number} saved and added to stock.`;
  if (order.counted === false) {
    const why = order.notCounted === 'cancelled' ? 'was cancelled' : order.notCounted === 'closed' ? 'was closed' : 'was being changed by someone else';
    return { text: `${saved} Order ${order.number} ${why} at the same moment, so this purchase is not counted against it: it is in the Purchases list without an order.`, warning: true };
  }
  return { text: `${saved} Order ${order.number} is now: ${orderLook(order).label.toLowerCase()}.`, warning: false };
}

/**
 * A new return to a supplier – what was typed beside each batch: [{ b, text, qty }] for every batch with something
 * typed; qty is null when it is not a whole number from 1 to what is left of the batch. These – all of them – are what
 * is sent, whatever the list shows.
 */
export function returnChosen(batches, typed) {
  return batches
    .map((b) => ({ b, text: String(typed[b.id] ?? '').trim() }))
    .filter((x) => x.text !== '')
    .map((x) => ({ ...x, qty: /^\d+$/.test(x.text) && Number(x.text) >= 1 && Number(x.text) <= x.b.qtyLeft ? Number(x.text) : null }));
}
/**
 * The batches a new return lists. "Show only expired batches" leaves out the others – but never a batch with a
 * quantity typed beside it: what will go back is always on the screen.
 */
export const returnBatchesShown = (batches, typed, onlyExpired) => batches.filter((b) => !onlyExpired || b.expired || String(typed[b.id] ?? '').trim() !== '');

/** The sums of a return to a supplier being put together: [{ qty, ratePaise, gstRate }] → taxable, GST, total (paise). */
export function debitSums(rows) {
  let taxable = 0;
  let gst = 0;
  for (const r of rows) {
    const t = r.qty * r.ratePaise;
    taxable += t;
    gst += Math.round((t * r.gstRate) / 100);
  }
  return { taxablePaise: taxable, gstPaise: gst, amountPaise: taxable + gst };
}
