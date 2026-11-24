import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { Membership, hasRole } from '../models/Membership.js';
import { StaffMember, WITH_NUMBERS } from '../models/StaffMember.js';
import { User } from '../models/User.js';
import {
  DAY_BASES,
  IFSC_SHAPE,
  MAX_MONTHLY_PAISE,
  MAX_PARTS,
  NO_AADHAAR,
  NUMBER_FIELDS,
  PAYROLL_ROLES,
  PAYROLL_SETTINGS_ROLES,
  ROUNDINGS,
  cleanCodes,
  cleanNumber,
  cleanParts,
  isWorking,
  latestPay,
  looksLikeAadhaar,
  monthlyGross,
  nextStaffNumber,
  numberProblem,
  partKey,
  payOn,
  placeForPay,
  rulesAreDraft,
} from '../payroll/payrollRules.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { DRAFT_RATES, MAX_SLAB_ROWS, PT_SLABS, RATE_GROUPS, nextRateGroup, slabProblem } from '../payroll/payrollDeductions.js';
import { payrollRates, payrollSettings, savePayrollSettings, saveRateGroup } from '../payroll/payrollService.js';
import { canSeal, seal, unseal } from '../payroll/secretBox.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { idParams, objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { hospitalToday } from '../careplans/dates.js';
import { isMonth } from '../payroll/attendanceRead.js';
import { payrollAdvancesRouter } from './payrollAdvances.js';
import { payrollCloseRouter } from './payrollClose.js';
import { monthState, payrollRunsRouter } from './payrollRuns.js';

// Payroll, Stage A (owner's choice of 23 Nov 2026 – docs/PAYROLL_BUILD_NOTE.md): /api/payroll.
//  - For the accounts login and the hospital admin only (decision 3). Perinexa's own staff are refused first, also
//    while the hospital allows support access: a super admin who opens a hospital carries every hospital role
//    (middleware/auth.js platformMembership), so the role check alone would let them in.
//  - GET  /staff               the staff list with each person's monthly pay – never one of the four numbers
//  - GET  /staff/form          what the form needs: the hospital's logins, the salary parts, the next staff number
//  - POST /staff, PUT /staff/:id   add or change a person; a change of pay adds a dated entry
//  - GET  /staff/:id           one person: the four numbers as their last four characters only
//  - POST /staff/:id/number    one number in full, one person at a time – its own entry in the audit log
//  - GET  /settings, PUT /settings   the salary parts and how a day's pay is counted (PUT: the hospital admin)
//  - GET  /overview            what is waiting in the payroll, in counts only – the accounts login's Today
//  - /runs/…                   Stage B: a month's attendance file read into the salary sheet (routes/payrollRuns.js)
//  - GET  /rates, PUT /rates/:group   Stage C: the rate table – PF, ESI, professional tax – each group DRAFT until the
//                               hospital admin writes the accountant's name and the date for it (PUT: the admin)
//  - /advances/…               Stage C: advances given to staff (routes/payrollAdvances.js)
//  - /runs/:month/…            Stages C and D: one person's month, lock, reopen, payslips, lists (routes/payrollClose.js)
// No patient data here. Nothing is deleted (isActive). The audit log gets who and which fields – never an amount or
// one of the numbers.

export const payrollRouter = Router();
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const notFound = () => new HttpError(404, 'This staff member was not found.', 'NOT_FOUND');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const NO_KEY = 'This number can’t be kept yet: the key that protects these numbers is not set on this server (PAYROLL_KEY – docs/RUNBOOK.md). Leave the box empty to save the rest.';

payrollRouter.use((req, _res, next) => {
  if (req.membership?.platform) throw forbidden('Payroll belongs to the hospital: it is not open to Perinexa’s own staff, also during support access.');
  if (!hasRole(req.membership, ...PAYROLL_ROLES)) throw forbidden('Payroll is for the accounts login and the hospital admin.');
  next();
});

// Stage B: the month's run – behind the guard above, like everything here
payrollRouter.use('/runs', payrollRunsRouter);
payrollRouter.use('/runs', payrollCloseRouter);
payrollRouter.use('/advances', payrollAdvancesRouter);

