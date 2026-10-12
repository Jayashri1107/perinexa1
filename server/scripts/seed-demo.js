// Creates FAKE demo data so you can try the app quickly: two hospitals, three staff accounts and a
// few made-up patients, with care plans for the demo pregnancies. All demo accounts use DEMO_PASSWORD from
// server/.env. Safe to run more than once: existing demo records are left as they are.
// All pregnancy dates are dates only (midnight UTC), counted from the hospital's today.
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { addDays, hospitalToday } from '../src/careplans/dates.js';
import { derivePlan, itemId, planFacts } from '../src/careplans/planEngine.js';
import { createPlan } from '../src/careplans/plansService.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { nextNumber } from '../src/models/Counter.js';
import { Membership } from '../src/models/Membership.js';
import { Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { hashPassword, passwordSchema } from '../src/utils/password.js';
import { refreshDueRisks } from '../src/careplans/templatesService.js';
import { Visit } from '../src/models/Visit.js';
import { randomUUID } from 'node:crypto';
import { Admission } from '../src/models/Admission.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { contentSchema } from '../src/inpatient/docSchemas.js';
import { NursingEntry } from '../src/models/NursingEntry.js';
import { OpdSchedule } from '../src/models/OpdSchedule.js';
import { convertNextVisits } from '../src/appointments/appointmentService.js';

const HOSPITALS = ['Sunrise General Hospital (Demo)', 'Lakeside Clinic (Demo)'];
const PEOPLE = [
  { name: 'Dana Demo-Admin', email: 'demo.admin@example.com', roles: { 0: ['admin'], 1: ['admin'] } },
  { name: 'Dr. Riley Demo', email: 'demo.doctor@example.com', roles: { 0: ['doctor'], 1: ['doctor'] } },
  { name: 'Nico Demo-Nurse', email: 'demo.nurse@example.com', roles: { 1: ['nurse'] } },
  { name: 'Dr. Sam Second (Demo)', email: 'demo.doctor2@example.com', roles: { 0: ['doctor'], 1: ['doctor'] } },
  { name: 'Rani Demo-RMO', email: 'demo.rmo@example.com', roles: { 0: ['rmo'], 1: ['rmo'] } },
  { name: 'Ravi Demo-Reception', email: 'demo.reception@example.com', roles: { 0: ['receptionist'], 1: ['receptionist'] } },
  { name: 'Lata Demo-Lab', email: 'demo.lab@example.com', roles: { 0: ['lab'], 1: ['lab'] } },
  // The pharmacy (stock, counter sales, registers) – added with the pharmacy
  { name: 'Pia Demo-Pharmacist', email: 'demo.pharmacist@example.com', roles: { 0: ['pharmacist'], 1: ['pharmacist'] } },
  // The billing department (bills, payments, billing reports) – added 7 Oct 2026
  { name: 'Bina Demo-Billing', email: 'demo.billing@example.com', roles: { 0: ['billing'], 1: ['billing'] } },
];
// Which demo doctor looks after which demo patient (by email)
const ASSIGN = { 'Asha Sample (Demo)': 'demo.doctor2@example.com', 'Meera Testcase (Demo)': 'demo.doctor@example.com' };
// Dates only (midnight UTC), counted from the hospital's today when the seed runs (not when this file is
// imported: tests pin the clock after importing it).
const weeksBefore = (today, w) => addDays(today, -7 * w);
const patientsFor = (today) => [
  [
    {
      careType: 'antenatal',
      fullName: 'Asha Sample (Demo)',
      ageYears: 27,
      phone: '+91 00000 00001',
      address: '1 Demo Street, Demo City',
      pregnancy: { lmp: weeksBefore(today, 12) },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 0, previousCaesareans: 0 },
      medical: { bloodGroup: 'B+', heightCm: 158, weightKg: 56, allergies: 'None known' },
    },
    {
      careType: 'antenatal',
      fullName: 'Meera Testcase (Demo)',
      ageYears: 36,
      phone: '+91 00000 00002',
      address: '2 Demo Street, Demo City',
      pregnancy: { lmp: weeksBefore(today, 26) },
      obstetric: { gravida: 3, para: 1, living: 1, abortions: 1, previousCaesareans: 1 },
      medical: { bloodGroup: 'O-', heightCm: 152, weightKg: 68, conditions: ['hypertension'], allergies: 'Penicillin – rash' },
    },
  ],
  [
    {
      careType: 'gynaecology',
      fullName: 'Kavya Fakename (Demo)',
      ageYears: 45,
      phone: '+91 00000 00003',
      address: '3 Demo Street, Demo City',
      medical: { bloodGroup: 'A+' },
    },
  ],
];

