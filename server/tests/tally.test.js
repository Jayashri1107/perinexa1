// The Tally link (docs/TALLY_PLAN.md), step 1 – the file: the account names, what a batch holds, the entries written
// for bills, receipts, deposits, pharmacy invoices, credit notes and debit notes, corrections as reversing entries,
// the files, the entries' status, the marks on bills and invoices, the control sheet, and who may do what.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { billVector, classifyBillDelta, counterPaymentVector, depositsHeld, depositsVector, ledgerFor, nextKey, parentGroupFor } from '../src/tally/events.js';
import { gstinCheckChar } from '../src/pharmacy/gstin.js';
import { withDefaults } from '../src/tally/tallyRules.js';
import { mastersXml, remoteIdFor, voucherXml, vouchersXml, xmlText } from '../src/tally/xml.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin', accounts: 'billing' };

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Tally Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {}; // a new day: log in again
};
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const tally = async (method, path, body, who = 'admin') => (await as(who))[method](`/api/tally${path}`).send(body);
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);

async function register(name) {
  return ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() })), 201).patient;
}
async function prices(set) {
  const list = ok(await (await as('admin')).get('/api/billing/prices')).items;
  for (const [key, pricePaise] of Object.entries(set)) {
    const item = list.find((i) => i.key === key || i.name === key);
    ok(await (await as('admin')).patch(`/api/billing/prices/${item.id}`).send({ pricePaise }));
  }
}
const startVisit = async (p) => ok(await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 201).visit;
const order = async (p, tests) => ok(await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((key) => ({ key })) }), 201).order;
const billsOf = async (p) => ok(await (await as('reception')).get(`/api/billing/patient/${p.id}`)).bills;
const bill = async (id) => ok(await (await as('reception')).get(`/api/billing/bills/${id}`)).bill;
const pay = async (id, body) => ok(await (await as('reception')).post(`/api/billing/bills/${id}/payments`).send(body), 201).payment;
const settings = (body) => tally('put', '/settings', { companyName: 'Tally Hospital Books', booksFrom: '2026-09-01', ...body });
// A GSTIN with its check character (the 15th), for the made-up businesses in these tests.
const gstinWithCheck = (first14) => first14 + gstinCheckChar(first14);

// Every entry of a Tally file balances: its debits (negative amounts) and credits (positive) sum to zero
const vouchersIn = (xml) => xml.split('<VOUCHER ').slice(1);
const balanced = (xml) => {
  for (const v of vouchersIn(xml)) {
    const amounts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Math.round(Number(m[1]) * 100));
    expect(amounts.length, v.slice(0, 80)).toBeGreaterThan(1);
    expect(amounts.reduce((s, a) => s + a, 0), v.slice(0, 120)).toBe(0);
  }
};

