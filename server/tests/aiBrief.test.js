// Smart features, step 10: the AI brief on Today, the calendar and a patient's page. OpenAI is never called:
// fetch is replaced by a stand-in that records what would be sent and answers like the Chat Completions API.
// Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { finishBrief, patientFacts, patientLabels, todayBriefText, withoutHiv } from '../src/ai/brief.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
let app;
let hospital;
let people;
let sessions;
let sent; // bodies "sent" to OpenAI
let answer; // what the stand-in answers next (object, or a function of the request body)

function fakeOpenAI() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    const content = typeof answer === 'function' ? answer(body) : answer;
    return new Response(
      JSON.stringify({
        model: 'gpt-test',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } }],
        usage: { prompt_tokens: 1500, completion_tokens: 120 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  app = createApp();
  hospital = await createTenant('Brief Hospital');
  people = {};
  sessions = {};
  sent = [];
  answer = { points: [] };
  for (const [key, role] of Object.entries({ drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist' })) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const brief = async (who, path, body = {}) => (await as(who)).post(`/api/ai/brief/${path}`).send(body);
const sentText = (i = 0) => sent[i].body.messages.find((m) => m.role === 'user').content;

// Registered the day before (a patient who is not new today): since 28 Oct 2026 everyone registered today is on
// Today's patients, so the patients these tests expect elsewhere are registered earlier.
// (Signed in again on each side: a day without activity ends a session, as it would for a person.)
async function theDayBefore(fn) {
  const now = Date.now();
  vi.setSystemTime(now - 24 * 60 * 60 * 1000);
  sessions = {};
  try {
    return await fn();
  } finally {
    vi.setSystemTime(now);
    sessions = {};
  }
}

async function register(fullName, { scanEdd = '2026-11-09', phone = '9876543210', medical = {}, doctor = 'drA' } = {}) {
  const send = async () => (await as(doctor)).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName,
      phone,
      address: '12 Sample Lane, Pune',
      ageYears: 29,
      assignedDoctor: people[doctor]._id.toString(),
      pregnancy: { scanEdd },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'O+', conditionsReviewed: true, ...medical },
    }),
  );
  const res = await theDayBefore(send);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}

