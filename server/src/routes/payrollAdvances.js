import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { StaffAdvance } from '../models/StaffAdvance.js';
import { StaffMember } from '../models/StaffMember.js';
import { isMonth } from '../payroll/attendanceRead.js';
import { advanceBalance } from '../payroll/payrollDeductions.js';
import { MAX_MONTHLY_PAISE, NO_AADHAAR, looksLikeAadhaar } from '../payroll/payrollRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, objectId, parse, requiredDateOnly } from '../utils/validate.js';

// Payroll, Stage C (docs/PAYROLL_BUILD_NOTE.md section 5 C): /api/payroll/advances – an advance given to a staff
// member and taken back from their salary. Mounted by routes/payroll.js after its guard: the accounts login and the
// hospital admin only, never Perinexa's own staff.
//  - GET  /        every advance: whose, the amount, what the locked months took back, what is left
//  - POST /        a new advance: the date, the amount, the monthly instalment, the first month it is taken back from
//  - PUT  /:id     the instalment, the first month and the note; or stopped (and started again) with a reason
// The amount and the date are never changed: an advance entered wrongly is stopped and entered again. Nothing is
// deleted, and nothing is written into Daily expenses. What a month takes back is kept by the locked month
// (PayrollRun.recovered), never here. The audit log gets whose advance and which fields – never an amount.

export const payrollAdvancesRouter = Router();
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const words = (label, max) => z.string(`Write ${label}`).trim().max(max, `Too long (at most ${max} characters)`).refine((v) => !looksLikeAadhaar(v), NO_AADHAAR);
const amount = (label, min) => z.number(`${label} must be an amount`).int(`${label} must be in whole paise`).min(min, min ? `${label} must be above 0` : `${label} can’t be below 0`).max(MAX_MONTHLY_PAISE * 12, `${label} is too high`);
const month = (label) => z.string(label).refine(isMonth, label);

async function answer(req) {
  const tenantId = req.tenantId;
  const [advances, staff, lockedMonths] = await Promise.all([
    StaffAdvance.find({ tenantId }).sort({ givenOn: -1, createdAt: -1 }).limit(2000).lean(),
    StaffMember.find({ tenantId }).sort({ name: 1, staffNumber: 1 }).limit(5000).lean(),
    PayrollRun.find({ tenantId, status: 'locked' }, { month: 1, recovered: 1 }).lean(),
  ]);
  const person = new Map(staff.map((s) => [String(s._id), s]));
  const months = new Map(); // advance → [{ month, amountPaise }] of the locked months
  for (const m of [...lockedMonths].sort((a, b) => a.month.localeCompare(b.month))) for (const r of m.recovered ?? []) months.set(String(r.advanceId), [...(months.get(String(r.advanceId)) ?? []), { month: m.month, amountPaise: r.amountPaise }]);
  const rows = advances.map((a) => {
    const taken = months.get(String(a._id)) ?? [];
    const s = person.get(String(a.staffId));
    return {
      id: String(a._id),
      staffId: String(a.staffId),
      staffNumber: s?.staffNumber ?? '',
      name: s?.name ?? '',
      givenOn: day(a.givenOn),
      amountPaise: a.amountPaise,
      instalmentPaise: a.instalmentPaise,
      recoverFrom: a.recoverFrom,
      note: a.note ?? '',
      months: taken,
      balancePaise: advanceBalance({ amountPaise: a.amountPaise, recovered: taken }),
      stopped: a.stopped ? { byName: a.stopped.byName, at: a.stopped.at, reason: a.stopped.reason } : null,
      createdByName: a.createdByName ?? '',
    };
  });
  return {
    advances: rows,
    // still being taken back: not stopped, and something is left
    openPaise: rows.filter((r) => !r.stopped).reduce((sum, r) => sum + r.balancePaise, 0),
    staffChoices: staff.filter((s) => s.isActive !== false).map((s) => ({ id: String(s._id), staffNumber: s.staffNumber, name: s.name })),
    currentMonth: hospitalToday(req.now ?? new Date()).toISOString().slice(0, 7),
  };
}

