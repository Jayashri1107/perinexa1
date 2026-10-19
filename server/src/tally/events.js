// Accounting entries worked out from Perinexa's documents, for Tally (docs/TALLY_PLAN.md). PURE: no database, no
// network, no dates of its own. Like server/src/pharmacy/einvoice.js derives an e-invoice from an invoice.
//
// How it works. Every document has one or more "channels" (a bill: its charges, and its deposits), and each channel
// has a VECTOR: what the books should hold for it right now, as debit (+) and credit (−) amounts in paise per ROLE
// (an account's job, e.g. "income:lab", "patients", "mode:cash" – the role is turned into the accountant's account
// name only when the entry is written, so renaming an account never makes a new entry). The vector of what was already
// sent is summed from the entries kept (models/TallyVoucher.js) that Tally has or will have (not the refused or skipped
// ones). The difference is the next entry: the first time a Sales (or Receipt, Debit note …), afterwards a Credit note
// or Journal dated the day of the batch – an entry already sent is never changed (owner's decision 6). A change
// stamped after the batch's last day waits for a later batch, so an entry is never dated before it happened.
//
// What never leaves: patient names, phones, item names, medicine names, doctors' names, typed reasons (owner's
// decision 3). Narrations carry document numbers only. Business buyers (GST law needs their name and GSTIN) and
// suppliers are named; insurers and schemes are named.

import { liveLines } from '../billing/money.js';
import { dateWords } from '../careplans/dates.js';
import { GST_ROLES, defaultPharmacySales } from './tallyRules.js';

// ---------- Roles and account names ----------

const ROLE_WORDS = {
  patients: 'Patients',
  counter: 'Pharmacy counter customers',
  deposits: 'Patient deposits',
  discount: 'Discount allowed',
  pexempt: 'Medicines to admitted patients (exempt)',
  ocgst: 'Output CGST',
  osgst: 'Output SGST',
  icgst: 'Input CGST',
  isgst: 'Input SGST',
  iigst: 'Input IGST',
  preturns: 'Purchase returns',
};
const GROUP_WORDS = { consultation: 'Consultation', procedure: 'Procedure', scan: 'Scan', lab: 'Lab test', inpatient: 'Inpatient', medicine: 'Medicine (hospital bill)', other: 'Other' };
const MODE_WORDS = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance or scheme' };

const splitRole = (role) => {
  const i = role.indexOf(':');
  return i < 0 ? [role, ''] : [role.slice(0, i), role.slice(i + 1)];
};
export const isGstRole = (role) => GST_ROLES.includes(splitRole(role)[0]);
/** A party role: the account that owes or is owed (first in an invoice-style entry). */
export const isPartyRole = (role) => ['patients', 'counter', 'buyer', 'supplier', 'insurance'].includes(splitRole(role)[0]);
const isIncome = (role) => ['income', 'psales', 'pexempt'].includes(splitRole(role)[0]);

/**
 * The account name the settings give this role ('' when none is set). Business buyers and suppliers are named from
 * the parties found while deriving (role → { ledger }): a buyer's account is "Name (GSTIN)", so two businesses with
 * the same trade name never share one account; a supplier's account is the supplier's name as the pharmacist typed it
 * (the accountant usually has that account already).
 */
export function ledgerFor(settings, role, parties = new Map()) {
  const L = settings.ledgers;
  const [kind, rest] = splitRole(role);
  switch (kind) {
    case 'income':
      return L.income?.[rest] ?? '';
    case 'mode':
      return L.modes?.[rest] ?? '';
    case 'insurance': {
      const scheme = rest.trim().toLowerCase();
      return (scheme && L.schemes?.find((s) => s.scheme.trim().toLowerCase() === scheme)?.ledger) || L.modes?.insurance || '';
    }
    case 'psales':
      return L.pharmacySales?.[rest] || defaultPharmacySales(rest);
    case 'pexempt':
      return L.exemptIssues ?? '';
    case 'ocgst':
      return L.outputCgst ?? '';
    case 'osgst':
      return L.outputSgst ?? '';
    case 'icgst':
      return L.inputCgst ?? '';
    case 'isgst':
      return L.inputSgst ?? '';
    case 'iigst':
      return L.inputIgst ?? '';
    case 'preturns':
      return L.purchaseReturns ?? '';
    case 'buyer':
    case 'supplier':
      return parties.get(role)?.ledger ?? '';
    default:
      return L[kind] ?? '';
  }
}

