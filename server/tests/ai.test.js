// Smart features 4–9 (AI). OpenAI is never called: fetch is replaced by a stand-in that records what would be
// sent and answers like the Chat Completions API. Fake data only. Time is pinned: 28 Sep 2026, 11:30 in India;
// the sample patient's scan EDD is 1 Mar 2027, so she is 18 w 0 d today.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { scrub } from '../src/ai/context.js';
import { checkSuggestions } from '../src/ai/understand.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z');
let app;
let hospital;
let people;
let sessions;
let sent; // bodies "sent" to OpenAI
let answer; // what the stand-in answers next (object → JSON content)

function fakeOpenAI(overrides = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    const content = typeof answer === 'function' ? answer(JSON.parse(init.body)) : answer;
    return new Response(
      JSON.stringify({
        model: 'gpt-test',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null, ...overrides.message } }],
        usage: { prompt_tokens: 1200, completion_tokens: 150 },
      }),
      { status: overrides.status ?? 200, headers: { 'content-type': 'application/json' } },
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
  hospital = await createTenant('AI Hospital');
  people = {};
  sessions = {};
  sent = [];
  answer = {};
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

async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({
      careType: 'antenatal',
      fullName: 'Kavya Testmother',
      phone: '9876543210',
      address: '12 Sample Lane, Pune',
      ageYears: 29,
      assignedDoctor: people.drA._id.toString(),
      pregnancy: { scanEdd: '2027-03-01' },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1, complicationsReviewed: true },
      medical: { allergies: 'None known', bloodGroup: 'O+', heightCm: 158, weightKg: 61, conditionsReviewed: true, otherConditions: 'h/o PIH in last pregnancy, on eltroxin for hypothyroid' },
      ...overrides,
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const ai = (p, path) => `/api/patients/${p.id}/ai/${path}`;

describe('the AI service', () => {
  it('is off without a key (503) and says so', async () => {
    const p = await register();
    delete process.env.OPENAI_API_KEY;
    const spy = fakeOpenAI();
    const res = await (await as('drA')).post(ai(p, 'summary'));
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/not set up/);
    expect(spy).not.toHaveBeenCalled();
    expect((await (await as('drA')).get(ai(p, 'status'))).body).toEqual({ enabled: false });
  });

  it('never sends her name, phone, address or patient number; asks not to store; audits without text', async () => {
    const p = await register();
    const v = await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
    await (await as('drA')).patch(`/api/patients/${p.id}/visits/${v.body.visit.id}`).send({
      vitals: { rev: 0, bpSystolic: 146, bpDiastolic: 94, hb: 9.1 },
      details: { rev: 0, complaints: 'Kavya says headache since 2 days, husband phone 9123456789', privateNote: 'Private words' },
    });
    fakeOpenAI();
    answer = { points: [{ text: '18 weeks, raised BP 146/94 and Hb 9.1 today.', important: true }], missing: ['No urine protein recorded'] };
    const res = await (await as('drA')).post(ai(p, 'summary'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.points[0]).toEqual({ text: '18 weeks, raised BP 146/94 and Hb 9.1 today.', important: true });

    const body = sent[0].body;
    expect(sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0].auth).toBe('Bearer sk-test-not-real');
    expect(body).toMatchObject({ model: 'gpt-5.4-mini', store: false, response_format: { type: 'json_schema' } }); // the cheaper model (owner's choice)
    const text = JSON.stringify(body.messages);
    for (const secret of ['Kavya', 'Testmother', '9876543210', '9123456789', 'Sample Lane', p.mrn, 'Private words']) expect(text).not.toContain(secret);
    expect(text).toContain('BP 146/94');
    expect(text).toContain('[patient] says headache');
    expect(text).toContain('PIH');

    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_USED' }).lean();
    expect(entry.details).toEqual({ feature: 'visit_summary', patientId: p.id, mrn: p.mrn, model: 'gpt-test', inputTokens: 1200, outputTokens: 150 });
    expect(safeAuditDetails('AI_USED', { ...entry.details, prompt: 'x' })).toEqual(entry.details);
  });

  it('withholds an answer that mentions the baby\'s sex', async () => {
    const p = await register();
    fakeOpenAI();
    answer = { points: [{ text: 'Scan suggests a boy.', important: false }], missing: [] };
    const res = await (await as('drA')).post(ai(p, 'summary'));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/withheld/);
  });

  it('reports the service failing without passing on its words', async () => {
    const p = await register();
    fakeOpenAI({ status: 401 });
    const res = await (await as('drA')).post(ai(p, 'summary'));
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/key .* was not accepted/);
  });

  it('is for the treating doctor and RMOs only', async () => {
    const p = await register();
    fakeOpenAI();
    answer = { points: [], missing: [] };
    expect((await (await as('nurse')).post(ai(p, 'summary'))).status).toBe(403);
    expect((await (await as('drB')).post(ai(p, 'summary'))).status).toBe(403); // another doctor's patient
    expect((await (await as('reception')).post(ai(p, 'summary'))).status).toBe(403);
    expect((await (await as('rmo')).post(ai(p, 'summary'))).status).toBe(200);
  });
});

