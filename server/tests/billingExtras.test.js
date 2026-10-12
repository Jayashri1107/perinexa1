// Billing extras (4 Oct 2026): insurance or scheme details on a bill, the claim form and the PM-JAY claim sheet, the
// UPI payment link and the billing settings – who may do what, another hospital, the audit entries, the edge cases.
// Made-up names and numbers only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSums, groupSummary, insuranceView } from '../src/billing/claim.js';
import { payeeNameProblem, upiAmount, upiIdProblem, upiLink, upiMessage } from '../src/billing/upi.js';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // Monday 5 Oct 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharmacist: 'pharmacist', admin: 'admin' };
const UPI = { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity & Care' };

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
  hospital = await createTenant('Extras Hospital');
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

async function register(name, extra = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString(), ...extra }));
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
const startVisit = async (p) => (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
const order = async (p, tests) => {
  const res = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((key) => ({ key })) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.order;
};
const billsOf = async (p) => (await (await as('reception')).get(`/api/billing/patient/${p.id}`)).body.bills;
const open = async (id, who = 'reception') => (await (await as(who)).get(`/api/billing/bills/${id}`)).body;
const pay = async (id, body, who = 'reception') => (await as(who)).post(`/api/billing/bills/${id}/payments`).send(body);
const insure = async (id, body, who = 'reception') => (await as(who)).put(`/api/billing/bills/${id}/insurance`).send(body);
const upiSet = async (body = UPI, who = 'admin') => (await as(who)).put('/api/billing/settings').send(body);
const link = async (id, body = {}, who = 'reception') => (await as(who)).post(`/api/billing/bills/${id}/upi-link`).send(body);
const audits = async (action) => (await AuditLog.find({ tenantId: hospital._id, action }).sort({ createdAt: 1, _id: 1 }).lean()).map((a) => a.details);

/** A patient with a visit today: one bill of ₹500 for the consultation. */
async function billed(name = 'Insured Mother', extra = {}) {
  await prices({ consult_new: 50000 });
  const p = await register(name, extra);
  await startVisit(p);
  const [b] = await billsOf(p);
  return { p, b };
}
async function outsider(role = 'receptionist') {
  const other = await createTenant('Other Hospital');
  const person = await createUser({ name: 'Outside Desk' });
  await addMember(person, other, role);
  return loginAs(person, { app });
}

const DETAILS = { insurer: 'Sample Health Insurance', policyNumber: 'POL-778899', tpa: 'Sample TPA Services', preAuthNumber: 'PA-2026-0042', claimNumber: 'CLM-9001' };

describe('the UPI link and the claim summary (pure)', () => {
  it('checks the format of a UPI ID and says what is wrong in plain words', () => {
    for (const ok of ['samplehospital@okbank', 'sample.hospital-1@okhdfcbank', '9876500000@ybl', 'ab@upi', 'Sample_Clinic@icici']) expect(upiIdProblem(ok), ok).toBeNull();
    expect(upiIdProblem('')).toMatch(/Enter the UPI ID/);
    expect(upiIdProblem('sample hospital@okbank')).toMatch(/no spaces/);
    expect(upiIdProblem('samplehospital')).toMatch(/@ is missing/);
    expect(upiIdProblem('sample@hospital@okbank')).toMatch(/one @ only/);
    for (const bad of ['x@y', 'sample@1bank', 'sam!ple@okbank', '@okbank', 'sample@', 'sample@ok-bank', `${'a'.repeat(90)}@okbank`, 'https://pay.example/sample@okbank']) expect(upiIdProblem(bad), bad).toBeTruthy();
    expect(payeeNameProblem('Sample Maternity & Care')).toBeNull();
    expect(payeeNameProblem('S')).toBeTruthy();
    expect(payeeNameProblem('Sample\nHospital')).toMatch(/one line/);
  });

  it('writes the standard link – payee, amount, INR and the bill number only – and the message to copy', () => {
    expect(upiAmount(125050)).toBe('1250.50');
    expect(upiAmount(100)).toBe('1.00');
    expect(upiAmount(5)).toBe('0.05');
    const made = upiLink({ ...UPI, amountPaise: 125050, billNumber: 'B-000123' });
    expect(made).toBe('upi://pay?pa=samplehospital@okbank&pn=Sample%20Maternity%20%26%20Care&am=1250.50&cu=INR&tn=B-000123');
    // The payee name cannot add a field of its own to the link
    expect(upiLink({ upiId: 'a.b@okbank', payeeName: 'Sample&am=1#x', amountPaise: 100, billNumber: 'B-000001' })).toBe('upi://pay?pa=a.b@okbank&pn=Sample%26am%3D1%23x&am=1.00&cu=INR&tn=B-000001');
    const message = upiMessage({ ...UPI, amountPaise: 125050, billNumber: 'B-000123', link: made });
    expect(message.split('\n')).toEqual([
      'Sample Maternity & Care: bill B-000123. Amount to pay: ₹1,250.50.',
      'To pay by UPI, open this link on your phone:',
      made,
      'If the link does not open, pay to the UPI ID samplehospital@okbank and write B-000123 in the note.',
      'After paying, please show the payment message at the reception.',
    ]);
    expect(message).not.toMatch(/!/);
  });

  it('sums a bill by group – never an item name – and says how much insurance paid', () => {
    const bill = {
      lines: [
        { group: 'lab', name: 'Lab test (confidential)', amountPaise: 40000 },
        { group: 'consultation', name: 'Consultation – new patient', amountPaise: 50000 },
        { group: 'lab', name: 'Complete blood count (CBC)', amountPaise: 25000 },
        { group: 'scan', name: 'Ultrasound – obstetric', amountPaise: 80000, removed: { reason: 'Not done' } },
      ],
      discount: { paise: 5000 },
      payments: [
        { kind: 'payment', mode: 'insurance', amountPaise: 60000 },
        { kind: 'payment', mode: 'cash', amountPaise: 10000 },
        { kind: 'refund', mode: 'cash', amountPaise: 2000 },
      ],
    };
    expect(groupSummary(bill)).toEqual([
      { group: 'consultation', label: 'Consultation', items: 1, amountPaise: 50000 },
      { group: 'lab', label: 'Lab test', items: 2, amountPaise: 65000 },
    ]);
    expect(claimSums(bill)).toEqual({ subtotal: 115000, discount: 5000, total: 110000, paid: 68000, paidByInsurance: 60000, balance: 42000 });
    expect(insuranceView(null)).toBeNull();
    expect(insuranceView({ insurer: '', tpa: '' })).toBeNull();
    expect(insuranceView({ insurer: 'Sample Health Insurance', byName: 'Sample reception' })).toMatchObject({ insurer: 'Sample Health Insurance', policyNumber: '', pmjayId: '', byName: 'Sample reception' });
  });
});

describe('insurance or scheme details on a bill', () => {
  it('reception and the hospital admin record them; clinical staff, the lab and the pharmacist cannot; another hospital finds no bill', async () => {
    const { b } = await billed();
    expect((await open(b.id)).bill.insurance).toBeNull();

    const saved = await insure(b.id, DETAILS);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.bill.insurance).toMatchObject({ ...DETAILS, pmjayId: '', packageCode: '', packageName: '', byName: 'Sample reception' });
    expect(saved.body.bill.insurer).toBe('Sample Health Insurance');
    // The lists name the insurer only (who the claim is with)
    const [listed] = await billsOf({ id: saved.body.bill.patient.id });
    expect(listed.insurer).toBe('Sample Health Insurance');
    expect(listed).not.toHaveProperty('insurance');
    expect((await (await as('reception')).get('/api/billing/reports/unpaid')).body.bills[0].insurer).toBe('Sample Health Insurance');

    expect((await insure(b.id, { ...DETAILS, claimNumber: 'CLM-9002' }, 'admin')).body.bill.insurance).toMatchObject({ claimNumber: 'CLM-9002', byName: 'Sample admin' });
    for (const who of ['drA', 'rmo', 'nurse', 'lab', 'pharmacist']) expect((await insure(b.id, DETAILS, who)).status, who).toBe(403);
    const them = await outsider();
    expect((await them.put(`/api/billing/bills/${b.id}/insurance`).send(DETAILS)).status).toBe(404);
    expect((await open(b.id)).bill.insurance.claimNumber).toBe('CLM-9002');
  });

  it('needs the insurer when anything else is given, refuses unknown fields and text that is too long, and everything empty takes the details off', async () => {
    const { b } = await billed();
    const noInsurer = await insure(b.id, { policyNumber: 'POL-1' });
    expect(noInsurer.status).toBe(400);
    expect(noInsurer.body.error.fields.insurer).toMatch(/insurance company or scheme/);
    expect((await insure(b.id, { insurer: 'S', policyNumber: 'POL-1' })).status).toBe(400);
    expect((await insure(b.id, { ...DETAILS, diagnosis: 'Anything' })).status).toBe(400); // no clinical field exists
    expect((await insure(b.id, { ...DETAILS, policyNumber: 'P'.repeat(61) })).body.error.fields.policyNumber).toMatch(/too long/);
    expect((await open(b.id)).bill.insurance).toBeNull();

    expect((await insure(b.id, DETAILS)).status).toBe(200);
    // Saved again with nothing changed: no second audit entry
    expect((await insure(b.id, DETAILS)).status).toBe(200);
    const cleared = await insure(b.id, {});
    expect(cleared.body.bill).toMatchObject({ insurance: null, insurer: '' });
    expect((await Bill.findOne({ tenantId: hospital._id, _id: b.id }).lean()).insurance).toBeNull();

    // The audit log holds which details changed – never what was typed
    const log = await audits('BILL_INSURANCE_CHANGED');
    expect(log).toEqual([
      { billId: b.id, number: b.number, patientId: expect.any(String), fields: ['insurer', 'policyNumber', 'tpa', 'preAuthNumber', 'claimNumber'] },
      { billId: b.id, number: b.number, patientId: expect.any(String), fields: ['insurer', 'policyNumber', 'tpa', 'preAuthNumber', 'claimNumber'], removed: true },
    ]);
    for (const typed of Object.values(DETAILS)) expect(JSON.stringify(log)).not.toContain(typed);
  });

  it("keeps the fetal-sex guard on everything typed on a mother's bill, not on a baby's; a cancelled bill takes no details", async () => {
    const { p, b } = await billed('Guarded Mother', { careType: 'antenatal' });
    const guarded = await insure(b.id, { insurer: 'PM-JAY', packageName: 'Delivery of a girl' });
    expect(guarded.status).toBe(400);
    expect(guarded.body.error.fields.packageName).toMatch(/baby's sex/);
    // The message is the billing desk's own: it says what to leave out and what to write instead
    expect(guarded.body.error.fields.packageName).toMatch(/son, daughter, boy, girl, male or female.*XX or XY.*“staff family” or “paid by a relative”.*ABXY12/);
    expect(guarded.body.error.fields.packageName).not.toMatch(/partner|husband|!/);

    const baby = (await (await as('reception')).post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Guarded Mother', newborn: { birthAt: '2026-10-04T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female', mother: p.id } })).body.patient;
    const babyBill = (await (await as('reception')).post('/api/billing/bills').send({ patientId: baby.id })).body.bill;
    expect((await insure(babyBill.id, { insurer: 'PM-JAY', packageName: 'Care of a sick female newborn' })).status).toBe(200);

    // The same guard on everything else typed on a mother's bill: an item's name, a reason, the payer of a payment
    const other = (await (await as('admin')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    const desk = await as('reception');
    const named = await desk.post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 10000, name: 'Scan – baby boy' });
    expect(named.status).toBe(400);
    expect(named.body.error.fields.name).toMatch(/baby's sex/);
    expect((await desk.post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'amount', value: 100, reason: 'She has a daughter here' })).body.error.fields.reason).toMatch(/baby's sex/);
    expect((await pay(b.id, { mode: 'insurance', amountPaise: 100, scheme: 'Sample girl child scheme' })).body.error.fields.scheme).toMatch(/baby's sex/);
    expect((await pay(b.id, { mode: 'upi', amountPaise: 100, reference: 'male' })).body.error.fields.reference).toMatch(/baby's sex/);
    expect((await desk.post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong gender entered' })).body.error.fields.reason).toMatch(/baby's sex/);
    // …and the reason for taking an item off
    const consultation = (await open(b.id)).bill.lines[0];
    const takenOff = await desk.post(`/api/billing/bills/${b.id}/lines/${consultation.id}/remove`).send({ reason: 'Charged for her daughter by mistake' });
    expect(takenOff.status).toBe(400);
    expect(takenOff.body.error.fields.reason).toMatch(/baby's sex/);
    expect((await open(b.id)).bill).toMatchObject({ status: 'unpaid', paid: 0, discount: 0, items: 1, insurance: null });
    // The same reasons without those words go through; so does a number with the letters joined to the rest
    expect((await desk.post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'amount', value: 100, reason: 'Staff family' })).status).toBe(200);
    expect((await insure(b.id, { insurer: 'Sample Health Insurance', policyNumber: 'POL-XY-2026' })).body.error.fields.policyNumber).toMatch(/join those letters/);
    expect((await insure(b.id, { insurer: 'Sample Health Insurance', policyNumber: 'POLXY2026' })).status).toBe(200);
    expect((await insure(b.id, {})).status).toBe(200);
    expect((await desk.post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'amount', value: 0 })).status).toBe(200);
    // On the baby's own bill these words are allowed
    expect((await desk.post(`/api/billing/bills/${babyBill.id}/lines`).send({ priceItemId: other.id, ratePaise: 10000, name: 'Care of a baby girl' })).status).toBe(201);
    expect((await desk.post(`/api/billing/bills/${babyBill.id}/lines/${(await open(babyBill.id)).bill.lines[0].id}/remove`).send({ reason: 'Entered for the wrong girl' })).status).toBe(200);

    const cancelled = await (await as('reception')).post(`/api/billing/bills/${babyBill.id}/cancel`).send({ reason: 'Opened by mistake' });
    expect(cancelled.status).toBe(200);
    expect((await insure(babyBill.id, { insurer: 'Sample Health Insurance' })).status).toBe(409);
  });

  it('a payment by insurance uses the insurer of the bill, and a bill with no details takes the payer of the payment', async () => {
    const { p, b } = await billed();
    // No details and no scheme: refused as before
    const refused = await pay(b.id, { mode: 'insurance', amountPaise: 10000 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.scheme).toMatch(/insurance company or scheme/);

    // The payer of the first insurance payment becomes the bill's insurer
    const first = await pay(b.id, { mode: 'insurance', amountPaise: 10000, scheme: 'Sample Health Insurance' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.bill.insurance).toMatchObject({ insurer: 'Sample Health Insurance', claimNumber: '', byName: 'Sample reception' });
    expect(await audits('BILL_INSURANCE_CHANGED')).toEqual([{ billId: b.id, number: b.number, patientId: p.id, fields: ['insurer'], via: 'payment' }]);

    // Now the scheme may be left out: the bill's insurer is used. Another payer typed by hand is kept on the payment only.
    const second = await pay(b.id, { mode: 'insurance', amountPaise: 10000 });
    expect(second.body.payment).toMatchObject({ mode: 'insurance', scheme: 'Sample Health Insurance' });
    const third = await pay(b.id, { mode: 'insurance', amountPaise: 10000, scheme: 'Sample State Scheme' });
    expect(third.body.payment.scheme).toBe('Sample State Scheme');
    expect(third.body.bill.insurance.insurer).toBe('Sample Health Insurance');
    expect(await AuditLog.countDocuments({ action: 'BILL_INSURANCE_CHANGED' })).toBe(1);
    // A cash payment never touches the details
    expect((await pay(b.id, { mode: 'cash', amountPaise: 10000, scheme: 'Ignored' })).body.payment.scheme).toBe('');
  });

  it('a claim number typed with a payment by insurance reaches the bill’s insurance details and the claim form', async () => {
    const { p, b } = await billed();
    // The bill has the insurer and the policy number, but no claim number yet: the one typed with the payment is kept
    await insure(b.id, { insurer: 'Sample Health Insurance', policyNumber: 'POL-778899' });
    // A payment by ANOTHER payer never changes the bill's details
    const other = await pay(b.id, { mode: 'insurance', amountPaise: 5000, scheme: 'Sample State Scheme', reference: 'SS-1' });
    expect(other.body.bill.insurance).toMatchObject({ insurer: 'Sample Health Insurance', claimNumber: '' });
    const paid = await pay(b.id, { mode: 'insurance', amountPaise: 10000, reference: 'CLM-9001' }, 'admin');
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.payment).toMatchObject({ scheme: 'Sample Health Insurance', reference: 'CLM-9001' });
    expect(paid.body.bill.insurance).toMatchObject({ insurer: 'Sample Health Insurance', policyNumber: 'POL-778899', claimNumber: 'CLM-9001', byName: 'Sample admin' });
    expect((await (await as('reception')).get(`/api/billing/bills/${b.id}/claim-form`)).body.form.insurance.claimNumber).toBe('CLM-9001');
    // A claim number already on the bill is never overwritten by a later payment
    const later = await pay(b.id, { mode: 'insurance', amountPaise: 10000, reference: 'CLM-9002' });
    expect(later.body.payment.reference).toBe('CLM-9002');
    expect(later.body.bill.insurance.claimNumber).toBe('CLM-9001');
    expect((await audits('BILL_INSURANCE_CHANGED')).slice(1)).toEqual([{ billId: b.id, number: b.number, patientId: p.id, fields: ['claimNumber'], via: 'payment' }]);
    expect(JSON.stringify(await audits('BILL_INSURANCE_CHANGED'))).not.toMatch(/CLM-|POL-|Sample Health/);

    // A bill with no details at all takes both from its first payment by insurance
    const { b: fresh } = await billed('Second Insured Mother');
    const both = await pay(fresh.id, { mode: 'insurance', amountPaise: 10000, scheme: 'Sample Health Insurance', reference: 'CLM-7001' });
    expect(both.body.bill.insurance).toMatchObject({ insurer: 'Sample Health Insurance', claimNumber: 'CLM-7001' });
    expect((await audits('BILL_INSURANCE_CHANGED')).at(-1)).toMatchObject({ billId: fresh.id, fields: ['insurer', 'claimNumber'], via: 'payment' });
  });

  it('offers what belongs to the person from an earlier bill – never the numbers of one claim', async () => {
    const { p, b } = await billed();
    await insure(b.id, { ...DETAILS, pmjayId: 'PMJ-000-111', packageCode: 'SG-01', packageName: 'Sample package' });
    expect((await open(b.id)).earlierInsurance).toBeNull(); // it has its own

    later('2026-10-12T06:00:00Z');
    await startVisit(p);
    const [next] = await billsOf(p);
    expect(next.number).not.toBe(b.number);
    expect((await open(next.id)).earlierInsurance).toEqual({ number: b.number, insurer: 'Sample Health Insurance', policyNumber: 'POL-778899', tpa: 'Sample TPA Services', pmjayId: 'PMJ-000-111' });

    // Never another patient's
    const other = await register('Uninsured Mother');
    await startVisit(other);
    const [theirs] = await billsOf(other);
    expect((await open(theirs.id)).earlierInsurance).toBeNull();

    // Never from a cancelled bill: someone else's policy typed on her bill by mistake stays on the cancelled bill,
    // and is not offered again on her next one
    await insure(theirs.id, { insurer: 'Wrong Insurance Co', policyNumber: 'SOMEONE-ELSE-1' });
    expect((await (await as('reception')).post(`/api/billing/bills/${theirs.id}/cancel`).send({ reason: 'Wrong details entered' })).status).toBe(200);
    const again = (await (await as('reception')).post('/api/billing/bills').send({ patientId: other.id })).body.bill;
    expect(again.number).not.toBe(theirs.number);
    expect((await open(again.id)).earlierInsurance).toBeNull();
    expect((await Bill.findOne({ tenantId: hospital._id, _id: theirs.id }).lean()).insurance.insurer).toBe('Wrong Insurance Co'); // kept on the cancelled bill
  });

  it('the fee taken with an appointment by insurance notes the insurer on the bill too', async () => {
    await prices({ consult_new: 50000 });
    const p = await register('Booked Mother');
    const drA = people.drA._id.toString();
    const week = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }] }));
    expect((await (await as('drA')).put(`/api/appointments/timings/${drA}`).send({ week, leave: [] })).status).toBe(200);
    const booked = await (await as('reception')).post('/api/appointments').send({ doctorId: drA, date: '2026-10-06', start: '10:00', patientId: p.id, visitType: 'new' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    // The payer and the reference go on her bill: the same fetal-sex guard as on a payment taken on the bill itself,
    // with its message under the box – and nothing is charged or paid on a refused try
    const takeFee = async (body) => (await as('reception')).post(`/api/appointments/${booked.body.appointment.id}/fee`).send(body);
    const badPayer = await takeFee({ mode: 'insurance', scheme: 'Sample girl child scheme' });
    expect(badPayer.status).toBe(400);
    expect(badPayer.body.error.fields.scheme).toMatch(/baby's sex/);
    const badReference = await takeFee({ mode: 'upi', reference: 'Paid by her son' });
    expect(badReference.status).toBe(400);
    expect(badReference.body.error.fields).toEqual({ reference: expect.stringMatching(/paid by a relative/) });
    expect(await billsOf(p)).toEqual([]);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'PAYMENT_RECEIVED' })).toBe(0);

    const fee = await takeFee({ mode: 'insurance', scheme: 'Sample Health Insurance', reference: 'CLM-77' });
    expect(fee.status, JSON.stringify(fee.body)).toBe(201);
    const [b] = await billsOf(p);
    expect(b).toMatchObject({ status: 'paid', insurer: 'Sample Health Insurance' });
    expect((await open(b.id)).bill.insurance).toMatchObject({ insurer: 'Sample Health Insurance', policyNumber: '', claimNumber: 'CLM-77' });
  });

  it("the fee for a baby's appointment may name the baby's sex, as her own bill may", async () => {
    await prices({ consult_new: 50000 });
    const mother = await register('Fee Mother');
    const baby = (await (await as('reception')).post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Fee Mother', newborn: { birthAt: '2026-10-04T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female', mother: mother.id } })).body.patient;
    const drA = people.drA._id.toString();
    const week = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }] }));
    expect((await (await as('drA')).put(`/api/appointments/timings/${drA}`).send({ week, leave: [] })).status).toBe(200);
    const booked = await (await as('reception')).post('/api/appointments').send({ doctorId: drA, date: '2026-10-06', start: '10:00', patientId: baby.id, visitType: 'new' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const fee = await (await as('reception')).post(`/api/appointments/${booked.body.appointment.id}/fee`).send({ mode: 'insurance', scheme: 'Sample girl child scheme' });
    expect(fee.status, JSON.stringify(fee.body)).toBe(201);
  });
});

