// Build 13 – the NICU admission's work with the database: the hospital's units and NICU beds with who is in them
// (NEO-A-01), the pre-fill from the mother's record, the delivery note and the record at birth (PX-X-14), the ROP
// screening event in the baby's screening log (N3), the counselling task (N1), what each admission shows (banners and
// flags, N2–N6), and the NEO-A-05 numbers for the monthly dashboard. Every query names the hospital (tenantId); no
// aggregate().

import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { Admission } from '../models/Admission.js';
import { Bed } from '../models/Bed.js';
import { Membership } from '../models/Membership.js';
import { NewbornBirthCare, NicuAdmission, NicuRoster } from '../models/NewbornCare.js';
import { NewbornFollowUp } from '../models/NewbornFollowUp.js';
import { Patient, currentAge } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { notify } from '../notifications/notify.js';
import { patientAccess } from '../utils/patientAccess.js';
import { decisionToDeliveryMinutes } from './caesarean.js';
import { count, rate } from './dashboards.js';
import {
  COUNSEL_WITHIN_MIN,
  COMPLETE_WITHIN_MIN,
  GA_BANDS,
  LEVELS,
  NURSE_BABY_RATIO,
  TRANSFER_WITHIN_MIN,
  WEIGHT_BANDS,
  aabrDue,
  bandOf,
  belowFloor,
  completedInTime,
  counselledInTime,
  cranialUsgDue,
  defaultChart,
  hypoglycaemic,
  hypothermic,
  isInborn,
  isTransferOut,
  lateEntry,
  lengthOfStayDays,
  maturityClass,
  nicuUnitsFor,
  outsideCapability,
  registerLabel,
  ropEligible,
  ropFirstExamDue,
  sizeClass,
  survived,
  tempInRange,
} from './nicuAdmission.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const openFilter = { outcome: null, cancelled: null };

export async function unitsOf(tenantId) {
  return nicuUnitsFor(await Tenant.findById(tenantId, { nicu: 1 }).lean());
}

/** The hospital's NICU beds with who is in each: an open NICU admission on it, or an open stay (Admission). */
export async function nicuBeds(tenantId) {
  const beds = await Bed.find({ tenantId, active: true, nicu: { $ne: null } }).sort({ ward: 1, name: 1 }).lean();
  const ids = beds.map((b) => b._id);
  const [open, stays] = await Promise.all([
    NicuAdmission.find({ tenantId, bedId: { $in: ids }, ...openFilter }, { bedId: 1, patientId: 1, admittedAt: 1 }).lean(),
    Admission.find({ tenantId, status: 'admitted', bedId: { $in: ids } }, { bedId: 1, patientId: 1 }).lean(),
  ]);
  const inBed = new Map(open.map((n) => [String(n.bedId), n]));
  const stayIn = new Map(stays.map((s) => [String(s.bedId), s]));
  return beds.map((b) => ({ ...b, occupant: inBed.get(String(b._id)) ?? null, stay: stayIn.get(String(b._id)) ?? null, occupied: inBed.has(String(b._id)) || stayIn.has(String(b._id)) }));
}

/** Active members of the hospital with one of the roles (for the consultant and the admitting doctor). */
export async function memberWith(tenantId, userId, roles) {
  if (!userId) return null;
  const m = await Membership.findOne({ tenantId, userId, isActive: true, roles: { $in: roles } }, { userId: 1 }).lean();
  if (!m) return null;
  const u = await User.findById(userId, { name: 1 }).lean();
  return u ? { id: u._id, name: u.name } : null;
}

// ---------- PX-X-14: pre-filled from the linked records ----------
const MODE = { normal: 'svd', vacuum: 'vacuum', forceps: 'forceps', lscs: 'lscs' };
const ONSET = { spontaneous: 'spontaneous', induced: 'induced', not_in_labour: 'no_labour' };
const PRESENTATION = { cephalic: 'Cephalic', breech: 'Breech', transverse_oblique: 'Transverse / oblique' };
const RESUS = { none: 'none', stimulation: 'none', bagMask: 'ppv', intubation: 'intubated', compressions: 'compressions', medication: 'drugs' };
const yesNo = (v) => (v === 'yes' ? 'yes' : v === 'no' ? 'no' : null);

