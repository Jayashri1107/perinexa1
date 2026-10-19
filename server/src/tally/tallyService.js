// The Tally link (docs/TALLY_PLAN.md), step 1 – the file: the settings (account names), what a batch would hold, making
// a batch (its entries kept, its files written again on every download), the entries' status, the marks on bills and
// invoices, and the control sheet. Everything here is for the hospital admin of one hospital.
//
// Rules this file keeps:
//  - every query starts with this hospital's tenantId;
//  - an entry is never deleted and never changed once written, except its status (and the batch that holds it);
//  - a file is the same bytes every time it is downloaded (written from the kept entries, not from the live documents);
//  - no patient's name reaches an entry, a file or the audit log – document numbers only.

import { fillUnsetPrices, stampOf, syncBed } from '../billing/billingService.js';
import { addDays, dateWords, hospitalDayStart, hospitalToday, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Bill } from '../models/Bill.js';
import { nextNumber } from '../models/Counter.js';
import { PharmacyInvoice, Supplier, SupplierReturn } from '../models/Pharmacy.js';
import { TallyBatch } from '../models/TallyBatch.js';
import { TallyVoucher } from '../models/TallyVoucher.js';
import { Tenant } from '../models/Tenant.js';
import { HttpError } from '../utils/httpError.js';
import { deriveEvents, isGstRole, ledgerFor, parentGroupFor, roleWords } from './events.js';
import { BATCH_PREFIX, KIND_LABELS, MAX_BATCH_VOUCHERS, STATUS_LABELS, withDefaults } from './tallyRules.js';
import { allInOneXml, mastersXml, remoteIdFor, sha256, tallyDate, voucherTypeMasters, voucherTypeNameFor, vouchersXml } from './xml.js';

const padded = (prefix, n) => `${prefix}-${String(n).padStart(6, '0')}`;
const conflict = (message, code, extra = {}) => Object.assign(new HttpError(409, message, code), extra);

// ---------- Settings ----------

export async function tallySettings(tenantId) {
  const t = await Tenant.findById(tenantId, { tally: 1 }).lean();
  return withDefaults(t?.tally);
}

