import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { StaffMember, WITH_NUMBERS } from '../models/StaffMember.js';
import { Tenant } from '../models/Tenant.js';
import { config } from '../config.js';
import { ALL_LISTS, LIST_FILE_WORDS, listIsFull, listRows, recoveriesOf, snapshotOf } from '../payroll/payrollLists.js';
import { payrollSettings } from '../payroll/payrollService.js';
import { canSeal, unseal } from '../payroll/secretBox.js';
import { MAX_MONTHLY_PAISE, NO_AADHAAR, PAYROLL_SETTINGS_ROLES, looksLikeAadhaar } from '../payroll/payrollRules.js';
import { audit } from '../utils/audit.js';
import { toCsv } from '../utils/csv.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';
import { computeMonth, monthOf, monthState, mustBeOpen, runFor, staffOfMonth } from './payrollRuns.js';

// Payroll, Stages C and D (docs/PAYROLL_BUILD_NOTE.md section 5 C and D): /api/payroll/runs – from the salary sheet
// to the locked month. Mounted by routes/payroll.js after its guard, beside routes/payrollRuns.js: the same two roles
// only, never Perinexa's own staff.
//  - PUT  /:month/people/:staffId   one person's month: TDS for this month, one-off additions and deductions, an
//                                   advance's instalment for this month (each line and change says what for)
//  - POST /:month/lock              the month kept as a snapshot (version 1, 2 …) – refused while a rule or a rate it
//                                   uses is DRAFT, a person has no pay or no professional tax slab, or anything waits
//  - POST /:month/reopen            the hospital admin only, with a written reason; the version stays and is marked
//  - GET  /:month/payslips          what the payslips print from: the locked snapshot (?version=n for an older one),
//                                   or – while the month is open – the sheet as it stands, marked DRAFT
//  - GET  /:month/lists/:list       register, pf, esi, pt as an Excel-ready CSV file – from a locked month only;
//                                   bank (the bank payment list) only where the hospital admin switched it on
// The four numbers go out by their last four characters only – in full only in the bank payment list and, where the
// admin switched that on too, in the PF and ESI lists (Payroll → Settings; both off until the owner says yes). The audit log gets the month, the person, which list
// and the version – never an amount.

export const payrollCloseRouter = Router();
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const MAX_LINES = 10;

// Free text: never 12 digits that look like an Aadhaar number (section 6 of the note)
const words = (label, max) => z.string(`Write ${label}`).trim().max(max, `Too long (at most ${max} characters)`).refine((v) => !looksLikeAadhaar(v), NO_AADHAAR);
const amount = (label, min) => z.number(`${label} must be an amount`).int(`${label} must be in whole paise`).min(min, min ? `${label} must be above 0` : `${label} can’t be below 0`).max(MAX_MONTHLY_PAISE, `${label} is too high`);

// ---------- One person's month ----------
const adjustBody = z.object({
  // Income tax for this month only. null: the figure on the person's pay entry (Perinexa never works the tax out)
  tdsPaise: amount('The TDS', 0).nullable().default(null),
  lines: z
    .array(z.object({ kind: z.enum(['addition', 'deduction'], 'Choose addition or deduction'), label: words('what it is for', 80).refine((v) => v.length >= 2, 'Write what it is for'), amountPaise: amount('The amount', 1) }))
    .max(MAX_LINES, `At most ${MAX_LINES} lines for one person in a month`)
    .default([]),
  // amountPaise null: the advance's usual instalment again
  instalments: z.array(z.object({ advanceId: objectId, amountPaise: amount('The instalment', 0).nullable().default(null), reason: words('the reason', 200).default('') })).max(20).default([]),
});

