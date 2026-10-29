// The hospital's admission form (29 Oct 2026): a doctor in more than one department, the department then its doctor in
// charge when admitting, the referring doctor, a medico-legal case's papers, the attendant's address, and beds by floor.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Membership } from '../src/models/Membership.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-29T06:00:00Z');
const ROLES = { admin: 'admin', drA: 'doctor', drB: 'doctor', reception: 'receptionist' };
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
  hospital = await createTenant('Form Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role, role === 'admin' ? { adminRights: ['roles'] } : {});
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const memberOf = (who) => Membership.findOne({ tenantId: hospital._id, userId: people[who]._id });
const setDepartments = async (who, body) => (await as('admin')).patch(`/api/tenant/members/${(await memberOf(who))._id}/department`).send(body);
async function register(fullName = 'Form Mother') {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-20' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

describe('a doctor in more than one department', () => {
  it('the admin ticks several departments; the doctors list gives them all; one department still works; new departments', async () => {
    let res = await setDepartments('drA', { departments: ['Neonatology', 'General Medicine'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.member).toMatchObject({ department: 'Neonatology', departments: ['Neonatology', 'General Medicine'] });
    res = await setDepartments('drB', { departments: ['Genetic Counselling', 'General'] });
    expect(res.body.member.departments).toEqual(['General', 'Genetic Counselling']); // in the list's order
    const doctors = (await (await as('reception')).get('/api/tenant/doctors')).body.doctors;
    expect(doctors.find((d) => d.name === 'Sample drA')).toMatchObject({ department: 'Neonatology', departments: ['Neonatology', 'General Medicine'] });
    expect((await setDepartments('drA', { department: 'Cardiology' })).body.member.departments).toEqual(['Cardiology']);
    expect((await setDepartments('drA', { departments: [] })).body.member).toMatchObject({ department: '', departments: [] });
    expect((await setDepartments('drA', { departments: ['Astrology'] })).status).toBe(400);
  });
});

describe('admitting with the hospital form', () => {
  it('department → its doctor in charge, the referring doctor, MLC papers and the attendant address are kept and printed', async () => {
    await setDepartments('drA', { departments: ['Obstetrics & Gynaecology'] });
    await setDepartments('drB', { departments: ['Neonatology'] });
    const setup = await (await as('admin')).post('/api/beds/setup').send({ floor: '2nd floor', ward: 'Deluxe AC', names: ['204', '205'] });
    expect(setup.status, JSON.stringify(setup.body)).toBe(201);
    expect(setup.body.beds[0]).toMatchObject({ floor: '2nd floor', ward: 'Deluxe AC', name: '204' });
    const [b204] = setup.body.beds;
    const p = await register();
    const admit = (body) => as('reception').then((s) => s.post(`/api/beds/${b204.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour', admissionType: 'emergency', ...body }));

    // A doctor not in the department chosen is refused
    let res = await admit({ department: 'Obstetrics & Gynaecology', doctorId: people.drB._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.doctorId).toMatch(/not in Obstetrics/);
    // An MLC needs its police station; then its papers are kept
    res = await admit({
      department: 'Neonatology',
      doctorId: people.drB._id.toString(),
      refDoctorName: 'Dr Sample Outside',
      mlc: true,
      mlcPolice: 'Sample Police Station',
      mlcNo: 'MLC-12',
      mlcAt: '2026-10-29T05:30:00.000Z',
      mlcConstable: 'Sample Constable',
      mlcBuckleNo: 'B-77',
      checklist: { attendantName: 'Sample Relative', attendantRelation: 'Mother', attendantPhone: '98765 00000', attendantAddress: '1 Sample Road, Sample Town' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const papers = (await (await as('reception')).get(`/api/admission-desk/stays/${res.body.admission.id}/papers`)).body.papers;
    expect(papers).toMatchObject({
      department: 'Neonatology',
      refDoctorName: 'Dr Sample Outside',
      mlcNo: 'MLC-12',
      mlcConstable: 'Sample Constable',
      mlcBuckleNo: 'B-77',
      ward: 'Deluxe AC',
      bed: '204',
      patient: { doctorName: 'Sample drB' },
      checklist: { attendantAddress: '1 Sample Road, Sample Town' },
    });
    expect(new Date(papers.mlcAt).toISOString()).toBe('2026-10-29T05:30:00.000Z');
  });

  it('without a doctor chosen, her assigned doctor is the doctor in charge', async () => {
    const [bed] = (await (await as('admin')).post('/api/beds/setup').send({ ward: 'General ward', names: ['G1'] })).body.beds;
    const p = await register('Default Mother');
    const res = await (await as('reception')).post(`/api/beds/${bed.id}/admit`).send({ clientRequestId: randomUUID(), patientId: p.id, reasonCode: 'labour', admissionType: 'emergency' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const papers = (await (await as('reception')).get(`/api/admission-desk/stays/${res.body.admission.id}/papers`)).body.papers;
    expect(papers.patient.doctorName).toBe('Sample drA');
    expect(papers.mlcNo).toBe('');
  });
});

describe('beds by floor', () => {
  it('the same room type on two floors; floors in order; the free list and the board name the floor', async () => {
    const add = (body) => as('admin').then((s) => s.post('/api/beds/setup').send(body));
    expect((await add({ floor: '2nd floor', ward: 'Private AC', names: ['201', '202'] })).status).toBe(201);
    expect((await add({ floor: '1st floor', ward: 'General ward', names: ['G1-G2'.replace('-', ','), 'G3'] })).status).toBe(201);
    expect((await add({ floor: '1st floor', ward: 'NICU', names: ['N1'] })).status).toBe(201);
    expect((await add({ ward: 'Labour room', names: ['L1'] })).status).toBe(201);
    const setup = (await (await as('admin')).get('/api/beds/setup')).body.wards;
    expect(setup.map((w) => [w.floor, w.ward])).toEqual([['1st floor', 'General ward'], ['1st floor', 'NICU'], ['2nd floor', 'Private AC'], ['', 'Labour room']]);
    const free = (await (await as('reception')).get('/api/beds?free=1')).body.beds.map((b) => b.label);
    expect(free).toEqual(['1st floor · General ward · G1,G2', '1st floor · General ward · G3', '1st floor · NICU · N1', '2nd floor · Private AC · 201', '2nd floor · Private AC · 202', 'Labour room · L1']);
    const boardWards = (await (await as('reception')).get('/api/beds')).body.wards;
    expect(boardWards[0]).toMatchObject({ floor: '1st floor', ward: 'General ward' });
    // The floor can be changed afterwards
    const bed = setup[3].beds[0];
    expect((await (await as('admin')).patch(`/api/beds/setup/${bed.id}`).send({ floor: 'Ground floor' })).body.bed.floor).toBe('Ground floor');
  });
});
