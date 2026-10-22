// Lists as Excel-ready CSV files (21 Oct 2026, routes/exports.js): a doctor exports their OWN patients, appointments,
// stays, lab orders (HIV under its neutral name, no results), scans (no report) and referrals. A pure hospital admin sees
// no patient data, so has no export; nor has a platform user who opened the hospital. Every export is audited.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ImagingOrder } from '../src/models/ImagingOrder.js';
import { Referral } from '../src/models/Referral.js';
import { ReferringDoctor } from '../src/models/ReferringDoctor.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const today = () => new Date(`${iso(new Date())}T00:00:00Z`);
const range = (days = 1) => `from=${iso(new Date(today() - days * DAY))}&to=${iso(new Date(+today() + days * DAY))}`;
const lines = (res) => res.text.replace(/^﻿/, '').trim().split('\r\n');

async function hospital() {
  const home = await createTenant('Export Hospital');
  const drA = await createUser({ name: 'Dr Asha Export' });
  const drB = await createUser({ name: 'Dr Bina Other' });
  await addMember(drA, home, 'doctor');
  await addMember(drB, home, 'doctor');
  const a = await loginAs(drA);
  const b = await loginAs(drB);
  const register = async (s, doctor, name) => {
    const res = await s.post('/api/patients').send(samplePatient({ fullName: name, phone: '+91 00000 00042', assignedDoctor: String(doctor._id) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.patient;
  };
  const mine = await register(a, drA, 'meera mine');
  const formula = await register(a, drA, '=hyperlink sample');
  const theirs = await register(b, drB, 'tara theirs');
  return { home, drA, drB, a, b, mine, formula, theirs };
}

describe('a doctor exports their own patients', () => {
  it('patients: only her own, as a CSV file with capitals, formulas neutralised, and in the audit log', async () => {
    const { a, mine } = await hospital();
    const res = await a.get('/api/exports/patients');
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="perinexa-patients.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = lines(res);
    expect(rows[0]).toBe('Patient number,Name,Age,Phone,Type of care,Registered on,Last visit,Record');
    expect(rows).toHaveLength(3);
    // a phone starting with + gets an apostrophe: Excel would read it as a formula
    expect(rows.join('\n')).toContain(`${mine.mrn},Meera Mine,30,'+91 00000 00042,Gynaecology,${iso(new Date())},,Open`);
    expect(rows.join('\n')).toContain(",'=hyperlink Sample,"); // a name that starts like a formula never runs in Excel
    expect(rows.join('\n')).not.toContain('Tara Theirs');
    const entry = await AuditLog.findOne({ action: 'LIST_EXPORTED' }).lean();
    expect(entry.details).toMatchObject({ what: 'patients', rows: 2, own: true });
    expect(JSON.stringify(entry.details)).not.toMatch(/Meera/);
  });

  it('appointments, stays, lab orders, scans and referrals – her own, in the dates chosen', async () => {
    const { home, drA, drB, a, mine, theirs } = await hospital();
    const by = { by: drA._id, byName: 'Dr Asha Export', at: new Date() };
    // Appointments: hers today (one with a guest), another doctor's, and hers outside the dates
    await Appointment.create({ tenantId: home._id, patientId: mine.id, doctorId: drA._id, on: today(), kind: 'slot', start: '10:30', source: 'booked', created: by });
    await Appointment.create({ tenantId: home._id, guest: { name: 'Guest Woman', phone: '+91 00000 00099' }, doctorId: drA._id, on: today(), kind: 'token', token: 4, source: 'walk_in', created: by });
    await Appointment.create({ tenantId: home._id, patientId: theirs.id, doctorId: drB._id, on: today(), kind: 'slot', start: '11:00', source: 'booked', created: by });
    await Appointment.create({ tenantId: home._id, patientId: mine.id, doctorId: drA._id, on: new Date(+today() + 30 * DAY), kind: 'slot', start: '09:00', source: 'booked', created: by });
    let rows = lines(await a.get(`/api/exports/appointments?${range()}`));
    expect(rows[0]).toBe('Date,Time,Token,Patient number,Name,Phone,Visit type,Booked through,Status');
    expect(rows.slice(1).sort()).toEqual([`${iso(today())},,4,,Guest Woman,'+91 00000 00099,Follow-up,Walk-in,Booked`, `${iso(today())},10:30,,${mine.mrn},Meera Mine,'+91 00000 00042,Follow-up,Booked,Booked`]);

    // Stays
    await Admission.create({ tenantId: home._id, patientId: mine.id, careType: 'gynaecology', admittedAt: new Date(), ward: 'Ward A', bed: 'A-1', ipdNo: 'IP-2026-000001', admittedBy: drA._id, admittedByName: 'Dr Asha Export', clientRequestId: randomUUID() });
    await Admission.create({ tenantId: home._id, patientId: theirs.id, careType: 'gynaecology', admittedAt: new Date(), ward: 'Ward B', bed: 'B-1', admittedBy: drB._id, admittedByName: 'Dr Bina Other', clientRequestId: randomUUID() });
    rows = lines(await a.get(`/api/exports/admissions?${range()}`));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatch(new RegExp(`^IP-2026-000001,${mine.mrn},Meera Mine,Gynaecology,${iso(new Date())},,Ward A,A-1,Admitted,,1$`));

    // Lab: HIV only under its neutral name, never a result
    const order = await a.post(`/api/patients/${mine.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'cbc' }, { key: 'hiv' }] });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const lab = await a.get(`/api/exports/lab?${range()}`);
    rows = lines(lab);
    expect(rows[0]).toBe('Ordered on,Sample number,Patient number,Name,Tests,Urgent,Status,Ordered by');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Lab test (confidential)');
    expect(lab.text).not.toMatch(/HIV/i);

    // Scans: the study and the status, never the report
    await ImagingOrder.create({ tenantId: home._id, patientId: mine.id, study: 'usg_early', ordered: by, clientRequestId: randomUUID(), report: { findings: 'SECRET-FINDINGS' } }).catch(async () =>
      ImagingOrder.create({ tenantId: home._id, patientId: mine.id, study: 'usg_early', ordered: by, clientRequestId: randomUUID() }),
    );
    await ImagingOrder.create({ tenantId: home._id, patientId: theirs.id, study: 'usg_early', ordered: { ...by, by: drB._id }, clientRequestId: randomUUID() });
    const scans = await a.get(`/api/exports/scans?${range()}`);
    rows = lines(scans);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatch(/Meera Mine,USG – early pregnancy \(dating and viability\),No,,Ordered,Dr Asha Export,$/);
    expect(scans.text).not.toContain('SECRET-FINDINGS');

    // Referrals: those where she is the consultant
    const rd = await ReferringDoctor.create({ tenantId: home._id, name: 'Dr Ravi Referrer', nameKey: 'dr ravi referrer', created: by });
    const ref = (consultantId, number, extra) => Referral.create({ tenantId: home._id, number, centre: 'main', receivedAt: new Date(), via: 'call', urgency: 'routine', referringDoctorId: rd._id, consultantId, clientRequestId: randomUUID(), created: by, ...extra });
    await ref(drA._id, 'REF-000001', { guest: { name: 'Guest Referred', phone: '' } });
    await ref(drB._id, 'REF-000002', { patientId: theirs.id });
    rows = lines(await a.get(`/api/exports/referrals?${range()}`));
    expect(rows.slice(1)).toEqual([`REF-000001,${iso(new Date())},Dr Ravi Referrer,,Guest Referred,Routine,Open`]);

    expect((await AuditLog.find({ action: 'LIST_EXPORTED' }).lean()).map((e) => [e.details.what, e.details.rows])).toEqual([
      ['appointments', 2],
      ['admissions', 1],
      ['lab', 1],
      ['scans', 1],
      ['referrals', 1],
    ]);
  });
});

describe('who may export, and the dates', () => {
  it('a pure hospital admin, reception and a super admin who opened the hospital have no patient export; an admin who is also a doctor has hers', async () => {
    const { home } = await hospital();
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    const reception = await createUser();
    await addMember(reception, home, 'receptionist');
    for (const who of [admin, reception]) {
      const res = await (await loginAs(who)).get('/api/exports/patients');
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Exports are for doctors/);
    }
    const sa = await loginAs(await createSuperAdmin());
    const opened = await sa.post('/api/auth/open-hospital').send({ tenantId: home._id.toString() });
    sa.activeTenantId = opened.body.activeTenantId;
    expect((await sa.get('/api/exports/patients')).status).toBe(403);

    const both = await createUser();
    await addMember(both, home, 'admin', { roles: ['admin', 'doctor'] });
    const res = await (await loginAs(both)).get('/api/exports/patients');
    expect(res.status).toBe(200);
    expect(lines(res)).toHaveLength(1); // no patients of her own yet
  });

  it('asks for the dates of a dated list, at most a year, the end not before the start', async () => {
    const { a } = await hospital();
    expect((await a.get('/api/exports/appointments')).status).toBe(400);
    expect((await a.get('/api/exports/appointments?from=2026-10-10&to=2026-10-01')).body.error.fields.to).toMatch(/before the start/);
    expect((await a.get('/api/exports/appointments?from=2025-01-01&to=2026-10-01')).body.error.fields.to).toMatch(/At most 366 days/);
    expect((await a.get('/api/exports/everything')).status).toBe(404);
    const dated = await a.get('/api/exports/patients?from=2026-01-01&to=2026-12-31');
    expect(dated.headers['content-disposition']).toBe('attachment; filename="perinexa-patients-2026-01-01-to-2026-12-31.csv"');
  });
});