describe('the claim form and the PM-JAY claim sheet', () => {
  it('holds the hospital, identity, dates, the doctor, the bill by group and the insurance details – and nothing clinical', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'letterhead.registrationNumber': 'MH/SAMPLE/2026/001', 'letterhead.address': '12 Sample Street, Pune', 'letterhead.phone': '020 0000 0000' } });
    await User.updateOne({ _id: people.drA._id }, { $set: { professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-12345', council: 'Sample Medical Council' } } });
    await prices({ consult_new: 50000, 'lab:cbc': 25000, 'lab:hiv': 40000 });
    const p = await register('Claim Mother', { careType: 'antenatal', ageYears: 29, address: '4 Sample Lane', phone: '+91 00000 11111' });
    await startVisit(p);
    await order(p, ['cbc', 'hiv']);
    const [b] = await billsOf(p);
    await (await as('reception')).post(`/api/billing/bills/${b.id}/discount`).send({ mode: 'amount', value: 5000, reason: 'Staff family' });
    await insure(b.id, { ...DETAILS, pmjayId: 'PMJ-000-111', packageCode: 'SG-01', packageName: 'Sample package' });
    await pay(b.id, { mode: 'insurance', amountPaise: 60000 });
    await pay(b.id, { mode: 'cash', amountPaise: 10000 });

    const res = await (await as('reception')).get(`/api/billing/bills/${b.id}/claim-form`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.form).toEqual({
      hospital: { name: 'Extras Hospital', tagline: '', address: '12 Sample Street, Pune', phone: '020 0000 0000', email: '', registrationNumber: 'MH/SAMPLE/2026/001' },
      patient: { fullName: 'Claim Mother', mrn: p.mrn, phone: '+91 00000 11111', age: 29, bornOn: null, address: '4 Sample Lane', baby: false },
      doctor: { name: 'Sample drA', qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-12345', council: 'Sample Medical Council' },
      dates: { kind: 'visit', on: '2026-10-05' },
      bill: { number: b.number, kind: 'opd', date: '2026-10-05' },
      groups: [
        { group: 'consultation', label: 'Consultation', items: 1, amountPaise: 50000 },
        { group: 'lab', label: 'Lab test', items: 2, amountPaise: 65000 },
      ],
      sums: { subtotal: 115000, discount: 5000, total: 110000, paid: 70000, paidByInsurance: 60000, balance: 40000 },
      insurance: { ...DETAILS, pmjayId: 'PMJ-000-111', packageCode: 'SG-01', packageName: 'Sample package', byName: 'Sample reception', at: expect.any(String) },
    });
    // Reception gets no clinical detail through the form: no item or test names, no type of care, no reasons
    const sent = JSON.stringify(res.body);
    for (const never of ['HIV', 'confidential', 'Complete blood count', 'antenatal', 'careType', 'Staff family', 'reason', 'diagnosis', 'lines']) expect(sent, never).not.toContain(never);

    // Opening the form is in the audit log as a bill viewed; each printout by its layout – ids only
    for (const layout of ['claim', 'pmjay']) expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout })).status).toBe(200);
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout: 'other' })).status).toBe(400);
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({})).status).toBe(400);
    expect(await audits('CLAIM_FORM_PRINTED')).toEqual([
      { billId: b.id, number: b.number, patientId: p.id, layout: 'claim' },
      { billId: b.id, number: b.number, patientId: p.id, layout: 'pmjay' },
    ]);
    expect((await audits('BILL_VIEWED')).filter((d) => d.claimForm)).toEqual([{ billId: b.id, number: b.number, patientId: p.id, claimForm: true }]);
  });

  it('a hospital admin with no desk role gets her name, number and phone only – the rest prints as empty lines', async () => {
    const { b } = await billed('Admin Mother', { ageYears: 31, address: '9 Sample Road' });
    const form = (await (await as('admin')).get(`/api/billing/bills/${b.id}/claim-form`)).body.form;
    // …not even whether she is a baby (the form then prints one empty "Age or date of birth" line)
    expect(form.patient).toEqual({ fullName: 'Admin Mother', mrn: expect.any(String), phone: '+91 00000 00000', age: null, bornOn: null, address: null, baby: null });
    expect(form.insurance).toBeNull();
    // The doctor of the bill's own consultation is billing data (the admin's monthly report has it too)
    expect(form.doctor).toMatchObject({ name: 'Sample drA', registrationNumber: '' });
  });

  it('names the doctor of this bill’s own consultation – never someone who is not a doctor, and the assigned doctor only to a reader who may see that', async () => {
    await User.updateOne({ _id: people.drA._id }, { $set: { professional: { registrationNumber: 'MMC-12345' } } });
    await User.updateOne({ _id: people.drB._id }, { $set: { professional: { registrationNumber: 'MMC-67890' } } });
    const claim = async (id, who = 'reception') => (await (await as(who)).get(`/api/billing/bills/${id}/claim-form`)).body.form;
    const other = (await (await as('admin')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');

    // Seen by Dr A today; since then she was assigned to Dr B. The claim for today's bill names Dr A.
    const { p, b } = await billed('Two Doctors Mother');
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { assignedDoctor: people.drB._id } });
    expect((await claim(b.id)).doctor).toMatchObject({ name: 'Sample drA', registrationNumber: 'MMC-12345' });
    expect((await claim(b.id, 'admin')).doctor).toMatchObject({ name: 'Sample drA' });

    // No assigned doctor, and the only charge is a lab test ordered by the RMO: nobody is printed as the treating doctor
    await prices({ 'lab:cbc': 25000 });
    const unassigned = await register('Unassigned Mother', { assignedDoctor: undefined });
    const ordered = await (await as('rmo')).post(`/api/patients/${unassigned.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }] });
    expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
    const [labBill] = await billsOf(unassigned);
    expect((await Bill.findOne({ tenantId: hospital._id, _id: labBill.id }).lean()).lines[0].doctorId.toString()).toBe(people.rmo._id.toString());
    expect((await claim(labBill.id)).doctor).toBeNull();

    // A bill with no doctor on any charge: reception, who sees who she is assigned to, gets that doctor; the hospital
    // admin, who sees no patient data, gets an empty line – the form does not tell the admin who her doctor is
    const assigned = await register('Assigned Mother', { assignedDoctor: people.drB._id.toString() });
    const plain = (await (await as('reception')).post('/api/billing/bills').send({ patientId: assigned.id })).body.bill;
    await (await as('reception')).post(`/api/billing/bills/${plain.id}/lines`).send({ priceItemId: other.id, ratePaise: 20000, name: 'Sample charge' });
    expect((await claim(plain.id)).doctor).toMatchObject({ name: 'Sample drB', registrationNumber: 'MMC-67890' });
    expect((await claim(plain.id, 'admin')).doctor).toBeNull();
  });

  it("a stay's form has the dates of admission and discharge – never the ward or the reason for admission; a baby's form has the date of birth", async () => {
    await prices({ bed: 100000 });
    const p = await register('Stay Mother', { careType: 'antenatal' });
    const admitted = await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour ward', reason: 'Labour pains at term' });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const [b] = await billsOf(p);
    const res = await (await as('reception')).get(`/api/billing/bills/${b.id}/claim-form`);
    expect(res.body.form.dates).toEqual({ kind: 'stay', admittedAt: NOW.toISOString(), dischargedAt: null });
    // The doctor who admitted her is the treating doctor of the stay, whoever she is assigned to now
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { assignedDoctor: people.drB._id } });
    expect((await (await as('reception')).get(`/api/billing/bills/${b.id}/claim-form`)).body.form.doctor).toMatchObject({ name: 'Sample drA' });
    // …for reception. The hospital admin, who sees no patient data, is not told who admitted her (no charge of this bill names a doctor)
    expect((await (await as('admin')).get(`/api/billing/bills/${b.id}/claim-form`)).body.form.doctor).toBeNull();
    expect(res.body.form.groups).toEqual([{ group: 'inpatient', label: 'Inpatient', items: 1, amountPaise: 100000 }]);
    expect(JSON.stringify(res.body)).not.toMatch(/Labour/);

    const baby = (await (await as('reception')).post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Stay Mother', newborn: { birthAt: '2026-10-04T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female', mother: p.id } })).body.patient;
    const babyBill = (await (await as('reception')).post('/api/billing/bills').send({ patientId: baby.id })).body.bill;
    const other = (await (await as('admin')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    await (await as('reception')).post(`/api/billing/bills/${babyBill.id}/lines`).send({ priceItemId: other.id, ratePaise: 20000, name: 'Sample charge' });
    const babyForm = (await (await as('reception')).get(`/api/billing/bills/${babyBill.id}/claim-form`)).body.form;
    expect(babyForm.patient).toMatchObject({ fullName: 'Baby of Stay Mother', age: null, bornOn: '2026-10-04', baby: true });
    expect(JSON.stringify(babyForm)).not.toMatch(/female|3000/);
    // The admin, who sees no newborn details, gets no date of birth – and is not told that the patient is a baby
    expect((await (await as('admin')).get(`/api/billing/bills/${babyBill.id}/claim-form`)).body.form.patient).toMatchObject({ bornOn: null, age: null, baby: null });
  });

  it('is for reception and the hospital admin, for a bill of this hospital with charges that is not cancelled', async () => {
    const { p, b } = await billed();
    for (const who of ['drA', 'rmo', 'nurse', 'lab', 'pharmacist']) {
      expect((await (await as(who)).get(`/api/billing/bills/${b.id}/claim-form`)).status, who).toBe(403);
      expect((await (await as(who)).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout: 'claim' })).status, who).toBe(403);
    }
    const them = await outsider();
    expect((await them.get(`/api/billing/bills/${b.id}/claim-form`)).status).toBe(404);
    expect((await them.post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout: 'claim' })).status).toBe(404);

    // No charges: nothing to claim
    const empty = await register('Empty Mother');
    const emptyBill = (await (await as('reception')).post('/api/billing/bills').send({ patientId: empty.id })).body.bill;
    const none = await (await as('reception')).get(`/api/billing/bills/${emptyBill.id}/claim-form`);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('NO_CHARGES');

    await (await as('reception')).post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong patient' });
    expect((await (await as('reception')).get(`/api/billing/bills/${b.id}/claim-form`)).body.error.code).toBe('CANCELLED');
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout: 'claim' })).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'CLAIM_FORM_PRINTED' })).toBe(0);
    expect(p.id).toBeTruthy();
  });
});

describe('billing settings: the UPI ID and the payee name', () => {
  it('everyone who bills reads them; only the hospital admin changes them, with the format checked', async () => {
    const before = (await (await as('reception')).get('/api/billing/settings')).body;
    expect(before).toEqual({ settings: { upiId: '', payeeName: '', updatedByName: '', updatedAt: null, upiReady: false }, canEdit: false });
    expect((await upiSet(UPI, 'reception')).status).toBe(403);
    for (const who of ['drA', 'nurse', 'lab', 'pharmacist']) expect((await (await as(who)).get('/api/billing/settings')).status, who).toBe(403);

    expect((await upiSet({ upiId: 'samplehospital', payeeName: 'Sample Maternity' })).body.error.fields.upiId).toMatch(/@ is missing/);
    expect((await upiSet({ upiId: 'sample hospital@okbank', payeeName: 'Sample Maternity' })).body.error.fields.upiId).toMatch(/no spaces/);
    expect((await upiSet({ upiId: 'samplehospital@okbank', payeeName: '' })).body.error.fields.payeeName).toMatch(/registered under/);
    expect((await upiSet({ ...UPI, bank: 'Sample Bank' })).status).toBe(400);
    expect((await (await as('admin')).get('/api/billing/settings')).body.settings.upiReady).toBe(false);

    const saved = await upiSet();
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.settings).toEqual({ ...UPI, updatedByName: 'Sample admin', updatedAt: NOW.toISOString(), upiReady: true });
    expect((await (await as('reception')).get('/api/billing/settings')).body).toMatchObject({ settings: { ...UPI, upiReady: true }, canEdit: false });
    await upiSet(); // saved again unchanged: no second entry
    // Both empty switches the links off again
    expect((await upiSet({ upiId: '', payeeName: '' })).body.settings.upiReady).toBe(false);

    // The audit log says which settings changed – it keeps no UPI ID
    const log = await audits('BILLING_SETTINGS_CHANGED');
    expect(log).toEqual([{ fields: ['upiId', 'payeeName'] }, { fields: ['upiId', 'payeeName'] }]);
    expect(JSON.stringify(log)).not.toContain('okbank');
  });

  it('every change of the UPI ID is kept with the settings, for the hospital admin: which account the links pointed to, set by whom and when', async () => {
    const admin = await as('admin');
    expect((await admin.get('/api/billing/settings')).body.history).toEqual([]);
    expect((await upiSet()).body.history).toEqual([{ ...UPI, byName: 'Sample admin', at: NOW.toISOString() }]);
    await upiSet(); // saved again unchanged: no new entry
    // Someone changes the UPI ID to another account for an hour, then changes it back
    later('2026-10-05T07:00:00Z');
    await upiSet({ upiId: 'someoneelse@okbank', payeeName: 'Sample Maternity & Care' });
    later('2026-10-05T08:00:00Z');
    await upiSet();
    const seen = (await (await as('admin')).get('/api/billing/settings')).body;
    expect(seen.history).toEqual([
      { ...UPI, byName: 'Sample admin', at: '2026-10-05T08:00:00.000Z' },
      { upiId: 'someoneelse@okbank', payeeName: 'Sample Maternity & Care', byName: 'Sample admin', at: '2026-10-05T07:00:00.000Z' },
      { ...UPI, byName: 'Sample admin', at: NOW.toISOString() },
    ]);
    // Reception reads the UPI ID in use, never the history; nobody outside billing reads either
    const desk = (await (await as('reception')).get('/api/billing/settings')).body;
    expect(desk).not.toHaveProperty('history');
    expect(JSON.stringify(desk)).not.toContain('someoneelse');
    expect((await (await as('drA')).get('/api/billing/settings')).status).toBe(403);
    // The audit log still keeps no UPI ID; the platform's list of hospitals shows none of this
    expect(JSON.stringify(await audits('BILLING_SETTINGS_CHANGED'))).not.toMatch(/okbank|someoneelse/);
    const sa = await loginAs(await createSuperAdmin(), { app });
    expect(JSON.stringify((await sa.agent.get('/api/platform/tenants')).body)).not.toMatch(/okbank|someoneelse|history/);

    // Settings saved before the history was kept: the next change writes the earlier value down first; at most 50 are kept
    await Tenant.updateOne({ _id: hospital._id }, { $set: { billing: { upiId: 'oldhospital@okbank', payeeName: 'Old Name', updatedByName: 'Earlier Admin', updatedAt: new Date('2026-10-01T06:00:00Z') } } });
    const next = (await upiSet()).body.history;
    expect(next).toEqual([
      { ...UPI, byName: 'Sample admin', at: '2026-10-05T08:00:00.000Z' },
      { upiId: 'oldhospital@okbank', payeeName: 'Old Name', byName: 'Earlier Admin', at: '2026-10-01T06:00:00.000Z' },
    ]);
    for (let i = 0; i < 52; i += 1) await upiSet({ upiId: `sample${i}@okbank`, payeeName: 'Sample Maternity & Care' });
    const kept = (await (await as('admin')).get('/api/billing/settings')).body.history;
    expect(kept).toHaveLength(50);
    expect(kept[0].upiId).toBe('sample51@okbank');
  });

  it("another hospital's settings stay its own, and the platform's list of hospitals never shows a UPI ID", async () => {
    await upiSet();
    const them = await outsider('admin');
    expect((await them.get('/api/billing/settings')).body.settings).toMatchObject({ upiId: '', upiReady: false });
    await them.put('/api/billing/settings').send({ upiId: 'otherhospital@okbank', payeeName: 'Other Hospital' });
    expect((await (await as('admin')).get('/api/billing/settings')).body.settings).toMatchObject(UPI);

    const sa = await loginAs(await createSuperAdmin(), { app });
    const list = await sa.agent.get('/api/platform/tenants');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/okbank|payeeName/);
  });
});

describe('the UPI payment link of a bill', () => {
  it('makes the standard link and a message for the balance – nothing about the patient but the bill number – and records nothing', async () => {
    const { p, b } = await billed('Link Mother', { phone: '+91 00000 22222' });
    expect((await open(b.id)).upiReady).toBe(false);
    const unset = await link(b.id);
    expect(unset.status).toBe(409);
    expect(unset.body.error).toMatchObject({ code: 'UPI_NOT_SET', message: expect.stringMatching(/Billing → Settings/) });

    await upiSet();
    expect((await open(b.id)).upiReady).toBe(true);
    const made = await link(b.id);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toEqual({
      link: `upi://pay?pa=samplehospital@okbank&pn=Sample%20Maternity%20%26%20Care&am=500.00&cu=INR&tn=${b.number}`,
      message: expect.stringContaining(`Sample Maternity & Care: bill ${b.number}. Amount to pay: ₹500.`),
      amountPaise: 50000,
      upiId: 'samplehospital@okbank',
      payeeName: 'Sample Maternity & Care',
      number: b.number,
    });
    expect(made.body.message).toContain(made.body.link);
    // Only who is paid, how much, and the bill number
    expect([...new URL(made.body.link.replace('upi://pay', 'https://upi.example/pay')).searchParams.keys()]).toEqual(['pa', 'pn', 'am', 'cu', 'tn']);
    for (const never of ['Link Mother', 'Mother', p.mrn, p.id, '22222', '+91']) expect(JSON.stringify(made.body), never).not.toContain(never);

    // The payment is never recorded by itself
    const after = (await open(b.id)).bill;
    expect(after).toMatchObject({ paid: 0, balance: 50000, status: 'unpaid', payments: [] });
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'PAYMENT_RECEIVED' })).toBe(0);
    // The audit log: ids only – no amount, no link, no UPI ID
    expect(await audits('UPI_LINK_MADE')).toEqual([{ billId: b.id, number: b.number, patientId: p.id }]);

    // Reception records it when the money has arrived
    expect((await pay(b.id, { mode: 'upi', amountPaise: 50000, reference: 'UPI-REF-1' })).body.bill).toMatchObject({ status: 'paid', balance: 0 });
    const paid = await link(b.id);
    expect(paid.status).toBe(409);
    expect(paid.body.error.code).toBe('NOTHING_DUE');
  });

  it('may ask for a part of the balance, never more, and at least ₹1', async () => {
    const { b } = await billed();
    await upiSet();
    expect((await link(b.id, { amountPaise: 20050 })).body.link).toContain('&am=200.50&');
    const more = await link(b.id, { amountPaise: 50001 });
    expect(more.status).toBe(400);
    expect(more.body.error.message).toMatch(/balance is ₹500/);
    expect((await link(b.id, { amountPaise: 99 })).status).toBe(400);
    expect((await link(b.id, { amountPaise: 100.5 })).status).toBe(400);
    expect((await link(b.id, { amountPaise: 20000, note: 'Link Mother' })).status).toBe(400); // nothing else can be put into it
    expect(await AuditLog.countDocuments({ action: 'UPI_LINK_MADE' })).toBe(1);
  });

  it('is for reception and the hospital admin, for an open bill of this hospital', async () => {
    const { b } = await billed();
    await upiSet();
    expect((await link(b.id, {}, 'admin')).status).toBe(201);
    for (const who of ['drA', 'rmo', 'nurse', 'lab', 'pharmacist']) expect((await link(b.id, {}, who)).status, who).toBe(403);
    const them = await outsider();
    await them.put('/api/billing/settings').send(UPI); // refused (not an admin) – and their own hospital has no such bill anyway
    expect((await them.post(`/api/billing/bills/${b.id}/upi-link`).send({})).status).toBe(404);

    await (await as('reception')).post(`/api/billing/bills/${b.id}/cancel`).send({ reason: 'Wrong patient' });
    const cancelled = await link(b.id);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe('CANCELLED');
  });

  it('a UPI ID that is no longer in the right format makes no link', async () => {
    const { b } = await billed();
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'billing.upiId': 'not a upi id', 'billing.payeeName': 'Sample Maternity' } });
    expect((await open(b.id)).upiReady).toBe(false);
    expect((await link(b.id)).body.error.code).toBe('UPI_NOT_SET');
  });
});

