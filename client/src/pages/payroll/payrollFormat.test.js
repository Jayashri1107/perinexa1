import { describe, expect, it } from 'vitest';
import { ROLE_HINTS, ROLE_LABELS } from '../../components/ui.jsx';
import { hospitalModules, moduleByKey, PAYROLL_ROLES } from '../../platform/modules.js';
import { PAGE_KEYS, pageForPath } from '../../platform/pageAccess.js';
import { codesFrom, emptyForm, formFrom, maskedNumber, payAction, payrollToDo, readPay, samePay, searchStaff, settingsBody, staffBody, staffStatus } from './payrollFormat.js';

// All made-up staff and made-up pay
const PARTS = [
  { key: 'basic', name: 'Basic pay' },
  { key: 'hra', name: 'House rent allowance' },
];
const entry = { from: '2026-11-01', parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300000 }], monthlyPaise: 1500000, pf: true, esi: true, pt: false, tdsPaise: 50000 };
const staff = { id: 'a1', staffNumber: 'S001', name: 'Sample Attendant', designation: 'Ward attendant', department: 'Housekeeping', joinedOn: '2025-04-01', leftOn: null, isActive: true, working: true, userId: null, attendanceCodes: ['A-17', 'B-2'], bank: { ifsc: 'HDFC0001234', bankName: 'Sample Bank' }, pay: [entry] };