// ---------- What is sent ----------
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const masked = (s) => (s?.last4 ? { kept: true, last4: s.last4 } : { kept: false, last4: '' });
const payView = (e) => ({
  from: day(e.from),
  parts: cleanParts(e.parts),
  monthlyPaise: monthlyGross(e),
  pf: Boolean(e.pf?.applies),
  esi: Boolean(e.esi?.applies),
  pt: Boolean(e.pt?.applies),
  tdsPaise: e.tdsPaise ?? 0,
  byName: e.byName ?? '',
  at: e.at ?? null,
});

/** A row of the list: who, and the monthly pay in force (or entered ahead). Never one of the four numbers. */
function row(s, now) {
  const pay = payOn(s.pay, now) ?? latestPay(s.pay);
  return {
    id: String(s._id),
    staffNumber: s.staffNumber,
    name: s.name,
    designation: s.designation ?? '',
    department: s.department ?? '',
    joinedOn: day(s.joinedOn),
    leftOn: day(s.leftOn),
    isActive: s.isActive !== false,
    working: isWorking(s, now),
    hasLogin: Boolean(s.userId),
    monthlyPaise: pay ? monthlyGross(pay) : null,
    payFrom: pay ? day(pay.from) : null,
  };
}

/** One person's page: the row, the pay entries (newest first) and the four numbers as their last four characters. */
async function full(req, doc) {
  const s = doc.toObject ? doc.toObject() : doc;
  const login = s.userId ? await User.findById(s.userId, { name: 1 }).lean() : null;
  return {
    ...row(s, req.now ?? new Date()),
    userId: s.userId ? String(s.userId) : null,
    loginName: login?.name ?? '',
    attendanceCodes: s.attendanceCodes ?? [],
    ptSlab: s.ptSlab ?? '',
    pay: [...(s.pay ?? [])].sort((a, b) => new Date(b.from) - new Date(a.from)).map(payView),
    numbers: { uan: masked(s.uan), esiNumber: masked(s.esiNumber), pan: masked(s.pan), accountNumber: masked(s.bank?.accountNumber) },
    bank: { ifsc: s.bank?.ifsc ?? '', bankName: s.bank?.bankName ?? '' },
    createdByName: s.createdByName ?? '',
    updatedByName: s.updatedByName ?? '',
    updatedAt: s.updatedAt ?? null,
  };
}

// ---------- What is accepted ----------
// Free text: trimmed, a length, and never 12 digits that look like an Aadhaar number (section 6 of the note)
const text = (label, max) => z.string(`Write the ${label.toLowerCase()}`).trim().max(max, `${label} is too long (at most ${max} characters)`).refine((v) => !looksLikeAadhaar(v), NO_AADHAAR);
const paise = (label) => z.number(`${label} must be an amount`).int(`${label} must be in whole paise`).min(0, `${label} can't be below 0`).max(MAX_MONTHLY_PAISE, `${label} is too high`);
const typedNumber = z.string().max(40, 'Too long').default('');

const payBody = z.object({
  from: requiredDateOnly('Pay from'),
  parts: z.array(z.object({ key: z.string().min(1).max(40), amountPaise: paise('The amount') })).max(MAX_PARTS, 'Too many salary parts'),
  pf: z.boolean().default(false),
  esi: z.boolean().default(false),
  pt: z.boolean().default(false),
  tdsPaise: paise('The TDS').default(0),
});

