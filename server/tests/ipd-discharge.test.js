// IPD discharge and the IPD bill window (docs/IPD_DISCHARGE_BILLING_PLAN.md, 9 Nov 2026): the discharge details after
// the doctor's card, the final bill and reopening it, administrative charges, the concession's authority, bed transfers,
// and a death never named to the desk. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-09T06:00:00Z');
const ROLES = { admin: 'admin', drA: 'doctor', nurse: 'nurse', reception: 'receptionist', billing: 'billing', lab: 'lab' };
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
  hospital = await createTenant('IPD Hospital');
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
async function admitted(fullName = 'Ward Mother') {
  const p = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName, ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-20' } }));
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const beds = (await (await as('admin')).post('/api/beds/setup').send({ ward: 'Semi private', names: ['S1', 'S2'] })).body.beds;
  const stay = await (await as('reception')).post(`/api/beds/${beds[0].id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.body.patient.id, reasonCode: 'labour' });
  expect(stay.status, JSON.stringify(stay.body)).toBe(201);
  return { patient: p.body.patient, stay: stay.body.admission, beds };
}
const discharge = (id) => Admission.updateOne({ _id: id, tenantId: hospital._id }, { $set: { status: 'discharged', dischargedAt: NOW, dischargedByName: 'Sample drA' } });
const ipd = (path) => `/api/billing/ipd${path}`;

describe('the IPD desk list and bill window', () => {
  it('lists the patients in hospital with their bill; the window has the stay, bill, other bills and bed transfers', async () => {
    const { patient, stay, beds } = await admitted();
    // A bed transfer is kept on the stay
    expect((await (await as('nurse')).post(`/api/beds/stays/${stay.id}/move`).send({ bedId: beds[1].id })).status).toBe(200);

    const list = (await (await as('reception')).get(ipd('/stays'))).body.stays;
    expect(list).toMatchObject([{ id: stay.id, ipdNo: 'IP-2026-000001', ward: 'Semi private', bed: 'S2', status: 'admitted', patient: { mrn: patient.mrn } }]);
    expect((await (await as('reception')).get(ipd(`/stays?q=${patient.mrn}`))).body.stays).toHaveLength(1);
    expect((await (await as('reception')).get(ipd('/stays?q=nobody-such'))).body.stays).toHaveLength(0);

    const w = (await (await as('billing')).get(ipd(`/stays/${stay.id}`))).body;
    expect(w.stay).toMatchObject({ ipdNo: 'IP-2026-000001', status: 'admitted', days: 1, mlc: false, discharge: null, moves: [{ fromBed: 'S1', toBed: 'S2', byName: 'Sample nurse' }] });
    expect(w.bill).toMatchObject({ kind: 'ipd', final: null });
    expect(w.dischargeTypes.map((t) => t.key)).toEqual(['normal', 'dama', 'lama', 'dor', 'transfer']); // never death
    expect(w.authorities.map((a) => a.name).sort()).toEqual(['Sample admin', 'Sample drA']);
    // Billing only
    expect((await (await as('nurse')).get(ipd('/stays'))).status).toBe(403);
    expect((await (await as('lab')).get(ipd(`/stays/${stay.id}`))).status).toBe(403);
  });
});

describe('discharge, final bill and clearance', () => {
  it('discharge details only after the card; the final bill locks the items until reopened with a reason', async () => {
    const { stay } = await admitted();
    const bill = await Bill.findOne({ tenantId: hospital._id, admissionId: stay.id }).lean();
    const desk = await as('billing');
    expect((await desk.post(ipd(`/stays/${stay.id}/discharge`)).send({ type: 'normal' })).body.error.code).toBe('NOT_DISCHARGED');
    expect((await desk.post(ipd(`/bills/${bill._id}/final`)).send({})).body.error.code).toBe('NOT_DISCHARGED');

    // Administrative charges while she is in hospital: set, changed, the old line kept as taken off
    expect((await desk.put(ipd(`/bills/${bill._id}/admin-charge`)).send({ amountPaise: 20000 })).status).toBe(200);
    const changed = (await desk.put(ipd(`/bills/${bill._id}/admin-charge`)).send({ amountPaise: 30000 })).body.bill;
    const adminLines = changed.lines.filter((l) => l.key === 'admin-charge');
    expect(adminLines.map((l) => [l.amountPaise, Boolean(l.removed)])).toEqual([[20000, true], [30000, false]]);

    await discharge(stay.id);
    expect((await desk.post(ipd(`/bills/${bill._id}/final`)).send({})).body.error.code).toBe('NO_DISCHARGE_DETAILS');
    expect((await desk.post(ipd(`/stays/${stay.id}/discharge`)).send({})).body.error.fields).toHaveProperty('type');
    expect((await desk.post(ipd(`/stays/${stay.id}/discharge`)).send({ type: 'death' })).status).toBe(400); // never chosen at the desk
    const d = await desk.post(ipd(`/stays/${stay.id}/discharge`)).send({ type: 'dama', doctorId: people.drA._id.toString(), remark: 'Relatives wish to go home' });
    expect(d.body.discharge).toMatchObject({ type: 'dama', doctorName: 'Sample drA', remark: 'Relatives wish to go home' });

    const fin = await desk.post(ipd(`/bills/${bill._id}/final`)).send({});
    expect(fin.body.bill.final).toMatchObject({ byName: 'Sample billing' });
    const other = (await desk.get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    expect((await desk.post(`/api/billing/bills/${bill._id}/lines`).send({ priceItemId: other.id, ratePaise: 5000, name: 'Late charge' })).body.error.code).toBe('FINAL');
    expect((await desk.put(ipd(`/bills/${bill._id}/admin-charge`)).send({ amountPaise: 0 })).body.error.code).toBe('FINAL');
    // Payments are still taken on a final bill
    expect((await desk.post(`/api/billing/bills/${bill._id}/payments`).send({ mode: 'cash', amountPaise: 1000 })).status).toBe(201);

    // Reception may not reopen; billing may, with a reason
    expect((await (await as('reception')).post(ipd(`/bills/${bill._id}/reopen`)).send({ reason: 'Charge missed' })).status).toBe(403);
    expect((await desk.post(ipd(`/bills/${bill._id}/reopen`)).send({ reason: '' })).status).toBe(400);
    const re = await desk.post(ipd(`/bills/${bill._id}/reopen`)).send({ reason: 'Charge missed' });
    expect(re.body.bill.final).toBeNull();
    expect((await Bill.findOne({ tenantId: hospital._id, _id: bill._id }).lean()).reopened).toMatchObject([{ reason: 'Charge missed', byName: 'Sample billing' }]);
    expect((await AuditLog.find({ action: { $in: ['BILL_FINALISED', 'BILL_REOPENED', 'BILL_ADMIN_CHARGE_SET', 'DISCHARGE_DETAILS_RECORDED'] } }).lean()).length).toBe(5);

    // Final again, then cleared: the discharge can no longer be changed, nor the bill reopened
    await desk.post(ipd(`/bills/${bill._id}/final`)).send({});
    // The patient's record shows her doctor what the desk recorded, and that the bill is final (no amounts)
    const stays = (await (await as('drA')).get(`/api/patients/${String(bill.patientId)}/admissions`)).body.admissions;
    expect(stays[0]).toMatchObject({ discharge: { type: 'dama', label: expect.stringMatching(/^DAMA/), doctorName: 'Sample drA', remark: 'Relatives wish to go home' }, bill: { final: { byName: 'Sample billing' } } });
    expect(stays[0].bill).not.toHaveProperty('total');
    expect((await desk.post(`/api/admission-desk/stays/${stay.id}/clear`).send({ note: 'Balance to be paid by the relative (practice)' })).status).toBe(200);
    expect((await desk.post(ipd(`/stays/${stay.id}/discharge`)).send({ type: 'normal' })).body.error.code).toBe('CLEARED');
    expect((await desk.post(ipd(`/bills/${bill._id}/reopen`)).send({ reason: 'Charge missed' })).body.error.code).toBe('CLEARED');
  });

  it('a concession records who authorised it, from the hospital’s doctors and admins only', async () => {
    const { stay } = await admitted();
    const bill = await Bill.findOne({ tenantId: hospital._id, admissionId: stay.id }).lean();
    const desk = await as('billing');
    await desk.put(ipd(`/bills/${bill._id}/admin-charge`)).send({ amountPaise: 50000 });
    expect((await desk.post(`/api/billing/bills/${bill._id}/discount`).send({ mode: 'amount', value: 10000, reason: 'Staff family', authorisedBy: people.nurse._id.toString() })).body.error.fields).toHaveProperty('authorisedBy');
    const ok = await desk.post(`/api/billing/bills/${bill._id}/discount`).send({ mode: 'amount', value: 10000, reason: 'Staff family', authorisedBy: people.drA._id.toString() });
    expect(ok.body.bill.discountInfo).toMatchObject({ reason: 'Staff family', authorisedByName: 'Sample drA' });
  });

  it('a death recorded by the doctor is the type, shown to the desk only as "Record closed"', async () => {
    const { patient, stay } = await admitted();
    await discharge(stay.id);
    await Patient.updateOne({ _id: patient.id, tenantId: hospital._id }, { $set: { death: { on: new Date('2026-11-09T00:00:00Z') } } });
    const r = await (await as('billing')).post(ipd(`/stays/${stay.id}/discharge`)).send({ type: 'normal' });
    expect(r.body.discharge).toMatchObject({ type: 'closed', label: 'Record closed' });
    expect((await Admission.findOne({ tenantId: hospital._id, _id: stay.id }).lean()).dischargeInfo.type).toBe('death');
    expect((await (await as('reception')).get(ipd('/stays?status=discharged'))).body.stays[0].discharge).toMatchObject({ type: 'closed' });
    expect(JSON.stringify((await AuditLog.findOne({ action: 'DISCHARGE_DETAILS_RECORDED' }).lean()).details)).not.toMatch(/death/i);
    // Her doctor sees the word on her record's Stays tab and stay page
    expect((await (await as('drA')).get(`/api/patients/${patient.id}/admissions`)).body.admissions[0].discharge).toMatchObject({ type: 'death', label: 'Death' });
    expect((await (await as('drA')).get(`/api/patients/${patient.id}/admissions/${stay.id}`)).body.admission.discharge).toMatchObject({ type: 'death' });
  });
});