/** The role in plain words, for the list of account names still to fill in. */
export function roleWords(role) {
  const [kind, rest] = splitRole(role);
  if (kind === 'income') return `Income: ${GROUP_WORDS[rest] ?? rest}`;
  if (kind === 'mode') return `Money received by ${MODE_WORDS[rest] ?? rest}`;
  if (kind === 'insurance') return rest ? `Insurance or scheme: ${rest}` : 'Insurance or scheme (no scheme named)';
  if (kind === 'psales') return `Pharmacy sales at ${rest}% GST`;
  if (kind === 'buyer') return `Business buyer with GSTIN ${rest}`;
  if (kind === 'supplier') return 'A supplier';
  return ROLE_WORDS[kind] ?? role;
}

/** The Tally group a new account of this role is created under (the GST duty accounts are never created by Perinexa). */
export function parentGroupFor(role) {
  const [kind] = splitRole(role);
  switch (kind) {
    case 'income':
    case 'psales':
    case 'pexempt':
      return 'Sales Accounts';
    case 'discount':
      return 'Indirect Expenses';
    case 'patients':
    case 'counter':
    case 'buyer':
    case 'insurance':
      return 'Sundry Debtors';
    case 'deposits':
      return 'Current Liabilities';
    case 'mode':
      return role === 'mode:cash' ? 'Cash-in-Hand' : 'Bank Accounts';
    case 'preturns':
      return 'Purchase Accounts';
    case 'supplier':
      return 'Sundry Creditors';
    default:
      return GST_ROLES.includes(kind) ? 'Duties & Taxes' : 'Suspense A/c';
  }
}

// ---------- Vectors ----------

const add = (vec, role, paise) => {
  if (!paise) return;
  vec.set(role, (vec.get(role) ?? 0) + paise);
};
const sumVectors = (vectors) => {
  const out = new Map();
  for (const v of vectors) for (const [role, paise] of v) add(out, role, paise);
  return out;
};
/** current − synced, without the zero roles. */
export function vectorDelta(current, synced) {
  const out = new Map();
  for (const role of new Set([...current.keys(), ...synced.keys()])) {
    const d = (current.get(role) ?? 0) - (synced.get(role) ?? 0);
    if (d) out.set(role, d);
  }
  return out;
}
/** The vector of an entry already kept: its lines back into debit (+) and credit (−) amounts per role. */
export const vectorOfLines = (lines) => {
  const vec = new Map();
  for (const l of lines ?? []) add(vec, l.role, l.side === 'dr' ? l.paise : -l.paise);
  return vec;
};
/** Entries Tally has or will have: everything kept except the refused and the skipped (older entries have no status). */
export const inTally = (e) => !e.status || e.status === 'exported' || e.status === 'imported';

const day = (d) => (d == null ? null : new Date(Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth(), new Date(d).getUTCDate())));
const sameOrBefore = (a, b) => a.getTime() <= b.getTime();
const later = (a, b) => (a == null ? b : b == null ? a : a > b ? a : b);

/**
 * A hospital bill's charges as the books should hold them (empty when cancelled): the patient owes the hospital's
 * items less the discount; the income accounts are credited per group. The pharmacy's line ("Pharmacy – invoice
 * PH-…", ref.kind 'pharmacy') is left out – that money reaches Tally through the pharmacy invoice itself, so nothing
 * is counted twice; the whole discount is taken on the hospital's side.
 */