payrollAdvancesRouter.get('/', async (req, res) => {
  res.json(await answer(req));
});

const FIELD_WORDS = { instalmentPaise: 'instalment', recoverFrom: 'firstMonth', note: 'note' };

const newBody = z.object({
  staffId: objectId,
  givenOn: requiredDateOnly('Given on'),
  amountPaise: amount('The amount', 1),
  instalmentPaise: amount('The monthly instalment', 0),
  recoverFrom: month('Choose the first month it is taken back from'),
  note: words('the note', 200).default(''),
});

payrollAdvancesRouter.post('/', async (req, res) => {
  const body = parse(newBody, req.body);
  const staff = await StaffMember.findOne({ _id: body.staffId, tenantId: req.tenantId }).lean();
  const fields = {};
  if (!staff || staff.isActive === false) fields.staffId = 'Choose a staff member on the payroll';
  if (day(body.givenOn) > day(hospitalToday(req.now ?? new Date()))) fields.givenOn = 'This date is in the future';
  if (body.instalmentPaise > body.amountPaise) fields.instalmentPaise = 'The instalment can’t be more than the advance';
  if (body.recoverFrom < day(body.givenOn).slice(0, 7)) fields.recoverFrom = 'This month is before the advance was given';
  if (Object.keys(fields).length) throw invalid(fields);
  await StaffAdvance.create({ tenantId: req.tenantId, staffId: staff._id, givenOn: body.givenOn, amountPaise: body.amountPaise, instalmentPaise: body.instalmentPaise, recoverFrom: body.recoverFrom, note: body.note, createdByName: req.user.name, updatedByName: req.user.name });
  await audit(req, 'PAYROLL_ADVANCE_GIVEN', { details: { staffId: String(staff._id), staffNumber: staff.staffNumber, name: staff.name } });
  res.status(201).json(await answer(req));
});

const changeBody = z.object({
  instalmentPaise: amount('The monthly instalment', 0),
  recoverFrom: month('Choose the first month it is taken back from'),
  note: words('the note', 200).default(''),
  stopped: z.boolean().default(false),
  stopReason: words('why it is stopped', 200).default(''),
});

payrollAdvancesRouter.put('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(changeBody, req.body);
  const advance = await StaffAdvance.findOne({ _id: id, tenantId: req.tenantId });
  if (!advance) throw new HttpError(404, 'This advance was not found.', 'NOT_FOUND');
  const fields = {};
  if (body.instalmentPaise > advance.amountPaise) fields.instalmentPaise = 'The instalment can’t be more than the advance';
  if (body.recoverFrom < day(advance.givenOn).slice(0, 7)) fields.recoverFrom = 'This month is before the advance was given';
  if (body.stopped && !advance.stopped && body.stopReason.length < 3) fields.stopReason = 'Say why nothing more is taken back';
  if (Object.keys(fields).length) throw invalid(fields);

  const moved = ['instalmentPaise', 'recoverFrom', 'note'].filter((k) => (advance[k] ?? '') !== body[k]);
  for (const k of moved) advance[k] = body[k];
  const changed = moved.map((k) => FIELD_WORDS[k]); // for the audit log: which – never an amount
  const wasStopped = Boolean(advance.stopped);
  if (body.stopped && !wasStopped) advance.stopped = { byName: req.user.name, at: req.now ?? new Date(), reason: body.stopReason };
  if (!body.stopped && wasStopped) advance.stopped = null;
  if (body.stopped !== wasStopped) changed.push('stopped');
  if (changed.length) {
    advance.updatedByName = req.user.name;
    await advance.save();
    const staff = await StaffMember.findOne({ _id: advance.staffId, tenantId: req.tenantId }).lean();
    await audit(req, 'PAYROLL_ADVANCE_CHANGED', { details: { staffId: String(advance.staffId), staffNumber: staff?.staffNumber ?? '', name: staff?.name ?? '', fields: changed } });
  }
  res.json(await answer(req));
});
