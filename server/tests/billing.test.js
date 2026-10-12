// Billing (docs/BILLING_PLAN.md): the price list, charges added by the work done (visits, lab orders, stays and bed
// days), payments, deposits, refunds, discounts, cancelling, the reports, the export, and who may do what.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bedDays, rupees, toPaise, totals } from '../src/billing/money.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin', billing: 'billing' };

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
  hospital = await createTenant('Billing Hospital');
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

async function register(name) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function prices(set) {
  const list = (await (await as('admin')).get('/api/billing/prices')).body.items;
  for (const [key, pricePaise] of Object.entries(set)) {
    const item = list.find((i) => i.key === key || i.name === key);
    const res = await (await as('admin')).patch(`/api/billing/prices/${item.id}`).send({ pricePaise });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return list;
}
const startVisit = async (p, visitOn) => (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) })).body.visit;
const order = async (p, tests) => {
  const res = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((key) => ({ key })) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order;
};
const billsOf = async (p) => (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
const bill = async (id, who = 'reception') => (await (await as(who)).get(`/api/billing/bills/${id}`)).body.bill;
const pay = async (id, body, who = 'reception') => (await as(who)).post(`/api/billing/bills/${id}/payments`).send(body);

describe('money', () => {
  it('counts in paise and writes rupees the Indian way', () => {
    expect(toPaise('1,250.50')).toBe(125050);
    expect(toPaise('12.345')).toBeNull();
    expect(rupees(12345678)).toBe('₹1,23,456.78');
    expect(rupees(50000)).toBe('₹500');
    expect(totals({ lines: [{ amountPaise: 1000 }, { amountPaise: 500, removed: {} }], discount: { paise: 200 }, payments: [{ kind: 'payment', amountPaise: 900 }, { kind: 'refund', amountPaise: 100 }] })).toEqual({
      subtotal: 1000,
      discount: 200,
      total: 800,
      paid: 800,
      balance: 0,
      status: 'paid',
    });
  });

  it('bed days: the day of admission counts, the day of discharge does not, at least 1', () => {
    expect(bedDays(new Date('2026-09-28T04:00:00Z'), new Date('2026-09-28T12:00:00Z'))).toBe(1);
    expect(bedDays(new Date('2026-09-28T04:00:00Z'), new Date('2026-09-30T05:00:00Z'))).toBe(2);
    expect(bedDays(new Date('2026-09-28T04:00:00Z'), null, new Date('2026-10-01T05:00:00Z'))).toBe(3);
  });
});

describe('the price list', () => {
  it('starts with every hospital at ₹0; the admin changes it; reception reads it; clinical staff have no billing', async () => {
    const list = (await (await as('reception')).get('/api/billing/prices')).body;
    expect(list.canEdit).toBe(false);
    expect(list.items.find((i) => i.key === 'consult_new')).toMatchObject({ name: 'Consultation – new patient', pricePaise: 0, group: 'consultation' });
    expect(list.items.some((i) => i.key === 'lab:cbc')).toBe(true);
    expect((await (await as('reception')).patch(`/api/billing/prices/${list.items[0].id}`).send({ pricePaise: 100 })).status).toBe(403);
    for (const who of ['drA', 'rmo', 'nurse', 'lab']) expect((await (await as(who)).get('/api/billing/prices')).status).toBe(403);
    const added = await (await as('admin')).post('/api/billing/prices').send({ name: 'Ultrasound – follicular study', group: 'scan', pricePaise: 90000 });
    expect(added.status).toBe(201);
    const consult = list.items.find((i) => i.key === 'consult_new');
    expect((await (await as('admin')).patch(`/api/billing/prices/${consult.id}`).send({ group: 'other' })).status).toBe(400);
    expect(await AuditLog.countDocuments({ action: 'PRICE_LIST_CHANGED' })).toBe(1);
  });
});

describe('charges added by the work done', () => {
  it('a visit adds the consultation – new, then follow-up; a cancelled visit takes it off', async () => {
    await prices({ consult_new: 50000, consult_follow: 30000 });
    const p = await register('Visit Mother');
    const first = await startVisit(p, '2026-09-20');
    await startVisit(p);
    const [today, earlier] = await billsOf(p);
    expect(today).toMatchObject({ date: '2026-09-28', kind: 'opd', total: 30000, status: 'unpaid' });
    expect(earlier).toMatchObject({ date: '2026-09-20', total: 50000 });
    expect((await bill(earlier.id)).lines).toEqual([expect.objectContaining({ name: 'Consultation – new patient', amountPaise: 50000, source: 'auto', from: 'visit' })]);
    await (await as('drA')).post(`/api/patients/${p.id}/visits/${first.id}/cancel`).send({ reason: 'Entered for the wrong patient' });
    expect(await bill(earlier.id)).toMatchObject({ total: 0, status: 'no_charges' });
    expect((await bill(earlier.id)).lines[0].removed).toMatchObject({ reason: 'Visit cancelled' });
  });

  it('a lab order adds each test – the HIV test under a neutral name; a cancelled order takes them off', async () => {
    await prices({ 'lab:cbc': 25000, 'lab:hiv': 40000 });
    const p = await register('Lab Mother');
    const o = await order(p, ['cbc', 'hiv']);
    const [b] = await billsOf(p);
    const full = await bill(b.id);
    expect(full.lines.map((l) => [l.name, l.amountPaise])).toEqual([
      ['Complete blood count (CBC)', 25000],
      ['Lab test (confidential)', 40000],
    ]);
    expect(JSON.stringify(full)).not.toMatch(/HIV/);
    // Added by hand from the price list: the same neutral name
    const hiv = (await (await as('reception')).get('/api/billing/prices')).body.items.find((i) => i.key === 'lab:hiv');
    const added = await (await as('reception')).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: hiv.id });
    expect(added.body.bill.lines.at(-1).name).toBe('Lab test (confidential)');
    await (await as('drA')).post(`/api/lab/orders/${o.id}/cancel`).send({ rev: o.rev, reason: 'Ordered by mistake' });
    expect(await bill(b.id)).toMatchObject({ total: 40000 }); // only the one added by hand stays
  });

  it('a stay has one bill with its bed days; charges during the stay go on it; payments then are deposits', async () => {
    await prices({ bed: 100000, consult_new: 50000, 'Bed charge per day – private room': 250000 });
    const p = await register('Stay Mother');
    const admitted = await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'private', reason: 'Labour pains' });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    await startVisit(p);
    let [b] = await billsOf(p);
    expect(b).toMatchObject({ kind: 'ipd', stay: { ward: 'private', inHospital: true } });
    let full = await bill(b.id);
    expect(full.lines.map((l) => [l.name, l.qty, l.amountPaise])).toEqual([
      ['Bed charge per day – private room (private)', 1, 250000],
      ['Consultation – new patient', 1, 50000],
    ]);
    const deposit = await pay(b.id, { mode: 'cash', amountPaise: 500000 }); // more than due: a deposit may be
    expect(deposit.status, JSON.stringify(deposit.body)).toBe(201);
    expect(deposit.body.payment).toMatchObject({ kind: 'deposit', receipt: 'R-000001' });

    later('2026-09-30T06:00:00Z');
    full = await bill(b.id);
    expect(full.lines[0]).toMatchObject({ qty: 2, amountPaise: 500000 });
    await Admission.updateOne({ tenantId: hospital._id, _id: admitted.body.admission.id }, { $set: { status: 'discharged', dischargedAt: new Date('2026-10-01T05:00:00Z') } });
    later('2026-10-01T08:00:00Z');
    [b] = await billsOf(p);
    full = await bill(b.id);
    expect(full).toMatchObject({ total: 800000, paid: 500000, balance: 300000, stay: { inHospital: false } });
    expect((await pay(b.id, { mode: 'upi', amountPaise: 400000, reference: 'UPI123' })).status).toBe(400); // more than due
    expect((await pay(b.id, { mode: 'upi', amountPaise: 300000, reference: 'UPI123' })).body.payment).toMatchObject({ kind: 'payment', receipt: 'R-000002' });
    expect(await bill(b.id)).toMatchObject({ balance: 0, status: 'paid' });
  });

  it('a charge at ₹0 shows "price not set" and picks up the price once the admin sets it', async () => {
    const p = await register('Unpriced Mother');
    await startVisit(p);
    const [b] = await billsOf(p);
    expect(b).toMatchObject({ priceNotSet: true, total: 0 });
    await prices({ consult_new: 45000 });
    expect(await bill(b.id)).toMatchObject({ priceNotSet: false, total: 45000 });
  });
});