// Care plans for the demo pregnancies: the booking date (weeks ago) and the booking items already done,
// with made-up results. Nothing here is real patient information.
const PLANS = {
  'Asha Sample (Demo)': {
    bookedWeeksAgo: 4, // booked at 8 weeks
    done: [
      ['visit_booking'],
      ['lab_cbc', 'Hb 11.6 g/dL (fake sample result)'],
      ['lab_group', 'B positive (fake sample result)'],
      ['scan_dating', 'Single live intrauterine pregnancy, CRL matches dates (fake sample result)'],
      ['vacc_td1'],
    ],
  },
  'Meera Testcase (Demo)': {
    bookedWeeksAgo: 16, // booked at 10 weeks
    done: [
      ['visit_booking'],
      ['lab_cbc', 'Hb 10.4 g/dL (fake sample result)'],
      ['lab_group', 'O negative (fake sample result)'],
      ['lab_ict1', 'Negative (fake sample result)'],
      ['lab_hiv', 'Non-reactive (fake sample result)'],
      ['vacc_td1'],
    ],
  },
};

// Marks a plan item done the way a doctor's action would (history, rev), on the booking date.
function markDone(plan, key, { on, result = '', doctor, at }) {
  const it = plan.items.find((x) => x.key === key);
  if (!it || it.state !== 'open') return null;
  const by = { by: doctor._id, byName: doctor.name, at };
  it.state = 'done';
  it.done = { on, elsewhere: false, result, note: '', via: 'manual', visitId: null, ...by };
  it.rev = (it.rev ?? 0) + 1;
  it.revByName = doctor.name;
  it.revAt = at;
  it.history.push({ ...by, action: 'done', from: { state: 'open' }, to: { on }, reason: '' });
  return itemId(it);
}

async function seedPlan(tenantId, patient, spec, doctor, now) {
  if (await CarePlan.exists({ tenantId, patientId: patient._id })) return; // already has a plan
  const facts = planFacts(patient, now);
  if (!facts.edd) return;
  // No request here, so nothing is audited (the demo data is not anyone's action).
  const bookedOn = weeksBefore(hospitalToday(now), spec.bookedWeeksAgo);
  const plan = await createPlan({ req: null, tenantId, user: null, now }, patient, { facts, bookedOn });
  const on = plan.bookedOn;
  const changed = spec.done.map(([key, result]) => markDone(plan, key, { on, result, doctor, at: now })).filter(Boolean);
  derivePlan(plan, facts, { at: now, actorName: doctor.name, changedIds: new Set(changed) });
  await plan.save();
}

// Hospitals and staff accounts (existing ones are kept).
async function seedPeople(password) {
  const tenants = [];
  for (const name of HOSPITALS) {
    tenants.push((await Tenant.findOne({ nameKey: name.toLowerCase() })) ?? (await Tenant.create({ name })));
  }
  const passwordHash = await hashPassword(password);
  const users = [];
  for (const p of PEOPLE) {
    let user = await User.findOne({ email: p.email });
    if (!user) user = await User.create({ name: p.name, email: p.email, passwordHash, mustChangePassword: false });
    users.push(user);
    for (const [index, roles] of Object.entries(p.roles)) {
      const tenantId = tenants[index]._id;
      if (!(await Membership.exists({ tenantId, userId: user._id }))) {
        await Membership.create({ tenantId, userId: user._id, roles });
      }
    }
  }
  return { tenants, users };
}

// The made-up patients (existing ones are kept; a missing assigned doctor is filled in).
async function seedPatients(tenants, users, patients, now) {
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  for (const [index, list] of patients.entries()) {
    const tenantId = tenants[index]._id;
    for (const p of list) {
      const assignedDoctor = ASSIGN[p.fullName] ? userByEmail.get(ASSIGN[p.fullName])._id : null;
      const existing = await Patient.findOne({ tenantId, fullName: p.fullName });
      if (existing) {
        if (!existing.assignedDoctor && assignedDoctor) {
          existing.assignedDoctor = assignedDoctor;
          await existing.save();
        }
        continue;
      }
      const seq = await nextNumber(tenantId, 'patient');
      await Patient.create({
        ...p,
        ageRecordedOn: now,
        mrn: `P-${String(seq).padStart(6, '0')}`,
        tenantId,
        assignedDoctor,
        createdBy: users[0]._id,
      });
    }
  }
}

// ---------- Analytics demo set (Feature 11): about 60 more FAKE patients in the first demo hospital ----------
// Spread over the last 12 months so the Analytics page shows real-looking cards: pregnancies at every stage,
// visits with BP and Hb, care plans with items marked, postnatal, gynaecology and infertility care, babies (two
// pairs of twins) and one sensitive record of the second demo doctor. Every name ends in "(Demo)"; nothing here
// is real patient information. Made from a fixed seed, so every run makes the same kind of hospital.

const ANALYTICS_MARKER = 'Sample Mother 01 (Demo)';
const DAY_MS = 86_400_000;

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A moment on a hospital date (10:00 in India), for createdAt and times of birth. */
const at10 = (day) => new Date(day.getTime() + 4.5 * 3600_000);