const SETTING_SECTIONS = ['companyName', 'booksFrom', 'inpatientIssues', 'ledgers', 'voucherTypes'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Saves the settings; returns the names of the sections that changed (for the audit log – never the values). */
export async function saveTallySettings(req, body) {
  const before = await tallySettings(req.tenantId);
  const after = withDefaults({ ...body, updatedByName: before.updatedByName, updatedAt: before.updatedAt });
  const changed = SETTING_SECTIONS.filter((k) => !same(before[k], after[k]));
  if (!changed.length) return [];
  await Tenant.updateOne(
    { _id: req.tenantId },
    {
      $set: {
        'tally.companyName': after.companyName,
        'tally.booksFrom': after.booksFrom,
        'tally.inpatientIssues': after.inpatientIssues,
        'tally.ledgers': after.ledgers,
        'tally.voucherTypes': after.voucherTypes,
        'tally.updatedByName': req.user?.name ?? '',
        'tally.updatedAt': req.now ?? new Date(),
      },
    },
  );
  return changed;
}

// ---------- What a batch would hold ----------

const lastBatchOf = (tenantId) => TallyBatch.findOne({ tenantId }).sort({ createdAt: -1, _id: -1 }).lean();

/**
 * Everything a batch up to `to` (a day, midnight UTC) would hold: the entries still to send, the entries to send again,
 * what stops the batch (blockers) and what is left out for now (warnings). Blockers that need no data (settings
 * missing, a wrong day) come back without loading anything.
 */
export async function collect(req, to) {
  const settings = await tallySettings(req.tenantId);
  const last = await lastBatchOf(req.tenantId);
  const today = hospitalToday(req.now ?? new Date());
  const blockers = [];
  if (!settings.companyName.trim()) blockers.push('Enter the Tally company’s name (Accounts → Account names).');
  if (!settings.booksFrom) blockers.push('Enter the day the books start in Perinexa (Accounts → Account names).');
  const typeNames = Object.values(settings.voucherTypes).map((n) => String(n ?? '').trim());
  if (typeNames.some((n) => !n)) blockers.push('Give every voucher type a name (Accounts → Account names).');
  else if (new Set(typeNames.map((n) => n.toLowerCase())).size !== typeNames.length) blockers.push('Each voucher type needs a different name (Accounts → Account names).');
  const booksFrom = settings.booksFrom ? utcDay(settings.booksFrom) : null;
  if (!(to < today)) blockers.push('Choose yesterday or an earlier day: a day’s bills can still change until it is over.');
  if (booksFrom && to < booksFrom) blockers.push(`The books start on ${dateWords(booksFrom)}: choose that day or a later one.`);
  if (last && to <= utcDay(last.to)) blockers.push(`Batch ${last.number} already covers up to ${dateWords(last.to)}: choose a later day.`);
  const from = last ? addDays(last.to, 1) : booksFrom;
  const base = { settings, from, to, last, events: [], resend: [], warnings: [], blockers, parties: new Map() };
  if (blockers.length) return base;

  const fromStart = hospitalDayStart(booksFrom);
  const toEnd = hospitalDayStart(addDays(to, 1));
  const tenantId = req.tenantId;
  // Bills dated since the books start, brought up to date as the bill screen does: the bed days of a stay that has
  // ended (a stay still open is not sent yet), and the price of automatic lines priced since
  const bills = await Bill.find({ tenantId, on: { $gte: booksFrom } }).lean();
  const stayIds = bills.filter((b) => b.admissionId).map((b) => b.admissionId);
  const stays = new Map((stayIds.length ? await Admission.find({ tenantId, _id: { $in: stayIds } }).lean() : []).map((s) => [String(s._id), s]));
  for (let i = 0; i < bills.length; i += 1) {
    let b = bills[i];
    if (b.status !== 'open') continue;
    const stay = b.admissionId ? stays.get(String(b.admissionId)) : null;
    if (b.kind === 'ipd' && stay?.status === 'discharged') b = (await syncBed(req, b, stay)) ?? b;
    bills[i] = (await fillUnsetPrices(req, b)) ?? b;
  }
  const earlierBills = await Bill.find({ tenantId, on: { $lt: booksFrom }, 'payments.at': { $gte: hospitalDayStart(from), $lt: toEnd } }, { number: 1 }).lean();
  const invoices = await PharmacyInvoice.find({ tenantId, $or: [{ 'created.at': { $gte: fromStart } }, { 'returns.at': { $gte: fromStart } }, { 'payments.at': { $gte: fromStart } }] }).lean();
  const returns = await SupplierReturn.find({ tenantId, 'created.at': { $gte: fromStart } }).lean();
  const supplierIds = [...new Set(returns.map((r) => String(r.supplierId)))];
  const suppliers = new Map((supplierIds.length ? await Supplier.find({ tenantId, _id: { $in: supplierIds } }, { name: 1, gstin: 1 }).lean() : []).map((s) => [String(s._id), s]));
  for (const r of returns) {
    const s = suppliers.get(String(r.supplierId));
    r.supplierName = s?.name ?? 'Supplier';
    r.supplierGstin = s?.gstin ?? '';
  }
  const existing = await TallyVoucher.find({ tenantId }, { key: 1, kind: 1, status: 1, source: 1, lines: 1 }).lean();
  const resend = await TallyVoucher.find({ tenantId, status: 'exported', batchId: null }).lean();
  const dayOf = (instant) => (instant == null || Number.isNaN(new Date(instant).getTime()) ? null : toHospitalDate(instant));
  const { events, warnings, missing, parties } = deriveEvents({ settings, booksFrom, from, to, bills, stays, earlierBills, invoices, supplierReturns: returns, existing, dayOf });
  for (const role of missing) blockers.push(`No account name for “${roleWords(role)}” (Accounts → Account names).`);
  if (events.length + resend.length > MAX_BATCH_VOUCHERS) blockers.push(`${events.length + resend.length} entries is too many for one file: choose an earlier day (at most ${MAX_BATCH_VOUCHERS}).`);
  return { ...base, blockers, events, resend, warnings, parties };
}

/** The account names and voucher types a batch introduces: those not in any earlier batch, never the GST duty accounts. */
async function newMasters(tenantId, settings, events, resend, parties) {
  const earlier = await TallyBatch.find({ tenantId }, { masters: 1, voucherTypes: 1 }).lean();
  const haveLedgers = new Set(earlier.flatMap((b) => b.masters.map((m) => m.name)));
  const haveTypes = new Set(earlier.flatMap((b) => b.voucherTypes.map((t) => t.name)));
  const ledgers = new Map();
  const gst = new Set();
  for (const ev of [...events, ...resend]) {
    for (const l of ev.lines) {
      if (isGstRole(l.role)) {
        gst.add(l.ledger);
        continue;
      }
      if (haveLedgers.has(l.ledger) || ledgers.has(l.ledger)) continue;
      const party = parties.get(l.role);
      ledgers.set(l.ledger, { name: l.ledger, parent: parentGroupFor(l.role), gstin: party?.gstin ?? '', state: party?.state ?? '' });
    }
  }
  const voucherTypes = voucherTypeMasters(settings).filter((t) => !haveTypes.has(t.name));
  return { ledgers: [...ledgers.values()], voucherTypes, gstLedgers: [...gst].sort() };
}

const countByKind = (events) => Object.fromEntries(Object.keys(KIND_LABELS).map((k) => [k, events.filter((e) => e.kind === k).length]).filter(([, n]) => n));

/** What the admin sees before making a batch. */
export async function preview(req, to) {
  const c = await collect(req, to);
  const all = [...c.events, ...c.resend];
  const masters = c.blockers.length ? { ledgers: [], voucherTypes: [], gstLedgers: [] } : await newMasters(req.tenantId, c.settings, c.events, c.resend, c.parties);
  return {
    from: c.from ? isoDay(c.from) : null,
    to: isoDay(to),
    lastBatch: c.last ? { number: c.last.number, to: isoDay(c.last.to) } : null,
    entries: c.events.length,
    resend: c.resend.length,
    byKind: countByKind(all),
    amountPaise: all.reduce((s, e) => s + e.amountPaise, 0),
    problems: { blockers: c.blockers, warnings: c.warnings },
    newLedgers: masters.ledgers.map((m) => ({ name: m.name, parent: m.parent })),
    newVoucherTypes: masters.voucherTypes.map((t) => t.name),
    gstLedgers: masters.gstLedgers,
  };
}

// ---------- Making a batch ----------

/**
 * An entry sent again carries the account names and voucher type name the settings give NOW (a name corrected after
 * Tally refused it is the point of sending again); a party's own name stays. Returns the lines to store.
 */
const namedParty = (role) => role.startsWith('buyer:') || role.startsWith('supplier:'); // named from the document, not the settings
const refreshedLines = (settings, v) => v.lines.map((l) => (namedParty(l.role) ? l : { ...l, ledger: ledgerFor(settings, l.role) || l.ledger }));

export async function createBatch(req, to) {
  const c = await collect(req, to);
  if (c.blockers.length) throw conflict('The batch cannot be made yet.', 'INCOMPLETE', { problems: { blockers: c.blockers, warnings: c.warnings } });
  if (!c.events.length && !c.resend.length) throw conflict(`Nothing new to send up to ${dateWords(to)}.`, 'NOTHING', { problems: { blockers: [], warnings: c.warnings } });
  const tenantId = req.tenantId;
  const resend = c.resend.map((v) => ({ ...v, lines: refreshedLines(c.settings, v), voucherType: voucherTypeNameFor(c.settings, v.kind) }));
  const masters = await newMasters(tenantId, c.settings, c.events, resend, c.parties);
  const number = padded(BATCH_PREFIX, await nextNumber(tenantId, 'tally-batch'));
  const stamp = stampOf(req);
  const batch = await TallyBatch.create({
    tenantId,
    number,
    company: c.settings.companyName,
    from: c.from,
    to,
    vouchers: c.events.length + c.resend.length,
    amountPaise: [...c.events, ...c.resend].reduce((s, e) => s + e.amountPaise, 0),
    byKind: countByKind([...c.events, ...c.resend]),
    masters: masters.ledgers,
    voucherTypes: masters.voucherTypes,
    created: stamp,
  });
  try {
    if (c.events.length) {
      await TallyVoucher.insertMany(
        c.events.map((e) => ({
          tenantId,
          key: e.key,
          remoteId: remoteIdFor(tenantId, e.key),
          kind: e.kind,
          voucherType: voucherTypeNameFor(c.settings, e.kind),
          source: { model: e.source.model, id: e.source.id, number: e.source.number, channel: e.source.channel },
          date: e.date,
          narration: e.narration,
          lines: e.lines.map((l) => ({ role: l.role, ledger: l.ledger, paise: l.paise, side: l.side })),
          amountPaise: e.amountPaise,
          status: 'exported',
          batchId: batch._id,
          batchNumber: number,
          batchIds: [batch._id],
          created: stamp,
        })),
        { ordered: true },
      );
    }
    let moved = 0;
    for (const v of resend) {
      const r = await TallyVoucher.updateOne({ tenantId, _id: v._id, status: 'exported', batchId: null }, { $set: { batchId: batch._id, batchNumber: number, lines: v.lines, voucherType: v.voucherType }, $push: { batchIds: batch._id } });
      moved += r.matchedCount ?? 0;
    }
    if (moved !== resend.length) throw Object.assign(new Error('resend clash'), { code: 11000 });
  } catch (err) {
    // Two admins made a batch at the same moment (or a write failed): nothing of this batch is kept – its new entries
    // go, its re-sent entries wait again, the batch itself goes (its number is lost, like a cancelled bill's)
    await TallyVoucher.deleteMany({ tenantId, batchId: batch._id, batchIds: [batch._id] });
    await TallyVoucher.updateMany({ tenantId, batchId: batch._id }, { $set: { batchId: null, batchNumber: '' }, $pull: { batchIds: batch._id } });
    await TallyBatch.deleteOne({ tenantId, _id: batch._id });
    if (err?.code === 11000) throw conflict('Someone else made a batch at the same moment. Open the batches list and try again.', 'DUPLICATE');
    throw err;
  }
  const { vouchers } = await filesFor(req, batch);
  await TallyBatch.updateOne({ tenantId, _id: batch._id }, { $set: { sha256: sha256(vouchers) } });
  return TallyBatch.findOne({ tenantId, _id: batch._id }).lean();
}

// ---------- Files, lists and views ----------

const vouchersOfBatch = (tenantId, batch) => TallyVoucher.find({ tenantId, batchIds: batch._id }).sort({ date: 1, key: 1 }).lean();

/**
 * The two files of a batch, written again from the kept entries and the batch's own company name (the same bytes
 * every time – except an entry sent again later, which then carries the corrected account names in every file).
 */
export async function filesFor(req, batch) {
  const settings = await tallySettings(req.tenantId);
  const company = batch.company || settings.companyName;
  const vouchers = await vouchersOfBatch(req.tenantId, batch);
  const entries = vouchers.map((v) => ({ key: v.key, kind: v.kind, date: v.date, narration: v.narration, lines: v.lines, remoteId: v.remoteId, voucherType: v.voucherType, reference: v.key === v.source.number ? '' : v.source.number }));
  const xml = vouchersXml({ company, vouchers: entries });
  const names = { company, voucherTypes: batch.voucherTypes, ledgers: batch.masters, applicableFrom: settings.booksFrom ? tallyDate(settings.booksFrom) : '' };
  const masters = batch.masters.length || batch.voucherTypes.length ? mastersXml(names) : null;
  return { vouchers: xml, masters, all: allInOneXml({ ...names, vouchers: entries }) };
}

/** How many entries of a batch still wait for Tally (the whole batch, not only the entries shown). */
export const waitingIn = (tenantId, batch) => TallyVoucher.countDocuments({ tenantId, batchId: batch._id, status: 'exported' });

export const batchView = (b) => ({
  id: String(b._id),
  number: b.number,
  from: isoDay(b.from),
  to: isoDay(b.to),
  vouchers: b.vouchers,
  amountPaise: b.amountPaise ?? 0,
  byKind: b.byKind instanceof Map ? Object.fromEntries(b.byKind) : (b.byKind ?? {}),
  masters: (b.masters ?? []).map((m) => ({ name: m.name, parent: m.parent })),
  voucherTypes: (b.voucherTypes ?? []).map((t) => t.name),
  hasMastersFile: Boolean((b.masters ?? []).length || (b.voucherTypes ?? []).length),
  downloads: { all: b.downloads?.all ?? 0, vouchers: b.downloads?.vouchers ?? 0, masters: b.downloads?.masters ?? 0 },
  imported: b.imported?.at ? { byName: b.imported.byName ?? '', at: b.imported.at } : null,
  createdByName: b.created?.byName ?? '',
  createdAt: b.created?.at ?? b.createdAt ?? null,
});

export const voucherView = (v) => ({
  id: String(v._id),
  key: v.key,
  kind: v.kind,
  kindLabel: KIND_LABELS[v.kind] ?? v.kind,
  date: isoDay(v.date),
  amountPaise: v.amountPaise,
  status: v.status,
  statusLabel: STATUS_LABELS[v.status] ?? v.status,
  batchNumber: v.batchNumber ?? '',
  batchId: v.batchId ? String(v.batchId) : null,
  note: v.note ?? '',
  source: { model: v.source.model, id: String(v.source.id), number: v.source.number },
  narration: v.narration ?? '',
  lines: (v.lines ?? []).map((l) => ({ ledger: l.ledger, paise: l.paise, side: l.side })),
  handled: v.handled?.at ? { byName: v.handled.byName ?? '', at: v.handled.at } : null,
});

export const listBatches = (tenantId) => TallyBatch.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).limit(200).lean();
export const findBatch = (tenantId, id) => TallyBatch.findOne({ tenantId, _id: id }).lean();
export const batchVouchers = (tenantId, batch, limit = 500) => TallyVoucher.find({ tenantId, batchIds: batch._id }).sort({ date: 1, key: 1 }).limit(limit).lean();

