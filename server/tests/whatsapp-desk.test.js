// WhatsApp at the desk (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md): sign-in OTPs on WhatsApp with SMS when it
// fails, appointment messages through the hospital's WhatsApp number, the bill and the reviewed lab report in one
// click, the queue time when she arrives, and the daily cash handover. WhatsApp in practice mode: nothing leaves the
// computer. All fake sample data.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { queueEstimate } from '../src/appointments/queueTime.js';
import { queueChangeMessage } from '../src/appointments/appointmentService.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { TEST_SENDER, deliverOtp, setTestSender, testSent } from '../src/reminders/sender.js';
import { sendSoon } from '../src/reminders/reminderService.js';
import { practiceSent } from '../src/visits/whatsappSender.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-17T05:00:00Z'); // 10:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', reception: 'receptionist', reception2: 'receptionist', lab: 'lab', admin: 'admin' };
const PDF = Buffer.from('%PDF-1.4\n% fake sample document\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'.repeat(3)).toString('base64');
let app;
let hospital;
let people;
let sessions;
const saved = {};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  setTestSender(null);
  for (const k of ['WHATSAPP_MODE', 'REMINDER_PROVIDER']) saved[k] = config[k];
  config.WHATSAPP_MODE = 'practice';
  practiceSent().length = 0;
  app = createApp();
  hospital = await createTenant('Desk Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => {
  vi.useRealTimers();
  setTestSender(null);
  Object.assign(config, saved);
  vi.unstubAllGlobals();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const switches = async (body) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: false, ...body });
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'gynaecology', fullName: 'Desk Patient', phone: '98765 43210', assignedDoctor: people.drA._id.toString(), ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const agree = async (p, channel = 'whatsapp', language = 'en') => (await as('reception')).put(`/api/patients/${p.id}/reminder-consent`).send({ consent: true, channel, language });

describe('sign-in OTPs on WhatsApp', () => {
  const tenant = (whatsappOtp) => ({ messaging: { whatsappOtp } });

  it('go on WhatsApp when the hospital switched it on (the code never in the practice record); SMS otherwise', async () => {
    setTestSender(TEST_SENDER);
    expect(await deliverOtp(tenant(true), { to: '+919876543210', otp: '123456', hospital: 'Desk Hospital', minutes: 10 })).toBe('whatsapp');
    expect(practiceSent().at(-1)).toEqual({ to: '+919876543210', template: 'perinexa_otp', params: ['otp'] });
    expect(await deliverOtp(tenant(false), { to: '+919876543210', otp: '123456', hospital: 'Desk Hospital', minutes: 10 })).toBe('sms');
    expect(testSent().at(-1)).toMatchObject({ channel: 'sms', to: '+919876543210' });
  });

  it('fall back to SMS when WhatsApp refuses; fail only when neither can send', async () => {
    Object.assign(config, { WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: '000', WHATSAPP_ACCESS_TOKEN: 'fake-test-token' });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 190 } }) }));
    setTestSender(TEST_SENDER);
    const before = testSent().length;
    expect(await deliverOtp(tenant(true), { to: '+919876543210', otp: '654321', hospital: 'Desk Hospital', minutes: 10 })).toBe('sms');
    expect(testSent().length).toBe(before + 1);
    setTestSender(null);
    config.REMINDER_PROVIDER = '';
    await expect(deliverOtp(tenant(true), { to: '+919876543210', otp: '654321', hospital: 'Desk Hospital', minutes: 10 })).rejects.toThrow(/WhatsApp refused/);
  });

  it('the portal says the OTP goes on WhatsApp once the admin switches it on', async () => {
    const res = await switches({ portalEnabled: true, portalSignup: true, whatsappOtp: true });
    expect(res.body.settings).toMatchObject({ whatsappOtp: true, whatsappQueue: false });
    expect(res.body.whatsapp).toMatchObject({ mode: 'practice', ready: true });
    const key = res.body.settings.signupKey;
    expect((await request(app).get(`/api/portal/h/${key}`)).body.otp).toBe('whatsapp');
    expect((await request(app).post(`/api/portal/h/${key}/otp`).send({ mobile: '9000000009' })).body).toEqual({ sentTo: '******0009', minutes: 10, via: 'whatsapp' });
    await switches({ portalEnabled: true, portalSignup: true, whatsappOtp: false });
    expect((await request(app).get(`/api/portal/h/${key}`)).body.otp).toBe('practice');
  });
});