describe('payroll: the menu and the words', () => {
  it('the accounts login and the hospital admin get Payroll; nobody else, and never a platform user', () => {
    expect(PAYROLL_ROLES).toEqual(['accounts', 'admin']);
    expect(hospitalModules(['accounts']).map((m) => m.label)).toEqual(['Today', 'Payroll']);
    expect(hospitalModules(['admin']).map((m) => m.label)).toContain('Payroll');
    for (const role of ['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'sonographer', 'pharmacist', 'billing', 'referral_desk', 'followup_coordinator', 'quality', 'records']) expect(hospitalModules([role]).map((m) => m.label), role).not.toContain('Payroll');
    // A super admin who opened a hospital carries every role there: still no Payroll
    expect(hospitalModules(['admin', 'accounts', 'doctor'], { platform: true }).map((m) => m.label)).not.toContain('Payroll');
    expect(moduleByKey('payroll').tabs.map((t) => t.label)).toEqual(['Staff', 'Run payroll', 'Advances', 'Lists', 'Rates', 'Settings']);
    expect(ROLE_LABELS.accounts).toBe('Accounts');
    expect(ROLE_HINTS.accounts).toMatch(/never a patient record/);
  });

  it('the pages belong to the Payroll menu item for page access', () => {
    expect(PAGE_KEYS).toContain('payroll');
    const menu = hospitalModules(['admin']);
    for (const path of ['/payroll', '/payroll/staff/new', '/payroll/staff/a1', '/payroll/run', '/payroll/advances', '/payroll/lists', '/payroll/rates', '/payroll/settings']) expect(pageForPath(path, menu), path).toBe('payroll');
  });

  it('shows a kept number as its last four characters only', () => {
    expect(maskedNumber({ kept: true, last4: '234F' })).toBe('•••• 234F');
    expect(maskedNumber({ kept: false, last4: '' })).toBe('Not kept');
    expect(maskedNumber(undefined)).toBe('Not kept');
  });

  it('names a person’s status and finds people by any word', () => {
    expect(staffStatus({ isActive: true, working: true })).toBe('working');
    expect(staffStatus({ isActive: true, working: false })).toBe('left');
    expect(staffStatus({ isActive: false, working: false })).toBe('off');
    const list = [staff, { ...staff, id: 'a2', staffNumber: 'S002', name: 'Sample Guard', designation: 'Security', department: 'Gate' }];
    expect(searchStaff(list, '').length).toBe(2);
    expect(searchStaff(list, 'guard').map((s) => s.id)).toEqual(['a2']);
    expect(searchStaff(list, 'sample housekeeping').map((s) => s.id)).toEqual(['a1']);
    expect(searchStaff(list, 's002').map((s) => s.id)).toEqual(['a2']);
    expect(codesFrom('A-12, 0045 ; 0045\n B-2 ')).toEqual(['A-12', '0045', 'B-2']);
  });
});

describe('payroll: the staff form', () => {
  it('starts from the person as kept, with the latest pay in the boxes and no number typed', () => {
    const form = formFrom(staff);
    expect(form).toMatchObject({ staffNumber: 'S001', codes: 'A-17, B-2', ifsc: 'HDFC0001234', payFrom: '2026-11-01', parts: { basic: '12000', hra: '3000' }, pf: true, esi: true, pt: false, tds: '500', userId: '', leftOn: '' });
    expect(form.numbers).toEqual({ uan: '', esiNumber: '', pan: '', accountNumber: '' });
    expect(emptyForm('S014')).toMatchObject({ staffNumber: 'S014', isActive: true, payFrom: '', parts: {} });
  });

  it('reads the pay typed: nothing typed is no pay, and what is wrong is said by its box', () => {
    expect(readPay(emptyForm(), PARTS)).toEqual({ pay: null, errors: {} });
    const typed = { ...emptyForm(), payFrom: '2026-11-01', parts: { basic: '12,000', hra: '3000.50' }, pf: true, tds: '' };
    expect(readPay(typed, PARTS).pay).toEqual({ from: '2026-11-01', parts: [{ key: 'basic', amountPaise: 1200000 }, { key: 'hra', amountPaise: 300050 }], pf: true, esi: false, pt: false, tdsPaise: 0 });
    expect(readPay({ ...typed, payFrom: '' }, PARTS).errors['pay.from']).toMatch(/day this pay starts/);
    expect(readPay({ ...typed, parts: { basic: 'twelve' } }, PARTS).errors['pay.parts']).toMatch(/Basic pay: write an amount/);
    expect(readPay({ ...typed, parts: {}, tds: '500' }, PARTS).errors['pay.parts']).toMatch(/at least one amount/);
    expect(readPay({ ...typed, tds: 'abc' }, PARTS).errors['pay.tdsPaise']).toMatch(/TDS/);
    expect(readPay({ ...typed, parts: { basic: '0' } }, PARTS).errors['pay.parts']).toMatch(/at least one amount/);
  });

  it('sends the pay only when it differs from the latest entry, and says what a new entry would do', () => {
    const form = formFrom(staff);
    expect(samePay(readPay(form, PARTS).pay, entry)).toBe(true);
    expect(staffBody(form, PARTS, entry).body.pay).toBeNull();
    expect(payAction(form, PARTS, entry)).toBe('none');
    const rise = { ...form, payFrom: '2027-01-01', parts: { basic: '14000', hra: '3000' } };
    expect(payAction(rise, PARTS, entry)).toBe('add');
    expect(staffBody(rise, PARTS, entry).body.pay).toMatchObject({ from: '2027-01-01', parts: [{ key: 'basic', amountPaise: 1400000 }, { key: 'hra', amountPaise: 300000 }] });
    expect(payAction({ ...form, parts: { basic: '12500', hra: '3000' } }, PARTS, entry)).toBe('correct');
    expect(payAction({ ...rise, payFrom: '2026-10-01' }, PARTS, entry)).toBe('early');
    expect(payAction({ ...emptyForm(), payFrom: '2026-11-01', parts: { basic: '9000' } }, PARTS, null)).toBe('first');
  });

  it('sends a typed number, leaves an empty box alone and removes a number only when asked', () => {
    const form = { ...formFrom(staff), userId: 'u1', leftOn: '2026-12-31', numbers: { uan: '', esiNumber: ' 3100200300 ', pan: 'abcde1234f', accountNumber: '' }, clear: { uan: true, esiNumber: false, pan: true, accountNumber: false } };
    const { body, errors } = staffBody(form, PARTS, entry);
    expect(errors).toEqual({});
    expect(body).toMatchObject({ staffNumber: 'S001', userId: 'u1', joinedOn: '2025-04-01', leftOn: '2026-12-31', attendanceCodes: ['A-17', 'B-2'], bank: { ifsc: 'HDFC0001234', bankName: 'Sample Bank' } });
    expect(body.numbers).toEqual({ uan: '', esiNumber: '3100200300', pan: '', accountNumber: '' }); // a number ticked for removal is not sent as typed
    expect(body.clearNumbers).toEqual(['uan', 'pan']);
    expect(staffBody({ ...emptyForm(), name: 'A' }, PARTS).errors).toEqual({ staffNumber: 'Write the staff number', name: 'Write the name' });
    expect(staffBody({ ...emptyForm('S9'), name: 'Sample Cleaner' }, PARTS).body).toMatchObject({ pay: null, joinedOn: null, leftOn: null, userId: null, attendanceCodes: [] });
  });

  it('the settings go out trimmed, a new part without a key', () => {
    const body = settingsBody({ parts: [{ key: 'basic', name: ' Basic pay ', countsForPf: true, countsForEsi: true }, { name: 'Night duty allowance', countsForPf: false }], dayBasis: 'twentySix', weeklyOffsPaid: false, holidaysPaid: true, rounding: 'nearest', confirmedBy: ' Sample Accountant ', confirmedOn: '', updatedByName: 'x' });
    expect(body).toEqual({ parts: [{ key: 'basic', name: 'Basic pay', countsForPf: true, countsForEsi: true }, { key: '', name: 'Night duty allowance', countsForPf: false, countsForEsi: false }], dayBasis: 'twentySix', weeklyOffsPaid: false, holidaysPaid: true, rounding: 'nearest', confirmedBy: 'Sample Accountant', confirmedOn: null, bankList: false, fullNumbers: false });
    expect(settingsBody({ parts: [], bankList: true, fullNumbers: 'yes' })).toMatchObject({ bankList: true, fullNumbers: false }); // only a real tick switches one on
  });
});

describe('payroll: the accounts login’s Today', () => {
  const overview = (o = {}) => ({ month: '2026-10', staff: { working: 4, left: 1, withoutPay: 0, withoutCode: 1 }, rules: { basisChosen: true, draft: false }, canKeepNumbers: true, canChangeSettings: false, run: { files: 1, expected: 4, codesToAnswer: 0, peopleToAnswer: 0, twoRows: 0, sheetReady: true, withoutSum: 0 }, ...o });

  it('says what is waiting, each with where to go – and the sheet once it is made', () => {
    expect(payrollToDo(null)).toEqual([]);
    expect(payrollToDo(overview())).toEqual([{ key: 'sheet', tone: 'stable', text: 'The salary sheet for October 2026 is made (4 staff members).', to: '/payroll/run?month=2026-10', link: 'Open the sheet' }]);
    const start = payrollToDo(overview({ staff: { working: 0, left: 0, withoutPay: 0, withoutCode: 0 }, rules: { basisChosen: false, draft: true }, canKeepNumbers: false, run: { files: 0, expected: 0, codesToAnswer: 0, peopleToAnswer: 0, twoRows: 0, sheetReady: false, withoutSum: 0 } }));
    expect(start.map((i) => i.key)).toEqual(['nobody', 'basis', 'key']); // no file is asked for while nobody is on the payroll
    expect(start[1].text).toBe('How one day’s pay is counted is not chosen yet. Ask the hospital admin to choose it.');
    expect(payrollToDo(overview({ canChangeSettings: true, rules: { basisChosen: false, draft: true } }))[0]).toMatchObject({ key: 'basis', link: 'Choose it in the settings', to: '/payroll/settings' });
    const busy = payrollToDo(overview({ staff: { working: 4, left: 0, withoutPay: 1, withoutCode: 2 }, rules: { basisChosen: true, draft: true }, run: { files: 1, expected: 4, codesToAnswer: 2, peopleToAnswer: 1, twoRows: 0, sheetReady: false, withoutSum: 0 } }));
    expect(busy.map((i) => [i.key, i.tone])).toEqual([['pay', 'watch'], ['draft', 'watch'], ['codes', 'watch'], ['noRow', 'watch']]);
    expect(busy.map((i) => i.text)).toEqual(['1 staff member has no pay entered.', 'The pay rules are DRAFT: the accountant’s name and date are not written yet.', '2 codes in the October 2026 file belong to nobody on the payroll.', '1 staff member has no row in the October 2026 file.']);
    expect(payrollToDo(overview({ run: { files: 0, expected: 4, codesToAnswer: 0, peopleToAnswer: 4, twoRows: 0, sheetReady: false, withoutSum: 0 } })).map((i) => [i.key, i.link])).toEqual([['file', 'Run payroll']]);
    expect(payrollToDo(overview({ run: { files: 1, expected: 4, codesToAnswer: 0, peopleToAnswer: 0, twoRows: 0, sheetReady: true, withoutSum: 1 } }))[0].text).toBe('The salary sheet for October 2026 is made (4 staff members), 1 without a sum.');
  });

  it('says whether the month can be locked, and when it is (Stages C and D)', () => {
    const run = (o) => ({ files: 1, expected: 4, codesToAnswer: 0, peopleToAnswer: 0, twoRows: 0, sheetReady: true, withoutSum: 0, locked: false, draftRates: 0, lockBlockers: 0, ...o });
    expect(payrollToDo(overview({ run: run({ lockBlockers: 3 }) })).map((i) => [i.key, i.tone, i.text])).toEqual([
      ['sheet', 'stable', 'The salary sheet for October 2026 is made (4 staff members).'],
      ['lock', 'watch', 'October 2026 can’t be locked yet: 3 things are still waiting.'],
    ]);
    expect(payrollToDo(overview({ run: run({ lockBlockers: 1 }) }))[1].text).toBe('October 2026 can’t be locked yet: 1 thing is still waiting.');
    expect(payrollToDo(overview({ run: run() }))[1]).toMatchObject({ key: 'lock', text: 'October 2026 is ready to be locked.', link: 'Lock the month' });
    expect(payrollToDo(overview({ run: run({ locked: true }) }))).toEqual([{ key: 'locked', tone: 'stable', text: 'October 2026 is locked. Payslips and the monthly lists are made from it.', to: '/payroll/run?month=2026-10', link: 'Open the month' }]);
    expect(payrollToDo(overview({ staff: { working: 4, left: 1, withoutPay: 0, withoutCode: 0, withoutSlab: 2 } }))[0]).toMatchObject({ key: 'slab', text: 'Professional tax is taken from 2 staff members whose slab is not chosen.' });
  });

  it('asks for the professional tax slab of a person it is taken from', () => {
    const form = { ...emptyForm('S9'), name: 'Sample Porter', payFrom: '2026-11-01', parts: { basic: '9000' }, pt: true };
    expect(staffBody(form, PARTS).errors).toEqual({ ptSlab: 'Choose which professional tax slab is this person’s' });
    const chosen = staffBody({ ...form, ptSlab: 'men' }, PARTS);
    expect(chosen.errors).toEqual({});
    expect(chosen.body).toMatchObject({ ptSlab: 'men', pay: { pt: true } });
    expect(staffBody({ ...emptyForm('S9'), name: 'Sample Porter' }, PARTS).body.ptSlab).toBe('');
    expect(formFrom({ staffNumber: 'S1', name: 'Sample', ptSlab: 'women', pay: [] }).ptSlab).toBe('women');
  });
});