const staffBody = z.object({
  staffNumber: text('Staff number', 20).refine((v) => v.length > 0, 'Write the staff number'),
  name: text('Name', 120).refine((v) => v.length >= 2, 'Write the name'),
  designation: text('Designation', 80).default(''),
  department: text('Department', 80).default(''),
  // (.nullable(), not a union with null: a union would answer "Invalid input" in place of the sentence for the box)
  joinedOn: requiredDateOnly('Joined on').nullable().default(null),
  leftOn: requiredDateOnly('Last working day').nullable().default(null),
  isActive: z.boolean().default(true),
  userId: objectId.nullable().default(null),
  attendanceCodes: z.array(text('Attendance code', 40)).max(10, 'At most 10 codes').default([]),
  // Stage C: which table of professional tax slabs is this person's ('' = not chosen)
  ptSlab: z.enum(['', ...PT_SLABS], 'Choose the professional tax slab').default(''),
  bank: z
    .object({
      ifsc: z.string().trim().toUpperCase().refine((v) => v === '' || IFSC_SHAPE.test(v), 'An IFSC has 11 characters, like HDFC0001234').default(''),
      bankName: text('Bank name', 80).default(''),
    })
    .default({ ifsc: '', bankName: '' }),
  // A change of pay (left out: the pay stays as it is)
  pay: payBody.nullable().default(null),
  // The four numbers: a typed one is kept in place of the old; an empty box leaves the kept one alone
  numbers: z.object({ uan: typedNumber, esiNumber: typedNumber, pan: typedNumber, accountNumber: typedNumber }).default({ uan: '', esiNumber: '', pan: '', accountNumber: '' }),
  clearNumbers: z.array(z.enum(NUMBER_FIELDS)).max(NUMBER_FIELDS.length).default([]),
});

const DETAILS = ['staffNumber', 'name', 'designation', 'department', 'joinedOn', 'leftOn', 'isActive', 'userId', 'attendanceCodes', 'ptSlab', 'bank'];
const detailsOf = (body) => ({
  staffNumber: body.staffNumber,
  name: body.name,
  designation: body.designation,
  department: body.department,
  joinedOn: body.joinedOn,
  leftOn: body.leftOn,
  isActive: body.isActive,
  userId: body.userId,
  attendanceCodes: cleanCodes(body.attendanceCodes),
  ptSlab: body.ptSlab,
});
const comparable = (k, v) => (k === 'joinedOn' || k === 'leftOn' ? day(v) : k === 'attendanceCodes' ? JSON.stringify(cleanCodes(v)) : k === 'bank' ? JSON.stringify([v?.ifsc ?? '', v?.bankName ?? '']) : String(v ?? ''));
const typedNumbers = (body) => NUMBER_FIELDS.filter((f) => cleanNumber(body.numbers[f]) !== '');
const keptNumber = (s, field) => (field === 'accountNumber' ? s.bank?.accountNumber : s[field]);
const numberPath = (field) => (field === 'accountNumber' ? 'bank.accountNumber' : field);
const entryOf = (pay, req) => ({
  from: pay.from,
  parts: cleanParts(pay.parts),
  pf: { applies: pay.pf },
  esi: { applies: pay.esi },
  pt: { applies: pay.pt },
  tdsPaise: pay.tdsPaise,
  byName: req.user.name,
  at: req.now ?? new Date(),
});
const samePay = (a, b) => JSON.stringify([day(a.from), cleanParts(a.parts), Boolean(a.pf?.applies), Boolean(a.esi?.applies), Boolean(a.pt?.applies), a.tdsPaise ?? 0]) === JSON.stringify([day(b.from), cleanParts(b.parts), Boolean(b.pf?.applies), Boolean(b.esi?.applies), Boolean(b.pt?.applies), b.tdsPaise ?? 0]);

