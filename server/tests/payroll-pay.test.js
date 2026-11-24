// Payroll, Stages C and D (docs/PAYROLL_BUILD_NOTE.md section 5 C and D): deductions from the rate table, advances,
// one person's month, the lock and its kept snapshot, reopening, payslips and the monthly lists.
// All fake sample data: made-up staff, made-up pay, made-up numbers. The rates used here are the DRAFT figures of the
// note – "confirmed" in a test by a made-up accountant, never a statement that they are right.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { LEFT_OUT } from '../src/export/hospitalExport.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PayrollRun } from '../src/models/PayrollRun.js';
import { StaffMember } from '../src/models/StaffMember.js';
import { Tenant } from '../src/models/Tenant.js';
import { DRAFT_RATES, advanceBalance, earnedParts, monthTotals, nextRateGroup, payOf, professionalTax, rateIsDraft, ratesFor, ratesWithDefaults, slabProblem } from '../src/payroll/payrollDeductions.js';
import { listIsFull, listRows, listsFor, recoveriesOf, snapshotOf } from '../src/payroll/payrollLists.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
const M = '2026-10'; // 31 days
const PAN = 'ABCDE1234F';
const UAN = '100200300400';
const ESI = '3100200300';
const ACCOUNT = '00112233445566';

const SETTINGS = { parts: [{ key: 'basic', name: 'Basic pay', countsForPf: true, countsForEsi: true }, { key: 'hra', name: 'HRA', countsForPf: false, countsForEsi: true }] };
// One row of the sheet as payrollMath.js sheetRow makes it: ₹15,000 a month (12,000 + 3,000), 29.5 of 31 days → ₹14,274
const ROW = { payPaise: 1427400, monthlyPaise: 1500000, parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300000 }] };
const ALL = { pf: true, esi: true, pt: true };
const NONE = { pf: false, esi: false, pt: false };