describe('bills and payments at the desk', () => {
  it('reception adds items, gives a discount, takes part payments, refunds and cancels – with reasons, all audited', async () => {
    const list = await prices({ consult_new: 50000, 'Ultrasound – obstetric': 80000 });
    const p = await register('Desk Mother');
    await startVisit(p);
    const [b] = await billsOf(p);
    const scan = list.find((i) => i.name === 'Ultrasound – obstetric');
    const other = list.find((i) => i.name === 'Other charge');
    const desk = await as('reception');
    expect((await desk.post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: scan.id })).status).toBe(201);
    expect((await desk.post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id })).status).toBe(400); // ₹0: amount needed
    expect((await desk.post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 10000, name: 'Certificate' })).status).toBe(201);
    expect(await bill(b.id)).toMatchObject({ subtotal: 140000, total: 140000 });

    expect((await desk.post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'percent', value: 10, reason: '' })).status).toBe(400);
    expect((await desk.post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'percent', value: 10, reason: 'Staff family' })).body.bill).toMatchObject({ discount: 14000, total: 126000 });
    expect((await pay(b.id, { mode: 'insurance', amountPaise: 6000 })).status).toBe(400); // scheme needed
    expect((await pay(b.id, { mode: 'insurance', amountPaise: 60000, scheme: 'Sample Health Insurance', reference: 'CL-1' })).body.bill).toMatchObject({ status: 'part_paid', balance: 66000 });
    expect((await pay(b.id, { mode: 'cash', amountPaise: 66000 })).body.bill).toMatchObject({ status: 'paid' });

    // A test taken off after payment: money to give back
    const full = await bill(b.id);
    const scanLine = full.lines.find((l) => l.name === 'Ultrasound – obstetric');
    expect((await desk.post(`/api/billing/bills/${b.id}/lines/${scanLine.id}/remove`).send({ reason: '' })).status).toBe(400);
    expect((await desk.post(`/api/billing/bills/${b.id}/lines/${scanLine.id}/remove`).send({ reason: 'Scan not done' })).body.bill).toMatchObject({ status: 'refund_due' });
    const due = await bill(b.id);
    expect((await pay(b.id, { kind: 'refund', mode: 'cash', amountPaise: -due.balance + 1 })).status).toBe(400);
    expect((await pay(b.id, { kind: 'refund', mode: 'cash', amountPaise: -due.balance })).body.bill).toMatchObject({ status: 'paid', balance: 0 });
    expect((await desk.post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong patient' })).body.error.code).toBe('PAID');

    const actions = (await AuditLog.find({ tenantId: hospital._id, action: { $in: ['BILL_ITEM_ADDED', 'DISCOUNT_GIVEN', 'PAYMENT_RECEIVED', 'BILL_ITEM_REMOVED', 'REFUND_GIVEN'] } }).lean()).map((a) => a.action);
    expect(actions.sort()).toEqual(['BILL_ITEM_ADDED', 'BILL_ITEM_ADDED', 'BILL_ITEM_REMOVED', 'DISCOUNT_GIVEN', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED', 'REFUND_GIVEN']);
  });

  it('an unpaid bill can be cancelled; the next charge that day opens a new bill', async () => {
    await prices({ consult_new: 50000, consult_follow: 30000 });
    const p = await register('Cancel Mother');
    await startVisit(p);
    const [b] = await billsOf(p);
    const res = await (await as('reception')).post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Free camp patient' });
    expect(res.body.bill).toMatchObject({ status: 'cancelled', cancelled: { reason: 'Free camp patient' } });
    expect((await pay(b.id, { mode: 'cash', amountPaise: 100 })).status).toBe(409);
    await startVisit(p);
    const bills = await billsOf(p);
    expect(bills.map((x) => x.status)).toEqual(['unpaid', 'cancelled']);
    expect(bills[0].number).not.toBe(bills[1].number);
  });

  it("another hospital's bills are out of reach", async () => {
    await prices({ consult_new: 50000 });
    const p = await register('Home Mother');
    await startVisit(p);
    const [b] = await billsOf(p);
    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Outside Desk' });
    await addMember(outsider, other, 'receptionist');
    const them = await loginAs(outsider, { app });
    expect((await them.get(`/api/billing/bills/${b.id}`)).status).toBe(404);
    expect((await them.post(`/api/billing/bills/${b.id}/payments`).send({ mode: 'cash', amountPaise: 100 })).status).toBe(404);
  });
});