async function nextMrn(tenantId) {
  return `P-${String(await nextNumber(tenantId, 'patient')).padStart(6, '0')}`;
}

// Marks the items of a plan that were due by today: most on time, some late, a few left open (overdue).
function markPlanItems(plan, facts, { rand, doctor, now, today }) {
  const changed = new Set();
  for (let round = 0; round < 2; round += 1) {
    for (const it of plan.items) {
      if (it.state !== 'open' || it.kind === 'advice' || !it.auto?.dueBy) continue;
      const dueBy = new Date(it.auto.dueBy);
      if (dueBy >= today) continue;
      const x = rand();
      if (x < 0.15) continue; // not marked: shows as overdue or missed
      let on = new Date(it.auto.dueFrom ?? dueBy);
      if (x > 0.85) on = new Date(dueBy.getTime() + Math.ceil(rand() * 20) * DAY_MS); // late
      if (on > today) on = today;
      const id = markDone(plan, it.key, { on, result: it.kind === 'investigation' ? 'Within normal limits (fake sample result)' : '', doctor, at: now });
      if (id) changed.add(id);
    }
    derivePlan(plan, facts, { at: now, actorName: doctor.name, changedIds: changed });
  }
}

/** The analytics demo patients of the first demo hospital (skipped when they are already there). */
async function seedAnalyticsSet(tenant, users, now) {
  const tenantId = tenant._id;
  if (await Patient.exists({ tenantId, fullName: ANALYTICS_MARKER })) return;
  const rand = seededRandom(20261015);
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (xs) => xs[int(0, xs.length - 1)];
  const today = hospitalToday(now);
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const doctor1 = byEmail.get('demo.doctor@example.com');
  const doctor2 = byEmail.get('demo.doctor2@example.com');
  const reception = byEmail.get('demo.reception@example.com');
  const doctorFor = () => pick([doctor1, doctor1, doctor2, doctor2, null]);
  let visitNo = 0;
  const visits = [];
  const addVisit = (p, on, careType, doc, extra = {}) => {
    if (on > today || on < new Date(p.createdAt.getTime() - DAY_MS)) return;
    visitNo += 1;
    const by = doc ?? doctor1;
    visits.push({
      tenantId,
      patientId: p._id,
      visitOn: on,
      careType,
      clientRequestId: `demo-analytics-${visitNo}`,
      createdBy: by._id,
      createdByName: by.name,
      createdAt: at10(on),
      ...extra,
    });
  };
  const create = async (fields) => {
    const createdAt = fields.createdAt;
    const p = await Patient.create({ ...fields, tenantId, mrn: await nextMrn(tenantId), ageRecordedOn: createdAt, createdBy: (fields.createdBy ?? users[0])._id });
    return p;
  };

  // Antenatal: 32 women at every stage (a few past their dates, one far past them, two with no dates yet).
  const mothers = [];
  for (let i = 1; i <= 32; i += 1) {
    const name = `Sample Mother ${String(i).padStart(2, '0')} (Demo)`;
    let gaDays = int(35, 285);
    if (i === 30) gaDays = 290; // past the due date
    if (i === 31) gaDays = 300; // well past the due date – still recorded as pregnant ("Records to tidy up")
    const noDates = i === 32 || i === 29;
    const lmp = addDays(today, -gaDays);
    const registeredDay = noDates ? addDays(today, -int(2, 40)) : addDays(lmp, Math.min(gaDays - 1, int(42, 150)));
    const doc = i === 12 ? doctor2 : doctorFor();
    const p = await create({
      careType: 'antenatal',
      fullName: name,
      ageYears: pick([17, 19, 22, 24, 25, 27, 28, 29, 30, 31, 33, 34, 36, 38]),
      phone: `+91 00000 1${String(i).padStart(4, '0')}`,
      pregnancy: noDates ? {} : { lmp, ...(rand() < 0.4 ? { scanEdd: addDays(lmp, 280 + int(-5, 5)) } : {}) },
      obstetric: (() => {
        const g = pick([1, 1, 1, 2, 2, 3, 4, 5]);
        const para = Math.max(0, g - 1 - (rand() < 0.2 ? 1 : 0));
        return { gravida: g, para, living: para, abortions: g - 1 - para, previousCaesareans: g === 1 ? 0 : pick([0, 0, 0, 1, 2]) };
      })(),
      medical: {
        bloodGroup: pick(['O+', 'B+', 'A+', 'O+', 'B+', 'AB+', 'O-', 'A-', '']),
        heightCm: int(145, 168),
        weightKg: int(45, 82),
        conditions: rand() < 0.2 ? [pick(['diabetes', 'hypertension', 'thyroid', 'anaemia'])] : [],
        conditionsReviewed: rand() < 0.7,
      },
      assignedDoctor: doc?._id ?? null,
      sensitive: i === 12, // the one sensitive record, of the second demo doctor
      createdAt: at10(registeredDay),
      createdBy: noDates ? reception : users[0],
    });
    mothers.push(p);
    if (noDates) continue;
    // Visits about every 4 weeks (2 weeks from 28 weeks), from registration to today; a few women stop coming.
    const stopEarly = rand() < 0.15;
    let day = registeredDay;
    while (day <= today) {
      const ga = Math.round((day - lmp) / DAY_MS);
      const next = addDays(day, ga >= 196 ? 14 : 28);
      const high = rand() < 0.12;
      addVisit(p, day, 'antenatal', doc, {
        vitals: {
          bpSystolic: high ? int(140, 165) : int(100, 134),
          bpDiastolic: high ? int(90, 110) : int(60, 86),
          weightKg: int(48, 85),
          hb: rand() < 0.7 ? int(68, 128) / 10 : null,
          urineAlbumin: pick(['nil', 'nil', 'nil', 'trace', '1+', '']),
        },
        details: {
          ...(ga >= 140 ? { fetalHeartRate: int(128, 156), fundalHeightCm: Math.max(12, Math.round(ga / 7) + int(-2, 2)) } : {}),
          ...(ga >= 252 ? { presentation: pick(['cephalic', 'cephalic', 'cephalic', 'breech', '']) } : {}),
          nextVisitOn: next,
        },
      });
      if (stopEarly && day > addDays(registeredDay, 40)) break;
      day = next;
    }
  }

  // One visit entered in error.
  addVisit(mothers[0], addDays(today, -3), 'antenatal', doctor1, { status: 'cancelled', cancelled: { reason: 'Entered for the wrong patient (demo)', by: doctor1._id, byName: doctor1.name, at: now } });

  // Postnatal: 8 mothers who delivered in the last year (their babies follow), seen after the birth.
  const postnatal = [];
  for (let i = 1; i <= 8; i += 1) {
    const birthDay = addDays(today, -int(10, 340));
    const lmp = addDays(birthDay, -int(252, 285));
    const doc = doctorFor();
    const p = await create({
      careType: 'postnatal',
      fullName: `Sample Postnatal ${String(i).padStart(2, '0')} (Demo)`,
      ageYears: int(20, 36),
      phone: `+91 00000 2${String(i).padStart(4, '0')}`,
      pregnancy: { lmp },
      obstetric: { gravida: pick([1, 2, 3]), para: 1, living: 1, abortions: 0, previousCaesareans: pick([0, 0, 1]) },
      medical: { bloodGroup: pick(['O+', 'B+', 'A+']), heightCm: int(148, 165), weightKg: int(50, 75), conditionsReviewed: true },
      assignedDoctor: doc?._id ?? null,
      createdAt: at10(addDays(birthDay, -int(1, 3))),
    });
    addVisit(p, addDays(birthDay, 7), 'postnatal', doc, { vitals: { bpSystolic: int(105, 130), bpDiastolic: int(65, 85), hb: int(92, 118) / 10 } });
    addVisit(p, addDays(birthDay, 42), 'postnatal', doc, { vitals: { bpSystolic: int(105, 125), bpDiastolic: int(65, 80) } });
    postnatal.push({ p, birthDay, doc });
  }

  // Gynaecology and infertility (infertility records are sensitive, as the app marks them).
  for (let i = 1; i <= 5; i += 1) {
    const day = addDays(today, -int(5, 350));
    const p = await create({ careType: 'gynaecology', fullName: `Sample Gynae ${String(i).padStart(2, '0')} (Demo)`, ageYears: int(28, 55), phone: `+91 00000 3${String(i).padStart(4, '0')}`, medical: { bloodGroup: pick(['O+', 'B+']) }, assignedDoctor: doctorFor()?._id ?? null, createdAt: at10(day) });
    addVisit(p, day, 'gynaecology', doctor1, { vitals: { bpSystolic: int(110, 140), bpDiastolic: int(70, 90) } });
    if (rand() < 0.5) addVisit(p, addDays(day, int(14, 60)), 'gynaecology', doctor1, {});
  }
  for (let i = 1; i <= 4; i += 1) {
    const day = addDays(today, -int(5, 300));
    const doc = i === 1 ? doctor2 : doctor1;
    const p = await create({ careType: 'infertility', fullName: `Sample Fertility ${String(i).padStart(2, '0')} (Demo)`, ageYears: int(26, 38), phone: `+91 00000 4${String(i).padStart(4, '0')}`, sensitive: true, assignedDoctor: doc._id, createdAt: at10(day) });
    addVisit(p, day, 'infertility', doc, {});
    addVisit(p, addDays(day, int(20, 50)), 'infertility', doc, {});
  }

  // Babies: one for each postnatal mother (two of them twins), and some registered with no mother linked.
  let babyNo = 0;
  const baby = async ({ mother, birthAt, doc, grams }) => {
    babyNo += 1;
    return create({
      careType: 'newborn',
      fullName: `Sample Baby ${String(babyNo).padStart(2, '0')} (Demo)`,
      newborn: { birthAt, birthWeightGrams: grams, sex: pick(['female', 'male', 'female', 'male', '']), mother: mother?._id ?? null },
      assignedDoctor: doc?._id ?? null,
      createdAt: new Date(birthAt.getTime() + 3600_000),
    });
  };
  for (const [i, { p, birthDay, doc }] of postnatal.entries()) {
    const birthAt = new Date(birthDay.getTime() + int(0, 23) * 3600_000 - 5.5 * 3600_000 + 3600_000);
    const twins = i === 1 || i === 4;
    await baby({ mother: p, birthAt, doc, grams: twins ? int(1700, 2400) : int(2300, 3900) });
    if (twins) await baby({ mother: p, birthAt: new Date(birthAt.getTime() + int(5, 30) * 60_000), doc, grams: int(1600, 2300) });
  }
  for (let i = 0; i < 5; i += 1) {
    const birthAt = at10(addDays(today, -int(3, 350)));
    await baby({ mother: null, birthAt, doc: doctorFor(), grams: rand() < 0.2 ? null : int(1300, 4300) });
  }

  // Pregnancy loss (the Abortion type of care): three FAKE women, fixed dates (no random numbers, so the patients
  // above stay the same). Only loss that was not induced is ever recorded.
  const losses = [
    {
      n: 1, seenDaysAgo: 40, lmpDaysBefore: 70, blood: 'B+',
      abortion: { lossType: 'missed', management: { method: 'medical', outcome: 'complete' }, antiD: { status: 'not_needed' } },
    },
    {
      n: 2, seenDaysAgo: 75, lmpDaysBefore: 50, blood: 'O-',
      abortion: { lossType: 'ectopic', ectopicSite: 'tube', management: { method: 'laparoscopy', outcome: 'complete' }, antiD: { status: 'given' } },
    },
    {
      n: 3, seenDaysAgo: 12, lmpDaysBefore: 56, blood: 'A+',
      // (a threatened miscarriage is not recorded here: it stays under Antenatal – owner, 3 Oct 2026)
      abortion: { lossType: 'incomplete', management: { method: 'surgical_evacuation', outcome: 'complete' }, antiD: { status: 'not_needed' } },
    },
  ];
  for (const l of losses) {
    const seen = addDays(today, -l.seenDaysAgo);
    const doc = l.n === 2 ? doctor2 : doctor1;
    const p = await create({
      careType: 'abortion',
      fullName: `Sample Loss ${String(l.n).padStart(2, '0')} (Demo)`,
      ageYears: 24 + l.n * 3,
      phone: `+91 00000 5${String(l.n).padStart(4, '0')}`,
      abortion: {
        ...l.abortion,
        lmp: addDays(seen, -l.lmpDaysBefore),
        presentedOn: seen,
        management: { ...l.abortion.management, on: seen },
        antiD: { ...l.abortion.antiD, on: l.abortion.antiD.status === 'given' ? seen : null },
      },
      obstetric: { gravida: l.n + 1, para: l.n - 1, living: l.n - 1, abortions: 1, previousCaesareans: 0 },
      medical: { bloodGroup: l.blood, allergies: 'None known', conditionsReviewed: true },
      assignedDoctor: doc._id,
      createdAt: at10(seen),
    });
    addVisit(p, seen, 'abortion', doc, { vitals: { bpSystolic: 112, bpDiastolic: 72, pulse: 88 } });
    addVisit(p, addDays(seen, 7), 'abortion', doc, { vitals: { bpSystolic: 110, bpDiastolic: 70 } });
  }

  await Visit.insertMany(visits);
  await refreshDueRisks(tenantId, now, { minIntervalMs: 0 });

  // Care plans for the pregnancies with dates, booked on the day of registration, items marked as staff would.
  for (const m of mothers) {
    const patient = await Patient.findById(m._id).setOptions({ tenantId }).where({ tenantId });
    const facts = planFacts(patient, now);
    if (!facts.edd || (await CarePlan.exists({ tenantId, patientId: patient._id }))) continue;
    const doc = users.find((u) => patient.assignedDoctor && u._id.equals(patient.assignedDoctor)) ?? doctor1;
    const plan = await createPlan({ req: null, tenantId, user: null, now }, patient, { facts, bookedOn: hospitalToday(patient.createdAt) });
    markPlanItems(plan, facts, { rand, doctor: doc, now, today });
    // One woman delivered: her plan is closed as delivered, but her type of care was left antenatal.
    if (patient.fullName === 'Sample Mother 28 (Demo)') {
      plan.current = false;
      plan.status = 'closed';
      plan.closed = { reason: 'delivered', note: '', auto: false, by: doc._id, byName: doc.name, at: now };
    }
    await plan.save();
  }
}