payrollCloseRouter.put('/:month/people/:staffId', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const staff = await staffOfMonth(req, month);
  const body = parse(adjustBody, req.body);
  const id = String(staff._id);
  const { state, run } = await computeMonth(req, month);
  const row = state.sheet?.rows.find((r) => r.staffId === id);
  if (!row) throw new HttpError(409, 'The salary sheet for this month is not made yet. Answer what is waiting first.', 'NO_SHEET');

  const fields = {};
  const open = new Map(row.month.advances.map((a) => [a.id, a]));
  const seen = new Set();
  body.instalments.forEach((x, i) => {
    const advance = open.get(String(x.advanceId));
    if (!advance || seen.has(String(x.advanceId))) fields[`instalments.${i}.advanceId`] = 'This advance is not being taken back from this person in this month';
    else if (x.amountPaise != null && x.reason.length < 3) fields[`instalments.${i}.reason`] = 'Say why the instalment is changed for this month';
    else if (x.amountPaise != null && x.amountPaise > advance.balancePaise) fields[`instalments.${i}.amountPaise`] = 'This is more than what is left of the advance';
    seen.add(String(x.advanceId));
  });
  if (Object.keys(fields).length) throw invalid(fields);

  // What was typed before stays as it was typed (who and when); only what is new gets this person's name
  const stamp = { byName: req.user.name, at: req.now ?? new Date() };
  const mine = (list) => (list ?? []).filter((x) => String(x.staffId) === id);
  const before = { tds: mine(run?.tds), lines: mine(run?.lines), instalments: mine(run?.instalments) };
  const unused = [...before.lines];
  const take = (line) => {
    const at = unused.findIndex((o) => o.kind === line.kind && o.label === line.label && o.amountPaise === line.amountPaise);
    return at < 0 ? null : unused.splice(at, 1)[0];
  };
  const after = {
    tds: body.tdsPaise == null ? [] : [before.tds[0]?.tdsPaise === body.tdsPaise ? before.tds[0] : { staffId: staff._id, tdsPaise: body.tdsPaise, ...stamp }],
    lines: body.lines.map((l) => take(l) ?? { staffId: staff._id, ...l, ...stamp }),
    instalments: body.instalments
      .filter((x) => x.amountPaise != null)
      .map((x) => before.instalments.find((o) => String(o.advanceId) === String(x.advanceId) && o.amountPaise === x.amountPaise && o.reason === x.reason) ?? { staffId: staff._id, advanceId: x.advanceId, amountPaise: x.amountPaise, reason: x.reason, ...stamp }),
  };
  const shape = {
    tds: (list) => list.map((x) => x.tdsPaise),
    lines: (list) => list.map((x) => [x.kind, x.label, x.amountPaise]),
    instalments: (list) => list.map((x) => [String(x.advanceId), x.amountPaise, x.reason]).sort(),
  };
  const changed = Object.keys(shape).filter((k) => JSON.stringify(shape[k](before[k])) !== JSON.stringify(shape[k](after[k])));
  if (changed.length) {
    // (two writes: MongoDB takes no $pull and $push of the same list in one)
    await runFor(req, month, { $pull: { tds: { staffId: staff._id }, lines: { staffId: staff._id }, instalments: { staffId: staff._id } } });
    const push = Object.fromEntries(Object.entries(after).filter(([, list]) => list.length).map(([k, list]) => [k, { $each: list }]));
    if (Object.keys(push).length) await runFor(req, month, { $push: push });
    await audit(req, 'PAYROLL_MONTH_ADJUSTED', { details: { month, staffId: id, staffNumber: staff.staffNumber, name: staff.name, fields: changed } }); // which – never an amount
  }
  res.json(await monthState(req, month));
});

// ---------- Lock and reopen ----------
/** The staff of a sheet's rows, read with the sealed numbers (only their last four are ever taken from them). */
async function staffWithNumbers(req, rows) {
  const staff = await StaffMember.find({ tenantId: req.tenantId, _id: { $in: rows.map((r) => r.staffId) } }).select(WITH_NUMBERS).lean();
  return new Map(staff.map((s) => [String(s._id), s]));
}
const hospitalName = async (req) => (await Tenant.findById(req.tenantId, { name: 1 }).lean())?.name ?? '';