describe('translation, letters, risk suggestions, reports', () => {
  it('translates advice with the fast model', async () => {
    const p = await register();
    fakeOpenAI();
    answer = { translation: 'दिवसातून दोन वेळा Tab. Ferrous ascorbate घ्या.' };
    const res = await (await as('drA')).post(ai(p, 'translate')).send({ text: 'Take Tab. Ferrous ascorbate twice a day.', language: 'mr' });
    expect(res.body).toEqual({ translation: 'दिवसातून दोन वेळा Tab. Ferrous ascorbate घ्या.', language: 'mr' });
    expect(sent[0].body.model).toBe('gpt-5.4-mini');
    expect((await (await as('drA')).post(ai(p, 'translate')).send({ text: 'Its a boy', language: 'mr' })).status).toBe(400);
    expect((await (await as('drA')).post(ai(p, 'translate')).send({ text: 'Rest', language: 'fr' })).status).toBe(400);
  });

  it('drafts a letter from the record', async () => {
    const p = await register();
    fakeOpenAI();
    answer = { subject: 'Referral: raised BP at 18 weeks', body: 'Dear Doctor,\n[Patient name], 29 years…' };
    const res = await (await as('drA')).post(ai(p, 'letter')).send({ type: 'referral', to: 'Dr. Sample, Medicine', reason: 'BP control' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Referral: raised BP at 18 weeks');
    expect(JSON.stringify(sent[0].body.messages)).toContain('Reason: BP control');
    expect(sent[0].body.model).toBe('gpt-5.4-mini'); // the cheaper model (owner's choice)
  });

  it('suggests only valid codes that are not recorded yet', async () => {
    const p = await register({ medical: { allergies: 'None known', bloodGroup: 'O+', conditions: ['thyroid'], otherConditions: 'h/o PIH, hypothyroid on eltroxin' } });
    fakeOpenAI();
    answer = {
      suggestions: [
        { kind: 'pastComplication', code: 'pre_eclampsia', quote: 'h/o PIH' },
        { kind: 'condition', code: 'thyroid', quote: 'hypothyroid' }, // already recorded
        { kind: 'condition', code: 'made_up', quote: 'x' }, // not a code
      ],
    };
    const res = await (await as('drA')).post(ai(p, 'risk-suggestions'));
    expect(res.body).toEqual({ suggestions: [{ kind: 'pastComplication', code: 'pre_eclampsia', quote: 'h/o PIH' }], checked: true });
  });

  it('reads a report photo; the Hb is only passed on when it is plausible', async () => {
    const p = await register();
    fakeOpenAI();
    answer = { kind: 'lab', reportDate: '2026-09-27', title: 'CBC', values: [{ name: 'Haemoglobin', value: '9.4', unit: 'g/dL', flag: 'low' }], hb: 9.4, summary: 'Low Hb.', readable: true };
    const data = Buffer.alloc(300, 1).toString('base64');
    const res = await (await as('drA')).post(ai(p, 'read-report')).send({ mediaType: 'image/jpeg', data });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ hb: 9.4, values: [{ name: 'Haemoglobin', flag: 'low' }] });
    expect(sent[0].body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } });
    expect(sent[0].body.model).toBe('gpt-5.5'); // reports stay on the stronger model (owner's choice)
    answer = { ...answer, hb: 94 };
    expect((await (await as('drA')).post(ai(p, 'read-report')).send({ mediaType: 'application/pdf', data })).body.hb).toBe(null);
    expect(sent[1].body.messages[1].content[1].type).toBe('file');
  });
});