/** The mother's signed delivery note for this baby, and which baby on it (the link made at birth, else the note of that day). */
async function deliveryFor(tenantId, baby, motherId) {
  const link = baby.newborn?.fromDelivery;
  if (link?.documentId) {
    const doc = await ClinicalDocument.findOne({ _id: link.documentId, tenantId, kind: 'delivery' }).lean();
    if (doc) return { doc, index: link.index ?? 0 };
  }
  if (!motherId || !baby.newborn?.birthAt) return null;
  const born = new Date(baby.newborn.birthAt).getTime();
  const docs = (await ClinicalDocument.find({ tenantId, patientId: motherId, kind: 'delivery', status: 'signed' }).lean()).filter((d) => d.content?.deliveredAt && Math.abs(new Date(d.content.deliveredAt).getTime() - born) <= DAY);
  if (docs.length !== 1) return null;
  const live = (docs[0].content.babies ?? []).map((b, i) => (b.outcome === 'live' ? i : -1)).filter((i) => i >= 0);
  return live.length === 1 ? { doc: docs[0], index: live[0] } : null;
}

/**
 * What the linked records already say (PX-X-14): §1 values, which record each came from, the mother's allergies, and
 * the gestation and weight. The mother's record is read only when this person may see her pregnancy details; the
 * delivery note likewise (it is hers). Never overwrites what is typed – the form starts from it.
 */
export async function prefillFor(req, baby, motherId) {
  const values = { serology: {} };
  const from = {};
  const set = (k, v, src) => {
    if (v == null || v === '') return;
    values[k] = v;
    from[k] = src;
  };
  const out = { values, from, motherId: motherId ? String(motherId) : null, motherMrn: null, motherHidden: false, allergyAlert: '', gestationWeeks: null, weightGrams: baby.newborn?.birthWeightGrams ?? null, deliveryNoteId: null };
  const mother = motherId ? await Patient.findOne({ _id: motherId, tenantId: req.tenantId }) : null;
  const seeMother = mother && patientAccess(req, mother).view.has('pregnancy');
  if (mother) out.motherMrn = mother.mrn;
  if (mother && !seeMother) out.motherHidden = true;
  if (seeMother) {
    const birthAt = baby.newborn?.birthAt ? new Date(baby.newborn.birthAt) : new Date();
    set('motherAge', currentAge(mother, birthAt), 'mother');
    for (const k of ['gravida', 'para', 'living', 'abortions']) set(k, mother.obstetric?.[k] ?? null, 'mother');
    set('bloodGroup', mother.medical?.bloodGroup || null, 'mother');
    out.allergyAlert = mother.medical?.allergies ?? '';
    const c = new Set(mother.medical?.conditions ?? []);
    const problems = [c.has('diabetes') && 'gdm_dm', c.has('thyroid') && 'thyroid', c.has('anaemia') && 'anaemia'].filter(Boolean);
    if (problems.length) set('antenatalProblems', problems, 'mother');
    // A known condition is a positive result; its absence is not a negative test – those stay empty
    if (c.has('syphilis')) values.serology.vdrl = 'P';
    if (c.has('hepatitis_b')) values.serology.hbsag = 'P';
    if (c.has('hiv')) values.serology.hiv = 'P';
    if (Object.keys(values.serology).length) from.serology = 'mother';
    if (await Visit.exists({ tenantId: req.tenantId, patientId: mother._id, createdAt: { $lt: birthAt } })) set('booked', 'yes', 'mother');
    const d = await deliveryFor(req.tenantId, baby, mother._id);
    if (d) {
      const c2 = d.doc.content ?? {};
      const b = (c2.babies ?? [])[d.index] ?? {};
      out.deliveryNoteId = String(d.doc._id);
      set('deliveryMode', c2.mode === 'normal' && c2.presentation === 'breech' ? 'breech' : (MODE[c2.mode] ?? null), 'delivery');
      if (c2.mode === 'lscs') {
        set('lscsCategory', c2.csCategory ? Number(c2.csCategory) : null, 'delivery');
        set('lscsIndication', c2.indication || null, 'delivery');
        set('ddiMin', decisionToDeliveryMinutes(c2), 'delivery');
      }
      set('presentation', PRESENTATION[c2.presentation] ?? null, 'delivery');
      set('labourOnset', ONSET[c2.labourOnset] ?? null, 'delivery');
      set('apgar1', b.apgar1 ?? null, 'delivery');
      set('apgar5', b.apgar5 ?? null, 'delivery');
      out.gestationWeeks = c2.gestationWeeks ?? null;
      out.weightGrams ??= b.weightGrams ?? null;
    }
  }
  // The record at birth is on the baby's own record (NEO-F-01)
  const birth = await NewbornBirthCare.findOne({ tenantId: req.tenantId, patientId: baby._id, live: true }).lean();
  if (birth) {
    set('resuscitation', RESUS[birth.resuscitation] ? [RESUS[birth.resuscitation]] : null, 'birth');
    set('cordClamping', birth.cordClamping || null, 'birth');
    set('drTempC', birth.temperatureC, 'birth');
    set('skinToSkin', yesNo(birth.checks?.skinToSkin), 'birth');
    set('vitKGiven', yesNo(birth.checks?.vitaminK), 'birth');
    set('eyeCare', yesNo(birth.checks?.eyeCare), 'birth');
    set('bandsVerified', birth.idBandWitness ? 'yes' : null, 'birth');
  }
  return out;
}

