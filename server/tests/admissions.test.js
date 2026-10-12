// Inpatients (Version 2): stays, documents (draft → signed / confirmed by a doctor), the nursing chart.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
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
  hospital = await createTenant('Inpatient Hospital');
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
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Inpatient Mother', ageYears: 27, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-10-08' }, medical: { allergies: 'None known' }, ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const base = (p) => `/api/patients/${p.id}/admissions`;
const admit = async (who, p, body = {}) => (await as(who)).post(base(p)).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-01T02:00:00.000Z', ward: 'Labour ward', bed: '3', reason: 'In labour, 39 weeks', ...body });
const newDoc = async (who, p, a, kind) => (await as(who)).post(`${base(p)}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind });
const save = async (who, p, a, d, content) => (await as(who)).put(`${base(p)}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content });
const sign = async (who, p, a, d) => (await as(who)).post(`${base(p)}/${a.id}/documents/${d.id}/sign`).send({ rev: d.rev });

describe('a stay in hospital', () => {
  it('the doctor or an RMO admits her; once at a time; reception and nurses cannot; others see read-only', async () => {
    const p = await register();
    expect((await admit('nurse', p)).status).toBe(403);
    expect((await admit('reception', p)).status).toBe(403);
    expect((await admit('drB', p)).status).toBe(403); // another doctor's patient
    const res = await admit('rmo', p);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.admission).toMatchObject({ status: 'admitted', ward: 'Labour ward', bed: '3', reason: 'In labour, 39 weeks', admittedByName: 'Sample rmo', admittedAt: '2026-10-01T02:00:00.000Z' });
    expect((await admit('drA', p)).body.error.code).toBe('ALREADY_ADMITTED');
    const record = (await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient;
    expect(record.currentAdmission).toMatchObject({ id: res.body.admission.id, bed: '3' });
    expect('currentAdmission' in (await (await as('reception')).get(`/api/patients/${p.id}`)).body.patient).toBe(false);
    expect((await (await as('drB')).get(`${base(p)}/${res.body.admission.id}`)).status).toBe(200);
    expect((await (await as('lab')).get(base(p))).status).toBe(403);
  });

  it('documents: an RMO writes the delivery note, only a doctor confirms it; signed is locked; corrections are added', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const d = (await newDoc('rmo', p, a, 'delivery')).body.document;
    expect(d).toMatchObject({ kind: 'delivery', status: 'draft', rev: 0 });

    const incomplete = await sign('drA', p, a, d);
    expect(incomplete.status).toBe(400);
    expect(Object.keys(incomplete.body.error.fields)).toEqual(expect.arrayContaining(['content.deliveredAt', 'content.mode', 'content.babies']));

    const content = { deliveredAt: '2026-10-01T05:30:00.000Z', mode: 'lscs', indication: 'Fetal distress', gestationWeeks: 39, bloodLossMl: 600, babies: [{ sex: 'female', weightGrams: 3100, apgar1: 8, apgar5: 9, outcome: 'live' }] };
    const saved = await save('rmo', p, a, d, content);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await save('rmo', p, a, d, content)).status).toBe(409); // an old version
    const doc = saved.body.document;
    expect((await sign('rmo', p, a, doc)).status).toBe(403); // RMOs don't confirm delivery notes
    const inList = (await (await as('drA')).get('/api/inpatients')).body;
    expect(inList.toConfirm.map((x) => [x.kind, x.documentId])).toEqual([['delivery', doc.id]]);
    expect(inList.admitted).toMatchObject([{ admissionId: a.id, bed: '3', drafts: 1 }]);
    expect((await (await as('drB')).get('/api/inpatients')).body.toConfirm).toEqual([]); // not her doctor

    const signed = await sign('drA', p, a, doc);
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.document.signed).toMatchObject({ byName: 'Sample drA', role: 'doctor' });
    expect((await save('drA', p, a, signed.body.document, content)).body.error.code).toBe('DOCUMENT_SIGNED');
    const record = (await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient;
    expect(record.lastDelivery).toMatchObject({ at: '2026-10-01T05:30:00.000Z', mode: 'lscs' });

    const add = await (await as('nurse')).post(`${base(p)}/${a.id}/documents/${doc.id}/additions`).send({ text: 'Blood loss re-measured: 650 ml' });
    expect(add.body.document.additions.map((x) => [x.text, x.byName])).toEqual([['Blood loss re-measured: 650 ml', 'Sample nurse']]);
  });

  it('round notes are signed by the RMO who writes them; pregnancy notes are checked for the baby’s sex', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const d = (await newDoc('rmo', p, a, 'round')).body.document;
    expect((await save('rmo', p, a, d, { at: '2026-10-01T05:50:00.000Z', assessment: 'The baby is a boy' })).status).toBe(400); // PCPNDT
    const s = await save('rmo', p, a, d, { at: '2026-10-01T05:50:00.000Z', assessment: 'Stable', plan: 'Continue' });
    const signed = await sign('rmo', p, a, s.body.document);
    expect(signed.status).toBe(200);
    expect(signed.body.document.signed.role).toBe('rmo');
    expect((await newDoc('rmo', p, a, 'round')).status).toBe(201); // many rounds
    expect((await newDoc('rmo', p, a, 'admission')).status).toBe(201);
    expect((await newDoc('rmo', p, a, 'admission')).body.error.code).toBe('ALREADY_EXISTS'); // one admission note
  });

  it('confirming the discharge card discharges her; the card starts from the stay’s notes; nothing more can be added', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const adm = (await newDoc('rmo', p, a, 'admission')).body.document;
    expect(adm.content.reason).toBe('In labour, 39 weeks');
    await save('rmo', p, a, adm, { reason: 'In labour, 39 weeks', provisionalDiagnosis: 'Term pregnancy in labour' });
    const op = (await newDoc('rmo', p, a, 'operation')).body.document;
    await save('rmo', p, a, op, { performedAt: '2026-10-01T05:00:00.000Z', procedure: 'Lower segment caesarean section' });

    const card = (await newDoc('rmo', p, a, 'discharge')).body.document;
    expect(card.content).toMatchObject({ finalDiagnosis: 'Term pregnancy in labour', procedures: 'Lower segment caesarean section' });
    const tooEarly = await save('rmo', p, a, card, { ...card.content, dischargedAt: '2026-09-30T05:00:00.000Z', finalDiagnosis: 'Delivered by LSCS' });
    expect(await sign('drA', p, a, tooEarly.body.document).then((r) => r.body.error.fields['content.dischargedAt'])).toMatch(/before she was admitted/);
    const ok = await save('rmo', p, a, tooEarly.body.document, { ...card.content, dischargedAt: '2026-10-01T05:55:00.000Z', finalDiagnosis: 'Delivered by LSCS', medicines: [{ drug: 'Iron', form: 'tab', frequency: '1-0-0', durationValue: 30, durationUnit: 'days' }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const res = await sign('drA', p, a, ok.body.document);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.admission).toMatchObject({ status: 'discharged', dischargedAt: '2026-10-01T05:55:00.000Z', dischargedByName: 'Sample drA' });
    expect((await newDoc('rmo', p, a, 'round')).status).toBe(409);
    expect((await admit('drA', p)).status).toBe(201); // a new stay can start
  });

  it('the nursing chart: vital signs, medicines given and notes; corrected only by "entered in error"', async () => {
    const p = await register();
    const a = (await admit('drA', p)).body.admission;
    const chart = async (who, body) => (await as(who)).post(`${base(p)}/${a.id}/nursing`).send({ clientRequestId: randomUUID(), ...body });
    expect((await chart('nurse', { kind: 'vitals', vitals: {} })).status).toBe(400);
    expect((await chart('nurse', { kind: 'vitals', vitals: { bpSystolic: 130 } })).status).toBe(400); // both BP numbers
    const v = await chart('nurse', { kind: 'vitals', vitals: { bpSystolic: 130, bpDiastolic: 84, pulse: 88 } });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    await chart('nurse', { kind: 'medicine', medicine: { drug: 'Inj Oxytocin', dose: '10 IU', route: 'IM' } });
    const page = (await chart('rmo', { kind: 'note', note: 'Comfortable, breastfeeding' })).body;
    expect(page.nursing.map((e) => `${e.kind}:${e.byName}`).sort()).toEqual(['medicine:Sample nurse', 'note:Sample rmo', 'vitals:Sample nurse']);
    expect((await chart('reception', { kind: 'note', note: 'x' })).status).toBe(403);
    const entry = page.nursing.find((e) => e.kind === 'medicine');
    const cancelled = await (await as('nurse')).post(`${base(p)}/${a.id}/nursing/${entry.id}/cancel`).send({ reason: 'Wrong patient chart' });
    expect(cancelled.body.nursing.find((e) => e.id === entry.id).cancelled).toMatchObject({ reason: 'Wrong patient chart', byName: 'Sample nurse' });
  });

  it('the audit log gets ids and the kind only – never what was written', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const d = (await newDoc('rmo', p, a, 'round')).body.document;
    await save('rmo', p, a, d, { at: '2026-10-01T05:50:00.000Z', assessment: 'Secret clinical words', plan: 'Continue' });
    const entries = await AuditLog.find({ action: { $in: ['ADMISSION_CREATED', 'DOCUMENT_CREATED', 'DOCUMENT_UPDATED'] } }).lean();
    expect(entries.map((e) => e.action).sort()).toEqual(['ADMISSION_CREATED', 'DOCUMENT_CREATED', 'DOCUMENT_UPDATED']);
    expect(JSON.stringify(entries)).not.toMatch(/Secret|labour/i);
    const u = entries.find((e) => e.action === 'DOCUMENT_UPDATED');
    expect(safeAuditDetails('DOCUMENT_UPDATED', { ...u.details, assessment: 'x' })).toEqual(u.details);
  });
});