export function billVector(bill) {
  const vec = new Map();
  if (bill.status === 'cancelled') return vec;
  const live = liveLines(bill);
  const subtotal = live.reduce((s, l) => s + l.amountPaise, 0);
  const discount = Math.min(bill.discount?.paise ?? 0, subtotal);
  let items = 0;
  for (const l of live) {
    if (l.ref?.kind === 'pharmacy') continue;
    add(vec, `income:${l.group}`, -l.amountPaise);
    items += l.amountPaise;
  }
  add(vec, 'discount', discount);
  add(vec, 'patients', items - discount);
  return vec;
}

/** Was this refund given back out of the stay's deposits (the stay was still open when it was given)? */
const refundFromDeposits = (bill, stay, p) => bill.kind === 'ipd' && Boolean(stay) && (stay.status === 'admitted' || (stay.dischargedAt && new Date(p.at) < new Date(stay.dischargedAt)));

/**
 * What the receipts put into the deposits account for a bill (deposits less refunds given out of them), read from the
 * receipt entries themselves (kept ones Tally has, and this batch's new ones) – never re-decided later.
 */
export function depositsHeld(entries) {
  let held = 0;
  for (const e of entries) for (const l of e.lines ?? []) if (l.role === 'deposits') held += l.side === 'cr' ? l.paise : -l.paise;
  return held;
}

/**
 * The deposits of a stay set against its bill at discharge (empty while she is still in hospital, or when nothing is
 * held): the deposits account is cleared and the patient's account credited. A cancelled bill changes nothing here:
 * what was deposited and given back stands, and her account nets through the refunds.
 */
export function depositsVector(bill, stay, held) {
  const vec = new Map();
  if (bill.kind !== 'ipd' || !stay || stay.status !== 'discharged' || held <= 0) return vec;
  add(vec, 'deposits', held);
  add(vec, 'patients', -held);
  return vec;
}

/** The role of the account the money of this payment went to or came from. */
export const modeRole = (p) => (p.mode === 'insurance' ? `insurance:${(p.scheme ?? '').trim()}` : `mode:${p.mode}`);

/** One payment, deposit or refund on a hospital bill (never changes once recorded). */
export function paymentVector(bill, stay, p) {
  const vec = new Map();
  const money = modeRole(p);
  if (p.kind === 'payment') {
    add(vec, money, p.amountPaise);
    add(vec, 'patients', -p.amountPaise);
  } else if (p.kind === 'deposit') {
    add(vec, money, p.amountPaise);
    add(vec, 'deposits', -p.amountPaise);
  } else {
    add(vec, refundFromDeposits(bill, stay, p) ? 'deposits' : 'patients', p.amountPaise);
    add(vec, money, -p.amountPaise);
  }
  return vec;
}

/**
 * The kind of entry a payment is: a Receipt (money in) or Payment (money out) when cash or a bank account moves; a
 * Journal when it is an insurer's or scheme's account (a debtor-to-debtor transfer, not cash).
 */
export const paymentKind = (p) => (p.mode === 'insurance' ? 'journal' : p.kind === 'refund' ? 'payment' : 'receipt');

/** The party of a pharmacy invoice: the patient's shared account, the business buyer (by GSTIN), or walk-in customers. */
export const invoiceParty = (inv) => (inv.patientId ? 'patients' : inv.buyer?.gstin ? `buyer:${inv.buyer.gstin}` : 'counter');

/** A pharmacy tax invoice (counter sale or issue to a ward), with its GST by rate – or exempt, if the accountant so decides for issues. */
export function invoiceVector(inv, settings) {
  const vec = new Map();
  const exempt = inv.kind === 'issue' && settings.inpatientIssues === 'exempt';
  let total = 0;
  for (const l of inv.lines ?? []) {
    total += l.amountPaise;
    if (exempt) add(vec, 'pexempt', -l.amountPaise);
    else {
      add(vec, `psales:${l.gstRate}`, -l.taxablePaise);
      add(vec, 'ocgst', -l.cgstPaise);
      add(vec, 'osgst', -l.sgstPaise);
    }
  }
  add(vec, invoiceParty(inv), total);
  return vec;
}