// ---------- N3: the ROP screening event in the baby's screening log (NEO-F-15, Confirm 4) ----------
/**
 * Keeps the baby's ROP screen in her screening log in step with the admission: an eligible baby gets the screen with
 * the first-exam due date; the gestation is copied to the log when it has none. A screen already done is left as it is.
 */
export async function syncRopEvent(tenantId, baby, n, byName) {
  if (n.format !== 'f03' || n.cancelled) return null;
  const due = ropDueOf(n, baby);
  const log = await NewbornFollowUp.findOne({ tenantId, patientId: baby._id });
  const done = log?.records?.some((r) => r.kind === 'screen' && r.key === 'rop');
  if (done) return due;
  const events = (log?.events ?? []).filter((e) => !(e.key === 'rop' && String(e.admissionId) === String(n._id)));
  if (due) events.push({ key: 'rop', dueBy: due, admissionId: n._id, reason: 'nicu_admission', byName, at: new Date() });
  if (!log && !due) return null;
  const set = { events };
  if (log?.gestationWeeks == null && n.gestationWeeks != null) Object.assign(set, { gestationWeeks: n.gestationWeeks, gestationDays: n.gestationDays ?? 0 });
  await NewbornFollowUp.updateOne({ tenantId, patientId: baby._id }, { $set: set, $setOnInsert: { highRisk: false, highRiskReasons: [] } }, { upsert: true });
  return due;
}
export function ropDueOf(n, baby) {
  const eligible = ropEligible({ gaWeeks: n.gestationWeeks, weightGrams: n.weightGrams, unstableCourse: n.plan?.unstableCourse === 'yes' });
  return eligible ? ropFirstExamDue(baby?.newborn?.birthAt ?? n.admittedAt, n.gestationWeeks, n.gestationDays ?? 0) : null;
}

