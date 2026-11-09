// Ask AI about one patient (docs/ASK_AI_PLAN.md – the owner's decisions of 15 Oct 2026): who may ask, what is sent
// to the AI (her record with lab values, signed scan reports, confirmed discharge cards and referrals – never her
// name, phone, address, patient number, a private note, anything about the baby's sex, or HIV), the cheaper model and
// "Think harder", the conversation so far (at most 8 earlier questions), and that nothing is saved but the audit
// entry (feature, model, token counts – never the words). OpenAI is never called: fetch is replaced by a stand-in
// that records what would be sent and answers like the Chat Completions API. Fake data only. Time is pinned:
// 15 Oct 2026, 11:30 in India; her scan EDD is 1 Mar 2027, so she is 20 w 3 d today.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { mentionsHiv } from '../src/ai/brief.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Referral } from '../src/models/Referral.js';
import { ImagingOrder } from '../src/models/ImagingOrder.js';
import { ensureRedFlagRules } from '../src/redflags/redFlagService.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { PCPNDT_MESSAGE } from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-15T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', sonologist: 'sonographer', desk: 'referral_desk' };
const QUESTION = 'How is her anaemia being treated?';
// What the stand-in answers unless a test says otherwise (nothing here about the baby's sex)
const ANSWER = {
  fromRecord: [{ text: 'Hb 8.9 g/dL on 11 Oct 2026, low, after IV iron in hospital.', source: 'lab 2026-10-11' }],
  general: [{ text: 'Recheck the Hb 2 to 4 weeks after IV iron.' }],
  notInRecord: ['No serum ferritin recorded'],
  caution: '',
};
// Care-plan lines name the tests that are due (the HIV test is offered to every pregnant woman) – never a result
const DUE_LINE = /^(?:Care plan overdue|Care plan due now|Next planned visit): /;

let app;
let hospital;
let other;
let people;
let sessions;
let sent; // bodies "sent" to OpenAI
let answer; // what the stand-in answers next (object, or a function of the request body)

function fakeOpenAI() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body, auth: init.headers.authorization });
    const content = typeof answer === 'function' ? answer(body) : answer;
    return new Response(
      JSON.stringify({
        model: 'gpt-test',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } }],
        usage: { prompt_tokens: 1200, completion_tokens: 150 },
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
  app = createApp({ apiRateLimitMax: 100000 }); // the clock is frozen, so the minute never ends
  hospital = await createTenant('Ask Hospital');
  other = await createTenant('Other Ask Hospital');
  people = {};
  sessions = {};
  sent = [];
  answer = ANSWER;
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const ask = async (who, p, body = {}) => (await as(who)).post(`/api/patients/${p.id}/ai/ask`).send({ question: QUESTION, ...body });
// What was sent as the record and the question (the "user" message; the instructions are the "developer" message)
const sentText = (i = 0) => sent[i].body.messages.find((m) => m.role === 'user').content;
const stamp = (who, at) => ({ by: people[who]._id, byName: `Sample ${who}`, at: new Date(at) });

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
      medical: { allergies: 'None known', bloodGroup: 'O+', heightCm: 158, weightKg: 61, conditionsReviewed: true },
      ...overrides,
    }),
  );
  return ok(res, 201).patient;
}

/**
 * Her record with something of everything Ask AI reads: a visit today (her name and her husband's phone typed in
 * the complaints, and a private note), lab results (a CBC with a low Hb, and HIV results – Reactive – in the same
 * order and in an order of its own), a signed anomaly scan report (and a draft one), a stay with a confirmed
 * discharge card, and a referral with a signed consultant note (and one with a draft note). HIV is also among her
 * known conditions and typed in her other conditions.
 */
