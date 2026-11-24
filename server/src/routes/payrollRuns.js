import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { AttendanceFile } from '../models/AttendanceFile.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { StaffAdvance } from '../models/StaffAdvance.js';
import { StaffMember } from '../models/StaffMember.js';
import { DATE_ORDERS, DAY_KINDS, EMPTY_MARK, MARK_MEANINGS, MAX_MARKS, SHAPES, SUMMARY_COLUMNS, isMonth, layoutProblems, marksIn, monthDays, readAttendance } from '../payroll/attendanceRead.js';
import { FileProblem, MAX_COLUMNS, decodeFile, parseCsv } from '../payroll/csvText.js';
import { RATE_GROUPS, advanceBalance, monthTotals, payOf, rateIsDraft, ratesFor } from '../payroll/payrollDeductions.js';
import { listsFor } from '../payroll/payrollLists.js';
import { basisDays, employedIn, payEntryFor, sheetRow } from '../payroll/payrollMath.js';
import { PAYROLL_SETTINGS_ROLES, rulesAreDraft } from '../payroll/payrollRules.js';
import { MAX_LAYOUTS, attendanceLayouts, payrollRates, payrollSettings, saveAttendanceLayout } from '../payroll/payrollService.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';

// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): /api/payroll/runs – a month's attendance file read into the
// salary sheet. Mounted by routes/payroll.js after its own guard, so the same two roles only and never Perinexa's own
// staff. The steps: the month → the file → its columns → the check → the sheet.
//  - GET  /                      the months worked on
//  - GET  /:month                the month as it stands: files, what is still unanswered, and the sheet once nothing is
//  - POST /:month/preview        a chosen file shown back (first rows) and, with a layout, checked – nothing is kept
//  - POST /:month/files          the file read with a layout and kept (bytes and SHA-256); the layout can be saved
//  - POST /:month/files/:id/remove   a file read by mistake: its rows leave the month, the record stays
//  - POST /:month/codes          a code nobody on the payroll carries: tied to a staff member, or left out with a reason
//  - PUT / DELETE /:month/corrections/:staffId   a person's paid days by hand, with a reason, beside the file's figure
// Stages C and D add to the month as it stands (the routes themselves are in routes/payrollClose.js): each person's
// deductions and take-home worked out from the rate table, and – once the month is locked – the kept snapshot in
// place of any working out. A locked month refuses every change here until the hospital admin reopens it.
// The sheet is not made while a code in the file or a person on the payroll is unanswered. Rows are matched by code,
// never by name. The file is untrusted text: size and row limits, nothing in it is worked out. No patient data, and
// nothing here goes to an AI feature. The audit log gets the month and counts – never an amount.

export const payrollRunsRouter = Router();
export const LOCKED = () => new HttpError(409, 'This month is locked. The hospital admin can reopen it with a reason.', 'LOCKED');
const notFound = (what) => new HttpError(404, `${what} was not found.`, 'NOT_FOUND');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });

/** The month in the address: a real month, and not one that has not begun. */
export function monthOf(req) {
  const { month } = parse(z.object({ month: z.string().refine(isMonth, 'Choose a month') }), req.params);
  if (month > hospitalToday(req.now ?? new Date()).toISOString().slice(0, 7)) throw invalid({ month: 'This month has not begun yet' });
  if (month < '2020-01') throw invalid({ month: 'Choose a month from 2020 on' });
  return month;
}