/** What is wrong with a staff record as sent ({ field: sentence }) – checked against the hospital's other staff. */
async function problems(req, body, doc, settings) {
  const fields = {};
  const others = { tenantId: req.tenantId, ...(doc ? { _id: { $ne: doc._id } } : {}) };
  if (body.joinedOn && body.leftOn && body.leftOn < body.joinedOn) fields.leftOn = 'The last working day can’t be before the joining day';
  // Professional tax is looked up in a table of slabs: a pay entry that takes it needs to know which table
  if (body.pay?.pt && !body.ptSlab) fields.ptSlab = 'Choose which professional tax slab is this person’s';
  const sameNumber = await StaffMember.findOne({ ...others, staffNumber: body.staffNumber }, { name: 1 }).lean();
  if (sameNumber) fields.staffNumber = `${sameNumber.name} already has this staff number`;
  if (body.userId) {
    if (!(await Membership.exists({ tenantId: req.tenantId, userId: body.userId, isActive: true }))) fields.userId = 'This login does not work in this hospital';
    else {
      const tied = await StaffMember.findOne({ ...others, userId: body.userId }, { name: 1, staffNumber: 1 }).lean();
      if (tied) fields.userId = `This login is already tied to ${tied.name} (${tied.staffNumber})`;
    }
  }
  const codes = cleanCodes(body.attendanceCodes);
  if (codes.length) {
    const carrier = await StaffMember.findOne({ ...others, attendanceCodes: { $in: codes } }, { name: 1, staffNumber: 1, attendanceCodes: 1 }).lean();
    if (carrier) fields.attendanceCodes = `${carrier.name} (${carrier.staffNumber}) already carries the code ${carrier.attendanceCodes.find((c) => codes.includes(c))}`;
  }
  if (body.pay) {
    const known = new Set(settings.parts.map((p) => p.key));
    const parts = cleanParts(body.pay.parts);
    if (parts.some((p) => !known.has(p.key))) fields['pay.parts'] = 'One of the salary parts is not in the payroll settings';
    else if (new Set(parts.map((p) => p.key)).size !== parts.length) fields['pay.parts'] = 'A salary part is entered twice';
    else if (!parts.length) fields['pay.parts'] = 'Write at least one amount';
    else if (body.pay.tdsPaise > monthlyGross({ parts })) fields['pay.tdsPaise'] = 'The TDS can’t be more than the monthly pay';
    const place = placeForPay(doc?.pay, body.pay.from);
    if (typeof place === 'string') fields['pay.from'] = place;
  }
  // The four numbers: the shape only, and never the number itself in a message
  for (const f of typedNumbers(body)) {
    const problem = numberProblem(f, body.numbers[f]);
    if (problem) fields[`numbers.${f}`] = problem;
    else if (!canSeal(config.PAYROLL_KEY)) fields[`numbers.${f}`] = NO_KEY;
  }
  return fields;
}

/** Seals the typed numbers and removes the ones asked for; returns their names (for the audit log – never a value). */
function setNumbers(doc, body) {
  const changed = [];
  for (const f of typedNumbers(body)) {
    const before = keptNumber(doc, f);
    // the same number typed again changes nothing (each sealing gives a different text, so the readable value is compared)
    if (before?.enc && unseal(before, config.PAYROLL_KEY) === cleanNumber(body.numbers[f])) continue;
    doc.set(numberPath(f), seal(body.numbers[f], config.PAYROLL_KEY));
    changed.push(f);
  }
  for (const f of body.clearNumbers) {
    if (changed.includes(f) || !keptNumber(doc, f)?.enc) continue;
    doc.set(numberPath(f), undefined);
    changed.push(f);
  }
  return changed;
}

async function save(doc) {
  try {
    await doc.save();
  } catch (e) {
    // two people saving at the same moment: the hospital's own index has the last word
    if (e?.code === 11000) throw invalid(e.keyPattern?.userId ? { userId: 'This login is already tied to another staff member' } : { staffNumber: 'Another staff member already has this staff number' });
    throw e;
  }
}

// ---------- The staff list ----------
payrollRouter.get('/staff', async (req, res) => {
  const q = parse(z.object({ show: z.enum(['working', 'left', 'all']).default('working') }), req.query);
  const now = req.now ?? new Date();
  const all = (await StaffMember.find({ tenantId: req.tenantId }).sort({ name: 1, staffNumber: 1 }).limit(5000).lean()).map((s) => row(s, now));
  const working = all.filter((s) => s.working);
  const staff = q.show === 'all' ? all : q.show === 'left' ? all.filter((s) => !s.working) : working;
  await audit(req, 'PAYROLL_STAFF_LIST_VIEWED', { details: { shown: staff.length } });
  res.json({
    staff,
    counts: { working: working.length, left: all.length - working.length },
    monthlyPaise: working.reduce((sum, s) => sum + (s.monthlyPaise ?? 0), 0),
    withoutPay: working.filter((s) => s.monthlyPaise == null).length,
    rulesDraft: rulesAreDraft(await payrollSettings(req.tenantId)),
  });
});

