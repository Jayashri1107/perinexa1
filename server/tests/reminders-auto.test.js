// Automatic reminders (Version 2): her agreement, the hospital switch, queueing tomorrow's appointments, sending
// through a provider (a test sender here – nothing leaves the computer) or leaving them for staff. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { appointmentMessage } from '../src/reminders/messages.js';
import { hospitalHour, mobileNumber, runReminders } from '../src/reminders/reminderService.js';
import { TEST_SENDER, setTestSender, testSent } from '../src/reminders/sender.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z'); // 11:30 in India
const D = (s) => new Date(`${s}T00:00:00Z`);
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', lab: 'lab', admin: 'admin' };
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
  hospital = await createTenant('Reminder Hospital');
  await Tenant.updateOne({ _id: hospital._id }, { $set: { 'letterhead.name': 'Sample Hospital', 'letterhead.phone': '020 0000 0000' } });
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
  testSent().length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  setTestSender(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Reminder Mother', phone: '98765 43210', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const book = (p, next) => Visit.create({ tenantId: hospital._id, patientId: p.id, visitOn: D('2026-09-20'), careType: 'antenatal', clientRequestId: randomUUID(), details: { nextVisitOn: D(next) }, createdBy: people.drA._id, createdByName: 'Sample drA' });
const consent = async (who, p, body) => (await as(who)).put(`/api/patients/${p.id}/reminder-consent`).send(body);
const switchOn = async (on = true) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: on, portalEnabled: false });

describe('the message and the numbers', () => {
  it('says only the hospital, the date and the phone – never her name or why she comes', () => {
    const text = appointmentMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', day: D('2026-10-02'), lang: 'en' });
    expect(text).toBe('Sample Hospital: your appointment is on 2 Oct 2026. To change it, call 020 0000 0000. Reply STOP to stop these messages.');
    expect(appointmentMessage({ hospital: 'H', phone: '', day: D('2026-10-02'), lang: 'mr' })).toContain('2 ऑक्टो 2026');
    expect([mobileNumber('98765 43210'), mobileNumber('+91 98765-43210'), mobileNumber('020 2345 6789'), mobileNumber('+44 7700 900123')]).toEqual(['+919876543210', '+919876543210', null, '+447700900123']);
    expect(hospitalHour(NOW)).toBe(11);
  });
});

describe('automatic reminders', () => {
  it('her agreement is recorded by staff who see her phone; not by the lab', async () => {
    const p = await register();
    expect((await consent('lab', p, { consent: true })).status).toBe(403);
    const res = await consent('reception', p, { consent: true, channel: 'whatsapp', language: 'mr' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reminders).toMatchObject({ consent: true, channel: 'whatsapp', language: 'mr', byName: 'Sample reception' });
    expect((await (await as('nurse')).get(`/api/patients/${p.id}`)).body.patient.reminders).toMatchObject({ consent: true });
  });

  it('only for hospitals that switched them on, only with her agreement, only for tomorrow, sent once', async () => {
    const yes = await register({ fullName: 'Agreed Sample' });
    const no = await register({ fullName: 'Not Agreed Sample', phone: '91234 56789' });
    const later = await register({ fullName: 'Later Sample', phone: '99887 76655' });
    await consent('nurse', yes, { consent: true, channel: 'sms', language: 'en' });
    await consent('nurse', later, { consent: true, channel: 'sms', language: 'en' });
    await book(yes, '2026-10-02');
    await book(no, '2026-10-02');
    await book(later, '2026-10-05');
    setTestSender(TEST_SENDER);

    await runReminders(NOW); // switched off: nothing
    expect(await ReminderMessage.countDocuments({ tenantId: hospital._id })).toBe(0);
    expect((await (await as('nurse')).put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: false })).status).toBe(403);
    expect((await switchOn()).status).toBe(200);

    await runReminders(new Date('2026-10-01T02:00:00Z')); // 07:30 – before the sending hour (10)
    expect(await ReminderMessage.countDocuments({ tenantId: hospital._id })).toBe(0);
    await runReminders(NOW);
    await runReminders(NOW); // again: still one message
    expect(testSent()).toEqual([{ channel: 'sms', to: '+919876543210', text: 'Sample Hospital: your appointment is on 2 Oct 2026. To change it, call 020 0000 0000. Reply STOP to stop these messages.' }]);
    const list = (await (await as('reception')).get('/api/reminders?day=2026-10-01')).body;
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]).toMatchObject({ status: 'sent', patient: { fullName: 'Agreed Sample' } });
    expect(list.provider).toEqual({ name: 'test', channels: ['sms', 'whatsapp'] });
  });

  it('without a provider the messages wait for staff, who send them by hand; a withdrawn agreement cancels', async () => {
    const p = await register();
    const q = await register({ fullName: 'Withdrawn Sample', phone: '91234 56789' });
    await consent('nurse', p, { consent: true, channel: 'whatsapp', language: 'hi' });
    await consent('nurse', q, { consent: true });
    await book(p, '2026-10-02');
    await book(q, '2026-10-02');
    await switchOn();
    expect((await (await as('nurse')).post('/api/reminders/run')).status).toBe(403);
    // Queued, then her agreement withdrawn before sending
    const { queueAppointmentReminders } = await import('../src/reminders/reminderService.js');
    await queueAppointmentReminders(await Tenant.findById(hospital._id), NOW);
    await consent('nurse', q, { consent: false });
    const run = await (await as('drA')).post('/api/reminders/run');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ queued: 0, sent: 0, toSend: 1 });
    const open = (await (await as('nurse')).get('/api/reminders?list=open')).body.messages;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'to_send', channel: 'whatsapp', to: '+919876543210', error: 'No message provider is set up' });
    expect(open[0].text).toContain('मुलाक़ात');
    expect((await (await as('nurse')).post(`/api/reminders/${open[0].id}/sent-by-hand`)).status).toBe(200);
    expect((await (await as('nurse')).get('/api/reminders?list=open')).body.messages).toHaveLength(0);
    expect(await ReminderMessage.findOne({ tenantId: hospital._id, patientId: q.id }).lean()).toMatchObject({ status: 'cancelled' });
  });

  it('a failing provider is tried three times, then the message is marked failed', async () => {
    const p = await register();
    await consent('nurse', p, { consent: true });
    await book(p, '2026-10-02');
    await switchOn();
    setTestSender({ name: 'broken', channels: ['sms'], send: async () => { throw new Error('The provider refused the message (401)'); } });
    for (let i = 0; i < 3; i += 1) await runReminders(NOW);
    const m = await ReminderMessage.findOne({ tenantId: hospital._id }).lean();
    expect(m).toMatchObject({ status: 'failed', attempts: 3, error: 'The provider refused the message (401)' });
  });
});