// ---------- The layout of a file, as sent ----------
const column = z.number().int().min(0).max(MAX_COLUMNS).default(0); // 0: not chosen
const layoutBody = z.object({
  shape: z.enum(SHAPES, 'Choose what kind of file this is'),
  headerRow: z.number().int().min(0, 'Choose the row the headings are on').max(50, 'The headings must be in the first 50 rows').default(1),
  codeColumn: column,
  nameColumn: column,
  firstDayColumn: column,
  dateColumn: column,
  dateOrder: z.enum(DATE_ORDERS).default('dmy'),
  statusColumn: column,
  columns: z.object(Object.fromEntries(SUMMARY_COLUMNS.map((k) => [k, column]))).default(Object.fromEntries(SUMMARY_COLUMNS.map((k) => [k, 0]))),
  marks: z.record(z.string().max(30), z.enum(MARK_MEANINGS)).default({}).refine((m) => Object.keys(m).length <= MAX_MARKS, 'Too many marks'),
});
const fileBody = z.object({
  fileName: z.string().trim().max(200).default(''),
  // the file's bytes in base64 (at most 1 MB of file – checked again after decoding)
  content: z.string('Choose a file').min(1, 'Choose a file').max(1_500_000, 'This file is larger than 1 MB'),
  layout: layoutBody.nullable().default(null),
  saveLayoutAs: z.string().trim().max(60, 'The name is too long (at most 60 characters)').default(''),
});

/** Only what its shape uses is kept of a layout (so a saved layout holds nothing left over from another shape). */
function tidyLayout(l) {
  const base = { shape: l.shape, headerRow: l.headerRow, codeColumn: l.codeColumn, nameColumn: l.nameColumn };
  const marks = Object.fromEntries(Object.entries(l.marks).map(([k, v]) => [k.trim().toUpperCase() || EMPTY_MARK, v]));
  if (l.shape === 'register') return { ...base, firstDayColumn: l.firstDayColumn, marks };
  if (l.shape === 'days') return { ...base, dateColumn: l.dateColumn, dateOrder: l.dateOrder, statusColumn: l.statusColumn, marks: l.statusColumn ? marks : {} };
  return { ...base, columns: Object.fromEntries(SUMMARY_COLUMNS.filter((k) => l.columns[k]).map((k) => [k, l.columns[k]])) };
}

/** The file as sent: its bytes, their SHA-256 and its rows – or a 400 that says in plain words why it can't be read. */
function openFile(body) {
  const bytes = Buffer.from(body.content, 'base64');
  try {
    const { rows, delimiter, columns } = parseCsv(decodeFile(bytes));
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), rows, delimiter, columns };
  } catch (e) {
    if (e instanceof FileProblem) throw Object.assign(new HttpError(400, e.message, e.code), { fields: { content: e.message } });
    throw e;
  }
}

// ---------- The month as it stands ----------
const fileView = (f) => ({ id: String(f._id), fileName: f.fileName, shape: f.shape, rows: f.rows, people: f.people, readByName: f.readByName, readAt: f.createdAt, removed: f.removed ? { byName: f.removed.byName, at: f.removed.at, reason: f.removed.reason } : null });

/** Who locked each version of a month, and whether it was reopened since (never the snapshot itself). */
const versionsOf = (run) =>
  (run?.versions ?? []).map((v) => {
    const again = (run.reopened ?? []).find((r) => r.version === v.version);
    return { version: v.version, lockedByName: v.lockedByName, lockedAt: v.lockedAt, people: v.people, replaced: again ? { byName: again.byName, at: again.at, reason: again.reason } : null };
  });

/** A locked month: shown from its kept snapshot only – nothing is worked out again. */
function lockedState(req, month, run, files) {
  const last = run.versions[run.versions.length - 1];
  const snap = last.snapshot;
  return {
    month,
    days: monthDays(month),
    status: 'locked',
    settings: { dayBasis: snap.settings.dayBasis, weeklyOffsPaid: snap.settings.weeklyOffsPaid, holidaysPaid: snap.settings.holidaysPaid, rounding: snap.settings.rounding, parts: snap.settings.parts.map((p) => ({ key: p.key, name: p.name })) },
    basisDays: snap.basisDays,
    rulesDraft: false,
    rates: snap.rates,
    draftRates: [],
    draft: false,
    files: files.map(fileView),
    layouts: [],
    expected: snap.rows.length,
    unknownCodes: [],
    notThisMonth: [],
    noRow: [],
    twoRows: [],
    blockers: [],
    lockBlockers: [],
    sheet: { rows: snap.rows, people: snap.rows.length, payPaise: snap.totals.grossPaise, withoutPay: 0, totals: snap.totals },
    staffChoices: [],
    locked: { version: last.version, byName: last.lockedByName, at: last.lockedAt },
    versions: versionsOf(run),
    downloads: (run.downloads ?? []).filter((d) => d.version === last.version).map((d) => ({ list: d.list, byName: d.byName, at: d.at })),
    canReopen: hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES),
  };
}

