// Feature 3: OBGY patient registration and assignment to a doctor.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { addDays, hospitalToday } from '../src/careplans/dates.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const app = createApp();
const DAY = 24 * 3600 * 1000;
const isoDate = (d) => d.toISOString().slice(0, 10);
// Pregnancy dates are counted from the hospital's date (India, UTC+5:30), so tests use it too – the UTC date
// is a day behind between 18:30 and 24:00 UTC.
const daysFromToday = (n) => addDays(hospitalToday(), n);
let home;
let other;
let doctor;
let reception;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  home = await createTenant('Home Hospital');
  other = await createTenant('Other Hospital');
  doctor = await createUser({ name: 'Dr. Home' });
  await addMember(doctor, home, 'doctor');
  reception = await createUser({ name: 'Front Desk' });
  await addMember(reception, home, 'receptionist');
});
afterAll(disconnectTestDb);

describe('registering an antenatal patient', () => {
  it('works out EDD and weeks of pregnancy from the LMP', async () => {
    const s = await loginAs(doctor, { app });
    const lmp = daysFromToday(-70); // 10 weeks ago
    const res = await s.post('/api/patients').send(
      samplePatient({
        careType: 'antenatal',
        fullName: 'Asha Sample',
        ageYears: 28,
        pregnancy: { lmp: isoDate(lmp) },
        obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 1 },
        medical: { allergies: 'None known', bloodGroup: 'O-', heightCm: 158, weightKg: 60, conditions: ['thyroid'] },
        assignedDoctor: doctor._id.toString(),
      }),
    );
    expect(res.status).toBe(201);
    const p = res.body.patient;
    expect(p.mrn).toBe('P-000001');
    expect(p.currentAge).toBe(28);
    expect(p.gestationalAge.weeks).toBe(10);
    expect(isoDate(new Date(p.pregnancy.edd))).toBe(isoDate(new Date(new Date(`${isoDate(lmp)}T00:00:00Z`).getTime() + 280 * DAY)));
    expect(p.pregnancy.effectiveEdd).toBe(p.pregnancy.edd);
    expect(p.assignedDoctorName).toBe('Dr. Home');
    const entry = await AuditLog.findOne({ action: 'PATIENT_CREATED' });
    expect(JSON.stringify(entry.details)).not.toMatch(/Asha/);
  });

  it('uses the dating-scan EDD when given', async () => {
    const s = await loginAs(doctor, { app });
    const lmp = daysFromToday(-84);
    const scanEdd = daysFromToday(190);
    const res = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp: isoDate(lmp), scanEdd: isoDate(scanEdd) } }));
    expect(isoDate(new Date(res.body.patient.pregnancy.effectiveEdd))).toBe(isoDate(scanEdd));
    expect(res.body.patient.gestationalAge.weeks).toBe(12); // 280 - 190 = 90 days
  });

  it('checks the details make sense', async () => {
    const s = await loginAs(doctor, { app });
    const future = isoDate(new Date(Date.now() + 5 * DAY));
    const res = await s.post('/api/patients').send(
      samplePatient({
        careType: 'antenatal',
        ageYears: '',
        pregnancy: { lmp: future },
        obstetric: { gravida: 1, para: 1, abortions: 1, previousCaesareans: 2 },
        medical: { allergies: 'None known', bloodGroup: 'Z+' },
      }),
    );
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['ageYears', 'medical.bloodGroup', 'obstetric.gravida', 'obstetric.previousCaesareans', 'pregnancy.lmp']);
    const noDates = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: {} }));
    expect(noDates.body.error.fields).toHaveProperty(['pregnancy.lmp']);
  });

  it("accepts an LMP of today just after midnight in India (the hospital's date, not the UTC date)", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-12T19:00:00Z')); // 13 Oct 2026, 00:30 in India
      const s = await loginAs(doctor, { app });
      const res = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp: '2026-10-13' } }));
      expect(res.status).toBe(201);
      expect(res.body.patient.gestationalAge).toMatchObject({ weeks: 0, days: 0 });
      const tomorrow = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp: '2026-10-14' } }));
      expect(tomorrow.body.error.fields['pregnancy.lmp']).toBe('LMP cannot be in the future');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('registering in two steps (patient details, then clinical details)', () => {
  it('saves the patient details first; the pregnancy dates are required with the clinical details', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', assignedDoctor: doctor._id.toString() }));
    expect(res.status).toBe(201);
    const p = res.body.patient;
    expect(p.access.canEditClinical).toBe(true);
    expect(p.pregnancy.effectiveEdd).toBeNull();

    const noDates = await s.patch(`/api/patients/${p.id}`).send({ pregnancy: { lmp: '', scanEdd: '' }, medical: { allergies: 'None known', bloodGroup: 'B+' } });
    expect(noDates.status).toBe(400);
    expect(noDates.body.error.fields).toHaveProperty(['pregnancy.lmp']);

    const lmp = isoDate(daysFromToday(-70));
    const done = await s.patch(`/api/patients/${p.id}`).send({
      pregnancy: { lmp, scanEdd: '' },
      obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0 },
      medical: { allergies: 'None known', bloodGroup: 'B+', conditionsReviewed: true },
      notes: '',
    });
    expect(done.status).toBe(200);
    expect(done.body.patient.gestationalAge.weeks).toBe(10);
    expect(done.body.patient.medical.bloodGroup).toBe('B+');
  });

  it("a doctor who registers a patient for another doctor can't add the clinical details afterwards", async () => {
    const colleague = await createUser({ name: 'Dr. Colleague' });
    await addMember(colleague, home, 'doctor');
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', assignedDoctor: colleague._id.toString() }));
    expect(res.status).toBe(201);
    // The website reads this to skip the clinical-details step.
    expect(res.body.patient.access.canEditClinical).toBe(false);
    const lmp = isoDate(daysFromToday(-70));
    expect((await s.patch(`/api/patients/${res.body.patient.id}`).send({ pregnancy: { lmp } })).status).toBe(403);
  });
});