/** A credit note (medicines taken back): the reverse of its part of the invoice. */
export function creditNoteVector(inv, ret, settings) {
  const vec = new Map();
  const exempt = inv.kind === 'issue' && settings.inpatientIssues === 'exempt';
  const byId = new Map((inv.lines ?? []).map((l) => [String(l._id), l]));
  let total = 0;
  for (const rl of ret.lines ?? []) {
    const line = byId.get(String(rl.lineId));
    total += rl.amountPaise;
    if (exempt) add(vec, 'pexempt', rl.amountPaise);
    else {
      add(vec, `psales:${line?.gstRate ?? 0}`, rl.taxablePaise);
      add(vec, 'ocgst', rl.cgstPaise);
      add(vec, 'osgst', rl.sgstPaise);
    }
  }
  add(vec, invoiceParty(inv), -total);
  return vec;
}

/** A payment at the counter (a walk-in or a business buyer), or the money given back on a return: the same party as the invoice. */
export function counterPaymentVector(inv, p) {
  const vec = new Map();
  const party = invoiceParty(inv);
  if (p.kind === 'refund') {
    add(vec, party, p.amountPaise);
    add(vec, `mode:${p.mode}`, -p.amountPaise);
  } else {
    add(vec, `mode:${p.mode}`, p.amountPaise);
    add(vec, party, -p.amountPaise);
  }
  return vec;
}

/** A debit note to a supplier (stock sent back): the supplier owes the amount; purchases and input GST are reversed. */
export function supplierReturnVector(ret, supplierRole) {
  const vec = new Map();
  if (ret.status === 'cancelled') return vec;
  let total = 0;
  for (const l of ret.lines ?? []) {
    total += l.amountPaise;
    add(vec, 'preturns', -l.taxablePaise);
    add(vec, 'icgst', -(l.cgstPaise ?? 0));
    add(vec, 'isgst', -(l.sgstPaise ?? 0));
    add(vec, 'iigst', -(l.igstPaise ?? 0));
  }
  add(vec, supplierRole, total);
  return vec;
}

// ---------- Entries ----------

/**
 * The lines of an entry from a vector: the party first, then debits, then credits; each with the account name the
 * settings (or the parties found) give its role. Roles without a name are listed in `missing` (the batch is then not made).
 */
export function linesFor(settings, vec, parties = new Map()) {
  const roles = [...vec.keys()].sort((a, b) => Number(isPartyRole(b)) - Number(isPartyRole(a)) || Math.sign(vec.get(b)) - Math.sign(vec.get(a)) || a.localeCompare(b));
  const missing = [];
  const lines = roles.map((role) => {
    const ledger = ledgerFor(settings, role, parties);
    if (!ledger) missing.push(role);
    const paise = vec.get(role);
    return { role, ledger, paise: Math.abs(paise), side: paise > 0 ? 'dr' : 'cr' };
  });
  return { lines, missing };
}

/** What kind of entry a change to a bill's charges is: more charged → Sales; less → Credit note; moved between accounts → Journal. */
export function classifyBillDelta(delta) {
  let salesLike = true;
  let creditLike = true;
  for (const [role, paise] of delta) {
    if (isIncome(role) || role === 'discount') {
      if (paise > 0) salesLike = false; // an income account debited (a charge taken off), or a bigger discount
      if (paise < 0) creditLike = false;
    } else if (role === 'patients') {
      if (paise < 0) salesLike = false;
      if (paise > 0) creditLike = false;
    }
  }
  if (salesLike) return 'sales';
  if (creditLike) return 'credit_note';
  return 'journal';
}

const SUFFIX = { sales: 'S', credit_note: 'CN', journal: 'J', debit_note: 'DN', receipt: 'R', payment: 'P' };
/** The key (and Tally voucher number) of the next entry of a channel: the document's number first, then e.g. "/CN1". */
export function nextKey(number, channel, kind, existing) {
  if (channel === 'deposits') return existing.length ? `${number}/DEP${existing.length + 1}` : `${number}/DEP`;
  if (!existing.length) return number;
  const n = existing.filter((e) => e.kind === kind).length + 1; // the first Sales entry is the number itself, so the next is /S2
  return `${number}/${SUFFIX[kind] ?? 'X'}${n}`;
}

