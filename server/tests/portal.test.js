// The patient portal (Version 2): off by default, a code from staff plus the last 4 digits of her mobile, only the
// next appointment and the care plan in plain words, locked after wrong tries, separate from staff sessions.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { Visit } from '../src/models/Visit.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00Z');
const ROLES = { drA: 'doctor', reception: 'receptionist', lab: 'lab', admin: 'admin' };
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
  hospital = await createTenant('Portal Hospital');
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
async function register(overrides = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: 'Portal Mother', phone: '98765 43210', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, medical: { allergies: 'Penicillin', bloodGroup: 'O-' }, notes: 'Sample private note', ...overrides }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const portalOn = async (on = true) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: on });
const makeCode = async (who, p) => (await as(who)).post(`/api/patients/${p.id}/portal-access`);
const signIn = (agent, code, digits) => agent.post('/api/portal/login').send({ code, digits });

describe('the patient portal', () => {
  it('is off until the hospital admin switches it on; staff (not the lab) make a code', async () => {
    const p = await register();
    expect((await makeCode('reception', p)).body.error.code).toBe('PORTAL_OFF');
    await portalOn();
    expect((await makeCode('lab', p)).status).toBe(403);
    const res = await makeCode('reception', p);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.body.active).toMatchObject({ createdByName: 'Sample reception' });
    const listed = (await (await as('drA')).get(`/api/patients/${p.id}/portal-access`)).body;
    expect(listed).toMatchObject({ enabled: true, hasMobile: true, active: { createdByName: 'Sample reception' } });
    expect(JSON.stringify(listed)).not.toContain(res.body.code.replace(/-/g, '')); // never shown again
  });

  it('she signs in with the code and her last 4 digits, and sees only her appointment and plan in plain words', async () => {
    const p = await register();
    await Visit.create({ tenantId: hospital._id, patientId: p.id, visitOn: new Date('2026-09-25T00:00:00Z'), careType: 'antenatal', clientRequestId: randomUUID(), details: { nextVisitOn: new Date('2026-10-09T00:00:00Z'), nextVisitNote: 'Sample private visit note' }, createdBy: people.drA._id, createdByName: 'Sample drA' });
    await portalOn();
    const { code } = (await makeCode('drA', p)).body;
    const agent = request.agent(app);
    expect((await agent.get('/api/portal/me')).status).toBe(401);
    expect((await signIn(agent, code, '0000')).status).toBe(401);
    expect((await signIn(agent, 'AAAA-BBBB-CCCC', '3210')).status).toBe(401);
    const ok = await signIn(agent, code.toLowerCase(), '3210');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const me = await agent.get('/api/portal/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ patient: { fullName: 'Portal Mother' }, appointment: '2026-10-09T00:00:00.000Z' });
    expect(me.body.plan.items.length).toBeGreaterThan(0);
    const text = JSON.stringify(me.body);
    for (const secret of ['Penicillin', 'O-', 'Sample private note', 'Sample private visit note', 'risk', p.mrn]) expect(text).not.toContain(secret);
    // The portal cookie is no staff session
    expect((await agent.get(`/api/patients/${p.id}`)).status).toBe(401);
    const actions = (await AuditLog.find({ action: /^PORTAL_/ }).sort({ _id: 1 }).lean()).map((e) => e.action);
    expect(actions).toEqual(['PORTAL_ACCESS_CREATED', 'PORTAL_LOGIN_FAILED', 'PORTAL_LOGIN_FAILED', 'PORTAL_LOGIN_SUCCESS', 'PORTAL_VIEWED']);
  });

  it('5 wrong tries lock the code; a new code or withdrawing stops the old one; switching the portal off ends it', async () => {
    const p = await register();
    await portalOn();
    const first = (await makeCode('drA', p)).body.code;
    const agent = request.agent(app);
    for (let i = 0; i < 5; i += 1) expect((await signIn(agent, first, '1111')).status).toBe(401);
    expect((await signIn(agent, first, '3210')).body.error.code).toBe('PORTAL_LOCKED');

    const second = (await makeCode('drA', p)).body.code;
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    sessions = {};
    expect((await signIn(agent, first, '3210')).status).toBe(401); // replaced
    expect((await signIn(agent, second, '3210')).status).toBe(200);
    expect((await agent.get('/api/portal/me')).status).toBe(200);
    await portalOn(false);
    expect((await agent.get('/api/portal/me')).status).toBe(401);
    await portalOn(true);
    await (await as('reception')).delete(`/api/patients/${p.id}/portal-access`);
    expect((await signIn(agent, second, '3210')).status).toBe(401);
  });
});

