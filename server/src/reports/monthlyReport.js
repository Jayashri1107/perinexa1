// The monthly report (Analytics → Monthly report, doctors only): the month's numbers in the order of the
// government's HMIS monthly form – registrations and outpatients, antenatal care, deliveries and births, pregnancy
// loss (the Abortion type of care: miscarriage, ectopic and molar pregnancy only), postnatal care, inpatients, child immunisation, and scans and lab. Counts only, never a name. For the figures to type into
// the HMIS portal (the item numbers of the official form are not used: check each row against the current HMIS
// data items). Also the 12-month trend for the owner's charts. Everything is read from the records as they are now.
// The MTP and Form F rows were removed with the registers on 2 Oct 2026; pregnancy scans are counted from the care
// plan instead (scans ticked as done here).
// Stillbirths (fresh or macerated) come from the confirmed delivery notes; newborn and maternal deaths from the deaths
// a doctor recorded on the records (5 Oct 2026, patients/deathRules.js), by the day of death.

import { hospitalToday } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { CarePlan } from '../models/CarePlan.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { LabOrder } from '../models/LabOrder.js';
import { Visit } from '../models/Visit.js';
import { CARE_TYPES, Patient } from '../models/Patient.js';
import { NOT_DUPLICATE } from '../patients/duplicateRules.js';
import { mainRecordOf } from '../patients/duplicateService.js';
import { isAbnormal } from '../lab/labTests.js';
import { RETIRED_LOSS_TYPES, SURGICAL_METHODS } from '../patients/abortionRules.js';
import { DEATH_DEFINITIONS_SOURCE, EARLY_NEONATAL_DAYS, MATERNAL_DEATH_TIMINGS, NEONATAL_DAYS } from '../patients/deathRules.js';

const DAY = 86_400_000;
const CARE_WORDS = { antenatal: 'Antenatal', postnatal: 'Postnatal', newborn: 'Newborn', gynaecology: 'Gynaecology', infertility: 'Fertility', abortion: 'Abortion' };
// Pregnancy loss counted in "Women seen for pregnancy loss" (recurrent-loss work-up apart). A threatened miscarriage
// is a continuing pregnancy recorded under Antenatal (3 Oct 2026); old records that still say so are counted as to tidy.
const MISCARRIAGE = ['inevitable', 'incomplete', 'complete', 'missed', 'septic'];

/** The month as hospital dates: [first day, first day of the next month) at midnight UTC. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
// A moment (e.g. createdAt) falls in the month by the hospital's date
const inMonth = (at, { from, to }) => {
  if (!at) return false;
  const d = hospitalToday(new Date(at));
  return d >= from && d < to;
};
// A wide window of real moments around the month (a day either side), narrowed with inMonth
const around = ({ from, to }) => ({ $gte: new Date(from.getTime() - DAY), $lt: new Date(to.getTime() + DAY) });

const row = (key, label, value, extra = {}) => ({ key, label, value, ...extra });
const distinct = (list) => new Set(list.map(String)).size;

/** Weeks of pregnancy on a day, from the EDD (null without one). */
function gaWeeks(edd, day) {
  if (!edd) return null;
  const days = Math.floor((new Date(day).getTime() - (new Date(edd).getTime() - 280 * DAY)) / DAY);
  return days < 0 ? null : days / 7;
}