describe('reports and the export', () => {
  it('the daily cash summary, unpaid bills, monthly income (admin) and the export for Excel', async () => {
    await prices({ consult_new: 50000, 'lab:cbc': 25000 });
    const a = await register('=Formula Mother'); // a name that looks like a formula is never one in Excel
    const b = await register('Owing Mother');
    await startVisit(a);
    await startVisit(b);
    await order(b, ['cbc']);
    const [billA] = await billsOf(a);
    const [billB] = await billsOf(b);
    await pay(billA.id, { mode: 'cash', amountPaise: 50000 });
    await pay(billB.id, { mode: 'upi', amountPaise: 20000, reference: 'U1' });

    const daily = (await (await as('reception')).get('/api/billing/reports/daily?date=2026-09-28')).body;
    expect(daily.totals).toEqual({ in: 70000, out: 0, net: 70000 });
    expect(daily.byMode.find((m) => m.mode === 'upi')).toMatchObject({ in: 20000 });
    expect(daily.byPerson).toEqual([{ name: 'Sample reception', in: 70000, out: 0, count: 2 }]);

    const unpaid = (await (await as('reception')).get('/api/billing/reports/unpaid')).body;
    expect(unpaid.bills.map((x) => [x.patient.fullName, x.balance])).toEqual([['Owing Mother', 55000]]);
    expect(unpaid.owed).toBe(55000);

    expect((await (await as('reception')).get('/api/billing/reports/monthly')).status).toBe(403);
    const monthly = (await (await as('admin')).get('/api/billing/reports/monthly?year=2026')).body;
    expect(monthly.months[8]).toMatchObject({ month: '2026-09', charged: 125000, collected: 70000, groups: expect.objectContaining({ consultation: 100000, lab: 25000 }) });
    expect(monthly.byDoctor).toEqual([{ id: people.drA._id.toString(), name: 'Sample drA', chargedPaise: 125000 }]);

    expect((await (await as('reception')).get('/api/billing/export?from=2026-09-01&to=2026-09-30&what=items')).status).toBe(403);
    const items = await (await as('admin')).get('/api/billing/export?from=2026-09-01&to=2026-09-30&what=items');
    expect(items.headers['content-type']).toMatch(/text\/csv/);
    expect(items.text).toContain("'=Formula Mother");
    expect(items.text.split('\r\n').filter(Boolean)).toHaveLength(4); // header + 3 items
    const payments = await (await as('admin')).get('/api/billing/export?from=2026-09-01&to=2026-09-30&what=payments');
    expect(payments.text).toContain('R-000002');
    expect(await AuditLog.countDocuments({ action: 'BILLING_EXPORTED' })).toBe(2);
  });
});