describe('ask your records', () => {
  it('sends only the question and searches the records itself', async () => {
    await register({ fullName: 'High Mother' }); // previous caesarean → high risk
    await register({ fullName: 'Low Mother', obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true }, medical: { allergies: 'None known', bloodGroup: 'O+', heightCm: 158, weightKg: 61, conditionsReviewed: true } });
    fakeOpenAI();
    const none = { careTypes: [], weeksFrom: null, weeksTo: null, eddFrom: null, eddTo: null, riskLevels: [], redFlags: null, carePlan: [], carePlanItem: null, conditions: [], pastComplications: [], rhNegative: null, previousCaesareansAtLeast: null, ageFrom: null, ageTo: null, seenFrom: null, seenTo: null, notSeenForDays: null, mine: false };
    answer = { ...none, understood: 'High-risk patients between 16 and 20 weeks.', unsupported: '', riskLevels: ['high'], weeksFrom: 16, weeksTo: 20 };
    const res = await (await as('nurse')).post('/api/ai/ask').send({ question: 'high risk patients around 18 weeks' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results.map((r) => r.fullName)).toEqual(['High Mother']);
    expect(res.body.results[0].gestationalAge).toEqual({ weeks: 18, days: 0 });
    expect(JSON.stringify(sent[0].body.messages)).not.toContain('Mother');

    answer = { ...none, understood: 'Patients from 30 weeks.', unsupported: '', weeksFrom: 30 };
    expect((await (await as('nurse')).post('/api/ai/ask').send({ question: 'over 30 weeks' })).body.results).toEqual([]);
    expect((await (await as('reception')).post('/api/ai/ask').send({ question: 'anyone' })).status).toBe(403);

    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_QUESTION_ASKED' }).lean();
    expect(entry.details).toEqual({ feature: 'ask_records', results: expect.any(Number) });
  });

  it('leaves out a record closed after a death (its answers are follow-up lists) – and has it again after an undo', async () => {
    const closed = await register({ fullName: 'Closed Mother' });
    await register({ fullName: 'Open Mother' });
    fakeOpenAI();
    answer = { careTypes: ['antenatal'], weeksFrom: null, weeksTo: null, eddFrom: null, eddTo: null, riskLevels: [], redFlags: null, carePlan: [], carePlanItem: null, conditions: [], pastComplications: [], rhNegative: null, previousCaesareansAtLeast: null, ageFrom: null, ageTo: null, seenFrom: null, seenTo: null, notSeenForDays: null, mine: false, understood: 'Antenatal patients.', unsupported: '' };
    const names = async () => (await (await as('drA')).post('/api/ai/ask').send({ question: 'all antenatal patients' })).body.results.map((r) => r.fullName).sort();
    expect(await names()).toEqual(['Closed Mother', 'Open Mother']);
    expect((await (await as('drA')).put(`/api/patients/${closed.id}/death`).send({ on: '2026-09-27', timing: 'pregnancy', confirmed: true })).status).toBe(200);
    expect(await names()).toEqual(['Open Mother']);
    expect((await (await as('drA')).post(`/api/patients/${closed.id}/death/undo`).send({ reason: 'Recorded on the wrong record' })).status).toBe(200);
    expect(await names()).toEqual(['Closed Mother', 'Open Mother']);
  });
});