describe('the audit log of the billing extras', () => {
  it('the hospital admin reads ids and the names of the details; the super admin reads no bill and no patient', async () => {
    const { p, b } = await billed();
    await upiSet();
    await insure(b.id, DETAILS);
    await link(b.id);
    await (await as('reception')).post(`/api/billing/bills/${b.id}/claim-form/printed`).send({ layout: 'pmjay' });
    // Even an entry written with more than it should hold is trimmed when read
    await AuditLog.create({ action: 'UPI_LINK_MADE', tenantId: hospital._id, details: { billId: b.id, number: b.number, patientId: p.id, link: 'upi://pay?pa=x@y', amountPaise: 1 } });

    const log = (await (await as('admin')).get('/api/tenant/audit-logs?category=patients&limit=100')).body.entries;
    const of = (action) => log.filter((e) => e.action === action).map((e) => e.details);
    expect(of('BILL_INSURANCE_CHANGED')).toEqual([{ billId: b.id, number: b.number, patientId: p.id, fields: ['insurer', 'policyNumber', 'tpa', 'preAuthNumber', 'claimNumber'] }]);
    expect(of('CLAIM_FORM_PRINTED')).toEqual([{ billId: b.id, number: b.number, patientId: p.id, layout: 'pmjay' }]);
    expect(of('UPI_LINK_MADE')).toEqual([
      { billId: b.id, number: b.number, patientId: p.id },
      { billId: b.id, number: b.number, patientId: p.id },
    ]);
    const settings = (await (await as('admin')).get('/api/tenant/audit-logs?action=BILLING_SETTINGS_CHANGED')).body.entries;
    expect(settings.map((e) => e.details)).toEqual([{ fields: ['upiId', 'payeeName'] }]);

    const sa = await loginAs(await createSuperAdmin(), { app });
    const platform = (await sa.agent.get('/api/platform/audit-logs?category=patients&limit=100')).body.entries.filter((e) => ['BILL_INSURANCE_CHANGED', 'CLAIM_FORM_PRINTED', 'UPI_LINK_MADE'].includes(e.action));
    expect(platform).toHaveLength(4);
    for (const e of platform) {
      expect(Object.keys(e.details).filter((k) => !['fields', 'via'].includes(k))).toEqual([]);
      expect(JSON.stringify(e.details)).not.toContain(b.number);
    }
  });
});
