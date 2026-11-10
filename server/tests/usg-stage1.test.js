// Sonography stage 1 (owner's go-ahead, 10 Nov 2026 – docs/USG_APPS_REVIEW.md U1, U2, U4): urgent findings of a signed
// report on her doctor's Today page until marked seen, the twins template, and the growth across her scans on the
// scan's page. Fake data only. Time is pinned: 10 Nov 2026, 11:00 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { urgentFindingsOf, twinDiscordance } from '../src/imaging/urgentFindings.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-10T05:30:00Z');
// drA: her doctor (orders, sees the signed report); sono: sonography staff; sonoDr: a doctor who scans and signs
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', sono: 'sonographer', sonoDr: ['doctor', 'sonographer'], nurse: 'nurse' };
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
  hospital = await createTenant('Scan Hospital');
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
async function mother(doctor = 'drA') {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Scan Mother', assignedDoctor: people[doctor]._id.toString(), pregnancy: { scanEdd: '2027-01-05' } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
// Ordered, done, reported with these values and signed by her doctor
async function signedScan(p, study, values) {
  let s = (await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study, indication: 'Sample indication' })).body.study;
  s = (await (await as('sono')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).body.study;
  const saved = await (await as('sono')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values, findings: 'Sample findings.', impression: 'Sample impression.' });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const signed = await (await as('sonoDr')).post(`/api/imaging/${s.id}/sign`).send({ rev: saved.body.study.rev });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return signed.body.study;
}

describe('the urgent findings rules (DRAFT for the owner)', () => {
  it('pick the findings her doctor must know now, in words fixed by the rules', () => {
    expect(urgentFindingsOf('usg_early', { site: 'Intrauterine', cardiac: 'Absent' }).map((u) => u.key)).toEqual(['no_cardiac']);
    expect(urgentFindingsOf('usg_early', { site: 'Ectopic suspected' }).map((u) => u.key)).toEqual(['ectopic']);
    expect(urgentFindingsOf('usg_growth', { placenta: 'Covering the internal os', afi: 4, fhr: 95 }).map((u) => u.text)).toEqual([
      'Fetal heart rate 95 bpm',
      'Placenta covering the internal os (placenta praevia)',
      'AFI 4 cm – very little liquor',
    ]);
    expect(urgentFindingsOf('usg_anomaly', { cervix: 22 }).map((u) => u.key)).toEqual(['short_cervix']);
    expect(urgentFindingsOf('usg_nt', { nt: 3.6, nasal: 'Absent' }).map((u) => u.key)).toEqual(['nt_high', 'nasal_absent']);
    expect(urgentFindingsOf('usg_twins', { efw1: 2300, efw2: 1650, chorionicity: 'Monochorionic monoamniotic (MCMA)' }).map((u) => u.key)).toEqual(['mcma', 'discordance']);
    expect(twinDiscordance(2300, 1650)).toBe(28);
  });
  it('find nothing in a normal report, nor in a scan that is not of a pregnancy', () => {
    expect(urgentFindingsOf('usg_growth', { placenta: 'Fundal', afi: 12, fhr: 140, dvp: 5 })).toEqual([]);
    expect(urgentFindingsOf('usg_pelvis', { fluid: 'Present' })).toEqual([]);
  });
});

describe('urgent findings reach her doctor', () => {
  it('a signed report with an urgent finding is on her doctor’s Today list until a doctor marks it seen (audited)', async () => {
    const p = await mother();
    const s = await signedScan(p, 'usg_growth', { placenta: 'Covering the internal os', afi: '12', fhr: '140' });
    expect(s.urgentFindings).toEqual([{ key: 'praevia', text: 'Placenta covering the internal os (placenta praevia)' }]);
    const list = await (await as('drA')).get('/api/imaging/urgent');
    expect(list.body.studies.map((x) => x.id)).toEqual([s.id]);
    // not another doctor's patient, and RMOs and sonography staff have no such list
    expect((await (await as('drB')).get('/api/imaging/urgent')).body.studies).toEqual([]);
    expect((await (await as('rmo')).get('/api/imaging/urgent')).body.studies).toBeNull();
    expect((await (await as('rmo')).post(`/api/imaging/${s.id}/urgent-seen`)).status).toBe(403);
    const seen = await (await as('drA')).post(`/api/imaging/${s.id}/urgent-seen`);
    expect(seen.status, JSON.stringify(seen.body)).toBe(200);
    expect(seen.body.study.urgentSeen.byName).toBe('Sample drA');
    expect((await (await as('drA')).get('/api/imaging/urgent')).body.studies).toEqual([]);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'IMAGING_URGENT_SEEN' })).toBe(1);
  });
  it('a normal report is never on the list', async () => {
    const p = await mother();
    const s = await signedScan(p, 'usg_growth', { placenta: 'Fundal', afi: '12', fhr: '140' });
    expect(s.urgentFindings).toEqual([]);
    expect((await (await as('drA')).get('/api/imaging/urgent')).body.studies).toEqual([]);
  });
});