async function fullRecord() {
  const p = await register({
    medical: { allergies: 'None known', bloodGroup: 'O+', heightCm: 158, weightKg: 61, conditions: ['hiv', 'thyroid'], conditionsReviewed: true, otherConditions: 'On ART for HIV since 2020' },
  });
  const dr = await as('drA');

  // A visit today
  const v = ok(await dr.post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 201).visit;
  ok(
    await dr.patch(`/api/patients/${p.id}/visits/${v.id}`).send({
      vitals: { rev: 0, bpSystolic: 118, bpDiastolic: 76, hb: 9.2 },
      details: { rev: 0, complaints: 'Kavya feels tired for a week, husband phone 9123456789', diagnosis: 'Anaemia in pregnancy', privateNote: 'PRIVATE-NOTE-WORDS family worries' },
    }),
  );

  // Lab results: a CBC and an HIV test in one order, and an HIV test alone in another
  await LabOrder.create({
    tenantId: hospital._id,
    patientId: p.id,
    clientRequestId: randomUUID(),
    status: 'reported',
    abnormal: true,
    tests: [
      {
        key: 'cbc',
        name: 'Complete blood count (CBC)',
        values: [
          { key: 'hb', value: '8.9', flag: 'low' },
          { key: 'tlc', value: '8000', flag: 'normal' },
          { key: 'platelets', value: '2.1', flag: 'normal' },
        ],
        text: 'TYPED-RESULT-WORDS',
      },
      { key: 'hiv', name: 'HIV 1 and 2', values: [{ key: 'hiv', value: 'Reactive', flag: 'abnormal' }] },
    ],
    ordered: stamp('drA', '2026-10-11T04:00:00Z'),
    collected: stamp('lab', '2026-10-11T05:00:00Z'),
    reported: stamp('lab', '2026-10-12T09:00:00Z'),
  });
  await LabOrder.create({
    tenantId: hospital._id,
    patientId: p.id,
    clientRequestId: randomUUID(),
    status: 'reviewed',
    abnormal: true,
    tests: [{ key: 'hiv', name: 'HIV 1 and 2', values: [{ key: 'hiv', value: 'Reactive', flag: 'abnormal' }] }],
    ordered: stamp('drA', '2026-09-01T04:00:00Z'),
    collected: stamp('lab', '2026-09-01T05:00:00Z'),
    reported: stamp('lab', '2026-09-02T09:00:00Z'),
    reviewed: { ...stamp('drA', '2026-09-03T05:00:00Z'), comment: 'REVIEW-COMMENT-WORDS' },
  });

  // A scan (perinexa1's Imaging module): a signed anomaly scan, and one done but not signed yet (never sent)
  const scan = (status, impression) =>
    ImagingOrder.create({
      tenantId: hospital._id,
      patientId: p.id,
      study: 'usg_anomaly',
      status,
      ordered: stamp('drA', '2026-10-10T04:00:00Z'),
      done: stamp('sonologist', '2026-10-10T05:00:00Z'),
      report: { values: { bpd: 45, efw: 310 }, findings: 'Single live intrauterine fetus. Placenta posterior, clear of the os. Liquor adequate.', impression },
      signed: status === 'signed' ? stamp('drA', '2026-10-10T06:00:00Z') : null,
      clientRequestId: randomUUID(),
    });
  await scan('signed', 'Single live intrauterine pregnancy of 19 weeks 5 days; no structural anomaly seen.');
  await scan('done', 'DRAFT-SCAN-WORDS');

  // A stay: admitted for IV iron, the discharge card confirmed by her doctor (which discharges her)
  const stays = `/api/patients/${p.id}/admissions`;
  const a = ok(await dr.post(stays).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', admittedAt: '2026-10-05T02:00:00.000Z', ward: 'Ward 2', bed: '4', reason: 'IV iron for anaemia' }), 201).admission;
  const card = ok(await dr.post(`${stays}/${a.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'discharge' }), 201).document;
  const saved = ok(
    await dr.put(`${stays}/${a.id}/documents/${card.id}`).send({
      rev: card.rev,
      content: {
        ...card.content,
        dischargedAt: '2026-10-07T05:00:00.000Z',
        finalDiagnosis: 'Iron deficiency anaemia in pregnancy, treated with IV iron sucrose',
        conditionAtDischarge: 'Stable',
        advice: 'Continue oral iron after meals',
        medicines: [{ drug: 'Ferrous ascorbate', form: 'tab', strength: '100 mg', frequency: '1-0-0', durationValue: 30, durationUnit: 'days' }],
      },
    }),
  ).document;
  const signed = ok(await dr.post(`${stays}/${a.id}/documents/${card.id}/sign`).send({ rev: saved.rev }));
  expect(signed.admission.status).toBe('discharged');

  // Referrals: one with the consultant note signed, one with the note still a draft (the note is never sent)
  const referral = (n, overrides) =>
    Referral.create({
      tenantId: hospital._id,
      number: `REF-00000${n}`,
      centre: 'main',
      receivedAt: new Date('2026-10-02T05:00:00Z'),
      via: 'whatsapp',
      urgency: 'routine',
      referringDoctorId: new mongoose.Types.ObjectId(),
      patientId: p.id,
      clientRequestId: randomUUID(),
      created: stamp('desk', '2026-10-02T05:00:00Z'),
      ...overrides,
    });
  await referral(1, {
    reasons: ['severe_anaemia'],
    question: 'Kavya has Hb 6.8 at 18 weeks and is breathless on stairs – oral or IV iron?',
    note: {
      status: 'signed',
      diagnosis: 'Iron deficiency anaemia in pregnancy',
      plan: 'IV iron sucrose in hospital, repeat CBC in 4 weeks',
      returnsToYouFor: 'Routine antenatal care',
      signed: stamp('drA', '2026-10-07T06:00:00Z'),
    },
  });
  await referral(2, { receivedAt: new Date('2026-10-03T05:00:00Z'), otherReason: 'Thyroid dose', question: 'Second opinion on her thyroid dose', note: { status: 'draft', diagnosis: 'DRAFT-NOTE-WORDS' } });
  return p;
}

describe('who may ask', () => {
  it('her doctor and RMOs; never another doctor (read-only), a nurse, reception, the lab, the sonologist or the referral desk', async () => {
    const p = await register();
    fakeOpenAI();
    for (const who of ['drA', 'rmo']) expect((await ask(who, p)).status, who).toBe(200);

    const refused = {};
    for (const who of ['drB', 'nurse', 'reception', 'lab', 'sonologist', 'desk']) {
      const res = await ask(who, p);
      expect(res.status, who).toBe(403);
      expect(res.body.answer, who).toBeUndefined();
      refused[who] = res.body.error.message;
    }
    const roleRule = 'AI help is for doctors and RMOs.';
    expect(refused).toEqual({
      drB: "Only the patient's doctor or an RMO can use AI help on this record.",
      nurse: roleRule,
      reception: roleRule,
      lab: roleRule,
      sonologist: roleRule,
      desk: roleRule,
    });
    expect(sent).toHaveLength(2); // only the two allowed questions went out

    // The other doctor still reads her record; the page is told who may change it (the tab shows only then)
    const can = {};
    for (const who of ['drA', 'rmo', 'drB']) can[who] = ok(await (await as(who)).get(`/api/patients/${p.id}`)).patient.access.canEditClinical;
    expect(can).toEqual({ drA: true, rmo: true, drB: false });

    // Another hospital's patient is not found
    expect((await ask('outsider', p)).status).toBe(404);
    expect(sent).toHaveLength(2);
  });

  it('a patient with no doctor yet: any doctor (still not a nurse)', async () => {
    const p = await register({ fullName: 'Meera Unassigned', assignedDoctor: null });
    fakeOpenAI();
    expect((await ask('drB', p)).status).toBe(200);
    expect((await ask('nurse', p)).status).toBe(403);
    expect(sent).toHaveLength(1);
  });
});

describe('what is sent to the AI', () => {
  it('her lab values, signed scan report, discharge card and referral – never her name, phone, patient number, a private note or HIV', async () => {
    const p = await fullRecord();
    fakeOpenAI();
    const res = await ask('drA', p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ answer: ANSWER, model: 'cheaper', generatedAt: NOW.toISOString() });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0].auth).toBe('Bearer sk-test-not-real');
    expect(sent[0].body).toMatchObject({ store: false, response_format: { type: 'json_schema', json_schema: { name: 'ask_patient', strict: true } } });

    const text = sentText();
    // Never: who she is, what was typed privately, drafts, typed lab result text, or HIV
    const everything = JSON.stringify(sent[0].body);
    for (const secret of ['Kavya', 'Testmother', '9876543210', '9123456789', 'Sample Lane', p.mrn, 'PRIVATE-NOTE-WORDS', 'TYPED-RESULT-WORDS', 'REVIEW-COMMENT-WORDS', 'DRAFT-SCAN-WORDS', 'DRAFT-NOTE-WORDS', 'Reactive', 'HIV 1 and 2']) {
      expect(everything, secret).not.toContain(secret);
    }
    const hivLeaks = text.split('\n').filter((l) => (mentionsHiv(l) || /\bART\b|reactive/i.test(l)) && !DUE_LINE.test(l));
    expect(hivLeaks).toEqual([]);
    expect(text).toMatch(/^Known conditions: thyroid$/m); // HIV taken out of her conditions

    // Her record and the visit (typed text scrubbed of her name and of phone numbers)
    expect(text).toMatch(/^## Record/);
    expect(text).toContain('BP 118/76');
    expect(text).toContain('Complaints: [patient] feels tired for a week, husband phone [number]');
    expect(text).toContain('Diagnosis: Anaemia in pregnancy');

    // Lab values with their Low/High marks: the CBC only – the HIV result in the same order is left out, and the
    // order with only an HIV test sends no line at all
    expect(text).toContain('## Lab results (newest first)');
    const labLines = text.split('\n').filter((l) => l.startsWith('Lab '));
    expect(labLines).toEqual(['Lab 2026-10-11 (reported, not yet reviewed): Complete blood count (CBC): Haemoglobin 8.9 g/dL (low), Total WBC count 8000 /µL, Platelets 2.1 lakh/µL']);

    // The signed scan report (measurements, impression, findings); never one not signed yet
    expect(text).toContain('## Signed scan reports (newest first)');
    expect(text).toContain('Scan 2026-10-10 – USG – anomaly scan (18–22 weeks)');
    expect(text).toContain('  Measurements: BPD 45 mm; Estimated fetal weight 310 g');
    expect(text).toContain('  Impression: Single live intrauterine pregnancy of 19 weeks 5 days; no structural anomaly seen.');
    expect(text).toContain('  Findings: Single live intrauterine fetus. Placenta posterior, clear of the os. Liquor adequate.');

    // The stay and its confirmed discharge card
    expect(text).toContain('## Hospital stays (newest first)');
    expect(text).toContain('Hospital stay from 2026-10-05 to 2026-10-07\n  Admitted for: IV iron for anaemia'); // typed reason on its own line
    expect(text).toContain('  Discharge diagnosis: Iron deficiency anaemia in pregnancy, treated with IV iron sucrose');
    expect(text).toContain('  Condition at discharge: Stable');
    expect(text).toContain('  Medicines at discharge: Ferrous ascorbate 100 mg');
    expect(text).toContain('  Advice at discharge: Continue oral iron after meals');

    // The referrals: the reason, the referring doctor's question (scrubbed) and the signed consultant note only
    expect(text).toContain('## Referrals from other doctors (newest first)');
    expect(text).toContain('Referral from another doctor, 2026-10-02 – Hb under 7 g/dL, or breathless at rest');
    expect(text).toContain('  Their question: [patient] has Hb 6.8 at 18 weeks and is breathless on stairs – oral or IV iron?');
    expect(text).toContain('  Our consultant note – diagnosis: Iron deficiency anaemia in pregnancy');
    expect(text).toContain('  Our consultant note – plan: IV iron sucrose in hospital, repeat CBC in 4 weeks');
    expect(text).toContain('  Returns to the referring doctor for: Routine antenatal care');
    expect(text).toContain('Referral from another doctor, 2026-10-03\n  Other reason: Thyroid dose\n  Their question: Second opinion on her thyroid dose');

    // No earlier conversation: the question comes last
    expect(text).not.toContain('## The conversation so far');
    expect(text.endsWith(`## The doctor's question now\n${QUESTION}`)).toBe(true);
  });

  it('her name typed in the question is taken out', async () => {
    const p = await register();
    fakeOpenAI();
    ok(await ask('drA', p, { question: 'Did Kavya Testmother miss her iron tablets? Her number is 9876543210.' }));
    const text = sentText();
    expect(text).not.toMatch(/Kavya|Testmother|9876543210/);
    expect(text).toContain("## The doctor's question now\nDid [patient] [patient] miss her iron tablets? Her number is [number].");
  });
});

