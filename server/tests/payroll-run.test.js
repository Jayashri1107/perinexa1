// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): a month's attendance file read into the salary sheet.
// All fake sample data: made-up staff, made-up pay, a made-up attendance file.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { LEFT_OUT } from '../src/export/hospitalExport.js';
import { AttendanceFile } from '../src/models/AttendanceFile.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PayrollRun } from '../src/models/PayrollRun.js';
import { StaffMember } from '../src/models/StaffMember.js';
import { Tenant } from '../src/models/Tenant.js';
import { EMPTY_MARK, countDays, layoutProblems, marksIn, monthDays, readAttendance, readDate, readDays } from '../src/payroll/attendanceRead.js';
import { FileProblem, decodeFile, parseCsv, sniffDelimiter } from '../src/payroll/csvText.js';
import { basisDays, employedIn, paidDaysOf, payFor, roundPay, sheetRow } from '../src/payroll/payrollMath.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
const enc = (s) => new TextEncoder().encode(s);

// October 2026 has 31 days. P present, A absent, H half day, W weekly off, O holiday, L paid leave.
const M = '2026-10';
const line = (code, name, marks) => [code, `"${name}"`, ...marks.split('')].join(',');
const csv = [
  'Sample Hospital attendance – October 2026',
  ['Code', 'Name', ...Array.from({ length: 31 }, (_, i) => i + 1)].join(','),
  line('A-17', 'Attendant, Sample', 'PPPWPPPPPHWPPOPPPWPPAPLPWPPPPPP'), // 23 P, 1 H, 4 W, 1 O, 1 L, 1 A
  line('N-12', 'Nurse', 'PPPWPPPPPPWPPPPPPWPPPPPPWPPPPPP'), // 27 P, 4 W
  line('C-4', 'Cleaner', 'PPPWPPPPPPWPPPPPPWPPPPPPWPPPPPP'),
  line('D-9', 'Driver', 'AAAWAAAAAAWAAAAAAWAAAAAAWAAAAAA'),
  line('J-6', 'Joiner', 'AAAWAAAAAAWAAAAPPWPPPPPPWPPPPPP'), // from the 16th: 14 P, 2 W
  line('X-9', 'Guard Sample', 'PPPWPPPPPPWPPPPPPWPPPPPPWPPPAAA'), // 24 P, 4 W, 3 A
  line('Y-1', 'Old Tester', 'PPPWPPPPPPWPPPPPPWPPPPPPWPPPPPP'),
  ',Total',
].join('\r\n');
const b64 = (text) => Buffer.from(`﻿${text}`, 'utf8').toString('base64');
const layout = { shape: 'register', headerRow: 2, codeColumn: 1, nameColumn: 2, firstDayColumn: 3, marks: { P: 'present', A: 'absent', H: 'half', W: 'weeklyOff', O: 'holiday', L: 'paidLeave' } };

describe('payroll: the attendance file as text (pure)', () => {
  it('reads the byte-order mark, UTF-16, quotes and the three separators; refuses Excel, big, long and wide files', () => {
    expect(decodeFile(enc('﻿a,b'))).toBe('a,b');
    expect(decodeFile(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]))).toBe('a,b');
    expect(() => decodeFile(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]))).toThrow(/Save As/);
    expect(() => decodeFile(new Uint8Array(0))).toThrow(FileProblem);
    expect(() => decodeFile(new Uint8Array(1024 * 1024 + 1).fill(65))).toThrow(/larger than 1 MB/);
    expect(() => decodeFile(new Uint8Array([65, 0, 66]))).toThrow(/not a text file/);
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(sniffDelimiter('"x;y",b,c\n1,2,3')).toBe(',');
    const p = parseCsv('Code, Name ,D1\r\n"A-1","Rao, ""Sample""",P\r\n\r\nA-2,Second, =1+1 \n');
    expect(p.rows).toEqual([['Code', 'Name', 'D1'], ['A-1', 'Rao, "Sample"', 'P'], [], ['A-2', 'Second', '=1+1']]); // a formula stays text
    expect(p).toMatchObject({ delimiter: ',', columns: 3 });
    expect(parseCsv('a;b\n"multi\nline";c').rows).toEqual([['a', 'b'], ['multi\nline', 'c']]);
    expect(() => parseCsv('a,"b\nc,d')).toThrow(/never closed/);
    expect(() => parseCsv(Array.from({ length: 5002 }, (_, i) => `r${i}`).join('\n'))).toThrow(/more than 5000 rows/);
    expect(() => parseCsv(Array.from({ length: 90 }, () => 'x').join(','))).toThrow(/more than 80 columns/);
    expect(() => parseCsv('\n\n  \n')).toThrow(/no rows/);
  });
});

