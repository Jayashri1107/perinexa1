// Fake hospitals for the Analytics tests (Analytics specification, section 6.1). Fake data only.
//
// Everything is entered through the app's own routes (registration, edits, visits, entered-in-error, closing a
// care plan), with the clock moved to each event's moment (10:00 in India that day unless stated), so the
// derived fields – EDD, risk level, care plan, booking date, createdAt – are real. The events run in ONE time
// order and the clock never moves back. "Today" (T) is 15 Oct 2026; offsets are days from T.
//
// Hospital H1: Dr A ("me"), Dr B, an admin, a doctor who is also admin (no patients), an RMO, a nurse,
// reception and lab staff. The only sensitive records are Dr B's (A-03 and I-01), so Dr B sees every record.
// H2 (isolation), H3 (care-plan items, step 1b), H4 (inactive hospital).
//
// Deliveries tab (5 Oct 2026): stays in hospital with delivery notes, and deaths recorded on records, on records that
// are already here. A delivery note changes no other number; a death takes the record out of the follow-up counts
// (A-07 and A-12, the two antenatal records older than 44 weeks, are no longer counted on Records to tidy up).
// Confirmed delivery notes of H1: A-07 (T−42, normal, PPH, baby Apgar 6 to the NICU; she died that day), A-03
// (Dr B's sensitive record, T−10 at 01:00 – 4 Oct in UTC, vacuum), A-11 (T−9 at 23:30 – 6 Oct also in UTC,
// caesarean, nothing else answered, as on an older note), A-05 (T−1, caesarean, twins: one live, one fresh
// stillbirth). Not counted: A-06's note confirmed and then marked entered in error, and her draft. Deaths: B-04 on
// the day after birth, B-06 at 300 days, A-12 during pregnancy (T−30), Y-01 not related to a pregnancy, and B-05's
// recorded in error and undone. H2: H2-1, a macerated stillbirth (T−20).

