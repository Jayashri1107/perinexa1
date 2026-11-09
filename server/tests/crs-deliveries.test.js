// Clinical Requirements Group A, items 1 and 2 (PX-REQ-00, 5 Nov 2026): the Robson group on the delivery note and the
// monthly ten-group table; the caesarean's category and times, the decision-to-delivery interval worked out from the
// stored times (category 1 over 30 minutes in red), measured blood loss compulsory, and when each time was typed.
// Fake data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as website from '../../client/src/pages/inpatient/robson.js';
import { createApp } from '../src/app.js';
import { CS_TARGET_MINUTES, category1Late, decisionToDeliveryMinutes } from '../src/clinical/caesarean.js';
import { ROBSON_GROUPS, robsonGroup, robsonMissing, robsonTable } from '../src/clinical/robson.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { GROUP_A_REQUIRED_FROM, groupARules, missingToSign } from '../src/inpatient/docSchemas.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { monthRange } from '../src/routes/clinicalAudit.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', admin: 'admin', reception: 'receptionist' };
let app;
let hospital;
let other;
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
  hospital = await createTenant('Robson Hospital');
  other = await createTenant('Other Robson Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: 'Sample other doctor' });
  await addMember(people.otherDr, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function registered() {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Robson Mother', ageYears: 28, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-12' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const base = (p) => `/api/patients/${p.id}/admissions`;
const admit = async (p) => (await (await as('rmo')).post(base(p)).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt: '2026-11-08T02:00:00.000Z', ward: 'Labour ward', bed: '2', reason: 'In labour' })).body.admission;
const newNote = async (p, a) => (await (await as('rmo')).post(`${base(p)}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
const save = async (p, a, d, content) => (await as('rmo')).put(`${base(p)}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content });
const sign = async (p, a, d) => (await as('drA')).post(`${base(p)}/${a.id}/documents/${d.id}/sign`).send({ rev: d.rev });
const live = { outcome: 'live', sex: 'female', weightGrams: 3000 };
const NOTE = { deliveredAt: '2026-11-08T05:30:00.000Z', mode: 'normal', gestationWeeks: 39, labourOnset: 'spontaneous', parity: 'nullipara', presentation: 'cephalic', bloodLossMl: 300, babies: [live] };
const CS = { ...NOTE, mode: 'lscs', indication: 'Fetal distress', csCategory: '1', decisionAt: '2026-11-08T05:05:00.000Z', bloodLossMl: 700 };
async function delivered(content) {
  const p = await registered();
  const a = await admit(p);
  const d = await newNote(p, a);
  const saved = await save(p, a, d, content);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const signed = await sign(p, a, saved.body.document);
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return { p, a, doc: signed.body.document };
}

describe('the Robson group (WHO 2017 – worked out, never typed)', () => {
  const c = (over) => ({ ...NOTE, ...over });
  it('puts each kind of woman in her group', () => {
    expect(robsonGroup(c({}))).toBe(1);
    expect(robsonGroup(c({ labourOnset: 'induced' }))).toBe(2);
    expect(robsonGroup(c({ labourOnset: 'not_in_labour' }))).toBe(2);
    expect(robsonGroup(c({ parity: 'multipara', previousCaesarean: 'no' }))).toBe(3);
    expect(robsonGroup(c({ parity: 'multipara', previousCaesarean: 'no', labourOnset: 'induced' }))).toBe(4);
    expect(robsonGroup(c({ parity: 'multipara', previousCaesarean: 'yes', labourOnset: '' }))).toBe(5);
    expect(robsonGroup(c({ presentation: 'breech' }))).toBe(6);
    expect(robsonGroup(c({ parity: 'multipara', previousCaesarean: 'yes', presentation: 'breech' }))).toBe(7);
    expect(robsonGroup(c({ babies: [live, live], presentation: '' }))).toBe(8);
    expect(robsonGroup(c({ presentation: 'transverse_oblique', gestationWeeks: 30 }))).toBe(9);
    expect(robsonGroup(c({ gestationWeeks: 34, labourOnset: '' }))).toBe(10);
    expect(Object.keys(ROBSON_GROUPS)).toHaveLength(10);
  });

  it('says what is missing instead of guessing', () => {
    expect(robsonGroup(c({ parity: '' }))).toBeNull();
    expect(robsonMissing(c({ parity: '' }))).toEqual(['parity']);
    expect(robsonMissing(c({ parity: 'multipara' }))).toEqual(['previousCaesarean']);
    expect(robsonMissing(c({ presentation: '', gestationWeeks: null }))).toEqual(['presentation']);
    expect(robsonMissing(c({ labourOnset: '' }))).toEqual(['labourOnset']);
  });

  it('the website works out the same group and the same interval as the server', () => {
    const cases = [{}, { labourOnset: 'induced' }, { parity: 'multipara', previousCaesarean: 'no' }, { parity: 'multipara', previousCaesarean: 'yes' }, { presentation: 'breech' }, { babies: [live, live] }, { gestationWeeks: 36 }, { gestationWeeks: '36' }, { parity: '' }, { presentation: 'transverse_oblique' }, { babies: [] }];
    for (const over of cases) {
      expect(website.robsonGroup(c(over)), JSON.stringify(over)).toBe(robsonGroup(c(over)));
      expect(website.robsonMissing(c(over)), JSON.stringify(over)).toEqual(robsonMissing(c(over)));
    }
    expect(website.ROBSON_GROUPS).toEqual(ROBSON_GROUPS);
    expect(website.CS_TARGET_MINUTES).toEqual(CS_TARGET_MINUTES);
    for (const decisionAt of ['2026-11-08T05:05:00.000Z', '2026-11-08T04:50:00.000Z', '2026-11-08T06:00:00.000Z', null]) {
      for (const csCategory of ['1', '2', '3', '']) {
        const x = { ...CS, decisionAt, csCategory };
        expect(website.decisionToDeliveryMinutes(x)).toBe(decisionToDeliveryMinutes(x));
        expect(website.category1Late(x)).toBe(category1Late(x));
      }
    }
  });

  it('the monthly table gives each group its size, caesarean rate and contributions', () => {
    const t = robsonTable([c({}), c({}), c({ mode: 'lscs' }), c({ labourOnset: 'not_in_labour', mode: 'lscs' }), c({ parity: '' })]);
    expect([t.women, t.caesareans, t.caesareanRate]).toEqual([5, 2, 40]);
    expect(t.rows[0]).toMatchObject({ group: 1, women: 3, caesareans: 1, groupSize: 60, caesareanRate: 33.3, absoluteContribution: 20, relativeContribution: 50 });
    expect(t.rows[1]).toMatchObject({ group: 2, women: 1, caesareans: 1, caesareanRate: 100 });
    expect(t.rows[2]).toMatchObject({ group: 3, women: 0, caesareanRate: null });
    expect(t.unclassified).toEqual({ women: 1, caesareans: 0 });
  });
});

describe('the caesarean: category, times and decision to delivery (NICE NG192)', () => {
  it('works the interval out from the two stored times; category 1 over 30 minutes is red', () => {
    expect(decisionToDeliveryMinutes(CS)).toBe(25);
    expect(category1Late(CS)).toBe(false);
    expect(category1Late({ ...CS, decisionAt: '2026-11-08T04:59:00.000Z' })).toBe(true); // 31 minutes
    expect(category1Late({ ...CS, csCategory: '2', decisionAt: '2026-11-08T04:00:00.000Z' })).toBe(false); // not red: category 2
    expect(decisionToDeliveryMinutes({ ...CS, decisionAt: '2026-11-08T06:00:00.000Z' })).toBeNull(); // after the delivery
  });

  it('a note started from 6 Nov 2026 needs the Robson details, the measured blood loss and the caesarean category and decision time', async () => {
    expect(GROUP_A_REQUIRED_FROM.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    expect(groupARules({ createdAt: new Date('2026-11-01') })).toBe(false);
    expect(missingToSign('delivery', { ...CS, bloodLossMl: null, csCategory: '', decisionAt: null, parity: '' }, { groupA: false })).toEqual({});
    const p = await registered();
    const a = await admit(p);
    const d = await newNote(p, a);
    const saved = await save(p, a, d, { ...CS, bloodLossMl: null, csCategory: '', decisionAt: null, parity: '' });
    expect(saved.body.document.groupARules).toBe(true);
    const refused = await sign(p, a, saved.body.document);
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields).toMatchObject({
      'content.bloodLossMl': 'Enter the measured blood loss',
      'content.parity': expect.stringMatching(/Robson/),
      'content.csCategory': 'Choose the category of the caesarean',
      'content.decisionAt': 'Enter the time of the decision to deliver',
    });
    const wrongOrder = await save(p, a, saved.body.document, { ...CS, decisionAt: '2026-11-08T06:00:00.000Z' });
    expect((await sign(p, a, wrongOrder.body.document)).body.error.fields['content.decisionAt']).toMatch(/before the delivery/);
  });

  it('an older draft keeps its old rules, and a confirmed note is never changed', async () => {
    const p = await registered();
    const a = await admit(p);
    const d = await newNote(p, a);
    await ClinicalDocument.collection.updateOne({ _id: new mongoose.Types.ObjectId(d.id) }, { $set: { createdAt: new Date('2026-11-01T00:00:00Z') } });
    const saved = await save(p, a, d, { deliveredAt: NOTE.deliveredAt, mode: 'normal', babies: [live] });
    expect(saved.body.document.groupARules).toBe(false);
    expect((await sign(p, a, saved.body.document)).status).toBe(200);
  });

  it('keeps the category and times only for a caesarean, and a previous caesarean only for a multiparous woman', async () => {
    const { doc } = await delivered({ ...NOTE, csCategory: '1', decisionAt: CS.decisionAt, previousCaesarean: 'yes' });
    expect(doc.content).toMatchObject({ csCategory: '', decisionAt: null, incisionAt: null, previousCaesarean: '' });
    expect(doc.derived).toEqual({ robsonGroup: 1, robsonMissing: [], caesarean: null });
  });

  it('stores when each time was typed, next to the time typed (no "late entry" badge)', async () => {
    const p = await registered();
    const a = await admit(p);
    let d = await newNote(p, a);
    vi.setSystemTime(new Date('2026-11-10T06:10:00Z'));
    d = (await save(p, a, d, CS)).body.document;
    expect(d.timesEnteredAt).toEqual({ deliveredAt: '2026-11-10T06:10:00.000Z', decisionAt: '2026-11-10T06:10:00.000Z' });
    vi.setSystemTime(new Date('2026-11-10T06:20:00Z'));
    d = (await save(p, a, d, { ...CS, decisionAt: '2026-11-08T05:00:00.000Z', incisionAt: '2026-11-08T05:20:00.000Z' })).body.document;
    expect(d.timesEnteredAt).toEqual({ deliveredAt: '2026-11-10T06:10:00.000Z', decisionAt: '2026-11-10T06:20:00.000Z', incisionAt: '2026-11-10T06:20:00.000Z' });
    expect(d.derived.caesarean).toMatchObject({ category: '1', minutes: 30, targetMinutes: 30, overTarget: false, red: false });
  });
});

describe('the clinical audit pages', () => {
  it('a month is a calendar month in India time', () => {
    expect(monthRange('2026-11')).toEqual({ start: new Date('2026-10-31T18:30:00.000Z'), end: new Date('2026-11-30T18:30:00.000Z') });
    expect(monthRange('2026-12').end).toEqual(new Date('2026-12-31T18:30:00.000Z'));
  });

  it('the Robson table counts the month\'s confirmed notes; the caesarean list is for doctors and RMOs', async () => {
    await delivered(NOTE);
    const late = await delivered({ ...CS, decisionAt: '2026-11-08T04:50:00.000Z' }); // 40 minutes
    const robson = await (await as('admin')).get('/api/clinical-audit/robson?month=2026-11');
    expect(robson.status).toBe(200);
    expect(robson.body).toMatchObject({ women: 2, caesareans: 1, caesareanRate: 50 });
    expect(robson.body.rows[0]).toMatchObject({ group: 1, women: 2, caesareans: 1 });
    expect(JSON.stringify(robson.body)).not.toMatch(/Robson Mother/);

    const admin = await (await as('admin')).get('/api/clinical-audit/caesareans?month=2026-11');
    expect(admin.body.list).toBeUndefined(); // numbers only
    expect(admin.body.byCategory.find((x) => x.category === '1')).toEqual({ category: '1', count: 1, overTarget: 1 });

    const doctor = await (await as('drA')).get('/api/clinical-audit/caesareans?month=2026-11');
    expect(doctor.body.list).toEqual([expect.objectContaining({ documentId: late.doc.id, fullName: 'Robson Mother', minutes: 40, red: true, robsonGroup: 1 })]);
    expect((await (await as('drA')).get('/api/clinical-audit/robson?month=2026-10')).body.women).toBe(0);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: { $in: ['ROBSON_TABLE_VIEWED', 'CAESAREAN_AUDIT_VIEWED'] } })).toBe(4);
  });

  it('nurses and reception are refused; another hospital sees none of these notes', async () => {
    await delivered(CS);
    expect((await (await as('nurse')).get('/api/clinical-audit/robson?month=2026-11')).status).toBe(403);
    expect((await (await as('reception')).get('/api/clinical-audit/caesareans?month=2026-11')).status).toBe(403);
    expect((await (await as('otherDr')).get('/api/clinical-audit/robson?month=2026-11')).body.women).toBe(0);
    expect((await (await as('drA')).get('/api/clinical-audit/robson?month=2026-13')).status).toBe(400);
  });
});