const debitsOf = (lines) => lines.filter((l) => l.side === 'dr').reduce((s, l) => s + l.paise, 0);

/**
 * The next entry of a channel, or null when the books already hold what they should (or the change is too new).
 *   existing: the entries already kept for this channel [{ kind, lines, status }] (all of them, for the numbering;
 *   only those Tally has count as sent); firstKind: the kind of the first entry; laterKind: the kind of a later change
 *   ('bill' = Sales / Credit note / Journal by the change, else that kind); date: the day of a first entry (never
 *   before `from`); correctionDate: the day a later change is dated (the batch's last day); lastChange: the day of the
 *   document's latest stamped change – a change after correctionDate waits for a later batch.
 */
export function channelEvent({ settings, parties, source, channel, current, existing, firstKind, laterKind = 'journal', date, from, correctionDate, lastChange, narration }) {
  const synced = sumVectors(existing.filter(inTally).map((e) => vectorOfLines(e.lines)));
  const delta = vectorDelta(current, synced);
  if (!delta.size) return null;
  const first = !existing.length;
  if (!first && lastChange && !sameOrBefore(lastChange, correctionDate)) return null; // changed after the batch's last day
  let kind;
  if (laterKind !== 'bill') kind = first ? firstKind : laterKind;
  // A bill's first entry is its Sales entry when she owes something for it (a discount is a line of it); a bill that
  // leaves her owing nothing or less (a 100 % discount, a discount larger than the hospital's items) is a Credit note or
  // a Journal, as a later change is read from what changed.
  else kind = first && (delta.get('patients') ?? 0) > 0 ? firstKind : classifyBillDelta(delta);
  const { lines, missing } = linesFor(settings, delta, parties);
  return {
    key: nextKey(source.number, channel, kind, existing),
    kind,
    source: { ...source, channel },
    date: first ? later(date, from) : correctionDate,
    lines,
    missing,
    amountPaise: debitsOf(lines),
    narration: first ? narration : `${narration} - change after it was sent`,
  };
}

// ---------- All the entries of a period ----------

const withinBooks = (d, booksFrom, to) => d && sameOrBefore(booksFrom, d) && sameOrBefore(d, to);
/** The day of a bill's latest stamped change (items added or taken off, the discount, cancelling, money) and of the stay's discharge. */
function billLastChange(bill, stay, dayOf) {
  let last = null;
  for (const l of bill.lines ?? []) last = later(later(last, dayOf(l.added?.at)), dayOf(l.removed?.at));
  for (const p of bill.payments ?? []) last = later(last, dayOf(p.at));
  last = later(last, dayOf(bill.discount?.at));
  last = later(last, dayOf(bill.cancelled?.at));
  if (stay?.dischargedAt) last = later(last, dayOf(stay.dischargedAt));
  return last;
}

/**
 * Every entry still to send, from what the hospital has recorded.
 *   settings: tally settings with the account names (tallyRules.js withDefaults);
 *   booksFrom: the first day the books hold in Perinexa; from, to: the batch's first and last day (all days, midnight UTC);
 *   bills: every bill dated on or after booksFrom (lean), with stays: Map(admissionId → admission);
 *   earlierBills: bills dated before booksFrom that took money in the period (for the warning only);
 *   invoices: pharmacy invoices (lean); supplierReturns: with supplierId, supplierName and supplierGstin set; existing:
 *   the entries kept so far (lean TallyVoucher: key, kind, status, source, lines); dayOf: instant → hospital day (or null).
 * Returns { events, warnings, missing (roles without an account name), parties (role → { ledger, name, gstin, state }) }.
 */