import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { resetAnalyticsAuditThrottle } from '../src/analytics/auditThrottle.js';
import { resetApprovalBackfill, resetRiskRefreshTimer } from '../src/careplans/templatesService.js';
import { Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { addMember, createSuperAdmin, createTenant, createUser, loginAs } from './helpers.js';

export const NOW = new Date('2026-10-15T04:30:00Z'); // 10:00 in India: T = 15 Oct 2026
export const TODAY = '2026-10-15';

/** The moment `offset` days from T at hh:mm in India. */
export const at = (offset, hh = 10, mm = 0) => new Date(Date.UTC(2026, 9, 15 + offset, hh, mm) - 330 * 60_000);
/** The date `offset` days from T, "2026-10-15". */
export const day = (offset) => new Date(Date.UTC(2026, 9, 15 + offset)).toISOString().slice(0, 10);

const SESSION_REUSE_MS = 20 * 60_000; // the login cookie lasts 30 minutes of clock time

function check(res, status, what) {
  if (res.status !== status) throw new Error(`Analytics fixture: ${what} answered ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// A mother's clinical details. g: [gravida, para, previous caesareans].
const obstetric = ([gravida, para, cs]) => ({ gravida, para, living: para, abortions: 0, previousCaesareans: cs, complicationsReviewed: true });
const medical = (bloodGroup, { conditions = [], reviewed = true } = {}) => ({ bloodGroup, allergies: 'None known', heightCm: 158, weightKg: 62, conditions, conditionsReviewed: reviewed });

export async function buildFixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(-420));
  resetRiskRefreshTimer();
  resetApprovalBackfill();
  resetAnalyticsAuditThrottle();
  const app = createApp({ apiRateLimitMax: 100000 });

  const h1 = await createTenant('Analytics Sample Hospital One');
  const h2 = await createTenant('Analytics Sample Hospital Two');
  const h3 = await createTenant('Analytics Sample Hospital Three');
  const h4 = await createTenant('Analytics Sample Hospital Four');
  const users = {};
  const member = async (key, name, tenant, roles) => {
    users[key] = await createUser({ name });
    await addMember(users[key], tenant, roles);
  };
  await member('drA', 'Dr A Sample', h1, 'doctor');
  await member('drB', 'Dr B Sample', h1, 'doctor');
  await member('admin', 'Admin Sample', h1, 'admin');
  await member('docAdmin', 'Dr Admin Sample', h1, ['doctor', 'admin']);
  await member('rmo', 'RMO Sample', h1, 'rmo');
  await member('nurse', 'Nurse Sample', h1, 'nurse');
  await member('reception', 'Reception Sample', h1, 'receptionist');
  await member('lab', 'Lab Sample', h1, 'lab');
  await member('drH2', 'Dr H2 Sample', h2, 'doctor');
  await member('drH3', 'Dr H3 Sample', h3, 'doctor');
  await member('drH4', 'Dr H4 Sample', h4, 'doctor');
  users.superAdmin = await createSuperAdmin({ name: 'Super Admin Sample' });

  // Logged-in sessions, renewed after a clock jump.
  const sessions = {};
  async function as(key) {
    const s = sessions[key];
    if (!s || Date.now() - s.last > SESSION_REUSE_MS) sessions[key] = { session: await loginAs(users[key], { app }), last: Date.now() };
    sessions[key].last = Date.now();
    return sessions[key].session;
  }

  const ids = {}; // 'A-01' → patient id
  const visitIds = {};
  const stays = {}; // 'A-07' → her admission id
  const docIds = {}; // 'A-07 delivery' → the delivery note's id
  const events = [];
  const ev = (time, fn) => events.push({ time: time.getTime(), seq: events.length, fn });

  // ---------- Actions through the routes ----------
  const register = (key, who, body) => async () => {
    const res = await (await as(who)).post('/api/patients').send({ phone: '', address: '', registerAnyway: true, ...body, fullName: `Sample ${key}` }); // (never held up by the "may already be registered" warning)
    ids[key] = check(res, 201, `registering ${key}`).patient.id;
  };
  const edit = (key, who, body) => async () => check(await (await as(who)).patch(`/api/patients/${ids[key]}`).send(body), 200, `editing ${key}`);
  const sensitive = (key, who, value) => async () =>
    check(await (await as(who)).patch(`/api/patients/${ids[key]}/sensitive`).send({ sensitive: value }), 200, `marking ${key}`);
  const visit =
    (key, who, { vitals, details, name } = {}) =>
    async () => {
      const s = await as(who);
      const res = await s.post(`/api/patients/${ids[key]}/visits`).send({ clientRequestId: randomUUID() });
      const vid = check(res, 201, `a visit of ${key}`).visit.id;
      if (name) visitIds[name] = vid;
      if (vitals || details) {
        const body = {};
        if (vitals) body.vitals = { rev: 0, ...vitals };
        if (details) body.details = { rev: 0, ...details };
        check(await s.patch(`/api/patients/${ids[key]}/visits/${vid}`).send(body), 200, `the visit details of ${key}`);
      }
    };
  const cancelVisit = (key, who, name) => async () =>
    check(await (await as(who)).post(`/api/patients/${ids[key]}/visits/${visitIds[name]}/cancel`).send({ reason: 'Entered for the wrong day' }), 200, `cancelling a visit of ${key}`);
  const closePlan = (key, who, reason) => async () =>
    check(await (await as(who)).post(`/api/patients/${ids[key]}/care-plan/close`).send({ reason }), 200, `closing the plan of ${key}`);
  // A stay in hospital, a delivery note written (and, with `confirm`, confirmed by that doctor), a note marked entered
  // in error, a death recorded (and undone) – through the inpatient and death routes.
  const admit = (key, who) => async () => {
    const res = await (await as(who)).post(`/api/patients/${ids[key]}/admissions`).send({ clientRequestId: randomUUID(), ward: 'Labour ward', bed: '1', reason: 'In labour' });
    stays[key] = check(res, 201, `admitting ${key}`).admission.id;
  };
  const docs = (key) => `/api/patients/${ids[key]}/admissions/${stays[key]}/documents`;
  const deliveryNote = (key, who, name, content, { confirm = null } = {}) => async () => {
    const s = await as(who);
    const draft = check(await s.post(docs(key)).send({ clientRequestId: randomUUID(), kind: 'delivery' }), 201, `a delivery note of ${key}`).document;
    const saved = check(await s.put(`${docs(key)}/${draft.id}`).send({ rev: draft.rev, content }), 200, `saving the delivery note of ${key}`).document;
    docIds[name] = saved.id;
    if (confirm) check(await (await as(confirm)).post(`${docs(key)}/${saved.id}/sign`).send({ rev: saved.rev }), 200, `confirming the delivery note of ${key}`);
  };
  const noteInError = (key, who, name) => async () =>
    check(await (await as(who)).post(`${docs(key)}/${docIds[name]}/cancel`).send({ reason: 'Written for the wrong stay' }), 200, `marking a note of ${key} in error`);
  const death = (key, who, body) => async () => check(await (await as(who)).put(`/api/patients/${ids[key]}/death`).send({ ...body, confirmed: true }), 200, `recording a death on ${key}`);
  const undoDeath = (key, who) => async () =>
    check(await (await as(who)).post(`/api/patients/${ids[key]}/death/undo`).send({ reason: 'Recorded on the wrong record' }), 200, `undoing the death on ${key}`);
  const live = (o = {}) => ({ outcome: 'live', weightGrams: 2900, apgar1: 8, ...o });

  const drA = () => String(users.drA._id);
  const drB = () => String(users.drB._id);
  const antenatal = (age, doctor, extra = {}) => ({ careType: 'antenatal', ageYears: age, assignedDoctor: doctor, ...extra });
  const baby = (who, key, { born, grams = null, sex = '', mother = null, doctor = null }) =>
    register(key, who, {
      careType: 'newborn',
      assignedDoctor: doctor,
      newborn: { birthAt: born.toISOString(), birthWeightGrams: grams, sex, mother: mother ? ids[mother] : null },
    });

  // ---------- H1: antenatal records ----------
  ev(at(-5), () => register('A-01', 'drA', antenatal(24, drA(), { pregnancy: { lmp: day(-80) }, obstetric: obstetric([1, 0, 0]), medical: medical('O+') }))());
  ev(at(-1), () => visit('A-01', 'drA', { name: 'A-01 wrong day' })());
  ev(at(-1, 12), () => cancelVisit('A-01', 'drA', 'A-01 wrong day')());

  ev(at(-60), () => register('A-02', 'drA', antenatal(37, drA(), { pregnancy: { scanEdd: day(150) }, obstetric: obstetric([2, 1, 1]), medical: medical('A-') }))());
  ev(at(-60, 10, 5), () => visit('A-02', 'drA', { vitals: { bpSystolic: 118, bpDiastolic: 76, hb: 10.4, urineAlbumin: 'nil' } })());
  ev(at(-12), () => visit('A-02', 'drA', { vitals: { bpSystolic: 150, bpDiastolic: 96, hb: 9.6, urineAlbumin: '1+' }, details: { nextVisitOn: day(16) } })());

  ev(at(-200), () =>
    register('A-03', 'drB', antenatal(29, drB(), { pregnancy: { scanEdd: day(60) }, obstetric: obstetric([3, 2, 0]), medical: medical('B+', { conditions: ['hiv'], reviewed: false }) }))(),
  );
  ev(at(-200, 10, 1), () => sensitive('A-03', 'drB', true)());
  ev(at(-195), () => visit('A-03', 'drB', { vitals: { bpSystolic: 110, bpDiastolic: 70, hb: 11.2 } })());
  ev(at(-100), () => visit('A-03', 'drB', { vitals: { bpSystolic: 120, bpDiastolic: 80, hb: 11.0 } })());
  ev(at(-20), () => visit('A-03', 'drB', { vitals: { bpSystolic: 164, bpDiastolic: 112, urineAlbumin: '2+', hb: 10.1 }, details: { nextVisitOn: day(-13) } })());

  ev(at(-150), () =>
    register('A-04', 'drB', antenatal(31, drB(), { pregnancy: { scanEdd: day(10) }, obstetric: obstetric([2, 1, 0]), medical: medical('B+', { reviewed: false }) }))(),
  );
  ev(at(-150, 10, 5), () => visit('A-04', 'drB', { vitals: { bpSystolic: 116, bpDiastolic: 74 } })());
  ev(at(-3), () => visit('A-04', 'drB', { vitals: { hb: 6.8 }, details: { presentation: 'breech', nextVisitOn: day(4) } })());

  // A-05 is not assigned to any doctor (any doctor may record her visits).
  ev(at(-270), () =>
    register('A-05', 'drA', antenatal(33, null, { pregnancy: { scanEdd: day(-3) }, obstetric: obstetric([1, 0, 0]), medical: medical('', { reviewed: false }) }))(),
  );
  ev(at(-30, 10, 5), () => visit('A-05', 'drA', { vitals: { bpSystolic: 124, bpDiastolic: 82 }, details: { presentation: 'cephalic' } })());
  ev(at(-2), () => visit('A-05', 'drA', { vitals: { bpSystolic: 142, bpDiastolic: 88, urineAlbumin: 'nil' }, details: { nextVisitOn: day(5) } })());

  // A-06: registered with no dates; LMP entered 200 days before T.
  ev(at(-400), () => register('A-06', 'drA', antenatal(27, drA()))());
  ev(at(-200), () => edit('A-06', 'drA', { pregnancy: { lmp: day(-296) }, obstetric: obstetric([3, 2, 2]), medical: medical('O+') })());
  ev(at(-16), () => visit('A-06', 'drA', { vitals: { bpSystolic: 120, bpDiastolic: 80 }, details: { presentation: 'cephalic', nextVisitOn: day(-9) } })());

  ev(at(-100), () => register('A-07', 'drA', antenatal(30, drA(), { pregnancy: { lmp: day(-320) }, obstetric: obstetric([1, 0, 0]), medical: medical('O+') }))());

  ev(at(-2), () => register('A-08', 'reception', antenatal(22, drA()))());

  ev(at(-40), () => register('A-09', 'drB', antenatal(17, drB(), { pregnancy: { scanEdd: day(100) }, obstetric: obstetric([1, 0, 0]), medical: medical('O-') }))());
  ev(at(-40, 10, 5), () => visit('A-09', 'drB', { vitals: { bpSystolic: 100, bpDiastolic: 60, hb: 11.5 } })());

  ev(at(-30), () =>
    register(
      'A-10',
      'drA',
      antenatal(36, drA(), { pregnancy: { scanEdd: day(3) }, obstetric: obstetric([5, 4, 0]), medical: medical('A+', { conditions: ['diabetes', 'hypertension'], reviewed: false }) }),
    )(),
  );
  ev(at(-30, 10, 6), () => visit('A-10', 'drA', { vitals: { bpSystolic: 138, bpDiastolic: 88, hb: 11.0 }, details: { presentation: 'cephalic' } })());
  ev(at(-1), () => visit('A-10', 'drA', { vitals: { bpSystolic: 130, bpDiastolic: 85 }, details: { presentation: 'cephalic' } })());

  // A-11: care plan closed as delivered on T−8; type of care left antenatal.
  ev(at(-380), () => register('A-11', 'drA', antenatal(28, drA()))());
  ev(at(-250), () => edit('A-11', 'drA', { pregnancy: { lmp: day(-285) }, obstetric: obstetric([2, 1, 0]), medical: medical('O+') })());
  ev(at(-8), () => closePlan('A-11', 'drA', 'delivered')());

  ev(at(-360), () => register('A-12', 'reception', antenatal(25, drB()))());

  // ---------- H1: other care ----------
  ev(at(-300), () => register('M-01', 'drA', antenatal(26, drA(), { pregnancy: { lmp: day(-330) }, obstetric: obstetric([1, 0, 0]), medical: medical('O+') }))());
  ev(at(-290), () => visit('M-01', 'drA', { vitals: { bpSystolic: 120, bpDiastolic: 78, hb: 11.4 } })());
  ev(at(-45), () => edit('M-01', 'drA', { careType: 'postnatal' })());
  ev(at(-45, 10, 5), () => visit('M-01', 'drA')());

  ev(at(-400, 10, 1), () => register('M-02', 'drB', antenatal(30, drB()))());
  ev(at(-300, 10, 1), () => edit('M-02', 'drB', { pregnancy: { lmp: day(-370) }, obstetric: obstetric([2, 1, 0]), medical: medical('B+') })());
  ev(at(-100, 10, 1), () => edit('M-02', 'drB', { careType: 'postnatal' })());

  ev(new Date('2026-09-30T18:45:00Z'), () => register('N-01', 'drA', { careType: 'postnatal', ageYears: 26, assignedDoctor: drA() })()); // 1 Oct 00:15 in India
  ev(at(-14), () => visit('N-01', 'drA')());

  ev(at(-70), () => register('I-01', 'drB', { careType: 'infertility', ageYears: 32, assignedDoctor: drB() })()); // sensitive automatically
  ev(at(-70, 10, 5), () => visit('I-01', 'drB')());
  ev(at(-10), () => visit('I-01', 'drB')());

  ev(at(-15), () => register('I-02', 'drA', { careType: 'infertility', ageYears: 29, assignedDoctor: drA() })());
  ev(at(-15, 10, 1), () => sensitive('I-02', 'drA', false)()); // so that only Dr B's records are sensitive

  ev(at(-400, 10, 2), () => register('Y-01', 'reception', { careType: 'gynaecology', ageYears: 40, assignedDoctor: null })());
  ev(at(-5, 10, 5), () => visit('Y-01', 'drA')());

  // ---------- H1: babies, each registered 1 hour after birth ----------
  const B01 = new Date('2026-08-25T20:30:00Z'); // 26 Aug 2026, 02:00 in India
  ev(new Date(B01.getTime() + 3_600_000), () => baby('drA', 'B-01', { born: B01, grams: 2400, sex: 'female', mother: 'M-01', doctor: drA() })());
  ev(at(-120, 11), () => baby('drB', 'B-02', { born: at(-120), grams: 1450, sex: 'male', mother: 'M-02', doctor: drB() })());
  ev(at(-120, 11, 20), () => baby('drB', 'B-03', { born: at(-120, 10, 20), grams: 1600, sex: 'male', mother: 'M-02', doctor: drB() })());
  ev(at(-200, 11), () => baby('reception', 'B-04', { born: at(-200), grams: 3300, sex: 'female' })());
  const B05 = new Date('2026-09-30T20:00:00Z'); // 1 Oct 2026, 01:30 in India
  ev(new Date(B05.getTime() + 3_600_000), () => baby('drA', 'B-05', { born: B05, sex: 'indeterminate', doctor: drA() })());
  ev(at(-400, 11), () => baby('reception', 'B-06', { born: at(-400), grams: 4100 })());
  ev(at(-5, 11), () => baby('drA', 'B-07', { born: at(-5), grams: 3000, sex: 'female', doctor: drA() })());

  // ---------- H1: delivery notes and deaths (Deliveries tab) ----------
  // A-07 (Dr A): a normal delivery with a PPH; the baby, Apgar 6 at 5 minutes, went to the NICU. She died that day.
  ev(at(-43, 22), () => admit('A-07', 'drA')());
  ev(at(-42, 8), () =>
    deliveryNote(
      'A-07',
      'rmo',
      'A-07 delivery',
      { deliveredAt: at(-42, 3).toISOString(), mode: 'normal', labourOnset: 'spontaneous', bloodLossMl: 1500, pph: 'yes', babies: [live({ apgar1: 4, apgar5: 6, breastfedWithinHour: 'not_applicable', nicu: 'yes' })] },
      { confirm: 'drA' },
    )(),
  );
  ev(at(-42, 12), () => death('A-07', 'drA', { on: day(-42), timing: 'delivery' })());
  // A-03 (Dr B's sensitive record): vacuum, at 01:00 in India on T−10 (still the day before in UTC).
  ev(at(-11, 20), () => admit('A-03', 'drB')());
  ev(at(-10, 9), () =>
    deliveryNote(
      'A-03',
      'drB',
      'A-03 delivery',
      { deliveredAt: at(-10, 1).toISOString(), mode: 'vacuum', indication: 'Prolonged second stage', bloodLossMl: 400, pph: 'no', babies: [live({ weightGrams: 2100, apgar5: 8, breastfedWithinHour: 'no', nicu: 'no' })] },
      { confirm: 'drB' },
    )(),
  );
  // A-11 (Dr A): caesarean at 23:30 in India on T−9; nothing else answered (as on a note from before 5 Oct 2026).
  ev(at(-10, 18), () => admit('A-11', 'drA')());
  ev(at(-8, 9), () =>
    deliveryNote('A-11', 'drA', 'A-11 delivery', { deliveredAt: at(-9, 23, 30).toISOString(), mode: 'lscs', indication: 'Fetal distress', bloodLossMl: 800, babies: [live({ weightGrams: 3100 })] }, { confirm: 'drA' })(),
  );
  // A-05 (no doctor assigned): caesarean for twins on T−1 – one born alive, one fresh stillbirth.
  ev(at(-2, 14), () => admit('A-05', 'drA')());
  ev(at(-1, 11), () =>
    deliveryNote(
      'A-05',
      'drA',
      'A-05 delivery',
      {
        deliveredAt: at(-1, 6).toISOString(),
        mode: 'lscs',
        indication: 'Twins, first baby not head-down',
        bloodLossMl: 900,
        pph: 'no',
        babies: [live({ weightGrams: 2300, apgar5: 9, breastfedWithinHour: 'yes', nicu: 'no' }), { outcome: 'stillbirth', stillbirthType: 'fresh', weightGrams: 1800 }],
      },
      { confirm: 'drA' },
    )(),
  );
  // A-06 (Dr A): a note confirmed and then marked entered in error, and a draft never confirmed – neither counts.
  ev(at(-5, 9), () => admit('A-06', 'drA')());
  ev(at(-4, 11), () =>
    deliveryNote('A-06', 'rmo', 'A-06 delivery', { deliveredAt: at(-4, 6).toISOString(), mode: 'normal', pph: 'no', babies: [live({ apgar5: 9, breastfedWithinHour: 'yes', nicu: 'no' })] }, { confirm: 'drA' })(),
  );
  ev(at(-4, 12), () => noteInError('A-06', 'drA', 'A-06 delivery')());
  ev(at(-3, 10, 30), () =>
    deliveryNote('A-06', 'rmo', 'A-06 draft', { deliveredAt: at(-3, 4).toISOString(), mode: 'forceps', indication: 'Maternal exhaustion', pph: 'yes', babies: [live({ apgar5: 5 })] })(),
  );
  // Deaths: B-04 the day after birth (an early newborn death), B-06 at 300 days (not a newborn death), A-12 during
  // pregnancy (a maternal death), Y-01 not related to a pregnancy, and B-05's recorded in error and undone.
  ev(at(-199, 12), () => death('B-04', 'drA', { on: day(-199), place: 'here' })());
  ev(at(-100, 12), () => death('B-06', 'drB', { on: day(-100), place: 'elsewhere' })());
  ev(at(-30, 12), () => death('A-12', 'drB', { on: day(-30), timing: 'pregnancy' })());
  ev(at(-9, 12), () => death('B-05', 'drA', { on: day(-9), place: 'here' })());
  ev(at(-9, 13), () => undoDeath('B-05', 'drA')());
  ev(at(-3, 12), () => death('Y-01', 'drA', { on: day(-3), timing: 'other' })());

  // ---------- Other hospitals ----------
  const drH2 = () => String(users.drH2._id);
  ev(at(-30, 9), () => register('H2-1', 'drH2', antenatal(28, drH2(), { pregnancy: { scanEdd: day(100) }, obstetric: obstetric([1, 0, 0]), medical: medical('O+') }))());
  ev(at(-30, 9, 5), () => register('H2-2', 'drH2', antenatal(31, drH2(), { pregnancy: { scanEdd: day(100) }, obstetric: obstetric([2, 1, 0]), medical: medical('A+') }))());
  ev(at(-30, 11), () => baby('drH2', 'H2-B1', { born: at(-30), grams: 2950, sex: 'female', doctor: drH2() })());
  // H2-1: a macerated stillbirth on T−20 (another hospital's delivery: never counted in H1).
  ev(at(-21, 20), () => admit('H2-1', 'drH2')());
  ev(at(-20, 9), () =>
    deliveryNote('H2-1', 'drH2', 'H2-1 delivery', { deliveredAt: at(-20, 2).toISOString(), mode: 'normal', pph: 'no', babies: [{ outcome: 'stillbirth', stillbirthType: 'macerated', weightGrams: 900 }] }, { confirm: 'drH2' })(),
  );
  ev(at(-150, 9), () =>
    register('H3-1', 'drH3', antenatal(30, String(users.drH3._id), { pregnancy: { scanEdd: day(70) }, obstetric: obstetric([1, 0, 0]), medical: medical('B+') }))(),
  );
  // H3 (E4 "done by the due date"): the booking tests are due T−150 to T−137. CBC done on its first due day,
  // HIV done 10 days after its due date, syphilis test not needed (declined), hepatitis B left open.
  const planItem = async (who, key, k) => {
    const body = check(await (await as(who)).get(`/api/patients/${ids[key]}/care-plan`), 200, `the care plan of ${key}`);
    const it = body.plan.items.find((x) => x.key === k);
    if (!it) throw new Error(`Analytics fixture: no item ${k} on the plan of ${key}`);
    return it;
  };
  const itemAction = (key, who, k, action) => async () => {
    const it = await planItem(who, key, k);
    const body = typeof action === 'function' ? action(it) : action;
    check(await (await as(who)).patch(`/api/patients/${ids[key]}/care-plan/items/${it.id}`).send({ rev: it.rev, ...body }), 200, `${body.action} ${k} of ${key}`);
  };
  ev(at(-150, 9, 30), () => itemAction('H3-1', 'drH3', 'lab_cbc', (it) => ({ action: 'done', on: String(it.due.from).slice(0, 10) }))());
  ev(at(-150, 9, 31), () => itemAction('H3-1', 'drH3', 'lab_vdrl', { action: 'not_needed', reasonCode: 'declined' })());
  ev(at(-127, 9), () => itemAction('H3-1', 'drH3', 'lab_hiv', { action: 'done', on: day(-127) })());

  ev(at(-10, 9), () =>
    register('H4-1', 'drH4', antenatal(27, String(users.drH4._id), { pregnancy: { scanEdd: day(200) }, obstetric: obstetric([1, 0, 0]), medical: medical('O+') }))(),
  );

  events.sort((a, b) => a.time - b.time || a.seq - b.seq);
  let last = -Infinity;
  for (const e of events) {
    if (e.time < last) throw new Error('Analytics fixture: the clock would move back');
    last = e.time;
    vi.setSystemTime(new Date(e.time));
    await e.fn();
  }

  // ---------- Legacy bad data (saved before the newborn rules; Analytics must ignore it) ----------
  vi.setSystemTime(NOW);
  await Patient.updateOne({ tenantId: h1._id, _id: ids['A-01'] }, { $set: { 'newborn.sex': 'male' } });
  await Patient.updateOne({ tenantId: h1._id, _id: ids['B-07'] }, { $set: { 'newborn.birthAt': at(2) } });
  await Tenant.updateOne({ _id: h4._id }, { $set: { isActive: false } });
  for (const k of Object.keys(sessions)) delete sessions[k];

  return { app, hospitals: { h1, h2, h3, h4 }, users, ids, visitIds, docIds, as };
}

/**
 * What the fixture must have produced (checked before any number), for every record of every hospital: EDD,
 * registration date (in India), and the care plan. hospital: 'h1' unless stated. plan: null (none), or
 * { current, status, bookedOn }.
 */
export const FIXTURE_EXPECTED = {
  'A-01': { edd: day(200), registered: day(-5), plan: { current: true, status: 'active', bookedOn: day(-5) } },
  'A-02': { edd: day(150), registered: day(-60), plan: { current: true, status: 'active', bookedOn: day(-60) } },
  'A-03': { edd: day(60), registered: day(-200), plan: { current: true, status: 'active', bookedOn: day(-200) } },
  'A-04': { edd: day(10), registered: day(-150), plan: { current: true, status: 'active', bookedOn: day(-150) } },
  'A-05': { edd: day(-3), registered: day(-270), plan: { current: true, status: 'active', bookedOn: day(-270) } },
  'A-06': { edd: day(-16), registered: day(-400), plan: { current: true, status: 'active', bookedOn: day(-200) } },
  'A-07': { edd: day(-40), registered: day(-100), plan: { current: true, status: 'active', bookedOn: day(-100) } },
  'A-08': { edd: null, registered: day(-2), plan: null },
  'A-09': { edd: day(100), registered: day(-40), plan: { current: true, status: 'active', bookedOn: day(-40) } },
  'A-10': { edd: day(3), registered: day(-30), plan: { current: true, status: 'active', bookedOn: day(-30) } },
  'A-11': { edd: day(-5), registered: day(-380), plan: { current: false, status: 'closed', bookedOn: day(-250) } },
  'A-12': { edd: null, registered: day(-360), plan: null },
  'M-01': { edd: day(-50), registered: day(-300), plan: { current: true, status: 'paused', bookedOn: day(-300) } },
  'M-02': { edd: day(-90), registered: day(-400), plan: { current: true, status: 'paused', bookedOn: day(-300) } },
  'N-01': { edd: null, registered: day(-14), plan: null },
  'I-01': { edd: null, registered: day(-70), plan: null },
  'I-02': { edd: null, registered: day(-15), plan: null },
  'Y-01': { edd: null, registered: day(-400), plan: null },
  // Babies (no EDD, no care plan). B-01 was registered 25 Aug 21:30 UTC, which is 26 Aug in India; B-05 on
  // 30 Sep 21:00 UTC, which is 1 Oct in India; B-07's createdAt is not touched by the legacy birthAt move.
  'B-01': { edd: null, registered: day(-50), plan: null },
  'B-02': { edd: null, registered: day(-120), plan: null },
  'B-03': { edd: null, registered: day(-120), plan: null },
  'B-04': { edd: null, registered: day(-200), plan: null },
  'B-05': { edd: null, registered: day(-14), plan: null },
  'B-06': { edd: null, registered: day(-400), plan: null },
  'B-07': { edd: null, registered: day(-5), plan: null },
  // Other hospitals.
  'H2-1': { hospital: 'h2', edd: day(100), registered: day(-30), plan: { current: true, status: 'active', bookedOn: day(-30) } },
  'H2-2': { hospital: 'h2', edd: day(100), registered: day(-30), plan: { current: true, status: 'active', bookedOn: day(-30) } },
  'H2-B1': { hospital: 'h2', edd: null, registered: day(-30), plan: null },
  'H3-1': { hospital: 'h3', edd: day(70), registered: day(-150), plan: { current: true, status: 'active', bookedOn: day(-150) } },
  'H4-1': { hospital: 'h4', edd: day(200), registered: day(-10), plan: { current: true, status: 'active', bookedOn: day(-10) } },
};