// ---------- Deliveries demo (Analytics → Deliveries, 5 Oct 2026) ----------
// A confirmed delivery note for each of the 8 FAKE postnatal mothers of the Analytics set, on the day her baby (or
// twins) was born, after a short stay in hospital that has ended – so that the Deliveries tab shows real-looking
// numbers: modes of delivery, a postpartum haemorrhage, Apgar scores under 7, NICU admissions, breastfeeding within the
// hour, answers not recorded, and one stillborn twin. Fixed values (no random numbers, so the patients above stay the
// same). Added once, also to a database that already has the Analytics set.
const DEMO_DELIVERIES = [
  { mode: 'normal', pph: 'no', bloodLossMl: 250, apgar5: 9, breastfed: 'yes', nicu: 'no' },
  { mode: 'lscs', indication: 'Twins, first baby not head-down (demo)', pph: 'no', bloodLossMl: 800, apgar5: 8, twinApgar5: 7, breastfed: 'not_applicable', nicu: 'yes' },
  { mode: 'normal', pph: 'yes', bloodLossMl: 700, apgar5: 9, breastfed: 'yes', nicu: 'no' },
  { mode: 'vacuum', indication: 'Prolonged second stage (demo)', pph: 'no', bloodLossMl: 350, apgar5: 6, breastfed: 'no', nicu: 'yes' },
  { mode: 'lscs', indication: 'Previous caesarean (demo)', pph: '', bloodLossMl: null, apgar5: 9, twinApgar5: 8, breastfed: '', nicu: '' },
  { mode: 'normal', pph: 'no', bloodLossMl: 300, apgar5: 8, breastfed: 'yes', nicu: 'no' },
  { mode: 'forceps', indication: 'Fetal distress (demo)', pph: 'no', bloodLossMl: 450, apgar5: 5, breastfed: 'not_applicable', nicu: 'yes', stillTwin: 'fresh' },
  { mode: 'normal', pph: 'no', bloodLossMl: 200, apgar5: 9, breastfed: 'yes', nicu: 'no' },
];