/** The month as it stands, with what the lock needs beside it: { state, run, settings, rates }. */
export async function computeMonth(req, month) {
  const tenantId = req.tenantId;
  const [run, files, staff, settings, layouts, table] = await Promise.all([
    PayrollRun.findOne({ tenantId, month }).lean(),
    AttendanceFile.find({ tenantId, month }).sort({ createdAt: 1 }).lean(),
    StaffMember.find({ tenantId }).sort({ name: 1, staffNumber: 1 }).limit(5000).lean(),
    payrollSettings(tenantId),
    attendanceLayouts(tenantId),
    payrollRates(tenantId),
  ]);
  const rates = ratesFor(table, month); // the confirmed figures in force in this month (or the DRAFT ones)
  if (run?.status === 'locked' && run.versions?.length) return { state: { ...lockedState(req, month, run, files), lists: listsFor(settings) }, run, settings, rates };
  const read = run?.read ?? [];
  const fileName = new Map(files.map((f) => [String(f._id), f.fileName]));
  // Who the month expects: on the payroll, and employed on at least one day of it
  const expected = staff.filter((s) => s.isActive !== false && employedIn(month, s.joinedOn, s.leftOn));
  const expectedIds = new Set(expected.map((s) => String(s._id)));
  const carrier = new Map(); // code → staff member (anyone on the list: a code of someone who has left is still theirs)
  for (const s of staff) for (const c of s.attendanceCodes ?? []) carrier.set(c, s);

  const rowsOf = new Map(); // staff id → the rows of the file that are theirs
  const unknownCodes = [];
  const notThisMonth = [];
  for (const r of read) {
    const s = carrier.get(r.code);
    if (!s) {
      const out = (run?.leftOut ?? []).find((x) => x.code === r.code);
      unknownCodes.push({ code: r.code, name: r.name, row: r.row, fileName: fileName.get(String(r.fileId)) ?? '', leftOut: out ? { reason: out.reason, byName: out.byName, at: out.at } : null });
    } else if (!expectedIds.has(String(s._id))) notThisMonth.push({ code: r.code, staffNumber: s.staffNumber, name: s.name, why: s.isActive === false ? 'off' : 'notEmployed' });
    else rowsOf.set(String(s._id), [...(rowsOf.get(String(s._id)) ?? []), r]);
  }
  const corrections = new Map((run?.corrections ?? []).map((c) => [String(c.staffId), c]));
  const noRow = expected.filter((s) => !rowsOf.has(String(s._id))).map((s) => ({ staffId: String(s._id), staffNumber: s.staffNumber, name: s.name, designation: s.designation ?? '', answered: corrections.has(String(s._id)) }));
  const twoRows = expected.filter((s) => (rowsOf.get(String(s._id)) ?? []).length > 1).map((s) => ({ staffId: String(s._id), staffNumber: s.staffNumber, name: s.name, codes: rowsOf.get(String(s._id)).map((r) => r.code) }));

  const basis = basisDays(settings.dayBasis, month);
  const blockers = [];
  if (!basis) blockers.push('basis');
  if (!expected.length) blockers.push('nobody');
  if (unknownCodes.some((c) => !c.leftOut)) blockers.push('codes');
  if (noRow.some((s) => !s.answered)) blockers.push('noRow');
  if (twoRows.length) blockers.push('twoRows');

  let sheet = null;
  if (!blockers.length) {
    // Stage C: what each person's month carries beside the days – TDS for the month, one-off lines, advances
    const [advances, lockedMonths] = await Promise.all([
      StaffAdvance.find({ tenantId }).sort({ givenOn: 1, createdAt: 1 }).limit(5000).lean(),
      PayrollRun.find({ tenantId, status: 'locked' }, { month: 1, recovered: 1 }).lean(),
    ]);
    const takenBack = new Map(); // advance → what the other, locked months took back
    for (const m of lockedMonths) if (m.month !== month) for (const r of m.recovered ?? []) takenBack.set(String(r.advanceId), [...(takenBack.get(String(r.advanceId)) ?? []), { amountPaise: r.amountPaise }]);
    const tdsOf = new Map((run?.tds ?? []).map((t) => [String(t.staffId), t]));
    const changedInstalment = new Map((run?.instalments ?? []).map((i) => [String(i.advanceId), i]));
    const partName = new Map(settings.parts.map((p) => [p.key, p.name]));
    const named = (parts) => parts.map((p) => ({ key: p.key, name: partName.get(p.key) ?? p.key, amountPaise: p.amountPaise }));

    const rows = expected.map((s) => {
      const id = String(s._id);
      const row = sheetRow({ staff: s, month, read: rowsOf.get(id)?.[0] ?? null, correction: corrections.get(id) ?? null, settings });
      const entry = payEntryFor(s.pay, month, employedIn(month, s.joinedOn, s.leftOn));
      const applies = { pf: Boolean(entry?.pf?.applies), esi: Boolean(entry?.esi?.applies), pt: Boolean(entry?.pt?.applies) };
      const tds = tdsOf.get(id) ?? null;
      const lines = (run?.lines ?? []).filter((l) => String(l.staffId) === id).map((l) => ({ kind: l.kind, label: l.label, amountPaise: l.amountPaise, byName: l.byName ?? '', at: l.at ?? null }));
      const mine = advances
        .filter((a) => String(a.staffId) === id && !a.stopped && a.recoverFrom <= month)
        .map((a) => {
          const changed = changedInstalment.get(String(a._id));
          return { id: String(a._id), givenOn: a.givenOn, amountPaise: a.amountPaise, instalmentPaise: a.instalmentPaise, balancePaise: advanceBalance({ amountPaise: a.amountPaise, recovered: takenBack.get(String(a._id)) ?? [] }), note: a.note ?? '', thisMonth: changed ? { amountPaise: changed.amountPaise, reason: changed.reason, byName: changed.byName ?? '' } : null };
        })
        .filter((a) => a.balancePaise > 0);
      const pay = payOf({ row, applies, ptSlab: s.ptSlab ?? '', settings, rates, month, tdsPaise: tds ? tds.tdsPaise : (entry?.tdsPaise ?? 0), lines, advances: mine.map((a) => ({ id: a.id, instalmentPaise: a.instalmentPaise, balancePaise: a.balancePaise, thisMonthPaise: a.thisMonth?.amountPaise })) });
      return {
        ...row,
        parts: named(row.parts),
        applies,
        ptSlab: s.ptSlab ?? '',
        payFrom: entry?.from ? new Date(entry.from).toISOString().slice(0, 10) : null, // the pay entry this month uses
        pay: pay && { ...pay, earned: named(pay.earned) },
        month: { tds: tds ? { tdsPaise: tds.tdsPaise, byName: tds.byName ?? '', at: tds.at ?? null } : null, entryTdsPaise: entry?.tdsPaise ?? 0, lines, advances: mine },
      };
    });
    sheet = { rows, people: rows.length, payPaise: rows.reduce((sum, r) => sum + (r.payPaise ?? 0), 0), withoutPay: rows.filter((r) => r.payPaise == null).length, totals: monthTotals(rows) };
  }
  // Stage D: what still stands between this month and its lock
  const rulesDraft = rulesAreDraft(settings);
  const draftRates = sheet ? RATE_GROUPS.filter((g) => sheet.rows.some((r) => r.pay?.draftRates.includes(g))) : RATE_GROUPS.filter((g) => rateIsDraft(rates[g], month));
  const lockBlockers = [];
  if (!sheet) lockBlockers.push('sheet');
  else {
    if (rulesDraft) lockBlockers.push('rules');
    for (const g of draftRates) lockBlockers.push(`rate-${g}`);
    if (sheet.withoutPay) lockBlockers.push('noPay');
    if (sheet.rows.some((r) => r.pay?.notes.includes('ptSlabMissing'))) lockBlockers.push('ptSlab');
    if (sheet.rows.some((r) => r.pay?.notes.includes('overDeducted'))) lockBlockers.push('overDeducted');
  }
  const state = {
    month,
    days: monthDays(month),
    status: run?.status ?? 'draft',
    settings: { dayBasis: settings.dayBasis, weeklyOffsPaid: settings.weeklyOffsPaid, holidaysPaid: settings.holidaysPaid, rounding: settings.rounding, parts: settings.parts.map((p) => ({ key: p.key, name: p.name })) },
    basisDays: basis,
    rulesDraft,
    rates,
    draftRates,
    // DRAFT – not for payment: a rule or a rate this month uses is not confirmed by the accountant
    draft: rulesDraft || draftRates.length > 0,
    files: files.map(fileView),
    layouts,
    expected: expected.length,
    unknownCodes,
    notThisMonth,
    noRow,
    twoRows,
    blockers,
    lockBlockers,
    sheet,
    // for tying a code: everyone on the payroll this month
    staffChoices: expected.map((s) => ({ id: String(s._id), staffNumber: s.staffNumber, name: s.name })),
    locked: null,
    versions: versionsOf(run),
    downloads: [],
    lists: listsFor(settings),
    canReopen: hasRole(req.membership, ...PAYROLL_SETTINGS_ROLES),
  };
  return { state, run, settings, rates };
}