describe('printing a document (5 Oct 2026: the discharge card in English with Marathi or Hindi)', () => {
  const printed = async (who, p, a, d, body) => (await as(who)).post(`${base(p)}/${a.id}/documents/${d.id}/printed`).send(body);

  it('records the language printed next to the English on the discharge card; staff documents print in English only', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const card = (await newDoc('rmo', p, a, 'discharge')).body.document;
    const round = (await newDoc('rmo', p, a, 'round')).body.document;
    expect((await printed('rmo', p, a, card, { language: 'mr' })).status).toBe(200);
    expect((await printed('nurse', p, a, card, { language: 'hi' })).status).toBe(200);
    expect((await printed('drB', p, a, card, {})).status).toBe(200); // another doctor's patient: read only, may print
    expect((await printed('rmo', p, a, card, { language: 'en' })).status).toBe(200);
    expect((await printed('rmo', p, a, round)).status).toBe(200); // no body, as before
    const refused = await printed('rmo', p, a, round, { language: 'mr' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.language).toBe('Only the discharge card is printed in Marathi or Hindi.');
    for (const language of ['gu', 'HI', 'hindi', '', null]) expect((await printed('rmo', p, a, card, { language })).status, String(language)).toBe(400);
    expect((await printed('rmo', p, a, card, { language: 'mr', text: 'Sample' })).status).toBe(400);
    for (const who of ['reception', 'lab']) expect((await printed(who, p, a, card, { language: 'mr' })).status, who).toBe(403);

    const entries = await AuditLog.find({ action: 'DOCUMENT_PRINTED' }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => [e.details.kind, e.details.language ?? null, e.details.access])).toEqual([
      ['discharge', 'mr', 'full'],
      ['discharge', 'hi', 'clinical'],
      ['discharge', null, 'read_only'],
      ['discharge', null, 'full'], // English only: recorded as before
      ['round', null, 'full'],
    ]);
    expect(entries[0].details).toEqual({ patientId: p.id, mrn: p.mrn, admissionId: a.id, documentId: card.id, kind: 'discharge', language: 'mr', access: 'full' });
    expect(safeAuditDetails('DOCUMENT_PRINTED', { ...entries[0].details, finalDiagnosis: 'x' })).toEqual(entries[0].details);
  });

  it('another hospital gets "not found"; a document marked as entered in error is not printed', async () => {
    const p = await register();
    const a = (await admit('rmo', p)).body.admission;
    const card = (await newDoc('rmo', p, a, 'discharge')).body.document;
    const otherHospital = await createTenant('Other Inpatient Hospital');
    people.outsider = await createUser({ name: 'Sample outsider' });
    await addMember(people.outsider, otherHospital, 'doctor');
    expect((await printed('outsider', p, a, card, { language: 'mr' })).status).toBe(404);
    expect((await (await as('rmo')).post(`${base(p)}/${a.id}/documents/${card.id}/cancel`).send({ reason: 'Sample: started on the wrong stay' })).status).toBe(200);
    expect((await printed('rmo', p, a, card, { language: 'hi' })).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'DOCUMENT_PRINTED' })).toBe(0);
  });
});