export async function monthlyReport(tenantId, month) {
  const range = monthRange(month);
  const { from, to } = range;

  // ---- Registrations and outpatients ----
  // (a record marked as a duplicate of another is not counted: one person, one registration)
  const registered = (await Patient.find({ tenantId, createdAt: around(range), ...NOT_DUPLICATE }, { careType: 1, createdAt: 1, pregnancy: 1, risk: 1 }).lean()).filter((p) => inMonth(p.createdAt, range));
  // A visit or a lab result on a record marked as a duplicate is hers: every one is counted, under her main record,
  // so that one woman counts once (the same rule as Analytics – analytics/load.js#underMainRecord). Nothing is moved.
  const mainOf = await mainRecordOf(tenantId);
  const person = (id) => mainOf.get(String(id)) ?? String(id);
  const recordsOf = new Map(); // main record -> its duplicates
  for (const [dup, main] of mainOf) recordsOf.set(main, [...(recordsOf.get(main) ?? []), dup]);
  const visits = (await Visit.find({ tenantId, status: 'active', visitOn: { $gte: from, $lt: to } }, { patientId: 1, careType: 1, visitOn: 1, vitals: 1 }).lean()).map((v) => ({ ...v, patientId: person(v.patientId) }));
  const visitPatients = [...new Set(visits.map((v) => v.patientId))];
  // (her earlier visits may be on a duplicate record of hers)
  const theirRecords = visitPatients.flatMap((p) => [p, ...(recordsOf.get(p) ?? [])]);
  const earlier = new Set((await Visit.distinct('patientId', { tenantId, status: 'active', visitOn: { $lt: from }, patientId: { $in: theirRecords } })).map((id) => person(id)));
  const firstVisitSeen = new Set();
  let newVisits = 0;
  for (const v of [...visits].sort((a, b) => a.visitOn - b.visitOn)) {
    const p = String(v.patientId);
    if (!earlier.has(p) && !firstVisitSeen.has(p)) {
      newVisits += 1;
      firstVisitSeen.add(p);
    }
  }

  // ---- Lab results reported in the month (each test once) ----
  const labOrders = (await LabOrder.find({ tenantId, status: { $in: ['reported', 'reviewed'] }, 'reported.at': around(range) }, { patientId: 1, tests: 1, reported: 1, collected: 1 }).lean()).filter((o) => inMonth(o.reported?.at, range));
  const labTests = labOrders.flatMap((o) => o.tests.map((t) => ({ ...t, patientId: person(o.patientId) })));
  const valueOf = (t, key) => t.values?.find((v) => v.key === key);
  const testedWith = (testKeys, fieldKey, isPositive) => {
    const tested = labTests.filter((t) => testKeys.includes(t.key) && valueOf(t, fieldKey)?.value);
    return { tested: distinct(tested.map((t) => t.patientId)), positive: distinct(tested.filter((t) => isPositive(valueOf(t, fieldKey))).map((t) => t.patientId)) };
  };

  // ---- Antenatal care ----
  const antenatalNew = registered.filter((p) => p.careType === 'antenatal');
  const firstTrimester = antenatalNew.filter((p) => {
    const w = gaWeeks(p.pregnancy?.effectiveEdd, hospitalToday(new Date(p.createdAt)));
    return w != null && w < 13;
  }).length;
  const ancVisits = visits.filter((v) => v.careType === 'antenatal');
  // Hb: the lowest of the month per woman, from visits and lab results (CBC or Hb)
  const lowestHb = new Map();
  const noteHb = (pid, hb) => {
    const n = Number(hb);
    if (Number.isFinite(n) && n > 0) lowestHb.set(pid, Math.min(lowestHb.get(pid) ?? Infinity, n));
  };
  const antenatalIds = new Set((await Patient.find({ tenantId, careType: 'antenatal', _id: { $in: [...new Set([...visitPatients, ...labTests.map((t) => t.patientId)])] } }, { _id: 1 }).lean()).map((p) => String(p._id)));
  for (const v of ancVisits) if (v.vitals?.hb != null) noteHb(String(v.patientId), v.vitals.hb);
  for (const t of labTests) if (antenatalIds.has(t.patientId) && ['cbc', 'hb'].includes(t.key)) noteHb(t.patientId, valueOf(t, 'hb')?.value);
  const hbValues = [...lowestHb.values()];
  const highBp = distinct(ancVisits.filter((v) => (v.vitals?.bpSystolic ?? 0) >= 140 || (v.vitals?.bpDiastolic ?? 0) >= 90).map((v) => v.patientId));
  const ogtt = testedWith(['ogtt'], 'glucose2h', (v) => Number(v.value) >= 140);
  const hiv = testedWith(['hiv'], 'hiv', (v) => v.value === 'Reactive');
  const vdrl = testedWith(['vdrl'], 'vdrl', (v) => v.value === 'Reactive');
  const hbsag = testedWith(['hbsag'], 'hbsag', (v) => v.value === 'Reactive');

  // Care-plan items marked done in the month (vaccinations and postnatal checks)
  const plans = await CarePlan.find(
    { tenantId, 'items.done.on': { $gte: from, $lt: to } },
    { careType: 1, 'items.key': 1, 'items.kind': 1, 'items.state': 1, 'items.done.on': 1, 'items.done.elsewhere': 1 },
  ).lean();
  const doneThisMonth = (it) => it.state === 'done' && it.done?.on >= from && it.done?.on < to;
  const doneInMonth = (keys) => plans.reduce((n, p) => n + p.items.filter((it) => keys.includes(it.key) && doneThisMonth(it)).length, 0);
  // Pregnancy scans done here: scan items of antenatal care plans ticked as done in the month, not "done elsewhere"
  const scansDone = plans
    .filter((p) => p.careType === 'antenatal')
    .reduce((n, p) => n + p.items.filter((it) => it.kind === 'scan' && doneThisMonth(it) && !it.done?.elsewhere).length, 0);

  // ---- Deliveries (confirmed delivery notes) ----
  const deliveryNotes = (await ClinicalDocument.find({ tenantId, kind: 'delivery', status: 'signed' }, { content: 1 }).lean()).filter((d) => {
    const at = d.content?.deliveredAt;
    return at && inMonth(at, range);
  });
  const mode = (m) => deliveryNotes.filter((d) => d.content.mode === m).length;
  const babies = deliveryNotes.flatMap((d) => d.content.babies ?? []);
  const live = babies.filter((b) => b.outcome === 'live');
  const still = babies.filter((b) => b.outcome === 'stillbirth');
  // (the kind of stillbirth is recorded on delivery notes from 5 Oct 2026; older notes have none)
  const stillOf = (type) => still.filter((b) => (b.stillbirthType || '') === type).length;

  // ---- Deaths recorded on the records in the month (by the day of death) ----
  // A baby's record: a newborn death in the first 28 days of life (days 0 to 27), early in the first 7; every other
  // record: a maternal death during pregnancy, during delivery or within 24 hours after it, or from 24 hours up to 42
  // days after it – as the doctor chose when recording it (an accident or a cause not related to the pregnancy is
  // "other"). A record marked as a duplicate is not counted (the death is on her main record).
  const deaths = await Patient.find({ tenantId, ...NOT_DUPLICATE, 'death.on': { $gte: from, $lt: to } }, { careType: 1, 'death.on': 1, 'death.place': 1, 'death.timing': 1, 'death.ageDays': 1 }).lean();
  const babyDeaths = deaths.filter((p) => p.careType === 'newborn');
  const ageOf = (p) => (Number.isFinite(p.death?.ageDays) ? p.death.ageDays : null);
  const newbornDeaths = babyDeaths.filter((p) => ageOf(p) != null && ageOf(p) < NEONATAL_DAYS);
  const otherDeaths = deaths.filter((p) => p.careType !== 'newborn');
  const maternal = otherDeaths.filter((p) => MATERNAL_DEATH_TIMINGS.includes(p.death?.timing));
  const timingOf = (t) => otherDeaths.filter((p) => p.death?.timing === t).length;

  // ---- Pregnancy loss (Abortion type of care), by the date seen; surgery by the date of management ----
  const lossRecords = await Patient.find(
    { tenantId, careType: 'abortion', ...NOT_DUPLICATE, $or: [{ 'abortion.presentedOn': { $gte: from, $lt: to } }, { 'abortion.management.on': { $gte: from, $lt: to } }] },
    { 'abortion.lossType': 1, 'abortion.presentedOn': 1, 'abortion.management': 1 },
  ).lean();
  const seenInMonth = lossRecords.filter((p) => p.abortion?.presentedOn >= from && p.abortion.presentedOn < to);
  const lossOf = (types) => seenInMonth.filter((p) => types.includes(p.abortion.lossType)).length;
  const surgical = lossRecords.filter((p) => {
    const m = p.abortion?.management;
    return SURGICAL_METHODS.includes(m?.method) && m.on >= from && m.on < to;
  }).length;
  // Records still to complete, whatever the month: no type of loss chosen yet, or one no longer used (an old
  // threatened miscarriage: another type of loss, or the type of care changed to antenatal)
  const lossToTidy = await Patient.countDocuments({
    tenantId,
    careType: 'abortion',
    ...NOT_DUPLICATE,
    $or: [{ abortion: null }, { 'abortion.lossType': null }, { 'abortion.lossType': { $in: RETIRED_LOSS_TYPES.map((t) => t.key) } }],
  });

  // ---- Inpatients ----
  const admitted = (await Admission.find({ tenantId, admittedAt: around(range) }, { admittedAt: 1 }).lean()).filter((a) => inMonth(a.admittedAt, range)).length;
  const discharged = (await Admission.find({ tenantId, dischargedAt: around(range) }, { dischargedAt: 1 }).lean()).filter((a) => inMonth(a.dischargedAt, range)).length;
  const operations = (await ClinicalDocument.find({ tenantId, kind: 'operation', status: 'signed' }, { content: 1 }).lean()).filter((d) => d.content?.performedAt && inMonth(d.content.performedAt, range)).length;

  const sections = [
    {
      key: 'registrations',
      title: 'Registrations and outpatients',
      rows: [
        row('registered', 'New patients registered', registered.length),
        ...CARE_TYPES.map((t) => row(`registered_${t}`, `– ${CARE_WORDS[t] ?? t}`, registered.filter((p) => p.careType === t).length, { sub: true })),
        row('visits', 'Outpatient visits', visits.length),
        row('visits_new', '– first visit of the patient', newVisits, { sub: true }),
        row('visits_follow', '– follow-up visits', visits.length - newVisits, { sub: true }),
      ],
    },
    {
      key: 'anc',
      title: 'Antenatal care',
      rows: [
        row('anc_registered', 'Pregnant women registered for antenatal care', antenatalNew.length),
        row('anc_first_trimester', '– registered within the first trimester (before 13 weeks)', firstTrimester, { sub: true }),
        row('anc_visits', 'Antenatal check-ups (visits)', ancVisits.length),
        row('td1', 'Td 1 given', doneInMonth(['vacc_td1'])),
        row('td2', 'Td 2 or booster given', doneInMonth(['vacc_td2', 'vacc_tdap'])),
        row('hb_tested', 'Pregnant women with Hb tested', hbValues.length),
        row('hb_below11', '– Hb below 11 g/dL (anaemia)', hbValues.filter((h) => h < 11).length, { sub: true }),
        row('hb_below7', '– Hb below 7 g/dL (severe anaemia)', hbValues.filter((h) => h < 7).length, { sub: true }),
        row('high_bp', 'Pregnant women with BP 140/90 or more at a visit', highBp),
        row('ogtt_tested', 'Tested for diabetes (OGTT)', ogtt.tested),
        row('ogtt_positive', '– 2-hour glucose 140 mg/dL or more (GDM)', ogtt.positive, { sub: true }),
        row('vdrl_tested', 'Tested for syphilis', vdrl.tested),
        row('vdrl_positive', '– reactive', vdrl.positive, { sub: true }),
        row('hiv_tested', 'Tested for HIV', hiv.tested),
        row('hiv_positive', '– reactive', hiv.positive, { sub: true }),
        row('hbsag_tested', 'Tested for hepatitis B', hbsag.tested),
        row('hbsag_positive', '– reactive', hbsag.positive, { sub: true }),
        row('anc_high_risk', 'Registered this month and high risk now', antenatalNew.filter((p) => p.risk?.level === 'high').length),
      ],
    },
    {
      key: 'deliveries',
      title: 'Deliveries and births (confirmed delivery notes)',
      rows: [
        row('deliveries', 'Deliveries', deliveryNotes.length),
        row('del_normal', '– normal vaginal', mode('normal'), { sub: true }),
        row('del_assisted', '– assisted (vacuum or forceps)', mode('vacuum') + mode('forceps'), { sub: true }),
        row('del_caesarean', '– caesarean section', mode('lscs'), { sub: true }),
        row('del_preterm', 'Deliveries before 37 weeks', deliveryNotes.filter((d) => d.content.gestationWeeks != null && d.content.gestationWeeks < 37).length),
        row('live_births', 'Live births', live.length),
        row('live_male', '– male', live.filter((b) => b.sex === 'male').length, { sub: true }),
        row('live_female', '– female', live.filter((b) => b.sex === 'female').length, { sub: true }),
        row('lbw', '– weighing less than 2500 g', live.filter((b) => b.weightGrams != null && b.weightGrams < 2500).length, { sub: true }),
        row('still_births', 'Still births', still.length),
        row('still_fresh', '– fresh', stillOf('fresh'), { sub: true }),
        row('still_macerated', '– macerated', stillOf('macerated'), { sub: true }),
        row('still_kind_not_recorded', '– fresh or macerated not recorded', stillOf(''), { sub: true }),
      ],
    },
    {
      key: 'loss',
      title: 'Pregnancy loss (Abortion type of care)',
      rows: [
        row('loss_total', 'Women seen for pregnancy loss', lossOf([...MISCARRIAGE, 'ectopic', 'molar'])),
        row('loss_miscarriage', '– miscarriage (inevitable, incomplete, complete, missed, septic)', lossOf(MISCARRIAGE), { sub: true }),
        row('loss_ectopic', '– ectopic pregnancy', lossOf(['ectopic']), { sub: true }),
        row('loss_molar', '– molar pregnancy', lossOf(['molar']), { sub: true }),
        row('loss_recurrent', 'Recurrent pregnancy loss work-up (not counted above)', lossOf(['recurrent'])),
        row('loss_surgical', 'Surgical management in the month', surgical),
        row('loss_to_tidy', 'Abortion records with no type of loss yet, or an old threatened miscarriage (all months)', lossToTidy),
      ],
    },
    {
      key: 'pnc',
      title: 'Postnatal care',
      rows: [
        row('pnc_48h', 'Postnatal check within 24–48 hours (care plan)', doneInMonth(['pnc_day1'])),
        row('pnc_visits', 'Postnatal visits', visits.filter((v) => v.careType === 'postnatal').length),
        row('pnc_6w', 'Six-week postnatal check (care plan)', doneInMonth(['pnc_wk6'])),
      ],
    },
    {
      key: 'inpatients',
      title: 'Inpatients',
      rows: [row('admissions', 'Admissions', admitted), row('discharges', 'Discharges', discharged), row('operations', 'Operations (confirmed operation notes)', operations)],
    },
    {
      key: 'immunisation',
      title: 'Child immunisation (marked done in the care plan)',
      rows: [
        row('imm_birth', 'Birth doses (BCG, OPV-0, Hepatitis B)', doneInMonth(['nb_vacc_birth'])),
        row('imm_6w', '6 weeks (OPV-1, Pentavalent-1, Rotavirus-1, fIPV-1, PCV-1)', doneInMonth(['nb_vacc_6w'])),
        row('imm_10w', '10 weeks (OPV-2, Pentavalent-2, Rotavirus-2)', doneInMonth(['nb_vacc_10w'])),
        row('imm_14w', '14 weeks (OPV-3, Pentavalent-3, Rotavirus-3, fIPV-2, PCV-2)', doneInMonth(['nb_vacc_14w'])),
        row('imm_9m', '9 months (MR-1, PCV booster, fIPV-3)', doneInMonth(['nb_vacc_9m'])),
        row('imm_16m', '16–24 months (MR-2, DPT booster-1, OPV booster)', doneInMonth(['nb_vacc_16m'])),
        row('imm_5y', '5–6 years (DPT booster-2)', doneInMonth(['nb_vacc_5y'])),
        row('imm_td', '10 and 16 years (Td)', doneInMonth(['nb_vacc_10y', 'nb_vacc_16y'])),
      ],
    },
    {
      key: 'diagnostics',
      title: 'Scans and lab',
      rows: [
        row('scans_done', 'Pregnancy scans done here (marked done in the care plan)', scansDone),
        row('lab_tests', 'Lab tests reported', labTests.length),
        row('lab_abnormal', '– outside the usual range', labTests.filter((t) => t.values?.some((v) => isAbnormal(v.flag))).length, { sub: true }),
      ],
    },
    {
      key: 'deaths',
      title: 'Deaths (recorded on the records by a doctor)',
      rows: [
        row('newborn_deaths', 'Newborn deaths (in the first 28 days of life)', newbornDeaths.length),
        row('newborn_deaths_early', '– in the first 7 days', newbornDeaths.filter((p) => ageOf(p) < EARLY_NEONATAL_DAYS).length, { sub: true }),
        row('newborn_deaths_day0', '– on the day of birth', newbornDeaths.filter((p) => ageOf(p) === 0).length, { sub: true }),
        row('newborn_deaths_here', '– at this hospital', newbornDeaths.filter((p) => p.death?.place === 'here').length, { sub: true }),
        row('baby_deaths_later', 'Deaths of babies 28 days or older', babyDeaths.filter((p) => ageOf(p) != null && ageOf(p) >= NEONATAL_DAYS).length),
        row('baby_deaths_age_unknown', 'Deaths of babies whose time of birth is not on the record', babyDeaths.filter((p) => ageOf(p) == null).length),
        row('maternal_deaths', 'Maternal deaths (during pregnancy or within 42 days after it)', maternal.length),
        row('maternal_pregnancy', '– during pregnancy', timingOf('pregnancy'), { sub: true }),
        row('maternal_delivery', '– during delivery or within 24 hours after it', timingOf('delivery'), { sub: true }),
        row('maternal_postpartum', '– from 24 hours up to 42 days after delivery or the end of the pregnancy', timingOf('postpartum'), { sub: true }),
        row('other_deaths', 'Other deaths (an accident or a cause not related to the pregnancy, or later)', timingOf('other') + otherDeaths.filter((p) => !p.death?.timing).length),
      ],
    },
  ];
  const notes = [
    'Pregnancy scans count only scans ticked as done here in the care plan.',
    'Pregnancy loss is counted by the date seen.',
    'Stillbirths come from confirmed delivery notes; deaths from the deaths a doctor recorded on the records, by the day of death.',
    `The definitions of a newborn and a maternal death are a DRAFT for a doctor to check. Source: ${DEATH_DEFINITIONS_SOURCE}.`,
  ];
  return { month, from, to, sections, notes };
}

