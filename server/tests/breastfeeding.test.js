// The postnatal record: "Breastfeeding: yes / no / not recorded" – a clinical detail, set by those who may edit a
// patient's clinical details, used by the medicine safety check. Fake data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { breastfeedingOnVisit } from '../../client/src/pages/medsafety/medSafety.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharm: 'pharmacist', admin: 'admin' };

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  app = createApp();
  hospital = await createTenant('Postnatal Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));

// A patient of drA, registered by reception; the clinical details come later.
async function register(fields = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Sample Mother', assignedDoctor: people.drA._id.toString(), ...fields }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const patch = async (who, p, body) => (await as(who)).patch(`/api/patients/${p.id}`).send(body);
const view = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;

describe('breastfeeding on the postnatal record', () => {
  it('starts as not recorded; the treating doctor or an RMO records yes or no, and can clear it again', async () => {
    const p = await register();
    expect((await view('drA', p)).postnatal).toEqual({ breastfeeding: '' });

    const yes = await patch('drA', p, { postnatal: { breastfeeding: 'yes' } });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    expect(yes.body.patient.postnatal).toEqual({ breastfeeding: 'yes' });
    expect((await patch('rmo', p, { postnatal: { breastfeeding: 'no' } })).body.patient.postnatal.breastfeeding).toBe('no');
    expect((await patch('rmo', p, { postnatal: { breastfeeding: '' } })).body.patient.postnatal.breastfeeding).toBe('');
    // Nothing else on the record was touched
    expect((await view('drA', p)).fullName).toBe('Sample Mother');
  });

  it('only those who edit clinical details may change it', async () => {
    const p = await register();
    for (const who of ['nurse', 'reception', 'drB', 'lab', 'pharm']) {
      const res = await patch(who, p, { postnatal: { breastfeeding: 'yes' } });
      expect(res.status, who).toBe(403);
    }
    expect((await patch('admin', p, { postnatal: { breastfeeding: 'yes' } })).status).toBe(403); // no patient access at all
    expect((await Patient.findOne({ tenantId: hospital._id, _id: p.id }).lean()).postnatal?.breastfeeding ?? '').toBe('');
  });

  it('is a clinical detail: nurses and other doctors see it; reception, lab and the pharmacist do not', async () => {
    const p = await register();
    await patch('drA', p, { postnatal: { breastfeeding: 'yes' } });
    for (const who of ['nurse', 'drB', 'rmo']) expect((await view(who, p)).postnatal, who).toEqual({ breastfeeding: 'yes' });
    for (const who of ['reception', 'lab', 'pharm']) expect((await view(who, p)).postnatal, who).toBeUndefined();
    // A sensitive record: identity only for the nurse and for another doctor
    await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true });
    for (const who of ['nurse', 'drB']) expect((await view(who, p)).postnatal, who).toBeUndefined();
    // The patient list never carries it
    const row = (await (await as('reception')).get('/api/patients')).body.patients.find((x) => x.id === p.id);
    expect(row.postnatal).toBeUndefined();
  });

  it('accepts only yes, no or not recorded, and only for a postnatal patient', async () => {
    const p = await register();
    const bad = await patch('drA', p, { postnatal: { breastfeeding: 'sometimes' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['postnatal.breastfeeding']).toBe('Choose yes, no or not recorded');
    expect((await patch('drA', p, { postnatal: { breastfeeding: 'yes', formula: true } })).status).toBe(400);

    const gynae = await register({ careType: 'gynaecology', fullName: 'Sample Gynae' });
    const refused = await patch('drA', gynae, { postnatal: { breastfeeding: 'yes' } });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe('Breastfeeding is recorded only for a postnatal patient.');
    // Not with a change away from postnatal care either
    expect((await patch('drA', p, { careType: 'gynaecology', postnatal: { breastfeeding: 'yes' } })).status).toBe(400);
  });

  it('is asked again after the next delivery: leaving postnatal care clears the answer', async () => {
    const p = await register();
    await patch('drA', p, { postnatal: { breastfeeding: 'no' }, medical: { allergies: 'None known' } });
    const moved = await patch('drA', p, { careType: 'gynaecology' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const back = await patch('drA', p, { careType: 'postnatal' });
    expect(back.body.patient.postnatal).toEqual({ breastfeeding: '' });
    // …so the medicine check says "if she is breastfeeding" again, instead of staying silent on an old "no"
    expect(breastfeedingOnVisit(back.body.patient)).toBe('unknown');
  });

  it('the audit log gets the name of the field only, never the answer', async () => {
    const p = await register();
    await patch('drA', p, { postnatal: { breastfeeding: 'yes' } });
    const entries = await AuditLog.find({ tenantId: hospital._id, action: 'PATIENT_UPDATED' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual({ patientId: p.id, mrn: p.mrn, fields: ['postnatal.breastfeeding'] });
    // Saving the same answer again is not a change
    await patch('drA', p, { postnatal: { breastfeeding: 'yes' } });
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'PATIENT_UPDATED' })).toBe(1);
  });

  it('reception changing the type of care clears the answer – and the audit log says that it changed, and who did it', async () => {
    const p = await register();
    await patch('drA', p, { postnatal: { breastfeeding: 'no' } });
    // Reception may change the type of care (not the answer itself, which she cannot even see)
    const moved = await patch('reception', p, { careType: 'gynaecology' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.patient.postnatal).toBeUndefined();
    expect((await Patient.findOne({ tenantId: hospital._id, _id: p.id }).lean()).postnatal.breastfeeding).toBe('');
    const back = await patch('reception', p, { careType: 'postnatal' });
    expect(back.status).toBe(200);
    expect((await view('drA', p)).postnatal).toEqual({ breastfeeding: '' });
    const log = await AuditLog.find({ tenantId: hospital._id, action: 'PATIENT_UPDATED' }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(log.map((e) => [String(e.actor), e.details.fields])).toEqual([
      [String(people.drA._id), ['postnatal.breastfeeding']],
      [String(people.reception._id), ['careType', 'postnatal.breastfeeding']], // the field's name only, never the answer
      [String(people.reception._id), ['careType']], // nothing was recorded to clear on the way back
    ]);
    expect(JSON.stringify(log.map((e) => e.details))).not.toMatch(/"(yes|no)"/);
    // Leaving postnatal care with nothing recorded is not a change of the answer
    const q = await register({ fullName: 'Sample Second' });
    await patch('reception', q, { careType: 'gynaecology' });
    const last = await AuditLog.findOne({ tenantId: hospital._id, action: 'PATIENT_UPDATED', 'details.patientId': q.id }).lean();
    expect(last.details.fields).toEqual(['careType']);
  });

  it('a record saved before this field existed reads as not recorded and still saves', async () => {
    const p = await register();
    await Patient.collection.updateOne({ _id: (await Patient.findOne({ tenantId: hospital._id, mrn: p.mrn }))._id }, { $unset: { postnatal: '' } });
    expect((await view('drA', p)).postnatal).toEqual({ breastfeeding: '' });
    const saved = await patch('drA', p, { notes: 'Seen today.' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.patient.postnatal).toEqual({ breastfeeding: '' });
  });

  it("another hospital's patient is not found", async () => {
    const p = await register();
    const other = await createTenant('Other Postnatal Hospital');
    people.otherDr = await createUser({ name: 'Sample otherDr' });
    await addMember(people.otherDr, other, 'doctor');
    const res = await patch('otherDr', p, { postnatal: { breastfeeding: 'yes' } });
    expect(res.status).toBe(404);
    expect((await (await as('otherDr')).get(`/api/patients/${p.id}`)).status).toBe(404);
  });
});

describe('who gets the breastfeeding warnings (the website’s rule)', () => {
  it('postnatal patients who are breastfeeding or for whom it is not recorded; nobody else', () => {
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } })).toBe('yes');
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: '' } })).toBe('unknown');
    expect(breastfeedingOnVisit({ careType: 'postnatal' })).toBe('unknown'); // an older record
    expect(breastfeedingOnVisit({ careType: 'postnatal', postnatal: { breastfeeding: 'no' } })).toBeNull();
    for (const careType of ['antenatal', 'gynaecology', 'infertility', 'abortion', 'newborn']) expect(breastfeedingOnVisit({ careType, postnatal: { breastfeeding: 'yes' } })).toBeNull();
  });
});
