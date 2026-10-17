// Admission like a hospital system (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md): IPD numbers, the checklist at the
// desk, a doctor's admission request, the admission papers, clearance for leaving with a gate pass, and the OPD number
// with its case paper. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Bill } from '../src/models/Bill.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-17T06:00:00Z');
const ROLES = { admin: 'admin', drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', billing: 'billing' };
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
  hospital = await createTenant('Desk Hospital');
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
async function register(fullName = 'Ward Mother', overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName, ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-10-24' }, medical: { allergies: 'Penicillin', bloodGroup: 'B+' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function beds() {
  const res = await (await as('admin')).post('/api/beds/setup').send({ ward: 'General ward', names: ['G1', 'G2', 'G3'] });
  return Object.fromEntries(res.body.beds.map((b) => [b.name, b]));
}
const CHECKLIST = { idProof: 'aadhaar', idLast4: '1234', attendantName: 'Sample Husband', attendantRelation: 'Husband', attendantPhone: '98765 11111', payer: 'self', payerName: '', consentSigned: true };
const admit = async (who, bed, p, body = {}) => (await as(who)).post(`/api/beds/${bed.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour', ...body });
const rules = async (body) => (await as('admin')).put('/api/admission-desk/rules').send(body);

describe('IPD numbers and the checklist', () => {
  it('every stay gets an IPD number; an incomplete checklist is flagged, and refused once the hospital requires it', async () => {
    const b = await beds();
    const p1 = await register('First Mother');
    const p2 = await register('Second Mother');
    const one = await admit('reception', b.G1, p1);
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body.admission).toMatchObject({ ipdNo: 'IP-2026-000001', checklistComplete: false });
    const board = (await (await as('reception')).get('/api/beds')).body;
    expect(board.wards[0].beds[0].stay).toMatchObject({ ipdNo: 'IP-2026-000001', checklistIncomplete: true });

    expect((await rules({ requireAdmissionRequest: false, requireChecklist: true })).body).toMatchObject({ requireChecklist: true });
    const refused = await admit('reception', b.G2, p2);
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.body.error.fields)).toEqual(expect.arrayContaining(['checklist.idProof', 'checklist.attendantName', 'checklist.consentSigned']));
    expect((await admit('reception', b.G2, p2, { checklist: { ...CHECKLIST, idLast4: '1234 5678 9012' } })).status).toBe(400); // never the whole number
    expect((await admit('reception', b.G2, p2, { checklist: CHECKLIST, mlc: true })).body.error.fields).toHaveProperty('mlcPolice');
    const two = await admit('reception', b.G2, p2, { checklist: CHECKLIST, mlc: true, mlcPolice: 'Sample Nagar police station' });
    expect(two.body.admission).toMatchObject({ ipdNo: 'IP-2026-000002', checklistComplete: true });

    // An emergency goes in at once; the desk completes the checklist later
    const p3 = await register('Third Mother');
    const em = await admit('reception', b.G3, p3, { admissionType: 'emergency' });
    expect(em.status).toBe(201);
    const fill = await (await as('reception')).put(`/api/admission-desk/stays/${em.body.admission.id}/checklist`).send({ checklist: CHECKLIST });
    expect(fill.body).toMatchObject({ checklist: { complete: true, idLast4: '1234' }, missing: {} });
    const entry = await AuditLog.findOne({ action: 'ADMISSION_CHECKLIST_UPDATED' }).lean();
    expect(JSON.stringify(entry.details)).not.toMatch(/1234|Husband|98765/);
    expect((await (await as('admin')).put('/api/admission-desk/rules').send({ requireAdmissionRequest: false }))).toBeTruthy();
    expect((await (await as('nurse')).put('/api/admission-desk/rules').send({ requireAdmissionRequest: true })).status).toBe(403);
  });
});

describe("a doctor's admission request", () => {
  it('the doctor asks; reception admits from it; with the rule on, reception needs one (an emergency is marked)', async () => {
    const b = await beds();
    const p = await register();
    expect((await (await as('reception')).post('/api/admission-desk/requests').send({ patientId: p.id, reasonCode: 'labour' })).status).toBe(403);
    expect((await (await as('drB')).post('/api/admission-desk/requests').send({ patientId: p.id, reasonCode: 'labour' })).status).toBe(403); // another doctor's patient
    const r = await (await as('drA')).post('/api/admission-desk/requests').send({ patientId: p.id, reasonCode: 'caesarean_planned', ward: 'General ward', expectedOn: '2026-10-18', note: 'Fasting from midnight' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await (await as('drA')).post('/api/admission-desk/requests').send({ patientId: p.id, reasonCode: 'labour' })).status).toBe(409); // one open request
    const list = (await (await as('reception')).get('/api/admission-desk/requests')).body.requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ patient: { fullName: 'Ward Mother' }, reason: 'Caesarean section – planned', expectedOn: '2026-10-18', requested: { byName: 'Sample drA' } });

    await rules({ requireAdmissionRequest: true });
    const other = await register('No Request Mother');
    expect((await admit('reception', b.G2, other)).body.error.code).toBe('REQUEST_NEEDED');
    const em = await admit('reception', b.G2, other, { admissionType: 'emergency' });
    expect(em.status).toBe(201);
    expect((await Admission.findOne({ _id: em.body.admission.id, tenantId: hospital._id }).lean()).withoutRequest).toBe(true);

    const ok = await admit('reception', b.G1, p, { requestId: list[0].id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await (await as('reception')).get('/api/admission-desk/requests')).body.requests).toEqual([]);
    expect(String((await Admission.findOne({ _id: ok.body.admission.id, tenantId: hospital._id }).lean()).requestId)).toBe(list[0].id);
    expect((await AuditLog.find({ action: /^ADMISSION_REQUEST/ }).lean()).map((e) => e.action)).toEqual(['ADMISSION_REQUESTED']);
  });
});

describe('the papers, clearance and the gate pass', () => {
  it('reception sees no blood group or allergies on the wristband; a nurse does; printouts are recorded', async () => {
    const b = await beds();
    const p = await register();
    const stay = (await admit('reception', b.G1, p, { checklist: CHECKLIST })).body.admission;
    const forDesk = (await (await as('reception')).get(`/api/admission-desk/stays/${stay.id}/papers`)).body.papers;
    expect(forDesk).toMatchObject({ ipdNo: 'IP-2026-000001', ward: 'General ward', bed: 'G1', medical: false, checklist: { attendantName: 'Sample Husband', complete: true } });
    expect(forDesk.patient).not.toHaveProperty('allergies');
    const forNurse = (await (await as('nurse')).get(`/api/admission-desk/stays/${stay.id}/papers`)).body.papers;
    expect(forNurse.patient).toMatchObject({ bloodGroup: 'B+', allergies: 'Penicillin' });
    expect((await (await as('reception')).post(`/api/admission-desk/stays/${stay.id}/printed`).send({ what: 'wristband' })).status).toBe(200);
    expect((await (await as('reception')).post(`/api/admission-desk/stays/${stay.id}/printed`).send({ what: 'gatepass' })).status).toBe(409);
  });

  it('cleared for leaving only after the discharge; dues need a reason; the gate pass gets a number', async () => {
    const b = await beds();
    const p = await register();
    const stay = (await admit('reception', b.G1, p, { checklist: CHECKLIST })).body.admission;
    expect((await (await as('reception')).post(`/api/admission-desk/stays/${stay.id}/clear`).send({})).body.error.code).toBe('NOT_DISCHARGED');
    // Something on her bill, unpaid
    const bill = await Bill.findOne({ tenantId: hospital._id, admissionId: stay.id }).lean();
    const other = (await (await as('reception')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    await (await as('reception')).post(`/api/billing/bills/${bill._id}/lines`).send({ priceItemId: other.id, ratePaise: 150000, name: 'Delivery charges' });
    await Admission.updateOne({ _id: stay.id, tenantId: hospital._id }, { $set: { status: 'discharged', dischargedAt: NOW, dischargedByName: 'Sample drA' } });

    const toClear = (await (await as('billing')).get('/api/admission-desk/to-clear')).body;
    expect(toClear).toMatchObject({ canClear: true, stays: [{ id: stay.id, ipdNo: 'IP-2026-000001', balancePaise: 150000 }] });
    expect((await (await as('nurse')).post(`/api/admission-desk/stays/${stay.id}/clear`).send({})).status).toBe(403);
    const dues = await (await as('billing')).post(`/api/admission-desk/stays/${stay.id}/clear`).send({});
    expect(dues.body.error.fields.note).toMatch(/1,500 is still due/);
    const ok = await (await as('billing')).post(`/api/admission-desk/stays/${stay.id}/clear`).send({ note: 'Insurance claim pending (practice)' });
    expect(ok.body.papers.clearance).toMatchObject({ passNo: 'GP-2026-000001', balancePaise: 150000, byName: 'Sample billing' });
    expect((await (await as('billing')).get('/api/admission-desk/to-clear')).body.stays).toEqual([]);
    expect((await (await as('reception')).post(`/api/admission-desk/stays/${stay.id}/printed`).send({ what: 'gatepass' })).status).toBe(200);
    expect((await AuditLog.findOne({ action: 'DISCHARGE_CLEARED' }).lean()).details).toMatchObject({ admissionId: stay.id, balancePaise: 150000 });
  });
});

describe('the OPD number and case paper', () => {
  it('marking her arrived gives the OPD number once; the case paper has it with her token and doctor', async () => {
    const p = await register('Opd Patient', { careType: 'gynaecology', pregnancy: undefined });
    expect((await (await as('reception')).get(`/api/arrivals/${p.id}/case-paper`)).body.error.code).toBe('NOT_ARRIVED');
    const first = await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, doctorId: people.drA._id.toString() });
    expect(first.body.arrival.opdNo).toBe('OP-2026-000001');
    const again = await (await as('reception')).post('/api/arrivals').send({ patientId: p.id });
    expect(again.body.arrival.opdNo).toBe('OP-2026-000001');
    const paper = (await (await as('reception')).get(`/api/arrivals/${p.id}/case-paper`)).body.paper;
    expect(paper).toMatchObject({ opdNo: 'OP-2026-000001', date: '2026-10-17', token: 1, doctorName: 'Sample drA', patient: { fullName: 'Opd Patient', mrn: p.mrn, age: 27 } });
    expect((await (await as('reception')).post(`/api/arrivals/${p.id}/case-paper/printed`).send({})).status).toBe(200);
    expect((await AuditLog.findOne({ action: 'OPD_CASE_PAPER_PRINTED' }).lean()).details).toMatchObject({ opdNo: 'OP-2026-000001' });
    const second = await register('Opd Two', { careType: 'gynaecology', pregnancy: undefined, phone: '98765 22222' });
    expect((await (await as('reception')).post('/api/arrivals').send({ patientId: second.id })).body.arrival.opdNo).toBe('OP-2026-000002');
  });
});