payrollRouter.get('/staff/form', async (req, res) => {
  const [members, staff, settings] = await Promise.all([
    Membership.find({ tenantId: req.tenantId, isActive: true }, { userId: 1, roles: 1 }).lean(),
    StaffMember.find({ tenantId: req.tenantId }, { staffNumber: 1, userId: 1 }).lean(),
    payrollSettings(req.tenantId),
  ]);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) }, isActive: true }, { name: 1, employeeId: 1 }).lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u]));
  const tiedTo = new Map(staff.filter((s) => s.userId).map((s) => [String(s.userId), String(s._id)]));
  res.json({
    // The hospital's logins, for tying a staff member to theirs by hand – never matched by name
    logins: members
      .filter((m) => nameOf.has(String(m.userId)))
      .map((m) => ({ userId: String(m.userId), name: nameOf.get(String(m.userId)).name, employeeId: nameOf.get(String(m.userId)).employeeId ?? '', roles: m.roles, staffId: tiedTo.get(String(m.userId)) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    parts: settings.parts,
    suggestedNumber: nextStaffNumber(staff.map((s) => s.staffNumber)),
    canKeepNumbers: canSeal(config.PAYROLL_KEY),
  });
});

payrollRouter.post('/staff', async (req, res) => {
  const body = parse(staffBody, req.body);
  const fields = await problems(req, body, null, await payrollSettings(req.tenantId));
  if (Object.keys(fields).length) throw invalid(fields);
  const doc = new StaffMember({ tenantId: req.tenantId, ...detailsOf(body), bank: { ifsc: body.bank.ifsc, bankName: body.bank.bankName }, createdByName: req.user.name, updatedByName: req.user.name });
  if (body.pay) doc.pay.push(entryOf(body.pay, req));
  const numbers = setNumbers(doc, body);
  await save(doc);
  await audit(req, 'PAYROLL_STAFF_ADDED', { details: { staffId: String(doc._id), staffNumber: doc.staffNumber, name: doc.name, fields: [...(body.pay ? ['pay'] : []), ...numbers] } });
  res.status(201).json({ staff: await full(req, doc) });
});

payrollRouter.get('/staff/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const doc = await StaffMember.findOne({ _id: id, tenantId: req.tenantId }).select(WITH_NUMBERS).lean();
  if (!doc) throw notFound();
  await audit(req, 'PAYROLL_STAFF_VIEWED', { details: { staffId: id, staffNumber: doc.staffNumber, name: doc.name } });
  res.json({ staff: await full(req, doc) });
});