describe('payroll: a layout turns rows into days (pure)', () => {
  const rows = parseCsv(csv).rows;

  it('a register: marks counted, unknown marks wait, a code twice is refused, title and total rows skipped', () => {
    expect(monthDays('2026-11')).toBe(30);
    expect(monthDays('2028-02')).toBe(29);
    expect(marksIn(rows, layout, M).map((m) => m.mark).sort()).toEqual(['A', 'H', 'L', 'O', 'P', 'W']);
    const r = readAttendance(rows, layout, M);
    expect(r).toMatchObject({ problems: [], unmapped: [], skippedRows: 1, otherMonths: 0 });
    expect(r.people).toHaveLength(7);
    expect(r.people[0]).toMatchObject({ code: 'A-17', name: 'Attendant, Sample', row: 3, counts: { present: 23, half: 1, weeklyOff: 4, holiday: 1, paidLeave: 1, unpaidLeave: 0, absent: 1 } });
    expect(r.people[0].days['10']).toBe('half');
    expect(readAttendance(rows, { ...layout, marks: { P: 'present', W: 'weeklyOff' } }, M).unmapped.sort()).toEqual(['A', 'H', 'L', 'O']);
    expect(readAttendance([...rows, rows[2]], layout, M).problems[0]).toMatch(/code A-17 is on rows 3 and 11/);
    // An empty box needs a meaning too
    const short = [rows[1], ['A-17', 'S', 'P', '', 'P']];
    expect(readAttendance(short, { ...layout, headerRow: 1 }, M).unmapped).toEqual([EMPTY_MARK]);
    expect(readAttendance(short, { ...layout, headerRow: 1, marks: { ...layout.marks, [EMPTY_MARK]: 'skip' } }, M).people[0].counts.present).toBe(2);
    expect(readAttendance([rows[1], ['', 'x']], { ...layout, headerRow: 1 }, M).problems[0]).toMatch(/No row with a code/);
  });

  it('a daily list: dates in the stated order, a day counted once, other months left out', () => {
    expect(readDate('05/11/2026', 'dmy')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(readDate('11-05-26', 'mdy')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(readDate('2026-11-05 09:12', 'ymd')).toEqual({ y: 2026, m: 11, d: 5 });
    expect(readDate('31/02/2026', 'dmy')).toBeNull();
    const log = [['Emp', 'Date', 'In', 'Out', 'Status'], ['A-17', '02/11/2026', '09:01', '17:30', 'P'], ['A-17', '02/11/2026', '17:30', '', 'P'], ['A-17', '03/11/2026', '09:10', '13:00', 'HD'], ['A-17', '31/10/2026', '09:00', '17:00', 'P'], ['N-12', '02/11/2026', '', '', 'A'], ['N-12', 'x', '', '', 'P']];
    const days = { shape: 'days', headerRow: 1, codeColumn: 1, nameColumn: 0, dateColumn: 2, dateOrder: 'dmy', statusColumn: 5, marks: { P: 'present', HD: 'half', A: 'absent' } };
    const r = readAttendance(log, days, '2026-11');
    expect(r.otherMonths).toBe(1);
    expect(r.problems[0]).toMatch(/Row 7: the date “x” can’t be read/);
    expect(r.people.map((p) => [p.code, p.counts.present, p.counts.half, p.counts.absent])).toEqual([['A-17', 1, 1, 0], ['N-12', 0, 0, 1]]);
    // No status column: a row for the day means present
    expect(readAttendance(log.slice(0, 5), { ...days, statusColumn: 0 }, '2026-11').people[0].counts.present).toBe(2);
  });

  it('a file of totals: numbers of days, checked against the month; a layout is checked before a file is read', () => {
    expect(readDays('25.5')).toBe(25.5);
    expect(readDays('')).toBe(0);
    expect(readDays('32')).toBeNull();
    const sum = [['Code', 'Name', 'Present', 'Half', 'WO', 'Paid'], ['A-17', 'Sample', '22', '1', '4', '27.5'], ['Z', 'Bad', 'x', '', '', '']];
    const totals = { shape: 'summary', headerRow: 1, codeColumn: 1, nameColumn: 2, columns: { present: 3, half: 4, weeklyOff: 5 } };
    const r = readAttendance(sum, totals, '2026-11');
    expect(r.problems[0]).toMatch(/Row 3, column 3: “x” is not a number of days/);
    expect(r.people[0]).toMatchObject({ counts: { present: 22, half: 1, weeklyOff: 4 }, days: null });
    expect(readAttendance(sum.slice(0, 2), { ...totals, columns: { paidDays: 6 } }, '2026-11').people[0].paidDaysGiven).toBe(27.5);
    expect(readAttendance([sum[0], ['A-17', 'S', '28', '0', '4', '']], totals, '2026-11').problems[0]).toMatch(/add up to 32, more than the 30 days/);
    expect(layoutProblems({ ...totals, columns: { paidDays: 6, present: 3 } }, '2026-11')).toEqual({ columns: 'Choose either the paid days column, or the columns it is made of – not both' });
    expect(layoutProblems({ shape: 'register', headerRow: 1, codeColumn: 4, nameColumn: 2, firstDayColumn: 3 }, '2026-11')).toEqual({ codeColumn: 'This column is one of the day columns' });
    expect(layoutProblems({ shape: 'days', headerRow: 1, codeColumn: 1, nameColumn: 0, dateColumn: 1, statusColumn: 0 }, '2026-11')).toEqual({ dateColumn: 'Column 1 is chosen twice' });
    expect(layoutProblems(layout, M)).toEqual({});
  });
});

describe('payroll: the arithmetic of the sheet (pure)', () => {
  const S = { dayBasis: 'calendar', weeklyOffsPaid: true, holidaysPaid: true, rounding: 'nearest' };
  const person = readAttendance(parseCsv(csv).rows, layout, M).people[0]; // 23 present, 1 half, 4 weekly off, 1 holiday, 1 paid leave, 1 absent
  const pay = [{ from: '2025-04-01', parts: [{ key: 'basic', amountPaise: 1000000 }] }, { from: '2026-10-01', parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300000 }] }];
  const staff = { _id: 's1', staffNumber: 'S001', name: 'Sample Attendant', joinedOn: '2025-04-01', leftOn: null, pay };

  it('basis days, the days employed, paid days and the rounding', () => {
    expect([basisDays('calendar', '2026-11'), basisDays('calendar', '2026-02'), basisDays('thirty', '2026-02'), basisDays('twentySix', '2026-12'), basisDays('', '2026-11')]).toEqual([30, 28, 30, 26, null]);
    expect(employedIn('2026-11', '2026-11-16', null)).toEqual({ from: 16, to: 30, days: 15, whole: false });
    expect(employedIn('2026-11', null, '2026-11-10')).toEqual({ from: 1, to: 10, days: 10, whole: false });
    expect(employedIn('2026-11', '2026-12-01', null)).toBeNull();
    expect(employedIn('2026-11', null, '2026-10-31')).toBeNull();
    expect(paidDaysOf(person.counts, S)).toBe(29.5);
    expect(paidDaysOf(person.counts, { ...S, weeklyOffsPaid: false })).toBe(25.5);
    expect(paidDaysOf(person.counts, { ...S, weeklyOffsPaid: false, holidaysPaid: false })).toBe(24.5);
    expect([roundPay(1424950.4, 'nearest'), roundPay(1424949, 'nearest'), roundPay(1424901, 'up'), roundPay(1424900, 'up'), roundPay(1424999, 'down'), roundPay(1424950.4, 'paise')]).toEqual([1425000, 1424900, 1425000, 1424900, 1424900, 1424950]);
    expect(payFor(1500000, 28.5, 30, 'nearest')).toEqual({ paise: 1425000, capped: false });
    expect(payFor(1500000, 24.5, 26, 'paise')).toEqual({ paise: 1413462, capped: false }); // 15,000 × 24.5 ÷ 26 = 14,134.615…
    expect(payFor(1500000, 27, 26, 'nearest')).toEqual({ paise: 1500000, capped: true }); // never more than the monthly pay
    expect(payFor(1500000, 10, null, 'nearest')).toEqual({ paise: null, capped: false }); // no basis chosen: no sum
  });

  it('one row: the pay in force that month, a correction beside the file, joining and leaving inside the month', () => {
    const row = sheetRow({ staff, month: M, read: person, correction: null, settings: S });
    expect(row).toMatchObject({ fileDays: 29.5, paidDays: 29.5, basis: 31, monthlyPaise: 1500000, payPaise: 1427400, notes: [] }); // 15,000 × 29.5 ÷ 31 = 14,274.19
    expect(sheetRow({ staff, month: '2026-09', read: null, correction: { paidDays: 30, reason: 'By hand' }, settings: S }).monthlyPaise).toBe(1000000); // September: the earlier pay
    const fixed = sheetRow({ staff, month: M, read: person, correction: { paidDays: 31, reason: 'Machine down on the 21st', byName: 'Sample Accounts' }, settings: S });
    expect(fixed).toMatchObject({ fileDays: 29.5, paidDays: 31, payPaise: 1500000, correction: { reason: 'Machine down on the 21st' } });
    const joined = sheetRow({ staff: { ...staff, joinedOn: '2026-10-16' }, month: M, read: person, correction: null, settings: S });
    expect(joined.counts).toEqual(countDays(person.days, 16, 31));
    expect(joined.notes).toContain('joined');
    const totals = { code: 'A-17', counts: { present: 22, half: 0, weeklyOff: 4, holiday: 0, paidLeave: 0, unpaidLeave: 0, absent: 0 }, paidDaysGiven: null, days: null };
    const left = sheetRow({ staff: { ...staff, leftOn: '2026-10-10' }, month: M, read: totals, correction: null, settings: S });
    expect(left).toMatchObject({ paidDays: 10, notes: ['left'] }); // a file of totals: no more paid days than the days employed
    expect(sheetRow({ staff: { ...staff, pay: [] }, month: M, read: null, correction: null, settings: S })).toMatchObject({ paidDays: null, payPaise: null, notes: ['noRow', 'noPay'] });
    expect(sheetRow({ staff: { ...staff, pay: [pay[0], { ...pay[1], from: '2026-10-15' }] }, month: M, read: person, correction: null, settings: S }).notes).toContain('payChanged');
    expect(sheetRow({ staff, month: M, read: { ...totals, paidDaysGiven: 27 }, correction: null, settings: { ...S, dayBasis: 'twentySix' } })).toMatchObject({ payPaise: 1500000, notes: ['capped'] });
  });
});

