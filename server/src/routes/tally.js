import { Router } from 'express';
import { z } from 'zod';
import { GROUPS, PAYMENT_MODES } from '../billing/billingRules.js';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { TallyVoucher } from '../models/TallyVoucher.js';
import { INPATIENT_ISSUES, KIND_LABELS, LEDGER_NAME_MAX, NOTE_MAX, STATUS_LABELS, TALLY_ROLES, VOUCHER_STATUSES } from '../tally/tallyRules.js';
import { batchView, batchVouchers, controlSheet, countDownload, countsByStatus, createBatch, filesFor, findBatch, listBatches, listVouchers, markBatchImported, marksFor, preview, saveTallySettings, setVoucherStatus, tallySettings, voucherView, waitingIn } from '../tally/tallyService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// The Tally link (docs/TALLY_PLAN.md), step 1 – the file. Hospital admin only (owner's decision 7):
//  - /api/tally/settings              the Tally company, the day the books start, the account and voucher type names
//  - /api/tally/preview?to=           what a batch up to that day would hold, and what stops it
//  - /api/tally/batches               the batches; make one; one batch with its entries
//  - /api/tally/batches/:id/file      its entries file (part=vouchers) or its account names file (part=masters)
//  - /api/tally/batches/:id/imported  the admin confirms the whole batch was imported into Tally
//  - /api/tally/vouchers              entries by status (exceptions); change an entry's status
//  - /api/tally/marks                 the entries made for one bill or pharmacy invoice ("Sent to Tally")
//  - /api/tally/control?month=        totals per account for a month, to compare with Tally
// Amounts are paise. The audit log gets batch and document numbers, counts and status words – never an account name.

export const tallyRouter = Router();

tallyRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...TALLY_ROLES)) throw new HttpError(403, 'The Tally link is kept by the hospital admin.', 'FORBIDDEN');
  next();
});

const notFound = () => new HttpError(404, 'Not found.', 'NOT_FOUND');
const name = z.string().trim().max(LEDGER_NAME_MAX, `An account name has at most ${LEDGER_NAME_MAX} characters.`);
const names = (keys, field = name) => z.object(Object.fromEntries(keys.map((k) => [k, field.optional()]))).partial();
const typeName = name.min(1, 'Every voucher type needs a name.');

// ---------- Settings ----------

const settingsSchema = z
  .object({
    companyName: z.string().trim().max(150, 'The company name is too long.'),
    booksFrom: z.union([requiredDateOnly('Books start'), z.null()]),
    inpatientIssues: z.enum(INPATIENT_ISSUES),
    ledgers: z
      .object({
        income: names(GROUPS),
        modes: names(PAYMENT_MODES),
        schemes: z.array(z.object({ scheme: z.string().trim().min(1).max(80), ledger: name })).max(50),
        patients: name,
        counter: name,
        deposits: name,
        discount: name,
        pharmacySales: z.record(z.string().regex(/^\d{1,2}$/), name),
        exemptIssues: name,
        outputCgst: name,
        outputSgst: name,
        inputCgst: name,
        inputSgst: name,
        inputIgst: name,
        purchaseReturns: name,
      })
      .partial(),
    voucherTypes: names(['sales', 'receipt', 'payment', 'creditNote', 'debitNote', 'journal'], typeName),
  })
  .partial();

const settingsAnswer = async (req) => ({ settings: await tallySettings(req.tenantId), canEdit: true, lists: { groups: GROUPS, modes: PAYMENT_MODES, kinds: KIND_LABELS, statuses: STATUS_LABELS } });

tallyRouter.get('/settings', async (req, res) => {
  res.json(await settingsAnswer(req));
});

tallyRouter.put('/settings', async (req, res) => {
  const body = parse(settingsSchema, req.body);
  const current = await tallySettings(req.tenantId);
  // Each section is merged with what is saved, so a request naming one account never resets the others to the defaults
  const L = body.ledgers ?? {};
  const merged = {
    ...current,
    ...body,
    ledgers: { ...current.ledgers, ...L, income: { ...current.ledgers.income, ...(L.income ?? {}) }, modes: { ...current.ledgers.modes, ...(L.modes ?? {}) }, pharmacySales: { ...current.ledgers.pharmacySales, ...(L.pharmacySales ?? {}) } },
    voucherTypes: { ...current.voucherTypes, ...(body.voucherTypes ?? {}) },
  };
  const types = Object.values(merged.voucherTypes).map((n) => String(n ?? '').trim().toLowerCase());
  if (new Set(types).size !== types.length) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { voucherTypes: 'Each voucher type needs a different name.' } });
  const changed = await saveTallySettings(req, merged);
  if (changed.length) await audit(req, 'TALLY_SETTINGS_CHANGED', { details: { fields: changed } }); // the names of the sections – never an account name
  res.json(await settingsAnswer(req));
});

// ---------- Preview and batches ----------

const toDay = (req) => {
  const q = parse(z.object({ to: requiredDateOnly('Up to').optional() }), req.query);
  return q.to ?? addDays(hospitalToday(req.now), -1); // yesterday, unless a day is given
};

