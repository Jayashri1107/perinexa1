// Beds and admission at the desk (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): the admin sets up wards and
// beds; reception, doctors and RMOs admit to a free bed; the bed board; moving beds; what reception may see.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { admin: 'admin', drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
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
  hospital = await createTenant('Bed Hospital');
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
async function register(fullName = 'Bed Mother', overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName, ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-10-08' }, medical: { allergies: 'None known' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
async function setUpBeds() {
  const res = await (await as('admin')).post('/api/beds/setup').send({ ward: 'General ward', names: ['G1', 'G2', 'G10'] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Object.fromEntries(res.body.beds.map((b) => [b.name, b]));
}
const admit = async (who, bed, p, body = {}) => (await as(who)).post(`/api/beds/${bed.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour', ...body });
const board = async (who) => (await as(who)).get('/api/beds');

describe('wards and beds', () => {
  it('only the hospital admin sets them up; a bed name is not repeated in a ward; beds sort naturally', async () => {
    expect((await (await as('reception')).post('/api/beds/setup').send({ ward: 'X', names: ['1'] })).status).toBe(403);
    await setUpBeds();
    const again = await (await as('admin')).post('/api/beds/setup').send({ ward: 'general WARD', names: ['g2', 'G3'] });
    expect(again.status).toBe(400);
    expect(again.body.error.fields.names).toContain('g2');
    const setup = (await (await as('admin')).get('/api/beds/setup')).body;
    expect(setup.wards).toHaveLength(1);
    expect(setup.wards[0].beds.map((b) => b.name)).toEqual(['G1', 'G2', 'G10']);
    expect((await (await as('nurse')).get('/api/beds/setup')).status).toBe(403);
  });

  it('the admin sees free or occupied, never a name; a bed in use cannot be taken out of use', async () => {
    const beds = await setUpBeds();
    const p = await register();
    expect((await admit('reception', beds.G1, p)).status).toBe(201);
    const setup = (await (await as('admin')).get('/api/beds/setup')).body;
    expect(JSON.stringify(setup)).not.toContain('Bed Mother');
    expect(setup.wards[0].beds.find((b) => b.name === 'G1').occupied).toBe(true);
    const off = await (await as('admin')).patch(`/api/beds/setup/${beds.G1.id}`).send({ active: false });
    expect(off.body.error.code).toBe('BED_OCCUPIED');
    expect((await (await as('admin')).patch(`/api/beds/setup/${beds.G2.id}`).send({ active: false })).status).toBe(200);
    expect((await admit('reception', beds.G2, await register('Second Mother'))).body.error.code).toBe('BED_NOT_IN_USE');
    expect((await (await as('admin')).get('/api/beds')).status).toBe(403); // the board has names
  });
});

describe('admitting at the desk', () => {
  it('reception admits to a free bed; one patient per bed and one stay per patient; the stay is a normal stay', async () => {
    const beds = await setUpBeds();
    const p = await register();
    const res = await admit('reception', beds.G1, p, { reasonNote: 'sent from the OPD' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.admission).toMatchObject({ ward: 'General ward', bed: 'G1' });

    const q = await register('Second Mother');
    expect((await admit('reception', beds.G1, q)).body.error.code).toBe('BED_OCCUPIED');
    expect((await admit('reception', beds.G2, p)).body.error.code).toBe('ALREADY_ADMITTED');

    // The doctor sees the stay on her record, with the reason as written at the desk
    const stays = (await (await as('drA')).get(`/api/patients/${p.id}/admissions`)).body.admissions;
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ status: 'admitted', ward: 'General ward', bed: 'G1', reason: 'Labour – sent from the OPD', admittedByName: 'Sample reception' });

    const audit = await AuditLog.findOne({ action: 'ADMISSION_CREATED' }).lean();
    expect(audit.details).toMatchObject({ patientId: p.id, bedId: beds.G1.id, via: 'bed board' });
    expect(JSON.stringify(audit.details)).not.toContain('Labour');
  });

  it('who may admit: reception, her doctor, RMOs – not another doctor, nurses or the lab', async () => {
    const beds = await setUpBeds();
    const p = await register();
    expect((await admit('nurse', beds.G1, p)).status).toBe(403);
    expect((await admit('lab', beds.G1, p)).status).toBe(403);
    expect((await admit('drB', beds.G1, p)).status).toBe(403);
    expect((await admit('drA', beds.G1, p)).status).toBe(201);
    expect((await admit('rmo', beds.G2, await register('Second Mother'))).status).toBe(201);
  });

  it('"Other" needs a note; the admission cannot be in the future; the same request twice admits once', async () => {
    const beds = await setUpBeds();
    const p = await register();
    expect((await admit('reception', beds.G1, p, { reasonCode: 'other' })).body.error.fields.reasonNote).toBeTruthy();
    expect((await admit('reception', beds.G1, p, { reasonCode: 'unknown' })).status).toBe(400);
    expect((await admit('reception', beds.G1, p, { admittedAt: '2026-10-02T06:00:00.000Z' })).body.error.fields.admittedAt).toBeTruthy();
    const clientRequestId = randomUUID();
    expect((await admit('reception', beds.G1, p, { clientRequestId })).status).toBe(201);
    expect((await admit('reception', beds.G1, p, { clientRequestId })).status).toBe(200);
  });

  it("another hospital's beds and patients are not found", async () => {
    const beds = await setUpBeds();
    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Other reception' });
    await addMember(outsider, other, 'receptionist');
    const s = await loginAs(outsider, { app });
    const p = await register();
    expect((await s.post(`/api/beds/${beds.G1.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour' })).status).toBe(404);
    expect((await s.get('/api/beds')).body.wards).toEqual([]);
  });
});

describe('the bed board', () => {
  it('shows free and occupied beds with the patient, her doctor and the reason; reading it is audited with counts only', async () => {
    const beds = await setUpBeds();
    const p = await register();
    await admit('reception', beds.G2, p);
    const res = await board('reception');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ total: 3, occupied: 1, free: 2 });
    const g2 = res.body.wards[0].beds.find((b) => b.name === 'G2');
    expect(g2.stay).toMatchObject({ reason: 'Labour', canMove: true, patient: { fullName: 'Bed Mother', mrn: p.mrn, assignedDoctorName: 'Sample drA' } });
    expect(res.body.wards[0].beds.find((b) => b.name === 'G1').stay).toBeNull();
    const audit = await AuditLog.findOne({ action: 'BEDS_VIEWED' }).lean();
    expect(audit.details).toEqual({ occupied: 1, withoutBed: 0 });
    expect((await board('lab')).status).toBe(403);
    // The counts alone (reception's Today page): no names, not audited
    const summary = await (await as('reception')).get('/api/beds?summary=1');
    expect(summary.body).toEqual({ counts: { total: 3, occupied: 1, free: 2 } });
    expect(await AuditLog.countDocuments({ action: 'BEDS_VIEWED' })).toBe(1);
    // The free beds alone (admitting from a patient's record)
    const free = await (await as('reception')).get('/api/beds?free=1');
    expect(free.body.beds.map((b) => b.label)).toEqual(['General ward · G1', 'General ward · G10']);
    expect(await AuditLog.countDocuments({ action: 'BEDS_VIEWED' })).toBe(1);
  });

  it('reception never sees the reason on a sensitive record or one typed by a clinician; the doctor does', async () => {
    const beds = await setUpBeds();
    const p = await register();
    await admit('reception', beds.G1, p);
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { sensitive: true });
    expect((await board('reception')).body.wards[0].beds[0].stay.reason).toBeNull();
    expect((await board('drA')).body.wards[0].beds[0].stay.reason).toBe('Labour');

    // A stay admitted from her record (typed reason, typed bed) is listed apart, and reception sees no reason
    const q = await register('Typed Mother');
    const typed = await (await as('rmo')).post(`/api/patients/${q.id}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour ward', bed: '3', reason: 'In labour, 39 weeks' });
    expect(typed.status).toBe(201);
    const desk = (await board('reception')).body;
    expect(desk.elsewhere).toHaveLength(1);
    expect(desk.elsewhere[0]).toMatchObject({ ward: 'Labour ward', bed: '3', reason: null, patient: { fullName: 'Typed Mother' } });
    expect((await board('rmo')).body.elsewhere[0].reason).toBe('In labour, 39 weeks');
  });
});

describe('moving to another bed', () => {
  it('reception and nurses move her to a free bed; never to an occupied one; the old bed is free again', async () => {
    const beds = await setUpBeds();
    const p = await register();
    const q = await register('Second Mother');
    await admit('reception', beds.G1, p);
    await admit('reception', beds.G2, q);
    const stayId = (await board('reception')).body.wards[0].beds.find((b) => b.name === 'G1').stay.id;
    const move = async (who, bed) => (await as(who)).post(`/api/beds/stays/${stayId}/move`).send({ bedId: bed.id });
    expect((await move('reception', beds.G2)).body.error.code).toBe('BED_OCCUPIED');
    expect((await move('lab', beds.G10)).status).toBe(403);
    expect((await move('drB', beds.G10)).status).toBe(403);
    const moved = await move('nurse', beds.G10);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.admission).toMatchObject({ ward: 'General ward', bed: 'G10' });
    const now = (await board('reception')).body;
    expect(now.wards[0].beds.find((b) => b.name === 'G1').stay).toBeNull();
    expect(now.wards[0].beds.find((b) => b.name === 'G10').stay.patient.fullName).toBe('Bed Mother');
    expect(await AuditLog.countDocuments({ action: 'ADMISSION_BED_CHANGED' })).toBe(1);
  });
});

describe("the front desk's stays (owner, 14 Oct 2026)", () => {
  it('counts who is in and admitted today, lists who is going home (a discharge card being written) and who went home today', async () => {
    const { Admission } = await import('../src/models/Admission.js');
    const { ClinicalDocument } = await import('../src/models/ClinicalDocument.js');
    const beds = await setUpBeds();
    const staying = await register('Staying Mother');
    const going = await register('Going Mother');
    const gone = await register('Gone Mother');
    for (const [bed, p] of [[beds.G1, staying], [beds.G2, going], [beds.G10, gone]]) expect((await admit('reception', bed, p)).status).toBe(201);
    const stayOf = async (p) => Admission.findOne({ tenantId: hospital._id, patientId: p.id, status: 'admitted' });
    const goingStay = await stayOf(going);
    await ClinicalDocument.create({ tenantId: hospital._id, patientId: goingStay.patientId, admissionId: goingStay._id, kind: 'discharge', createdBy: people.drA._id, createdByName: 'Sample drA', clientRequestId: randomUUID() });
    const goneStay = await stayOf(gone);
    await Admission.updateOne({ tenantId: hospital._id, _id: goneStay._id }, { $set: { status: 'discharged', dischargedAt: NOW, dischargedByName: 'Sample drA' } });

    const res = await (await as('reception')).get('/api/beds/desk');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ inHospital: 2, admittedToday: 2 });
    expect(res.body.goingHome.map((x) => [x.patient.fullName, x.ward, x.bed])).toEqual([['Going Mother', 'General ward', 'G2']]);
    expect(res.body.dischargedToday.map((x) => [x.patient.fullName, x.bed, x.byName])).toEqual([['Gone Mother', 'G10', 'Sample drA']]);
    expect(JSON.stringify(res.body)).not.toMatch(/content|reason/); // names and beds only
    expect(await AuditLog.countDocuments({ action: 'DISCHARGES_VIEWED' })).toBe(1);
    expect((await (await as('lab')).get('/api/beds/desk')).status).toBe(403);
  });
});

describe('admission type and medico-legal case (owner, 14 Oct 2026)', () => {
  it('are saved with the stay (planned and not MLC unless chosen), and a wrong type is refused', async () => {
    const { Admission } = await import('../src/models/Admission.js');
    const beds = await setUpBeds();
    const planned = await register('Planned Mother');
    const emergency = await register('Emergency Mother');
    expect((await admit('reception', beds.G1, planned)).status).toBe(201);
    expect((await admit('reception', beds.G2, emergency, { admissionType: 'emergency', mlc: true })).status).toBe(201);
    const stay = async (p) => Admission.findOne({ tenantId: hospital._id, patientId: p.id, status: 'admitted' }).lean();
    expect(await stay(planned)).toMatchObject({ admissionType: 'planned', mlc: false });
    expect(await stay(emergency)).toMatchObject({ admissionType: 'emergency', mlc: true });
    const bad = await admit('reception', beds.G10, await register('Wrong Mother'), { admissionType: 'urgent' });
    expect(bad.status).toBe(400);
  });
});

describe("the hospital admin's Today (owner, 14 Oct 2026): numbers only", () => {
  it('gets the bed counts and the stay counts, never a name, and still not the bed board', async () => {
    const beds = await setUpBeds();
    const p = await register('Counted Mother');
    expect((await admit('reception', beds.G1, p)).status).toBe(201);
    const summary = await (await as('admin')).get('/api/beds?summary=1');
    expect(summary.status).toBe(200);
    expect(summary.body.counts).toMatchObject({ total: 3, occupied: 1, free: 2 });
    const desk = await (await as('admin')).get('/api/beds/desk');
    expect(desk.status).toBe(200);
    expect(desk.body).toMatchObject({ inHospital: 1, admittedToday: 1, goingHomeCount: 0, dischargedTodayCount: 0, goingHome: [], dischargedToday: [], numbersOnly: true });
    expect(JSON.stringify(desk.body)).not.toMatch(/Counted Mother/);
    expect((await board('admin')).status).toBe(403);
    expect((await (await as('admin')).get('/api/beds?free=1')).status).toBe(403);
  });
});
