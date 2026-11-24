// Payroll, Stage A (docs/PAYROLL_BUILD_NOTE.md): the accounts login, the staff list with pay, the payroll settings.
// All fake sample data: made-up staff, made-up pay and made-up numbers.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pageOfRoute } from '../src/access/pages.js';
import { createApp } from '../src/app.js';
import { LEFT_OUT } from '../src/export/hospitalExport.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { TENANT_ROLES } from '../src/models/Membership.js';
import { StaffMember, WITH_NUMBERS } from '../src/models/StaffMember.js';
import { Tenant } from '../src/models/Tenant.js';
import { cleanCodes, isWorking, looksLikeAadhaar, monthlyGross, nextStaffNumber, numberProblem, partKey, payOn, placeForPay, rulesAreDraft, withDefaults } from '../src/payroll/payrollRules.js';
import { canSeal, seal, unseal } from '../src/payroll/secretBox.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
let alpha;
let beta;
let admin;
let accounts;
let doctor;
let nurseUser;

// Made-up numbers of the right shape
const PAN = 'ABCDE1234F';
const UAN = '100200300400';
const ESI = '3100200300';
const ACCOUNT = '00112233445566';

const person = (overrides = {}) => ({
  staffNumber: 'S001',
  name: 'Sample Attendant',
  designation: 'Ward attendant',
  department: 'Housekeeping',
  joinedOn: '2025-04-01',
  attendanceCodes: ['A-17'],
  ptSlab: 'men', // professional tax is taken from this pay, so its table of slabs is chosen (Stage C)
  bank: { ifsc: 'HDFC0001234', bankName: 'Sample Bank' },
  pay: { from: '2026-11-01', parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300000 }], pf: true, esi: true, pt: true, tdsPaise: 0 },
  numbers: { pan: PAN, uan: UAN, esiNumber: ESI, accountNumber: ACCOUNT },
  ...overrides,
});

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  alpha = await createTenant('Alpha Hospital');
  beta = await createTenant('Beta Hospital');
  admin = await createUser({ name: 'Alpha Admin' });
  await addMember(admin, alpha, 'admin');
  accounts = await createUser({ name: 'Alpha Accounts' });
  await addMember(accounts, alpha, 'accounts');
  doctor = await createUser({ name: 'Dr. Alpha' });
  await addMember(doctor, alpha, 'doctor');
  nurseUser = await createUser({ name: 'Nurse Alpha' });
  await addMember(nurseUser, alpha, 'nurse');
});
afterAll(disconnectTestDb);

const as = (user) => loginAs(user, { app });
async function openHospital(session, tenant) {
  const res = await session.agent.post('/api/auth/open-hospital').send({ tenantId: tenant._id.toString() });
  session.activeTenantId = res.body.activeTenantId;
  return res;
}