describe('twins and the growth across scans', () => {
  it('the twins template is offered, and a large weight difference is an urgent finding', async () => {
    const studies = (await (await as('drA')).get('/api/imaging/studies')).body.studies;
    const twins = studies.find((x) => x.key === 'usg_twins');
    expect(twins.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['chorionicity', 'efw1', 'efw2', 'discordance', 'dvp1', 'dvp2']));
    const p = await mother();
    const s = await signedScan(p, 'usg_twins', { chorionicity: 'Dichorionic diamniotic (DCDA)', efw1: '2300', efw2: '1650', fhr1: '140', fhr2: '144' });
    expect(s.urgentFindings.map((u) => u.key)).toEqual(['discordance']);
  });
  it('the scan’s page has her earlier scans of this pregnancy with their measurements, oldest first', async () => {
    const p = await mother();
    const first = await signedScan(p, 'usg_anomaly', { bpd: '48', hc: '178', ac: '155', fl: '33', efw: '380' });
    vi.setSystemTime(new Date('2026-12-10T05:30:00Z'));
    sessions = {};
    const second = await signedScan(p, 'usg_growth', { bpd: '78', hc: '285', ac: '265', fl: '58', efw: '1550', placenta: 'Fundal' });
    const page = (await (await as('drA')).get(`/api/imaging/${second.id}`)).body;
    expect(page.growth.map((g) => [g.id, g.study, g.current])).toEqual([
      [first.id, 'usg_anomaly', false],
      [second.id, 'usg_growth', true],
    ]);
    expect(page.growth[1].values).toEqual({ bpd: 78, hc: 285, ac: 265, fl: 58, efw: 1550 });
    expect(JSON.stringify(page.growth)).not.toMatch(/placenta|Sample findings/); // measurements only
  });
});

describe('who works the scans (owner, 10 Nov 2026)', () => {
  it('her doctor orders and sees the report once signed; the Sonography role does the scan; a doctor with that role signs', async () => {
    const p = await mother();
    let s = (await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study: 'usg_growth' })).body.study;
    // her doctor: no Sonography module, cannot mark done or write
    expect((await (await as('drA')).get('/api/imaging/worklist?list=ordered')).status).toBe(403);
    expect((await (await as('rmo')).get('/api/imaging/dashboard')).status).toBe(403);
    expect((await (await as('drA')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).status).toBe(403);
    expect((await (await as('sono')).get('/api/imaging/worklist?list=ordered')).body.studies.map((x) => x.id)).toEqual([s.id]);
    s = (await (await as('sono')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).body.study;
    expect((await (await as('drA')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, impression: 'x' })).status).toBe(403);
    s = (await (await as('sono')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values: { fhr: '140' }, impression: 'Sample impression.' })).body.study;
    // before signing her doctor sees the scan is with sonography, not its values or words
    const before = (await (await as('drA')).get(`/api/imaging/${s.id}`)).body.study;
    expect(before.report).toBeNull();
    expect(before.access).toMatchObject({ isSonography: false, canSign: false, canReport: false });
    // sonography staff without the doctor role write but do not sign; her doctor without the role does not sign either
    expect((await (await as('sono')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).status).toBe(403);
    expect((await (await as('drA')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).status).toBe(403);
    expect((await (await as('sonoDr')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).status).toBe(200);
    const after = (await (await as('drA')).get(`/api/imaging/${s.id}`)).body.study;
    expect(after.report.impression).toBe('Sample impression.');
    expect(after.access.canPrint).toBe(true);
  });
  it('another doctor reads her scan as her record (department rule) but cannot sign or mark it seen; the to-confirm list is for doctors and RMOs', async () => {
    const p = await mother();
    const s = (await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study: 'usg_growth' })).body.study;
    const other = await (await as('drB')).get(`/api/imaging/${s.id}`);
    expect(other.status).toBe(200);
    expect(other.body.study.access).toMatchObject({ isSonography: false, canSign: false, canReport: false, canDone: false });
    expect((await (await as('drA')).get('/api/imaging/to-confirm')).body.studies).toEqual([]);
    expect((await (await as('sono')).get('/api/imaging/to-confirm')).body.studies).toBeNull();
  });
});