export async function listVouchers(tenantId, { status, limit = 500 }) {
  const filter = { tenantId };
  if (status) filter.status = status;
  return TallyVoucher.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit).lean();
}

export const countsByStatus = async (tenantId) => {
  const rows = await TallyVoucher.aggregate([{ $match: { tenantId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
};

// What an entry's status may become. exported → imported (the accountant confirmed) | failed (Tally refused) |
// skipped; failed or skipped → exported again (into the next file) | imported (booked by hand after all); imported →
// failed (found refused later). Never back to nothing: the entry stays.
const TRANSITIONS = {
  exported: ['imported', 'failed', 'skipped'],
  failed: ['exported', 'skipped', 'imported'],
  skipped: ['exported', 'imported'],
  imported: ['failed'],
};

export async function setVoucherStatus(req, voucher, status, note) {
  if (!TRANSITIONS[voucher.status]?.includes(status)) throw conflict(`An entry that is “${STATUS_LABELS[voucher.status]}” cannot become “${STATUS_LABELS[status]}”.`, 'STATUS');
  const set = { status, note: note ?? '', handled: stampOf(req) };
  if (status === 'exported') Object.assign(set, { batchId: null, batchNumber: '' }); // waits for the next file
  return TallyVoucher.findOneAndUpdate({ tenantId: req.tenantId, _id: voucher._id, status: voucher.status }, { $set: set }, { returnDocument: 'after' }).lean();
}

/** The admin confirms the whole batch was imported: every entry of it still waiting becomes imported. */
export async function markBatchImported(req, batch) {
  const r = await TallyVoucher.updateMany({ tenantId: req.tenantId, batchId: batch._id, status: 'exported' }, { $set: { status: 'imported', handled: stampOf(req) } });
  await TallyBatch.updateOne({ tenantId: req.tenantId, _id: batch._id }, { $set: { imported: stampOf(req) } });
  return r.modifiedCount ?? 0;
}

export const countDownload = (tenantId, batch, part) => TallyBatch.updateOne({ tenantId, _id: batch._id }, { $inc: { [`downloads.${part}`]: 1 } });

/** The entries made for one document (shown on the bill or the invoice as "Sent to Tally"). */
export const marksFor = (tenantId, model, id) => TallyVoucher.find({ tenantId, 'source.model': model, 'source.id': id }).sort({ 'created.at': 1 }).lean();

/** Totals per account for a month (entries waiting for Tally and imported ones; refused and skipped ones counted apart). */
export async function controlSheet(tenantId, month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const vouchers = await TallyVoucher.find({ tenantId, date: { $gte: start, $lt: end } }, { lines: 1, status: 1, amountPaise: 1, kind: 1 }).lean();
  const rows = new Map();
  const statuses = { exported: 0, imported: 0, failed: 0, skipped: 0 };
  for (const v of vouchers) {
    statuses[v.status] = (statuses[v.status] ?? 0) + 1;
    if (v.status === 'failed' || v.status === 'skipped') continue;
    for (const l of v.lines) {
      const r = rows.get(l.ledger) ?? { ledger: l.ledger, debitPaise: 0, creditPaise: 0 };
      if (l.side === 'dr') r.debitPaise += l.paise;
      else r.creditPaise += l.paise;
      rows.set(l.ledger, r);
    }
  }
  return { month, rows: [...rows.values()].sort((a, b) => a.ledger.localeCompare(b.ledger)), entries: vouchers.length, statuses };
}
