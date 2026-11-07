// Clinical Requirements Group C (PX-X-15): the pregnancy episode – one entry per pregnancy with what belongs to it – and
// the GREEN / AMBER / RED tiers, DRAFT, shown beside today's risk level and never used. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { TIER_CRITERIA, TIER_SOURCE, tierFor } from '../src/clinical/riskTiers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' };
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
  hospital = await createTenant('Episode Hospital');
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
const KNOWN = { conditionsKnown: true, complicationsKnown: true, gravida: 1, bloodGroup: 'O+', conditions: [], pastComplications: [], findings: {} };

describe('the GREEN / AMBER / RED tiers (DRAFT)', () => {
  it('are marked DRAFT and not in use, and never name a confidential test', () => {
    expect(TIER_SOURCE).toMatch(/^DRAFT.*not in use/);
    expect(JSON.stringify(TIER_CRITERIA)).not.toMatch(/HIV/i);
  });

  it('GREEN with nothing found, GREY with too little recorded, AMBER and RED by their criteria', () => {
    expect(tierFor(KNOWN).tier).toBe('green');
    expect(tierFor({ ...KNOWN, bloodGroup: null, conditionsKnown: false })).toMatchObject({ tier: 'grey', missing: ['Pre-existing conditions (tick any, or confirm none known)', 'Blood group'] });
    expect(tierFor({ ...KNOWN, previousCaesareans: 1 }).tier).toBe('amber');
    expect(tierFor({ ...KNOWN, lowestHb: 8.5 }).reasons.map((r) => r.key)).toEqual(['hb10']);
    expect(tierFor({ ...KNOWN, lowestHb: 6.8 }).tier).toBe('red');
    expect(tierFor({ ...KNOWN, bpSystolic: 150, bpDiastolic: 95 }).reasons.map((r) => r.key)).toEqual(['bp140']);
    expect(tierFor({ ...KNOWN, bpSystolic: 165, bpDiastolic: 100 }).reasons.map((r) => r.key)).toEqual(['bp160']);
    expect(tierFor({ ...KNOWN, findings: { placenta_praevia: {} }, previousCaesareans: 1 })).toMatchObject({ tier: 'red' });
    expect(tierFor({ ...KNOWN, conditions: ['hiv'] }).reasons[0].label).toBe('Infection needing specialist care (see her record)');
    // AMBER even when something is missing: what is found is said
    expect(tierFor({ ...KNOWN, bloodGroup: null, age: 38 }).tier).toBe('amber');
  });
});

describe('the pregnancy episode', () => {
  it('shows the current pregnancy with its stay and the DRAFT tier beside today’s risk level', async () => {
    const p = (
      await (await as('drA')).post('/api/patients').send(
        samplePatient({
          careType: 'antenatal',
          fullName: 'Episode Mother',
          assignedDoctor: people.drA._id.toString(),
          pregnancy: { lmp: '2026-05-01' },
          medical: { allergies: 'None known', bloodGroup: 'O+', conditionsReviewed: true },
          obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
        }),
      )
    ).body.patient;
    await (await as('drA')).get(`/api/patients/${p.id}`); // the care plan is built on first view
    await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-11-09T01:00:00.000Z', ward: 'Antenatal ward', bed: '2', reason: 'Observation' });

    const r = await (await as('nurse')).get('/api/pregnancy-episodes').query({ patientId: p.id });
    expect(r.status).toBe(200);
    expect(r.body.episodes).toHaveLength(1);
    const e = r.body.episodes[0];
    expect(e).toMatchObject({ number: 1, status: 'open', closed: null });
    expect(new Date(e.edd).toISOString().slice(0, 10)).toBe('2027-02-05');
    expect(e.stays).toEqual([expect.objectContaining({ ward: 'Antenatal ward', status: 'admitted' })]);
    expect(r.body.tier).toMatchObject({ tier: 'amber', reasons: [expect.objectContaining({ key: 'cs1' })] });
    expect(r.body.tier.source).toMatch(/^DRAFT/);
    expect(await AuditLog.countDocuments({ action: 'PREGNANCY_EPISODES_VIEWED' })).toBe(1);
  });

  it('reception, who may not see the pregnancy details, cannot open it', async () => {
    const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Episode Two', assignedDoctor: people.drA._id.toString(), pregnancy: { lmp: '2026-06-01' } }))).body.patient;
    expect((await (await as('reception')).get('/api/pregnancy-episodes').query({ patientId: p.id })).status).toBe(403);
  });

  it('a gynaecology record has no pregnancies', async () => {
    const p = (await (await as('drA')).post('/api/patients').send(samplePatient({ fullName: 'Gyn Sample', assignedDoctor: people.drA._id.toString() }))).body.patient;
    expect((await (await as('drA')).get('/api/pregnancy-episodes').query({ patientId: p.id })).body).toEqual({ episodes: [], tier: null });
  });
});