describe('payroll: the rate table (pure)', () => {
  it('starts with the DRAFT figures of the note, and stays DRAFT until a name and a date are written', () => {
    const rates = ratesWithDefaults(undefined);
    expect(rates.pf).toMatchObject({ staffPercent: 12, employerPercent: 12, limitPaise: 1500000, capAtLimit: true, status: 'draft' });
    expect(rates.esi).toMatchObject({ staffPercent: 0.75, employerPercent: 3.25, limitPaise: 2100000, status: 'draft' });
    expect(rates.pt.slabs.men).toEqual(DRAFT_RATES.pt.slabs.men);
    expect(rateIsDraft(rates.pf, M)).toBe(true);
    const some = ratesWithDefaults({ pf: { staffPercent: 10, status: 'confirmed', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-04-01' }, esi: { status: 'confirmed' } });
    expect(some.pf).toMatchObject({ staffPercent: 10, employerPercent: 12, status: 'confirmed', from: '2026-04-01' }); // a figure not saved keeps the DRAFT one
    expect(some.esi.status).toBe('draft'); // "confirmed" with no name and no date is not confirmed
    expect(rateIsDraft(some.pf, M)).toBe(false);
    expect(rateIsDraft(some.pf, '2026-03')).toBe(true); // before the date the figures apply from
  });

  it('keeps the figures confirmed before in force for their months – a rate change never rewrites an old month', () => {
    const by = { status: 'confirmed', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' };
    const figures = { staffPercent: 12, employerPercent: 12, limitPaise: 1500000, capAtLimit: true };
    const start = ratesWithDefaults({ pf: { ...figures, ...by, from: '2026-04-01' } });
    // a new confirmation from a later day: the old set moves to `earlier`
    const later = nextRateGroup(start.pf, { ...figures, staffPercent: 10, ...by, from: '2026-11-01' });
    expect(later.earlier.map((e) => [e.staffPercent, e.from])).toEqual([[12, '2026-04-01']]);
    const table = ratesWithDefaults({ pf: later });
    expect(ratesFor(table, '2026-10').pf).toMatchObject({ staffPercent: 12, status: 'confirmed', from: '2026-04-01' });
    expect(ratesFor(table, '2026-11').pf).toMatchObject({ staffPercent: 10, from: '2026-11-01' });
    expect(rateIsDraft(ratesFor(table, '2026-03').pf, '2026-03')).toBe(true); // before any confirmed figure
    expect(ratesFor(table, '2026-10').pf).not.toHaveProperty('earlier');
    // typed without the tick: kept as DRAFT, used by no month while confirmed figures are in force
    const typed = nextRateGroup(table.pf, { ...figures, staffPercent: 11, status: 'draft', confirmedBy: '', confirmedOn: null, from: null });
    expect(typed.earlier.map((e) => e.staffPercent)).toEqual([12, 10]);
    expect(ratesFor(ratesWithDefaults({ pf: typed }), '2026-12').pf.staffPercent).toBe(10);
    // confirmed for the same day: a correction, in the place of the 10 %; from an earlier day than everything: one set
    const fixed = nextRateGroup(ratesWithDefaults({ pf: typed }).pf, { ...figures, staffPercent: 11, ...by, from: '2026-11-01' });
    expect(fixed.earlier.map((e) => e.staffPercent)).toEqual([12]);
    expect(nextRateGroup(ratesWithDefaults({ pf: fixed }).pf, { ...figures, ...by, from: '2026-01-01' }).earlier).toEqual([]);
  });

  it('checks a table of slabs: rising, and the last row for everything above', () => {
    expect(slabProblem(DRAFT_RATES.pt.slabs.men)).toBeNull();
    expect(slabProblem([])).toMatch(/at least one/);
    expect(slabProblem([{ upToPaise: 100, amountPaise: 0 }])).toMatch(/last row/);
    expect(slabProblem([{ upToPaise: 500, amountPaise: 0 }, { upToPaise: 400, amountPaise: 1 }, { upToPaise: null, amountPaise: 2 }])).toMatch(/higher than the one before/);
  });
});

describe('payroll: from the pay for the month to the take-home (pure)', () => {
  const rates = ratesWithDefaults(undefined);
  const of = (o = {}) => payOf({ row: ROW, applies: NONE, ptSlab: '', settings: SETTINGS, rates, month: M, ...o });

  it('reduces every part alike, and the parts always add up to the pay for the month', () => {
    expect(earnedParts(ROW.parts, 1500000, 1500000)).toEqual(ROW.parts);
    expect(earnedParts(ROW.parts, 1500000, 1427400)).toEqual([{ key: 'basic', amountPaise: 1141920 }, { key: 'hra', amountPaise: 285480 }]);
    const odd = earnedParts([{ key: 'a', amountPaise: 100000 }, { key: 'b', amountPaise: 100000 }, { key: 'c', amountPaise: 100001 }], 300001, 100000);
    expect(odd.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(100000);
    expect(earnedParts([], 0, 0)).toEqual([]);
  });

  it('looks professional tax up by slab; February changes the top slab only', () => {
    const pt = rates.pt;
    expect([700000, 750000, 750100, 1000000, 1000100].map((gross) => professionalTax(gross, 'men', M, pt))).toEqual([0, 0, 17500, 17500, 20000]);
    expect(professionalTax(1000100, 'men', '2026-02', pt)).toBe(30000);
    expect(professionalTax(900000, 'men', '2026-02', pt)).toBe(17500);
    expect(professionalTax(2500000, 'women', M, pt)).toBe(0);
    expect(professionalTax(2500100, 'women', '2026-02', pt)).toBe(30000);
    expect(professionalTax(1500000, '', M, pt)).toBeNull(); // no slab chosen: not worked out
  });

  it('takes PF, ESI, professional tax and TDS, and says which DRAFT rates it used', () => {
    // PF 12% of the earned basic 11,419.20 → ₹1,370; ESI 0.75% of 14,274 → ₹107; professional tax ₹200; TDS ₹500 as typed
    const p = of({ applies: ALL, ptSlab: 'men', tdsPaise: 50000 });
    expect(p).toMatchObject({ pfWagesPaise: 1141920, pfPaise: 137000, pfEmployerPaise: 137000, esiWagesPaise: 1427400, esiPaise: 10700, esiEmployerPaise: 46400, ptPaise: 20000, tdsPaise: 50000, deductionsPaise: 217700, takeHomePaise: 1209700, notes: [], draftRates: ['pf', 'esi', 'pt'] });
    expect(of()).toMatchObject({ takeHomePaise: 1427400, draftRates: [] }); // nothing applies: nothing taken, no rate used
    expect(of({ applies: ALL, ptSlab: '' }).notes).toEqual(['ptSlabMissing']);
    expect(payOf({ row: { payPaise: null }, applies: ALL, ptSlab: 'men', settings: SETTINGS, rates, month: M })).toBeNull();
  });

  it('keeps PF to the pay limit when the table says so, and marks ESI pay above its limit', () => {
    const high = { payPaise: 2500000, monthlyPaise: 2500000, parts: [{ key: 'basic', amountPaise: 2000000 }, { key: 'hra', amountPaise: 500000 }] };
    expect(payOf({ row: high, applies: ALL, ptSlab: 'women', settings: SETTINGS, rates, month: M })).toMatchObject({ pfPaise: 180000, ptPaise: 0, notes: ['esiAboveLimit'] });
    expect(payOf({ row: high, applies: ALL, ptSlab: 'women', settings: SETTINGS, rates: { ...rates, pf: { ...rates.pf, capAtLimit: false } }, month: M }).pfPaise).toBe(240000);
  });

  it('adds and takes off one-off lines, and takes advances back last – never below zero', () => {
    const lines = [{ kind: 'addition', label: 'Arrear for September', amountPaise: 100000 }, { kind: 'deduction', label: 'Uniform', amountPaise: 30000 }];
    expect(of({ lines })).toMatchObject({ additionsPaise: 100000, otherDeductionsPaise: 30000, takeHomePaise: 1497400 });
    const advances = [{ id: 'a1', instalmentPaise: 200000, balancePaise: 150000 }, { id: 'a2', instalmentPaise: 300000, balancePaise: 900000, thisMonthPaise: 100000 }];
    expect(of({ advances })).toMatchObject({ recoveries: [{ advanceId: 'a1', amountPaise: 150000 }, { advanceId: 'a2', amountPaise: 100000 }], takeHomePaise: 1177400, notes: [] });
    const small = { ...ROW, payPaise: 100000 };
    expect(payOf({ row: small, applies: NONE, ptSlab: '', settings: SETTINGS, rates, month: M, advances })).toMatchObject({ recoveries: [{ advanceId: 'a1', amountPaise: 100000 }], takeHomePaise: 0, notes: ['advanceShort'] });
    expect(payOf({ row: small, applies: NONE, ptSlab: '', settings: SETTINGS, rates, month: M, tdsPaise: 200000, advances })).toMatchObject({ recoveries: [], takeHomePaise: 0, notes: ['overDeducted', 'advanceShort'] });
    expect(advanceBalance({ amountPaise: 1000000, recovered: [{ amountPaise: 200000 }, { amountPaise: 200000 }] })).toBe(600000);
    expect(advanceBalance({ amountPaise: 1000, recovered: [{ amountPaise: 5000 }] })).toBe(0);
  });

  it('keeps a locked month whole, and makes the lists from it with numbers by their last four', () => {
    const named = (parts) => parts.map((p) => ({ ...p, name: p.key === 'basic' ? 'Basic pay' : 'HRA' }));
    const pay = of({ applies: ALL, ptSlab: 'men', advances: [{ id: 'a1', instalmentPaise: 100000, balancePaise: 500000 }] });
    const rows = [{ staffId: 's1', staffNumber: 'S001', name: 'Sample Attendant', designation: 'Ward attendant', paidDays: 29.5, ...ROW, parts: named(ROW.parts), applies: ALL, ptSlab: 'men', pay: { ...pay, earned: named(pay.earned) } }, { staffId: 's2', staffNumber: 'S002', name: 'Sample Cleaner', pay: null }];
    const staffById = new Map([['s1', { department: 'Housekeeping', joinedOn: new Date('2025-04-01T00:00:00Z'), uan: { enc: 'v1.sealed', last4: '0400' }, esiNumber: { enc: 'v1.sealed', last4: '0300' }, pan: { enc: 'v1.sealed', last4: '234F' }, bank: { accountNumber: { enc: 'v1.sealed', last4: '5566' }, bankName: 'Sample Bank' } }]]);
    const snapshot = snapshotOf({ month: M, version: 1, rows, staffById, settings: SETTINGS, rates, basisDays: 31, hospitalName: 'Sample Hospital', byName: 'Sample Accounts', at: new Date('2026-11-24T06:00:00Z') });
    expect(snapshot.rows[0]).toMatchObject({ department: 'Housekeeping', joinedOn: '2025-04-01', numbers: { uan: '0400', esiNumber: '0300', pan: '234F', accountNumber: '5566' }, bankName: 'Sample Bank' });
    expect(JSON.stringify(snapshot)).not.toContain('sealed'); // the sealed text of a number is never kept in a snapshot
    expect(snapshot.totals).toEqual(monthTotals(rows));
    expect(recoveriesOf(snapshot.rows)).toEqual([{ advanceId: 'a1', amountPaise: 100000 }]);
    const register = listRows('register', snapshot);
    expect(register[0].slice(0, 9)).toEqual(['Staff number', 'Name', 'Designation', 'Department', 'Paid days', 'Monthly pay', 'Basic pay', 'HRA', 'Pay for the month']);
    expect(register[1]).toEqual(['S001', 'Sample Attendant', 'Ward attendant', 'Housekeeping', '29.5', '15000.00', '11419.20', '2854.80', '14274.00', '0.00', '1370.00', '107.00', '200.00', '0.00', '0.00', '1000.00', '2677.00', '11597.00', '1370.00', '464.00']);
    expect(register).toHaveLength(3); // the headings, the one person with a sum, the totals
    expect(listRows('pf', snapshot)[1]).toEqual(['S001', 'Sample Attendant', '…0400', '11419.20', '1370.00', '1370.00']);
    expect(listRows('esi', snapshot)[1]).toEqual(['S001', 'Sample Attendant', '…0300', '29.5', '14274.00', '107.00', '464.00']);
    expect(listRows('pt', snapshot)[1]).toEqual(['S001', 'Sample Attendant', 'Men', '14274.00', '200.00']);
    // Numbers in full only when the route passes them in – which it does only where the hospital admin switched it on
    expect(listRows('bank', snapshot)).toBeNull();
    expect(listsFor({ bankList: false })).toEqual(['register', 'pf', 'esi', 'pt']);
    expect(listsFor({ bankList: true })).toEqual(['register', 'pf', 'esi', 'pt', 'bank']);
    expect([listIsFull('bank', { bankList: true }), listIsFull('pf', { bankList: true }), listIsFull('pf', { fullNumbers: true }), listIsFull('register', { fullNumbers: true, bankList: true })]).toEqual([true, false, true, false]);
    const full = new Map([['s1', { uan: '100200300400', esiNumber: '3100200300', accountNumber: '00112233445566', ifsc: 'HDFC0001234', bankName: 'Sample Bank' }]]);
    expect(listRows('bank', snapshot, full)).toEqual([['Staff number', 'Name', 'Bank', 'IFSC', 'Account number', 'Amount'], ['S001', 'Sample Attendant', 'Sample Bank', 'HDFC0001234', '00112233445566', '11597.00'], ['', 'Total', '', '', '', '11597.00']]);
    expect(listRows('pf', snapshot, full).slice(0, 2).map((r) => r[2])).toEqual(['PF number (UAN)', '100200300400']);
    expect(listRows('esi', snapshot, full)[1][2]).toBe('3100200300');
    expect(JSON.stringify(listRows('register', snapshot, full))).not.toContain('100200300400'); // the register never carries a number
  });
});

describe('payroll: from the salary sheet to the locked month', () => {
  let alpha;
  let beta;
  let admin;
  let accounts;
  let s; // the accounts login's session
  let a; // the hospital admin's session
  let ids; // staff number → id
  const pay = (basic, hra, flags = {}, tdsPaise = 0) => ({ from: '2025-04-01', parts: [{ key: 'basic', amountPaise: basic * 100 }, ...(hra ? [{ key: 'hra', amountPaise: hra * 100 }] : [])], pf: false, esi: false, pt: false, tdsPaise, ...flags });
  const person = (staffNumber, name, overrides = {}) => ({ staffNumber, name, joinedOn: '2025-04-01', attendanceCodes: [], ...overrides });
  const rowOf = (state, staffNumber) => state.sheet.rows.find((r) => r.staffNumber === staffNumber);
  const month = async (session = s, m = M) => (await session.get(`/api/payroll/runs/${m}`)).body;
  const rules = (overrides = {}) => ({ ...SETTINGS, dayBasis: 'calendar', weeklyOffsPaid: true, holidaysPaid: true, rounding: 'nearest', confirmedBy: '', confirmedOn: null, ...overrides });
  const BY = { confirmed: true, confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-04-01' };
  const PF = { staffPercent: 12, employerPercent: 12, limitPaise: 1500000, capAtLimit: true };
  const ESI_RATE = { staffPercent: 0.75, employerPercent: 3.25, limitPaise: 2100000 };
  const PT = { slabs: { men: [{ upToPaise: 750000, amountPaise: 0 }, { upToPaise: 1000000, amountPaise: 17500 }, { upToPaise: null, amountPaise: 20000 }], women: [{ upToPaise: 2500000, amountPaise: 0 }, { upToPaise: null, amountPaise: 20000 }] }, februaryPaise: 30000 };

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
    a = await loginAs(admin, { app });
    expect((await a.put('/api/payroll/settings').send(rules())).status).toBe(200);
    ids = {};
    for (const p of [
      person('S001', 'Sample Attendant', { designation: 'Ward attendant', department: 'Housekeeping', ptSlab: 'men', pay: pay(12000, 3000, { pf: true, esi: true, pt: true }), bank: { ifsc: 'HDFC0001234', bankName: 'Sample Bank' }, numbers: { pan: PAN, uan: UAN, esiNumber: ESI, accountNumber: ACCOUNT } }),
      person('S002', 'Sample Nurse', { ptSlab: 'women', pay: pay(20000, 5000, { pf: true, pt: true }, 50000) }),
      person('S003', 'Sample Guard', { pay: pay(13800, 0) }),
      person('S004', 'Sample Cleaner'), // no pay entered yet
    ]) {
      const made = await s.post('/api/payroll/staff').send(p);
      if (made.status !== 201) throw new Error(`staff not made: ${JSON.stringify(made.body)}`);
      ids[p.staffNumber] = made.body.staff.id;
    }
    // The days of October, written by hand (reading a file is payroll-run.test.js)
    for (const [number, paidDays] of [['S001', 29.5], ['S002', 31], ['S003', 31], ['S004', 31]]) {
      expect((await s.put(`/api/payroll/runs/${M}/corrections/${ids[number]}`).send({ paidDays, reason: 'From the hand-kept register' })).status).toBe(200);
    }
  });
  afterAll(disconnectTestDb);

  /** Everything the lock waits for: the rules and the three groups of rates confirmed, and pay for the fourth person. */
  const makeReady = async () => {
    expect((await a.put('/api/payroll/settings').send(rules({ confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' }))).status).toBe(200);
    for (const [group, body] of [['pf', PF], ['esi', ESI_RATE], ['pt', PT]]) expect((await a.put(`/api/payroll/rates/${group}`).send({ ...body, ...BY })).status, group).toBe(200);
    const cleaner = (await s.get(`/api/payroll/staff/${ids.S004}`)).body.staff;
    expect((await s.put(`/api/payroll/staff/${ids.S004}`).send({ staffNumber: cleaner.staffNumber, name: cleaner.name, joinedOn: cleaner.joinedOn, pay: pay(11000, 0) })).status).toBe(200);
  };
  const giveAdvance = async () => {
    const made = await s.post('/api/payroll/advances').send({ staffId: ids.S003, givenOn: '2026-10-05', amountPaise: 1000000, instalmentPaise: 200000, recoverFrom: M, note: 'Festival advance' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.advances[0].id;
  };

  it('an open month is worked out with the DRAFT rates, says so, and can’t be locked', async () => {
    const state = await month();
    expect(state).toMatchObject({ status: 'draft', locked: null, blockers: [], draft: true, draftRates: ['pf', 'esi', 'pt'], lockBlockers: ['rules', 'rate-pf', 'rate-esi', 'rate-pt', 'noPay'] });
    // 15,000 × 29.5 ÷ 31 → ₹14,274: basic 11,419.20 and HRA 2,854.80; PF ₹1,370, ESI ₹107, professional tax ₹200
    expect(rowOf(state, 'S001')).toMatchObject({ payPaise: 1427400, applies: ALL, ptSlab: 'men', month: { tds: null, entryTdsPaise: 0, lines: [], advances: [] } });
    expect(rowOf(state, 'S001').pay).toMatchObject({ earned: [{ key: 'basic', name: 'Basic pay', amountPaise: 1141920 }, { key: 'hra', name: 'HRA', amountPaise: 285480 }], pfPaise: 137000, pfEmployerPaise: 137000, esiPaise: 10700, esiEmployerPaise: 46400, ptPaise: 20000, takeHomePaise: 1259700 });
    // basic 20,000: PF on the limit of 15,000; women's slab: nil up to 25,000; TDS ₹500 as typed on the pay entry
    expect(rowOf(state, 'S002').pay).toMatchObject({ pfPaise: 180000, ptPaise: 0, tdsPaise: 50000, takeHomePaise: 2500000 - 230000 });
    expect(rowOf(state, 'S004').pay).toBeNull();
    expect(state.sheet.totals.takeHomePaise).toBe(1259700 + 2270000 + 1380000);

    const refused = await s.post(`/api/payroll/runs/${M}/lock`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'NOT_READY', details: { lockBlockers: state.lockBlockers } });
    expect((await s.get(`/api/payroll/runs/${M}/lists/register`)).body.error.code).toBe('NOT_LOCKED');

    // Payslips of an open month: every page DRAFT, the four numbers by their last four characters only
    const slips = await s.get(`/api/payroll/runs/${M}/payslips`);
    expect(slips.body).toMatchObject({ draft: true, version: null, hospitalName: 'Alpha Hospital' });
    expect(slips.body.rows).toHaveLength(3); // the person without pay has no payslip
    expect(slips.body.rows.find((r) => r.staffNumber === 'S001')).toMatchObject({ department: 'Housekeeping', bankName: 'Sample Bank', numbers: { uan: '0400', esiNumber: '0300', pan: '234F', accountNumber: '5566' } });
    for (const full of [PAN, UAN, ESI, ACCOUNT]) expect(slips.text).not.toContain(full);
    expect(slips.text).not.toContain('"enc"');
    expect((await AuditLog.findOne({ action: 'PAYROLL_PAYSLIPS_PRINTED', tenantId: alpha._id }).lean()).details).toEqual({ month: M, people: 3, draft: true });

    // A person saved before the slab was asked for: professional tax is not worked out, and the lock waits for it
    await StaffMember.updateOne({ _id: ids.S002, tenantId: alpha._id }, { $set: { ptSlab: '' } });
    const waiting = await month();
    expect(rowOf(waiting, 'S002').pay.notes).toEqual(['ptSlabMissing']);
    expect(waiting.lockBlockers).toContain('ptSlab');
    // … and from now on a pay entry that takes professional tax asks for the slab
    const noSlab = await s.post('/api/payroll/staff').send(person('S009', 'Sample Porter', { pay: pay(9000, 0, { pt: true }) }));
    expect(noSlab.status).toBe(400);
    expect(noSlab.body.error.fields.ptSlab).toMatch(/slab/);
  });

  it('the rate table: read by accounts, changed and confirmed by the hospital admin only', async () => {
    const seen = await s.get('/api/payroll/rates');
    expect(seen.body).toMatchObject({ canChange: false, rates: { pf: { status: 'draft', staffPercent: 12 }, esi: { status: 'draft', staffPercent: 0.75 }, pt: { status: 'draft' } } });
    expect((await s.put('/api/payroll/rates/pf').send(PF)).status).toBe(403);
    expect((await a.put('/api/payroll/rates/gratuity').send(PF)).status).toBe(400);
    // The tick alone is not a confirmation: who, when, and from which date
    const bare = await a.put('/api/payroll/rates/pf').send({ ...PF, confirmed: true });
    expect(bare.status).toBe(400);
    expect(Object.keys(bare.body.error.fields).sort()).toEqual(['confirmedBy', 'confirmedOn', 'from']);
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, ...BY, confirmedOn: '2099-01-01' })).body.error.fields.confirmedOn).toMatch(/future/);
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, staffPercent: 12.345 })).body.error.fields.staffPercent).toMatch(/two decimals/);
    expect((await a.put('/api/payroll/rates/pt').send({ ...PT, slabs: { ...PT.slabs, men: [{ upToPaise: 750000, amountPaise: 0 }] } })).body.error.fields['slabs.men']).toMatch(/last row/);

    // Confirmed, but only from November on: October still uses it as DRAFT
    const late = await a.put('/api/payroll/rates/pf').send({ ...PF, ...BY, from: '2026-11-01' });
    expect(late.body).toMatchObject({ changed: true, rates: { pf: { status: 'confirmed', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-11-01' } } });
    expect((await month()).lockBlockers).toContain('rate-pf');
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, ...BY })).body.rates.pf.from).toBe('2026-04-01');
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, ...BY })).body.changed).toBe(false);
    expect((await month()).lockBlockers).not.toContain('rate-pf');
    // A figure changed without the tick: DRAFT again, and the old confirmation is not kept beside the new figure
    const again = await a.put('/api/payroll/rates/pf').send({ ...PF, staffPercent: 10, confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-04-01' });
    expect(again.body.rates.pf).toMatchObject({ staffPercent: 10, status: 'draft', confirmedBy: '', confirmedOn: null, from: null });
    // … and the figures confirmed before stay in force: October is still worked out with them
    expect(again.body.rates.pf.earlier.map((e) => [e.staffPercent, e.from])).toEqual([[12, '2026-04-01']]);
    const october = await month();
    expect(october.rates.pf).toMatchObject({ staffPercent: 12, status: 'confirmed' });
    expect(october.lockBlockers).not.toContain('rate-pf');

    const log = await AuditLog.find({ action: 'PAYROLL_RATES_CHANGED', tenantId: alpha._id }).sort({ createdAt: 1 }).lean();
    expect(log.map((e) => e.details)).toEqual([{ group: 'pf', confirmed: true }, { group: 'pf', confirmed: true }, { group: 'pf', confirmed: false }]); // which group – never a figure
    expect((await Tenant.findById(alpha._id)).toJSON()).not.toHaveProperty('payroll'); // the rates leave only through the payroll routes
  });

  it('advances, and one person’s month: TDS for the month, one-off lines, an instalment changed', async () => {
    const advance = { staffId: ids.S003, givenOn: '2026-10-05', amountPaise: 1000000, instalmentPaise: 200000, recoverFrom: M, note: 'Festival advance' };
    const wrong = await s.post('/api/payroll/advances').send({ ...advance, givenOn: '2099-12-01', instalmentPaise: 1200000, recoverFrom: '2026-09' });
    expect(wrong.status).toBe(400);
    expect(Object.keys(wrong.body.error.fields).sort()).toEqual(['givenOn', 'instalmentPaise', 'recoverFrom']);
    expect((await s.post('/api/payroll/advances').send({ ...advance, note: 'Aadhaar 2345 6789 0123' })).body.error.fields.note).toMatch(/Aadhaar/);
    const advanceId = await giveAdvance();
    const list = (await s.get('/api/payroll/advances')).body;
    expect(list).toMatchObject({ openPaise: 1000000, advances: [{ staffNumber: 'S003', name: 'Sample Guard', givenOn: '2026-10-05', amountPaise: 1000000, instalmentPaise: 200000, recoverFrom: M, months: [], balancePaise: 1000000, stopped: null, createdByName: 'Alpha Accounts' }] });
    expect(rowOf(await month(), 'S003').pay).toMatchObject({ recoveries: [{ advanceId, amountPaise: 200000 }], takeHomePaise: 1180000 });
    // Stopped with a reason: nothing more is taken back; started again
    expect((await s.put(`/api/payroll/advances/${advanceId}`).send({ instalmentPaise: 200000, recoverFrom: M, note: 'Festival advance', stopped: true })).body.error.fields.stopReason).toMatch(/why/);
    expect((await s.put(`/api/payroll/advances/${advanceId}`).send({ instalmentPaise: 250000, recoverFrom: M, note: 'Festival advance', stopped: true, stopReason: 'Entered twice' })).body).toMatchObject({ openPaise: 0, advances: [{ stopped: { reason: 'Entered twice', byName: 'Alpha Accounts' } }] });
    expect(rowOf(await month(), 'S003').month.advances).toEqual([]);
    expect((await s.put(`/api/payroll/advances/${advanceId}`).send({ instalmentPaise: 200000, recoverFrom: M, note: 'Festival advance', stopped: false })).body.advances[0]).toMatchObject({ stopped: null, instalmentPaise: 200000 });
    expect((await AuditLog.find({ action: 'PAYROLL_ADVANCE_CHANGED', tenantId: alpha._id }).sort({ createdAt: 1 }).lean()).map((e) => e.details.fields)).toEqual([['instalment', 'stopped'], ['instalment', 'stopped']]);

    const url = `/api/payroll/runs/${M}/people/${ids.S003}`;
    expect((await s.put(url).send({ instalments: [{ advanceId, amountPaise: 100000 }] })).body.error.fields['instalments.0.reason']).toMatch(/why/);
    expect((await s.put(`/api/payroll/runs/${M}/people/${ids.S001}`).send({ instalments: [{ advanceId, amountPaise: 100000, reason: 'Asked for less' }] })).body.error.fields['instalments.0.advanceId']).toMatch(/not being taken back/); // another person's advance
    expect((await s.put(url).send({ instalments: [{ advanceId, amountPaise: 1100000, reason: 'All at once' }] })).body.error.fields['instalments.0.amountPaise']).toMatch(/more than what is left/);
    expect((await s.put(url).send({ lines: [{ kind: 'addition', label: '2345 6789 0123', amountPaise: 100 }] })).body.error.fields['lines.0.label']).toMatch(/Aadhaar/);
    expect((await s.put(url).send({ lines: [{ kind: 'bonus', label: 'Diwali', amountPaise: 100 }] })).status).toBe(400);

    const mine = { tdsPaise: 50000, lines: [{ kind: 'addition', label: 'Arrear for September', amountPaise: 100000 }, { kind: 'deduction', label: 'Uniform', amountPaise: 30000 }], instalments: [{ advanceId, amountPaise: 100000, reason: 'Asked for less this month' }] };
    const saved = await s.put(url).send(mine);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // 13,800 + 1,000 arrear − 500 TDS − 300 uniform − 1,000 advance = 13,000
    expect(rowOf(saved.body, 'S003').pay).toMatchObject({ grossPaise: 1380000, additionsPaise: 100000, tdsPaise: 50000, otherDeductionsPaise: 30000, advancePaise: 100000, takeHomePaise: 1300000 });
    expect(rowOf(saved.body, 'S003').month).toMatchObject({ tds: { tdsPaise: 50000, byName: 'Alpha Accounts' }, advances: [{ thisMonth: { amountPaise: 100000, reason: 'Asked for less this month', byName: 'Alpha Accounts' } }] });
    expect((await s.put(url).send(mine)).status).toBe(200); // the same again: nothing written
    expect(await AuditLog.countDocuments({ action: 'PAYROLL_MONTH_ADJUSTED', tenantId: alpha._id })).toBe(1);
    // The admin adds a line: what was typed before keeps who typed it
    const more = await a.put(url).send({ ...mine, lines: [...mine.lines, { kind: 'deduction', label: 'Lost torch', amountPaise: 20000 }] });
    expect(rowOf(more.body, 'S003').month.lines.map((l) => [l.label, l.byName])).toEqual([['Arrear for September', 'Alpha Accounts'], ['Uniform', 'Alpha Accounts'], ['Lost torch', 'Alpha Admin']]);
    expect(rowOf(more.body, 'S003').month.tds.byName).toBe('Alpha Accounts');
    const log = await AuditLog.find({ action: 'PAYROLL_MONTH_ADJUSTED', tenantId: alpha._id }).sort({ createdAt: 1 }).lean();
    expect(log.map((e) => e.details)).toEqual([{ month: M, staffId: ids.S003, staffNumber: 'S003', name: 'Sample Guard', fields: ['tds', 'lines', 'instalments'] }, { month: M, staffId: ids.S003, staffNumber: 'S003', name: 'Sample Guard', fields: ['lines'] }]);
    // TDS for the month: 0 is a figure; the box emptied goes back to the pay entry's
    expect(rowOf((await s.put(`/api/payroll/runs/${M}/people/${ids.S002}`).send({ tdsPaise: 0 })).body, 'S002').pay.tdsPaise).toBe(0);
    expect(rowOf((await s.put(`/api/payroll/runs/${M}/people/${ids.S002}`).send({})).body, 'S002')).toMatchObject({ pay: { tdsPaise: 50000 }, month: { tds: null } });
  });

  it('locks the month into a kept snapshot; payslips and lists come from it; the admin reopens it with a reason', async () => {
    const advanceId = await giveAdvance();
    expect((await s.put(`/api/payroll/runs/${M}/people/${ids.S003}`).send({ tdsPaise: 50000, lines: [{ kind: 'addition', label: 'Arrear for September', amountPaise: 100000 }, { kind: 'deduction', label: 'Uniform', amountPaise: 30000 }], instalments: [{ advanceId, amountPaise: 100000, reason: 'Asked for less this month' }] })).status).toBe(200);
    await makeReady();
    const open = await month();
    expect(open).toMatchObject({ lockBlockers: [], draft: false, draftRates: [] });

    const locked = await s.post(`/api/payroll/runs/${M}/lock`);
    expect(locked.status, JSON.stringify(locked.body)).toBe(200);
    expect(locked.body).toMatchObject({ status: 'locked', locked: { version: 1, byName: 'Alpha Accounts' }, versions: [{ version: 1, people: 4, replaced: null }], downloads: [] });
    expect(locked.body.sheet.totals).toEqual(open.sheet.totals);
    expect(rowOf(locked.body, 'S001').numbers).toEqual({ uan: '0400', esiNumber: '0300', pan: '234F', accountNumber: '5566' });
    const kept = await PayrollRun.findOne({ tenantId: alpha._id, month: M }).lean();
    expect(kept.recovered.map((r) => [String(r.advanceId), r.amountPaise])).toEqual([[advanceId, 100000]]);
    expect(kept.versions[0].snapshot).toMatchObject({ hospitalName: 'Alpha Hospital', rates: { pf: { status: 'confirmed', confirmedBy: 'Sample Accountant' } }, settings: { confirmedBy: 'Sample Accountant' } });
    for (const full of [PAN, UAN, ESI, ACCOUNT]) expect(JSON.stringify(kept)).not.toContain(full);
    expect(JSON.stringify(kept)).not.toContain('"enc"'); // last fours only – never the sealed text

    // A locked month takes no change …
    const refusals = [
      await s.put(`/api/payroll/runs/${M}/corrections/${ids.S003}`).send({ paidDays: 30, reason: 'Late correction' }),
      await s.delete(`/api/payroll/runs/${M}/corrections/${ids.S003}`),
      await s.post(`/api/payroll/runs/${M}/codes`).send({ code: 'X-1', leaveOut: true, reason: 'Nobody' }),
      await s.put(`/api/payroll/runs/${M}/people/${ids.S003}`).send({}),
      await a.post(`/api/payroll/runs/${M}/lock`),
    ];
    for (const res of refusals) expect([res.status, res.body.error?.code]).toEqual([409, 'LOCKED']);
    // … and nothing changed later changes it: a rise in pay, a rate that is DRAFT again
    const guard = (await s.get(`/api/payroll/staff/${ids.S003}`)).body.staff;
    expect((await s.put(`/api/payroll/staff/${ids.S003}`).send({ staffNumber: guard.staffNumber, name: guard.name, joinedOn: guard.joinedOn, pay: { ...pay(20000, 0), from: '2026-10-01' } })).status).toBe(200);
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, staffPercent: 10 })).body.rates.pf.status).toBe('draft');
    const later = await month();
    expect(later.sheet).toEqual(locked.body.sheet);
    expect(later).toMatchObject({ draft: false, rates: { pf: { staffPercent: 12 } } });
    expect((await s.get('/api/payroll/advances')).body).toMatchObject({ openPaise: 900000, advances: [{ balancePaise: 900000, months: [{ month: M, amountPaise: 100000 }] }] });

    // Payslips print from the snapshot
    const slips = (await s.get(`/api/payroll/runs/${M}/payslips`)).body;
    expect(slips).toMatchObject({ draft: false, version: 1, revised: false, replacedOn: null, lockedByName: 'Alpha Accounts' });
    expect(slips.rows).toHaveLength(4);
    expect((await s.get(`/api/payroll/runs/${M}/payslips?version=7`)).status).toBe(404);

    // The lists: Excel-ready CSV, numbers by their last four, each download kept on the month and audited
    const register = await s.get(`/api/payroll/runs/${M}/lists/register`);
    expect(register.status).toBe(200);
    expect(register.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(register.headers['content-disposition']).toBe(`attachment; filename="perinexa-payroll-${M}-salary-register.csv"`);
    expect(register.text).toContain('S001,Sample Attendant,Ward attendant,Housekeeping,29.5,15000.00,11419.20,2854.80,14274.00,0.00,1370.00,107.00,200.00,0.00,0.00,0.00,1677.00,12597.00,1370.00,464.00');
    expect(register.text).toContain('S003,Sample Guard,,,31,13800.00,13800.00,0.00,13800.00,1000.00,0.00,0.00,0.00,500.00,300.00,1000.00,1800.00,13000.00,0.00,0.00');
    const pf = (await s.get(`/api/payroll/runs/${M}/lists/pf`)).text;
    expect(pf).toContain('S001,Sample Attendant,…0400,11419.20,1370.00,1370.00');
    expect(pf).toContain(',Total,,26419.20,3170.00,3170.00');
    expect((await s.get(`/api/payroll/runs/${M}/lists/esi`)).text).toContain('S001,Sample Attendant,…0300,29.5,14274.00,107.00,464.00');
    expect((await s.get(`/api/payroll/runs/${M}/lists/pt`)).text).toContain('S002,Sample Nurse,Women,25000.00,0.00');
    for (const text of [register.text, pf]) for (const full of [PAN, UAN, ESI, ACCOUNT]) expect(text).not.toContain(full);
    expect((await s.get(`/api/payroll/runs/${M}/lists/bank`)).body.error.code).toBe('LIST_OFF'); // the bank payment list is switched off
    expect((await s.get(`/api/payroll/runs/${M}/lists/gratuity`)).status).toBe(400);
    expect((await month(a)).downloads.map((d) => [d.list, d.byName])).toEqual([['register', 'Alpha Accounts'], ['pf', 'Alpha Accounts'], ['esi', 'Alpha Accounts'], ['pt', 'Alpha Accounts']]);
    expect((await AuditLog.findOne({ action: 'PAYROLL_LIST_DOWNLOADED', tenantId: alpha._id, 'details.list': 'pt' }).lean()).details).toEqual({ month: M, list: 'pt', version: 1 });

    // Reopen: the hospital admin only, with a written reason; version 1 stays and is marked
    expect((await month()).canReopen).toBe(false);
    expect((await s.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'A day was missed for the guard' })).status).toBe(403);
    expect((await a.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'no' })).body.error.fields.reason).toMatch(/why/);
    const reopened = await a.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'A day was missed for the guard' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'draft', locked: null, versions: [{ version: 1, replaced: { byName: 'Alpha Admin', reason: 'A day was missed for the guard' } }] });
    expect((await a.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'Once more, by mistake' })).status).toBe(409);
    expect((await s.get('/api/payroll/advances')).body.advances[0].balancePaise).toBe(1000000); // what version 1 took back is undone
    // The open month is worked out again from what stands now: the new pay. The PF figure typed without the tick is
    // used by no month – the figures confirmed before are still in force
    expect(rowOf(reopened.body, 'S003').payPaise).toBe(2000000);
    expect(reopened.body).toMatchObject({ lockBlockers: [], draft: false, rates: { pf: { staffPercent: 12 } } });
    expect((await a.put('/api/payroll/rates/pf').send({ ...PF, ...BY })).status).toBe(200);
    expect((await s.put(`/api/payroll/runs/${M}/corrections/${ids.S003}`).send({ paidDays: 30, reason: 'One day absent' })).status).toBe(200);
    const second = await a.post(`/api/payroll/runs/${M}/lock`);
    expect(second.body).toMatchObject({ status: 'locked', locked: { version: 2, byName: 'Alpha Admin' }, versions: [{ version: 1 }, { version: 2, replaced: null }], downloads: [] });
    expect((await s.get(`/api/payroll/runs/${M}/payslips`)).body).toMatchObject({ version: 2, revised: true, replacedOn: null });
    const first = (await s.get(`/api/payroll/runs/${M}/payslips?version=1`)).body;
    expect(first.replacedOn).toBeTruthy();
    expect(first.rows.find((r) => r.staffNumber === 'S003').pay.takeHomePaise).toBe(1300000); // version 1 as it was locked
    expect((await s.get(`/api/payroll/runs/${M}/lists/pf`)).headers['content-disposition']).toBe(`attachment; filename="perinexa-payroll-${M}-pf-list-v2.csv"`);
    expect((await AuditLog.findOne({ action: 'PAYROLL_MONTH_REOPENED', tenantId: alpha._id }).lean()).details).toEqual({ month: M, version: 1, reason: 'A day was missed for the guard' });
    expect((await AuditLog.find({ action: 'PAYROLL_MONTH_LOCKED', tenantId: alpha._id }).sort({ createdAt: 1 }).lean()).map((e) => e.details)).toEqual([{ month: M, version: 1, people: 4 }, { month: M, version: 2, people: 4 }]);
  });

  it('a locked month protects the pay entry it used; the bank list and full numbers only where the admin switched them on', async () => {
    await makeReady();
    expect((await s.post(`/api/payroll/runs/${M}/lock`)).status).toBe(200);
    const kept = await PayrollRun.findOne({ tenantId: alpha._id, month: M }, { used: 1 }).lean();
    expect(kept.used.map((u) => u.payFrom)).toEqual(['2025-04-01', '2025-04-01', '2025-04-01', '2025-04-01']);

    // The entry October was paid with can't be corrected; a change of pay from a later day is always possible
    const guard = (await s.get(`/api/payroll/staff/${ids.S003}`)).body.staff;
    const body = (from) => ({ staffNumber: guard.staffNumber, name: guard.name, joinedOn: guard.joinedOn, pay: { ...pay(14500, 0), from } });
    const refused = await s.put(`/api/payroll/staff/${ids.S003}`).send(body('2025-04-01'));
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields['pay.from']).toMatch(/October 2026 is locked and was paid with the pay that starts on this day/);
    expect((await s.put(`/api/payroll/staff/${ids.S003}`).send(body('2026-11-15'))).status).toBe(200);
    expect((await month()).sheet.rows.find((r) => r.staffNumber === 'S003').payPaise).toBe(1380000); // the locked month as it was

    // The Lists page: the months, which is locked and at which version – never a snapshot or a name
    const months = await s.get('/api/payroll/runs');
    expect(months.body.lists).toEqual(['register', 'pf', 'esi', 'pt']);
    expect(months.body.runs).toEqual([expect.objectContaining({ month: M, status: 'locked', locked: expect.objectContaining({ version: 1, byName: 'Alpha Accounts', people: 4 }), downloads: [] })]);
    expect(months.text).not.toContain('Sample Guard');
    expect(months.text).not.toContain('snapshot');

    // Off until the hospital admin switches it on: the bank payment list, and full numbers in the PF and ESI lists
    expect((await s.get(`/api/payroll/runs/${M}/lists/bank`)).status).toBe(403);
    expect((await s.get(`/api/payroll/runs/${M}/lists/pf`)).text).toContain('S001,Sample Attendant,…0400,');
    const now = (await a.get('/api/payroll/settings')).body.settings;
    expect([now.bankList, now.fullNumbers]).toEqual([false, false]);
    const settings = (o) => ({ parts: now.parts, dayBasis: now.dayBasis, weeklyOffsPaid: now.weeklyOffsPaid, holidaysPaid: now.holidaysPaid, rounding: now.rounding, confirmedBy: now.confirmedBy, confirmedOn: now.confirmedOn, ...o });
    expect((await s.put('/api/payroll/settings').send(settings({ bankList: true }))).status).toBe(403);
    const on = await a.put('/api/payroll/settings').send(settings({ bankList: true }));
    expect(on.body).toMatchObject({ changed: ['bankList'], draft: false }); // a switch, not a rule: the confirmation stays
    expect((await month()).lists).toEqual(['register', 'pf', 'esi', 'pt', 'bank']);
    const bank = await s.get(`/api/payroll/runs/${M}/lists/bank`);
    expect(bank.status).toBe(200);
    expect(bank.headers['content-disposition']).toBe(`attachment; filename="perinexa-payroll-${M}-bank-payment-list.csv"`);
    expect(bank.text).toContain(`S001,Sample Attendant,Sample Bank,HDFC0001234,${ACCOUNT},12597.00`);
    expect(bank.text).toContain('S002,Sample Nurse,,,,22700.00'); // no account kept: an empty cell
    expect((await AuditLog.findOne({ action: 'PAYROLL_LIST_DOWNLOADED', tenantId: alpha._id, 'details.list': 'bank' }).lean()).details).toEqual({ month: M, list: 'bank', version: 1, full: true });
    expect(JSON.stringify(await AuditLog.find({ tenantId: alpha._id }).lean())).not.toContain(ACCOUNT); // the number is in the file only
    expect(JSON.stringify(await PayrollRun.findOne({ tenantId: alpha._id, month: M }).lean())).not.toContain(ACCOUNT);
    expect((await s.get(`/api/payroll/runs/${M}/lists/pf`)).text).toContain('…0400'); // its own switch
    expect((await a.put('/api/payroll/settings').send(settings({ bankList: true, fullNumbers: true }))).body.changed).toEqual(['fullNumbers']);
    const pf = (await s.get(`/api/payroll/runs/${M}/lists/pf`)).text;
    expect(pf).toContain(`S001,Sample Attendant,${UAN},`);
    expect(pf).toContain('PF number (UAN),Pay counted for PF');
    expect((await s.get(`/api/payroll/runs/${M}/lists/esi`)).text).toContain(`S001,Sample Attendant,${ESI},`);
    expect((await s.get(`/api/payroll/runs/${M}/lists/register`)).text).not.toContain(UAN);
    expect((await a.put('/api/payroll/settings').send(settings({}))).body.settings).toMatchObject({ bankList: false, fullNumbers: false });
    expect((await s.get(`/api/payroll/runs/${M}/lists/bank`)).status).toBe(403);

    // Reopened: the entry is free again
    expect((await a.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'The nurse’s pay was entered wrongly' })).status).toBe(200);
    const nurse = (await s.get(`/api/payroll/staff/${ids.S002}`)).body.staff;
    const fixed = await s.put(`/api/payroll/staff/${ids.S002}`).send({ staffNumber: nurse.staffNumber, name: nurse.name, joinedOn: nurse.joinedOn, ptSlab: 'women', pay: { ...pay(21000, 5000, { pf: true, pt: true }, 50000), from: '2025-04-01' } });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.changed).toContain('pay');
  });

  it('only the two payroll roles of this hospital – never another hospital, never Perinexa’s own staff; the audit log holds no amount', async () => {
    const advanceId = await giveAdvance();
    await makeReady();
    expect((await s.post(`/api/payroll/runs/${M}/lock`)).status).toBe(200);
    expect((await s.get(`/api/payroll/runs/${M}/lists/register`)).status).toBe(200);

    const doctor = await createUser({ name: 'Dr. Alpha' });
    await addMember(doctor, alpha, 'doctor');
    const d = await loginAs(doctor, { app });
    for (const url of ['/api/payroll/rates', '/api/payroll/advances', `/api/payroll/runs/${M}/payslips`, `/api/payroll/runs/${M}/lists/register`]) expect((await d.get(url)).status, url).toBe(403);
    expect((await d.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'Not my work at all' })).status).toBe(403);

    const betaAccounts = await createUser({ name: 'Beta Accounts' });
    await addMember(betaAccounts, beta, 'accounts');
    const b = await loginAs(betaAccounts, { app });
    expect((await b.get('/api/payroll/advances')).body.advances).toEqual([]);
    expect((await b.put(`/api/payroll/advances/${advanceId}`).send({ instalmentPaise: 1, recoverFrom: M })).status).toBe(404);
    expect((await b.post('/api/payroll/advances').send({ staffId: ids.S003, givenOn: '2026-10-05', amountPaise: 100000, instalmentPaise: 10000, recoverFrom: M })).body.error.fields.staffId).toMatch(/on the payroll/);
    expect((await month(b)).status).toBe('draft'); // Beta's own October: nothing of Alpha's lock
    expect((await b.get(`/api/payroll/runs/${M}/lists/register`)).status).toBe(409);
    expect((await b.get('/api/payroll/rates')).body.rates.pf.status).toBe('draft'); // Alpha's confirmation is Alpha's

    // Support access open: patients are reachable for the super admin, nothing of the payroll is
    expect((await a.put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Wrong bill total for one patient' })).status).toBe(200);
    const root = await loginAs(await createSuperAdmin({ name: 'Super' }), { app });
    root.activeTenantId = (await root.agent.post('/api/auth/open-hospital').send({ tenantId: alpha._id.toString() })).body.activeTenantId;
    expect((await root.get('/api/patients')).status).toBe(200);
    for (const url of ['/api/payroll/rates', '/api/payroll/advances', `/api/payroll/runs/${M}/payslips`, `/api/payroll/runs/${M}/lists/register`]) {
      const res = await root.get(url);
      expect(res.status, url).toBe(403);
      expect(res.text).not.toContain('Sample Guard');
    }
    expect((await root.post(`/api/payroll/runs/${M}/reopen`).send({ reason: 'Support wants to look' })).status).toBe(403);
    expect(LEFT_OUT.StaffAdvance).toBeTruthy();

    // The audit log: who, which month, which list – never an amount; the super admin's readers get nothing
    const NEW = ['PAYROLL_RATES_CHANGED', 'PAYROLL_ADVANCE_GIVEN', 'PAYROLL_MONTH_LOCKED', 'PAYROLL_LIST_DOWNLOADED'];
    const all = JSON.stringify(await AuditLog.find({ tenantId: alpha._id, action: /^PAYROLL_(RATES|ADVANCE|MONTH|PAYSLIPS|LIST)/ }).lean());
    for (const amount of ['1000000', '200000', '1380000', '1259700']) expect(all).not.toContain(amount);
    for (const action of NEW) expect(await AuditLog.exists({ action, tenantId: alpha._id }), action).toBeTruthy();
    for (const action of [...NEW, 'PAYROLL_ADVANCE_CHANGED', 'PAYROLL_MONTH_ADJUSTED', 'PAYROLL_MONTH_REOPENED', 'PAYROLL_PAYSLIPS_PRINTED']) {
      expect(safeAuditDetails(action, { month: M, staffNumber: 'S001', name: 'Sample', fields: ['tds'], group: 'pf', confirmed: true, version: 1, list: 'pf', reason: 'A reason', people: 4, draft: true, takeHomePaise: 1 }, { scope: 'platform' }), action).toEqual({});
    }
    expect(safeAuditDetails('PAYROLL_MONTH_LOCKED', { month: M, version: 1, people: 4, takeHomePaise: 1 })).toEqual({ month: M, version: 1, people: 4 });
  });
});