payrollCloseRouter.post('/:month/lock', async (req, res) => {
  const month = monthOf(req);
  const { state, run, settings, rates } = await computeMonth(req, month);
  if (state.status === 'locked') throw new HttpError(409, 'This month is already locked.', 'LOCKED');
  // A DRAFT rule or rate, a person with no sum, anything unanswered: no lock (section 5 C of the note)
  if (state.lockBlockers.length || !run) throw Object.assign(new HttpError(409, 'This month can’t be locked yet. See what is still waiting under the sheet.', 'NOT_READY'), { details: { lockBlockers: state.lockBlockers } });

  const version = (run.versions?.length ?? 0) + 1;
  const at = req.now ?? new Date();
  const snapshot = snapshotOf({ month, version, rows: state.sheet.rows, staffById: await staffWithNumbers(req, state.sheet.rows), settings, rates, basisDays: state.basisDays, hospitalName: await hospitalName(req), byName: req.user.name, at });
  // One write, and only into the month as it was read: a change made meanwhile (updatedAt) or a lock by someone else
  // leaves nothing written
  const done = await PayrollRun.updateOne(
    { _id: run._id, tenantId: req.tenantId, status: { $ne: 'locked' }, ...(run.updatedAt ? { updatedAt: run.updatedAt } : {}) },
    { $set: { status: 'locked', recovered: recoveriesOf(snapshot.rows), used: snapshot.rows.filter((r) => r.pay && r.payFrom).map((r) => ({ staffId: r.staffId, payFrom: r.payFrom })), updatedByName: req.user.name }, $push: { versions: { version, lockedByName: req.user.name, lockedAt: at, people: snapshot.rows.length, snapshot } } },
  );
  if (!done?.modifiedCount) throw new HttpError(409, 'This month was changed while it was being locked. Check the sheet and lock it again.', 'CONFLICT');
  await audit(req, 'PAYROLL_MONTH_LOCKED', { details: { month, version, people: snapshot.rows.length } });
  res.json(await monthState(req, month));
});

payrollCloseRouter.post('/:month/reopen', async (req, res) => {
  // Decision 9: the hospital admin reopens a month, with a written reason
  if (!hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES)) throw new HttpError(403, 'Only the hospital admin reopens a locked month.', 'FORBIDDEN');
  const month = monthOf(req);
  const { reason } = parse(z.object({ reason: words('why the month is reopened', 300).refine((v) => v.length >= 5, 'Say why the month is reopened') }), req.body);
  const run = await PayrollRun.findOne({ tenantId: req.tenantId, month }).lean();
  if (run?.status !== 'locked' || !run.versions?.length) throw new HttpError(409, 'This month is not locked.', 'CONFLICT');
  const version = run.versions[run.versions.length - 1].version;
  // The snapshot stays (its payslips print as replaced); what the month took back of advances is undone with it
  const done = await PayrollRun.updateOne({ _id: run._id, tenantId: req.tenantId, status: 'locked' }, { $set: { status: 'draft', recovered: [], used: [], updatedByName: req.user.name }, $push: { reopened: { version, reason, byName: req.user.name, at: req.now ?? new Date() } } });
  if (!done?.modifiedCount) throw new HttpError(409, 'This month is not locked.', 'CONFLICT');
  await audit(req, 'PAYROLL_MONTH_REOPENED', { details: { month, version, reason } });
  res.json(await monthState(req, month));
});