describe('scans and procedures done', () => {
  const workOf = async (p, who = 'drA') => (await (await as(who)).get(`/api/patients/${p.id}/work-done`)).body;
  const record = async (p, name, who = 'drA') => {
    const item = (await workOf(p, who === 'reception' ? 'drA' : who)).items.find((i) => i.name === name);
    return (await as(who)).post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: item.id });
  };

  it('a scan recorded by the doctor or a nurse goes on the bill by itself; cancelling takes it off', async () => {
    await prices({ 'Ultrasound – obstetric': 120000, Dressing: 15000 });
    const p = await register('Scan Mother');
    const list = await workOf(p);
    expect(list.canRecord).toBe(true);
    expect(list.items.map((i) => i.group)).toEqual(expect.arrayContaining(['scan', 'procedure']));
    expect(list.items.every((i) => !('pricePaise' in i))).toBe(true); // names only, never prices

    const scan = await record(p, 'Ultrasound – obstetric');
    expect(scan.status, JSON.stringify(scan.body)).toBe(201);
    expect((await record(p, 'Dressing', 'nurse')).status).toBe(201);
    const [b] = await billsOf(p);
    const full = await bill(b.id);
    expect(full.lines.filter((l) => !l.removed).map((l) => [l.name, l.amountPaise, l.source, l.from])).toEqual([
      ['Ultrasound – obstetric', 120000, 'auto', 'work'],
      ['Dressing', 15000, 'auto', 'work'],
    ]);

    const short = await (await as('drA')).post(`/api/patients/${p.id}/work-done/${scan.body.work.id}/cancel`).send({ reason: 'x' });
    expect(short.status).toBe(400);
    const gone = await (await as('drA')).post(`/api/patients/${p.id}/work-done/${scan.body.work.id}/cancel`).send({ reason: 'Wrong patient' });
    expect(gone.body.work.cancelled).toMatchObject({ reason: 'Wrong patient' });
    const after = await bill(b.id);
    expect(after.lines.filter((l) => !l.removed).map((l) => l.name)).toEqual(['Dressing']);
    expect(after.lines.find((l) => l.removed)).toMatchObject({ name: 'Ultrasound – obstetric', removed: { reason: 'Entered in error' } });
    expect((await workOf(p)).done.map((w) => [w.name, Boolean(w.cancelled)])).toEqual(expect.arrayContaining([['Ultrasound – obstetric', true], ['Dressing', false]]));
    expect(await AuditLog.countDocuments({ action: { $in: ['WORK_DONE_RECORDED', 'WORK_DONE_CANCELLED'] } })).toBe(3);
  });

  it('the same request twice charges once; reception, the lab and other hospitals cannot record', async () => {
    const p = await register('Once Mother');
    const item = (await workOf(p)).items.find((i) => i.name === 'NST (non-stress test)');
    const body = { clientRequestId: randomUUID(), priceItemId: item.id };
    expect((await (await as('rmo')).post(`/api/patients/${p.id}/work-done`).send(body)).status).toBe(201);
    expect((await (await as('rmo')).post(`/api/patients/${p.id}/work-done`).send(body)).status).toBe(201);
    const [b] = await billsOf(p);
    expect((await bill(b.id)).lines).toHaveLength(1);

    expect((await (await as('reception')).get(`/api/patients/${p.id}/work-done`)).status).toBe(403);
    expect((await (await as('reception')).post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: item.id })).status).toBe(403);
    expect((await (await as('lab')).post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: item.id })).status).toBe(403);
    // A consultation is not a scan or procedure
    const consult = (await (await as('admin')).get('/api/billing/prices')).body.items.find((i) => i.key === 'consult_new');
    expect((await (await as('drA')).post(`/api/patients/${p.id}/work-done`).send({ clientRequestId: randomUUID(), priceItemId: consult.id })).status).toBe(400);

    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Outside Doctor' });
    await addMember(outsider, other, 'doctor');
    const them = await loginAs(outsider, { app });
    expect((await them.get(`/api/patients/${p.id}/work-done`)).status).toBe(404);
  });
});