export const monthState = async (req, month) => (await computeMonth(req, month)).state;

/** A locked month takes no change: 409 until the hospital admin reopens it. */
export async function mustBeOpen(req, month) {
  if (await PayrollRun.exists({ tenantId: req.tenantId, month, status: 'locked' })) throw LOCKED();
}


/** The month's run, made when the first thing is written into it. */
export async function runFor(req, month, update, again = true) {
  try {
    // (the filter leaves a locked month out: were one locked between the check and this write, the insert that follows
    // meets the one-run-per-month index and nothing is written)
    return await PayrollRun.findOneAndUpdate({ tenantId: req.tenantId, month, status: { $ne: 'locked' } }, { ...update, $set: { ...(update.$set ?? {}), updatedByName: req.user.name } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two first writes at the same moment also meet that index: once more, into the run the other one made
    if (again) return runFor(req, month, update, false);
    throw LOCKED();
  }
}

payrollRunsRouter.get('/', async (req, res) => {
  // (never the snapshots: of each version only its number, who locked it and when)
  const [runs, settings] = await Promise.all([
    PayrollRun.find({ tenantId: req.tenantId }, { month: 1, status: 1, updatedByName: 1, updatedAt: 1, 'versions.version': 1, 'versions.lockedByName': 1, 'versions.lockedAt': 1, 'versions.people': 1, downloads: 1 }).sort({ month: -1 }).limit(60).lean(),
    payrollSettings(req.tenantId),
  ]);
  res.json({
    runs: runs.map((r) => {
      const last = r.status === 'locked' ? (r.versions ?? []).at(-1) : null;
      return {
        month: r.month,
        status: r.status ?? 'draft',
        updatedByName: r.updatedByName ?? '',
        updatedAt: r.updatedAt,
        // a locked month: which version, and which lists were already saved from it (the Lists page)
        locked: last ? { version: last.version, byName: last.lockedByName ?? '', at: last.lockedAt ?? null, people: last.people ?? 0 } : null,
        downloads: last ? (r.downloads ?? []).filter((d) => d.version === last.version).map((d) => ({ list: d.list, byName: d.byName, at: d.at })) : [],
      };
    }),
    lists: listsFor(settings),
    currentMonth: hospitalToday(req.now ?? new Date()).toISOString().slice(0, 7),
  });
});

payrollRunsRouter.get('/:month', async (req, res) => {
  const month = monthOf(req);
  const state = await monthState(req, month);
  // the sheet shows what each person is paid: opening it is in the audit log (the month and how many people)
  if (state.sheet) await audit(req, 'PAYROLL_SHEET_VIEWED', { details: { month, people: state.sheet.people } });
  res.json(state);
});

// ---------- A file: shown back, checked, read ----------
/** What the file says under a layout, checked against the month's other files: { fields, marks, people, problems … }. */
async function checkFile(req, month, file, layout) {
  const fields = layoutProblems(layout, month);
  if (Object.keys(fields).length) return { fields, marks: [], people: [], problems: [], unmapped: [], skippedRows: 0, otherMonths: 0 };
  const marks = marksIn(file.rows, layout, month);
  if (marks.length > MAX_MARKS) return { fields: { [layout.shape === 'register' ? 'firstDayColumn' : 'statusColumn']: 'This column holds too many different values to be attendance marks – check the column chosen' }, marks: [], people: [], problems: [], unmapped: [], skippedRows: 0, otherMonths: 0 };
  const result = readAttendance(file.rows, layout, month);
  // A code may come from one file only in a month (two sources, two files – never the same person in both)
  const run = await PayrollRun.findOne({ tenantId: req.tenantId, month }, { 'read.code': 1 }).lean();
  const already = new Set((run?.read ?? []).map((r) => r.code));
  const twice = result.people.filter((p) => already.has(p.code)).map((p) => p.code);
  if (twice.length) result.problems.unshift(`${twice.length === 1 ? `The code ${twice[0]} was` : `${twice.length} codes (${twice.slice(0, 5).join(', ')}${twice.length > 5 ? ' …' : ''}) were`} already read from another file for this month. Remove that file first, or take these rows out of this one.`);
  return { fields, marks, ...result };
}

payrollRunsRouter.post('/:month/preview', async (req, res) => {
  const month = monthOf(req);
  const body = parse(fileBody, req.body);
  const file = openFile(body);
  const layout = body.layout ? tidyLayout(body.layout) : null;
  const check = layout ? await checkFile(req, month, file, layout) : null;
  const known = new Set((await StaffMember.find({ tenantId: req.tenantId }, { attendanceCodes: 1 }).lean()).flatMap((s) => s.attendanceCodes ?? []));
  res.json({
    file: { fileName: body.fileName, size: file.bytes.length, sha256: file.sha256, alreadyRead: Boolean(await AttendanceFile.exists({ tenantId: req.tenantId, month, sha256: file.sha256, removed: null })) },
    delimiter: file.delimiter,
    totalRows: file.rows.length,
    columns: file.columns,
    // the first rows, as text and cut short: for choosing the columns on
    rows: file.rows.slice(0, 25).map((r) => r.slice(0, MAX_COLUMNS).map((c) => c.slice(0, 40))),
    layouts: await attendanceLayouts(req.tenantId),
    check: check && {
      fields: check.fields,
      marks: check.marks,
      unmapped: check.unmapped,
      problems: check.problems,
      skippedRows: check.skippedRows,
      otherMonths: check.otherMonths,
      people: check.people.length,
      unknownCodes: check.people.filter((p) => !known.has(p.code)).length,
      sample: check.people.slice(0, 5).map((p) => ({ code: p.code, name: p.name, row: p.row, counts: p.counts, paidDaysGiven: p.paidDaysGiven })),
      ready: !Object.keys(check.fields).length && !check.unmapped.length && !check.problems.length && check.people.length > 0,
    },
  });
});

payrollRunsRouter.post('/:month/files', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const body = parse(fileBody, req.body);
  if (!body.layout) throw invalid({ layout: 'Choose the columns of this file first' });
  const file = openFile(body);
  if (await AttendanceFile.exists({ tenantId: req.tenantId, month, sha256: file.sha256, removed: null })) throw new HttpError(409, 'This file was already read for this month.', 'ALREADY_READ');
  const layout = tidyLayout(body.layout);
  const check = await checkFile(req, month, file, layout);
  if (Object.keys(check.fields).length) throw invalid(Object.fromEntries(Object.entries(check.fields).map(([k, v]) => [`layout.${k}`, v])));
  if (check.unmapped.length) throw invalid({ 'layout.marks': `Say what these marks mean first: ${check.unmapped.slice(0, 10).join(', ')}` });
  if (check.problems.length) throw Object.assign(invalid({ content: check.problems[0] }, 'This file can’t be read as it is.'), { details: { problems: check.problems } });
  if (body.saveLayoutAs && !(await saveAttendanceLayout(req, body.saveLayoutAs, layout))) throw invalid({ saveLayoutAs: `There are already ${MAX_LAYOUTS} saved layouts. Save under the name of one of them to replace it.` });

  const kept = await AttendanceFile.create({ tenantId: req.tenantId, month, fileName: body.fileName, size: file.bytes.length, sha256: file.sha256, bytes: file.bytes, shape: layout.shape, layout, rows: file.rows.length, people: check.people.length, readByName: req.user.name });
  const read = check.people.map((p) => ({ fileId: kept._id, code: p.code.slice(0, 40), name: p.name, row: p.row, counts: p.counts ?? Object.fromEntries(DAY_KINDS.map((k) => [k, 0])), paidDaysGiven: p.paidDaysGiven ?? null, days: p.days ?? null }));
  await runFor(req, month, { $push: { read: { $each: read } } });
  const state = await monthState(req, month);
  await audit(req, 'PAYROLL_ATTENDANCE_READ', { details: { month, fileName: body.fileName, rows: file.rows.length, people: check.people.length, unknown: state.unknownCodes.filter((c) => read.some((r) => r.code === c.code)).length } });
  res.status(201).json(state);
});

payrollRunsRouter.post('/:month/files/:id/remove', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const { id } = parse(z.object({ id: objectId }), { id: req.params.id });
  const { reason } = parse(z.object({ reason: z.string('Say why this file is removed').trim().min(3, 'Say why this file is removed').max(200) }), req.body);
  const file = await AttendanceFile.findOne({ _id: id, tenantId: req.tenantId, month }).lean();
  if (!file) throw notFound('This file');
  if (file.removed) throw new HttpError(409, 'This file was already removed.', 'CONFLICT');
  // (an update, not save(): the bytes are not selected here, and nothing but this mark changes)
  await AttendanceFile.updateOne({ _id: file._id, tenantId: req.tenantId }, { $set: { removed: { byName: req.user.name, at: req.now ?? new Date(), reason } } });
  await runFor(req, month, { $pull: { read: { fileId: file._id } } });
  await audit(req, 'PAYROLL_ATTENDANCE_REMOVED', { details: { month, fileName: file.fileName, people: file.people } });
  res.json(await monthState(req, month));
});