tallyRouter.get('/preview', async (req, res) => {
  res.json(await preview(req, toDay(req)));
});

tallyRouter.get('/batches', async (req, res) => {
  const [batches, statuses] = await Promise.all([listBatches(req.tenantId), countsByStatus(req.tenantId)]);
  res.json({ batches: batches.map(batchView), statuses, today: isoDay(hospitalToday(req.now)) });
});

tallyRouter.post('/batches', async (req, res) => {
  const body = parse(z.object({ to: requiredDateOnly('Up to') }).strict(), req.body);
  const batch = await createBatch(req, body.to);
  await audit(req, 'TALLY_BATCH_CREATED', { details: { batchId: String(batch._id), number: batch.number, from: isoDay(batch.from), to: isoDay(batch.to), vouchers: batch.vouchers } });
  res.status(201).json({ batch: batchView(batch) });
});

async function batchOf(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const batch = await findBatch(req.tenantId, id);
  if (!batch) throw notFound();
  return batch;
}

tallyRouter.get('/batches/:id', async (req, res) => {
  const batch = await batchOf(req);
  const [vouchers, waiting] = await Promise.all([batchVouchers(req.tenantId, batch), waitingIn(req.tenantId, batch)]);
  res.json({ batch: batchView(batch), vouchers: vouchers.map(voucherView), shown: vouchers.length, waiting });
});

// all: account names and entries in one file (the one to use); the two separate files stay as a fallback
const FILE_WORDS = { all: 'all-in-one', vouchers: 'entries', masters: 'account-names' };
tallyRouter.get('/batches/:id/file', async (req, res) => {
  const batch = await batchOf(req);
  const { part } = parse(z.object({ part: z.enum(['all', 'vouchers', 'masters']).default('vouchers') }), req.query);
  const files = await filesFor(req, batch);
  const xml = files[part];
  if (!xml) throw new HttpError(404, 'This batch introduces no new account names: there is no account names file.', 'NO_MASTERS');
  await countDownload(req.tenantId, batch, part);
  await audit(req, 'TALLY_FILE_DOWNLOADED', { details: { batchId: String(batch._id), number: batch.number, part } });
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-tally-${batch.number}-${FILE_WORDS[part]}.xml"`);
  res.send(xml);
});

tallyRouter.post('/batches/:id/imported', async (req, res) => {
  const batch = await batchOf(req);
  const count = await markBatchImported(req, batch);
  await audit(req, 'TALLY_VOUCHER_STATUS', { details: { batchId: String(batch._id), number: batch.number, status: 'imported', count } });
  res.json({ batch: batchView(await findBatch(req.tenantId, batch._id)), count });
});

// ---------- Entries: exceptions and status ----------

tallyRouter.get('/vouchers', async (req, res) => {
  const q = parse(z.object({ status: z.enum(VOUCHER_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(2000).default(500) }), req.query);
  const [vouchers, statuses] = await Promise.all([listVouchers(req.tenantId, q), countsByStatus(req.tenantId)]);
  res.json({ vouchers: vouchers.map(voucherView), statuses });
});

tallyRouter.post('/vouchers/:id/status', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(z.object({ status: z.enum(VOUCHER_STATUSES), note: z.string().trim().max(NOTE_MAX, 'The note is too long.').default('') }).strict(), req.body);
  const voucher = await TallyVoucher.findOne({ tenantId: req.tenantId, _id: id }).lean();
  if (!voucher) throw notFound();
  if ((body.status === 'failed' || body.status === 'skipped') && body.note.length < 3) throw Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields: { note: body.status === 'failed' ? 'Write what Tally said.' : 'Write why it is skipped.' } });
  const after = await setVoucherStatus(req, voucher, body.status, body.note);
  if (!after) throw new HttpError(409, 'This entry was changed by someone else just now. Reload and try again.', 'CONFLICT');
  await audit(req, 'TALLY_VOUCHER_STATUS', { details: { voucherId: String(after._id), key: after.key, status: after.status } }); // never the note
  res.json({ voucher: voucherView(after) });
});

// ---------- Marks on bills and invoices ----------

tallyRouter.get('/marks', async (req, res) => {
  const q = parse(z.object({ model: z.enum(['bill', 'invoice']), id: objectId }), req.query);
  const vouchers = await marksFor(req.tenantId, q.model === 'bill' ? 'Bill' : 'PharmacyInvoice', q.id);
  res.json({ marks: vouchers.map((v) => ({ key: v.key, kind: v.kind, kindLabel: KIND_LABELS[v.kind], status: v.status, statusLabel: STATUS_LABELS[v.status], batchNumber: v.batchNumber ?? '', date: isoDay(v.date), amountPaise: v.amountPaise })) });
});

// ---------- The control sheet ----------

tallyRouter.get('/control', async (req, res) => {
  const q = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.') }), req.query);
  res.json(await controlSheet(req.tenantId, q.month));
});
