// Clinical Requirements Group C (PX-X-14): the baby's record made from the mother's signed delivery note – linked to
// her, with the time of birth, weight and sex from the note; once per baby; only for a baby born alive. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T06:00:00Z'));
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Birth Hospital');
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
const live = (over) => ({ outcome: 'live', sex: 'female', weightGrams: 3000, apgar1: 8, apgar5: 9, breastfedWithinHour: 'yes', nicu: 'no', ...over });
const BASE = { gestationWeeks: 39, labourOnset: 'spontaneous', parity: 'nullipara', presentation: 'cephalic', bloodLossMl: 300, deliveredAt: '2026-11-18T05:00:00.000Z', mode: 'normal' };
async function note(content, { sign = true } = {}) {
  const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Birth Mother', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2026-11-25' } }))).body.patient;
  const base = `/api/patients/${p.id}/admissions`;
  const a = (await (await as('rmo')).post(base).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-18T01:00:00.000Z', ward: 'Labour', bed: '1', reason: 'In labour' })).body.admission;
  const d = (await (await as('rmo')).post(`${base}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'delivery' })).body.document;
  const s = (await (await as('rmo')).put(`${base}/${a.id}/documents/${d.id}`).send({ rev: d.rev, content })).body.document;
  if (sign) {
    const signed = await (await as('drA')).post(`${base}/${a.id}/documents/${d.id}/sign`).send({ rev: s.rev });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  }
  return { p, documentId: d.id };
}
const make = async (who, documentId, index) => (await as(who)).post('/api/delivery-babies').send({ documentId, index });

describe("the baby's record from the delivery note", () => {
  it('twins: each live baby gets a record linked to the mother, once; a stillbirth gets none', async () => {
    const { p, documentId } = await note({ ...BASE, babies: [live({ sex: 'male', weightGrams: 2400 }), live({ weightGrams: 2200 }), live({ outcome: 'stillbirth', stillbirthType: 'macerated', breastfedWithinHour: '', nicu: '' })] });
    let list = (await (await as('nurse')).get('/api/delivery-babies').query({ documentId })).body;
    expect(list.babies.map((b) => [b.outcome, b.record])).toEqual([
      ['live', null],
      ['live', null],
      ['stillbirth', null],
    ]);
    expect(list.access.create).toBe(false); // a nurse sees it; doctors and RMOs make the records

    const first = await make('rmo', documentId, 0);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.baby.fullName).toBe('B/O Birth Mother (Triplet 1)'); // three babies on the note (9 Nov 2026: B/O)
    expect((await make('drA', documentId, 0)).status).toBe(409);
    expect((await make('drA', documentId, 2)).body.error.message).toMatch(/born alive/);
    expect((await make('nurse', documentId, 1)).status).toBe(403);

    const baby = (await (await as('drA')).get(`/api/patients/${first.body.baby.id}`)).body.patient;
    expect(baby).toMatchObject({ careType: 'newborn', newborn: expect.objectContaining({ sex: 'male', birthWeightGrams: 2400, mother: p.id }) });
    expect(new Date(baby.newborn.birthAt).toISOString()).toBe('2026-11-18T05:00:00.000Z');

    list = (await (await as('drA')).get('/api/delivery-babies').query({ documentId })).body;
    expect(list.babies[0].record).toMatchObject({ mrn: first.body.baby.mrn });
    expect(list.linkedByHand).toEqual([]);
    const mother = (await (await as('drA')).get(`/api/patients/${p.id}`)).body.patient;
    expect(mother.babies.map((b) => b.id)).toEqual([first.body.baby.id]);
    expect(await AuditLog.countDocuments({ action: 'BABY_RECORD_FROM_DELIVERY' })).toBe(1);
  });

  it('a single baby is "Baby of …"; a note not yet signed makes no record', async () => {
    const { documentId } = await note({ ...BASE, babies: [live()] }, { sign: false });
    expect((await make('drA', documentId, 0)).body.error.message).toMatch(/Sign the delivery note/);
    const signed = await note({ ...BASE, babies: [live()] });
    const made = await (await as('drA')).post('/api/delivery-babies').send({ documentId: signed.documentId, index: 0, registerAnyway: true });
    expect(made.body.baby.fullName).toBe('B/O Birth Mother');
  });

  it('reception, who may not see her delivery, cannot open it', async () => {
    const { documentId } = await note({ ...BASE, babies: [live()] });
    expect((await (await as('reception')).get('/api/delivery-babies').query({ documentId })).status).toBe(403);
  });

  it('shows a baby that may already be registered first; twins from the same note are not a match for each other', async () => {
    const { documentId } = await note({ ...BASE, babies: [live(), live({ sex: 'male' })] });
    expect((await make('drA', documentId, 0)).status).toBe(201);
    expect((await make('drA', documentId, 1)).status).toBe(201); // the first twin is not a "possible match"

    const single = await note({ ...BASE, babies: [live()] });
    // a baby registered by hand with the same name and phone, not linked to this note
    await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'newborn', fullName: 'B/O Birth Mother', newborn: { birthAt: '2026-11-18T05:00:00.000Z' } }));
    const first = await make('drA', single.documentId, 0);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('POSSIBLE_MATCHES');
    expect(first.body.error.matches.length).toBeGreaterThan(0);
    const anyway = await (await as('drA')).post('/api/delivery-babies').send({ documentId: single.documentId, index: 0, registerAnyway: true });
    expect(anyway.status).toBe(201);
  });
});