async function seedDeliveryDemo(tenant, users, now) {
  const tenantId = tenant._id;
  if (await ClinicalDocument.exists({ tenantId, clientRequestId: 'demo-delivery-1' })) return;
  const doctor1 = users.find((u) => u.email === 'demo.doctor@example.com');
  const rmo = users.find((u) => u.email === 'demo.rmo@example.com') ?? doctor1;
  const schema = contentSchema('delivery', { pcpndt: false });
  for (const [i, spec] of DEMO_DELIVERIES.entries()) {
    const mother = await Patient.findOne({ tenantId, fullName: `Sample Postnatal ${String(i + 1).padStart(2, '0')} (Demo)` });
    if (!mother) continue;
    const babies = await Patient.find({ tenantId, careType: 'newborn', 'newborn.mother': mother._id }).sort({ 'newborn.birthAt': 1 }).lean();
    if (!babies[0]?.newborn?.birthAt) continue;
    const deliveredAt = new Date(babies[0].newborn.birthAt);
    if (deliveredAt.getTime() + 3 * 3600_000 > now.getTime()) continue; // confirmed a few hours after the birth
    const doctor = users.find((u) => mother.assignedDoctor && u._id.equals(mother.assignedDoctor)) ?? doctor1;
    const hours = (h) => new Date(deliveredAt.getTime() + h * 3600_000);
    const admission = await Admission.create({
      tenantId, patientId: mother._id, careType: mother.careType, admittedAt: hours(-6), ward: 'Labour ward', bed: String(i + 1), reason: 'In labour (demo)',
      status: 'discharged', dischargedAt: new Date(Math.min(hours(48).getTime(), now.getTime())), admittedBy: rmo._id, admittedByName: rmo.name, dischargedByName: doctor.name,
      clientRequestId: `demo-delivery-stay-${i + 1}`,
    });
    const live = babies.map((b, n) => ({
      sex: b.newborn?.sex ?? '', weightGrams: b.newborn?.birthWeightGrams ?? null, apgar1: n === 0 ? Math.max(0, spec.apgar5 - 2) : null, apgar5: n === 0 ? spec.apgar5 : (spec.twinApgar5 ?? null),
      outcome: 'live', breastfedWithinHour: spec.breastfed, nicu: spec.nicu, notes: '',
    }));
    const stillborn = spec.stillTwin ? [{ weightGrams: 1400, outcome: 'stillbirth', stillbirthType: spec.stillTwin, notes: '' }] : [];
    const content = schema.parse({
      deliveredAt: deliveredAt.toISOString(), mode: spec.mode, indication: spec.indication ?? '', labourOnset: spec.mode === 'lscs' ? 'not_in_labour' : 'spontaneous',
      perineum: ['normal', 'vacuum', 'forceps'].includes(spec.mode) ? 'episiotomy' : '', placenta: 'Complete', bloodLossMl: spec.bloodLossMl, pph: spec.pph,
      motherCondition: 'Stable', babies: [...live, ...stillborn], conductedBy: doctor.name, notes: 'Fake sample delivery note.',
    });
    const doc = await ClinicalDocument.create({
      tenantId, patientId: mother._id, admissionId: admission._id, kind: 'delivery', status: 'signed', content, rev: 1, createdBy: rmo._id, createdByName: rmo.name,
      savedBy: rmo._id, savedByName: rmo.name, savedAt: hours(1), signed: { by: doctor._id, byName: doctor.name, role: 'doctor', at: hours(2), rev: 1 },
      clientRequestId: `demo-delivery-${i + 1}`,
    });
    // What confirming the note does in the app (routes/admissions.js): the delivery is recorded on her record.
    if (!mother.lastDelivery?.at || mother.lastDelivery.at <= deliveredAt) {
      await Patient.updateOne({ _id: mother._id, tenantId }, { $set: { lastDelivery: { at: deliveredAt, mode: content.mode, documentId: doc._id } } });
    }
  }
}

