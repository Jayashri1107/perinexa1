import { FilePen, PackageCheck, PackageOpen, Send, ShieldAlert, TriangleAlert } from 'lucide-react';

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
export const MOVE_LABELS = { purchase: 'Received', purchase_cancelled: 'Purchase cancelled', sale: 'Sold', issue: 'Issued (inpatient)', return: 'Returned', writeoff: 'Written off', count: 'Stock count', supplier_return: 'Returned to supplier', supplier_return_cancelled: 'Return to supplier cancelled' };
export const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card' };
export const FREQUENCY_WORDS = { '1-0-0': 'morning', '0-1-0': 'afternoon', '0-0-1': 'night', '1-0-1': 'twice a day', '1-1-1': 'three times a day', '1-1-1-1': 'four times a day', sos: 'when needed', stat: 'once, now', weekly: 'weekly', alternate: 'alternate days', custom: '' };

/** The schedule mark: controlled medicines (X, narcotic) stand out. */
export const scheduleLook = (schedule) =>
  CONTROLLED.includes(schedule) ? { tone: 'high', icon: ShieldAlert, label: SCHEDULE_LABELS[schedule] } : schedule ? { tone: 'watch', icon: TriangleAlert, label: SCHEDULE_LABELS[schedule] } : null;

/** "Folvite 5 · Folic acid 5 mg" */
export const medicineLabel = (m) => [m.name, [m.generic, m.strength].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

// Buying from suppliers: purchases (their invoices), purchase orders and returns to a supplier share the Purchases tab.
export const BUYING_PATHS = ['/pharmacy/purchases', '/pharmacy/orders', '/pharmacy/supplier-returns'];
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
  { label: 'Invoices', to: '/pharmacy/invoices', end: false },
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
    s.lastSupplier ? `last bought from ${s.lastSupplier.name}` : null,
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
