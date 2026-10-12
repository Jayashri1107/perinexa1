// The two general messages (4 Oct 2026): "a check-up or test is due" when a care-plan item is overdue and nothing is
// booked, and "we missed you" after a booked appointment nobody came to. The same switches as the appointment
// reminders (the hospital's, and the agreement on the record itself – a baby's own, never the mother's); nothing
// medical in any message. A test sender here: nothing leaves the computer. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import mongoose from 'mongoose';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { Tenant } from '../src/models/Tenant.js';
import { WorkDone } from '../src/models/WorkDone.js';
import { careDueMessage, missedMessage } from '../src/reminders/messages.js';
import { queueCareDue } from '../src/reminders/generalReminders.js';
import { runReminders, sendDueReminders } from '../src/reminders/reminderService.js';
import { TEST_SENDER, setTestSender, testSent } from '../src/reminders/sender.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const D = (s) => new Date(`${s}T00:00:00Z`);
const noon = (s) => new Date(`${s}T06:00:00Z`); // 11:30 in India: after the sending hour (10)
const NOW = noon('2026-10-01');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
const CARE_DUE = 'A check-up or test is due at Sample Hospital. Please call 020 0000 0000 to book. Reply STOP to stop these messages.';
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
  hospital = await createTenant('General Reminder Hospital');
  await Tenant.updateOne({ _id: hospital._id }, { $set: { 'letterhead.name': 'Sample Hospital', 'letterhead.phone': '020 0000 0000' } });
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
  // A doctor has approved the hospital's care-plan schedules (nothing goes to a patient from a draft plan)
  for (const t of await CarePlanTemplate.find({ tenantId: hospital._id, kind: 'standard', careType: { $in: ['antenatal', 'newborn'] } }).lean()) {
    const res = await (await as('drA')).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  testSent().length = 0;
  setTestSender(TEST_SENDER);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setTestSender(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
/** Moves the clock to 11:30 (India) of that day; everyone signs in again (a login lasts 30 minutes). */
const on = (day) => {
  vi.setSystemTime(noon(day));
  sessions = {};
};
const round = (day) => runReminders(noon(day));
const messages = (filter = {}) => ReminderMessage.find({ tenantId: hospital._id, ...filter }).sort({ sendOn: 1, _id: 1 }).lean();
const consent = async (p, body = { consent: true, channel: 'sms', language: 'en' }, who = 'nurse') => {
  const res = await (await as(who)).put(`/api/patients/${p.id}/reminder-consent`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const switchOn = async (remindersEnabled = true) => expect((await (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled, portalEnabled: false })).status).toBe(200);

async function register(fields = {}, who = 'drA') {
  const res = await (await as(who)).post('/api/patients').send(samplePatient({ phone: '98765 43210', assignedDoctor: people.drA._id.toString(), ...fields }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
// A pregnant woman booked on 1 Oct 2026 at about 18 weeks: her booking tests and visit are due until 14 Oct.
const mother = (fields = {}, who) => register({ careType: 'antenatal', fullName: 'Due Mother', pregnancy: { scanEdd: '2027-03-01' }, ...fields }, who);
const plan = async (p, who = 'drA') => (await (await as(who)).get(`/api/patients/${p.id}/care-plan`)).body.plan;
// A baby born on 1 Oct 2026: the birth doses are due until 7 Oct, the 6-week vaccines until 25 Nov. The baby's plan
// starts when the record is first opened (here: on the day of birth).
async function baby(fields = {}, who) {
  const b = await register({ careType: 'newborn', fullName: 'Baby of Sample', ageYears: undefined, phone: '91234 56789', ...fields, newborn: { birthAt: '2026-10-01T03:00:00.000Z', birthWeightGrams: 3000, sex: 'female', ...(fields.newborn ?? {}) } }, who);
  expect((await plan(b)).careType).toBe('newborn');
  return b;
}
const act = async (p, item, body, who = 'drA') => {
  const res = await (await as(who)).patch(`/api/patients/${p.id}/care-plan/items/${item.id}`).send({ rev: item.rev, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const appointment = (p, day, extra = {}) =>
  Appointment.create({ tenantId: hospital._id, patientId: p?.id ?? null, doctorId: people.drA._id, on: D(day), kind: 'slot', start: '10:30', minutes: 10, source: 'booked', created: { by: people.reception._id, byName: 'Sample reception', at: new Date() }, ...extra });
const startVisit = async (p, who = 'nurse') => expect((await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() })).status).toBe(201);
const admit = async (p) => expect((await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: new Date().toISOString(), reason: 'Sample reason' })).status).toBe(201);
// A stay in hospital that is over (as the Stays tab would have recorded it)
const pastStay = (p, from, to) =>
  Admission.create({ tenantId: hospital._id, patientId: p.id, careType: p.careType, admittedAt: new Date(from), status: 'discharged', dischargedAt: new Date(to), admittedBy: people.rmo._id, admittedByName: 'Sample rmo', dischargedByName: 'Sample drA', clientRequestId: randomUUID() });
const stamp = () => ({ by: people.drA._id, byName: 'Sample drA', at: new Date() });
const openList = async (who = 'reception') => (await (await as(who)).get('/api/reminders?list=open')).body.messages;

describe('the wording', () => {
  it('says only the hospital, the phone and (for a missed appointment) the day – in three languages', () => {
    expect(careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000' })).toBe(CARE_DUE);
    expect(careDueMessage({ hospital: 'Sample Hospital', phone: '' })).toBe('A check-up or test is due at Sample Hospital. Please contact the hospital to book. Reply STOP to stop these messages.');
    expect(missedMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', day: D('2026-10-02') })).toBe(
      'Sample Hospital: we missed you at your appointment on 2 Oct 2026. To book again, call 020 0000 0000. Reply STOP to stop these messages.',
    );
    for (const lang of ['mr', 'hi']) {
      const due = careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', lang });
      const missed = missedMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', day: D('2026-10-02'), lang });
      for (const text of [due, missed]) {
        expect(text).toContain('Sample Hospital');
        expect(text).toContain('020 0000 0000');
        expect(text).toContain('STOP');
        expect(text.length).toBeLessThan(320);
      }
      expect(due).not.toBe(careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000' }));
      expect(missed).toMatch(/2 (ऑक्टो|अक्टू) 2026/);
      // "A check-up or test is due" never says whose it is ("your …"): a baby's message goes to a parent's phone
      expect(due).not.toMatch(/आपल्या|आपली|आपकी|आपका/);
    }
  });
});

describe('a check-up or test is due', () => {
  it('one general message when care-plan items are overdue and nothing is booked; at most one in 14 days', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    await round('2026-10-10'); // the booking items are still due (until 14 Oct): nothing
    expect(await messages()).toHaveLength(0);

    await round('2026-10-21');
    await round('2026-10-21'); // the next hour: still one
    let all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'care_due', status: 'sent', to: '+919876543210', channel: 'sms', language: 'en', text: CARE_DUE, ref: '', aboutOn: null });
    expect(all[0].sendOn).toEqual(D('2026-10-21'));
    expect(testSent()).toEqual([{ channel: 'sms', to: '+919876543210', text: CARE_DUE }]);
    // Nothing medical is kept with the message: no item, no plan, no reason
    expect(Object.keys(all[0]).sort()).toEqual(['__v', '_id', 'aboutOn', 'attempts', 'channel', 'claimedAt', 'createdAt', 'dueOn', 'error', 'handled', 'kind', 'language', 'patientId', 'providerId', 'ref', 'sendOn', 'sentAt', 'status', 'tenantId', 'text', 'to', 'updatedAt']);

    await round('2026-11-03'); // 13 days later: not yet
    expect(await messages()).toHaveLength(1);
    await round('2026-11-04'); // 14 days later, and more is overdue by now
    all = await messages();
    expect(all.map((m) => [m.kind, m.status])).toEqual([['care_due', 'sent'], ['care_due', 'sent']]);
  });

  it('only when the hospital switched reminders on, she agreed and has a mobile number', async () => {
    const agreed = await mother({ fullName: 'Agreed Sample' });
    const notAsked = await mother({ fullName: 'Not Asked Sample', phone: '99887 76655' });
    const landline = await mother({ fullName: 'Landline Sample', phone: '020 2345 6789' });
    await consent(agreed);
    await consent(landline);
    await round('2026-10-21'); // the hospital has not switched reminders on
    expect(await messages()).toHaveLength(0);
    await switchOn();
    await runReminders(new Date('2026-10-21T02:00:00Z')); // 07:30 – before the sending hour
    expect(await messages()).toHaveLength(0);
    await round('2026-10-21');
    const all = await messages();
    expect(all.map((m) => String(m.patientId))).toEqual([agreed.id]);
    expect([notAsked.id, landline.id].some((id) => all.some((m) => String(m.patientId) === id))).toBe(false);
  });

  it('none when she is booked from today on, came today, or is in hospital', async () => {
    const booked = await mother({ fullName: 'Booked Sample', phone: '90000 00001' });
    const here = await mother({ fullName: 'Here Sample', phone: '90000 00002' });
    const admitted = await mother({ fullName: 'Admitted Sample', phone: '90000 00003' });
    const free = await mother({ fullName: 'Free Sample', phone: '90000 00004' });
    for (const p of [booked, here, admitted, free]) await consent(p);
    await switchOn();
    on('2026-10-21');
    await appointment(booked, '2026-10-25');
    await startVisit(here);
    await admit(admitted);
    await round('2026-10-21');
    expect((await messages()).map((m) => String(m.patientId))).toEqual([free.id]);
  });

  it('none for a record that is closed, a plan that is paused, or an item a doctor settled', async () => {
    const closed = await mother({ fullName: 'Closed Sample', phone: '90000 00001' });
    const paused = await mother({ fullName: 'Paused Sample', phone: '90000 00002' });
    const settled = await baby({ fullName: 'Baby Settled', phone: '90000 00003' });
    for (const p of [closed, paused, settled]) await consent(p);
    await switchOn();
    on('2026-10-21');
    expect((await (await as('drA')).post(`/api/patients/${closed.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    expect((await (await as('drA')).patch(`/api/patients/${paused.id}`).send({ careType: 'gynaecology' })).status).toBe(200);
    const birth = (await plan(settled)).items.find((i) => i.key === 'nb_vacc_birth');
    expect(birth.status).toBe('overdue');
    await act(settled, birth, { action: 'done', on: '2026-10-01', elsewhere: true });
    await round('2026-10-21');
    expect(await messages()).toHaveLength(0);
  });

  it('none from 43 weeks of pregnancy on (the plan has left the reminder lists)', async () => {
    const late = await mother({ fullName: 'Post Dates Sample', pregnancy: { scanEdd: '2026-09-28' } }); // 40 weeks 3 days at booking
    await consent(late);
    await switchOn();
    await round('2026-10-16'); // 42 weeks 4 days: her booking items are overdue
    expect((await messages()).map((m) => m.kind)).toEqual(['care_due']);
    await round('2026-10-30'); // 44 weeks 4 days, 14 days later: nothing more
    expect(await messages()).toHaveLength(1);
  });

  it('an item counts for six weeks after it became overdue – nobody is messaged for ever about one item', async () => {
    const b = await baby();
    await consent(b);
    await switchOn();
    await round('2026-10-07'); // the birth doses are due until 7 Oct
    expect(await messages()).toHaveLength(0);
    for (const day of ['2026-10-09', '2026-10-23', '2026-11-06']) await round(day);
    expect(await messages()).toHaveLength(3);
    await round('2026-11-20'); // the birth doses became overdue more than 6 weeks ago; the 6-week vaccines are still due
    expect(await messages()).toHaveLength(3);
    await round('2026-11-26'); // now the 6-week vaccines are overdue too
    expect(await messages()).toHaveLength(4);
  });

  it('nothing goes to a patient from a care plan that is still a draft; it starts once a doctor approves the schedule', async () => {
    // As in a hospital where no doctor has approved the care-plan schedules yet
    await CarePlanTemplate.updateMany({ tenantId: hospital._id }, { $set: { status: 'draft', approvals: [], approvedVersion: null } });
    const p = await mother();
    const missed = await register({ careType: 'gynaecology', fullName: 'Missed Sample', phone: '90000 00001' });
    for (const x of [p, missed]) await consent(x);
    await switchOn();
    await appointment(missed, '2026-10-20');
    on('2026-10-21');
    const run = await (await as('drA')).post('/api/reminders/run');
    expect(run.body).toMatchObject({ careDue: 0, heldBack: 1, missed: 1 }); // "we missed you" has nothing to do with the plan
    expect((await messages()).map((m) => m.kind)).toEqual(['missed']);

    const t = await CarePlanTemplate.findOne({ tenantId: hospital._id, kind: 'standard', careType: 'antenatal' }).lean();
    expect((await (await as('drA')).post(`/api/care-plans/templates/${t._id}/approve`).send({ confirm: true, version: t.version })).status).toBe(200);
    expect((await (await as('drA')).post('/api/reminders/run')).body).toMatchObject({ careDue: 1, heldBack: 0 });
    expect((await messages({ kind: 'care_due' })).map((m) => String(m.patientId))).toEqual([p.id]);
  });

  it('a general message that could not be checked first is not sent in that round', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    const tenant = await Tenant.findById(hospital._id);
    expect(await queueCareDue(tenant, noon('2026-10-21'))).toEqual({ added: 1, heldBack: 0 });
    expect(await sendDueReminders(tenant, noon('2026-10-21'), { withGeneral: false })).toEqual({ sent: 0, failed: 0, toSend: 0 });
    expect((await messages()).map((m) => m.status)).toEqual(['queued']);
    expect(await sendDueReminders(tenant, noon('2026-10-21'))).toEqual({ sent: 1, failed: 0, toSend: 0 });
    expect(String((await messages())[0].patientId)).toBe(p.id);
  });

  it('does not write to care plans that are up to date', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    const before = await CarePlan.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    await round('2026-10-21');
    const after = await CarePlan.findOne({ tenantId: hospital._id, patientId: p.id }).lean();
    expect(await messages()).toHaveLength(1);
    expect(after.__v).toBe(before.__v);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('not for a week after she came: the doctor has just seen her', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    on('2026-10-20');
    await startVisit(p); // seen on 20 Oct; her booking tests stay unticked (overdue since 15 Oct)
    for (const day of ['2026-10-21', '2026-10-24', '2026-10-27']) await round(day);
    expect(await messages()).toHaveLength(0);
    await round('2026-10-28');
    expect((await messages()).map((m) => m.kind)).toEqual(['care_due']);
  });

  it('nor in the week after she went home from a stay in hospital', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    await pastStay(p, '2026-10-16T04:00:00Z', '2026-10-19T04:00:00Z'); // went home on 19 Oct
    for (const day of ['2026-10-21', '2026-10-26']) await round(day);
    expect(await messages()).toHaveLength(0);
    await round('2026-10-27');
    expect((await messages()).map((m) => m.kind)).toEqual(['care_due']);
  });

  it('not for a woman whose delivery is already recorded while her record still says antenatal', async () => {
    const delivered = await mother({ fullName: 'Delivered Sample', phone: '90000 00001' });
    const earlier = await mother({ fullName: 'Earlier Delivery Sample', phone: '90000 00002' });
    for (const p of [delivered, earlier]) await consent(p);
    await switchOn();
    // The delivery note was signed on 15 Oct (this pregnancy); the other woman's last delivery was two years ago
    await Patient.updateOne({ tenantId: hospital._id, _id: delivered.id }, { $set: { lastDelivery: { at: new Date('2026-10-15T05:00:00Z'), mode: 'normal', documentId: null } } });
    await Patient.updateOne({ tenantId: hospital._id, _id: earlier.id }, { $set: { lastDelivery: { at: new Date('2024-08-01T05:00:00Z'), mode: 'normal', documentId: null } } });
    await round('2026-10-21');
    expect((await messages()).map((m) => String(m.patientId))).toEqual([earlier.id]);
  });

  it('one message per mobile number: a mother and her baby on the same number are not sent the same words twice', async () => {
    const mum = await mother({ fullName: 'Shared Phone Mother' });
    const b = await baby({ fullName: 'Baby Shared Phone', phone: '98765 43210' });
    for (const p of [mum, b]) await consent(p);
    await switchOn();
    await round('2026-10-21'); // her booking tests and the baby's birth doses are both overdue
    await round('2026-10-22');
    let all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'care_due', to: '+919876543210', status: 'sent' });
    expect(testSent()).toHaveLength(1);
    await round('2026-11-04'); // 14 days later: again one for the number, not two
    all = await messages();
    expect(all).toHaveLength(2);
  });

  it('in the evening the general messages wait for the next morning; appointment reminders are not held', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    const evening = new Date('2026-10-21T14:30:00Z'); // 20:00 in India
    vi.setSystemTime(evening);
    sessions = {};
    const run = await (await as('drA')).post('/api/reminders/run'); // also when a doctor presses "Send due reminders now"
    expect(run.body).toMatchObject({ careDue: 1, waiting: 1, sent: 0, toSend: 0 });
    await runReminders(evening);
    expect((await messages()).map((m) => m.status)).toEqual(['queued']);
    expect(testSent()).toHaveLength(0);
    await round('2026-10-22'); // 11:30 the next morning
    expect((await messages()).map((m) => m.status)).toEqual(['sent']);
    expect(testSent()).toHaveLength(1);
  });

  it('two rounds at the same moment send a message once; a round that was cut off does not block it for ever', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    const tenant = await Tenant.findById(hospital._id);
    const went = [];
    setTestSender({
      name: 'slow',
      channels: ['sms'],
      send: async (msg) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        went.push(msg);
        return { providerId: 'slow-1' };
      },
    });
    const at = noon('2026-10-21');
    expect(await queueCareDue(tenant, at)).toEqual({ added: 1, heldBack: 0 });
    const both = await Promise.all([sendDueReminders(tenant, at), sendDueReminders(tenant, at)]);
    expect(both.map((r) => r.sent).sort()).toEqual([0, 1]);
    expect(went).toHaveLength(1);
    expect((await messages())[0]).toMatchObject({ status: 'sent', attempts: 1 });

    // As if a round had taken the message and was then cut off (the server stopped): it is free again after a while
    await ReminderMessage.updateOne({ tenantId: hospital._id, patientId: p.id }, { $set: { status: 'queued', claimedAt: at, sentAt: null } });
    expect((await sendDueReminders(tenant, new Date(at.getTime() + 5 * 60_000))).sent).toBe(0);
    expect((await sendDueReminders(tenant, new Date(at.getTime() + 60 * 60_000))).sent).toBe(1);
    expect(went).toHaveLength(2);
  });
});

describe('babies', () => {
  it("a baby's overdue vaccination goes to the number on the baby's record, under the baby's own agreement", async () => {
    const mum = await register({ careType: 'postnatal', fullName: 'Mother Sample', phone: '98765 43210' });
    await consent(mum, { consent: true, channel: 'whatsapp', language: 'mr' });
    const b = await baby({ newborn: { mother: mum.id } });
    await switchOn();
    await round('2026-10-09'); // the mother agreed, the baby's record did not: nothing goes anywhere
    expect(await messages()).toHaveLength(0);

    on('2026-10-09');
    await consent(b, { consent: true, channel: 'sms', language: 'hi' }, 'reception');
    await round('2026-10-09');
    const all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'care_due', to: '+919123456789', channel: 'sms', language: 'hi', status: 'sent' });
    expect(String(all[0].patientId)).toBe(b.id);
    expect(all[0].text).toBe(careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', lang: 'hi' }));
    expect(all[0].text).not.toMatch(/Baby|Sample\b(?! Hospital)|BCG|vaccin|टीका/i);
  });

  it('only vaccinations count for a baby; none while the mother on the baby’s record is in hospital', async () => {
    const mum = await register({ careType: 'postnatal', fullName: 'Mother Sample', phone: '98765 43210' });
    const inside = await baby({ fullName: 'Baby Inside', phone: '90000 00001', newborn: { mother: mum.id } });
    const vaccinated = await baby({ fullName: 'Baby Vaccinated', phone: '90000 00002' });
    for (const p of [inside, vaccinated]) await consent(p);
    await switchOn();
    on('2026-10-09');
    await admit(mum);
    // The birth doses were given; the newborn examination and tests are still unticked (overdue)
    const view = await plan(vaccinated);
    await act(vaccinated, view.items.find((i) => i.key === 'nb_vacc_birth'), { action: 'done', on: '2026-10-01' });
    expect(view.items.filter((i) => i.kind !== 'vaccination' && i.status === 'overdue').length).toBeGreaterThan(0);
    await round('2026-10-09');
    expect(await messages()).toHaveLength(0);
  });

  it("a baby's missed appointment: the message goes to the number on the baby's record, under the baby's own agreement", async () => {
    const mum = await register({ careType: 'postnatal', fullName: 'Mother Sample', phone: '98765 43210' });
    await consent(mum);
    const b = await baby({ newborn: { mother: mum.id } });
    await switchOn();
    const appt = await appointment(b, '2026-10-05');
    await round('2026-10-06'); // the mother agreed, the baby's record did not
    expect(await messages()).toHaveLength(0);
    on('2026-10-06');
    await consent(b, { consent: true, channel: 'sms', language: 'en' }, 'reception');
    await round('2026-10-06');
    const all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'missed', to: '+919123456789', ref: String(appt._id), status: 'sent' });
    expect(String(all[0].patientId)).toBe(b.id);
    expect(all[0].text).toBe('Sample Hospital: we missed you at your appointment on 5 Oct 2026. To book again, call 020 0000 0000. Reply STOP to stop these messages.');
  });
});

describe('we missed you', () => {
  it('the day after a booked appointment nobody came to: one message, once per appointment', async () => {
    const p = await register({ careType: 'gynaecology', fullName: 'Missed Sample' });
    await consent(p, { consent: true, channel: 'whatsapp', language: 'en' });
    await switchOn();
    const appt = await appointment(p, '2026-10-05');
    await round('2026-10-05'); // the day itself: she may still come
    expect(await messages({ kind: 'missed' })).toHaveLength(0);
    await round('2026-10-06');
    await round('2026-10-06');
    await round('2026-10-07');
    const all = await messages({ kind: 'missed' });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'sent', channel: 'whatsapp', to: '+919876543210', ref: String(appt._id) });
    expect(all[0].aboutOn).toEqual(D('2026-10-05'));
    expect(all[0].text).toBe('Sample Hospital: we missed you at your appointment on 5 Oct 2026. To book again, call 020 0000 0000. Reply STOP to stop these messages.');
  });

  it('not when she came, the appointment was cancelled, she is booked again, was in hospital, or it was a quick booking', async () => {
    const came = await register({ careType: 'gynaecology', fullName: 'Came Sample', phone: '90000 00001' });
    const cancelled = await register({ careType: 'gynaecology', fullName: 'Cancelled Sample', phone: '90000 00002' });
    const rebooked = await register({ careType: 'gynaecology', fullName: 'Rebooked Sample', phone: '90000 00003' });
    const admitted = await register({ careType: 'gynaecology', fullName: 'Admitted Sample', phone: '90000 00004' });
    const notAgreed = await register({ careType: 'gynaecology', fullName: 'Not Agreed Sample', phone: '90000 00005' });
    for (const p of [came, cancelled, rebooked, admitted]) await consent(p);
    await switchOn();
    for (const p of [came, rebooked, admitted, notAgreed]) await appointment(p, '2026-10-05');
    await appointment(cancelled, '2026-10-05', { status: 'cancelled' });
    await appointment(null, '2026-10-05', { guest: { name: 'Quick Booking Sample', phone: '90000 00009' }, start: '11:00' });
    await appointment(rebooked, '2026-10-12');
    on('2026-10-05');
    expect((await (await as('reception')).post('/api/arrivals').send({ patientId: came.id })).status).toBe(201);
    await admit(admitted);
    await round('2026-10-06');
    expect(await messages()).toHaveLength(0);
  });

  it('once in 14 days together with "a check-up or test is due"; none for a closed record', async () => {
    const p = await mother();
    const ended = await mother({ fullName: 'Ended Sample', phone: '90000 00001' });
    for (const x of [p, ended]) await consent(x);
    await switchOn();
    await appointment(p, '2026-10-20');
    await appointment(ended, '2026-10-20');
    on('2026-10-19');
    expect((await (await as('drA')).post(`/api/patients/${ended.id}/care-plan/close`).send({ reason: 'pregnancy_ended' })).status).toBe(200);
    await round('2026-10-21'); // she missed 20 Oct, and her booking items are overdue as well: one message, the first
    await round('2026-10-22');
    const all = await messages();
    expect(all.map((m) => [String(m.patientId), m.kind])).toEqual([[p.id, 'missed']]);
    await round('2026-11-04'); // 14 days later the general one may follow
    expect((await messages()).map((m) => m.kind)).toEqual(['missed', 'care_due']);
  });

  it('a scan or procedure recorded as done, or a lab sample taken, that day counts as having come', async () => {
    const scanned = await register({ careType: 'gynaecology', fullName: 'Scanned Sample', phone: '90000 00001' });
    const sampled = await register({ careType: 'gynaecology', fullName: 'Sampled Sample', phone: '90000 00002' });
    const away = await register({ careType: 'gynaecology', fullName: 'Away Sample', phone: '90000 00003' });
    for (const p of [scanned, sampled, away]) await consent(p);
    await switchOn();
    for (const p of [scanned, sampled, away]) await appointment(p, '2026-10-05');
    // Nobody marked them arrived and no visit was started – but the scan was recorded as done, and the sample was taken
    await WorkDone.create({ tenantId: hospital._id, patientId: scanned.id, priceItemId: new mongoose.Types.ObjectId(), name: 'Sample scan', group: 'scan', on: D('2026-10-05'), clientRequestId: randomUUID(), done: stamp() });
    await LabOrder.create({ tenantId: hospital._id, patientId: sampled.id, status: 'collected', tests: [{ key: 'other', name: 'Sample test' }], ordered: stamp(), collected: { ...stamp(), at: new Date('2026-10-05T05:00:00Z') }, clientRequestId: randomUUID() });
    await round('2026-10-06');
    expect((await messages()).map((m) => String(m.patientId))).toEqual([away.id]);
  });

  it('not when a stay in hospital or a delivery overtook the appointment after it was made', async () => {
    const stayed = await mother({ fullName: 'Stayed Sample', phone: '90000 00001' });
    const delivered = await mother({ fullName: 'Delivered Sample', phone: '90000 00002' });
    const before = await mother({ fullName: 'Stay Before Sample', phone: '90000 00003' });
    for (const p of [stayed, delivered, before]) await consent(p);
    await switchOn();
    // Booked on 1 Oct for 12 Oct. One was admitted on 7 Oct and went home on 10 Oct; one delivered on 8 Oct (her
    // record still says antenatal); the third had a stay that was over before the booking was made.
    for (const p of [stayed, delivered, before]) await appointment(p, '2026-10-12');
    await pastStay(stayed, '2026-10-07T04:00:00Z', '2026-10-10T04:00:00Z');
    await Patient.updateOne({ tenantId: hospital._id, _id: delivered.id }, { $set: { lastDelivery: { at: new Date('2026-10-08T05:00:00Z'), mode: 'normal', documentId: null } } });
    await pastStay(before, '2026-09-20T04:00:00Z', '2026-09-25T04:00:00Z');
    await round('2026-10-13');
    expect((await messages()).map((m) => [String(m.patientId), m.kind])).toEqual([[before.id, 'missed']]);
  });

  it('an appointment moved to another day after a no-show counts as a new one', async () => {
    const p = await register({ careType: 'gynaecology', fullName: 'Moved Sample' });
    await consent(p);
    await switchOn();
    const appt = await appointment(p, '2026-10-05');
    await round('2026-10-06');
    // The doctor changed the visit's next date: the same booking now stands for 25 Oct, and she misses that too
    await Appointment.updateOne({ tenantId: hospital._id, _id: appt._id }, { $set: { on: D('2026-10-25'), updated: { by: people.drA._id, byName: 'Sample drA', at: noon('2026-10-07') } } });
    await round('2026-10-26');
    await round('2026-10-27');
    const all = await messages({ kind: 'missed' });
    expect(all.map((m) => [m.ref, m.aboutOn.toISOString().slice(0, 10), m.status])).toEqual([
      [String(appt._id), '2026-10-05', 'sent'],
      [String(appt._id), '2026-10-25', 'sent'],
    ]);
  });

  it('a record closed long ago does not stop the message for a booking made since; one closed after the booking does', async () => {
    const back = await register({ careType: 'gynaecology', fullName: 'Back Again Sample', phone: '90000 00001' });
    const left = await register({ careType: 'gynaecology', fullName: 'Left Sample', phone: '90000 00002' });
    for (const p of [back, left]) {
      await consent(p);
      expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/start`)).status).toBe(201);
    }
    await switchOn();
    // Her course of care was closed on 1 Oct; on 10 Oct she books again for a new problem
    expect((await (await as('drA')).post(`/api/patients/${back.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    await appointment(left, '2026-10-20');
    on('2026-10-10');
    await appointment(back, '2026-10-20');
    // The other one was booked on 1 Oct; on 10 Oct the doctor closes her care (she goes elsewhere)
    expect((await (await as('drA')).post(`/api/patients/${left.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    await round('2026-10-21');
    expect((await messages()).map((m) => [String(m.patientId), m.kind])).toEqual([[back.id, 'missed']]);
  });

  it('a day the server was off does not lose the message; older appointments are left alone', async () => {
    const recent = await register({ careType: 'gynaecology', fullName: 'Recent Sample', phone: '90000 00001' });
    const old = await register({ careType: 'gynaecology', fullName: 'Old Sample', phone: '90000 00002' });
    for (const p of [recent, old]) await consent(p);
    await switchOn();
    await appointment(recent, '2026-10-05');
    await appointment(old, '2026-10-03');
    await round('2026-10-07'); // no round ran on 6 Oct
    expect((await messages()).map((m) => String(m.patientId))).toEqual([recent.id]);
  });
});

describe('the outbox (Calendar → Reminders)', () => {
  beforeEach(() => setTestSender(null)); // no message provider: they wait for staff

  it('with no provider the new kinds wait to be sent by hand, with a plain kind and nothing medical', async () => {
    const p = await mother();
    const missed = await register({ careType: 'gynaecology', fullName: 'Missed Sample', phone: '90000 00001' });
    for (const x of [p, missed]) await consent(x);
    await switchOn();
    await appointment(missed, '2026-10-20');
    on('2026-10-21');
    expect((await (await as('nurse')).post('/api/reminders/run')).status).toBe(403);
    const run = await (await as('drA')).post('/api/reminders/run');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toEqual({ queued: 0, missed: 1, careDue: 1, heldBack: 0, dropped: 0, waiting: 0, sent: 0, failed: 0, toSend: 2 });

    const open = (await (await as('reception')).get('/api/reminders?list=open')).body.messages;
    expect(open.map((m) => [m.patient.fullName, m.kind, m.status]).sort()).toEqual([
      ['Due Mother', 'care_due', 'to_send'],
      ['Missed Sample', 'missed', 'to_send'],
    ]);
    const due = open.find((m) => m.kind === 'care_due');
    expect(due).toMatchObject({ text: CARE_DUE, to: '+919876543210', aboutOn: null, dueOn: '2026-10-27T00:00:00.000Z', sendOn: '2026-10-21T00:00:00.000Z' });
    expect(open.find((m) => m.kind === 'missed').aboutOn).toBe('2026-10-20T00:00:00.000Z');
    expect(JSON.stringify(open)).not.toMatch(/Hb|haemoglobin|scan|Td|visit|weeks|antenatal/i);
    // The day's list shows them too; lab staff and a hospital admin with no clinical role see no messages
    expect((await (await as('nurse')).get('/api/reminders?day=2026-10-21')).body.messages).toHaveLength(2);
    expect((await (await as('lab')).get('/api/reminders?list=open')).status).toBe(403);
    expect((await (await as('admin')).get('/api/reminders?list=open')).status).toBe(403);

    // Sent by hand: recorded with the person's name; the audit log gets ids only
    expect((await (await as('lab')).post(`/api/reminders/${due.id}/sent-by-hand`)).status).toBe(403);
    expect((await (await as('reception')).post(`/api/reminders/${due.id}/sent-by-hand`)).status).toBe(200);
    expect((await (await as('reception')).post(`/api/reminders/${due.id}/sent-by-hand`)).status).toBe(409);
    expect(await ReminderMessage.findOne({ tenantId: hospital._id, _id: due.id }).lean()).toMatchObject({ status: 'sent_by_hand', handled: { byName: 'Sample reception' } });
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'REMINDER_SENT_BY_HAND' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn });
    const ran = await AuditLog.findOne({ tenantId: hospital._id, action: 'REMINDERS_RUN' }).lean();
    expect(ran.details).toEqual({ queued: 0, missed: 1, careDue: 1, heldBack: 0, dropped: 0, waiting: 0, sent: 0, failed: 0, toSend: 2 });
    // A message sent by hand counts for the 14 days too
    await round('2026-10-28');
    expect(await messages({ patientId: p.id })).toHaveLength(1);
  });

  it('a waiting message that is no longer true is cancelled before anyone sends it', async () => {
    const books = await mother({ fullName: 'Books Sample', phone: '90000 00001' });
    const comes = await register({ careType: 'gynaecology', fullName: 'Comes Sample', phone: '90000 00002' });
    const withdraws = await mother({ fullName: 'Withdraws Sample', phone: '90000 00003' });
    const stays = await mother({ fullName: 'Stays Sample', phone: '90000 00004' });
    for (const p of [books, comes, withdraws, stays]) await consent(p);
    await switchOn();
    await appointment(comes, '2026-10-20');
    await round('2026-10-21');
    expect((await messages()).map((m) => m.status)).toEqual(['to_send', 'to_send', 'to_send', 'to_send']);

    on('2026-10-22');
    await appointment(books, '2026-10-30');
    await startVisit(comes);
    await consent(withdraws, { consent: false });
    const open = (await (await as('reception')).get('/api/reminders?list=open')).body.messages;
    expect(open.map((m) => m.patient.fullName)).toEqual(['Stays Sample']);
    const all = await messages();
    expect(all.filter((m) => m.status === 'cancelled').map((m) => m.error).sort()).toEqual(['No longer needed', 'No longer needed', 'Reminders switched off for this patient']);
    // A cancelled message does not count for the 14 days: after her visit, if nothing is booked, she may be asked again
    expect((await (await as('reception')).post(`/api/reminders/${all.find((m) => String(m.patientId) === books.id)._id}/sent-by-hand`)).status).toBe(409);
  });

  it('a week later a message nobody sent is too old to send', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    await round('2026-10-21');
    on('2026-10-27');
    expect((await (await as('reception')).get('/api/reminders?list=open')).body.messages).toHaveLength(1);
    on('2026-10-28');
    expect((await (await as('reception')).get('/api/reminders?list=open')).body.messages).toHaveLength(0);
    // Under "Messages of the day" it reads as cancelled, and cannot be marked as sent any more
    const day = (await (await as('reception')).get('/api/reminders?day=2026-10-21')).body.messages;
    expect(day.map((m) => [m.status, m.error])).toEqual([['cancelled', 'Too old to send']]);
    expect((await (await as('reception')).post(`/api/reminders/${day[0].id}/sent-by-hand`)).status).toBe(409);
  });

  it('a page left open: a message that is too old, or no longer true, cannot be marked as sent', async () => {
    const old = await mother({ fullName: 'Old Sample', phone: '90000 00001' });
    const books = await mother({ fullName: 'Books Sample', phone: '90000 00002' });
    for (const p of [old, books]) await consent(p);
    await switchOn();
    await round('2026-10-21');
    const [first, second] = await messages();
    on('2026-10-22');
    await appointment(books, '2026-10-30'); // she booked after the list was opened
    const res = await (await as('reception')).post(`/api/reminders/${second._id}/sent-by-hand`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('This message is no longer to be sent (no longer needed).');
    on('2026-10-28'); // the other one was never sent: past its last day
    expect((await (await as('reception')).post(`/api/reminders/${first._id}/sent-by-hand`)).status).toBe(409);
    expect((await messages()).map((m) => [m.status, m.error])).toEqual([['cancelled', 'Too old to send'], ['cancelled', 'No longer needed']]);
  });

  it('more reasons a waiting message is cancelled: admitted, the baby’s mother admitted, the item marked done, the record closed', async () => {
    const admitted = await mother({ fullName: 'Admitted Sample', phone: '90000 00001' });
    const mum = await register({ careType: 'postnatal', fullName: 'Mother Sample', phone: '90000 00009' });
    const babyIn = await baby({ fullName: 'Baby Mother Admitted', phone: '90000 00002', newborn: { mother: mum.id } });
    const babyDone = await baby({ fullName: 'Baby Done', phone: '90000 00003' });
    const closed = await register({ careType: 'gynaecology', fullName: 'Closed Sample', phone: '90000 00004' });
    const stays = await mother({ fullName: 'Stays Sample', phone: '90000 00005' });
    for (const p of [admitted, babyIn, babyDone, closed, stays]) await consent(p);
    expect((await (await as('drA')).post(`/api/patients/${closed.id}/care-plan/start`)).status).toBe(201);
    await switchOn();
    await appointment(closed, '2026-10-20');
    await round('2026-10-21');
    expect((await messages()).map((m) => [m.kind, m.status]).sort()).toEqual([['care_due', 'to_send'], ['care_due', 'to_send'], ['care_due', 'to_send'], ['care_due', 'to_send'], ['missed', 'to_send']]);

    on('2026-10-22');
    await admit(admitted);
    await admit(mum);
    await act(babyDone, (await plan(babyDone)).items.find((i) => i.key === 'nb_vacc_birth'), { action: 'done', on: '2026-10-02' });
    expect((await (await as('drA')).post(`/api/patients/${closed.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    expect((await openList()).map((m) => m.patient.fullName)).toEqual(['Stays Sample']);
    const all = await messages();
    expect(all.filter((m) => m.status === 'cancelled').map((m) => m.error)).toEqual(['No longer needed', 'No longer needed', 'No longer needed', 'No longer needed']);
  });

  it('a waiting message follows the record: a corrected number, another channel or language; no mobile number cancels it', async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    await round('2026-10-21');
    on('2026-10-21');
    expect((await openList()).map((m) => m.to)).toEqual(['+919876543210']);
    on('2026-10-22');
    // Reception corrects a mistyped number: the waiting message must not keep the old one
    expect((await (await as('reception')).patch(`/api/patients/${p.id}`).send({ phone: '91111 22222' })).status).toBe(200);
    let open = await openList();
    expect(open.map((m) => [m.to, m.channel, m.language, m.status])).toEqual([['+919111122222', 'sms', 'en', 'to_send']]);
    await consent(p, { consent: true, channel: 'whatsapp', language: 'hi' });
    open = await openList();
    expect(open.map((m) => [m.to, m.channel, m.language])).toEqual([['+919111122222', 'whatsapp', 'hi']]);
    expect(open[0].text).toBe(careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', lang: 'hi' }));
    // A landline: there is nowhere to send it
    expect((await (await as('reception')).patch(`/api/patients/${p.id}`).send({ phone: '020 2345 6789' })).status).toBe(200);
    expect(await openList()).toEqual([]);
    expect((await messages()).map((m) => [m.status, m.error])).toEqual([['cancelled', 'No mobile number on the record any more']]);
  });

  it('when the hospital admin switches reminders off, the waiting general messages are withdrawn', async () => {
    const p = await mother();
    const missed = await register({ careType: 'gynaecology', fullName: 'Missed Sample', phone: '90000 00001' });
    for (const x of [p, missed]) await consent(x);
    await switchOn();
    await appointment(missed, '2026-10-20');
    await round('2026-10-21');
    on('2026-10-22');
    const waiting = await openList();
    expect(waiting).toHaveLength(2);
    await switchOn(false);
    // A page that was still open: marking one as sent is refused, and the list is empty
    const res = await (await as('reception')).post(`/api/reminders/${waiting[0].id}/sent-by-hand`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('This message is no longer to be sent (reminders switched off for the hospital).');
    expect(await openList()).toEqual([]);
    expect((await messages()).map((m) => [m.status, m.error])).toEqual([['cancelled', 'Reminders switched off for the hospital'], ['cancelled', 'Reminders switched off for the hospital']]);
  });

  it('when the waiting messages cannot be checked, none is queued, sent, shown or marked as sent – appointment reminders go on', async () => {
    const waits = await mother({ fullName: 'Waits Sample', phone: '90000 00001' });
    const newly = await mother({ fullName: 'Newly Due Sample', phone: '90000 00002' });
    const tomorrow = await register({ careType: 'gynaecology', fullName: 'Tomorrow Sample', phone: '90000 00003' });
    await consent(waits);
    await switchOn();
    await round('2026-10-21');
    expect((await messages()).map((m) => [m.kind, m.status])).toEqual([['care_due', 'to_send']]);
    on('2026-10-22');
    for (const p of [newly, tomorrow]) await consent(p);
    await appointment(tomorrow, '2026-10-23');
    const [general] = await messages();

    // The check of the waiting general messages fails (here: the stays in hospital cannot be read)
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = vi.spyOn(Admission, 'find').mockImplementation(() => {
      throw new Error('Sample failure');
    });
    const run = await (await as('drA')).post('/api/reminders/run');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toEqual({ queued: 1, missed: 0, careDue: 0, heldBack: 0, dropped: 0, waiting: 0, sent: 0, failed: 0, toSend: 1 });
    expect((await openList()).map((m) => [m.patient.fullName, m.kind])).toEqual([['Tomorrow Sample', 'appointment']]); // never shown unchecked
    const refused = await (await as('reception')).post(`/api/reminders/${general._id}/sent-by-hand`);
    expect(refused.status).toBe(503);
    expect(await ReminderMessage.findOne({ tenantId: hospital._id, _id: general._id }).lean()).toMatchObject({ status: 'to_send' });

    // Once it can be checked again, everything is as it should be
    broken.mockRestore();
    expect((await (await as('drA')).post('/api/reminders/run')).body).toMatchObject({ queued: 0, careDue: 1, toSend: 1 });
    expect((await openList()).map((m) => [m.patient.fullName, m.kind]).sort()).toEqual([['Newly Due Sample', 'care_due'], ['Tomorrow Sample', 'appointment'], ['Waits Sample', 'care_due']]);
  });

  it('a sensitive record: the same message goes out; its "check-up or test due" row is only for staff who may see her medical details', async () => {
    const p = await mother({ fullName: 'Private Sample' });
    const missed = await register({ careType: 'gynaecology', fullName: 'Private Missed Sample', phone: '90000 00001' });
    for (const x of [p, missed]) {
      await consent(x);
      expect((await (await as('drA')).patch(`/api/patients/${x.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    }
    await switchOn();
    await appointment(missed, '2026-10-20');
    await round('2026-10-21');
    const all = await messages();
    // The message itself is the same as for anyone (the rule of the appointment reminders)
    expect(all.map((m) => [m.kind, m.status]).sort()).toEqual([['care_due', 'to_send'], ['missed', 'to_send']]);
    const due = all.find((m) => m.kind === 'care_due');
    expect(due.text).toBe(CARE_DUE);
    on('2026-10-21');
    // Reception, nurses and other doctors see nothing of a sensitive record's care plan – so not this row either.
    // "Missed appointment" is about a booking, which they see anyway.
    for (const who of ['reception', 'nurse', 'drB']) {
      const open = await openList(who);
      expect(open.map((m) => [m.patient.fullName, m.kind]), who).toEqual([['Private Missed Sample', 'missed']]);
      expect((await (await as(who)).get('/api/reminders?day=2026-10-21')).body.messages.map((m) => m.kind), who).toEqual(['missed']);
      expect((await (await as(who)).post(`/api/reminders/${due._id}/sent-by-hand`)).status, who).toBe(403);
    }
    // Her doctor and RMOs see it and send it by hand
    for (const who of ['drA', 'rmo']) {
      expect((await openList(who)).map((m) => m.kind).sort(), who).toEqual(['care_due', 'missed']);
    }
    expect((await (await as('rmo')).post(`/api/reminders/${due._id}/sent-by-hand`)).status).toBe(200);
  });

  it("another hospital's staff never see these messages, and cannot mark them", async () => {
    const p = await mother();
    await consent(p);
    await switchOn();
    await round('2026-10-21');
    const [m] = await messages();
    const other = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, other, ['doctor', 'admin']);
    on('2026-10-21');
    const s = await loginAs(outsider, { app });
    expect((await s.get('/api/reminders?list=open')).body.messages).toEqual([]);
    expect((await s.get('/api/reminders?day=2026-10-21')).body.messages).toEqual([]);
    expect((await s.post(`/api/reminders/${m._id}/sent-by-hand`)).status).toBe(404);
    // The other hospital's own round touches nothing here
    await Tenant.updateOne({ _id: other._id }, { $set: { 'messaging.remindersEnabled': true } });
    await round('2026-10-21');
    expect(await ReminderMessage.countDocuments({ tenantId: other._id })).toBe(0);
    expect(await messages()).toHaveLength(1);
  });
});
