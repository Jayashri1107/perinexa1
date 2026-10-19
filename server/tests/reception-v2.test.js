// Reception like a hospital system (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): slots kept for walk-ins (never
// offered online), the doctor marking a checkup done, notifications (the bell), and the charges a hospital system bills
// by itself – registration, admission, nursing per day, the doctor's ward round, scans – with the doctor's name on each
// line. All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { freeStarts } from '../src/appointments/appointmentService.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { Admission } from '../src/models/Admission.js';
import { Bill } from '../src/models/Bill.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-09-28T04:00:00Z'); // Monday 28 Sep 2026, 09:30 in the hospital (India)
const ROLES = { drA: 'doctor', reception: 'receptionist', reception2: 'receptionist', admin: 'admin', nurse: 'nurse', lab: 'lab' };
const WEEKDAYS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '11:00' }] })); // 6 slots of 10 min
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
  hospital = await createTenant('Desk Two Hospital');
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
const drId = () => people.drA._id.toString();
async function register(fullName = 'Desk Patient', extra = {}) {
  const res = await (await as('reception')).post('/api/patients').send(samplePatient({ fullName, assignedDoctor: drId(), ...extra }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
}
const bell = async (who) => (await (await as(who)).get('/api/notifications')).body;
const price = (key, pricePaise) => PriceItem.updateOne({ tenantId: hospital._id, key }, { $set: { pricePaise } });

describe('slots kept for walk-ins', () => {
  it('the last slots of each session are not offered online; reception sees and books them', async () => {
    const set = await (await as('drA')).put(`/api/appointments/timings/${drId()}`).send({ week: WEEKDAYS, leave: [], walkInSlots: 2 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.timings.walkInSlots).toBe(2);
    const tomorrow = new Date('2026-09-29T00:00:00Z');
    const online = await freeStarts(hospital._id, drId(), tomorrow, { now: NOW, online: true });
    const desk = await freeStarts(hospital._id, drId(), tomorrow, { now: NOW });
    expect(online).toEqual(['10:00', '10:10', '10:20', '10:30']);
    expect(desk).toEqual(['10:00', '10:10', '10:20', '10:30', '10:40', '10:50']);
    const day = (await (await as('reception')).get(`/api/appointments/day?doctorId=${drId()}&date=2026-09-29`)).body;
    expect(day.slots.filter((s) => s.walkIn).map((s) => s.start)).toEqual(['10:40', '10:50']);
    const p = await register();
    expect((await (await as('reception')).post('/api/appointments').send({ doctorId: drId(), date: '2026-09-29', start: '10:50', patientId: p.id, visitType: 'follow_up' })).status).toBe(201);
  });
});

describe('the doctor marks the checkup done; notifications', () => {
  it('a booking and an arrival tell the doctor; done tells reception and ends the wait', async () => {
    await (await as('drA')).put(`/api/appointments/timings/${drId()}`).send({ week: WEEKDAYS, leave: [] });
    const p = await register('Bell Patient');
    const booked = await (await as('reception')).post('/api/appointments').send({ doctorId: drId(), date: '2026-09-28', start: '10:00', patientId: p.id, visitType: 'follow_up' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    await (await as('reception')).post('/api/arrivals').send({ patientId: p.id });
    const forDoctor = await bell('drA');
    expect(forDoctor.unread).toBe(2);
    expect(forDoctor.notifications.map((n) => n.kind)).toEqual(['arrived', 'appointment']);
    expect(forDoctor.notifications[1].text).toBe('New appointment: Bell Patient, 2026-09-28 at 10:00.');
    expect((await bell('reception')).unread).toBe(0); // not told of what one did oneself

    const id = booked.body.appointment.id;
    expect((await (await as('reception')).post(`/api/appointments/${id}/done`)).status).toBe(403);
    const done = await (await as('drA')).post(`/api/appointments/${id}/done`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.appointment.status).toBe('seen');
    for (const who of ['reception', 'reception2']) expect((await bell(who)).notifications[0]).toMatchObject({ kind: 'done', text: 'Checkup done: Bell Patient (Sample drA).' });
    const queue = (await (await as('reception')).get('/api/appointments/queue')).body;
    expect(JSON.stringify(queue.queues?.[0]?.waiting ?? [])).not.toContain('Bell Patient');

    expect((await (await as('drA')).post('/api/notifications/read').send({})).body.read).toBe(2);

    // The lab is told of a new order: the number of tests, not their names
    const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] });
    expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
    expect((await bell('lab')).notifications[0]).toMatchObject({ kind: 'lab', text: 'New lab order: Bell Patient, 1 test.' });
    expect((await bell('drA')).unread).toBe(0);
  });
});

describe('the charges a hospital system bills', () => {
  it('registration (once priced), admission, nursing per day, the doctor visit, a scan – each line with its doctor', async () => {
    await (await as('admin')).get('/api/billing/prices'); // the price list with the new items
    const unpriced = await register('No Fee Patient');
    expect(await Bill.countDocuments({ tenantId: hospital._id, patientId: unpriced.id })).toBe(0); // ₹0: nothing billed
    await price('registration', 10000);
    await price('admission', 50000);
    await price('nursing', 30000);
    await price('ipd_round', 40000);
    await price('scan:usg_growth', 120000);
    const p = await register('Billed Patient', { careType: 'antenatal', pregnancy: undefined });
    const opd = await Bill.findOne({ tenantId: hospital._id, patientId: p.id, kind: 'opd' }).lean();
    expect(opd.lines.map((l) => [l.name, l.amountPaise])).toEqual([['Registration fee (new patient)', 10000]]);

    // A scan ordered by her doctor
    expect((await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study: 'usg_growth' })).status).toBe(201);
    const withScan = await Bill.findOne({ tenantId: hospital._id, patientId: p.id, kind: 'opd' }).lean();
    expect(withScan.lines.find((l) => l.ref?.kind === 'scan')).toMatchObject({ amountPaise: 120000 });

    // Admitted two days ago: admission charge and 3 days of nursing with the bed
    const stay = await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), admittedAt: '2026-09-26T05:00:00.000Z', reason: 'Observation (demo)' });
    expect(stay.status, JSON.stringify(stay.body)).toBe(201);
    const bills = (await (await as('reception')).get(`/api/billing/bills?patientId=${p.id}`)).body;
    const ipd = (bills.bills ?? bills).find?.((b) => b.kind === 'ipd') ?? null;
    const ipdBill = ipd ? (await (await as('reception')).get(`/api/billing/bills/${ipd.id}`)).body.bill : null;
    const lines = ipdBill ? ipdBill.lines : (await Bill.findOne({ tenantId: hospital._id, kind: 'ipd' }).lean()).lines;
    expect(lines.find((l) => l.name === 'Admission charge')).toMatchObject({ amountPaise: 50000 });
    const bedDays = lines.find((l) => (l.from ?? l.ref?.kind) === 'bed').qty;
    expect(bedDays).toBeGreaterThan(1);
    expect(lines.find((l) => l.name === 'Nursing charge per day')).toMatchObject({ qty: bedDays }); // the same days as the bed

    // A ward round signed by the doctor: a doctor visit with the doctor's name
    const admissionId = stay.body.admission.id;
    const doc = await (await as('drA')).post(`/api/patients/${p.id}/admissions/${admissionId}/documents`).send({ clientRequestId: randomUUID(), kind: 'round' });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    const docId = doc.body.document.id;
    const saved = await (await as('drA')).put(`/api/patients/${p.id}/admissions/${admissionId}/documents/${docId}`).send({ rev: doc.body.document.rev, content: { at: '2026-09-28T03:00:00.000Z', assessment: 'Stable (demo)' } });
    const rev = saved.body.document?.rev ?? doc.body.document.rev;
    const signed = await (await as('drA')).post(`/api/patients/${p.id}/admissions/${admissionId}/documents/${docId}/sign`).send({ rev });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    {
      const after = await Bill.findOne({ tenantId: hospital._id, kind: 'ipd', admissionId }).lean();
      expect(after.lines.find((l) => l.ref?.kind === 'round')).toMatchObject({ name: 'Doctor visit (ward round) – Sample drA', amountPaise: 40000 });
    }
    // The doctor's name on the bill's lines
    const view = (await (await as('reception')).get(`/api/billing/bills/${opd._id}`)).body.bill;
    expect(view.doctorName).toBe('Sample drA');
    expect(view.lines.find((l) => l.from === 'registration').doctorName).toBe('Sample drA');
    expect(await Admission.countDocuments({ tenantId: hospital._id })).toBe(1);
  });

  it('a line added by hand names its doctor', async () => {
    const p = await register('Hand Patient');
    const b = (await (await as('reception')).post('/api/billing/bills').send({ patientId: p.id })).body.bill;
    const other = (await (await as('reception')).get('/api/billing/prices')).body.items.find((i) => i.name === 'Emergency consultation');
    const added = await (await as('reception')).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 80000, doctorId: drId() });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.bill.lines.at(-1)).toMatchObject({ name: 'Emergency consultation', doctorName: 'Sample drA', amountPaise: 80000 });
    expect((await (await as('reception')).post(`/api/billing/bills/${b.id}/lines`).send({ priceItemId: other.id, ratePaise: 1000, doctorId: people.nurse._id.toString() })).status).toBe(400);
  });
});