// ---------- Payslips and lists ----------
payrollCloseRouter.get('/:month/payslips', async (req, res) => {
  const month = monthOf(req);
  const { version } = parse(z.object({ version: z.coerce.number().int().min(1).max(999).optional() }), req.query);
  const { state, run, settings, rates } = await computeMonth(req, month);
  let slips;
  if (version || state.status === 'locked') {
    const kept = version ? (run?.versions ?? []).find((v) => v.version === version) : run.versions[run.versions.length - 1];
    if (!kept) throw new HttpError(404, 'This version of the month was not found.', 'NOT_FOUND');
    const again = (run.reopened ?? []).find((r) => r.version === kept.version);
    slips = { month, version: kept.version, draft: false, revised: kept.version > 1, replacedOn: again?.at ?? null, lockedByName: kept.lockedByName, lockedAt: kept.lockedAt, hospitalName: kept.snapshot.hospitalName, basisDays: kept.snapshot.basisDays, rows: kept.snapshot.rows.filter((r) => r.pay) };
  } else {
    // An open month: the sheet as it stands, for checking on paper – every page says DRAFT – not for payment
    if (!state.sheet) throw new HttpError(409, 'The salary sheet for this month is not made yet. Answer what is waiting first.', 'NO_SHEET');
    const snapshot = snapshotOf({ month, version: 0, rows: state.sheet.rows, staffById: await staffWithNumbers(req, state.sheet.rows), settings, rates, basisDays: state.basisDays, hospitalName: await hospitalName(req), byName: '', at: null });
    slips = { month, version: null, draft: true, revised: false, replacedOn: null, lockedByName: '', lockedAt: null, hospitalName: snapshot.hospitalName, basisDays: snapshot.basisDays, rows: snapshot.rows.filter((r) => r.pay) };
  }
  await audit(req, 'PAYROLL_PAYSLIPS_PRINTED', { details: { month, people: slips.rows.length, ...(slips.draft ? { draft: true } : { version: slips.version }) } });
  res.set('Cache-Control', 'no-store');
  res.json(slips);
});

payrollCloseRouter.get('/:month/lists/:list', async (req, res) => {
  const month = monthOf(req);
  const { list } = parse(z.object({ list: z.enum(ALL_LISTS, 'This list is not known') }), { list: req.params.list });
  const settings = await payrollSettings(req.tenantId);
  if (list === 'bank' && !settings.bankList) throw new HttpError(403, 'The bank payment list is switched off for this hospital. The hospital admin switches it on in Payroll → Settings.', 'LIST_OFF');
  const run = await PayrollRun.findOne({ tenantId: req.tenantId, month }).lean();
  if (run?.status !== 'locked' || !run.versions?.length) throw new HttpError(409, 'The monthly lists are made from a locked month. Lock the month first.', 'NOT_LOCKED');
  const kept = run.versions[run.versions.length - 1];

  // Numbers in full: only where the hospital admin switched it on, read now from the staff list (never kept in the
  // snapshot) and never written anywhere but into this file
  let full = null;
  if (listIsFull(list, settings)) {
    if (!canSeal(config.PAYROLL_KEY)) throw new HttpError(409, 'The numbers can’t be read: the key that protects them is not set on this server (PAYROLL_KEY – docs/RUNBOOK.md).', 'NUMBER_UNREADABLE');
    const staff = await staffWithNumbers(req, kept.snapshot.rows);
    full = new Map([...staff].map(([id, s]) => [id, { uan: unseal(s.uan, config.PAYROLL_KEY) ?? '', esiNumber: unseal(s.esiNumber, config.PAYROLL_KEY) ?? '', accountNumber: unseal(s.bank?.accountNumber, config.PAYROLL_KEY) ?? '', ifsc: s.bank?.ifsc ?? '', bankName: s.bank?.bankName ?? '' }]));
  }
  const csv = toCsv(listRows(list, kept.snapshot, full));
  // Kept on the month: reopening it later says which lists already left Perinexa
  await PayrollRun.updateOne({ _id: run._id, tenantId: req.tenantId }, { $push: { downloads: { version: kept.version, list, byName: req.user.name, at: req.now ?? new Date() } } });
  await audit(req, 'PAYROLL_LIST_DOWNLOADED', { details: { month, list, version: kept.version, ...(full ? { full: true } : {}) } }); // which list and whether with full numbers – never a number
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="perinexa-payroll-${month}-${LIST_FILE_WORDS[list]}${kept.version > 1 ? `-v${kept.version}` : ''}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send(csv);
});