describe('payroll: a month from the file to the sheet', () => {
  let alpha;
  let beta;
  let admin;
  let accounts;
  let s; // the accounts login's session
  let ids; // staff number → id
  const rules = (overrides = {}) => ({ parts: [{ key: 'basic', name: 'Basic pay', countsForPf: true, countsForEsi: true }], dayBasis: 'calendar', weeklyOffsPaid: true, holidaysPaid: true, rounding: 'nearest', confirmedBy: '', confirmedOn: null, ...overrides });
  const person = (staffNumber, name, codes, rupees, overrides = {}) => ({ staffNumber, name, joinedOn: '2025-04-01', attendanceCodes: codes, pay: rupees ? { from: overrides.joinedOn ?? '2025-04-01', parts: [{ key: 'basic', amountPaise: rupees * 100 }] } : null, ...overrides });
  const rowOf = (state, staffNumber) => state.sheet.rows.find((r) => r.staffNumber === staffNumber);

  beforeAll(connectTestDb);
  beforeEach(async () => {
    await resetTestDb();
    alpha = await createTenant('Alpha Hospital');
    beta = await createTenant('Beta Hospital');
    admin = await createUser({ name: 'Alpha Admin' });
    await addMember(admin, alpha, 'admin');
    accounts = await createUser({ name: 'Alpha Accounts' });
    await addMember(accounts, alpha, 'accounts');
    s = await loginAs(accounts, { app });
    ids = {};
    for (const p of [
      person('S001', 'Sample Attendant', ['A-17'], 15000),
      person('S002', 'Sample Nurse', ['N-12'], 32500),
      person('S003', 'Sample Guard', [], 13800),
      person('S004', 'Sample Cleaner', ['C-4'], 0), // no pay entered yet
      person('S005', 'Sample Driver', ['D-9'], 18000, { leftOn: '2026-09-30' }),
      person('S006', 'Sample Joiner', ['J-6'], 18000, { joinedOn: '2026-10-16' }),
    ]) {
      const made = await s.post('/api/payroll/staff').send(p);
      if (made.status !== 201) throw new Error(`staff not made: ${JSON.stringify(made.body)}`);
      ids[p.staffNumber] = made.body.staff.id;
    }
  });
  afterAll(disconnectTestDb);

  const read = (session = s, body = {}) => session.post(`/api/payroll/runs/${M}/files`).send({ fileName: 'october.csv', content: b64(csv), layout, ...body });
  const settle = async () => {
    expect((await (await loginAs(admin, { app })).put('/api/payroll/settings').send(rules())).status).toBe(200);
    expect((await read()).status).toBe(201);
    expect((await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1', leaveOut: true, reason: 'A test card of the machine' })).status).toBe(200);
    const tied = await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'X-9', staffId: ids.S003 });
    expect(tied.status, JSON.stringify(tied.body)).toBe(200);
    return tied.body;
  };

  it('only the two payroll roles reach it – never a doctor, another hospital’s data, or Perinexa’s own staff', async () => {
    await settle();
    const doctor = await createUser({ name: 'Dr. Alpha' });
    await addMember(doctor, alpha, 'doctor');
    const d = await loginAs(doctor, { app });
    for (const url of ['/api/payroll/runs', `/api/payroll/runs/${M}`]) expect((await d.get(url)).status, url).toBe(403);
    expect((await read(d)).status).toBe(403);
    const betaAccounts = await createUser({ name: 'Beta Accounts' });
    await addMember(betaAccounts, beta, 'accounts');
    const b = await loginAs(betaAccounts, { app });
    expect((await b.get(`/api/payroll/runs/${M}`)).body).toMatchObject({ files: [], unknownCodes: [], expected: 0, sheet: null });
    expect((await b.put(`/api/payroll/runs/${M}/corrections/${ids.S001}`).send({ paidDays: 3, reason: 'Not ours' })).status).toBe(404);
    // Support access open: patients are reachable for the super admin, the payroll month is not
    expect((await (await loginAs(admin, { app })).put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Wrong bill total for one patient' })).status).toBe(200);
    const root = await loginAs(await createSuperAdmin({ name: 'Super' }), { app });
    root.activeTenantId = (await root.agent.post('/api/auth/open-hospital').send({ tenantId: alpha._id.toString() })).body.activeTenantId;
    expect((await root.get('/api/patients')).status).toBe(200);
    for (const url of ['/api/payroll/runs', `/api/payroll/runs/${M}`]) {
      const res = await root.get(url);
      expect(res.status, url).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Sample Attendant');
    }
    expect((await read(root)).status).toBe(403);
    expect(LEFT_OUT.AttendanceFile).toMatch(/accounts login and the hospital admin/);
    expect(LEFT_OUT.PayrollRun).toBeTruthy();
    expect((await Tenant.findById(alpha._id)).toJSON()).not.toHaveProperty('payroll'); // the saved layouts too
  });

  it('the accounts login’s Today gets counts only – no name, no amount – and writes nothing in the audit log', async () => {
    const before = (await s.get(`/api/payroll/overview?month=${M}`)).body;
    expect(before).toMatchObject({ month: M, staff: { working: 5, left: 1, withoutPay: 1, withoutCode: 1 }, rules: { basisChosen: false, draft: true }, canChangeSettings: false, canKeepNumbers: true });
    expect(before.run).toMatchObject({ files: 0, expected: 5, codesToAnswer: 0, peopleToAnswer: 5, twoRows: 0, sheetReady: false, withoutSum: 0, locked: false });
    expect((await s.get('/api/payroll/overview')).body.month).toMatch(/^\d{4}-\d{2}$/); // left out: the month before this one
    expect((await s.get('/api/payroll/overview?month=nope')).status).toBe(400);
    await settle();
    const after = (await s.get(`/api/payroll/overview?month=${M}`)).body;
    expect(after.run).toMatchObject({ files: 1, expected: 5, codesToAnswer: 0, peopleToAnswer: 0, twoRows: 0, sheetReady: true, withoutSum: 1, locked: false });
    expect(after.rules).toEqual({ basisChosen: true, draft: true });
    expect(after.staff.withoutCode).toBe(0);
    expect(JSON.stringify(after)).not.toMatch(/Sample|Paise|1500000/);
    expect(await AuditLog.countDocuments({ action: { $in: ['PAYROLL_SHEET_VIEWED', 'PAYROLL_STAFF_LIST_VIEWED'] } })).toBe(0); // Today is not a view of the sheet
    expect((await (await loginAs(admin, { app })).get('/api/payroll/overview')).body.canChangeSettings).toBe(true);
    const doctor = await createUser({ name: 'Dr. Alpha' });
    await addMember(doctor, alpha, 'doctor');
    expect((await (await loginAs(doctor, { app })).get('/api/payroll/overview')).status).toBe(403);
  });

  it('a file is shown back and checked without being kept; Excel and a wrong layout are refused in plain words', async () => {
    const start = (await s.get(`/api/payroll/runs/${M}`)).body;
    expect(start).toMatchObject({ days: 31, expected: 5, sheet: null, blockers: ['basis', 'noRow'], rulesDraft: true });
    expect(start.noRow).toHaveLength(5);
    for (const month of ['2099-01', '2026-13', '2019-12']) expect((await s.get(`/api/payroll/runs/${month}`)).status, month).toBe(400);

    const shown = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'october.csv', content: b64(csv) });
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    expect(shown.body).toMatchObject({ delimiter: ',', totalRows: 10, columns: 33, check: null, file: { alreadyRead: false } });
    expect(shown.body.rows[2][1]).toBe('Attendant, Sample');
    const half = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'october.csv', content: b64(csv), layout: { ...layout, marks: { P: 'present', W: 'weeklyOff' } } });
    expect(half.body.check.unmapped.sort()).toEqual(['A', 'H', 'L', 'O']);
    expect(half.body.check.ready).toBe(false);
    const full = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'october.csv', content: b64(csv), layout });
    expect(full.body.check).toMatchObject({ ready: true, people: 7, unknownCodes: 2, skippedRows: 1, problems: [] });
    expect(full.body.check.sample[0]).toEqual({ code: 'A-17', name: 'Attendant, Sample', row: 3, counts: { present: 23, half: 1, weeklyOff: 4, holiday: 1, paidLeave: 1, unpaidLeave: 0, absent: 1 }, paidDaysGiven: null });
    const wrong = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'x.csv', content: b64(csv), layout: { ...layout, codeColumn: 0, firstDayColumn: 60 } });
    expect(wrong.body.check.fields).toMatchObject({ codeColumn: 'Choose the code column', firstDayColumn: expect.stringMatching(/run past the end/) });
    const excel = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'october.xlsx', content: Buffer.from([0x50, 0x4b, 3, 4, 20, 0]).toString('base64') });
    expect(excel.status).toBe(400);
    expect(excel.body.error).toMatchObject({ code: 'EXCEL_FILE', fields: { content: expect.stringMatching(/Save As/) } });
    expect((await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'x.csv', content: b64(csv), layout: { shape: 'grid' } })).body.error.fields['layout.shape']).toBe('Choose what kind of file this is');
    // A file a little under the limit is accepted by the address (more than the usual 100 kb of a request)
    const big = await s.post(`/api/payroll/runs/${M}/preview`).send({ fileName: 'big.csv', content: b64(`Code,Note\n${Array.from({ length: 4000 }, (_, i) => `K-${i},${'x'.repeat(120)}`).join('\n')}`) });
    expect(big.status, JSON.stringify(big.body).slice(0, 200)).toBe(200);
    expect(big.body.totalRows).toBe(4001);
    expect(await AttendanceFile.countDocuments({ tenantId: alpha._id })).toBe(0);
    expect(await PayrollRun.countDocuments({ tenantId: alpha._id })).toBe(0);
  });

  it('reads the file and keeps it; lists unknown codes and people with no row; the same file or code twice is refused', async () => {
    expect((await read(s, { layout: { ...layout, marks: { P: 'present' } } })).body.error.fields['layout.marks']).toMatch(/Say what these marks mean first/);
    expect((await read(s, { layout: null })).body.error.fields.layout).toBe('Choose the columns of this file first');
    const done = await read(s, { saveLayoutAs: 'Machine register' });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.files).toHaveLength(1);
    expect(done.body.files[0]).toMatchObject({ fileName: 'october.csv', shape: 'register', rows: 10, people: 7, readByName: 'Alpha Accounts', removed: null });
    expect(done.body.unknownCodes.map((c) => [c.code, c.name, c.row, c.fileName])).toEqual([['X-9', 'Guard Sample', 8, 'october.csv'], ['Y-1', 'Old Tester', 9, 'october.csv']]);
    expect(done.body.notThisMonth).toEqual([{ code: 'D-9', staffNumber: 'S005', name: 'Sample Driver', why: 'notEmployed' }]);
    expect(done.body.noRow.map((x) => x.staffNumber)).toEqual(['S003']);
    expect(done.body).toMatchObject({ blockers: ['basis', 'codes', 'noRow'], sheet: null });
    expect(done.body.layouts.map((l) => [l.name, l.layout.shape, l.layout.firstDayColumn, l.savedByName])).toEqual([['Machine register', 'register', 3, 'Alpha Accounts']]);
    expect(JSON.stringify(done.body)).not.toContain('bytes');

    // Kept: the bytes and their SHA-256 – never selected unless asked for
    const kept = await AttendanceFile.findOne({ tenantId: alpha._id }).select('+bytes').lean();
    expect(kept.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(kept.bytes.buffer ?? kept.bytes).toString('utf8')).toContain('Attendant, Sample');
    expect((await AttendanceFile.findOne({ tenantId: alpha._id }).lean()).bytes).toBeUndefined();
    const entry = await AuditLog.findOne({ action: 'PAYROLL_ATTENDANCE_READ', tenantId: alpha._id }).lean();
    expect(entry.details).toEqual({ month: M, fileName: 'october.csv', rows: 10, people: 7, unknown: 2 });

    const again = await read(s, { fileName: 'copy.csv' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_READ');
    const other = await s.post(`/api/payroll/runs/${M}/files`).send({ fileName: 'sheet.csv', content: b64('Code,Paid\nA-17,30\nQ-1,12'), layout: { shape: 'summary', headerRow: 1, codeColumn: 1, columns: { paidDays: 2 } } });
    expect(other.status).toBe(400);
    expect(other.body.error.fields.content).toMatch(/code A-17 was already read from another file/);
    expect(await AttendanceFile.countDocuments({ tenantId: alpha._id })).toBe(1);
  });

  it('a code is tied to a staff member or left out with a reason; then the sheet is made', async () => {
    expect((await (await loginAs(admin, { app })).put('/api/payroll/settings').send(rules())).status).toBe(200);
    expect((await read()).status).toBe(201);
    expect((await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1', leaveOut: true, reason: 'x' })).body.error.fields.reason).toBe('Say why this row is left out');
    expect((await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1' })).body.error.fields.staffId).toMatch(/Choose the staff member/);
    expect((await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'NOPE', leaveOut: true, reason: 'not here' })).status).toBe(404);
    expect((await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'X-9', staffId: ids.S005 })).status).toBe(404); // left before this month
    let state = (await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1', leaveOut: true, reason: 'A test card of the machine' })).body;
    expect(state.unknownCodes.find((c) => c.code === 'Y-1').leftOut).toMatchObject({ reason: 'A test card of the machine', byName: 'Alpha Accounts' });
    expect(state.blockers).toEqual(['codes', 'noRow']);
    state = (await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1', undo: true })).body;
    expect(state.unknownCodes.find((c) => c.code === 'Y-1').leftOut).toBeNull();
    await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'Y-1', leaveOut: true, reason: 'A test card of the machine' });
    state = (await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'X-9', staffId: ids.S003 })).body;
    expect((await StaffMember.findOne({ tenantId: alpha._id, staffNumber: 'S003' }).lean()).attendanceCodes).toEqual(['X-9']); // kept for next month
    expect(await AuditLog.exists({ action: 'PAYROLL_STAFF_CHANGED', tenantId: alpha._id, 'details.staffNumber': 'S003', 'details.fields': 'attendanceCodes' })).toBeTruthy();
    expect(state).toMatchObject({ blockers: [], noRow: [], basisDays: 31 });

    // The sheet: monthly pay × paid days ÷ basis days
    expect(state.sheet.people).toBe(5);
    expect(rowOf(state, 'S001')).toMatchObject({ fileDays: 29.5, paidDays: 29.5, monthlyPaise: 1500000, payPaise: 1427400, notes: [] });
    expect(rowOf(state, 'S002')).toMatchObject({ paidDays: 31, payPaise: 3250000, notes: [] });
    expect(rowOf(state, 'S003')).toMatchObject({ counts: { present: 24, absent: 3 }, paidDays: 28, payPaise: Math.round((1380000 * 28) / 31 / 100) * 100 });
    expect(rowOf(state, 'S004')).toMatchObject({ paidDays: 31, monthlyPaise: null, payPaise: null, notes: ['noPay'] });
    expect(rowOf(state, 'S006')).toMatchObject({ counts: { present: 14, weeklyOff: 2, absent: 0 }, paidDays: 16, payPaise: Math.round((1800000 * 16) / 31 / 100) * 100, notes: ['joined'] });
    expect(state.sheet.withoutPay).toBe(1);
    expect(state.sheet.payPaise).toBe(state.sheet.rows.reduce((t, r) => t + (r.payPaise ?? 0), 0));
    expect(state.sheet.rows.map((r) => r.staffNumber)).not.toContain('S005');
    // Opening the month with its sheet is in the audit log: the month and how many people – never an amount
    expect(await AuditLog.countDocuments({ action: 'PAYROLL_SHEET_VIEWED' })).toBe(0);
    await s.get(`/api/payroll/runs/${M}`);
    expect((await AuditLog.findOne({ action: 'PAYROLL_SHEET_VIEWED', tenantId: alpha._id }).lean()).details).toEqual({ month: M, people: 5 });

    // Other rules, another sum from the same days
    await (await loginAs(admin, { app })).put('/api/payroll/settings').send(rules({ dayBasis: 'twentySix', weeklyOffsPaid: false }));
    state = (await s.get(`/api/payroll/runs/${M}`)).body;
    expect(rowOf(state, 'S001')).toMatchObject({ paidDays: 25.5, payPaise: Math.round((1500000 * 25.5) / 26 / 100) * 100, notes: [] });
    expect(rowOf(state, 'S002')).toMatchObject({ paidDays: 27, payPaise: 3250000, notes: ['capped'] });
    expect((await s.get('/api/payroll/runs')).body.runs.map((r) => [r.month, r.status, r.updatedByName])).toEqual([[M, 'draft', 'Alpha Accounts']]);
  });

  it('a correction by hand needs a reason, stands beside the file’s figure and can be taken back; a file can be removed', async () => {
    let state = await settle();
    const url = (n) => `/api/payroll/runs/${M}/corrections/${ids[n]}`;
    expect((await s.put(url('S002')).send({ paidDays: 32, reason: 'too many' })).status).toBe(400);
    expect((await s.put(url('S002')).send({ paidDays: 25.3, reason: 'odd figure' })).body.error.fields.paidDays).toMatch(/whole, half or quarter/);
    expect((await s.put(url('S002')).send({ paidDays: 30, reason: 'x' })).body.error.fields.reason).toMatch(/Say why/);
    expect((await s.put(url('S005')).send({ paidDays: 3, reason: 'left in September' })).status).toBe(404);
    state = (await s.put(url('S001')).send({ paidDays: 30.5, reason: 'The machine was down on the 21st' })).body;
    expect(rowOf(state, 'S001')).toMatchObject({ fileDays: 29.5, paidDays: 30.5, payPaise: Math.round((1500000 * 30.5) / 31 / 100) * 100, correction: { reason: 'The machine was down on the 21st', byName: 'Alpha Accounts' } });
    state = (await s.put(url('S001')).send({ paidDays: 31, reason: 'Checked with the ward sister' })).body; // written again: the earlier one is replaced
    expect((await PayrollRun.findOne({ tenantId: alpha._id, month: M }).lean()).corrections).toHaveLength(1);
    expect(rowOf(state, 'S001').paidDays).toBe(31);
    expect((await AuditLog.findOne({ action: 'PAYROLL_DAYS_CORRECTED', tenantId: alpha._id }).sort({ createdAt: -1 }).lean()).details).toEqual({ month: M, staffId: ids.S001, staffNumber: 'S001', name: 'Sample Attendant' });
    state = (await s.delete(url('S001'))).body;
    expect(rowOf(state, 'S001')).toMatchObject({ correction: null, paidDays: 29.5 });

    // The file read by mistake: removed with a reason – its rows leave the month, the record stays
    const fileId = state.files[0].id;
    expect((await s.post(`/api/payroll/runs/${M}/files/${fileId}/remove`).send({ reason: '' })).body.error.fields.reason).toMatch(/Say why/);
    state = (await s.post(`/api/payroll/runs/${M}/files/${fileId}/remove`).send({ reason: 'The September file was chosen by mistake' })).body;
    expect(state.files[0].removed).toMatchObject({ reason: 'The September file was chosen by mistake', byName: 'Alpha Accounts' });
    expect((await PayrollRun.findOne({ tenantId: alpha._id, month: M }).lean()).read).toHaveLength(0);
    expect(await AttendanceFile.countDocuments({ tenantId: alpha._id })).toBe(1);
    expect(state).toMatchObject({ blockers: ['noRow'], sheet: null });
    expect(state.noRow).toHaveLength(5);
    expect((await s.post(`/api/payroll/runs/${M}/files/${fileId}/remove`).send({ reason: 'again' })).status).toBe(409);

    // A hospital with no file at all: every person's days typed by hand make the sheet
    for (const n of ['S001', 'S002', 'S003', 'S004', 'S006']) state = (await s.put(url(n)).send({ paidDays: n === 'S006' ? 16 : 31, reason: 'From the hand-kept register' })).body;
    expect(state.blockers).toEqual([]);
    expect(rowOf(state, 'S006')).toMatchObject({ paidDays: 16, notes: ['joined', 'noRow'] });
    expect(rowOf(state, 'S002').payPaise).toBe(3250000);
    // The same file can be read again once its first reading was removed
    expect((await read()).status).toBe(201);
    expect((await s.get(`/api/payroll/runs/${M}`)).body.sheet.people).toBe(5); // (opening the month with its sheet is audited)

    // The audit log: the month, a file's name and counts – never an amount; the super admin's readers get nothing
    const all = JSON.stringify(await AuditLog.find({ tenantId: alpha._id, action: /^PAYROLL_(SHEET|ATTENDANCE|CODE|DAYS)/ }).lean());
    for (const amount of ['1500000', '3250000', '1427400']) expect(all).not.toContain(amount);
    for (const action of ['PAYROLL_SHEET_VIEWED', 'PAYROLL_ATTENDANCE_READ', 'PAYROLL_ATTENDANCE_REMOVED', 'PAYROLL_CODE_LEFT_OUT', 'PAYROLL_DAYS_CORRECTED']) {
      expect(await AuditLog.exists({ action, tenantId: alpha._id }), action).toBeTruthy();
      expect(safeAuditDetails(action, { month: M, fileName: 'october.csv', rows: 10, people: 7, unknown: 2, code: 'Y-1', staffNumber: 'S001', name: 'Sample', removed: true, payPaise: 1 }, { scope: 'platform' }), action).toEqual({});
    }
    expect(safeAuditDetails('PAYROLL_ATTENDANCE_READ', { month: M, fileName: 'october.csv', rows: 10, people: 7, unknown: 2, payPaise: 1 })).toEqual({ month: M, fileName: 'october.csv', rows: 10, people: 7, unknown: 2 });
  });
});