payrollRouter.put('/staff/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(staffBody, req.body);
  const doc = await StaffMember.findOne({ _id: id, tenantId: req.tenantId }).select(WITH_NUMBERS);
  if (!doc) throw notFound();
  const fields = await problems(req, body, doc, await payrollSettings(req.tenantId));
  if (Object.keys(fields).length) throw invalid(fields);

  const next = { ...detailsOf(body), bank: { ifsc: body.bank.ifsc, bankName: body.bank.bankName } };
  const changed = DETAILS.filter((k) => comparable(k, doc[k]) !== comparable(k, next[k]));
  for (const k of changed) {
    if (k === 'bank') {
      doc.set('bank.ifsc', next.bank.ifsc);
      doc.set('bank.bankName', next.bank.bankName);
    } else doc.set(k, next[k]);
  }
  if (body.pay) {
    // A change of pay adds an entry; the same first day corrects the entry of that day (placeForPay)
    const entry = entryOf(body.pay, req);
    const place = placeForPay(doc.pay, body.pay.from);
    if (place == null) {
      doc.pay.push(entry);
      changed.push('pay');
    } else if (!samePay(doc.pay[place], entry)) {
      // The same first day corrects that entry – but not one a locked month was paid with (section 4 of the note)
      const lockedWith = await PayrollRun.findOne({ tenantId: req.tenantId, status: 'locked', used: { $elemMatch: { staffId: doc._id, payFrom: day(doc.pay[place].from) } } }, { month: 1 }).lean();
      if (lockedWith) {
        const month = new Date(`${lockedWith.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        throw invalid({ 'pay.from': `${month} is locked and was paid with the pay that starts on this day, so that entry can’t be changed. For a change of pay choose a later first day; to correct ${month}, the hospital admin reopens it first.` });
      }
      doc.pay.set(place, entry);
      changed.push('pay');
    }
  }
  changed.push(...setNumbers(doc, body));
  if (changed.length) {
    doc.updatedByName = req.user.name;
    await save(doc);
    await audit(req, 'PAYROLL_STAFF_CHANGED', { details: { staffId: id, staffNumber: doc.staffNumber, name: doc.name, fields: changed } });
  }
  res.json({ staff: await full(req, doc), changed });
});

// One number in full, one person at a time: the answer is never kept by the browser, and the audit log says whose
// number was shown and which – never the number.
payrollRouter.post('/staff/:id/number', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const { field } = parse(z.object({ field: z.enum(NUMBER_FIELDS, 'Choose the number') }), req.body);
  const doc = await StaffMember.findOne({ _id: id, tenantId: req.tenantId }).select(WITH_NUMBERS).lean();
  if (!doc) throw notFound();
  const kept = keptNumber(doc, field);
  if (!kept?.enc) throw new HttpError(404, 'This number is not kept for this person.', 'NOT_FOUND');
  const value = unseal(kept, config.PAYROLL_KEY);
  if (value == null) throw new HttpError(409, 'This number can no longer be read: the key that protects it is not set on this server, or was changed. Type the number again to keep it.', 'NUMBER_UNREADABLE');
  await audit(req, 'PAYROLL_NUMBER_VIEWED', { details: { staffId: id, staffNumber: doc.staffNumber, name: doc.name, field } });
  res.set('Cache-Control', 'no-store');
  res.json({ field, value });
});

// ---------- The accounts login's Today ----------
// What is waiting, in counts only: no name, no amount, no number – so opening Today writes nothing in the audit log.
// month: the month whose attendance is looked at; left out: the month before this one (the one usually worked on).
payrollRouter.get('/overview', async (req, res) => {
  const q = parse(z.object({ month: z.string().refine(isMonth, 'Choose a month').optional() }), req.query);
  const now = req.now ?? new Date();
  const thisMonth = hospitalToday(now).toISOString().slice(0, 7);
  const [y, m] = thisMonth.split('-').map(Number);
  const month = q.month ?? (m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  const [staff, settings, state] = await Promise.all([StaffMember.find({ tenantId: req.tenantId }).limit(5000).lean(), payrollSettings(req.tenantId), month <= thisMonth ? monthState(req, month) : null]);
  const working = staff.filter((s) => isWorking(s, now));
  res.json({
    month,
    staff: {
      working: working.length,
      left: staff.length - working.length,
      withoutPay: working.filter((s) => !latestPay(s.pay)).length,
      withoutCode: working.filter((s) => !(s.attendanceCodes ?? []).length).length,
      // professional tax is taken from their pay, and which table of slabs is theirs is not chosen
      withoutSlab: working.filter((s) => latestPay(s.pay)?.pt?.applies && !s.ptSlab).length,
    },
    rules: { basisChosen: Boolean(settings.dayBasis), draft: rulesAreDraft(settings) },
    canKeepNumbers: canSeal(config.PAYROLL_KEY),
    canChangeSettings: hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES),
    run: state && {
      files: state.files.filter((f) => !f.removed).length,
      expected: state.expected,
      codesToAnswer: state.unknownCodes.filter((c) => !c.leftOut).length,
      peopleToAnswer: state.noRow.filter((p) => !p.answered).length,
      twoRows: state.twoRows.length,
      sheetReady: Boolean(state.sheet),
      withoutSum: state.sheet ? state.sheet.withoutPay : 0,
      // Stages C and D
      locked: state.status === 'locked',
      draftRates: state.draftRates.length,
      lockBlockers: state.lockBlockers.length,
    },
  });
});

// ---------- Settings ----------
const settingsBody = z.object({
  parts: z
    .array(z.object({ key: z.string().max(40).default(''), name: text('Name', 40).refine((v) => v.length >= 2, 'Write the name of the salary part'), countsForPf: z.boolean().default(false), countsForEsi: z.boolean().default(false) }))
    .min(1, 'Keep at least one salary part')
    .max(MAX_PARTS, `At most ${MAX_PARTS} salary parts`),
  dayBasis: z.enum(['', ...DAY_BASES], 'Choose how one day’s pay is counted'),
  weeklyOffsPaid: z.boolean(),
  holidaysPaid: z.boolean(),
  rounding: z.enum(ROUNDINGS, 'Choose the rounding'),
  // The accountant who confirmed these rules, and when – both empty: DRAFT
  confirmedBy: text('Accountant’s name', 120).default(''),
  confirmedOn: z.iso.date('Confirmed on: please enter a valid date').nullable().default(null),
  // Files that carry numbers in full – off unless the admin switches them on (not rules: no confirmation is asked)
  bankList: z.boolean().default(false),
  fullNumbers: z.boolean().default(false),
});

const settingsAnswer = async (req) => {
  const settings = await payrollSettings(req.tenantId);
  return { settings, draft: rulesAreDraft(settings), canChange: hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES), canKeepNumbers: canSeal(config.PAYROLL_KEY), lists: { dayBases: DAY_BASES, roundings: ROUNDINGS, maxParts: MAX_PARTS } };
};

payrollRouter.get('/settings', async (req, res) => {
  res.json(await settingsAnswer(req));
});

payrollRouter.put('/settings', async (req, res) => {
  if (!hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES)) throw forbidden('Only the hospital admin changes the payroll settings.');
  const body = parse(settingsBody, req.body);
  const current = await payrollSettings(req.tenantId);
  const fields = {};

  // A part keeps its key for ever (staff pay names it); a new part gets one made from its name
  const known = new Set(current.parts.map((p) => p.key));
  const keys = body.parts.filter((p) => known.has(p.key)).map((p) => p.key);
  if (new Set(keys).size !== keys.length) fields.parts = 'A salary part is listed twice';
  const names = body.parts.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) fields.parts = 'Each salary part needs a different name';
  const taken = [...known];
  const parts = body.parts.map((p) => {
    if (known.has(p.key)) return { key: p.key, name: p.name, countsForPf: p.countsForPf, countsForEsi: p.countsForEsi };
    const key = partKey(p.name, taken);
    taken.push(key);
    return { key, name: p.name, countsForPf: p.countsForPf, countsForEsi: p.countsForEsi };
  });
  // A part that staff pay names can't be taken away (pay entries are kept as they were entered)
  const removed = current.parts.filter((p) => !parts.some((x) => x.key === p.key));
  if (removed.length && !fields.parts) {
    const used = await StaffMember.findOne({ tenantId: req.tenantId, 'pay.parts.key': { $in: removed.map((p) => p.key) } }, { 'pay.parts.key': 1 }).lean();
    if (used) {
      const part = removed.find((p) => used.pay.some((e) => e.parts.some((x) => x.key === p.key)));
      fields.parts = `“${part.name}” is in a staff member’s pay and can’t be removed. You may rename it.`;
    }
  }
  if (Boolean(body.confirmedBy) !== Boolean(body.confirmedOn)) fields[body.confirmedBy ? 'confirmedOn' : 'confirmedBy'] = 'Write both the accountant’s name and the date, or leave both empty';
  else if (body.confirmedOn && body.confirmedOn > day(req.now ?? new Date())) fields.confirmedOn = 'This date is in the future';
  else if (body.confirmedBy && !body.dayBasis) fields.dayBasis = 'Choose how one day’s pay is counted before writing the accountant’s confirmation';
  if (Object.keys(fields).length) throw invalid(fields);

  const changed = await savePayrollSettings(req, { ...body, parts });
  if (changed.length) await audit(req, 'PAYROLL_SETTINGS_CHANGED', { details: { fields: changed } }); // which settings – never a value
  res.json({ ...(await settingsAnswer(req)), changed });
});

// ---------- Stage C: the rate table (PF, ESI, professional tax) ----------
// LEGAL CONTENT. The figures a hospital starts with are the DRAFT table of the note (payroll/payrollDeductions.js).
// A group is confirmed only when the admin ticks that the accountant confirmed exactly these figures and writes the
// accountant's name, the date, and the date the figures apply from. A month that uses a DRAFT group can't be locked.
const percent = (label) =>
  z
    .number(`${label} must be a number`)
    .min(0, `${label} can’t be below 0`)
    .max(100, `${label} can’t be above 100`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, `${label}: at most two decimals`);
const confirmation = {
  confirmed: z.boolean().default(false),
  confirmedBy: text('Accountant’s name', 120).default(''),
  confirmedOn: z.iso.date('Confirmed on: please enter a valid date').nullable().default(null),
  from: z.iso.date('Applies from: please enter a valid date').nullable().default(null),
};
const slab = z.object({ upToPaise: paise('“Up to”').nullable().default(null), amountPaise: paise('The tax') });
const slabs = z.array(slab).max(MAX_SLAB_ROWS, `At most ${MAX_SLAB_ROWS} rows`);
const rateBodies = {
  pf: z.object({ staffPercent: percent('The staff share'), employerPercent: percent('The hospital’s share'), limitPaise: paise('The pay limit'), capAtLimit: z.boolean().default(true), ...confirmation }),
  esi: z.object({ staffPercent: percent('The staff share'), employerPercent: percent('The hospital’s share'), limitPaise: paise('The pay limit'), ...confirmation }),
  pt: z.object({ slabs: z.object({ men: slabs, women: slabs }), februaryPaise: paise('The February amount'), ...confirmation }),
};
const ratesAnswer = async (req) => ({ rates: await payrollRates(req.tenantId), canChange: hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES), draftFigures: DRAFT_RATES });

payrollRouter.get('/rates', async (req, res) => {
  res.json(await ratesAnswer(req));
});

payrollRouter.put('/rates/:group', async (req, res) => {
  if (!hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES)) throw forbidden('Only the hospital admin changes the rates.');
  const { group } = parse(z.object({ group: z.enum(RATE_GROUPS, 'This group of rates is not known') }), { group: req.params.group });
  const body = parse(rateBodies[group], req.body);
  const fields = {};
  if (group === 'pt') {
    for (const k of PT_SLABS) {
      const problem = slabProblem(body.slabs[k]);
      if (problem) fields[`slabs.${k}`] = problem;
    }
  }
  if (body.confirmed) {
    if (body.confirmedBy.length < 2) fields.confirmedBy = 'Write the name of the accountant who confirmed these figures';
    if (!body.confirmedOn) fields.confirmedOn = 'Write the date the accountant confirmed them';
    else if (body.confirmedOn > day(req.now ?? new Date())) fields.confirmedOn = 'This date is in the future';
    if (!body.from) fields.from = 'Write the date these figures apply from';
  }
  if (Object.keys(fields).length) throw invalid(fields);

  const { confirmed, confirmedBy, confirmedOn, from, ...figures } = body;
  // Not confirmed: the name and the dates are not kept – a DRAFT group never looks half-confirmed
  const next = { ...figures, status: confirmed ? 'confirmed' : 'draft', confirmedBy: confirmed ? confirmedBy : '', confirmedOn: confirmed ? confirmedOn : null, from: confirmed ? from : null };
  const before = (await payrollRates(req.tenantId))[group];
  const changed = Object.keys(next).some((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(next[k] ?? null));
  if (changed) {
    // What was confirmed before stays in force for its months (payrollDeductions.js nextRateGroup)
    await saveRateGroup(req, group, nextRateGroup(before, next));
    await audit(req, 'PAYROLL_RATES_CHANGED', { details: { group, confirmed } }); // which group and whether confirmed – never a figure
  }
  res.json({ ...(await ratesAnswer(req)), changed });
});