describe('the two models', () => {
  it('the cheaper model by default; "Think harder" sends the question to the stronger one; the audit log has no words', async () => {
    const p = await register();
    fakeOpenAI();
    const quick = ok(await ask('drA', p));
    expect(quick.model).toBe('cheaper');
    const deep = ok(await ask('drA', p, { deep: true }));
    expect(deep.model).toBe('stronger');
    expect(deep.answer).toEqual(ANSWER);
    expect(sent.map((s) => [s.body.model, s.body.max_completion_tokens, s.body.response_format.json_schema.name])).toEqual([
      ['gpt-5.4-mini', 5000, 'ask_patient'], // the cheaper model (owner's choice, 15 Oct 2026)
      ['gpt-5.5', 8000, 'ask_patient_deep'],
    ]);
    expect((await ask('drA', p, { deep: 'yes' })).status).toBe(400);
    expect(sent).toHaveLength(2);

    const entries = await AuditLog.find({ tenantId: hospital._id, action: 'AI_USED' }).sort({ _id: 1 }).lean();
    expect(entries.map((e) => e.details)).toEqual([
      { feature: 'ask_patient', patientId: p.id, mrn: p.mrn, model: 'gpt-test', inputTokens: 1200, outputTokens: 150 },
      { feature: 'ask_patient_deep', patientId: p.id, mrn: p.mrn, model: 'gpt-test', inputTokens: 1200, outputTokens: 150 },
    ]);
    expect(safeAuditDetails('AI_USED', { ...entries[0].details, question: QUESTION })).toEqual(entries[0].details);
    // Neither the question nor the answer is anywhere in the audit log
    const log = JSON.stringify(await AuditLog.find({ tenantId: hospital._id }).lean());
    expect(log).not.toContain('anaemia being treated');
    expect(log).not.toContain('serum ferritin');
  });
});

