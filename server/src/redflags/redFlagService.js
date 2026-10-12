// Red flags from the database: the hospital's rule set, and the flags of a visit, a patient or many patients.
// Flags are worked out when they are read (never stored), so they always follow the current rules and the
// latest recorded values: a visit or a chart entry marked "entered in error" stops counting at once, and a lab
// report counts from the moment the lab reports it (and again, with the new values, when it is amended).

import { addDays, dayZero, hospitalToday, toHospitalDate, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { LabOrder } from '../models/LabOrder.js';
import { NursingEntry } from '../models/NursingEntry.js';
import { Patient } from '../models/Patient.js';
import { RedFlagRuleSet } from '../models/RedFlagRuleSet.js';
import { Visit } from '../models/Visit.js';
import { eddInUse, pregnancySince } from '../patients/pregnancyFindings.js';
import { NOT_PREGNANT_NOW } from '../patients/abortionRules.js';
import { lossLocationOn, lossRedFlagFacts } from '../patients/lossFindings.js';
import {
  BUILT_IN_RED_FLAG_RULES,
  BUILT_IN_RED_FLAG_VERSION,
  BUILT_IN_SINCE,
  chartReadings,
  evaluateRedFlags,
  flagFromLabOnly,
  flagLatestDay,
  labReadings,
  labTestKeysOf,
  redFlagFacts,
  ruleCareTypes,
} from './redFlags.js';

/**
 * The hospital's red-flag rules, created from the built-in draft on first use. A draft that no doctor has
 * edited (and that is not approved) gets newer built-in rules when they change. Rules a doctor approved or
 * changed are never changed here: newer built-in rules are offered instead (newBuiltInRules).
 */
export async function ensureRedFlagRules(tenantId) {
  await RedFlagRuleSet.updateOne(
    { tenantId, set: 'standard' },
    {
      $setOnInsert: {
        rules: BUILT_IN_RED_FLAG_RULES,
        builtInVersion: BUILT_IN_RED_FLAG_VERSION,
        builtInSeenVersion: BUILT_IN_RED_FLAG_VERSION,
        status: 'draft',
        version: 1,
        updatedByName: 'Built-in draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, timestamps: false },
  ).catch((e) => {
    if (e?.code !== 11000) throw e; // created by another request at the same moment
  });
  const set = await RedFlagRuleSet.findOne({ tenantId, set: 'standard' });
  if (set.status === 'draft' && set.builtInVersion != null && set.builtInVersion < BUILT_IN_RED_FLAG_VERSION) {
    set.rules = BUILT_IN_RED_FLAG_RULES;
    set.builtInVersion = BUILT_IN_RED_FLAG_VERSION;
    set.builtInSeenVersion = BUILT_IN_RED_FLAG_VERSION;
    set.version += 1;
    set.updatedByName = 'Built-in draft';
    await set.save().catch(() => {}); // changed at the same moment: the next read upgrades it
  }
  return set;
}

/** The built-in version a rule set was made from or last offered (not recorded before version 2: version 1). */
export const seenBuiltInVersion = (set) => set.builtInSeenVersion ?? set.builtInVersion ?? 1;

/**
 * Built-in rules that came after the version this rule set was made from, and are not in it: offered to a doctor,
 * who adds them as a new draft. Nothing for a set that is still the current built-in one.
 */
export function newBuiltInRules(set) {
  if (set.builtInVersion === BUILT_IN_RED_FLAG_VERSION) return [];
  const seen = seenBuiltInVersion(set);
  const have = new Set(set.rules.map((r) => r.key));
  return BUILT_IN_RED_FLAG_RULES.filter((r) => (BUILT_IN_SINCE[r.key] ?? 1) > seen && !have.has(r.key));
}

/** The types of care the rules cover, in a fixed order (a patient of another type has no red flags). */
const coveredCareTypes = (set) => [...new Set(set.rules.flatMap((r) => ruleCareTypes(r)))];

/**
 * Which rules produced the flags (shown with them: "draft rules" until a doctor approves), and the types of care
 * they cover – so every page can say which patients are checked and which are not.
 */
export const rulesInfo = (set) => ({
  status: set.status,
  version: set.version,
  approvedByName: set.status === 'approved' ? set.approvedByName : null,
  careTypes: coveredCareTypes(set),
});

/** The types of care the hospital's rules cover (a patient of another type has no red flags). */
export async function redFlagCareTypes(tenantId) {
  return coveredCareTypes(await ensureRedFlagRules(tenantId));
}

// How far back "this episode of care" goes when the record has no day to count from.
export const POSTNATAL_EPISODE_DAYS = 42; // after delivery: six weeks
export const OTHER_EPISODE_DAYS = 90; // gynaecology, infertility, pregnancy loss: the last three months

// A record still in pregnancy care whose delivery in THIS pregnancy is on the record (a doctor confirmed the
// delivery note; the type of care is changed by hand, usually later): she has delivered. With pregnancy dates: a
// delivery on or after the first day of this pregnancy. Without dates (she came in labour, unbooked): a delivery in
// the last six weeks – no later pregnancy can be far enough along by then for the pregnancy rules to matter.
function deliveredThisPregnancy(patient, now) {
  if (patient.careType !== 'antenatal' || !patient.lastDelivery?.at) return false;
  const day = toHospitalDate(patient.lastDelivery.at);
  const edd = eddInUse(patient);
  return edd ? day >= dayZero(edd) : day >= addDays(hospitalToday(now), -POSTNATAL_EPISODE_DAYS);
}
// The delivery on the record: its day, and its moment when a delivery note gave the time (a delivery at another
// hospital is typed as a date only).
const deliveryStart = (patient) => ({ since: toHospitalDate(patient.lastDelivery.at), sinceAt: patient.lastDelivery.documentId ? new Date(patient.lastDelivery.at) : null });

// A pregnancy-loss record that is only for the recurrent-loss work-up: she is not pregnant now, and every rule for
// pregnancy-loss care is about a loss cared for now (a ruptured ectopic, a septic abortion, bleeding after the loss)
// – so none is checked for her, as for a type of care with no rule (a fever from another cause is never called a
// septic abortion).
const notALossNow = (patient) => patient.careType === 'abortion' && NOT_PREGNANT_NOW.includes(patient.abortion?.lossType);

/**
 * Whose rules are used for a patient, and from when values count ("this pregnancy or episode of care"):
 * { careType, visitTypes, since, sinceAt, delivered, notALossNow }.
 *  - careType: the type of care whose rules are used – the record's own, except that a mother still recorded as
 *    pregnancy care after the delivery of this pregnancy was confirmed is checked with the rules for care after
 *    delivery (delivered: true), not with pregnancy rules such as "41 weeks or more – plan delivery". When the
 *    hospital has no rule for care after delivery (postnatalRules: false – rules approved before there were any),
 *    her pregnancy rules stay in use rather than nothing, only without "weeks of pregnancy today";
 *  - visitTypes: the visits that count (of the record's type of care; after such a delivery also postnatal ones);
 *  - since: the first day that counts (a date; null: everything on the record). Only visits, lab results and
 *    chart entries from then on raise flags:
 *      pregnancy care: two weeks before the LMP-equivalent of the EDD in use (without dates: the last 42 weeks);
 *      after delivery: the day of the delivery on the record (without one: the last six weeks);
 *      a baby: the day of birth (without one: everything on the baby's record);
 *      other types of care: the last three months (in pregnancy-loss care also for the findings on her record:
 *      one recorded longer ago no longer raises a flag);
 *  - sinceAt: the moment of the delivery when a delivery note gave its time – values with a time of their own
 *    (the nursing chart, lab samples, a visit started that day) count only from then, so a BP charted in labour is
 *    not "after delivery";
 *  - notALossNow: a pregnancy-loss record that is only for the recurrent-loss work-up – not checked at all.
 */
export function flagEpisode(patient, now = new Date(), { postnatalRules = true } = {}) {
  const today = hospitalToday(now);
  const own = { careType: patient.careType, visitTypes: [patient.careType], sinceAt: null, delivered: false, notALossNow: notALossNow(patient) };
  const delivered = deliveredThisPregnancy(patient, now);
  if (delivered && postnatalRules) return { ...own, careType: 'postnatal', visitTypes: ['antenatal', 'postnatal'], delivered, ...deliveryStart(patient) };
  if (patient.careType === 'antenatal') return { ...own, delivered, since: pregnancySince(patient, now) };
  if (patient.careType === 'postnatal') return patient.lastDelivery?.at ? { ...own, ...deliveryStart(patient) } : { ...own, since: addDays(today, -POSTNATAL_EPISODE_DAYS) };
  if (patient.careType === 'newborn') return { ...own, since: patient.newborn?.birthAt ? toHospitalDate(patient.newborn.birthAt) : null };
  return { ...own, since: addDays(today, -OTHER_EPISODE_DAYS) };
}
/** The first day of this pregnancy or episode of care (flagEpisode().since). */
export const episodeSince = (patient, now = new Date()) => flagEpisode(patient, now).since;

// Is a visit part of the episode? A visit has only its day. On the day of a delivery whose time is known, a visit
// started that day counts when it was started after the delivery (a visit entered later for that day counts).
function visitInEpisode(visit, { since, sinceAt }) {
  if (!since) return true;
  const day = utcDay(visit.visitOn).getTime();
  if (day !== since.getTime()) return day > since.getTime();
  if (!sinceAt || !visit.createdAt || toHospitalDate(visit.createdAt).getTime() !== day) return true;
  return visit.createdAt.getTime() >= sinceAt.getTime();
}

const VISIT_FIELDS = 'patientId visitOn createdAt status careType vitals details.fundalHeightCm details.fetalHeartRate details.presentation details.fetalMovements details.oedema';
const ORDER_FIELDS = 'patientId status tests.key tests.values collected.at collectedAtReport reported.at createdAt';
const newestFirst = (a, b) => b.visitOn - a.visitOn || b.createdAt - a.createdAt;
const newbornOf = (patient) => (patient.careType === 'newborn' ? { birthAt: patient.newborn?.birthAt ?? null, birthWeightGrams: patient.newborn?.birthWeightGrams ?? null } : null);
// Pregnancy-loss care: what the rules read from her record – where the pregnancy is today (while it can still
// rupture), and the findings recorded in this episode of care (since), each from the day it was recorded.
const lossOf = (patient, since, now) => (patient.careType === 'abortion' ? lossRedFlagFacts(patient.abortion, { since, today: hospitalToday(now) }) : null);

/**
 * The red flags of a visit (for the visit page): from the values saved at this visit only – not lab results or
 * the nursing chart, which are on the patient's record. Only a visit of the patient's present type of care that
 * is not marked "entered in error"; undefined otherwise. A visit after the confirmed delivery of this pregnancy
 * is checked with the rules for care after delivery; an earlier visit of that pregnancy keeps its pregnancy flags,
 * without "weeks of pregnancy today".
 * { flags, visitId, visitOn, rules }
 */
export async function redFlagsForVisit(ctx, patient, visit) {
  if (visit.careType !== patient.careType || visit.status !== 'active') return undefined;
  const set = await ensureRedFlagRules(ctx.tenantId);
  const now = ctx.now ?? new Date();
  const episode = flagEpisode(patient, now, { postnatalRules: coveredCareTypes(set).includes('postnatal') });
  if (episode.notALossNow) return { flags: [], visitId: String(visit._id), visitOn: visit.visitOn, rules: rulesInfo(set) };
  const careType = episode.careType !== patient.careType && visitInEpisode(visit, episode) ? episode.careType : patient.careType;
  // Weight gain (pregnancy care): the visit before this one that has a weight
  let previousWeighed = null;
  if (careType === 'antenatal' && visit.vitals?.weightKg != null) {
    const earlier = await Visit.find(
      { tenantId: ctx.tenantId, patientId: patient._id, status: 'active', careType: 'antenatal', _id: { $ne: visit._id }, 'vitals.weightKg': { $ne: null }, visitOn: { $gte: pregnancySince(patient, now) } },
      VISIT_FIELDS,
    )
      .sort({ visitOn: -1, createdAt: -1 })
      .lean();
    previousWeighed = earlier.find((v) => v.visitOn < visit.visitOn || (v.visitOn.getTime() === visit.visitOn.getTime() && v.createdAt < visit.createdAt)) ?? null;
  }
  // Pregnancy-loss care: only where the pregnancy was at this visit (so that its pulse or BP can raise "possible
  // ruptured ectopic" – never for a visit after the operation, or one of an earlier loss). The findings ticked on her
  // record are not values of this visit: the record's own flags show them.
  const loss = patient.careType === 'abortion' ? { location: lossLocationOn(patient.abortion, visit.visitOn), findings: {} } : null;
  const facts = redFlagFacts({ careType, visit, previousWeighed, edd: patient.pregnancy?.effectiveEdd ?? null, today: hospitalToday(now), newborn: newbornOf(patient), delivered: episode.delivered, loss });
  return { flags: evaluateRedFlags(set.rules, facts), visitId: String(visit._id), visitOn: visit.visitOn, rules: rulesInfo(set) };
}

// What the flags need from a patient's record. A caller may hand over patients read with fewer fields (a list's
// columns): those are read again here, so the result never depends on what the caller happened to load – the
// Patients list, the record, Today and the stay page always agree.
const NEEDED_FIELDS = ['careType', 'pregnancy.effectiveEdd', 'pregnancy.lmp', 'pregnancy.scanEdd', 'lastDelivery.at', 'lastDelivery.documentId', 'newborn.birthAt', 'newborn.birthWeightGrams', 'abortion.lossType', 'abortion.findings', 'abortion.management', 'abortion.presentedOn'];
async function withNeededFields(tenantId, patients) {
  const partial = patients.filter((p) => typeof p.isSelected === 'function' && NEEDED_FIELDS.some((f) => !p.isSelected(f)));
  if (!partial.length) return patients;
  const read = await Patient.find({ tenantId, _id: { $in: partial.map((p) => p._id) } }, NEEDED_FIELDS.join(' ')).lean();
  const fresh = new Map(read.map((p) => [String(p._id), p]));
  return patients.map((p) => (partial.includes(p) ? (fresh.get(String(p._id)) ?? p) : p));
}

// What the rules look at for these patients, read in a few queries: their visits, their reported lab orders (only
// the tests a rule checks), and – for those in hospital now – the vital signs on the nursing chart of the stay.
async function loadReadings(tenantId, set, patients) {
  const ids = patients.map((p) => p._id);
  const labKeys = labTestKeysOf(set.rules);
  const [visits, orders, stays] = await Promise.all([
    Visit.find({ tenantId, patientId: { $in: ids }, status: 'active' }, VISIT_FIELDS).lean(),
    labKeys.length ? LabOrder.find({ tenantId, patientId: { $in: ids }, status: { $in: ['reported', 'reviewed'] }, 'tests.key': { $in: labKeys } }, ORDER_FIELDS).lean() : [],
    Admission.find({ tenantId, patientId: { $in: ids }, status: 'admitted' }, 'patientId admittedAt').lean(),
  ]);
  const entries = stays.length
    ? await NursingEntry.find({ tenantId, admissionId: { $in: stays.map((s) => s._id) }, kind: 'vitals', cancelled: null }, 'patientId admissionId kind at vitals cancelled').lean()
    : [];
  const by = new Map(patients.map((p) => [String(p._id), { visits: [], orders: [], stay: null, entries: [] }]));
  for (const v of visits) by.get(String(v.patientId))?.visits.push(v);
  for (const o of orders) by.get(String(o.patientId))?.orders.push(o);
  for (const s of stays) if (by.has(String(s.patientId))) by.get(String(s.patientId)).stay = s;
  for (const e of entries) by.get(String(e.patientId))?.entries.push(e);
  return by;
}

/** One patient's current flags from what was read for her: { flags, visitId, visitOn, admissionId, careType }. */
function currentFlags(set, patient, episode, data, now) {
  const { careType, since, sinceAt } = episode;
  const own = data.visits.filter((v) => episode.visitTypes.includes(v.careType) && visitInEpisode(v, episode)).sort(newestFirst);
  const latest = own[0] ?? null;
  const facts = redFlagFacts({
    careType,
    visit: latest,
    previousWeighed: own.slice(1).find((v) => v.vitals?.weightKg != null) ?? null,
    edd: patient.pregnancy?.effectiveEdd ?? null,
    today: hospitalToday(now),
    chart: data.stay ? chartReadings(data.entries, { since, sinceAt }) : null,
    lab: labReadings(data.orders, { since, sinceAt, birthAt: patient.newborn?.birthAt ?? null }),
    newborn: newbornOf(patient),
    delivered: episode.delivered,
    loss: lossOf(patient, since, now),
  });
  return {
    flags: evaluateRedFlags(set.rules, facts),
    visitId: latest ? String(latest._id) : null,
    visitOn: latest?.visitOn ?? null,
    admissionId: data.stay ? String(data.stay._id) : null,
    careType,
  };
}

/**
 * The current red flags of many patients (any type of care that has a rule): from each one's latest visit of this
 * pregnancy or episode, the lab results reported in it, the nursing chart while she is in hospital, and rules on
 * today's weeks (which need no visit). Returns
 *  - byPatient: Map patientId → { flags, visitId, visitOn, admissionId, careType } (patients without flags are left out);
 *  - careTypes: Map patientId → the type of care whose rules were used for her (flagEpisode);
 *  - notChecked: the ids of the patients no rule applies to (their values are not checked at all – a page must not
 *    read "no flags" as "nothing wrong");
 *  - rules: the rules info.
 * recentDays (for a daily list, so that it does not only grow): a patient who is not in hospital is listed only for
 * flags whose values were recorded in the last so many days – except, in pregnancy care, the flags of her latest
 * visit and of today's weeks, which stay until the next visit as they always did (so a flag from a lab result
 * alone is listed for that many days). Her record keeps showing the older flags.
 */
export async function redFlagsForPatients(ctx, patients, { recentDays = null } = {}) {
  const set = await ensureRedFlagRules(ctx.tenantId);
  const now = ctx.now ?? new Date();
  const out = new Map();
  const covered = new Set(coveredCareTypes(set));
  const people = await withNeededFields(ctx.tenantId, patients);
  const episodes = new Map(people.map((p) => [String(p._id), flagEpisode(p, now, { postnatalRules: covered.has('postnatal') })]));
  const careTypes = new Map([...episodes].map(([id, e]) => [id, e.careType]));
  const checked = people.filter((p) => covered.has(careTypes.get(String(p._id))) && !episodes.get(String(p._id)).notALossNow);
  const notChecked = new Set(people.filter((p) => !checked.includes(p)).map((p) => String(p._id)));
  // Of those not checked: the records only for the recurrent-loss work-up (her type of care has rules, but none is
  // about her – the screens say so instead of "no rule applies to pregnancy-loss care")
  const workupOnly = new Set([...episodes].filter(([, e]) => e.notALossNow).map(([id]) => id));
  if (!checked.length) return { byPatient: out, careTypes, notChecked, workupOnly, rules: rulesInfo(set) };
  const readings = await loadReadings(ctx.tenantId, set, checked);
  const oldest = recentDays == null ? null : addDays(hospitalToday(now), -recentDays);
  for (const p of checked) {
    const data = readings.get(String(p._id));
    const found = currentFlags(set, p, episodes.get(String(p._id)), data, now);
    if (oldest && !data.stay) {
      found.flags = found.flags.filter((f) => {
        if (found.careType === 'antenatal' && !flagFromLabOnly(f)) return true;
        const day = flagLatestDay(f);
        return !day || day >= oldest;
      });
    }
    if (found.flags.length) out.set(String(p._id), found);
  }
  return { byPatient: out, careTypes, notChecked, workupOnly, rules: rulesInfo(set) };
}

/**
 * The current red flags of one patient (for the patient page and her stay in hospital). careType: the type of care
 * whose rules were used; checked: false when no rule applies to it (nothing was checked); workupOnly: not checked
 * because the record is only for the recurrent-loss work-up (the pregnancy-loss rules are about a loss cared for now).
 */
export async function redFlagsForPatient(ctx, patient) {
  const { byPatient, careTypes, notChecked, workupOnly, rules } = await redFlagsForPatients(ctx, [patient]);
  const id = String(patient._id);
  const found = byPatient.get(id);
  return {
    flags: found?.flags ?? [],
    visitId: found?.visitId ?? null,
    visitOn: found?.visitOn ?? null,
    admissionId: found?.admissionId ?? null,
    careType: careTypes.get(id),
    checked: !notChecked.has(id),
    workupOnly: workupOnly.has(id),
    rules,
  };
}