describe('payroll rules (pure)', () => {
  it('checks the shape of the four numbers and never keeps an Aadhaar-like number', () => {
    expect(numberProblem('pan', 'abcde 1234 f')).toBeNull();
    expect(numberProblem('pan', 'ABCDE12345')).toMatch(/5 letters/);
    expect(numberProblem('uan', UAN)).toBeNull();
    expect(numberProblem('uan', '12345')).toMatch(/12 digits/);
    expect(numberProblem('esiNumber', ESI)).toBeNull();
    expect(numberProblem('accountNumber', '12-34')).toMatch(/6 to 18 digits/);
    expect(looksLikeAadhaar('Sample 1234 5678 9012')).toBe(true);
    expect(looksLikeAadhaar('123456789012')).toBe(true);
    expect(looksLikeAadhaar('Ward 12, bed 3456')).toBe(false);
    expect(looksLikeAadhaar('1234567890123')).toBe(false); // 13 digits: not that
  });

  it('finds the pay in force, where a new entry goes, and who is working', () => {
    const pay = [{ from: '2026-04-01', parts: [{ key: 'basic', amountPaise: 1000000 }] }, { from: '2026-11-01', parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300000 }] }];
    expect(monthlyGross(payOn(pay, new Date('2026-10-31T10:00:00Z')))).toBe(1000000);
    expect(monthlyGross(payOn(pay, new Date('2026-11-01T00:00:00Z')))).toBe(1500000);
    expect(payOn(pay, new Date('2026-03-31T00:00:00Z'))).toBeNull();
    expect(placeForPay([], '2026-11-01')).toBeNull(); // the first entry
    expect(placeForPay(pay, '2027-01-01')).toBeNull(); // a later day: added
    expect(placeForPay(pay, '2026-11-01')).toBe(1); // the same day: that entry is corrected
    expect(placeForPay(pay, '2026-10-01')).toMatch(/can't start before/);
    const today = new Date('2026-11-23T08:00:00Z');
    expect(isWorking({ isActive: true, leftOn: null }, today)).toBe(true);
    expect(isWorking({ isActive: true, leftOn: '2026-11-23' }, today)).toBe(true); // the last working day itself
    expect(isWorking({ isActive: true, leftOn: '2026-11-22' }, today)).toBe(false);
    expect(isWorking({ isActive: false, leftOn: null }, today)).toBe(false);
  });

  it('suggests the next staff number, cleans codes and names a new salary part', () => {
    expect(nextStaffNumber([])).toBe('001');
    expect(nextStaffNumber(['S009', 'S013', 'X'])).toBe('S014');
    expect(nextStaffNumber(['7', '8'])).toBe('9');
    expect(cleanCodes('A-12, 0045 ; 0045')).toEqual(['A-12', '0045']);
    expect(partKey('Night duty allowance')).toBe('night-duty-allowance');
    expect(partKey('Basic pay', ['basic-pay'])).toBe('basic-pay-2');
  });

  it('the settings start with three salary parts and are DRAFT until the accountant confirms them', () => {
    const start = withDefaults(undefined);
    expect(start.parts.map((p) => p.key)).toEqual(['basic', 'hra', 'other']);
    expect(start.dayBasis).toBe('');
    expect(rulesAreDraft(start)).toBe(true);
    expect(rulesAreDraft({ ...start, dayBasis: 'calendar', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' })).toBe(false);
    expect(rulesAreDraft({ ...start, confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' })).toBe(true); // a day's pay not chosen
  });

  it('seals a number with its own key and reads it back only with that key', () => {
    const key = 'k'.repeat(40);
    const kept = seal('abcde 1234 f', key);
    expect(kept.last4).toBe('234F');
    expect(kept.enc).not.toContain('ABCDE1234F');
    expect(unseal(kept, key)).toBe('ABCDE1234F');
    expect(unseal(kept, 'another-key-that-is-long-enough-000000')).toBeNull();
    expect(unseal({ ...kept, enc: `${kept.enc.slice(0, -4)}AAAA` }, key)).toBeNull(); // changed text
    expect(seal(PAN, key).enc).not.toBe(kept.enc); // never the same sealed text twice
    expect(canSeal('')).toBe(false);
    expect(() => seal(PAN, '')).toThrow(/PAYROLL_KEY/);
  });
});

describe('payroll: who may open it', () => {
  it('the accounts login is a hospital role with its own group, and no patient role', async () => {
    expect(TENANT_ROLES).toContain('accounts');
    const s = await as(accounts);
    expect((await s.get('/api/payroll/staff')).status).toBe(200);
    expect((await s.get('/api/payroll/settings')).status).toBe(200);
    // It opens nothing that existed before: no patients, no bills, no reports, no Tally files
    for (const url of ['/api/patients', '/api/billing/bills', '/api/tally/settings', '/api/calendar']) expect((await s.get(url)).status, url).toBe(403);
    // The hospital admin has the payroll too
    expect((await (await as(admin)).get('/api/payroll/staff')).status).toBe(200);
  });

  it('nobody else in the hospital sees it', async () => {
    const reception = await createUser({ name: 'Reception Alpha' });
    await addMember(reception, alpha, 'receptionist');
    const billing = await createUser({ name: 'Billing Alpha' });
    await addMember(billing, alpha, 'billing');
    for (const user of [doctor, nurseUser, reception, billing]) {
      const s = await as(user);
      for (const url of ['/api/payroll/staff', '/api/payroll/staff/form', '/api/payroll/settings']) {
        const res = await s.get(url);
        expect(res.status, `${user.name} ${url}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect((await s.post('/api/payroll/staff').send(person())).status).toBe(403);
    }
    expect(await StaffMember.countDocuments({ tenantId: alpha._id })).toBe(0);
  });

  it("Perinexa's own staff never see it – with support access closed or open", async () => {
    const a = await as(accounts);
    const made = await a.post('/api/payroll/staff').send(person());
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const superAdmin = await createSuperAdmin({ name: 'Super' });
    const platformAdmin = await createUser({ name: 'Platform Admin', isPlatformAdmin: true, platformPermissions: ['hospitalSetup'] });
    const urls = ['/api/payroll/staff', `/api/payroll/staff/${made.body.staff.id}`, '/api/payroll/staff/form', '/api/payroll/settings'];

    // Closed: the support-access rule refuses, as for patients
    for (const user of [superAdmin, platformAdmin]) {
      const s = await as(user);
      await openHospital(s, alpha);
      for (const url of urls) expect((await s.get(url)).body.error?.code, `${user.name} ${url}`).toBe('NO_SUPPORT_ACCESS');
    }

    // Open: patients are reachable, the payroll still is not
    const opened = await (await as(admin)).put('/api/tenant/settings/support-access').send({ hours: 2, reason: 'Wrong bill total for one patient' });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    for (const user of [superAdmin, platformAdmin]) {
      const s = await as(user);
      await openHospital(s, alpha);
      expect((await s.get('/api/patients')).status).toBe(200);
      for (const url of urls) {
        const res = await s.get(url);
        expect(res.status, `${user.name} ${url}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(JSON.stringify(res.body)).not.toContain('Sample Attendant');
      }
      expect((await s.post(`/api/payroll/staff/${made.body.staff.id}/number`).send({ field: 'pan' })).status).toBe(403);
      expect((await s.put('/api/payroll/settings').send({})).status).toBe(403);
    }
    expect(await AuditLog.countDocuments({ action: 'PAYROLL_NUMBER_VIEWED' })).toBe(0);
    // The hospital's own details, as the platform reads them, carry no payroll settings
    expect(alpha.toJSON()).not.toHaveProperty('payroll');
    expect((await Tenant.findById(alpha._id)).toJSON()).not.toHaveProperty('payroll');
  });

  it('keeps each hospital to its own staff list', async () => {
    const betaAccounts = await createUser({ name: 'Beta Accounts' });
    await addMember(betaAccounts, beta, 'accounts');
    const b = await as(betaAccounts);
    const made = await b.post('/api/payroll/staff').send(person({ name: 'Beta Cleaner' }));
    expect(made.status).toBe(201);
    const a = await as(accounts);
    expect((await a.get('/api/payroll/staff?show=all')).body.staff).toEqual([]);
    expect((await a.get(`/api/payroll/staff/${made.body.staff.id}`)).status).toBe(404);
    expect((await a.put(`/api/payroll/staff/${made.body.staff.id}`).send(person({ numbers: {} }))).status).toBe(404);
    expect((await a.post(`/api/payroll/staff/${made.body.staff.id}/number`).send({ field: 'pan' })).status).toBe(404);
    // The same staff number and attendance code in another hospital are no clash
    expect((await a.post('/api/payroll/staff').send(person())).status).toBe(201);
  });

  it('the page key and its API area are known to page access, and the staff list stays out of the export', () => {
    expect(pageOfRoute('/payroll/staff', 'GET')).toBe('payroll');
    expect(pageOfRoute('/payroll/settings', 'PUT')).toBe('payroll');
    expect(LEFT_OUT.StaffMember).toMatch(/accounts login and the hospital admin/);
  });
});

describe('payroll: the staff list', () => {
  it('adds a person with pay and the four numbers; lists never carry a number and the page shows the last four only', async () => {
    const s = await as(accounts);
    const form = await s.get('/api/payroll/staff/form');
    expect(form.body).toMatchObject({ suggestedNumber: '001', canKeepNumbers: true });
    expect(form.body.parts.map((p) => p.key)).toEqual(['basic', 'hra', 'other']);
    expect(form.body.logins.map((l) => l.name)).toEqual(['Alpha Accounts', 'Alpha Admin', 'Dr. Alpha', 'Nurse Alpha']);

    const made = await s.post('/api/payroll/staff').send(person({ userId: String(nurseUser._id) }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.staff).toMatchObject({ staffNumber: 'S001', name: 'Sample Attendant', working: true, monthlyPaise: 1500000, payFrom: '2026-11-01', hasLogin: true, loginName: 'Nurse Alpha', attendanceCodes: ['A-17'], bank: { ifsc: 'HDFC0001234', bankName: 'Sample Bank' } });
    expect(made.body.staff.numbers).toEqual({ uan: { kept: true, last4: '0400' }, esiNumber: { kept: true, last4: '0300' }, pan: { kept: true, last4: '234F' }, accountNumber: { kept: true, last4: '5566' } });
    expect(made.body.staff.pay).toEqual([expect.objectContaining({ from: '2026-11-01', monthlyPaise: 1500000, pf: true, esi: true, pt: true, tdsPaise: 0, byName: 'Alpha Accounts' })]);

    // No answer holds a number in full, or its sealed text
    const list = await s.get('/api/payroll/staff');
    expect(list.body).toMatchObject({ counts: { working: 1, left: 0 }, monthlyPaise: 1500000, withoutPay: 0, rulesDraft: true });
    expect(list.body.staff[0]).not.toHaveProperty('numbers');
    const page = await s.get(`/api/payroll/staff/${made.body.staff.id}`);
    for (const text of [JSON.stringify(list.body), JSON.stringify(page.body), JSON.stringify(made.body)]) {
      for (const secret of [PAN, UAN, ESI, ACCOUNT, 'v1.']) expect(text).not.toContain(secret);
    }
    // The database keeps the sealed text and the last four – not selected unless asked for
    const plain = await StaffMember.findOne({ tenantId: alpha._id }).lean();
    expect(plain.pan).toBeUndefined();
    expect(plain.bank.accountNumber).toBeUndefined();
    const kept = await StaffMember.findOne({ tenantId: alpha._id }).select(WITH_NUMBERS).lean();
    expect(kept.pan.enc).toMatch(/^v1\./);
    expect(JSON.stringify(kept)).not.toContain(PAN);
    expect(JSON.stringify(kept)).not.toContain(ACCOUNT);

    // The audit log: who was added and which fields – never an amount or a number
    const added = await AuditLog.findOne({ action: 'PAYROLL_STAFF_ADDED', tenantId: alpha._id }).lean();
    expect(added.details).toEqual({ staffId: made.body.staff.id, staffNumber: 'S001', name: 'Sample Attendant', fields: ['pay', 'uan', 'esiNumber', 'pan', 'accountNumber'] });
    expect(await AuditLog.exists({ action: 'PAYROLL_STAFF_LIST_VIEWED', tenantId: alpha._id, actor: accounts._id, 'details.shown': 1 })).toBeTruthy();
    expect(await AuditLog.exists({ action: 'PAYROLL_STAFF_VIEWED', tenantId: alpha._id, 'details.staffNumber': 'S001' })).toBeTruthy();
    const all = JSON.stringify(await AuditLog.find({ tenantId: alpha._id }).lean());
    for (const secret of [PAN, UAN, ESI, ACCOUNT, '1500000', '1200000']) expect(all).not.toContain(secret);

    // The login is now tied: the form says to whom, and the next number follows
    const next = await s.get('/api/payroll/staff/form');
    expect(next.body.suggestedNumber).toBe('S002');
    expect(next.body.logins.find((l) => l.name === 'Nurse Alpha').staffId).toBe(made.body.staff.id);
  });

  it('shows one number in full, one person at a time, and writes whose and which in the audit log', async () => {
    const s = await as(accounts);
    const id = (await s.post('/api/payroll/staff').send(person({ numbers: { pan: PAN, accountNumber: ACCOUNT } }))).body.staff.id;
    const pan = await s.post(`/api/payroll/staff/${id}/number`).send({ field: 'pan' });
    expect(pan.status).toBe(200);
    expect(pan.body).toEqual({ field: 'pan', value: PAN });
    expect(pan.headers['cache-control']).toBe('no-store');
    expect((await s.post(`/api/payroll/staff/${id}/number`).send({ field: 'accountNumber' })).body.value).toBe(ACCOUNT);
    expect((await s.post(`/api/payroll/staff/${id}/number`).send({ field: 'uan' })).status).toBe(404); // none kept
    expect((await s.post(`/api/payroll/staff/${id}/number`).send({ field: 'aadhaar' })).status).toBe(400);
    const entries = await AuditLog.find({ action: 'PAYROLL_NUMBER_VIEWED', tenantId: alpha._id }).sort({ createdAt: 1 }).lean();
    expect(entries.map((e) => e.details)).toEqual([
      { staffId: id, staffNumber: 'S001', name: 'Sample Attendant', field: 'pan' },
      { staffId: id, staffNumber: 'S001', name: 'Sample Attendant', field: 'accountNumber' },
    ]);
    expect(String(entries[0].actor)).toBe(String(accounts._id));
  });

  it('refuses a wrong shape, an Aadhaar-like number, and a clash with another staff member – never repeating the number', async () => {
    const s = await as(accounts);
    expect((await s.post('/api/payroll/staff').send(person())).status).toBe(201);
    const bad = await s.post('/api/payroll/staff').send(
      person({ staffNumber: 'S001', name: 'Second 1234 5678 9012', attendanceCodes: ['A-17'], userId: String(doctor._id), joinedOn: '2026-05-01', leftOn: '2026-04-01', bank: { ifsc: 'HDFC1234', bankName: '' }, numbers: { pan: 'ABCDE12345', uan: '123' } }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.name).toMatch(/Aadhaar is never kept/);
    expect(bad.body.error.fields['bank.ifsc']).toMatch(/11 characters/);
    expect(JSON.stringify(bad.body)).not.toContain('ABCDE12345');

    const clash = await s.post('/api/payroll/staff').send(person({ name: 'Second Person', leftOn: '2025-01-01', numbers: { pan: 'ABCDE12345', uan: '123' }, pay: { from: '2026-11-01', parts: [{ key: 'bonus', amountPaise: 100 }] } }));
    expect(clash.status).toBe(400);
    expect(clash.body.error.fields).toMatchObject({
      staffNumber: 'Sample Attendant already has this staff number',
      attendanceCodes: 'Sample Attendant (S001) already carries the code A-17',
      leftOn: expect.stringMatching(/before the joining day/),
      'numbers.pan': expect.stringMatching(/5 letters/),
      'numbers.uan': expect.stringMatching(/12 digits/),
      'pay.parts': expect.stringMatching(/not in the payroll settings/),
    });
    expect(JSON.stringify(clash.body)).not.toContain('ABCDE12345');

    // A login from another hospital, and a login tied twice
    const outsider = await createUser({ name: 'Beta Person' });
    await addMember(outsider, beta, 'nurse');
    expect((await s.post('/api/payroll/staff').send(person({ staffNumber: 'S002', attendanceCodes: [], userId: String(outsider._id) }))).body.error.fields.userId).toMatch(/does not work in this hospital/);
    expect((await s.post('/api/payroll/staff').send(person({ staffNumber: 'S002', attendanceCodes: [], userId: String(doctor._id) }))).status).toBe(201);
    expect((await s.post('/api/payroll/staff').send(person({ staffNumber: 'S003', attendanceCodes: [], userId: String(doctor._id) }))).body.error.fields.userId).toMatch(/already tied to Sample Attendant \(S002\)/);
    // Pay: at least one amount, and the TDS never above the pay
    expect((await s.post('/api/payroll/staff').send(person({ staffNumber: 'S004', attendanceCodes: [], pay: { from: '2026-11-01', parts: [] } }))).body.error.fields['pay.parts']).toMatch(/at least one amount/);
    expect((await s.post('/api/payroll/staff').send(person({ staffNumber: 'S004', attendanceCodes: [], pay: { from: '2026-11-01', parts: [{ key: 'basic', amountPaise: 100000 }], tdsPaise: 200000 } }))).body.error.fields['pay.tdsPaise']).toMatch(/more than the monthly pay/);
    expect(await StaffMember.countDocuments({ tenantId: alpha._id })).toBe(2);
  });

  it('a change of pay adds a dated entry; the same first day corrects it; an earlier day is refused', async () => {
    const s = await as(accounts);
    const id = (await s.post('/api/payroll/staff').send(person())).body.staff.id;
    const details = person({ numbers: {}, pay: null });

    // Nothing changed: nothing saved, nothing in the audit log
    const same = await s.put(`/api/payroll/staff/${id}`).send(details);
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body.changed).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'PAYROLL_STAFF_CHANGED' })).toBe(0);
    expect(same.body.staff.numbers.pan).toEqual({ kept: true, last4: '234F' }); // an empty box leaves the kept number alone

    const rise = await s.put(`/api/payroll/staff/${id}`).send({ ...details, designation: 'Senior attendant', pay: { from: '2099-01-01', parts: [{ key: 'basic', amountPaise: 1400000 }, { key: 'hra', amountPaise: 300000 }], pf: true, esi: false, pt: true, tdsPaise: 50000 } });
    expect(rise.body.changed).toEqual(['designation', 'pay']);
    expect(rise.body.staff.pay.map((e) => [e.from, e.monthlyPaise])).toEqual([['2099-01-01', 1700000], ['2026-11-01', 1500000]]);
    expect(rise.body.staff.monthlyPaise).toBe(1500000); // the rise is entered ahead: November's pay is still in force

    const fixed = await s.put(`/api/payroll/staff/${id}`).send({ ...details, designation: 'Senior attendant', pay: { from: '2099-01-01', parts: [{ key: 'basic', amountPaise: 1450000 }], pf: true, esi: false, pt: true, tdsPaise: 50000 } });
    expect(fixed.body.changed).toEqual(['pay']);
    expect(fixed.body.staff.pay.map((e) => [e.from, e.monthlyPaise])).toEqual([['2099-01-01', 1450000], ['2026-11-01', 1500000]]);

    const early = await s.put(`/api/payroll/staff/${id}`).send({ ...details, pay: { from: '2098-12-01', parts: [{ key: 'basic', amountPaise: 1000000 }] } });
    expect(early.status).toBe(400);
    expect(early.body.error.fields['pay.from']).toMatch(/can't start before the pay already entered \(from 2099-01-01\)/);

    // A number typed again is kept in place of the old one; one asked to be removed is removed
    const numbers = await s.put(`/api/payroll/staff/${id}`).send({ ...details, designation: 'Senior attendant', numbers: { pan: 'ZZZZZ9999Z', uan: UAN }, clearNumbers: ['esiNumber'] });
    expect(numbers.body.changed).toEqual(['pan', 'esiNumber']); // the same UAN typed again is no change
    expect(numbers.body.staff.numbers).toMatchObject({ pan: { kept: true, last4: '999Z' }, esiNumber: { kept: false, last4: '' }, uan: { kept: true, last4: '0400' } });
    const entry = await AuditLog.findOne({ action: 'PAYROLL_STAFF_CHANGED', 'details.fields': 'pan' }).lean();
    expect(entry.details).toEqual({ staffId: id, staffNumber: 'S001', name: 'Sample Attendant', fields: ['pan', 'esiNumber'] });

    // Taken off the payroll, or past the last working day: under "left", never deleted
    const left = await s.put(`/api/payroll/staff/${id}`).send({ ...details, designation: 'Senior attendant', leftOn: '2026-01-31' });
    expect(left.body.staff.working).toBe(false);
    expect((await s.get('/api/payroll/staff')).body.staff).toEqual([]);
    expect((await s.get('/api/payroll/staff?show=left')).body.staff.map((x) => x.name)).toEqual(['Sample Attendant']);
    expect(await StaffMember.countDocuments({ tenantId: alpha._id })).toBe(1);
  });

  it('the audit log shows the super admin nothing of a payroll entry', () => {
    const details = { staffId: 'x', staffNumber: 'S001', name: 'Sample Attendant', fields: ['pay', 'pan'], amountPaise: 1500000, number: PAN };
    expect(safeAuditDetails('PAYROLL_STAFF_CHANGED', details)).toEqual({ staffId: 'x', staffNumber: 'S001', name: 'Sample Attendant', fields: ['pay', 'pan'] }); // the hospital admin: who and which fields
    for (const action of ['PAYROLL_STAFF_LIST_VIEWED', 'PAYROLL_STAFF_VIEWED', 'PAYROLL_STAFF_ADDED', 'PAYROLL_STAFF_CHANGED', 'PAYROLL_NUMBER_VIEWED', 'PAYROLL_SETTINGS_CHANGED']) {
      expect(safeAuditDetails(action, { ...details, field: 'pan', shown: 3 }, { scope: 'platform' }), action).toEqual({});
    }
  });
});

describe('payroll: settings', () => {
  const rules = (overrides = {}) => ({
    parts: [
      { key: 'basic', name: 'Basic pay', countsForPf: true, countsForEsi: true },
      { key: 'hra', name: 'House rent allowance', countsForPf: false, countsForEsi: true },
      { key: 'other', name: 'Other allowances', countsForPf: false, countsForEsi: true },
    ],
    dayBasis: 'calendar',
    weeklyOffsPaid: true,
    holidaysPaid: true,
    rounding: 'nearest',
    confirmedBy: '',
    confirmedOn: null,
    ...overrides,
  });

  it('the accounts login reads them; only the hospital admin changes them', async () => {
    const s = await as(accounts);
    const read = await s.get('/api/payroll/settings');
    expect(read.body).toMatchObject({ draft: true, canChange: false, canKeepNumbers: true, settings: { dayBasis: '', rounding: 'nearest', confirmedBy: '' } });
    expect((await s.put('/api/payroll/settings').send(rules())).status).toBe(403);

    const a = await as(admin);
    const saved = await a.put('/api/payroll/settings').send(rules({ parts: [...rules().parts, { name: 'Night duty allowance', countsForPf: false, countsForEsi: true }], dayBasis: 'twentySix', weeklyOffsPaid: false }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.changed).toEqual(['parts', 'dayBasis', 'weeklyOffsPaid']);
    expect(saved.body.settings.parts.map((p) => p.key)).toEqual(['basic', 'hra', 'other', 'night-duty-allowance']);
    expect(saved.body).toMatchObject({ draft: true, canChange: true, settings: { dayBasis: 'twentySix', weeklyOffsPaid: false, updatedByName: 'Alpha Admin' } });
    const entry = await AuditLog.findOne({ action: 'PAYROLL_SETTINGS_CHANGED', tenantId: alpha._id }).lean();
    expect(entry.details).toEqual({ fields: ['parts', 'dayBasis', 'weeklyOffsPaid'] });
    // Saved again unchanged: nothing in the audit log
    const again = await a.put('/api/payroll/settings').send(saved.body.settings);
    expect(again.body.changed).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'PAYROLL_SETTINGS_CHANGED' })).toBe(1);
    // Beta's settings are its own
    const betaAdmin = await createUser({ name: 'Beta Admin' });
    await addMember(betaAdmin, beta, 'admin');
    expect((await (await as(betaAdmin)).get('/api/payroll/settings')).body.settings.dayBasis).toBe('');
  });

  it('the rules stay DRAFT until the accountant’s name and date are written', async () => {
    const a = await as(admin);
    expect((await a.put('/api/payroll/settings').send(rules({ confirmedBy: 'Sample Accountant' }))).body.error.fields.confirmedOn).toMatch(/both/);
    expect((await a.put('/api/payroll/settings').send(rules({ confirmedOn: '2026-11-20' }))).body.error.fields.confirmedBy).toMatch(/both/);
    expect((await a.put('/api/payroll/settings').send(rules({ confirmedBy: 'Sample Accountant', confirmedOn: '2099-01-01' }))).body.error.fields.confirmedOn).toMatch(/future/);
    expect((await a.put('/api/payroll/settings').send(rules({ dayBasis: '', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' }))).body.error.fields.dayBasis).toMatch(/before writing/);
    const ok = await a.put('/api/payroll/settings').send(rules({ confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' }));
    expect(ok.body).toMatchObject({ draft: false, settings: { confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20' } });
    expect((await (await as(accounts)).get('/api/payroll/staff')).body.rulesDraft).toBe(false);
  });

  it('a salary part may be renamed, but not removed once a staff member’s pay names it', async () => {
    const a = await as(admin);
    expect((await (await as(accounts)).post('/api/payroll/staff').send(person())).status).toBe(201); // pay names basic and hra
    const removed = await a.put('/api/payroll/settings').send(rules({ parts: rules().parts.filter((p) => p.key !== 'hra') }));
    expect(removed.status).toBe(400);
    expect(removed.body.error.fields.parts).toMatch(/House rent allowance.*can’t be removed/);
    const unused = await a.put('/api/payroll/settings').send(rules({ parts: rules().parts.filter((p) => p.key !== 'other') }));
    expect(unused.status).toBe(200);
    const renamed = await a.put('/api/payroll/settings').send(rules({ parts: [{ key: 'basic', name: 'Basic', countsForPf: true, countsForEsi: true }, { key: 'hra', name: 'HRA', countsForPf: false, countsForEsi: false }] }));
    expect(renamed.body.settings.parts).toEqual([{ key: 'basic', name: 'Basic', countsForPf: true, countsForEsi: true }, { key: 'hra', name: 'HRA', countsForPf: false, countsForEsi: false }]);
    expect((await a.put('/api/payroll/settings').send(rules({ parts: [{ key: 'basic', name: 'Pay', countsForPf: true, countsForEsi: true }, { name: 'pay', countsForPf: false, countsForEsi: false }] }))).body.error.fields.parts).toMatch(/different name/);
    expect((await a.put('/api/payroll/settings').send(rules({ parts: [] }))).status).toBe(400);
  });

  it('a patient is still out of reach of the accounts login after all this', async () => {
    await (await as(doctor)).post('/api/patients').send(samplePatient({ fullName: 'Asha' }));
    const s = await as(accounts);
    expect((await s.get('/api/patients')).status).toBe(403);
    const today = await s.get('/api/today');
    expect(today.status).toBe(403);
    expect(JSON.stringify(today.body)).not.toContain('Asha');
  });
});