// ---------- What an admission shows: computed values, banners, flags ----------
const ventilatedOf = (n) => n.assessment?.respiratorySupport === 'ventilator' || n.outcome?.details?.ventilated === 'yes';
export function computedFor(n, baby, now) {
  const until = n.outcome?.at ?? now;
  const birthAt = baby?.newborn?.birthAt ?? null;
  return {
    maturityClass: maturityClass(n.gestationWeeks),
    sizeClass: sizeClass(n.assessment?.weightCentile),
    defaultChart: defaultChart(n.gestationWeeks),
    ropEligible: ropEligible({ gaWeeks: n.gestationWeeks, weightGrams: n.weightGrams, unstableCourse: n.plan?.unstableCourse === 'yes' }),
    ropFirstExamDue: ropDueOf(n, baby),
    cranialUsg: cranialUsgDue(birthAt ?? n.admittedAt, n.gestationWeeks, n.gestationDays ?? 0, n.weightGrams),
    hearingAabrBeforeDischarge: aabrDue(n.admittedAt, until),
    lengthOfStayDays: lengthOfStayDays(n.admittedAt, until),
  };
}
const fmtTemp = (t) => `${Number(t).toFixed(1)} °C`;
/** Banners (N2, N3, N5, the floor, N1, N6, late entry) and flags of one NEO-F-03 admission. PURE. */
export function bannersFor(n, unit, units, computed, now) {
  const banners = [];
  const open = !n.outcome && !n.cancelled;
  if (hypothermic(n.temperatureC)) banners.push({ key: 'hypothermia', tone: 'high', text: `Temperature ${fmtTemp(n.temperatureC)} at admission – below 36.0 °C. Start the hypothermia pathway (NEO-SOP-04).` });
  const g = n.assessment?.glucose;
  if (hypoglycaemic(g)) banners.push({ key: 'hypoglycaemia', tone: 'high', text: `Glucose ${g} mg/dL – below 45. Start the hypoglycaemia pathway (NEO-SOP-08).` });
  if (computed.ropFirstExamDue) banners.push({ key: 'rop', tone: 'due', text: 'ROP screening: first eye examination due', on: computed.ropFirstExamDue });
  const cap = outsideCapability(unit, { source: n.source, gaWeeks: n.gestationWeeks, weightGrams: n.weightGrams, ventilated: ventilatedOf(n) });
  if (cap) {
    const higher = units.filter((u) => u.active && u.level === 'level_IIIA').map((u) => u.name);
    banners.push({ key: 'capability', tone: 'watch', text: `Outside this unit's capability (NEO-A-01): a level II unit${higher.length ? ` – transfer to ${higher.join(' or ')} suggested` : ' – transfer to a level IIIA unit suggested'}.` });
  }
  const floor = belowFloor(unit, n.gestationWeeks, n.weightGrams);
  if (floor) {
    const d = n.floorDecision;
    banners.push({ key: 'floor', tone: 'watch', text: `Below the admission floor (${unit.minGestationWeeks} weeks / ${unit.minBirthWeightGrams} g): transfer pathway (NEO-F-18) suggested.${d ? ` Consultant's decision (${d.consultantName}): ${d.decision === 'transfer' ? 'transfer' : 'admit here'}.` : ''}` });
  }
  const counselOverdue = open && !n.followOn?.counselledAt && now - new Date(n.admittedAt) > COUNSEL_WITHIN_MIN * MIN;
  if (counselOverdue) banners.push({ key: 'counsel', tone: 'high', text: 'Parents not counselled yet – more than 1 hour since admission.' });
  const incomplete = !n.cancelled && !n.signed && now - new Date(n.admittedAt) > COMPLETE_WITHIN_MIN * MIN;
  if (incomplete) banners.push({ key: 'incomplete', tone: 'watch', text: 'Admission record not complete within 1 hour of admission.' });
  if (lateEntry(n.admittedAt, n.createdAt)) banners.push({ key: 'late', tone: 'neutral', text: 'Late entry: the admission was typed more than 1 hour after the admission time', on: n.createdAt });
  const typed = n.followOn?.typedAt?.counselledAt;
  if (lateEntry(n.followOn?.counselledAt, typed)) banners.push({ key: 'late', tone: 'neutral', text: 'Late entry: the counselling time was typed more than 1 hour after it', on: typed });
  return { banners, flags: { hypothermia: hypothermic(n.temperatureC), hypoglycaemia: hypoglycaemic(g), outsideCapability: cap, belowFloor: floor, counselOverdue, incomplete, lateEntry: lateEntry(n.admittedAt, n.createdAt) } };
}

// ---------- N1: the counselling task to the admitting doctor ----------
/** Tells the admitting doctor (the notification bell) once an admission passes 60 minutes with no counselling. */
export async function runNicuAutomations(tenantId, now = new Date()) {
  const due = await NicuAdmission.find({ tenantId, format: 'f03', ...openFilter, admittedAt: { $lte: new Date(now.getTime() - COUNSEL_WITHIN_MIN * MIN) }, 'followOn.counselledAt': null, 'automation.n1NotifiedAt': null }).lean();
  let sent = 0;
  for (const n of due) {
    const to = n.admittingDoctor?.id ?? n.consultant?.id ?? null;
    const baby = await Patient.findOne({ _id: n.patientId, tenantId }, { fullName: 1, mrn: 1 }).lean();
    // Marked first, so a second copy of the server or a second round never sends it twice
    const claimed = await NicuAdmission.updateOne({ _id: n._id, tenantId, 'automation.n1NotifiedAt': null }, { $set: { automation: { n1NotifiedAt: now } } });
    if (!claimed.modifiedCount) continue;
    if (to && baby) {
      sent += await notify({ tenantId, now }, { userIds: [to] }, { kind: 'nicu', text: `NICU: counsel the parents of ${baby.fullName} (${baby.mrn}) – over 1 hour since admission.`, link: `/patients/${n.patientId}/newborn-care` });
    } else {
      sent += await notify({ tenantId, now }, { roles: ['doctor'] }, { kind: 'nicu', text: `NICU: parents of a baby admitted over 1 hour ago are not counselled yet.`, link: '/nicu-board' });
    }
  }
  return sent;
}
/** Every hospital's round (the background timer in index.js). */
export async function runNicuAutomationsAll(now = new Date()) {
  const tenants = await Tenant.find({ isActive: true }, { _id: 1 }).lean();
  let sent = 0;
  for (const t of tenants) sent += await runNicuAutomations(t._id, now);
  return sent;
}

// ---------- The unit board (NEO-A-01) ----------
export async function latestRoster(tenantId, unitKeys) {
  const out = {};
  for (const k of unitKeys) {
    const r = await NicuRoster.findOne({ tenantId, unit: k }).sort({ at: -1, _id: -1 }).lean();
    out[k] = r ? { nurses: r.nurses, at: r.at, byName: r.byName } : null;
  }
  return out;
}
/** The nurse:baby warning for intensive beds: more than 2 babies per nurse on duty (no roster: not known). PURE. */
export function ratioWarning(intensiveBabies, nurses) {
  if (nurses == null) return intensiveBabies > 0 ? 'unknown' : null;
  if (intensiveBabies === 0) return null;
  return nurses === 0 || intensiveBabies / nurses > NURSE_BABY_RATIO ? 'worse' : null;
}
export const levelWords = (k) => LEVELS[k] ?? k;
export const registerLabelOf = (n) => (n.registerNo ? registerLabel(n.unit, n.registerYear, n.registerNo) : `No. ${n.serial}`);

// ---------- NEO-A-05: the monthly dashboard's NICU rows ----------
/** The NICU rows of the newborn dashboard for a month (dashboards.js INDICATORS, keys nicu*). */
export async function nicuDashboardValues(tenantId, { start, end }, now = new Date()) {
  const v = {};
  const admitted = await NicuAdmission.find({ tenantId, admittedAt: { $gte: start, $lt: end }, cancelled: null }).lean();
  const f03 = admitted.filter((n) => n.format === 'f03');
  v.nicuTempInRange = rate(admitted.filter((n) => tempInRange(n.temperatureC)).length, admitted.length);
  v.nicuCounselled1h = rate(f03.filter((n) => counselledInTime(n.admittedAt, n.followOn?.counselledAt)).length, f03.length);
  v.nicuComplete1h = rate(f03.filter((n) => completedInTime(n.admittedAt, n.signed?.at)).length, f03.length);
  v.nicuCounselOverdue = count(await NicuAdmission.countDocuments({ tenantId, format: 'f03', ...openFilter, admittedAt: { $lte: new Date(now.getTime() - COUNSEL_WITHIN_MIN * MIN) }, 'followOn.counselledAt': null }));
  for (const b of WEIGHT_BANDS) v[`nicuWeight_${b.key}`] = count(admitted.filter((n) => bandOf(WEIGHT_BANDS, n.weightGrams) === b.key).length);
  for (const b of GA_BANDS) v[`nicuGa_${b.key}`] = count(admitted.filter((n) => bandOf(GA_BANDS, n.gestationWeeks) === b.key).length);
  v.nicuInborn = count(admitted.filter((n) => isInborn(n.source)).length);
  v.nicuOutborn = count(admitted.filter((n) => !isInborn(n.source)).length);
  // Survival: admissions that ended this month, by weight band (n/N)
  const closed = await NicuAdmission.find({ tenantId, 'outcome.at': { $gte: start, $lt: end }, cancelled: null }, { weightGrams: 1, outcome: 1 }).lean();
  for (const b of WEIGHT_BANDS) {
    const band = closed.filter((n) => bandOf(WEIGHT_BANDS, n.weightGrams) === b.key);
    v[`nicuSurvival_${b.key}`] = rate(band.filter((n) => survived(n.outcome.result)).length, band.length);
  }
  const under1500 = closed.filter((n) => n.weightGrams != null && n.weightGrams < 1500);
  v.nicuSurvivalUnder1500 = rate(under1500.filter((n) => survived(n.outcome.result)).length, under1500.length);
  const transfers = closed.filter((n) => isTransferOut(n.outcome.result));
  v.nicuTransfersOut = count(transfers.length);
  const timed = transfers.filter((n) => n.outcome.details?.transferDecisionAt && n.outcome.details?.transferDepartedAt);
  v.nicuTransfer2h = rate(timed.filter((n) => new Date(n.outcome.details.transferDepartedAt) - new Date(n.outcome.details.transferDecisionAt) <= TRANSFER_WITHIN_MIN * MIN).length, timed.length);
  // ROP: eligible admissions whose first examination fell due this month, examined by then
  const all = await NicuAdmission.find({ tenantId, format: 'f03', cancelled: null, admittedAt: { $gte: new Date(start.getTime() - 120 * DAY), $lt: end } }).lean();
  const babies = new Map((await Patient.find({ tenantId, _id: { $in: all.map((n) => n.patientId) } }, { newborn: 1 }).lean()).map((p) => [String(p._id), p]));
  const dueNow = all.map((n) => ({ n, due: ropDueOf(n, babies.get(String(n.patientId))) })).filter((x) => x.due && x.due >= start && x.due < end);
  const logs = new Map((await NewbornFollowUp.find({ tenantId, patientId: { $in: dueNow.map((x) => x.n.patientId) } }, { patientId: 1, records: 1 }).lean()).map((l) => [String(l.patientId), l]));
  const onTime = dueNow.filter(({ n, due }) => logs.get(String(n.patientId))?.records?.some((r) => r.kind === 'screen' && r.key === 'rop' && r.status === 'done' && new Date(r.on) <= due));
  v.nicuRopOnTime = rate(onTime.length, dueNow.length);
  return v;
}