// ---------- A code nobody on the payroll carries ----------
const codeBody = z.object({
  code: z.string('Choose the code').trim().min(1, 'Choose the code').max(40),
  staffId: objectId.nullable().default(null), // tie the code to this staff member
  leaveOut: z.boolean().default(false), // or leave its row out of this month …
  reason: z.string().trim().max(200).default(''), // … with a reason
  undo: z.boolean().default(false), // or take back "left out"
});

payrollRunsRouter.post('/:month/codes', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const body = parse(codeBody, req.body);
  const before = await monthState(req, month);
  const unknown = before.unknownCodes.find((c) => c.code === body.code);
  if (!unknown) throw new HttpError(404, 'This code is not waiting for an answer in this month.', 'NOT_FOUND');
  if (body.undo) await runFor(req, month, { $pull: { leftOut: { code: body.code } } });
  else if (body.staffId) {
    const staff = await StaffMember.findOne({ _id: body.staffId, tenantId: req.tenantId });
    if (!staff || staff.isActive === false || !employedIn(month, staff.joinedOn, staff.leftOn)) throw notFound('This staff member, on the payroll for this month,');
    if ((staff.attendanceCodes ?? []).length >= 10) throw invalid({ staffId: `${staff.name} already carries 10 codes` });
    // (the code is unknown, so nobody else carries it; tying it saves it for the months to come)
    staff.attendanceCodes.push(body.code);
    staff.updatedByName = req.user.name;
    await staff.save();
    await runFor(req, month, { $pull: { leftOut: { code: body.code } } });
    await audit(req, 'PAYROLL_STAFF_CHANGED', { details: { staffId: String(staff._id), staffNumber: staff.staffNumber, name: staff.name, fields: ['attendanceCodes'] } });
  } else if (body.leaveOut) {
    if (body.reason.length < 3) throw invalid({ reason: 'Say why this row is left out' });
    await runFor(req, month, { $pull: { leftOut: { code: body.code } } });
    await runFor(req, month, { $push: { leftOut: { code: body.code, reason: body.reason, byName: req.user.name, at: req.now ?? new Date() } } });
    await audit(req, 'PAYROLL_CODE_LEFT_OUT', { details: { month, code: body.code } });
  } else throw invalid({ staffId: 'Choose the staff member this code belongs to, or leave the row out with a reason' });
  res.json(await monthState(req, month));
});