describe('empty fields', () => {
  it('blank numbers stay blank (not 0)', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send(
      samplePatient({ obstetric: { gravida: '', para: null, living: '', abortions: '', previousCaesareans: '' }, medical: { allergies: 'None known', heightCm: '', weightKg: null } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.patient.obstetric).toMatchObject({ gravida: null, para: null, living: null, abortions: null, previousCaesareans: null });
    expect(res.body.patient.medical).toMatchObject({ heightCm: null, weightKg: null });
    const noAge = await s.post('/api/patients').send(samplePatient({ ageYears: '' }));
    expect(noAge.body.error.fields.ageYears).toBe('Age is required');
  });
});

describe('registering a newborn', () => {
  it('links the baby to the mother', async () => {
    const s = await loginAs(doctor, { app });
    const mother = (await s.post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: 'Mother One' }))).body.patient;
    const birthAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const res = await s.post('/api/patients').send({
      careType: 'newborn',
      fullName: 'Baby of Mother One',
      newborn: { birthAt, birthWeightGrams: 3100, sex: 'female', mother: mother.id, fatherName: 'ravi sample' },
    });
    expect(res.status).toBe(201);
    expect(res.body.patient.newborn.fatherName).toBe('Ravi Sample'); // the parents on her record (24 Oct 2026)
    expect(res.body.patient.motherInfo).toMatchObject({ fullName: 'Mother One', mrn: mother.mrn });
    expect(res.body.patient.ageYears).toBeNull();
    const detail = await s.get(`/api/patients/${mother.id}`);
    expect(detail.body.patient.babies.map((b) => b.fullName)).toEqual(['Baby of Mother One']);
  });

  it('requires the time of birth and a mother from the same hospital', async () => {
    const s = await loginAs(doctor, { app });
    expect((await s.post('/api/patients').send({ careType: 'newborn', fullName: 'Baby', newborn: {} })).status).toBe(400);

    // mother from another hospital
    await addMember(doctor, other, 'doctor');
    await s.switchTo(other);
    const foreignMother = (await s.post('/api/patients').send(samplePatient({ fullName: 'Elsewhere' }))).body.patient;
    await s.switchTo(home);
    const res = await s.post('/api/patients').send({ careType: 'newborn', fullName: 'Baby', newborn: { birthAt: new Date().toISOString(), mother: foreignMother.id } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty(['newborn.mother']);
  });

  it("keeps birth details on the baby's own record only (PCPNDT)", async () => {
    const s = await loginAs(doctor, { app });
    const mother = (await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Mother Two', pregnancy: { lmp: isoDate(daysFromToday(-100)) } }))).body.patient;
    const birthAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const baby = (await s.post('/api/patients').send({ careType: 'newborn', fullName: 'Baby of Mother Two', newborn: { birthAt, sex: 'female', mother: mother.id } })).body.patient;

    // (a) Newborn details on a pregnancy's record – also from reception, who may edit newborn details.
    const onMother = await s.patch(`/api/patients/${mother.id}`).send({ newborn: { sex: 'male' } });
    expect(onMother.status).toBe(400);
    expect(onMother.body.error.message).toBe("Newborn details can only be added to a newborn's record.");
    const desk = await loginAs(reception, { app });
    expect((await desk.patch(`/api/patients/${mother.id}`).send({ newborn: { birthWeightGrams: 3000 } })).status).toBe(400);

    // (b) Changing the type of care to or from newborn.
    const message = "A newborn's record can't be changed to another type of care, or the other way round. Register the baby or the mother as a new patient.";
    const toNewborn = await s.patch(`/api/patients/${mother.id}`).send({ careType: 'newborn' });
    expect(toNewborn.status).toBe(400);
    expect(toNewborn.body.error.message).toBe(message);
    expect(toNewborn.body.error.fields).toEqual({ careType: message });
    const fromNewborn = await s.patch(`/api/patients/${baby.id}`).send({ careType: 'antenatal' });
    expect(fromNewborn.status).toBe(400);
    expect(fromNewborn.body.error.message).toBe(message);

    // (c) A birth time in the future, on edit as at registration.
    const future = await s.patch(`/api/patients/${baby.id}`).send({ newborn: { birthAt: new Date(Date.now() + 2 * DAY).toISOString() } });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual({ 'newborn.birthAt': 'Date of birth cannot be in the future' });

    // Nothing was saved, and no change was logged.
    const [m, b] = await Promise.all([s.get(`/api/patients/${mother.id}`), s.get(`/api/patients/${baby.id}`)]);
    expect(m.body.patient.careType).toBe('antenatal');
    expect(m.body.patient.newborn?.sex ?? '').toBe('');
    expect(b.body.patient.careType).toBe('newborn');
    expect(b.body.patient.newborn.birthAt).toBe(birthAt);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' })).toBe(0);

    // The normal edits still work: the baby's own details, the same type sent again, and other type changes.
    const ok = await s.patch(`/api/patients/${baby.id}`).send({ careType: 'newborn', newborn: { birthAt, birthWeightGrams: 2900, sex: 'female' } });
    expect(ok.status).toBe(200);
    expect(ok.body.patient.newborn.birthWeightGrams).toBe(2900);
    expect((await s.patch(`/api/patients/${mother.id}`).send({ careType: 'postnatal' })).status).toBe(200);
  });

  it('has no fetal-sex field for pregnancies (PCPNDT)', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp: isoDate(new Date(Date.now() - 60 * DAY)), fetalSex: 'male' } }));
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/fetalSex/);
  });
});