export function deriveEvents({ settings, booksFrom, from = booksFrom, to, bills, stays, earlierBills = [], invoices, supplierReturns, existing, dayOf }) {
  const events = [];
  const warnings = [];
  const missing = new Set();
  const parties = new Map();
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const byChannel = new Map();
  for (const e of existing) {
    const k = `${e.source?.model}:${e.source?.id}:${e.source?.channel}`;
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k).push(e);
  }
  const channelOf = (model, id, channel) => byChannel.get(`${model}:${id}:${channel}`) ?? [];
  const push = (ev) => {
    if (!ev) return;
    ev.missing.forEach((r) => missing.add(r));
    events.push(ev);
  };
  const noteBuyer = (inv) => {
    const role = invoiceParty(inv);
    if (role.startsWith('buyer:')) parties.set(role, { ledger: `${inv.buyer.name} (${inv.buyer.gstin})`, name: inv.buyer.name, gstin: inv.buyer.gstin, state: inv.buyer.state ?? '' });
    return role;
  };
  const common = { settings, parties, from, correctionDate: to };

  // Hospital bills
  const futureBills = [];
  const unpriced = [];
  const stillIn = [];
  for (const b of bills) {
    const stay = b.admissionId ? stays.get(String(b.admissionId)) : null;
    const billDay = day(b.on);
    const source = { model: 'Bill', id: String(b._id), number: b.number };
    // Receipts: each payment, deposit or refund of the period (they never change once recorded)
    const receipts = [];
    for (const p of b.payments ?? []) {
      const d = dayOf(p.at);
      if (!withinBooks(d, booksFrom, to) || byKey.has(p.receipt)) continue;
      const { lines, missing: miss } = linesFor(settings, paymentVector(b, stay, p), parties);
      const ev = { key: p.receipt, kind: paymentKind(p), source: { ...source, channel: `payment:${p.receipt}` }, date: later(d, from), lines, missing: miss, amountPaise: p.amountPaise, narration: `Perinexa ${p.kind === 'refund' ? 'refund' : p.kind} ${p.receipt} on bill ${b.number}` };
      receipts.push(ev);
      push(ev);
    }
    if (!sameOrBefore(billDay, to)) {
      futureBills.push(b.number);
      continue;
    }
    // The charges: an outpatient bill once its day has passed, a stay once she is discharged
    const settled = b.kind === 'opd' ? billDay : stay?.status === 'discharged' ? dayOf(stay.dischargedAt) : null;
    const existingMain = channelOf('Bill', String(b._id), 'main');
    if (!settled || !sameOrBefore(settled, to)) {
      if (b.kind === 'ipd' && b.status !== 'cancelled' && !existingMain.length) stillIn.push(b.number);
      continue;
    }
    if (b.status !== 'cancelled' && liveLines(b).some((l) => l.ref?.kind !== 'pharmacy' && l.ratePaise === 0)) {
      unpriced.push(b.number);
      continue;
    }
    const lastChange = billLastChange(b, stay, dayOf);
    push(channelEvent({ ...common, source, channel: 'main', current: billVector(b), existing: existingMain, firstKind: 'sales', laterKind: 'bill', date: settled, lastChange, narration: `Perinexa bill ${b.number}` }));
    // The deposits set against the bill: exactly what the receipts put into the deposits account
    const paymentEntries = existing.filter((e) => e.source?.model === 'Bill' && String(e.source.id) === String(b._id) && String(e.source.channel).startsWith('payment:') && inTally(e));
    const held = depositsHeld([...paymentEntries, ...receipts]);
    push(channelEvent({ ...common, source, channel: 'deposits', current: depositsVector(b, stay, held), existing: channelOf('Bill', String(b._id), 'deposits'), firstKind: 'journal', date: settled, lastChange, narration: `Perinexa deposits of stay bill ${b.number} set against the bill` }));
  }
  if (futureBills.length) warnings.push(`${futureBills.length} bill${futureBills.length === 1 ? ' is' : 's are'} dated after ${dateWords(to)} (fees taken for later appointments); the money taken goes now, the bill with a later batch.`);
  if (unpriced.length) warnings.push(`${unpriced.length} bill${unpriced.length === 1 ? ' has' : 's have'} an item marked "Price not set" and ${unpriced.length === 1 ? 'is' : 'are'} left out until the price is set: ${unpriced.slice(0, 10).join(', ')}${unpriced.length > 10 ? ' …' : ''}.`);
  if (stillIn.length) warnings.push(`${stillIn.length} stay bill${stillIn.length === 1 ? '' : 's'} (patients still in hospital, or discharged after ${dateWords(to)}) will go at discharge; ${stillIn.length === 1 ? 'its' : 'their'} deposits go now.`);
  if (earlierBills.length) warnings.push(`${earlierBills.length} bill${earlierBills.length === 1 ? ' is' : 's are'} dated before the books start (${dateWords(booksFrom)}) but took money in this period: ${earlierBills.map((b) => b.number).slice(0, 10).join(', ')}${earlierBills.length > 10 ? ' …' : ''}. Nothing of ${earlierBills.length === 1 ? 'it' : 'them'} is sent; the accountant enters ${earlierBills.length === 1 ? 'it' : 'them'} by hand.`);

  // Pharmacy invoices, credit notes and counter payments (none of them ever changes once recorded)
  for (const inv of invoices) {
    const source = { model: 'PharmacyInvoice', id: String(inv._id), number: inv.number };
    noteBuyer(inv);
    const d = dayOf(inv.created?.at);
    if (withinBooks(d, booksFrom, to) && !byKey.has(inv.number)) {
      const { lines, missing: miss } = linesFor(settings, invoiceVector(inv, settings), parties);
      push({ key: inv.number, kind: 'sales', source: { ...source, channel: 'main' }, date: later(d, from), lines, missing: miss, amountPaise: debitsOf(lines), narration: `Perinexa pharmacy invoice ${inv.number}` });
    }
    for (const r of inv.returns ?? []) {
      const rd = dayOf(r.at);
      if (!withinBooks(rd, booksFrom, to) || byKey.has(r.number)) continue;
      const { lines, missing: miss } = linesFor(settings, creditNoteVector(inv, r, settings), parties);
      push({ key: r.number, kind: 'credit_note', source: { ...source, channel: `return:${r.number}` }, date: later(rd, from), lines, missing: miss, amountPaise: debitsOf(lines), narration: `Perinexa credit note ${r.number} against invoice ${inv.number}` });
    }
    if (!inv.patientId) {
      let paid = 0;
      let refunded = 0;
      for (const p of inv.payments ?? []) {
        const n = p.kind === 'refund' ? (refunded += 1) : (paid += 1);
        const key = `${inv.number}/${p.kind === 'refund' ? 'RF' : 'P'}${n}`;
        const pd = dayOf(p.at);
        if (!withinBooks(pd, booksFrom, to) || byKey.has(key)) continue;
        const { lines, missing: miss } = linesFor(settings, counterPaymentVector(inv, p), parties);
        push({ key, kind: p.kind === 'refund' ? 'payment' : 'receipt', source: { ...source, channel: `payment:${key}` }, date: later(pd, from), lines, missing: miss, amountPaise: p.amountPaise, narration: `Perinexa counter ${p.kind === 'refund' ? 'refund' : 'payment'} on invoice ${inv.number}` });
      }
    }
  }

  // Debit notes to suppliers (a cancelled one after it was sent is reversed)
  for (const ret of supplierReturns) {
    const d = dayOf(ret.created?.at);
    if (!withinBooks(d, booksFrom, to)) continue;
    const role = `supplier:${ret.supplierId}`;
    parties.set(role, { ledger: ret.supplierName, name: ret.supplierName, gstin: ret.supplierGstin ?? '', state: '' });
    const source = { model: 'SupplierReturn', id: String(ret._id), number: ret.number };
    push(channelEvent({ ...common, source, channel: 'main', current: supplierReturnVector(ret, role), existing: channelOf('SupplierReturn', String(ret._id), 'main'), firstKind: 'debit_note', laterKind: 'journal', date: d, lastChange: dayOf(ret.cancelled?.at), narration: `Perinexa debit note ${ret.number} to the supplier` }));
  }

  events.sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
  return { events, warnings, missing: [...missing], parties };
}