// ---------- A person's paid days by hand ----------
const correctionBody = z.object({
  paidDays: z
    .number('Write the paid days')
    .min(0, 'Paid days can’t be below 0')
    .max(31, 'A month has at most 31 days')
    .refine((n) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9, 'Write whole, half or quarter days, like 26 or 25.5'),
  reason: z.string('Say why the days are written by hand').trim().min(3, 'Say why the days are written by hand').max(200),
});

export async function staffOfMonth(req, month) {
  const { staffId } = parse(z.object({ staffId: objectId }), { staffId: req.params.staffId });
  const staff = await StaffMember.findOne({ _id: staffId, tenantId: req.tenantId }).lean();
  if (!staff || staff.isActive === false || !employedIn(month, staff.joinedOn, staff.leftOn)) throw notFound('This staff member, for this month,');
  return staff;
}

payrollRunsRouter.put('/:month/corrections/:staffId', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const staff = await staffOfMonth(req, month);
  const body = parse(correctionBody, req.body);
  if (body.paidDays > monthDays(month)) throw invalid({ paidDays: `${month} has ${monthDays(month)} days` });
  await runFor(req, month, { $pull: { corrections: { staffId: staff._id } } });
  await runFor(req, month, { $push: { corrections: { staffId: staff._id, paidDays: body.paidDays, reason: body.reason, byName: req.user.name, at: req.now ?? new Date() } } });
  await audit(req, 'PAYROLL_DAYS_CORRECTED', { details: { month, staffId: String(staff._id), staffNumber: staff.staffNumber, name: staff.name } });
  res.json(await monthState(req, month));
});

payrollRunsRouter.delete('/:month/corrections/:staffId', async (req, res) => {
  const month = monthOf(req);
  await mustBeOpen(req, month);
  const staff = await staffOfMonth(req, month);
  const run = await PayrollRun.findOne({ tenantId: req.tenantId, month }, { corrections: 1 }).lean();
  if ((run?.corrections ?? []).some((c) => String(c.staffId) === String(staff._id))) {
    await runFor(req, month, { $pull: { corrections: { staffId: staff._id } } });
    await audit(req, 'PAYROLL_DAYS_CORRECTED', { details: { month, staffId: String(staff._id), staffNumber: staff.staffNumber, name: staff.name, removed: true } });
  }
  res.json(await monthState(req, month));
});