describe('the billing department (billing role, 7 Oct 2026)', () => {
  it('bills, takes payments and sees all billing reports – but not the price list, the settings or medical details', async () => {
    await prices({ consult_new: 50000 });
    const p = await register('Billing Desk Mother');
    await startVisit(p);
    const desk = await as('billing');
    const [b] = (await desk.get(`/api/billing/patient/${p.id}`)).body.bills;
    expect(b).toMatchObject({ total: 50000 });
    const paid = await desk.post(`/api/billing/bills/${b.id}/payments`).send({ mode: 'cash', amountPaise: 50000 });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.bill).toMatchObject({ status: 'paid' });
    expect((await desk.post('/api/billing/bills').send({ patientId: p.id })).status).toBeLessThan(300);

    expect((await desk.get('/api/billing/reports/daily?date=2026-09-28')).body.byPerson).toEqual([{ name: 'Sample billing', in: 50000, out: 0, count: 1 }]);
    expect((await desk.get('/api/billing/reports/unpaid')).status).toBe(200);
    expect((await desk.get('/api/billing/reports/monthly?year=2026')).status).toBe(200);
    expect((await desk.get('/api/billing/export?from=2026-09-01&to=2026-09-30&what=payments')).status).toBe(200);

    // The price list and the billing settings stay with the hospital admin
    const list = (await desk.get('/api/billing/prices')).body;
    expect(list.canEdit).toBe(false);
    expect((await desk.patch(`/api/billing/prices/${list.items[0].id}`).send({ pricePaise: 100 })).status).toBe(403);
    expect((await desk.put('/api/billing/settings').send({ upiId: 'sample@upi', payeeName: 'Sample' })).status).toBe(403);

    // The patient: name, number, phone and doctor only – no medical details, no changes, no registering
    const rec = (await desk.get(`/api/patients/${p.id}`)).body.patient;
    expect(rec).toMatchObject({ fullName: 'Billing Desk Mother', mrn: p.mrn });
    expect(rec.phone).toBeDefined();
    for (const k of ['pregnancy', 'obstetric', 'medical', 'notes', 'risk', 'address']) expect(rec[k], k).toBeUndefined();
    expect(rec.access).toMatchObject({ level: 'identity', canEditIdentity: false, canEditClinical: false, canViewVisits: false });
    expect((await desk.patch(`/api/patients/${p.id}`).send({ fullName: 'Changed' })).status).toBe(403);
    expect((await desk.post('/api/patients').send(samplePatient({ fullName: 'New By Billing' }))).status).toBe(403);
    expect((await desk.get(`/api/patients/${p.id}/visits`)).status).toBe(403);
  });
});