describe('assigning a doctor', () => {
  it('only allows doctors of this hospital', async () => {
    const s = await loginAs(reception, { app });
    const p = (await s.post('/api/patients').send(samplePatient())).body.patient;
    expect((await s.patch(`/api/patients/${p.id}/doctor`).send({ doctorId: reception._id.toString() })).status).toBe(400);

    const outsider = await createUser();
    await addMember(outsider, other, 'doctor');
    expect((await s.patch(`/api/patients/${p.id}/doctor`).send({ doctorId: outsider._id.toString() })).status).toBe(400);

    const ok = await s.patch(`/api/patients/${p.id}/doctor`).send({ doctorId: doctor._id.toString() });
    expect(ok.body.patient.assignedDoctorName).toBe('Dr. Home');
    expect(await AuditLog.countDocuments({ action: 'PATIENT_ASSIGNED' })).toBe(1);
  });

  it('lists the hospital doctors and filters "my patients"', async () => {
    const r = await loginAs(reception, { app });
    const docs = await r.get('/api/tenant/doctors');
    expect(docs.body.doctors.map((d) => d.name)).toEqual(['Dr. Home']);
    await r.post('/api/patients').send(samplePatient({ fullName: 'Mine', assignedDoctor: doctor._id.toString() }));
    await r.post('/api/patients').send(samplePatient({ fullName: 'Nobody' }));
    const d = await loginAs(doctor, { app });
    expect((await d.get('/api/patients?doctor=me')).body.patients.map((p) => p.fullName)).toEqual(['Mine']);
    expect((await d.get('/api/patients?doctor=unassigned')).body.patients.map((p) => p.fullName)).toEqual(['Nobody']);
    expect((await d.get('/api/patients?doctor=all')).body.total).toBe(2);
  });
});