describe('appointment messages through the WhatsApp number', () => {
  it('a booking goes out at once in the update template, with the hospital and the message', async () => {
    await switches({ remindersEnabled: true });
    const p = await register();
    await agree(p);
    const appt = await Appointment.create({ tenantId: hospital._id, patientId: p.id, doctorId: people.drA._id, on: new Date('2026-10-18T00:00:00Z'), kind: 'slot', start: '11:00', minutes: 10, visitType: 'follow_up', source: 'booked', created: { by: people.reception._id, byName: 'Sample reception', at: NOW } });
    expect(await queueChangeMessage(hospital._id, appt, 'booked', NOW)).toBe(true);
    await sendSoon(hospital._id, NOW);
    const sent = practiceSent().filter((m) => m.template === 'perinexa_update');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: '+919876543210', params: ['Desk Hospital', expect.stringContaining('your appointment is booked for 18 Oct 2026 at 11:00 AM with Sample drA')] });
    expect((await ReminderMessage.findOne({ tenantId: hospital._id }).lean()).status).toBe('sent');
  });
});

describe('the bill and the reviewed lab report in one click', () => {
  it('the bill: only with her agreement and the switch on; the audit log has ids only', async () => {
    const p = await register();
    const b = (await (await as('reception')).post('/api/billing/bills').send({ patientId: p.id })).body.bill;
    const offer = async () => (await (await as('reception')).get(`/api/billing/bills/${b.id}/whatsapp`)).body;
    expect(await offer()).toMatchObject({ available: false, reason: 'switched_off' });
    await switches({ whatsappDocuments: true });
    expect(await offer()).toMatchObject({ available: false, reason: 'no_agreement' });
    await agree(p);
    expect(await offer()).toEqual({ available: true, reason: null, practice: true, label: '******3210' });
    const sent = await (await as('reception')).post(`/api/billing/bills/${b.id}/whatsapp`).send({ pdf: PDF });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(practiceSent().at(-1)).toMatchObject({ to: '+919876543210', fileName: `Bill-${b.number}.pdf`, hospital: 'Desk Hospital' });
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/whatsapp`).send({ pdf: Buffer.from('not a pdf'.repeat(20)).toString('base64') })).status).toBe(400);
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/whatsapp`).send({ pdf: PDF, receipt: 'R-999999' })).status).toBe(404);
    const entry = await AuditLog.findOne({ action: 'BILL_SENT_WHATSAPP' }).lean();
    expect(entry.details).toMatchObject({ billId: b.id, practice: true });
    expect(JSON.stringify(entry.details)).not.toMatch(/98765/);
  });

  it('the lab report: only once reviewed, never with the confidential test', async () => {
    await switches({ whatsappDocuments: true });
    const p = await register();
    await agree(p);
    let o = (await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'tsh' }] })).body.order;
    const url = `/api/lab/orders/${o.id}/whatsapp`;
    o = (await (await as('lab')).put(`/api/lab/orders/${o.id}/results`).send({ rev: o.rev, tests: [{ key: 'tsh', values: [{ key: 'tsh', value: '2.1' }] }], report: true })).body.order;
    expect((await (await as('lab')).get(url)).body).toMatchObject({ available: false, reason: 'not_reviewed' });
    expect((await (await as('lab')).post(url).send({ pdf: PDF, confidential: false })).status).toBe(409);
    await (await as('drA')).post(`/api/lab/orders/${o.id}/review`).send({ rev: o.rev });
    expect((await (await as('lab')).get(url)).body.available).toBe(true);
    expect((await (await as('lab')).post(url).send({ pdf: PDF, confidential: true })).status).toBe(400);
    const ok = await (await as('lab')).post(url).send({ pdf: PDF, confidential: false });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(practiceSent().at(-1).fileName).toBe(`Lab-report-${o.sampleNo}.pdf`);
    expect((await AuditLog.findOne({ action: 'LAB_REPORT_SENT_WHATSAPP' }).lean()).details).toMatchObject({ orderId: o.id, practice: true });
  });
});