describe('the portal in Marathi or Hindi (5 Oct 2026)', () => {
  const consent = async (body) => (await as('reception')).put(`/api/patients/${p.id}/reminder-consent`).send(body);
  let p;

  it('opens in the language recorded for her messages, only while she agrees to messages', async () => {
    p = await register();
    await portalOn();
    const { code } = (await makeCode('drA', p)).body;
    const agent = request.agent(app);
    expect((await signIn(agent, code, '3210')).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body.language).toBeNull(); // nothing recorded: the portal opens in English
    expect((await consent({ consent: true, channel: 'sms', language: 'mr' })).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body.language).toBe('mr');
    expect((await consent({ consent: true, channel: 'whatsapp', language: 'hi' })).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body.language).toBe('hi');
    // "No automatic reminders": the language saved with it is not hers to go by
    expect((await consent({ consent: false, channel: 'sms', language: 'mr' })).status).toBe(200);
    expect((await agent.get('/api/portal/me')).body.language).toBeNull();
  });

  it('says which care-plan items are built in – never an item key, which can name a diagnosis', async () => {
    p = await register();
    // An item a doctor added with the very words of a built-in item: still shown as typed (in English)
    const added = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/items`).send({
      clientRequestId: randomUUID(),
      kind: 'investigation',
      name: 'Sample extra urine test',
      patientText: 'Urine test',
      // due from week 12: first in the list, which shows at most 12 items
      timing: { type: 'weeks', fromWeek: 12, toWeek: 19 },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    await portalOn();
    const { code } = (await makeCode('drA', p)).body;
    const agent = request.agent(app);
    expect((await signIn(agent, code, '3210')).status).toBe(200);
    const { plan } = (await agent.get('/api/portal/me')).body;
    expect(plan.items.length).toBeGreaterThan(1);
    for (const it of plan.items) expect(Object.keys(it).sort()).toEqual(['builtIn', 'by', 'from', 'kind', 'text']);
    expect(plan.items.filter((it) => !it.builtIn)).toEqual([expect.objectContaining({ kind: 'investigation', text: 'Urine test', builtIn: false })]);
    expect(plan.items.filter((it) => it.builtIn).length).toBeGreaterThan(0);
    expect(Object.keys(plan.nextVisit).sort()).toEqual(['builtIn', 'by', 'from', 'text']);
    expect(plan.nextVisit.builtIn).toBe(true);
    const text = JSON.stringify(plan);
    for (const key of ['"key"', 'visit_', 'scan_', 'lab_', 'vacc_', 'custom_', 'origin']) expect(text).not.toContain(key);
  });

  it('built in only while an item has its own built-in wording – the same rule as the printed patient copy', async () => {
    p = await register();
    const dr = await as('drA');
    // A doctor's own protocol, copied from the standard one: one item with the hospital's own code (its words are a
    // built-in item's words), one built-in item reworded to the words of another built-in item (infertility)
    const mine = (await dr.post('/api/care-plans/templates').send({ copyFrom: String((await CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'antenatal', kind: 'standard' }))._id) })).body.template;
    const t = await CarePlanTemplate.findOne({ _id: mine.id, tenantId: hospital._id });
    const items = t.items
      .map((i) => i.toObject())
      .map((i) => (i.key === 'lab_hiv' ? { ...i, key: 'sample_own_hiv' } : i.key === 'lab_tsh' ? { ...i, patientText: 'Blood tests on day 2–3 of the period' } : i));
    expect((await dr.put(`/api/care-plans/templates/${mine.id}`).send({ version: t.version, name: t.name, description: t.description, sources: t.sources, items })).status).toBe(200);
    const preview = await dr.get(`/api/patients/${p.id}/care-plan/template-preview?templateId=${mine.id}`);
    expect(preview.status).toBe(200);
    const put = await dr.put(`/api/patients/${p.id}/care-plan/template`).send({ templateId: mine.id, fromItemsHash: preview.body.from.itemsHash, toItemsHash: preview.body.to.itemsHash });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    await portalOn();
    const { code } = (await makeCode('drA', p)).body;
    const agent = request.agent(app);
    expect((await signIn(agent, code, '3210')).status).toBe(200);
    const { plan } = (await agent.get('/api/portal/me')).body;
    const byText = Object.fromEntries(plan.items.map((it) => [it.text, it.builtIn]));
    expect(byText).toMatchObject({ 'HIV test': false, 'Blood tests on day 2–3 of the period': false, 'Urine test': true, 'Blood group test': true });
    expect(JSON.stringify(plan)).not.toContain('sample_own');
  });
});

describe('booking her own appointment in the portal', () => {
  const WEEK = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '11:00' }] }));
  const settings = async (body) => (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: true, ...body });
  async function signedIn(p) {
    const { code } = (await makeCode('reception', p)).body;
    const agent = request.agent(app);
    expect((await signIn(agent, code, '3210')).status).toBe(200);
    return agent;
  }

  it('is off until the admin switches it on; then she books one free time with her own doctor and can cancel it', async () => {
    await settings({});
    await (await as('drA')).put(`/api/appointments/timings/${people.drA._id}`).send({ week: WEEK, leave: [] });
    const p = await register();
    const other = await register({ fullName: 'Someone Else', phone: '98111 11111' });
    const her = await signedIn(p);
    expect((await her.get('/api/portal/booking')).body).toMatchObject({ enabled: false, upcoming: null });
    expect((await her.post('/api/portal/booking').send({ date: '2026-10-05', start: '10:00' })).body.error.code).toBe('BOOKING_OFF');

    await settings({ portalBooking: true });
    expect((await her.get('/api/portal/booking')).body).toMatchObject({ enabled: true, doctorName: 'Sample drA', from: '2026-10-02', to: '2026-10-31' });
    // Reception booked someone else at 10:00 on Monday 5 Oct: she sees the free times only, never who has the others
    await (await as('reception')).post('/api/appointments').send({ doctorId: people.drA._id.toString(), date: '2026-10-05', start: '10:00', patientId: other.id });
    const times = await her.get('/api/portal/booking/times?date=2026-10-05');
    expect(times.body.times).toEqual(['10:10', '10:20', '10:30', '10:40', '10:50']);
    expect(JSON.stringify(times.body)).not.toContain('Someone Else');
    const taken = await her.post('/api/portal/booking').send({ date: '2026-10-05', start: '10:00' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).not.toContain('Someone Else');
    expect((await her.post('/api/portal/booking').send({ date: '2026-10-01', start: '10:10' })).status).toBe(400); // not today
    expect((await her.post('/api/portal/booking').send({ date: '2026-12-01', start: '10:10' })).status).toBe(400); // too far
    expect((await her.get('/api/portal/booking/times?date=2026-10-04')).body.times).toEqual([]); // Sunday: no OPD

    const booked = await her.post('/api/portal/booking').send({ date: '2026-10-05', start: '10:20' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    expect(booked.body.upcoming).toEqual({ date: '2026-10-05', start: '10:20', online: true, canCancel: true });
    expect((await her.post('/api/portal/booking').send({ date: '2026-10-06', start: '10:00' })).body.error.code).toBe('ALREADY_BOOKED'); // one at a time
    // Reception sees it on the doctor's day, marked as booked online
    const day = (await (await as('reception')).get(`/api/appointments/day?doctorId=${people.drA._id}&date=2026-10-05`)).body;
    expect(day.slots.find((s) => s.start === '10:20').appointments[0]).toMatchObject({ source: 'portal', bookedBy: 'Patient (online)', patient: { fullName: 'Portal Mother' } });

    expect((await her.post('/api/portal/booking/cancel')).status).toBe(200);
    expect((await her.get('/api/portal/booking')).body.upcoming).toBeNull();
    expect(await AuditLog.countDocuments({ action: { $in: ['PORTAL_APPOINTMENT_BOOKED', 'PORTAL_APPOINTMENT_CANCELLED'] }, actor: null })).toBe(2);
  });

  it("shows her doctor's leave in the booking days – dates only, never the doctor's note", async () => {
    await settings({ portalBooking: true });
    const leave = [
      { from: '2026-10-07', to: '2026-10-09', note: 'Family wedding' },
      { from: '2026-09-01', to: '2026-09-05', note: 'past' }, // before the booking days
    ];
    const set = await (await as('drA')).put(`/api/appointments/timings/${people.drA._id}`).send({ week: WEEK, leave });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const her = await signedIn(await register());
    const booking = (await her.get('/api/portal/booking')).body;
    expect(booking.leave).toEqual([{ from: '2026-10-07', to: '2026-10-09' }]);
    expect(JSON.stringify(booking)).not.toContain('wedding');
    expect((await her.get('/api/portal/booking/times?date=2026-10-08')).body).toEqual({ date: '2026-10-08', onLeave: true, times: [] });
    expect((await her.get('/api/portal/booking/times?date=2026-10-05')).body.onLeave).toBe(false);
  });

  it('a booking made by the hospital cannot be cancelled online; without a doctor or a session nothing is offered', async () => {
    await settings({ portalBooking: true });
    await (await as('drA')).put(`/api/appointments/timings/${people.drA._id}`).send({ week: WEEK, leave: [] });
    const p = await register();
    await (await as('reception')).post('/api/appointments').send({ doctorId: people.drA._id.toString(), date: '2026-10-06', start: '10:00', patientId: p.id });
    const her = await signedIn(p);
    expect((await her.get('/api/portal/booking')).body.upcoming).toEqual({ date: '2026-10-06', start: '10:00', online: false, canCancel: false });
    expect((await her.post('/api/portal/booking/cancel')).body.error.code).toBe('NOT_CANCELLABLE');
    expect((await request(app).get('/api/portal/booking')).status).toBe(401);
    expect((await request(app).post('/api/portal/booking').send({ date: '2026-10-05', start: '10:00' })).status).toBe(401);
    // Online booking needs the portal: switching the portal off switches booking off too
    const off = await (await as('admin')).put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: false, portalBooking: true });
    expect(off.body.settings).toMatchObject({ portalEnabled: false, portalBooking: false });
  });
});

describe('the waiting-room screen', () => {
  it('is off until the admin switches it on; it shows tokens and times only, never a name; a new address ends the old one', async () => {
    const admin = await as('admin');
    expect((await request(app).get(`/api/display/${'a'.repeat(32)}`)).status).toBe(404);
    const on = await admin.put('/api/reminders/settings').send({ remindersEnabled: false, portalEnabled: false, displayEnabled: true });
    expect(on.body.settings.displayEnabled).toBe(true);
    const key = on.body.displayKey;
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    // Staff who are not the admin never get the address
    expect((await (await as('reception')).get('/api/reminders/settings')).body.displayKey).toBeUndefined();

    const p = await register({ fullName: 'Waiting Mother' });
    const arrived = await (await as('reception')).post('/api/arrivals').send({ patientId: p.id, doctorId: people.drA._id.toString() });
    expect(arrived.status, JSON.stringify(arrived.body)).toBeLessThan(300);
    const screen = await request(app).get(`/api/display/${key}`);
    expect(screen.status).toBe(200);
    expect(screen.body).toMatchObject({ hospital: 'Portal Hospital', today: '2026-10-01' });
    expect(screen.body.doctors).toEqual([{ name: 'Sample drA', next: { kind: 'token', token: 1 }, then: [], waiting: 1 }]);
    expect(JSON.stringify(screen.body)).not.toMatch(/Waiting Mother|P-0|mrn|phone/);

    const renewed = await admin.post('/api/reminders/settings/display-link');
    expect(renewed.body.displayKey).not.toBe(key);
    expect((await request(app).get(`/api/display/${key}`)).status).toBe(404);
    expect((await request(app).get(`/api/display/${renewed.body.displayKey}`)).status).toBe(200);
    // Saving the other settings keeps the address; switching the screen off ends it
    const kept = await admin.put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: false, displayEnabled: true });
    expect(kept.body.displayKey).toBe(renewed.body.displayKey);
    await admin.put('/api/reminders/settings').send({ remindersEnabled: true, portalEnabled: false, displayEnabled: false });
    expect((await request(app).get(`/api/display/${renewed.body.displayKey}`)).status).toBe(404);
    expect((await (await as('reception')).post('/api/reminders/settings/display-link')).status).toBe(403);
  });
});