// ---------- Inpatients demo (Version 2): one FAKE stay ----------
// Rekha, at 39 weeks, admitted yesterday in labour: the RMO's admission note (signed), the RMO's delivery note
// (a draft waiting for the demo doctor's confirmation – it shows in "Waiting for your confirmation") and a few
// nursing-chart entries. Kept if it is already there.
async function seedInpatientDemo(tenant, users, now) {
  const tenantId = tenant._id;
  const name = 'Rekha Inpatient (Demo)';
  if (await Patient.findOne({ tenantId, fullName: name })) return;
  const doctor = users.find((u) => u.email === 'demo.doctor@example.com');
  const rmo = users.find((u) => u.email === 'demo.rmo@example.com') ?? doctor;
  const nurse = users.find((u) => u.email === 'demo.nurse@example.com') ?? rmo;
  const today = hospitalToday(now);
  const patient = await Patient.create({
    tenantId,
    careType: 'antenatal',
    fullName: name,
    ageYears: 29,
    ageRecordedOn: now,
    phone: '+91 00000 00009',
    address: '9 Demo Street, Demo City',
    pregnancy: { lmp: addDays(today, -7 * 39 - 2) },
    obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, complicationsReviewed: true },
    medical: { bloodGroup: 'A+', heightCm: 160, weightKg: 66, allergies: 'None known', conditionsReviewed: true },
    mrn: await nextMrn(tenantId),
    assignedDoctor: doctor._id,
    createdBy: rmo._id,
  });
  const hours = (h) => new Date(now.getTime() - h * 3600_000);
  const admission = await Admission.create({
    tenantId, patientId: patient._id, careType: 'antenatal', admittedAt: hours(20), ward: 'Labour ward', bed: '2',
    reason: 'In labour, 39 weeks (demo)', admittedBy: rmo._id, admittedByName: rmo.name, clientRequestId: randomUUID(),
  });
  const doc = (kind, content, extra = {}) => ({
    tenantId, patientId: patient._id, admissionId: admission._id, kind, content, rev: 1, createdBy: rmo._id, createdByName: rmo.name,
    savedBy: rmo._id, savedByName: rmo.name, savedAt: hours(2), clientRequestId: randomUUID(), ...extra,
  });
  await ClinicalDocument.create([
    doc('admission', {
      reason: 'In labour, 39 weeks (demo)', history: 'Pains since 4 hours, leaking none. Fake sample notes.', examination: 'Cervix 4 cm, cephalic, FHR 140.',
      vitals: { bpSystolic: 118, bpDiastolic: 76, pulse: 86, temperatureF: 98.4, spo2: 99 }, provisionalDiagnosis: 'Primigravida at term in active labour', plan: 'Partograph, monitor FHR every 30 min.',
    }, { status: 'signed', signed: { by: rmo._id, byName: rmo.name, role: 'rmo', at: hours(19), rev: 1 } }),
    doc('delivery', {
      deliveredAt: hours(3).toISOString(), mode: 'normal', indication: '', gestationWeeks: 39, labourOnset: 'spontaneous', perineum: 'episiotomy',
      placenta: 'Complete', bloodLossMl: 300, motherCondition: 'Stable', conductedBy: rmo.name, notes: 'Fake sample delivery note.',
      babies: [{ sex: 'female', weightGrams: 3050, apgar1: 8, apgar5: 9, outcome: 'live', notes: '' }],
    }),
  ]);
  await NursingEntry.create([
    { tenantId, patientId: patient._id, admissionId: admission._id, kind: 'vitals', at: hours(4), vitals: { bpSystolic: 122, bpDiastolic: 80, pulse: 92 }, by: nurse._id, byName: nurse.name, clientRequestId: randomUUID() },
    { tenantId, patientId: patient._id, admissionId: admission._id, kind: 'medicine', at: hours(3), medicine: { drug: 'Inj Oxytocin', dose: '10 IU', route: 'IM' }, by: nurse._id, byName: nurse.name, clientRequestId: randomUUID() },
    { tenantId, patientId: patient._id, admissionId: admission._id, kind: 'note', at: hours(1), note: 'Comfortable, breastfeeding started (demo).', by: nurse._id, byName: nurse.name, clientRequestId: randomUUID() },
  ]);
}