describe('the queue time when she arrives', () => {
  it('the estimate: one slot per patient before her, never before her booked time', () => {
    const waiting = [{ kind: 'token', token: 1 }, { kind: 'token', token: 2 }, { kind: 'slot', start: '11:30' }];
    expect(queueEstimate(waiting, 0, 630)).toEqual({ ahead: 0, eta: '10:30' });
    expect(queueEstimate(waiting, 1, 630)).toEqual({ ahead: 1, eta: '10:40' });
    expect(queueEstimate(waiting, 2, 630)).toEqual({ ahead: 2, eta: '11:30' });
  });

  it('a walk-in token: her token, how many before her and about when – only with the switch and her agreement', async () => {
    const first = await register({ fullName: 'First Patient', phone: '98765 00001' });
    const p = await register();
    const arrive = async (pt) => (await (await as('reception')).post('/api/arrivals').send({ patientId: pt.id, doctorId: people.drA._id.toString() })).body;
    expect((await arrive(first)).queueTime).toMatchObject({ sent: false, reason: 'switched_off' });
    await switches({ whatsappQueue: true });
    await agree(p, 'whatsapp', 'en');
    const res = await arrive(p);
    expect(res.queueTime).toEqual({ sent: true, practice: true, ahead: 1, eta: '10:40' });
    expect(practiceSent().at(-1)).toMatchObject({ to: '+919876543210', template: 'perinexa_update', params: ['Desk Hospital', 'Desk Hospital: your token is 2 with Sample drA. 1 patient is before you. Expected time about 10:40 AM – it may change a little.'] });
    const entry = await AuditLog.findOne({ action: 'QUEUE_TIME_SENT' }).lean();
    expect(entry.details).toMatchObject({ patientId: p.id, practice: true });
    // Without her agreement to WhatsApp: nothing
    const other = await register({ fullName: 'Third Patient', phone: '98765 00003' });
    await agree(other, 'sms');
    expect((await arrive(other)).queueTime).toMatchObject({ sent: false, reason: 'no_agreement' });
  });
});

describe('the daily cash handover', () => {
  async function takeCash(who, amountPaise, mode = 'cash') {
    const p = await register({ fullName: `Paying ${randomUUID().slice(0, 6)}`, phone: '' });
    const b = (await (await as(who)).post('/api/billing/bills').send({ patientId: p.id })).body.bill;
    const other = (await (await as(who)).get('/api/billing/prices')).body.items.find((i) => i.name === 'Other charge');
    await (await as(who)).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: amountPaise, name: 'Certificate' });
    const res = await (await as(who)).post(`/api/billing/bills/${b.id}/payments`).send({ mode, amountPaise });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  it('reception sees what it took, hands over (a difference needs a note); a doctor confirms; not their own', async () => {
    await takeCash('reception', 50000);
    await takeCash('reception', 20000, 'upi');
    await takeCash('reception2', 30000);
    const mine = (await (await as('reception')).get('/api/cash-handover')).body;
    expect(mine).toMatchObject({ date: '2026-10-17', canHandOver: true, canConfirm: false, handovers: [] });
    expect(mine.mine).toMatchObject({ cashPaise: 50000, payments: 2, handover: null });
    expect(mine.mine.byMode).toMatchObject({ cash: 50000, upi: 20000 });

    expect((await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 49000 })).body.error.fields).toHaveProperty('note');
    const handed = await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 49000, note: '₹10 change given from own pocket' });
    expect(handed.status, JSON.stringify(handed.body)).toBe(201);
    expect(handed.body.handover).toMatchObject({ userName: 'Sample reception', cashPaise: 50000, handedPaise: 49000, differencePaise: -1000, received: null });
    // handed over again (before it is confirmed): replaced
    const again = await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 50000 });
    expect(again.status).toBe(200);

    const doctorView = (await (await as('drA')).get('/api/cash-handover')).body;
    expect(doctorView).toMatchObject({ canConfirm: true, canHandOver: false, mine: null });
    expect(doctorView.handovers.map((h) => h.userName)).toEqual(['Sample reception']);
    expect((await (await as('drA')).get('/api/my-day')).body.day.cashToConfirm).toBe(1);
    const id = again.body.handover.id;
    expect((await (await as('reception')).post(`/api/cash-handover/${id}/confirm`).send({ receivedPaise: 50000 })).status).toBe(403);
    expect((await (await as('drA')).post(`/api/cash-handover/${id}/confirm`).send({ receivedPaise: 49500 })).body.error.fields).toHaveProperty('note');
    const ok = await (await as('drA')).post(`/api/cash-handover/${id}/confirm`).send({ receivedPaise: 50000 });
    expect(ok.body.handover.received).toMatchObject({ byName: 'Sample drA', receivedPaise: 50000, differencePaise: 0 });
    expect((await (await as('drA')).post(`/api/cash-handover/${id}/confirm`).send({ receivedPaise: 50000 })).status).toBe(409);
    expect((await (await as('reception')).post('/api/cash-handover').send({ handedPaise: 50000 })).status).toBe(409);
    expect((await (await as('lab')).get('/api/cash-handover')).status).toBe(200); // the lab takes walk-in payments too
    expect((await AuditLog.find({ action: /^CASH_/ }).sort({ _id: 1 }).lean()).map((e) => e.action)).toEqual(['CASH_HANDED_OVER', 'CASH_HANDED_OVER', 'CASH_HANDOVER_CONFIRMED']);
  });
});