describe('the conversation so far', () => {
  it('earlier questions and answers go in their own section, before the question now, scrubbed; at most 8', async () => {
    const p = await register();
    fakeOpenAI();
    const history = Array.from({ length: 8 }, (_, i) => ({ question: `Earlier question ${i + 1} about Kavya`, answer: `From her record:\n- Earlier answer ${i + 1}` }));
    ok(await ask('drA', p, { question: 'And what should I check next?', history }));
    const text = sentText();
    const record = text.indexOf('## Record');
    const conversation = text.indexOf('## The conversation so far');
    const now = text.indexOf("## The doctor's question now");
    expect(record).toBe(0);
    expect(conversation).toBeGreaterThan(record);
    expect(now).toBeGreaterThan(conversation);
    const part = text.slice(conversation, now);
    for (let i = 1; i <= 8; i += 1) expect(part).toContain(`Q${i}: Earlier question ${i} about [patient]\nA${i}: From her record:\n- Earlier answer ${i}`);
    expect(part).not.toContain('Q9:');
    expect(text.slice(now)).toBe("## The doctor's question now\nAnd what should I check next?");
    expect(text).not.toContain('Kavya');

    // A ninth earlier question: start a new conversation (nothing is sent)
    const tooMany = await ask('drA', p, { question: 'One more?', history: [...history, { question: 'Ninth', answer: 'Ninth answer' }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.fields.history).toMatch(/At most 8 earlier questions/);
    // Only what the website sends: a question, its earlier turns and deep
    expect((await ask('drA', p, { question: 'Hi' })).body.error.fields.question).toBe('Write your question');
    expect((await ask('drA', p, { history: [{ question: 'A?', answer: 'B', model: 'cheaper' }] })).status).toBe(400);
    expect((await ask('drA', p, { patientName: 'Kavya Testmother' })).status).toBe(400);
    expect(sent).toHaveLength(1);
  });
});

describe("the baby's sex (PC-PNDT)", () => {
  it('a question or an earlier turn about it is refused before anything is sent; an answer that mentions it is withheld', async () => {
    const p = await register();
    fakeOpenAI();
    for (const body of [
      { question: 'Is it a boy?' },
      { question: 'Anything else to check?', history: [{ question: 'What did the scan show?', answer: 'The scan suggests a girl.' }] },
      { question: 'Anything else to check?', history: [{ question: 'What is the gender of the baby?', answer: 'Not in her record.' }] },
    ]) {
      const res = await ask('drA', p, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION', fields: { question: PCPNDT_MESSAGE } });
    }
    expect(sent).toHaveLength(0);

    for (const bad of [
      { ...ANSWER, fromRecord: [{ text: 'The anomaly scan suggests a boy.', source: 'ultrasound 2026-10-10' }] },
      { ...ANSWER, fromRecord: [{ text: 'Normal anomaly scan.', source: 'ultrasound 2026-10-10, male fetus' }] },
      { ...ANSWER, general: [{ text: 'Girls are lighter at birth.' }] },
      { ...ANSWER, notInRecord: ['The sex of the baby'] },
      { ...ANSWER, caution: 'Do not tell her it is a daughter.' },
    ]) {
      answer = bad;
      const res = await ask('drA', p);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.error.code).toBe('AI_DECLINED');
      expect(res.body.error.message).toMatch(/withheld/);
      expect(res.body.answer).toBeUndefined();
    }
  });

  it("a newborn's own record is not a pregnancy: the baby's sex may be asked about", async () => {
    const mother = await register();
    const baby = ok(
      await (await as('drA')).post('/api/patients').send({
        careType: 'newborn',
        fullName: 'Baby of Kavya Testmother',
        newborn: { birthAt: '2026-10-10T08:00:00.000Z', birthWeightGrams: 3050, sex: 'female', mother: mother.id },
        registerAnyway: true,
      }),
      201,
    ).patient;
    fakeOpenAI();
    answer = { ...ANSWER, fromRecord: [{ text: 'A girl, birth weight 3050 g.', source: 'birth details' }] };
    const res = await ask('drA', baby, { question: 'Is the baby girl feeding well?' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.answer.fromRecord[0].text).toBe('A girl, birth weight 3050 g.');
  });
});

describe('nothing is saved', () => {
  it('asking, following up, thinking harder, a refused and a withheld question add nothing anywhere but the audit log', async () => {
    const p = await fullRecord();
    // What is made on first use, before counting: the red-flag rules and her care plan (read and kept in step on any visit to her page)
    await ensureRedFlagRules(hospital._id);
    ok(await (await as('drA')).get(`/api/patients/${p.id}/care-plan`));
    await as('rmo'); // logged in before counting

    const counts = async () => {
      const out = {};
      for (const c of await mongoose.connection.db.collections()) if (c.collectionName !== 'auditlogs') out[c.collectionName] = await c.countDocuments({});
      return out;
    };
    const auditBefore = new Set((await AuditLog.find({ tenantId: hospital._id }, { _id: 1 }).lean()).map((e) => String(e._id)));
    const before = await counts();
    fakeOpenAI();

    ok(await ask('drA', p));
    ok(await ask('drA', p, { question: 'And when should the Hb be checked again?', history: [{ question: QUESTION, answer: 'From her record:\n- IV iron sucrose in hospital (discharge card)' }] }));
    ok(await ask('rmo', p, { deep: true }));
    expect((await ask('drA', p, { question: 'Is it a boy?' })).status).toBe(400);
    answer = { ...ANSWER, caution: 'It is a girl.' };
    expect((await ask('drA', p)).status).toBe(422);
    expect(sent).toHaveLength(4);

    expect(await counts()).toEqual(before);
    // Each question that reached the AI is one audit entry (feature, model, token counts) – the refused one is not
    const added = (await AuditLog.find({ tenantId: hospital._id }).lean()).filter((e) => !auditBefore.has(String(e._id)));
    expect(added.map((e) => [e.action, e.details.feature]).sort()).toEqual([
      ['AI_USED', 'ask_patient'],
      ['AI_USED', 'ask_patient'],
      ['AI_USED', 'ask_patient'],
      ['AI_USED', 'ask_patient_deep'],
    ]);
    for (const e of added) expect(Object.keys(e.details).sort()).toEqual(['feature', 'inputTokens', 'model', 'mrn', 'outputTokens', 'patientId']);
  });
});

// After the independent review (15 Oct 2026): HIV never through a question or an earlier answer, HIV medicines left
// out with their whole entry, her patient number scrubbed from a question, and answers capped so follow-ups still fit.
describe('the review fixes', () => {
  it('a question about HIV is refused before anything is sent; HIV lines of an earlier answer are taken out', async () => {
    fakeOpenAI();
    const p = await register();
    const refused = await ask('drA', p, { question: 'She is RVD reactive – plan for labour?' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.question).toMatch(/HIV and AIDS Act/);
    expect(sent).toHaveLength(0);
    const history = [{ question: 'How is her Hb?', answer: 'From her record:\n- Hb 8.9 g/dL (lab 2026-10-11)\n- On antiretroviral therapy (visit 2026-09-01)' }];
    ok(await ask('drA', p, { question: 'And her BP?', history }));
    const text = sentText(0);
    expect(text).toContain('Hb 8.9 g/dL');
    expect(text).not.toMatch(/antiretroviral/i);
  });

  it('a visit line naming an HIV-only medicine is not sent; her patient number typed in a question is scrubbed', async () => {
    fakeOpenAI();
    const p = await register();
    const dr = await as('drA');
    const v = ok(await dr.post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 201).visit;
    ok(await dr.patch(`/api/patients/${p.id}/visits/${v.id}`).send({ details: { rev: 0, complaints: 'Routine check', diagnosis: 'On TLD regimen' } }));
    ok(await ask('drA', p, { question: `What about ${p.mrn}?` }));
    const text = sentText(0);
    expect(text).not.toMatch(/\bTLD\b/);
    expect(text).not.toContain(p.mrn);
    expect(text).toContain('[patient number]');
  });

  it('answers are capped in length, so the longest still fits when sent back with a follow-up', async () => {
    fakeOpenAI();
    const p = await register();
    const long = 'x'.repeat(2000);
    answer = { fromRecord: Array.from({ length: 12 }, () => ({ text: long, source: long })), general: Array.from({ length: 8 }, () => ({ text: long })), notInRecord: Array.from({ length: 8 }, () => long), caution: long };
    const a = ok(await ask('drA', p)).answer;
    expect(a.fromRecord).toHaveLength(10);
    expect(a.general).toHaveLength(6);
    expect(a.notInRecord).toHaveLength(6);
    expect(Math.max(...a.fromRecord.map((x) => x.text.length))).toBeLessThanOrEqual(350);
    expect(Math.max(...a.fromRecord.map((x) => x.source.length))).toBeLessThanOrEqual(60);
    expect(a.caution.length).toBeLessThanOrEqual(300);
    const plain = [...a.fromRecord.map((x) => `- ${x.text} (${x.source})`), ...a.general.map((x) => `- ${x.text}`), ...a.notInRecord.map((x) => `- ${x}`), a.caution].join('\n');
    expect(plain.length).toBeLessThan(10000);
  });
});