// A visit (today unless visitOn is given) with vitals and, optionally, the next visit's day.
async function visit(p, { visitOn, vitals, nextVisitOn } = {}) {
  const created = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), ...(visitOn ? { visitOn } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const change = { ...(vitals ? { vitals: { rev: 0, ...vitals } } : {}), ...(nextVisitOn ? { details: { rev: 0, nextVisitOn } } : {}) };
  if (Object.keys(change).length) {
    const res = await (await as('drA')).patch(`/api/patients/${p.id}/visits/${created.body.visit.id}`).send(change);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return created.body.visit;
}

// A lab order with results ready for the doctor's review: Hb low, and an HIV result (never sent to the AI).
const reportedOrder = (p) =>
  LabOrder.create({
    tenantId: hospital._id,
    patientId: p.id,
    clientRequestId: randomUUID(),
    status: 'reported',
    abnormal: true,
    tests: [
      { key: 'hb', name: 'Haemoglobin (Hb)', values: [{ key: 'hb', value: '8.9', flag: 'low' }] },
      { key: 'hiv', name: 'HIV 1 and 2', values: [{ key: 'hiv', value: 'Reactive', flag: 'abnormal' }] },
    ],
    ordered: { by: people.drA._id, byName: 'Sample drA', at: new Date('2026-09-26T05:00:00Z') },
    reported: { by: people.drA._id, byName: 'Sample lab', at: new Date('2026-09-27T09:00:00Z') },
  });

describe('the AI brief', () => {
  it('is for doctors and RMOs only', async () => {
    const p = await register('Kavya Testmother');
    fakeOpenAI();
    for (const who of ['nurse', 'reception']) {
      expect((await brief(who, 'today')).status, who).toBe(403);
      expect((await brief(who, 'calendar', { view: 'week' })).status, who).toBe(403);
      expect((await brief(who, `patient/${p.id}`)).status, who).toBe(403);
    }
    expect((await brief('drB', `patient/${p.id}`)).status).toBe(403); // another doctor's patient
    expect((await brief('drA', 'today', { scope: 'everyone' })).status).toBe(400);
    expect((await brief('drA', 'calendar', { view: 'year' })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when the page has nobody on it', async () => {
    const spy = fakeOpenAI();
    const res = await brief('drA', 'today');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ empty: true, points: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'AI_USED' })).toBe(0);
  });

  it("Today: the page's lists go without names, phone numbers or patient numbers, and the answer names them again", async () => {
    const kavya = await register('Kavya Testmother'); // 34 w today
    const meera = await register('Meera Sampleperson', { phone: '9123456780' });
    await visit(kavya, { vitals: { bpSystolic: 164, bpDiastolic: 112 } }); // a red flag, seen today
    await visit(meera, { visitOn: '2026-09-20', nextVisitOn: '2026-09-28' }); // booked for today
    fakeOpenAI();
    answer = {
      points: [
        { text: '**[P1]** has an urgent BP red flag at 34 weeks – see her first.', first: true },
        { text: 'P2 is booked for today and has not arrived yet.', first: false },
        { text: '[P7] needs a call.', first: false }, // not on the page: dropped
      ],
    };
    const res = await brief('drA', 'today');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.points).toEqual([
      { text: '[P1] has an urgent BP red flag at 34 weeks – see her first.', first: true },
      { text: '[P2] is booked for today and has not arrived yet.', first: false },
    ]);
    expect(res.body.patients).toEqual({ P1: { id: kavya.id, fullName: 'Kavya Testmother', mrn: kavya.mrn }, P2: { id: meera.id, fullName: 'Meera Sampleperson', mrn: meera.mrn } });

    const text = sentText();
    for (const secret of ['Kavya', 'Testmother', 'Meera', 'Sampleperson', '9876543210', '9123456780', 'Sample Lane', kavya.mrn, meera.mrn]) expect(text).not.toContain(secret);
    expect(text).toContain('## Red flags');
    expect(text).toMatch(/\[P1\] \w+: [^\n]*164\/112/);
    expect(text).toContain('[P2] booked for today, not arrived yet');
    expect(text).toContain('[P1] pregnancy, 34w 0d today, EDD 2026-11-09');
    expect(sent[0].body).toMatchObject({ model: 'gpt-5.4-mini', store: false, response_format: { type: 'json_schema' } });

    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_USED' }).lean();
    expect(entry.details).toEqual({ feature: 'brief_today', results: 2, patientIds: [kavya.id, meera.id].sort(), model: 'gpt-test', inputTokens: 1500, outputTokens: 120 });
  });

  it("withholds an answer about the baby's sex", async () => {
    const kavya = await register('Kavya Testmother');
    await visit(kavya, { vitals: { bpSystolic: 164, bpDiastolic: 112 } });
    fakeOpenAI();
    answer = { points: [{ text: '[P1] is expecting a girl.', first: false }] };
    const res = await brief('drA', 'today');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AI_DECLINED');
  });

  it('never sends HIV – not the condition, the risk reason, the typed words or the test result', async () => {
    const asha = await register('Asha Samplecase', { medical: { conditions: ['hiv', 'thyroid'], otherConditions: 'On ART for HIV since 2020' } });
    await visit(asha, { vitals: { bpSystolic: 164, bpDiastolic: 112 } });
    await reportedOrder(asha);
    fakeOpenAI();
    answer = { points: [{ text: '[P1] has Hb 8.9 to review.', first: true }] };

    expect((await brief('drA', 'today')).status).toBe(200);
    const today = sentText(0);
    expect(today).not.toMatch(/Reactive|HIV 1 and 2|\bART\b/);
    expect(today).toContain("## Lab results waiting for the doctor's review");
    expect(today).toMatch(/\[P1\] Haemoglobin \(Hb\) – outside range: Haemoglobin[^\n]* 8\.9 g\/dL \(low\), reported 2026-09-27 14:30/);
    const facts = today.split('\n').find((l) => l.startsWith('[P1] pregnancy'));
    expect(facts).toMatch(/^\[P1\] pregnancy, 34w 0d today, EDD 2026-11-09, risk high/);
    expect(facts).not.toMatch(/hiv/i); // the risk reason is left out

    answer = { points: [{ text: 'Hb 8.9 g/dL is low and waits for review.', first: true }], missing: [] };
    const page = await brief('drA', `patient/${asha.id}`);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const record = sentText(1);
    expect(record).not.toMatch(/Reactive|HIV 1 and 2|\bART\b/);
    expect(record).not.toMatch(/^(?:Known conditions|Risk level|Other conditions).*hiv/im);
    expect(record).toContain('Known conditions: thyroid');
    expect(record).toMatch(/Haemoglobin \(Hb\) – results ready – waiting for the doctor's review; outside range: Haemoglobin[^\n]* 8\.9 g\/dL \(low\)/);
  });

  it('the calendar: the dates shown, by label, with the weeks and the risk; a month is read entry by entry', async () => {
    const rani = await register('Rani Duesoon', { scanEdd: '2026-10-01' }); // EDD this week
    const meera = await register('Meera Sampleperson', { phone: '9123456780' });
    await visit(meera, { visitOn: '2026-09-20', nextVisitOn: '2026-09-30' });
    fakeOpenAI();
    const eddLabel = (body) => /2026-10-01 \[(P\d+)\] EDD/.exec(body.messages.find((m) => m.role === 'user').content)?.[1];
    answer = (body) => ({ points: [{ text: `[${eddLabel(body)}] is due to deliver on 1 Oct.`, first: true }] });

    const res = await brief('drA', 'calendar', { view: 'week', date: '2026-09-28', types: 'booked,edd' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = sentText(0);
    for (const secret of ['Rani', 'Duesoon', 'Meera', '9123456780', rani.mrn, meera.mrn]) expect(text).not.toContain(secret);
    expect(text).toContain('The calendar shows 2026-09-28 to 2026-10-04 (today is 2026-09-28). Entries shown: booked next visits, EDDs.');
    expect(text).toMatch(/2026-09-30 \[P\d\] booked visit – booked/);
    expect(text).toContain('2026-09-30 (Wed): 1 booked visit');
    expect(text).toMatch(/\[P\d\] pregnancy, 39w 4d today, EDD 2026-10-01/);
    const label = eddLabel(sent[0].body);
    expect(res.body.patients).toEqual({ [label]: { id: rani.id, fullName: 'Rani Duesoon', mrn: rani.mrn } });
    expect((await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_USED' }).lean()).details).toMatchObject({ feature: 'brief_calendar', results: 2 });

    const month = await brief('rmo', 'calendar', { view: 'month', date: '2026-09-28' });
    expect(month.status, JSON.stringify(month.body)).toBe(200);
    expect(sentText(1)).toMatch(/2026-09-30 \[P\d+\] booked visit/);
  });

  it("a patient's page: her record with recent lab orders, for her doctor or an RMO", async () => {
    const kavya = await register('Kavya Testmother');
    await visit(kavya, { vitals: { bpSystolic: 150, bpDiastolic: 96, hb: 9.4 } });
    await reportedOrder(kavya);
    fakeOpenAI();
    answer = { points: [{ text: 'BP 150/96 today at 34 weeks.', first: true }, { text: '', first: false }], missing: ['No urine protein recorded', ' '] };
    const res = await brief('rmo', `patient/${kavya.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ points: [{ text: 'BP 150/96 today at 34 weeks.', first: true }], missing: ['No urine protein recorded'] });
    expect(sent[0].body.model).toBe('gpt-5.4-mini'); // every brief uses the cheaper model (owner's choice)
    const text = sentText();
    for (const secret of ['Kavya', 'Testmother', '9876543210', 'Sample Lane', kavya.mrn]) expect(text).not.toContain(secret);
    expect(text).toContain('BP 150/96');
    expect(text).toContain('## Lab orders of the last 90 days, newest first');
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_USED' }).lean();
    expect(entry.details).toMatchObject({ feature: 'brief_patient', patientId: kavya.id, mrn: kavya.mrn });
  });
});

describe('the brief helpers', () => {
  it('label patients in the order they come, and drop points about labels not on the page', () => {
    const labels = patientLabels();
    expect(labels.tag({ id: 'a', fullName: 'A', mrn: 'P-1' })).toBe('[P1]');
    expect(labels.tag({ id: 'b', fullName: 'B', mrn: 'P-2' })).toBe('[P2]');
    expect(labels.tag({ id: 'a', fullName: 'A', mrn: 'P-1' })).toBe('[P1]');
    const out = finishBrief({ points: [{ text: 'P1 and [P2] are due.', first: true }, { text: 'G2P1 at [P3]', first: false }, { text: 'Nothing else.', first: false }] }, labels);
    expect(out.points).toEqual([
      { text: '[P1] and [P2] are due.', first: true },
      { text: 'Nothing else.', first: false },
    ]);
    expect(out.patients).toEqual({ P1: { id: 'a', fullName: 'A', mrn: 'P-1' }, P2: { id: 'b', fullName: 'B', mrn: 'P-2' } });
  });

  it('keep her name and phone number out of a care-plan item typed for her', () => {
    const work = { carePlan: [{ patient: { id: 'a', fullName: 'Kavya Testmother', mrn: 'P-000001' }, counts: { overdue: 1 }, top: [{ name: 'Call Kavya on 9876543210', status: 'overdue', dueBy: '2026-09-20' }] }] };
    const { text } = todayBriefText({ work, day: {}, stays: {}, lab: [], facts: new Map(), now: NOW, scope: 'mine' });
    expect(text).toContain('[P1] 1 overdue – Call [patient] on [number] (overdue, by 2026-09-20)');
    expect(text).toContain('[P1] appointment details only');
    expect(text).not.toMatch(/Kavya|9876543210|P-000001/);
  });

  it('describe abortion care by the type of loss only – no weeks today, no EDD, even with old pregnancy dates stored', () => {
    const p = { careType: 'abortion', abortion: { lossType: 'missed' }, pregnancy: { lmp: new Date('2026-08-02T00:00:00Z'), effectiveEdd: new Date('2027-05-09T00:00:00Z') } };
    expect(patientFacts(p, NOW)).toBe('pregnancy loss (abortion care), missed miscarriage');
    expect(patientFacts({ careType: 'abortion', abortion: null }, NOW)).toBe('pregnancy loss (abortion care)');
  });

  it('take HIV out of a record', () => {
    const record = ['Known conditions: hiv, thyroid', 'Risk level: high – HIV; Previous caesarean', 'Risk level: high (set by doctor) – HIV', '  Diagnosis: RVD positive, on ART', 'Blood group: O+'].join('\n');
    expect(withoutHiv(record)).toBe(['Known conditions: thyroid', 'Risk level: high – Previous caesarean', 'Risk level: high (set by doctor)', 'Blood group: O+'].join('\n'));
  });
});