describe('the entries worked out from the documents (pure)', () => {
  it('a bill: the hospital items per group less the discount; the pharmacy line is left out; a cancelled bill is nothing', () => {
    const b = {
      status: 'open',
      discount: { paise: 10000 },
      lines: [
        { group: 'consultation', amountPaise: 50000, ref: { kind: 'visit' } },
        { group: 'lab', amountPaise: 25000, ref: { kind: 'lab' }, removed: { reason: 'x' } },
        { group: 'medicine', amountPaise: 2240, ref: { kind: 'pharmacy' } },
        { group: 'scan', amountPaise: 90000, source: 'manual' },
      ],
    };
    expect([...billVector(b)]).toEqual([
      ['income:consultation', -50000],
      ['income:scan', -90000],
      ['discount', 10000],
      ['patients', 130000],
    ]);
    expect(billVector({ ...b, status: 'cancelled' }).size).toBe(0);
  });

  it('deposits of a stay are set against the bill at discharge – exactly what the receipts put into the deposits account', () => {
    const stay = { status: 'discharged', dischargedAt: new Date('2026-10-01T05:00:00Z') };
    const receipts = [{ lines: [{ role: 'mode:cash', paise: 300000, side: 'dr' }, { role: 'deposits', paise: 300000, side: 'cr' }] }, { lines: [{ role: 'deposits', paise: 50000, side: 'dr' }, { role: 'mode:cash', paise: 50000, side: 'cr' }] }];
    expect(depositsHeld(receipts)).toBe(250000);
    const b = { kind: 'ipd', status: 'open' };
    expect([...depositsVector(b, stay, 250000)]).toEqual([
      ['deposits', 250000],
      ['patients', -250000],
    ]);
    expect(depositsVector(b, { status: 'admitted' }, 250000).size).toBe(0);
    expect(depositsVector(b, stay, 0).size).toBe(0);
    expect(depositsVector({ ...b, status: 'cancelled' }, stay, 250000).size).toBe(2); // cancelling the bill undoes no deposit
  });

  it('a business buyer pays and is refunded on its own account, never on the walk-in account', () => {
    const inv = { patientId: null, buyer: { name: 'Sample Clinic LLP', gstin: '27AAAAA0000A1Z5' } };
    expect([...counterPaymentVector(inv, { kind: 'payment', mode: 'upi', amountPaise: 896 })]).toEqual([
      ['mode:upi', 896],
      ['buyer:27AAAAA0000A1Z5', -896],
    ]);
    expect([...counterPaymentVector({ patientId: null, customer: { name: 'x' } }, { kind: 'refund', mode: 'cash', amountPaise: 224 })]).toEqual([
      ['counter', 224],
      ['mode:cash', -224],
    ]);
  });

  it('a change after sending: more charged is Sales, less is a Credit note, moved between accounts is a Journal; keys count on', () => {
    expect(classifyBillDelta(new Map([['income:lab', 25000], ['patients', -25000]]))).toBe('credit_note');
    expect(classifyBillDelta(new Map([['income:lab', -25000], ['patients', 25000]]))).toBe('sales');
    expect(classifyBillDelta(new Map([['discount', 5000], ['patients', -5000]]))).toBe('credit_note');
    expect(classifyBillDelta(new Map([['income:lab', 25000], ['income:scan', -25000]]))).toBe('journal');
    expect(nextKey('B-000001', 'main', 'sales', [])).toBe('B-000001');
    expect(nextKey('B-000001', 'main', 'credit_note', [{ kind: 'sales' }])).toBe('B-000001/CN1');
    expect(nextKey('B-000001', 'main', 'sales', [{ kind: 'sales' }, { kind: 'credit_note' }])).toBe('B-000001/S2');
    expect(nextKey('B-000001', 'deposits', 'journal', [])).toBe('B-000001/DEP');
    expect(nextKey('B-000001', 'deposits', 'journal', [{ kind: 'journal' }])).toBe('B-000001/DEP2');
  });

  it('account names come from the settings, with starting names; a scheme may have its own; parties are named', () => {
    const s = withDefaults({ ledgers: { modes: { upi: 'HDFC Bank' }, schemes: [{ scheme: 'PM-JAY', ledger: 'PM-JAY receivable' }], pharmacySales: { 12: 'Medicine sales 12%' } } });
    expect(ledgerFor(s, 'mode:upi')).toBe('HDFC Bank');
    expect(ledgerFor(s, 'mode:cash')).toBe('Cash');
    expect(ledgerFor(s, 'insurance:pm-jay')).toBe('PM-JAY receivable');
    expect(ledgerFor(s, 'insurance:Star Health')).toBe('Insurance receivable');
    expect(ledgerFor(s, 'psales:12')).toBe('Medicine sales 12%');
    expect(ledgerFor(s, 'psales:5')).toBe('Pharmacy sales 5%');
    expect(ledgerFor(s, 'psales:0')).toBe('Pharmacy sales exempt');
    expect(ledgerFor(s, 'buyer:27AAAAA0000A1Z5', new Map([['buyer:27AAAAA0000A1Z5', { ledger: 'Sample Clinic LLP (27AAAAA0000A1Z5)' }]]))).toBe('Sample Clinic LLP (27AAAAA0000A1Z5)');
    expect(ledgerFor(s, 'buyer:27AAAAA0000A1Z5')).toBe('');
    expect(parentGroupFor('mode:cash')).toBe('Cash-in-Hand');
    expect(parentGroupFor('mode:upi')).toBe('Bank Accounts');
    expect(parentGroupFor('supplier:X')).toBe('Sundry Creditors');
    expect(parentGroupFor('ocgst')).toBe('Duties & Taxes');
  });

  it('the XML: names escaped, Tally dates, debits negative with the party first, the same id for the same key', () => {
    expect(xmlText('Maternity & Women\'s <Care> "x"')).toBe('Maternity &amp; Women&apos;s &lt;Care&gt; &quot;x&quot;');
    const id = remoteIdFor('507f1f77bcf86cd799439011', 'B-000001');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}$/);
    expect(remoteIdFor('507f1f77bcf86cd799439011', 'B-000001')).toBe(id);
    expect(remoteIdFor('507f1f77bcf86cd799439011', 'B-000002')).not.toBe(id);
    const v = voucherXml({
      key: 'B-000001',
      kind: 'sales',
      date: new Date('2026-09-28T00:00:00Z'),
      narration: 'Perinexa bill B-000001',
      remoteId: id,
      voucherType: 'Perinexa Sales',
      lines: [
        { role: 'patients', ledger: 'Patients', paise: 75000, side: 'dr' },
        { role: 'income:consultation', ledger: 'Consultation income', paise: 50000, side: 'cr' },
        { role: 'income:lab', ledger: 'Lab test income', paise: 25000, side: 'cr' },
      ],
    });
    expect(v).toContain('<DATE>20260928</DATE>');
    expect(v).toContain('<VOUCHERNUMBER>B-000001</VOUCHERNUMBER>');
    expect(v).toContain('<PARTYLEDGERNAME>Patients</PARTYLEDGERNAME>');
    expect(v).toContain('<LEDGERENTRIES.LIST><LEDGERNAME>Patients</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-750.00</AMOUNT></LEDGERENTRIES.LIST>');
    expect(v).toContain('<LEDGERNAME>Lab test income</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>250.00</AMOUNT>');
    // A "sales" entry with no party line (a 100 % discount) is written in the accounting view, never with a wrong party
    const noParty = voucherXml({ key: 'B-000002', kind: 'sales', date: new Date('2026-09-28T00:00:00Z'), narration: 'x', remoteId: id, voucherType: 'Perinexa Sales', lines: [{ role: 'discount', ledger: 'Discount allowed', paise: 500, side: 'dr' }, { role: 'income:scan', ledger: 'Scan income', paise: 500, side: 'cr' }] });
    expect(noParty).toContain('OBJVIEW="Accounting Voucher View"');
    expect(noParty).not.toContain('ISPARTYLEDGER');
    balanced(vouchersXml({ company: 'Books & Co', vouchers: [{ ...JSON.parse(JSON.stringify({ key: 'R-000001', kind: 'receipt', date: '2026-09-28T00:00:00Z', narration: 'x', remoteId: id, voucherType: 'Perinexa Receipt' })), lines: [{ ledger: 'Cash', paise: 50000, side: 'dr' }, { ledger: 'Patients', paise: 50000, side: 'cr' }] }] }));
    expect(vouchersXml({ company: 'Books & Co', vouchers: [] })).toContain('<SVCURRENTCOMPANY>Books &amp; Co</SVCURRENTCOMPANY>');
    const m = mastersXml({ company: 'Books', applicableFrom: '20260901', voucherTypes: [{ name: 'Perinexa Sales', parent: 'Sales' }], ledgers: [{ name: 'Patients', parent: 'Sundry Debtors' }, { name: 'Sample Distributors', parent: 'Sundry Creditors', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' }, { name: 'Island Clinic (35X)', parent: 'Sundry Debtors', gstin: '35AAAAA0000A1Z5', state: 'Andaman and Nicobar Islands' }] });
    expect(m).toContain('<VOUCHERTYPE NAME="Perinexa Sales" ACTION="Create"><NAME>Perinexa Sales</NAME><PARENT>Sales</PARENT><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>');
    expect(m).toContain('<LEDGER NAME="Patients" ACTION="Create"><NAME>Patients</NAME><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>No</ISBILLWISEON></LEDGER>');
    expect(m).toContain('<LEDGER NAME="Sample Distributors" ACTION="Create"><NAME>Sample Distributors</NAME><PARENT>Sundry Creditors</PARENT><ISBILLWISEON>No</ISBILLWISEON><PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN><LEDSTATENAME>Maharashtra</LEDSTATENAME><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20260901</APPLICABLEFROM><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTIN>27ABCDE1234F1Z5</GSTIN><PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY></LEDGSTREGDETAILS.LIST><LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20260901</APPLICABLEFROM><STATE>Maharashtra</STATE><COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST></LEDGER>');
    expect(m).toContain('<LEDSTATENAME>Andaman &amp; Nicobar Islands</LEDSTATENAME>'); // Tally's own spelling
  });
});

describe('settings and who may use the link', () => {
  it('the hospital admin keeps the settings; everyone else is refused; the audit log gets the names of the sections, never an account name', async () => {
    for (const who of ['reception', 'pharm', 'drA', 'nurse']) expect((await tally('get', '/settings', undefined, who)).status).toBe(403);
    // The accounts staff (19 Oct 2026) see the names but only the admin changes them
    expect(ok(await tally('get', '/settings', undefined, 'accounts')).canEdit).toBe(false);
    expect(ok(await tally('get', '/settings')).canEdit).toBe(true);
    expect((await tally('put', '/settings', { companyName: 'Other Books' }, 'accounts')).status).toBe(403);
    const first = ok(await tally('get', '/settings'));
    expect(first.settings).toMatchObject({ companyName: '', booksFrom: null, inpatientIssues: 'taxable', ledgers: expect.objectContaining({ patients: 'Patients', modes: expect.objectContaining({ upi: 'Bank (UPI)' }) }), voucherTypes: expect.objectContaining({ sales: 'Perinexa Sales' }) });
    const saved = ok(await settings({ ledgers: { modes: { upi: 'HDFC Bank' } } }));
    expect(saved.settings).toMatchObject({ companyName: 'Tally Hospital Books', booksFrom: '2026-09-01T00:00:00.000Z', updatedByName: 'Sample admin', ledgers: expect.objectContaining({ patients: 'Patients', modes: { cash: 'Cash', upi: 'HDFC Bank', card: 'Bank (card)', insurance: 'Insurance receivable' } }) });
    ok(await settings({ ledgers: { modes: { upi: 'HDFC Bank' } } })); // nothing changed: no new audit entry
    const entries = await AuditLog.find({ action: 'TALLY_SETTINGS_CHANGED' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ fields: ['companyName', 'booksFrom', 'ledgers'] });
    expect(JSON.stringify(entries[0].details)).not.toMatch(/HDFC/);
    expect((await tally('put', '/settings', { inpatientIssues: 'sometimes' })).status).toBe(400);
    expect((await tally('put', '/settings', { voucherTypes: { sales: '' } })).status).toBe(400);
    expect(ok(await tally('put', '/settings', { voucherTypes: { creditNote: 'Perinexa Sales' } }), 400).error.fields).toEqual({ voucherTypes: 'Each voucher type needs a different name.' });
    // Naming one account never resets the others in its section
    expect(ok(await settings({ ledgers: { modes: { card: 'Axis Bank' } } })).settings.ledgers.modes).toEqual({ cash: 'Cash', upi: 'HDFC Bank', card: 'Axis Bank', insurance: 'Insurance receivable' });
  });

  it('what stops a batch: no company name or start of the books, a day that is not over, a day before the books start', async () => {
    const empty = ok(await tally('get', '/preview'));
    expect(empty.problems.blockers).toEqual([expect.stringMatching(/company’s name/), expect.stringMatching(/day the books start/)]);
    ok(await settings({}));
    expect(ok(await tally('get', '/preview?to=2026-09-28')).problems.blockers).toEqual([expect.stringMatching(/yesterday or an earlier day/)]);
    expect(ok(await tally('get', '/preview?to=2026-08-31')).problems.blockers).toEqual([expect.stringMatching(/books start on 1 Sep 2026/)]);
    const yesterday = ok(await tally('get', '/preview'));
    expect(yesterday).toMatchObject({ from: '2026-09-01', to: '2026-09-27', entries: 0, resend: 0, problems: { blockers: [], warnings: [] } });
    expect((await tally('post', '/batches', { to: '2026-09-27' })).status).toBe(409); // nothing to send
    expect((await tally('post', '/batches', { to: '2026-09-27' }, 'reception')).status).toBe(403);
  });
});

describe('batches, files, corrections and the trail', () => {
  it('bills, receipts, pharmacy invoices, credit notes and debit notes become entries; a later change is a reversing entry; files balance and hold no names', async () => {
    ok(await settings({}));
    await prices({ consult_new: 50000, 'lab:cbc': 25000 });
    const mother = await register('Tally Mother');
    await startVisit(mother);
    await order(mother, ['cbc']);
    const [b] = await billsOf(mother);
    expect(b).toMatchObject({ number: 'B-000001', total: 75000 });
    expect(await pay(b.id, { mode: 'cash', amountPaise: 50000 })).toMatchObject({ receipt: 'R-000001', kind: 'payment' });

    // The pharmacy: a sale to her (on her hospital bill) and a walk-in paid at the counter, both at 5 % GST
    const folic = ok(await ph('post', '/medicines', { name: 'Folic Secret Tab', generic: 'Folic acid', form: 'tablet', unit: 'tablet', hsn: '3004', gstRate: 5 }), 201).medicine;
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Distributors', gstin: '27ABCDE1234F1Z5' }), 201).supplier;
    ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'SUP-1', invoiceDate: '2026-09-27', lines: [{ medicineId: folic.id, batch: 'FA1', expiry: '2027-06', qty: 100, ratePaise: 100, mrpPaise: 224 }] }), 201);
    const inv = ok(await ph('post', '/invoices', { kind: 'sale', patientId: mother.id, lines: [{ medicineId: folic.id, qty: 10 }] }), 201).invoice;
    expect(inv).toMatchObject({ number: 'PH-000001', netPaise: 2240 });
    expect(inv.lines[0]).toMatchObject({ taxablePaise: 2133, cgstPaise: 53, sgstPaise: 54 });
    const walk = ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Walk In Secret' }, payment: { mode: 'cash' }, lines: [{ medicineId: folic.id, qty: 2 }] }), 201).invoice;
    expect(walk).toMatchObject({ number: 'PH-000002', netPaise: 448 });
    expect(await bill(b.id)).toMatchObject({ total: 77240, paid: 50000 });

    // The next day: what the batch up to yesterday holds
    later('2026-09-29T06:00:00Z');
    const pv = ok(await tally('get', '/preview?to=2026-09-28'));
    expect(pv).toMatchObject({ from: '2026-09-01', to: '2026-09-28', entries: 5, resend: 0, byKind: { sales: 3, receipt: 2 }, amountPaise: 75000 + 50000 + 2240 + 448 + 448, problems: { blockers: [], warnings: [] } });
    expect(pv.newLedgers.map((l) => l.name).sort()).toEqual(['Cash', 'Consultation income', 'Lab test income', 'Patients', 'Pharmacy counter customers', 'Pharmacy sales 5%']);
    expect(pv.newVoucherTypes).toEqual(['Perinexa Sales', 'Perinexa Receipt', 'Perinexa Payment', 'Perinexa Credit Note', 'Perinexa Debit Note', 'Perinexa Journal']);
    expect(pv.gstLedgers).toEqual(['Output CGST', 'Output SGST']);

    const made = ok(await tally('post', '/batches', { to: '2026-09-28' }), 201).batch;
    expect(made).toMatchObject({ number: 'TB-000001', from: '2026-09-01', to: '2026-09-28', vouchers: 5, byKind: { sales: 3, receipt: 2 }, hasMastersFile: true, imported: null });
    const one = ok(await tally('get', `/batches/${made.id}`));
    expect(one.vouchers.map((v) => [v.key, v.kind, v.status])).toEqual([
      ['B-000001', 'sales', 'exported'],
      ['PH-000001', 'sales', 'exported'],
      ['PH-000002', 'sales', 'exported'],
      ['PH-000002/P1', 'receipt', 'exported'],
      ['R-000001', 'receipt', 'exported'],
    ]);
    const hospitalSale = one.vouchers.find((v) => v.key === 'B-000001');
    expect(hospitalSale.lines).toEqual([
      { ledger: 'Patients', paise: 75000, side: 'dr' },
      { ledger: 'Consultation income', paise: 50000, side: 'cr' },
      { ledger: 'Lab test income', paise: 25000, side: 'cr' },
    ]);
    expect(one.vouchers.find((v) => v.key === 'PH-000001').lines).toEqual([
      { ledger: 'Patients', paise: 2240, side: 'dr' },
      { ledger: 'Output CGST', paise: 53, side: 'cr' },
      { ledger: 'Output SGST', paise: 54, side: 'cr' },
      { ledger: 'Pharmacy sales 5%', paise: 2133, side: 'cr' },
    ]);
    expect(one.vouchers.find((v) => v.key === 'PH-000002/P1').lines).toEqual([
      { ledger: 'Pharmacy counter customers', paise: 448, side: 'cr' },
      { ledger: 'Cash', paise: 448, side: 'dr' },
    ]);

    // The files: entries (balanced, Perinexa's numbers, no names) and account names (not the GST accounts)
    expect((await tally('get', `/batches/${made.id}/file`, undefined, 'reception')).status).toBe(403);
    const file = await tally('get', `/batches/${made.id}/file?part=vouchers`);
    expect(file.status).toBe(200);
    expect(ok(await tally('get', '/batches', undefined, 'accounts')).batches.map((b) => b.number)).toEqual(['TB-000001']); // the accounts staff see the batches
    expect(file.headers['content-type']).toMatch(/application\/xml/);
    expect(file.headers['content-disposition']).toBe('attachment; filename="perinexa-tally-TB-000001-entries.xml"');
    const xml = file.text;
    expect(vouchersIn(xml)).toHaveLength(5);
    balanced(xml);
    expect(xml).toContain('<SVCURRENTCOMPANY>Tally Hospital Books</SVCURRENTCOMPANY>');
    expect(xml).toContain('VCHTYPE="Perinexa Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"');
    expect(xml).toContain('<VOUCHERNUMBER>R-000001</VOUCHERNUMBER>');
    expect(xml).toContain('<NARRATION>Perinexa payment R-000001 on bill B-000001</NARRATION>');
    expect(xml).toContain('<LEDGERNAME>Patients</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-750.00</AMOUNT>');
    expect(xml).not.toMatch(/Tally Mother|Walk In Secret|Folic|Secret|P-0000/);
    const again = await tally('get', `/batches/${made.id}/file?part=vouchers`);
    expect(again.text).toBe(xml); // the same bytes every time
    const masters = await tally('get', `/batches/${made.id}/file?part=masters`);
    expect(masters.headers['content-disposition']).toBe('attachment; filename="perinexa-tally-TB-000001-account-names.xml"');
    expect(masters.text).toContain('<LEDGER NAME="Patients" ACTION="Create"><NAME>Patients</NAME><PARENT>Sundry Debtors</PARENT>');
    expect(masters.text).toContain('<LEDGER NAME="Cash" ACTION="Create"><NAME>Cash</NAME><PARENT>Cash-in-Hand</PARENT>');
    expect(masters.text).toContain('<VOUCHERTYPE NAME="Perinexa Receipt" ACTION="Create">');
    expect(masters.text).not.toMatch(/Output CGST|Output SGST/);

    // The one file (owner, 19 Oct 2026): the account names first, then the same entries, in one import
    const all = await tally('get', `/batches/${made.id}/file?part=all`);
    expect(all.status).toBe(200);
    expect(all.headers['content-disposition']).toBe('attachment; filename="perinexa-tally-TB-000001-all-in-one.xml"');
    expect(all.text).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(all.text).toContain('<REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>Tally Hospital Books</SVCURRENTCOMPANY>');
    expect(vouchersIn(all.text)).toHaveLength(5);
    balanced(all.text);
    expect(all.text.indexOf('<VOUCHERTYPE NAME="Perinexa Receipt"')).toBeGreaterThan(0);
    expect(all.text.indexOf('<LEDGER NAME="Patients"')).toBeLessThan(all.text.indexOf('<VOUCHER '));
    for (const v of vouchersIn(xml)) expect(all.text).toContain(v.slice(0, v.indexOf('</VOUCHER>'))); // the very same entries
    expect(all.text).not.toMatch(/Tally Mother|Walk In Secret|Folic|Secret|P-0000|LEDGER NAME="Output/);
    expect((await tally('get', `/batches/${made.id}/file?part=everything`)).status).toBe(400);
    expect((await tally('get', `/batches/${made.id}`)).body.batch.downloads).toEqual({ all: 1, vouchers: 2, masters: 1 });
    expect((await AuditLog.find({ action: 'TALLY_FILE_DOWNLOADED' }).lean()).map((e) => e.details.part)).toEqual(['vouchers', 'vouchers', 'masters', 'all']);

    // The same day again: refused; a day with nothing new: nothing to send
    expect(ok(await tally('post', '/batches', { to: '2026-09-28' }), 409).error.code).toBe('INCOMPLETE');
    later('2026-09-30T06:00:00Z');
    expect(ok(await tally('post', '/batches', { to: '2026-09-29' }), 409).error.code).toBe('NOTHING');

    // Changes after the first file: the lab test is taken off her bill, she returns 2 tablets, 10 tablets go back to the supplier
    const full = await bill(b.id);
    const lab = full.lines.find((l) => l.group === 'lab');
    ok(await (await as('reception')).post(`/api/billing/bills/${b.id}/lines/${lab.id}/remove`).send({ reason: 'Test not done' }));
    expect(ok(await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 2 }], reason: 'Unopened strip returned' })).creditNote).toBe('CN-000001');
    const offer = ok(await ph('get', `/supplier-returns/batches?supplierId=${sup.id}`));
    const ret = ok(await ph('post', '/supplier-returns', { supplierId: sup.id, reason: 'excess', lines: [{ batchId: offer.batches[0].id, qty: 10 }] }), 201).return;
    expect(ret).toMatchObject({ number: 'SR-000001', totals: { taxablePaise: 1000, cgstPaise: 25, sgstPaise: 25, amountPaise: 1050 } });

    later('2026-10-01T06:00:00Z');
    const pv2 = ok(await tally('get', '/preview?to=2026-09-30'));
    expect(pv2).toMatchObject({ from: '2026-09-29', to: '2026-09-30', entries: 3, byKind: { credit_note: 2, debit_note: 1 } });
    expect(pv2.newLedgers.map((l) => l.name).sort()).toEqual(['Purchase returns', 'Sample Distributors']);
    expect(pv2.gstLedgers).toEqual(['Input CGST', 'Input SGST', 'Output CGST', 'Output SGST']);
    const second = ok(await tally('post', '/batches', { to: '2026-09-30' }), 201).batch;
    expect(second).toMatchObject({ number: 'TB-000002', vouchers: 3 });
    const two = ok(await tally('get', `/batches/${second.id}`));
    const byKey = Object.fromEntries(two.vouchers.map((v) => [v.key, v]));
    expect(byKey['B-000001/CN1']).toMatchObject({ kind: 'credit_note', date: '2026-09-30', amountPaise: 25000, narration: 'Perinexa bill B-000001 - change after it was sent' });
    expect(byKey['B-000001/CN1'].lines).toEqual([
      { ledger: 'Patients', paise: 25000, side: 'cr' },
      { ledger: 'Lab test income', paise: 25000, side: 'dr' },
    ]);
    expect(byKey['CN-000001']).toMatchObject({ kind: 'credit_note', amountPaise: 448 });
    expect(byKey['CN-000001'].lines).toEqual(expect.arrayContaining([{ ledger: 'Patients', paise: 448, side: 'cr' }, { ledger: 'Pharmacy sales 5%', paise: 427, side: 'dr' }, { ledger: 'Output CGST', paise: 10, side: 'dr' }, { ledger: 'Output SGST', paise: 11, side: 'dr' }]));
    expect(byKey['SR-000001']).toMatchObject({ kind: 'debit_note', amountPaise: 1050 });
    expect(byKey['SR-000001'].lines).toEqual(expect.arrayContaining([{ ledger: 'Sample Distributors', paise: 1050, side: 'dr' }, { ledger: 'Purchase returns', paise: 1000, side: 'cr' }, { ledger: 'Input CGST', paise: 25, side: 'cr' }, { ledger: 'Input SGST', paise: 25, side: 'cr' }]));
    const xml2 = (await tally('get', `/batches/${second.id}/file`)).text;
    balanced(xml2);
    expect(xml2).toContain('VCHTYPE="Perinexa Credit Note"');
    expect(xml2).toContain('<REFERENCE>B-000001</REFERENCE>');
    const masters2 = (await tally('get', `/batches/${second.id}/file?part=masters`)).text;
    expect(masters2).toContain('<LEDGER NAME="Sample Distributors" ACTION="Create"><NAME>Sample Distributors</NAME><PARENT>Sundry Creditors</PARENT><ISBILLWISEON>No</ISBILLWISEON><PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>');
    expect(masters2).not.toContain('<VOUCHERTYPE'); // introduced by the first batch

    // Marks on the bill and the invoice
    const marks = ok(await tally('get', `/marks?model=bill&id=${b.id}`)).marks;
    expect(marks.map((m) => [m.key, m.kind, m.status, m.batchNumber])).toEqual([
      ['B-000001', 'sales', 'exported', 'TB-000001'],
      ['R-000001', 'receipt', 'exported', 'TB-000001'],
      ['B-000001/CN1', 'credit_note', 'exported', 'TB-000002'],
    ]);
    expect(ok(await tally('get', `/marks?model=invoice&id=${inv.id}`)).marks.map((m) => m.key)).toEqual(['PH-000001', 'CN-000001']);

    // Tally refused one entry: the admin records its words, sends it again in the next file, then confirms the batch
    const cn1 = byKey['B-000001/CN1'];
    expect((await tally('post', `/vouchers/${cn1.id}/status`, { status: 'failed', note: '' })).status).toBe(400);
    expect(ok(await tally('post', `/vouchers/${cn1.id}/status`, { status: 'failed', note: 'Voucher totals do not match' })).voucher).toMatchObject({ status: 'failed', statusLabel: 'Refused by Tally', note: 'Voucher totals do not match' });
    expect(ok(await tally('get', '/vouchers?status=failed')).vouchers.map((v) => v.key)).toEqual(['B-000001/CN1']);
    expect(ok(await tally('post', `/vouchers/${cn1.id}/status`, { status: 'exported' })).voucher).toMatchObject({ status: 'exported', batchNumber: '' });
    ok(await tally('post', `/vouchers/${cn1.id}/status`, { status: 'skipped', note: 'x' }), 400); // a reason is needed
    later('2026-10-02T06:00:00Z');
    const pv3 = ok(await tally('get', '/preview?to=2026-10-01'));
    expect(pv3).toMatchObject({ entries: 0, resend: 1 });
    const third = ok(await tally('post', '/batches', { to: '2026-10-01' }), 201).batch;
    expect(third).toMatchObject({ number: 'TB-000003', vouchers: 1, hasMastersFile: false });
    expect((await tally('get', `/batches/${third.id}/file?part=masters`)).status).toBe(404);
    const xml3 = (await tally('get', `/batches/${third.id}/file`)).text;
    expect(vouchersIn(xml3)).toHaveLength(1);
    const idOf = (xml, key) => /REMOTEID="([^"]+)"/.exec(vouchersIn(xml).find((v) => v.includes(`<VOUCHERNUMBER>${key}</VOUCHERNUMBER>`)))[1];
    expect(idOf(xml3, 'B-000001/CN1')).toBe(idOf(xml2, 'B-000001/CN1')); // the same id as before: Tally overwrites, never doubles
    expect(ok(await tally('post', `/batches/${third.id}/imported`))).toMatchObject({ count: 1, batch: { imported: { byName: 'Sample admin' } } });
    expect(ok(await tally('get', `/batches/${made.id}`)).vouchers.every((v) => v.status === 'exported')).toBe(true);
    expect(ok(await tally('post', `/batches/${made.id}/imported`)).count).toBe(5);

    // The control sheet for September: Patients debited for her bill and pharmacy invoice, credited for her receipt and the two credit notes
    const sheet = ok(await tally('get', '/control?month=2026-09'));
    expect(sheet).toMatchObject({ month: '2026-09', entries: 8, statuses: expect.objectContaining({ imported: 6, exported: 2 }) });
    expect(sheet.rows.find((r) => r.ledger === 'Patients')).toEqual({ ledger: 'Patients', debitPaise: 77240, creditPaise: 75448 });
    expect(sheet.rows.find((r) => r.ledger === 'Cash')).toEqual({ ledger: 'Cash', debitPaise: 50448, creditPaise: 0 });
    expect(ok(await tally('get', '/batches')).statuses).toEqual({ imported: 6, exported: 2 });

    // The audit log: numbers, counts and status words – never an account name or a note
    expect(await AuditLog.countDocuments({ action: 'TALLY_BATCH_CREATED' })).toBe(3);
    expect(await AuditLog.countDocuments({ action: 'TALLY_FILE_DOWNLOADED' })).toBe(7);
    const statusEntries = await AuditLog.find({ action: 'TALLY_VOUCHER_STATUS' }).lean();
    expect(statusEntries.length).toBe(4);
    expect(JSON.stringify(statusEntries)).not.toMatch(/totals do not match|Patients/);
  });

  it('a stay: deposits go to the deposits account as they come; the bill and the deposits set against it go at discharge', async () => {
    ok(await settings({}));
    await prices({ bed: 100000, consult_new: 50000 });
    const mother = await register('Stay Mother');
    const admitted = ok(await (await as('drA')).post(`/api/patients/${mother.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'general', reason: 'Labour pains' }), 201).admission;
    await startVisit(mother);
    const [b] = await billsOf(mother);
    expect(b).toMatchObject({ kind: 'ipd' });
    expect(await pay(b.id, { mode: 'cash', amountPaise: 300000 })).toMatchObject({ kind: 'deposit', receipt: 'R-000001' });

    later('2026-09-29T06:00:00Z');
    const pv = ok(await tally('get', '/preview?to=2026-09-28'));
    expect(pv).toMatchObject({ entries: 1, byKind: { receipt: 1 } });
    expect(pv.problems.warnings).toEqual([expect.stringMatching(/1 stay bill .* will go at discharge/)]);
    const first = ok(await tally('post', '/batches', { to: '2026-09-28' }), 201).batch;
    const v1 = ok(await tally('get', `/batches/${first.id}`)).vouchers[0];
    expect(v1).toMatchObject({ key: 'R-000001', kind: 'receipt' });
    expect(v1.lines).toEqual([
      { ledger: 'Cash', paise: 300000, side: 'dr' },
      { ledger: 'Patient deposits', paise: 300000, side: 'cr' },
    ]);

    // Discharged on 1 Oct (3 bed days: 28, 29, 30 Sep); the rest is paid by UPI after discharge
    await Admission.updateOne({ tenantId: hospital._id, _id: admitted.id }, { $set: { status: 'discharged', dischargedAt: new Date('2026-10-01T05:00:00Z') } });
    later('2026-10-01T08:00:00Z');
    expect(await pay(b.id, { mode: 'upi', amountPaise: 50000, reference: 'UPI123' })).toMatchObject({ kind: 'payment', receipt: 'R-000002' });
    later('2026-10-02T06:00:00Z');
    const second = ok(await tally('post', '/batches', { to: '2026-10-01' }), 201).batch;
    expect(second).toMatchObject({ vouchers: 3, byKind: { sales: 1, journal: 1, receipt: 1 } });
    const byKey = Object.fromEntries(ok(await tally('get', `/batches/${second.id}`)).vouchers.map((v) => [v.key, v]));
    expect(byKey['B-000001']).toMatchObject({ kind: 'sales', date: '2026-10-01', amountPaise: 350000 });
    expect(byKey['B-000001'].lines).toEqual([
      { ledger: 'Patients', paise: 350000, side: 'dr' },
      { ledger: 'Consultation income', paise: 50000, side: 'cr' },
      { ledger: 'Inpatient income', paise: 300000, side: 'cr' },
    ]);
    expect(byKey['B-000001/DEP']).toMatchObject({ kind: 'journal', date: '2026-10-01' });
    expect(byKey['B-000001/DEP'].lines).toEqual([
      { ledger: 'Patients', paise: 300000, side: 'cr' },
      { ledger: 'Patient deposits', paise: 300000, side: 'dr' },
    ]);
    expect(byKey['R-000002'].lines).toEqual([
      { ledger: 'Patients', paise: 50000, side: 'cr' },
      { ledger: 'Bank (UPI)', paise: 50000, side: 'dr' },
    ]);
    balanced((await tally('get', `/batches/${second.id}/file`)).text);
    // Everything about the stay now adds up to nothing owed: Patients 350000 debited, 300000 + 50000 credited
    const sheet = ok(await tally('get', '/control?month=2026-10'));
    expect(sheet.rows.find((r) => r.ledger === 'Patients')).toEqual({ ledger: 'Patients', debitPaise: 350000, creditPaise: 350000 });
  });

  it('a stay cancelled after discharge, with its deposit given back, leaves nothing held and nothing owed', async () => {
    ok(await settings({}));
    await prices({ bed: 100000, consult_new: 50000 });
    const mother = await register('Cancelled Stay Mother');
    const admitted = ok(await (await as('drA')).post(`/api/patients/${mother.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'general', reason: 'Observation' }), 201).admission;
    await startVisit(mother);
    const [b] = await billsOf(mother);
    await pay(b.id, { mode: 'cash', amountPaise: 300000 }); // R-000001, a deposit
    await Admission.updateOne({ tenantId: hospital._id, _id: admitted.id }, { $set: { status: 'discharged', dischargedAt: new Date('2026-09-29T05:00:00Z') } });
    later('2026-09-30T06:00:00Z');
    const first = ok(await tally('post', '/batches', { to: '2026-09-29' }), 201).batch;
    expect(first.byKind).toEqual({ sales: 1, journal: 1, receipt: 1 }); // the stay (1 bed day + consultation = 150000), its deposits set against it, the deposit

    // Then every item is taken off, the whole deposit given back (after discharge: from her account), and the bill cancelled
    const full = await bill(b.id);
    for (const l of full.lines) ok(await (await as('reception')).post(`/api/billing/bills/${b.id}/lines/${l.id}/remove`).send({ reason: 'Admitted by mistake' }));
    expect(await pay(b.id, { mode: 'cash', amountPaise: 300000, kind: 'refund' })).toMatchObject({ kind: 'refund', receipt: 'R-000002' });
    ok(await (await as('reception')).post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Admitted by mistake' }));
    later('2026-10-01T06:00:00Z');
    const second = ok(await tally('post', '/batches', { to: '2026-09-30' }), 201).batch;
    const keys = ok(await tally('get', `/batches/${second.id}`)).vouchers.map((v) => [v.key, v.kind]);
    expect(keys).toEqual([
      ['B-000001/CN1', 'credit_note'],
      ['R-000002', 'payment'],
    ]); // no second deposits entry: what was deposited and given back stands
    const sheet = ok(await tally('get', '/control?month=2026-09'));
    expect(sheet.rows.find((r) => r.ledger === 'Patients')).toEqual({ ledger: 'Patients', debitPaise: 150000 + 300000, creditPaise: 300000 + 150000 });
    expect(sheet.rows.find((r) => r.ledger === 'Patient deposits')).toEqual({ ledger: 'Patient deposits', debitPaise: 300000, creditPaise: 300000 });
  });

  it('a business buyer settles on its own account; an insurance payment is a journal; a change after the batch’s day waits; a corrected name goes with the resend', async () => {
    ok(await settings({ ledgers: { modes: { insurance: 'Insurance recievable' } } })); // a misspelt name, corrected later
    await prices({ consult_new: 50000, 'lab:cbc': 25000 });
    const mother = await register('Scheme Mother');
    await startVisit(mother);
    await order(mother, ['cbc']);
    const [b] = await billsOf(mother);
    expect(await pay(b.id, { mode: 'insurance', amountPaise: 30000, scheme: 'PM-JAY' })).toMatchObject({ receipt: 'R-000001' });
    const folic = ok(await ph('post', '/medicines', { name: 'Folic Secret Tab', generic: 'Folic acid', form: 'tablet', unit: 'tablet', hsn: '3004', gstRate: 5 }), 201).medicine;
    const sup = ok(await ph('post', '/suppliers', { name: 'Sample Distributors', gstin: '27ABCDE1234F1Z5' }), 201).supplier;
    ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: 'SUP-1', invoiceDate: '2026-09-27', lines: [{ medicineId: folic.id, batch: 'FA1', expiry: '2027-06', qty: 100, ratePaise: 100, mrpPaise: 224 }] }), 201);
    const gstin = gstinWithCheck('27AAAAA0000A1Z'); // a well-formed GSTIN for a made-up business
    const inv = ok(await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Clinic LLP' }, buyer: { name: 'Sample Clinic LLP', gstin, address: '1 Sample Road', place: 'Pune', pin: '411001' }, payment: { mode: 'upi', reference: 'U77' }, lines: [{ medicineId: folic.id, qty: 4 }] }), 201).invoice;
    expect(inv).toMatchObject({ number: 'PH-000001', netPaise: 896 });
    ok(await ph('post', `/invoices/${inv.id}/returns`, { items: [{ lineId: inv.lines[0].id, qty: 1 }], reason: 'Unopened strip returned', refund: { mode: 'upi' } }));

    later('2026-09-29T06:00:00Z');
    const made = ok(await tally('post', '/batches', { to: '2026-09-28' }), 201).batch;
    const byKey = Object.fromEntries(ok(await tally('get', `/batches/${made.id}`)).vouchers.map((v) => [v.key, v]));
    const buyerLedger = `Sample Clinic LLP (${gstin})`;
    expect(byKey['R-000001']).toMatchObject({ kind: 'journal' }); // an insurer's account, not cash: a journal
    expect(byKey['R-000001'].lines).toEqual([
      { ledger: 'Insurance recievable', paise: 30000, side: 'dr' },
      { ledger: 'Patients', paise: 30000, side: 'cr' },
    ]);
    expect(byKey['PH-000001'].lines[0]).toEqual({ ledger: buyerLedger, paise: 896, side: 'dr' });
    expect(byKey['PH-000001/P1'].lines).toEqual([
      { ledger: buyerLedger, paise: 896, side: 'cr' },
      { ledger: 'Bank (UPI)', paise: 896, side: 'dr' },
    ]);
    expect(byKey['CN-000001'].lines[0]).toEqual({ ledger: buyerLedger, paise: 224, side: 'cr' });
    expect(byKey['PH-000001/RF1'].lines).toEqual([
      { ledger: buyerLedger, paise: 224, side: 'dr' },
      { ledger: 'Bank (UPI)', paise: 224, side: 'cr' },
    ]);
    const masters = (await tally('get', `/batches/${made.id}/file?part=masters`)).text;
    expect(masters).toContain(`<LEDGER NAME="${buyerLedger}" ACTION="Create"><NAME>${buyerLedger}</NAME><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>No</ISBILLWISEON><PARTYGSTIN>${gstin}</PARTYGSTIN><LEDSTATENAME>Maharashtra</LEDSTATENAME>`);
    expect(masters).toContain('<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20260901</APPLICABLEFROM>');
    expect(masters).not.toMatch(/1 Sample Road|411001|Pune/); // the buyer's address never leaves
    const sheet = ok(await tally('get', '/control?month=2026-09'));
    expect(sheet.rows.find((r) => r.ledger === buyerLedger)).toEqual({ ledger: buyerLedger, debitPaise: 896 + 224, creditPaise: 896 + 224 });

    // A change made after the batch's last day waits for the batch that covers its day
    later('2026-09-30T06:00:00Z');
    const lab = (await bill(b.id)).lines.find((l) => l.group === 'lab');
    ok(await (await as('reception')).post(`/api/billing/bills/${b.id}/lines/${lab.id}/remove`).send({ reason: 'Test not done' }));
    expect(ok(await tally('get', '/preview?to=2026-09-29'))).toMatchObject({ entries: 0, resend: 0 });
    later('2026-10-01T06:00:00Z');
    expect(ok(await tally('get', '/preview?to=2026-09-30'))).toMatchObject({ entries: 1, byKind: { credit_note: 1 } });

    // Tally refused the journal because the account does not exist: the name is corrected, the entry sent again with the new name
    ok(await tally('post', `/vouchers/${byKey['R-000001'].id}/status`, { status: 'failed', note: 'Ledger Insurance recievable does not exist' }));
    ok(await settings({ ledgers: { modes: { insurance: 'Insurance receivable' } } }));
    ok(await tally('post', `/vouchers/${byKey['R-000001'].id}/status`, { status: 'exported' }));
    const next = ok(await tally('post', '/batches', { to: '2026-09-30' }), 201).batch;
    expect(next).toMatchObject({ vouchers: 2 });
    const xml = (await tally('get', `/batches/${next.id}/file`)).text;
    expect(xml).toContain('<LEDGERNAME>Insurance receivable</LEDGERNAME>');
    expect(xml).not.toContain('recievable');
    expect(vouchersIn(xml)).toHaveLength(2);
    balanced(xml);
  });

  it('another hospital sees nothing of these batches; the super admin is refused', async () => {
    ok(await settings({}));
    await prices({ consult_new: 50000 });
    await startVisit(await register('Separate Mother'));
    later('2026-09-29T06:00:00Z');
    const made = ok(await tally('post', '/batches', { to: '2026-09-28' }), 201).batch;
    const other = await createTenant('Other Tally Hospital');
    const otherAdmin = await createUser({ name: 'Other Admin' });
    await addMember(otherAdmin, other, 'admin');
    const elsewhere = await loginAs(otherAdmin, { app });
    expect(ok(await elsewhere.get('/api/tally/batches')).batches).toEqual([]);
    expect((await elsewhere.get(`/api/tally/batches/${made.id}`)).status).toBe(404);
    expect((await elsewhere.get(`/api/tally/batches/${made.id}/file`)).status).toBe(404);
    expect((await elsewhere.post(`/api/tally/batches/${made.id}/imported`).send({})).status).toBe(404);
    const voucher = ok(await tally('get', `/batches/${made.id}`)).vouchers[0];
    expect((await elsewhere.post(`/api/tally/vouchers/${voucher.id}/status`).send({ status: 'imported' })).status).toBe(404);
    expect(ok(await elsewhere.get(`/api/tally/marks?model=bill&id=${voucher.source.id}`)).marks).toEqual([]);
    expect(ok(await elsewhere.get('/api/tally/settings')).settings.companyName).toBe('');
    const platform = await loginAs(await createSuperAdmin(), { app });
    expect((await platform.get('/api/tally/batches')).status).toBe(403);
  });
});
