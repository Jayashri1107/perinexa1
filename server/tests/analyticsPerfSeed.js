// The fake hospitals of the Analytics performance test (analytics-perf.test.js, specification section 4.8).
// Fake data only: each hospital has 10,000 patients, 60,000 visits over 24 months and 3,000 care plans, made
// through the models. Kept apart from the test so the same hospitals can be seeded when a slow page is profiled.

import { randomUUID } from 'node:crypto';
import { addDays, hospitalToday, toHospitalDate } from '../src/careplans/dates.js';
import { planFacts } from '../src/careplans/planEngine.js';
import { createPlan } from '../src/careplans/plansService.js';
import { applyRisk, ensureStandardTemplates } from '../src/careplans/templatesService.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { BLOOD_GROUPS, CONDITIONS, NEWBORN_SEX, Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { PRESENTATIONS, URINE_GRADES } from '../src/visits/rxCodes.js';
import { addMember, createTenant, createUser } from './helpers.js';

export const PATIENTS = 10_000;
export const VISITS = 60_000;
export const PLANS = 3_000;
const DAY = 24 * 3600_000;

// A small seeded random generator, so every run seeds the same fake hospitals.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One fake hospital: 10,000 patients, 60,000 visits over 24 months, 3,000 care plans. */
export async function seedHospital(n, now) {
  const random = rng(1000 + n);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (a, b) => a + Math.floor(random() * (b - a + 1));
  const today = hospitalToday(now);
  const tenant = await createTenant(`Perf Sample Hospital ${n}`);
  await ensureStandardTemplates(tenant._id);
  const template = await CarePlanTemplate.findOne({ tenantId: tenant._id, careType: 'antenatal', kind: 'standard' });
  const drA = await createUser({ name: `Dr Perf A ${n}` });
  const drB = await createUser({ name: `Dr Perf B ${n}` });
  const admin = await createUser({ name: `Admin Perf ${n}` });
  await addMember(drA, tenant, 'doctor');
  await addMember(drB, tenant, 'doctor');
  await addMember(admin, tenant, 'admin');
  const doctors = [drA._id, drB._id];

  const docs = [];
  const antenatal = [];
  for (let i = 0; i < PATIENTS; i += 1) {
    const base = { tenantId: tenant._id, mrn: `P-${String(i + 1).padStart(6, '0')}`, fullName: `Sample Perf ${n}-${i + 1}`, createdBy: drA._id, assignedDoctor: random() < 0.9 ? pick(doctors) : null, sensitive: random() < 0.02 };
    let doc;
    if (i < 4000) {
      // Antenatal: EDDs from 10 weeks ago to 40 weeks ahead; one in ten without dates.
      const edd = addDays(today, between(-70, 280));
      const noDates = random() < 0.1;
      const createdAt = new Date(Math.min(now.getTime() - DAY, addDays(edd, -280 + between(20, 120)).getTime()));
      doc = new Patient({
        ...base,
        careType: 'antenatal',
        ageYears: between(16, 44),
        ageRecordedOn: createdAt,
        pregnancy: noDates ? {} : random() < 0.5 ? { scanEdd: edd, lmp: addDays(edd, -280 + between(-5, 5)) } : { lmp: addDays(edd, -280) },
        obstetric: { gravida: between(1, 6), para: between(0, 4), living: between(0, 4), abortions: between(0, 1), previousCaesareans: between(0, 2), complicationsReviewed: random() < 0.7 },
        medical: { allergies: 'None known', bloodGroup: random() < 0.9 ? pick(BLOOD_GROUPS) : '', heightCm: between(140, 175), weightKg: between(40, 95), conditions: random() < 0.2 ? [pick(CONDITIONS)] : [], conditionsReviewed: random() < 0.7 },
        createdAt,
      });
      await doc.validate(); // works out the EDD from the dates, as saving does
      applyRisk(doc, template, now);
      antenatal.push(doc);
    } else if (i < 8000) {
      const createdAt = new Date(now.getTime() - between(1, 730) * DAY);
      doc = new Patient({ ...base, careType: i < 5500 ? 'postnatal' : i < 7000 ? 'gynaecology' : 'infertility', ageYears: between(18, 50), ageRecordedOn: createdAt, createdAt });
    } else {
      // Babies born over the last 24 months; most linked to a mother.
      const birthAt = new Date(now.getTime() - between(1, 730) * DAY - between(0, 23) * 3600_000);
      doc = new Patient({
        ...base,
        careType: 'newborn',
        newborn: { birthAt, birthWeightGrams: random() < 0.9 ? between(1200, 4300) : null, sex: random() < 0.95 ? pick(NEWBORN_SEX) : '', mother: random() < 0.6 ? pick(antenatal)._id : null },
        createdAt: new Date(birthAt.getTime() + 3600_000),
      });
    }
    docs.push(doc);
  }
  for (let i = 0; i < docs.length; i += 2000) await Patient.insertMany(docs.slice(i, i + 2000));

  // Visits: 60,000 between each patient's registration and today, one in twenty entered in error.
  const visits = [];
  for (let i = 0; i < VISITS; i += 1) {
    const p = pick(docs);
    const from = toHospitalDate(p.createdAt);
    const span = Math.max(0, Math.round((today - from) / DAY));
    const visitOn = addDays(from, between(0, span));
    const pregnancy = p.careType === 'antenatal';
    visits.push({
      tenantId: tenant._id,
      patientId: p._id,
      visitOn,
      careType: p.careType,
      status: random() < 0.05 ? 'cancelled' : 'active',
      clientRequestId: randomUUID(),
      vitals: {
        weightKg: between(40, 95),
        bpSystolic: pregnancy ? between(95, 170) : null,
        bpDiastolic: pregnancy ? between(55, 115) : null,
        hb: pregnancy && random() < 0.5 ? between(60, 130) / 10 : null,
        urineAlbumin: pregnancy ? pick(URINE_GRADES) : '',
      },
      details: {
        fetalHeartRate: pregnancy ? between(120, 160) : null,
        fundalHeightCm: pregnancy ? between(12, 40) : null,
        presentation: pregnancy ? pick(PRESENTATIONS) : '',
        nextVisitOn: random() < 0.6 ? addDays(visitOn, between(7, 35)) : null,
      },
      createdBy: drA._id,
      createdByName: drA.name,
      createdAt: new Date(visitOn.getTime() + 5 * 3600_000),
    });
  }
  for (let i = 0; i < visits.length; i += 5000) await Visit.insertMany(visits.slice(i, i + 5000));

  // Care plans: 3,000, built by the app's own code from the standard template, booked on the registration day.
  const withDates = antenatal.filter((p) => p.pregnancy?.effectiveEdd);
  const ctx = { tenantId: tenant._id, now, req: null, user: null };
  for (const p of withDates.slice(0, PLANS)) await createPlan(ctx, p, { facts: planFacts(p, now), bookedOn: toHospitalDate(p.createdAt) });

  return { tenant, drA, admin };
}