describe('AI dictation', () => {
  it('sends the recording for writing down, with the dictation words, and returns the text', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      sent.push({ url, form: init.body });
      return new Response(JSON.stringify({ text: 'LMP 18/05/2026, G2 P1 L1 A0, BP 120/80.' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const data = Buffer.alloc(400, 7).toString('base64');
    const res = await (await as('reception')).post('/api/ai/transcribe').send({ mediaType: 'audio/webm;codecs=opus', data });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ text: 'LMP 18/05/2026, G2 P1 L1 A0, BP 120/80.' });
    expect(spy).toHaveBeenCalledOnce();
    expect(sent[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = sent[0].form;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toMatch(/LMP, EDD/);
    expect(form.get('file').size).toBe(400);
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_USED' }).lean();
    expect(entry.details).toMatchObject({ feature: 'dictation', model: 'gpt-4o-transcribe' });
  });

  it('checks the format and who may use it; off without a key', async () => {
    fakeOpenAI();
    const data = Buffer.alloc(400, 7).toString('base64');
    expect((await (await as('drA')).post('/api/ai/transcribe').send({ mediaType: 'video/avi', data })).status).toBe(400);
    delete process.env.OPENAI_API_KEY;
    expect((await (await as('drA')).post('/api/ai/transcribe').send({ mediaType: 'audio/webm', data })).status).toBe(503);
  });
});

describe('Ask AI where these belong', () => {
  it('keeps only allowed fields and values; nothing about the baby\'s sex; identity never', () => {
    const today = new Date('2026-09-30T00:00:00Z');
    const parts = ['two kids both normal delivery', 'sugar in last pregnancy', 'her phone', 'last period 18 may'];
    const got = checkSuggestions(
      [
        { part: 0, field: 'obstetric.para', value: '2' },
        { part: 0, field: 'obstetric.living', value: 'two' }, // not a number
        { part: 0, field: 'obstetric.living', value: '2' },
        { part: 1, field: 'obstetric.pastComplications', value: 'gestational_diabetes' }, // not a code
        { part: 1, field: 'medical.otherConditions', value: 'GDM in previous pregnancy' },
        { part: 2, field: 'phone', value: '9876543210' }, // not an allowed field
        { part: 3, field: 'pregnancy.lmp', value: '2026-05-18' },
        { part: 3, field: 'pregnancy.lmp', value: '2027-05-18' }, // in the future
        { part: 9, field: 'notes', value: 'x' }, // no such part
        { part: 1, field: 'notes', value: 'It is a boy' }, // PCPNDT
        { part: 0, field: 'obstetric.para', value: '2' }, // repeated
      ],
      { form: 'patient', parts, today, careType: 'antenatal' },
    );
    expect(got).toEqual([
      { part: 0, field: 'obstetric.para', value: '2', label: 'Para: 2' },
      { part: 0, field: 'obstetric.living', value: '2', label: 'Living children: 2' },
      { part: 1, field: 'medical.otherConditions', value: 'GDM in previous pregnancy', label: 'Other condition: GDM in previous pregnancy' },
      { part: 3, field: 'pregnancy.lmp', value: '2026-05-18', label: 'LMP: 18 May 2026' },
    ]);
    const visit = checkSuggestions([{ part: 0, field: 'vitals.bpSystolic', value: '130' }, { part: 0, field: 'details.privateNote', value: 'x' }, { part: 0, field: 'details.presentation', value: 'Breech' }], { form: 'visit', parts: ['x'], today, careType: 'antenatal' });
    expect(visit.map((v) => `${v.field}=${v.value}`)).toEqual(['vitals.bpSystolic=130', 'details.presentation=breech']);
  });

  it('sends only the parts (never one about the baby\'s sex) and returns checked suggestions', async () => {
    fakeOpenAI();
    answer = { suggestions: [{ part: 0, field: 'obstetric.living', value: '2' }, { part: 1, field: 'notes', value: 'x' }] };
    const res = await (await as('nurse')).post('/api/ai/understand').send({ form: 'patient', careType: 'antenatal', parts: ['two kids', 'scan says girl'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.suggestions).toEqual([{ part: 0, field: 'obstetric.living', value: '2', label: 'Living children: 2' }]);
    const text = JSON.stringify(sent[0].body.messages);
    expect(text).toContain('0: two kids');
    expect(text).not.toContain('girl');
    expect(sent[0].body.response_format.json_schema.schema.properties.suggestions.items.properties.field.enum).not.toContain('phone');
    expect((await (await as('drA')).post('/api/ai/understand').send({ form: 'patient', careType: 'antenatal', parts: [] })).status).toBe(400);
  });
});

describe('Dictated medicines (Prescription tab)', () => {
  it('turns the words into rows from the fixed lists; doctors and RMOs only', async () => {
    fakeOpenAI();
    answer = {
      medicines: [
        { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', frequencyText: 'ignored', timing: 'after_food', route: '', durationValue: 30, durationUnit: 'days', instructions: '' },
        { drug: 'Iron syrup', form: 'potion', strength: '', dose: '10 ml', frequency: 'hourly', frequencyText: 'every hour', timing: 'soon', route: 'oral', durationValue: 900, durationUnit: 'days', instructions: '' },
        { drug: '', form: 'tab', strength: '', dose: '', frequency: 'sos', frequencyText: '', timing: '', route: '', durationValue: null, durationUnit: '', instructions: '' },
        { drug: 'Vitamin D', form: 'cap', strength: '', dose: '', frequency: 'weekly', frequencyText: '', timing: '', route: '', durationValue: null, durationUnit: '', instructions: 'it is a boy' },
      ],
      notes: 'Drink plenty of water',
    };
    const res = await (await as('rmo')).post('/api/ai/medicines').send({ text: 'folic acid 5 mg once a day for 30 days, iron syrup 10 ml every hour' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.medicines).toEqual([
      { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', frequencyText: '', timing: 'after_food', route: '', durationValue: 30, durationUnit: 'days', instructions: '' },
      { drug: 'Iron syrup', form: 'tab', strength: '', dose: '10 ml', frequency: 'custom', frequencyText: 'every hour', timing: '', route: 'oral', durationValue: null, durationUnit: 'days', instructions: '' },
    ]);
    expect(res.body.notes).toBe('Drink plenty of water');
    expect(JSON.stringify(sent[0].body.messages)).toContain('folic acid 5 mg');
    expect((await (await as('nurse')).post('/api/ai/medicines').send({ text: 'folic acid' })).status).toBe(403);
    expect((await (await as('drA')).post('/api/ai/medicines').send({ text: '' })).status).toBe(400);
  });
});

describe('the AI check before printing', () => {
  const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };
  async function visitWithRx(p, items = [FOLIC]) {
    const v = (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
    const rx = await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 0, items, notes: '' });
    expect(rx.status, JSON.stringify(rx.body)).toBe(200);
    return v;
  }
  const check = async (who, p, v) => (await as(who)).post(`/api/patients/${p.id}/visits/${v.id}/ai-check`);

  it('checks the saved prescription with the fast model, and not again until it changes', async () => {
    const p = await register();
    const v = await visitWithRx(p);
    fakeOpenAI();
    answer = { issues: [{ severity: 'check', about: 'Folic acid', problem: '5 mg daily is a high dose.', suggestion: 'Usual dose is 0.4–5 mg; confirm.' }] };
    const first = await check('drA', p, v);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.issues).toHaveLength(1);
    expect(sent[0].body.model).toBe('gpt-5.4-mini');
    const text = JSON.stringify(sent[0].body.messages);
    expect(text).toContain('Folic acid 5 mg – dose 1, 1-0-0');
    expect(text).not.toContain('Kavya');

    // Printed as it is: recorded; the same version is not checked again
    expect((await (await as('drA')).post(`/api/patients/${p.id}/visits/${v.id}/ai-check/print-anyway`).send({ key: 'old' })).status).toBe(409);
    expect((await (await as('drA')).post(`/api/patients/${p.id}/visits/${v.id}/ai-check/print-anyway`).send({ key: first.body.key })).status).toBe(200);
    expect((await check('drA', p, v)).body).toMatchObject({ skipped: 'checked', issues: [] });
    expect(sent).toHaveLength(1);
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'AI_CHECK_PRINTED_ANYWAY' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, visitId: v.id, issues: 1 });

    // Changed: checked again; nothing found is remembered too
    await (await as('drA')).put(`/api/patients/${p.id}/visits/${v.id}/prescription`).send({ rev: 1, items: [{ ...FOLIC, strength: '0.4 mg' }], notes: '' });
    answer = { issues: [] };
    expect((await check('drA', p, v)).body.issues).toEqual([]);
    expect(sent).toHaveLength(2);
    expect((await check('drA', p, v)).body.skipped).toBe('checked');
  });

  it('only the treating doctor or an RMO; nothing to check without medicines', async () => {
    const p = await register();
    const v = await visitWithRx(p);
    fakeOpenAI();
    answer = { issues: [] };
    expect((await check('nurse', p, v)).status).toBe(403);
    const empty = (await (await as('drA')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).body.visit;
    expect((await check('drA', p, empty)).body).toEqual({ skipped: 'empty', issues: [] });
  });
});

describe('scrub', () => {
  it('removes the name and phone-like numbers', () => {
    expect(scrub('Kavya Testmother called from 98765 43210 about Kavya', { fullName: 'Kavya Testmother' })).toBe('[patient] [patient] called from [number] about [patient]');
    expect(scrub('Hb 9.4 on 27/09/2026', { fullName: 'Ana B' })).toBe('Hb 9.4 on 27/09/2026');
  });
});