/**
 * Creates the demo data in the database mongoose is already connected to. Every date is counted from one
 * moment (now, the time the seed runs unless given). Returns { tenants, users }.
 */
export async function seedDemo(password, { now = new Date(), analytics = false } = {}) {
  await Promise.all([User.init(), Tenant.init(), Membership.init(), Patient.init(), CarePlanTemplate.init(), CarePlan.init(), Visit.init()]);
  const patients = patientsFor(hospitalToday(now));
  const { tenants, users } = await seedPeople(password);
  await seedPatients(tenants, users, patients, now);

  // Work out risk levels for the demo pregnancies (so lists and counts are correct straight away).
  for (const t of tenants) await refreshDueRisks(t._id, now, { minIntervalMs: 0 });

  // Care plans, built from each hospital's standard template with an explicit booking date.
  for (const [index, list] of patients.entries()) {
    const tenantId = tenants[index]._id;
    for (const p of list.filter((x) => PLANS[x.fullName])) {
      const patient = await Patient.findOne({ tenantId, fullName: p.fullName }); // fresh: risk was just worked out
      if (!patient) continue;
      const doctor = users.find((u) => patient.assignedDoctor && u._id.equals(patient.assignedDoctor)) ?? users[1];
      await seedPlan(tenantId, patient, PLANS[p.fullName], doctor, now);
    }
  }
  // A stay in hospital (Version 2, inpatients) to try the documents and the nursing chart.
  await seedInpatientDemo(tenants[0], users, now);
  // The Analytics demo set (npm run seed:demo adds it; analytics: true).
  if (analytics) await seedAnalyticsSet(tenants[0], users, now);
  // Confirmed delivery notes for the Analytics set's postnatal mothers (the Deliveries tab).
  if (analytics) await seedDeliveryDemo(tenants[0], users, now);
  // Appointment booking: each demo doctor's OPD (Monday–Saturday 10:00–13:00 and 17:00–20:00) – timings someone
  // already set are kept – and the next-visit dates turned into appointments.
  const week = [1, 2, 3, 4, 5, 6].map((day) => ({ day, sessions: [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }] }));
  for (const t of tenants) {
    const doctors = await Membership.find({ tenantId: t._id, roles: 'doctor', isActive: true }, { userId: 1 }).lean();
    for (const m of doctors) {
      await OpdSchedule.updateOne({ tenantId: t._id, doctorId: m.userId }, { $setOnInsert: { tenantId: t._id, doctorId: m.userId, week, leave: [], updatedByName: 'Demo data' } }, { upsert: true });
    }
    await convertNextVisits(t._id, now);
  }
  return { tenants, users };
}