describe('editing', () => {
  it('updates sections and audits which fields changed (not their values)', async () => {
    const s = await loginAs(doctor, { app });
    const p = (
      await s.post('/api/patients').send(
        samplePatient({ careType: 'antenatal', pregnancy: { lmp: isoDate(new Date(Date.now() - 50 * DAY)) }, medical: { heightCm: 160, allergies: 'Penicillin' } }),
      )
    ).body.patient;
    const res = await s.patch(`/api/patients/${p.id}`).send({ phone: '+91 11111 11111', medical: { bloodGroup: 'A+' } });
    expect(res.status).toBe(200);
    expect(res.body.patient.medical.bloodGroup).toBe('A+');
    const entry = await AuditLog.findOne({ action: 'PATIENT_UPDATED' });
    expect(entry.details.fields.sort()).toEqual(['medical.bloodGroup', 'phone']);
    // Fields that were not sent are left exactly as they were.
    expect(res.body.patient.address).toBe('1 Sample Road');
    expect(res.body.patient.pregnancy.lmp).toBe(p.pregnancy.lmp);
    expect(res.body.patient.medical).toMatchObject({ heightCm: 160, allergies: 'Penicillin' });
    expect(JSON.stringify(entry.details)).not.toMatch(/11111/);
  });

  it('lab staff register walk-in patients (identity only, owner 17 Oct 2026); admin-only accounts cannot', async () => {
    const lab = await createUser();
    await addMember(lab, home, 'lab');
    const l = await loginAs(lab, { app });
    const walkIn = await l.post('/api/patients').send(samplePatient({ fullName: 'Walk In Patient' }));
    expect(walkIn.status, JSON.stringify(walkIn.body)).toBe(201);
    expect(walkIn.body.patient.fullName).toBe('Walk In Patient');
    expect(walkIn.body.patient.risk).toBeUndefined();
    const admin = await createUser();
    await addMember(admin, home, 'admin');
    const a = await loginAs(admin, { app });
    expect((await a.post('/api/patients').send(samplePatient())).status).toBe(403);
  });
});

describe('allergies must be answered', () => {
  it('refuses saving the medical background with the allergy question unanswered; "None known" is an answer', async () => {
    const s = await loginAs(doctor, { app });
    const p = (await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', pregnancy: { lmp: isoDate(new Date(Date.now() - 50 * DAY)) } }))).body.patient;
    const blank = await s.patch(`/api/patients/${p.id}`).send({ medical: { bloodGroup: 'A+', allergies: '' } });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fields['medical.allergies']).toMatch(/allergy question/);
    expect((await s.patch(`/api/patients/${p.id}`).send({ medical: { bloodGroup: 'A+' } })).status).toBe(400); // still never asked
    expect((await s.patch(`/api/patients/${p.id}`).send({ phone: '+91 22222 22222' })).status).toBe(200); // other details: no question
    const ok = await s.patch(`/api/patients/${p.id}`).send({ medical: { bloodGroup: 'A+', allergies: 'None known' } });
    expect(ok.status).toBe(200);
  });
});