/** The last `months` months (this one included): the numbers of the owner's charts. */
export async function monthlyTrend(tenantId, endMonth, months = 12) {
  const [y, m] = endMonth.split('-').map(Number);
  const list = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
  const { from } = monthRange(list[0]);
  const { to } = monthRange(list.at(-1));
  const range = { from, to };
  const monthOfDay = (d) => hospitalToday(new Date(d)).toISOString().slice(0, 7);
  const tally = (dates) => {
    const out = Object.fromEntries(list.map((k) => [k, 0]));
    for (const d of dates) {
      const k = monthOfDay(d);
      if (k in out) out[k] += 1;
    }
    return list.map((k) => out[k]);
  };
  const [patients, visits, deliveries, admissions] = await Promise.all([
    Patient.find({ tenantId, createdAt: around(range), ...NOT_DUPLICATE }, { createdAt: 1 }).lean(),
    Visit.find({ tenantId, status: 'active', visitOn: { $gte: from, $lt: to } }, { visitOn: 1 }).lean(),
    ClinicalDocument.find({ tenantId, kind: 'delivery', status: 'signed' }, { 'content.deliveredAt': 1, 'content.mode': 1 }).lean(),
    Admission.find({ tenantId, admittedAt: around(range) }, { admittedAt: 1 }).lean(),
  ]);
  const delivered = deliveries.filter((d) => d.content?.deliveredAt);
  return {
    months: list,
    series: [
      { key: 'registered', label: 'New patients registered', values: tally(patients.map((p) => p.createdAt)) },
      { key: 'visits', label: 'Outpatient visits', values: tally(visits.map((v) => v.visitOn)) },
      { key: 'deliveries', label: 'Deliveries', values: tally(delivered.map((d) => d.content.deliveredAt)) },
      { key: 'caesareans', label: 'Caesarean deliveries', values: tally(delivered.filter((d) => d.content.mode === 'lscs').map((d) => d.content.deliveredAt)) },
      { key: 'admissions', label: 'Admissions', values: tally(admissions.map((a) => a.admittedAt)) },
    ],
  };
}