// Run as a script (npm run seed:demo), not when a test imports seedDemo.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const password = process.env.DEMO_PASSWORD;
  if (!passwordSchema.safeParse(password ?? '').success) {
    console.error('❌ Please set DEMO_PASSWORD in server/.env (at least 12 characters, with a letter and a number).');
    process.exit(1);
  }
  await mongoose.connect(config.MONGO_URI);
  await seedDemo(password, { analytics: true });
  console.log('✅ Demo data ready (all fake):');
  console.log(`   Hospitals: ${HOSPITALS.join(', ')}`);
  console.log('   demo.admin@example.com  – admin in both hospitals');
  console.log('   demo.doctor@example.com – doctor in both hospitals (shows the hospital switcher)');
  console.log('   demo.nurse@example.com  – nurse in Lakeside Clinic');
  console.log('   demo.doctor2@example.com, demo.rmo@example.com, demo.reception@example.com, demo.lab@example.com, demo.pharmacist@example.com, demo.billing@example.com – both hospitals');
  console.log('   Password for all demo accounts: the DEMO_PASSWORD value in server/.env');
  console.log('   The two demo pregnancies have care plans (from the Draft standard template, with fake results).');
  console.log(`   Analytics: about 60 more fake patients over the last 12 months in ${HOSPITALS[0]}.`);
  console.log('   Deliveries: a confirmed delivery note for each of the 8 fake postnatal mothers there (Analytics → Deliveries).');
  console.log('   Appointments: every demo doctor has OPD Monday–Saturday 10:00–13:00 and 17:00–20:00.');
  await mongoose.disconnect();
}
