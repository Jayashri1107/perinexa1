import { Router } from 'express';
import { z } from 'zod';
import { BILI_METHODS, BIRTH_CHECKS, CORD_CLAMPING, DISCHARGE_READY, EXAM_ITEMS, NEWBORN_CARE_SOURCE, NICU_OUTCOMES, NICU_REASONS, NICU_SOURCES, NICU_UNITS, RESUSCITATION, coldAtAdmission } from '../clinical/newbornCare.js';
import * as F03 from '../clinical/nicuAdmission.js';
import { BILLING_TYPES } from '../inpatient/admissionLabels.js';
import { ADMISSION_REASON_KEYS, SEROLOGY_TESTS, assessmentSchema, followOnSchema, maternalSchema, missingForSign, outcomeDetailsSchema, outcomeResult, planSchema } from '../clinical/nicuForm.js';
import { bannersFor, computedFor, latestRoster, memberWith, nicuBeds, openFilter, prefillFor, ratioWarning, registerLabelOf, runNicuAutomations, syncRopEvent, unitsOf } from '../clinical/nicuData.js';
import { Bed } from '../models/Bed.js';
import { nextNumber } from '../models/Counter.js';
import { Membership, hasRole } from '../models/Membership.js';
import { BilirubinReading, NewbornBirthCare, NewbornExam, NicuAdmission, NicuRoster } from '../models/NewbornCare.js';
import { NewbornFollowUp } from '../models/NewbornFollowUp.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { verifyWitness, witnessSchema, witnessView } from '../auth/witness.js';
import { audit } from '../utils/audit.js';
import { toCsv } from '../utils/csv.js';
import { HttpError } from '../utils/httpError.js';
import { notify } from '../notifications/notify.js';
import { babyOfName } from '../utils/personName.js';
import { registerPatient } from './patients.js';
import { assertNotHidden, departmentListed, listedPatientIds, patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';
import { monthRange } from './clinicalAudit.js';

// The newborn at birth and on the ward, bilirubin, and the NICU admission (NEO-F-03), its units and register
// (Clinical Requirements Group B, items 12 and 13; Build 13 – clinical/nicuAdmission.js): /api/newborn-care.
//  - GET /?patientId=: a baby's birth record, examinations, bilirubin readings (with hours of age) and admissions;
//  - POST /birth, /exam, /bilirubin: add one (doctors, RMOs, nurses who may write in her record);
//  - GET /nicu/options?patientId=: what the admission form needs – units, sources, beds (free or not), doctors and the
//    pre-fill from the mother's record, the delivery note and the record at birth (PX-X-14);
//  - POST /nicu: admit (NEO-F-03 header and the first findings); PUT /nicu/:id: the form's parts; POST /nicu/:id/sign:
//    the admitting doctor signs (then §1–§3 are locked; counselling, consent and the consultant's review stay open);
//  - POST /nicu/:id/outcome: how the admission ended (NEO-L-05); POST /:kind/:id/cancel: entered in error, with a reason;
//  - GET /register?month=&unit=, GET /register.csv: the admission and outcome register (NEO-L-05);
//  - GET /board, POST /roster: the unit board (beds, nurse:baby ratio, flags – NEO-A-01);
//  - GET /settings (doctors, RMOs, nurses, the admin), PUT /settings (the hospital admin): units, levels, NICU beds.
// The free text here is written after birth, on a baby's own record: the words-about-sex check of the mother's record
// does not apply (as on the delivery note). The audit log gets ids – never the findings.

export const newbornCareRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m, code = 'CONFLICT') => new HttpError(409, m, code);
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const time = (label) => z.iso.datetime(`${label}: please enter a valid date and time`).transform((v) => new Date(v));
const text = (label, max) => z.string().trim().max(max, `${label} is too long`).default('');
const num = (label, min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.coerce.number(`${label} must be a number`).min(min, `${label} looks too low – please check`).max(max, `${label} looks too high – please check`)])).default(null);
const need = (label, min, max, int = false) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), (int ? z.coerce.number(`Enter the ${label}`).int(`The ${label} is a whole number`) : z.coerce.number(`Enter the ${label}`)).min(min, `The ${label} looks too low – please check`).max(max, `The ${label} looks too high – please check`));
const DAY = 24 * 60 * 60 * 1000;
const nowOf = (req) => req.now ?? new Date();
const future = (req, d) => Boolean(d) && new Date(d).getTime() > nowOf(req).getTime() + 5 * 60 * 1000;

// ---------- The NICU units and beds (Build 13, NEO-A-01) – read by clinical staff and the admin, kept by the admin ----------
const settingsView = async (req) => {
  const [tenant, beds] = await Promise.all([Tenant.findById(req.tenantId, { nicu: 1 }).lean(), Bed.find({ tenantId: req.tenantId, active: true }).sort({ ward: 1, name: 1 }).lean()]);
  const units = F03.nicuUnitsFor(tenant);
  return {
    units,
    beds: beds.map((b) => ({ id: String(b._id), ward: b.ward, floor: b.floor ?? '', name: b.name, nicu: b.nicu ? { unit: b.nicu.unit, level: b.nicu.level, kind: b.nicu.kind } : null })),
    levels: F03.LEVELS,
    bedLevels: F03.BED_LEVELS,
    bedKinds: F03.BED_KINDS,
    floorDefaults: F03.FLOOR_DEFAULTS,
    access: { edit: hasRole(req.membership, 'admin') },
    overrides: (tenant?.nicu?.overrides ?? []).slice(-10).reverse().map((o) => ({ id: String(o._id), unit: o.unit, reason: o.reason, byName: o.byName, at: o.at, usedAt: o.usedAt, open: !o.usedAt && nowOf(req) - new Date(o.at) <= OVERRIDE_MS })),
  };
};
// N4: the hospital admin allows one more admission to a full unit (used once, within 2 hours)
const OVERRIDE_MS = 2 * 60 * 60 * 1000;
newbornCareRouter.post('/settings/override', async (req, res) => {
  if (!hasRole(req.membership, 'admin')) throw forbidden('One more admission to a full unit is allowed by the hospital admin.');
  const b = parse(z.object({ unit: z.string().regex(/^[a-z0-9_]{2,30}$/, 'Choose the unit'), reason: z.string().trim().min(5, 'Please say why (at least 5 characters).').max(300) }).strict(), req.body);
  const tenant = await Tenant.findById(req.tenantId);
  if (!F03.nicuUnitsFor(tenant).some((u) => u.key === b.unit && u.active)) throw invalid({ unit: 'Choose one of the units.' });
  const list = [...(tenant.nicu?.overrides ?? []), { unit: b.unit, reason: b.reason, byName: req.user.name, at: nowOf(req) }].slice(-50);
  tenant.set('nicu.overrides', list);
  await tenant.save();
  await audit(req, 'NICU_SETTINGS_CHANGED', { details: { fields: ['override'], unit: b.unit } });
  res.status(201).json(await settingsView(req));
});
newbornCareRouter.get('/settings', async (req, res) => {
  if (!hasRole(req.membership, ...ROLES, 'admin')) throw forbidden('The NICU units are for doctors, RMOs, nurses and the hospital admin.');
  res.json(await settingsView(req));
});
const unitBody = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9_]{2,30}$/, 'A unit key is 2 to 30 small letters, digits or _ (for example "garkheda").'),
    name: z.string().trim().min(1, "Enter the unit's name.").max(60, 'The name is too long (at most 60 characters).').regex(/^\P{Cc}*$/u, 'The name has a character that cannot be saved.'),
    level: z.enum(Object.keys(F03.LEVELS), 'Choose the level of care'),
    active: z.boolean().default(true),
    minGestationWeeks: z.number().int().min(22).max(40).default(F03.FLOOR_DEFAULTS.minGestationWeeks),
    minBirthWeightGrams: z.number().int().min(300).max(3000).default(F03.FLOOR_DEFAULTS.minBirthWeightGrams),
  })
  .strict();
const settingsBody = z
  .object({
    units: z.array(unitBody).min(1, 'Keep at least one unit').max(10, 'At most 10 units').optional(),
    beds: z
      .array(z.object({ bedId: objectId, nicu: z.union([z.null(), z.object({ unit: z.string().max(30), level: z.enum(Object.keys(F03.BED_LEVELS)), kind: z.enum(Object.keys(F03.BED_KINDS)) }).strict()]) }).strict())
      .max(500)
      .optional(),
  })
  .strict();
newbornCareRouter.put('/settings', async (req, res) => {
  if (!hasRole(req.membership, 'admin')) throw forbidden('The NICU units and beds are set by the hospital admin.');
  const b = parse(settingsBody, req.body);
  const tenant = await Tenant.findById(req.tenantId);
  const before = F03.nicuUnitsFor(tenant);
  const units = b.units ?? before;
  const fields = {};
  const keys = units.map((u) => u.key);
  if (new Set(keys).size !== keys.length) fields.units = 'Two units have the same key.';
  for (const u of before.filter((x) => !keys.includes(x.key))) {
    if (await NicuAdmission.exists({ tenantId: req.tenantId, unit: u.key })) fields.units = `${u.name} has admissions, so it stays on the list. Mark it not in use instead.`;
  }
  const beds = b.beds ?? [];
  const found = new Map((await Bed.find({ tenantId: req.tenantId, _id: { $in: beds.map((x) => x.bedId) } }).lean()).map((x) => [String(x._id), x]));
  const open = new Set((await NicuAdmission.find({ tenantId: req.tenantId, bedId: { $in: beds.map((x) => x.bedId) }, ...openFilter }, { bedId: 1 }).lean()).map((n) => String(n.bedId)));
  beds.forEach((x, i) => {
    const bed = found.get(x.bedId.toLowerCase());
    if (!bed) fields[`beds.${i}.bedId`] = 'This bed was not found.';
    else if (x.nicu && !keys.includes(x.nicu.unit)) fields[`beds.${i}.nicu.unit`] = 'Choose one of the units.';
    else if (open.has(String(bed._id)) && x.nicu?.unit !== bed.nicu?.unit) fields[`beds.${i}.nicu.unit`] = `A baby is in ${bed.name}: it stays in its unit until the baby leaves.`;
  });
  if (Object.keys(fields).length) throw invalid(fields);
  const changed = [];
  if (b.units && JSON.stringify(before) !== JSON.stringify(units)) {
    tenant.set('nicu.units', units);
    tenant.set('nicu.updatedByName', req.user.name);
    tenant.set('nicu.updatedAt', nowOf(req));
    await tenant.save();
    changed.push('units');
  }
  let moved = 0;
  for (const x of beds) {
    const bed = found.get(x.bedId.toLowerCase());
    const was = bed.nicu ? { unit: bed.nicu.unit, level: bed.nicu.level, kind: bed.nicu.kind } : null;
    if (JSON.stringify(was) === JSON.stringify(x.nicu)) continue;
    await Bed.updateOne({ _id: bed._id, tenantId: req.tenantId }, { $set: { nicu: x.nicu } });
    moved += 1;
  }
  if (moved) changed.push('beds');
  if (changed.length) await audit(req, 'NICU_SETTINGS_CHANGED', { details: { fields: changed, beds: moved } });
  res.json(await settingsView(req));
});

// Reception admits a baby to the NICU at the desk (developer's request, 9 Nov 2026): the header only – unit, bed, where
// from, when, the admitting doctor – and sees only where the baby is. Never the form, the register or the board.
const DESK_CALLS = [
  ['GET', '/nicu/desk'],
  ['GET', '/nicu/options'],
  ['POST', '/nicu'],
  ['POST', '/nicu/new-baby'],
  ['GET', '/nicu/new-baby/options'],
];
newbornCareRouter.use((req, _res, next) => {
  if (hasRole(req.membership, ...ROLES)) return next();
  if (hasRole(req.membership, 'receptionist') && DESK_CALLS.some(([m, p]) => req.method === m && req.path === p)) {
    req.nicuDesk = true; // reception, without a clinical role
    return next();
  }
  throw forbidden('Newborn care records are for doctors, RMOs and nurses.');
});
const mayView = (req, p) => patientAccess(req, p).view.has('pregnancy');
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const maySign = (req, p) => hasRole(req.membership, 'doctor', 'rmo') && patientAccess(req, p).editClinical;
async function babyFor(req, id, write = false) {
  // Another department's baby is "not found" for a doctor (departments, 9 Nov 2026)
  const baby = assertNotHidden(req, await findPatientById(req.tenantId, id));
  if (baby.careType !== 'newborn') throw invalid({ patientId: "These records belong on a baby's record." });
  if (!mayView(req, baby)) throw forbidden("You can't see this baby's medical details.");
  if (write && !mayWrite(req, baby)) throw forbidden("You may not write in this baby's record.");
  return baby;
}
/** A baby's record for the desk: reception may change her identity and birth details, never see her medical details. */
async function babyForDesk(req, id) {
  const baby = assertNotHidden(req, await findPatientById(req.tenantId, id)); // departments, 9 Nov 2026
  if (baby.careType !== 'newborn') throw invalid({ patientId: "The NICU is for a baby's record." });
  const a = patientAccess(req, baby);
  if (!(a.editNewborn || a.editIdentity)) throw forbidden("You may not admit this baby.");
  return baby;
}
const ids = (baby, extra = {}) => ({ patientId: String(baby._id), mrn: baby.mrn, ...extra });
const cancelView = (c) => (c ? { reason: c.reason, byName: c.byName, at: c.at } : null);
const hoursOfAge = (baby, at) => (baby.newborn?.birthAt ? Math.round(((new Date(at) - new Date(baby.newborn.birthAt)) / 3600000) * 10) / 10 : null);
const person = (p) => (p?.id ? { id: String(p.id), name: p.name } : null);
const unitOf = (units, key) => units.find((u) => u.key === key) ?? { key, name: NICU_UNITS[key] ?? key, level: 'level_II', active: false, ...F03.FLOOR_DEFAULTS };

/** One admission as the screens see it. ctx: { units, now, mothers: Map(id → mrn) }. A DRAFT admission keeps its fields. */
const nicuView = (n, baby, ctx) => {
  const unit = unitOf(ctx.units, n.unit);
  const base = {
    id: String(n._id),
    serial: n.serial,
    format: n.format ?? 'draft',
    registerYear: n.registerYear ?? null,
    registerNo: n.registerNo ?? null,
    registerLabel: registerLabelOf(n),
    unit: n.unit,
    unitName: unit.name,
    unitLevel: unit.level,
    source: n.source,
    sourceWords: F03.sourceWords(ctx.units, n.source),
    inborn: F03.isInborn(n.source),
    admittedAt: n.admittedAt,
    ageHours: baby ? hoursOfAge(baby, n.admittedAt) : null,
    reasons: n.reasons ?? [],
    reasonNote: n.reasonNote ?? '',
    reasonPrimary: n.reasonPrimary ?? null,
    weightGrams: n.weightGrams,
    temperatureC: n.temperatureC,
    cold: coldAtAdmission(n.temperatureC),
    gestationWeeks: n.gestationWeeks,
    gestationDays: n.gestationDays ?? null,
    byName: n.byName,
    typedAt: n.createdAt,
    outcome: n.outcome ? { result: n.outcome.result, at: n.outcome.at, note: n.outcome.note, byName: n.outcome.byName, details: n.outcome.details ?? null } : null,
    stayDays: n.outcome ? Math.max(0, Math.round((new Date(n.outcome.at) - new Date(n.admittedAt)) / DAY)) : null,
    cancelled: cancelView(n.cancelled),
  };
  if (n.format !== 'f03') return base;
  const computed = computedFor(n, baby, ctx.now);
  const { banners, flags } = bannersFor(n, unit, ctx.units, computed, ctx.now);
  return {
    ...base,
    motherId: n.motherId ? String(n.motherId) : null,
    motherMrn: n.motherId ? (ctx.mothers?.get(String(n.motherId)) ?? null) : null,
    transferFromName: n.transferFromName,
    bed: n.bedId ? { id: String(n.bedId), name: n.bedName, type: n.bedType } : null,
    allergyAlert: n.allergyAlert,
    consultant: person(n.consultant),
    admittingDoctor: person(n.admittingDoctor),
    floorDecision: n.floorDecision ? { decision: n.floorDecision.decision, consultantName: n.floorDecision.consultantName, note: n.floorDecision.note, at: n.floorDecision.at } : null,
    fullOverride: n.fullOverride ? { reason: n.fullOverride.reason, byName: n.fullOverride.byName, at: n.fullOverride.at } : null,
    atDesk: n.desk ? { byName: n.desk.byName, at: n.desk.at } : null,
    maternal: n.maternal ?? null,
    maternalFrom: n.maternalFrom ?? {},
    assessment: n.assessment ?? null,
    plan: n.plan ?? null,
    followOn: n.followOn ?? null,
    signed: n.signed ? { byName: n.signed.byName, role: n.signed.role, at: n.signed.at } : null,
    editedAt: n.editedAt,
    editedByName: n.editedByName,
    computed,
    banners,
    flags,
  };
};
async function mothersOf(req, list) {
  const idsList = [...new Set(list.map((n) => n.motherId).filter(Boolean).map(String))];
  if (!idsList.length) return new Map();
  // A mother hidden from this doctor by the department rule: no number shown (departments, 9 Nov 2026)
  const listed = await listedPatientIds(req, Patient, idsList);
  const shown = listed ? idsList.filter((id) => listed.has(id)) : idsList;
  return new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: shown } }, { mrn: 1 }).lean()).map((p) => [String(p._id), p.mrn]));
}
const F03_RULES = {
  levels: F03.LEVELS,
  bedKinds: F03.BED_KINDS,
  serology: F03.SEROLOGY,
  serologyTests: SEROLOGY_TESTS,
  rubella: F03.RUBELLA,
  antenatalProblems: F03.ANTENATAL_PROBLEMS,
  steroids: F03.STEROIDS,
  labourOnset: F03.LABOUR_ONSET,
  liquor: F03.LIQUOR,
  deliveryMode: F03.DELIVERY_MODE,
  resuscitation: F03.RESUSCITATION_F03,
  cordClamp: F03.CORD_CLAMP,
  growthCharts: F03.GROWTH_CHARTS,
  gaMethods: F03.GA_METHODS,
  symmetry: F03.SYMMETRY,
  spo2Support: F03.SPO2_SUPPORT,
  respiratorySupport: F03.RESPIRATORY_SUPPORT,
  examSystems: F03.EXAM_SYSTEMS,
  maturity: F03.MATURITY,
  size: F03.SIZE,
  reasons: F03.ADMISSION_REASONS,
  sepsisPathway: F03.SEPSIS_PATHWAY,
  thermal: F03.THERMAL,
  feeds: F03.FEEDS,
  feedRoute: F03.FEED_ROUTE,
  lines: F03.LINES,
  investigations: F03.INVESTIGATIONS,
  outcomes: F03.OUTCOMES_F03,
  morbidities: F03.MORBIDITIES,
  gatedRespiratory: F03.GATED_RESPIRATORY,
  gatedLines: F03.GATED_LINES,
  maxProblems: F03.MAX_PROBLEMS,
  formCode: F03.NICU_FORM_CODE,
  footer: F03.NICU_FORM_FOOTER,
  source: F03.NICU_F03_SOURCE,
};
export const NEWBORN_RULES = { resuscitation: RESUSCITATION, cordClamping: CORD_CLAMPING, birthChecks: BIRTH_CHECKS, examItems: EXAM_ITEMS, dischargeReady: DISCHARGE_READY, biliMethods: BILI_METHODS, units: NICU_UNITS, sources: NICU_SOURCES, reasons: NICU_REASONS, outcomes: { ...NICU_OUTCOMES, ...F03.OUTCOMES_F03 }, source: NEWBORN_CARE_SOURCE, f03: F03_RULES };

newbornCareRouter.get('/', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const baby = await babyFor(req, patientId);
  await runNicuAutomations(req.tenantId, nowOf(req));
  const [births, exams, bili, nicu, units] = await Promise.all([
    NewbornBirthCare.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ createdAt: -1 }).lean(),
    NewbornExam.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ examinedAt: -1 }).lean(),
    BilirubinReading.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ at: 1 }).lean(),
    NicuAdmission.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ admittedAt: -1 }).lean(),
    unitsOf(req.tenantId),
  ]);
  const ctx = { units, now: nowOf(req), mothers: await mothersOf(req, nicu) };
  await audit(req, 'NEWBORN_CARE_VIEWED', { details: ids(baby) });
  res.json({
    birthAt: baby.newborn?.birthAt ?? null,
    baby: { id: String(baby._id), fullName: baby.fullName, mrn: baby.mrn, birthAt: baby.newborn?.birthAt ?? null },
    birth: births.map((b) => ({ id: String(b._id), criedAtBirth: b.criedAtBirth, resuscitation: b.resuscitation, cordClamping: b.cordClamping, checks: b.checks, temperatureC: b.temperatureC, note: b.note, idBandWitness: witnessView(b.idBandWitness), byName: b.byName, at: b.createdAt, cancelled: cancelView(b.cancelled) })),
    exams: exams.map((e) => ({ id: String(e._id), examinedAt: e.examinedAt, weightGrams: e.weightGrams, findings: e.findings, notes: e.notes, ready: e.ready, summary: e.summary, byName: e.byName, cancelled: cancelView(e.cancelled) })),
    bilirubin: bili.map((r) => ({ id: String(r._id), at: r.at, hours: hoursOfAge(baby, r.at), mgdl: r.mgdl, method: r.method, note: r.note, byName: r.byName, cancelled: cancelView(r.cancelled) })),
    nicu: nicu.map((n) => nicuView(n, baby, ctx)),
    units,
    access: { write: mayWrite(req, baby), outcome: maySign(req, baby), sign: maySign(req, baby) },
    rules: NEWBORN_RULES,
  });
});

const answers = (items, allowed) => z.object(Object.fromEntries(items.map((i) => [i.key, z.enum(['', ...allowed]).default('')]))).strict().default({});
newbornCareRouter.post('/birth', async (req, res) => {
  const b = parse(
    z.object({ patientId: objectId, criedAtBirth: z.enum(['yes', 'no'], 'Did the baby cry at birth?'), resuscitation: z.enum(Object.keys(RESUSCITATION), 'Choose the resuscitation'), cordClamping: z.enum(Object.keys(CORD_CLAMPING), 'Choose the cord clamping'), checks: answers(BIRTH_CHECKS, ['yes', 'no', 'na']), temperatureC: num('Temperature', 30, 42), note: text('Note', 1000), witness: witnessSchema.optional() }).strict(),
    req.body,
  );
  const baby = await babyFor(req, b.patientId, true);
  const bad = BIRTH_CHECKS.find((c) => !b.checks[c.key] || (b.checks[c.key] === 'na' && !c.na));
  if (bad) throw invalid({ [`checks.${bad.key}`]: b.checks[bad.key] ? 'Answer yes or no' : 'Answer this' });
  if (Object.values(b.checks).includes('no') && !b.note) throw invalid({ note: 'Write why a step was not done' });
  if (await NewbornBirthCare.findOne({ tenantId: req.tenantId, patientId: baby._id, live: true }, { _id: 1 }).lean()) throw conflict('The record at birth is already written. Mark it entered in error to write it again.');
  // The identity band is checked by two people (PX-X-06): a second person signs in for it
  const idBandWitness = b.checks.idBand === 'yes' ? await verifyWitness(req, b.witness, { purpose: 'identity_band' }) : null;
  const { witness: _w, ...fields } = b;
  const doc = await NewbornBirthCare.create({ ...fields, idBandWitness, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name }).catch((e) => {
    if (e?.code === 11000) throw conflict('The record at birth is already written. Mark it entered in error to write it again.');
    throw e;
  });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'birth', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id) });
});

newbornCareRouter.post('/exam', async (req, res) => {
  const b = parse(
    z
      .object({
        patientId: objectId,
        examinedAt: time('Examined'),
        weightGrams: num('Weight', 300, 7000),
        findings: answers(EXAM_ITEMS, ['normal', 'abnormal']),
        notes: z.object(Object.fromEntries(EXAM_ITEMS.map((i) => [i.key, text('Note', 300)]))).strict().default({}),
        ready: answers(DISCHARGE_READY, ['yes', 'no']),
        summary: text('Summary', 1000),
      })
      .strict(),
    req.body,
  );
  const baby = await babyFor(req, b.patientId, true);
  if (b.examinedAt.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ examinedAt: "This can't be in the future." });
  const missing = {};
  for (const i of EXAM_ITEMS) {
    if (!b.findings[i.key]) missing[`findings.${i.key}`] = 'Choose normal or not normal';
    else if (b.findings[i.key] === 'abnormal' && !b.notes[i.key]) missing[`notes.${i.key}`] = 'Write what was found';
  }
  if (Object.keys(missing).length) throw invalid(missing, 'Examine every part (and note what is not normal) before saving.');
  const doc = await NewbornExam.create({ ...b, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'exam', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id) });
});

newbornCareRouter.post('/bilirubin', async (req, res) => {
  const b = parse(z.object({ patientId: objectId, at: time('Time'), mgdl: z.coerce.number('Enter the bilirubin in mg/dL').min(0).max(40, 'This looks too high – please check'), method: z.enum(Object.keys(BILI_METHODS)), note: text('Note', 300) }).strict(), req.body);
  const baby = await babyFor(req, b.patientId, true);
  if (b.at.getTime() > (req.now ?? new Date()).getTime() + 5 * 60 * 1000) throw invalid({ at: "This can't be in the future." });
  if (baby.newborn?.birthAt && b.at < new Date(baby.newborn.birthAt)) throw invalid({ at: 'This is before the baby was born.' });
  const doc = await BilirubinReading.create({ ...b, tenantId: req.tenantId, patientId: baby._id, by: req.user._id, byName: req.user.name });
  await audit(req, 'NEWBORN_CARE_ADDED', { details: ids(baby, { kind: 'bilirubin', id: String(doc._id) }) });
  res.status(201).json({ id: String(doc._id), hours: hoursOfAge(baby, doc.at) });
});


// ---------- The NICU admission (NEO-F-03) ----------
async function doctorsOf(tenantId) {
  const members = await Membership.find({ tenantId, isActive: true, roles: { $in: ['doctor', 'rmo', 'nurse'] } }, { userId: 1, roles: 1 }).lean();
  const users = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  return members.filter((m) => users.has(String(m.userId))).map((m) => ({ id: String(m.userId), name: users.get(String(m.userId)), roles: m.roles.filter((r) => ROLES.includes(r)) })).sort((a, b) => a.name.localeCompare(b.name));
}
const bedView = (b) => ({ id: String(b._id), name: b.name, ward: b.ward, unit: b.nicu.unit, level: b.nicu.level, kind: b.nicu.kind, occupied: b.occupied });

newbornCareRouter.get('/nicu/options', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const baby = req.nicuDesk ? await babyForDesk(req, patientId) : await babyFor(req, patientId, true);
  const [units, beds, people] = await Promise.all([unitsOf(req.tenantId), nicuBeds(req.tenantId), doctorsOf(req.tenantId)]);
  const mother = baby.newborn?.mother ? await Patient.findOne({ _id: baby.newborn.mother, tenantId: req.tenantId }, { mrn: 1 }).lean() : null;
  const prefill = req.nicuDesk ? { motherId: mother ? String(mother._id) : null, motherMrn: mother?.mrn ?? null, motherHidden: false, allergyAlert: '', gestationWeeks: null, weightGrams: null, from: {} } : await prefillFor(req, baby, baby.newborn?.mother ?? null);
  res.json({
    units: units.filter((u) => u.active).map((u) => ({ ...u, sources: F03.sourcesFor(units, u.key), intensive: F03.allowsIntensive(u) })),
    beds: beds.map(bedView),
    people,
    prefill: { motherId: prefill.motherId, motherMrn: prefill.motherMrn, motherHidden: prefill.motherHidden, allergyAlert: prefill.allergyAlert, gestationWeeks: prefill.gestationWeeks, weightGrams: prefill.weightGrams, fields: Object.keys(prefill.from) },
    access: { override: hasRole(req.membership, 'admin'), desk: Boolean(req.nicuDesk) },
  });
});

/** An admission as reception sees it: where the baby is, never how she is (no outcome word – only that she left). */
const deskView = (n, units) => {
  const unit = unitOf(units, n.unit);
  return {
    id: String(n._id),
    registerLabel: registerLabelOf(n),
    unitName: unit.name,
    bed: n.bedName || null,
    admittedAt: n.admittedAt,
    sourceWords: F03.sourceWords(units, n.source),
    transferFromName: n.transferFromName ?? '',
    admittingDoctor: n.admittingDoctor?.name ?? null,
    byName: n.byName,
    atDesk: Boolean(n.desk),
    state: n.cancelled ? 'cancelled' : n.outcome ? 'left' : 'in',
    leftAt: n.cancelled ? null : (n.outcome?.at ?? null),
    assessmentNeeded: n.format === 'f03' && !n.cancelled && !n.outcome && (n.weightGrams == null || n.gestationWeeks == null || n.temperatureC == null || !n.reasonPrimary),
  };
};
newbornCareRouter.get('/nicu/desk', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const baby = await babyForDesk(req, patientId);
  const [list, units] = await Promise.all([NicuAdmission.find({ tenantId: req.tenantId, patientId: baby._id }).sort({ admittedAt: -1 }).lean(), unitsOf(req.tenantId)]);
  await audit(req, 'NICU_DESK_VIEWED', { details: ids(baby) });
  res.json({ baby: { id: String(baby._id), fullName: baby.fullName, mrn: baby.mrn }, admissions: list.map((n) => deskView(n, units)), access: { admit: !list.some((n) => !n.outcome && !n.cancelled) } });
});

const createBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    patientId: objectId,
    unit: z.string('Choose the unit').trim().min(1, 'Choose the unit').max(30),
    source: z.string('Choose where the baby came from').trim().min(1, 'Choose where the baby came from').max(40),
    transferFromName: text('Transferred from', 150),
    admittedAt: time('Admitted'),
    motherId: z.union([z.null(), objectId]).optional(),
    bedId: z.union([z.null(), z.literal(''), objectId]).optional(),
    bedType: z.enum(Object.keys(F03.BED_KINDS)).optional(),
    consultantId: z.union([z.null(), z.literal(''), objectId]).optional(),
    admittingDoctorId: z.union([z.null(), z.literal(''), objectId]).optional(),
    billingType: z.enum(BILLING_TYPES, 'Choose Insurance, Cash or Package'),
    weightGrams: need('weight', 300, 7000, true),
    gestationWeeks: need('gestation', 22, 44, true),
    gestationDays: z.coerce.number().int().min(0).max(6).default(0),
    temperatureC: need('temperature', 30, 42),
    reasonPrimary: z.enum(ADMISSION_REASON_KEYS, 'Choose the main reason for admission'),
    allergyAlert: z.string().trim().max(500).optional(),
    floorDecision: z.object({ decision: z.enum(['admit_here', 'transfer'], "Choose the consultant's decision"), consultantId: objectId, note: text('Note', 300) }).strict().optional(),
  })
  .strict();

const deskBody = createBody.omit({ weightGrams: true, gestationWeeks: true, gestationDays: true, temperatureC: true, reasonPrimary: true, allergyAlert: true, floorDecision: true });
newbornCareRouter.post('/nicu', async (req, res) => {
  const desk = Boolean(req.nicuDesk);
  const b = parse(desk ? deskBody : createBody, req.body);
  const baby = desk ? await babyForDesk(req, b.patientId) : await babyFor(req, b.patientId, true);
  const out = await admitBaby(req, b, baby, { desk });
  res.status(out.status).json(out.body);
});

/**
 * Admits a baby to the NICU: every check (unit, where from, mother, bed, doctors, floor, a full unit), then the
 * register number and the record. desk: the header only (reception, or a baby just registered). dryRun: the checks
 * only – nothing is saved and no 'one more admission' is used (before a new baby's record is made). Returns
 * { status, body }.
 */
async function admitBaby(req, b, baby, { desk, dryRun = false }) {
  const units = await unitsOf(req.tenantId);
  const ctx = async (n) => ({ units, now: nowOf(req), mothers: await mothersOf(req, [n]) });
  const same = await NicuAdmission.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return { status: 200, body: { admission: desk ? deskView(same, units) : nicuView(same, baby, await ctx(same)) }, same: true };
  if (future(req, b.admittedAt)) throw invalid({ admittedAt: "This can't be in the future." });
  if (baby.newborn?.birthAt && b.admittedAt < new Date(baby.newborn.birthAt)) throw invalid({ admittedAt: 'This is before the baby was born.' });
  if (baby._id && (await NicuAdmission.findOne({ tenantId: req.tenantId, patientId: baby._id, ...openFilter }))) throw conflict('The baby is already admitted: record how that admission ended first.');
  const unit = units.find((u) => u.key === b.unit && u.active);
  if (!unit) throw invalid({ unit: 'Choose one of the units.' });
  const sources = F03.sourcesFor(units, unit.key);
  const fields = {};
  if (!sources[b.source]) fields.source = 'Choose where the baby came from.';
  if (b.source === 'transfer_other' && !b.transferFromName) fields.transferFromName = 'Write the hospital the baby came from.';
  // The mother's record: required for a baby born here (inborn)
  const motherId = b.motherId ?? baby.newborn?.mother ?? null;
  let mother = null;
  if (motherId) {
    mother = await Patient.findOne({ _id: motherId, tenantId: req.tenantId }, { careType: 1, mrn: 1, assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 }).lean();
    // A different mother chosen here who is hidden from this doctor by the department rule counts as not found – the
    // baby's own linked mother stays usable (departments, 9 Nov 2026)
    const chosen = b.motherId && String(b.motherId) !== String(baby.newborn?.mother ?? '');
    if (mother && chosen && !departmentListed(req, mother)) mother = null;
    if (!mother || mother.careType === 'newborn') fields.motherId = "Choose the mother's record.";
  } else if (F03.isInborn(b.source)) fields.motherId = "A baby born here needs the mother's record: link the baby to the mother first.";
  // The bed (N4: a full unit is blocked unless the hospital admin overrides)
  const beds = (await nicuBeds(req.tenantId)).filter((x) => x.nicu.unit === unit.key);
  const bed = b.bedId ? beds.find((x) => String(x._id) === b.bedId.toLowerCase()) : null;
  if (!beds.length) fields.bedId = 'This unit has no NICU beds set up yet (hospital admin: NICU units).';
  else if (!bed) fields.bedId = 'Choose a bed of this unit.';
  // The consultant and the admitting doctor
  const consultant = b.consultantId ? await memberWith(req.tenantId, b.consultantId, ['doctor']) : null;
  if (b.consultantId && !consultant) fields.consultantId = 'Choose a doctor who works here.';
  const selfDoctor = hasRole(req.membership, 'doctor', 'rmo') ? { id: req.user._id, name: req.user.name } : null;
  const admitting = b.admittingDoctorId ? await memberWith(req.tenantId, b.admittingDoctorId, ['doctor', 'rmo']) : selfDoctor;
  if (!admitting) fields.admittingDoctorId = b.admittingDoctorId ? 'Choose a doctor or RMO who works here.' : 'Choose the admitting doctor.';
  // Below the floor: the transfer pathway is suggested, the consultant's decision is recorded
  let floorDecision = null;
  if (F03.belowFloor(unit, b.gestationWeeks, b.weightGrams)) {
    if (!b.floorDecision) fields.floorDecision = `Below the admission floor (${unit.minGestationWeeks} weeks / ${unit.minBirthWeightGrams} g): record the consultant's decision – admit here or the transfer pathway (NEO-F-18).`;
    else {
      const c = await memberWith(req.tenantId, b.floorDecision.consultantId, ['doctor']);
      if (!c) fields['floorDecision.consultantId'] = 'Choose the consultant (a doctor who works here).';
      else floorDecision = { decision: b.floorDecision.decision, consultantId: c.id, consultantName: c.name, note: b.floorDecision.note, at: nowOf(req) };
    }
  }
  if (Object.keys(fields).length) throw invalid(fields);
  let fullOverride = null;
  if (bed.occupied) {
    if (beds.some((x) => !x.occupied)) throw conflict('This bed is taken – choose a free bed.', 'BED_OCCUPIED');
    // A full unit: only with "one more admission" allowed by the hospital admin (used once, within 2 hours)
    const since = new Date(nowOf(req).getTime() - OVERRIDE_MS);
    if (dryRun) {
      const open = await Tenant.exists({ _id: req.tenantId, 'nicu.overrides': { $elemMatch: { unit: unit.key, usedAt: null, at: { $gte: since } } } });
      if (!open) throw conflict('Unit full – transfer pathway (NEO-F-18). The hospital admin can allow one more admission (NICU units).', 'UNIT_FULL');
    }
    const t = dryRun ? null : await Tenant.findOneAndUpdate(
      { _id: req.tenantId, 'nicu.overrides': { $elemMatch: { unit: unit.key, usedAt: null, at: { $gte: since } } } },
      { $set: { 'nicu.overrides.$.usedAt': nowOf(req) } },
      { returnDocument: 'before', projection: { nicu: 1 } },
    ).lean();
    const used = t?.nicu?.overrides?.find((o) => o.unit === unit.key && !o.usedAt && new Date(o.at) >= since);
    if (!used && !dryRun) throw conflict('Unit full – transfer pathway (NEO-F-18). The hospital admin can allow one more admission (NICU units).', 'UNIT_FULL');
    fullOverride = used ? { reason: used.reason, byName: used.byName, at: used.at } : null;
  }
  if (dryRun) return null;
  // §1 starts from what the linked records already say (PX-X-14) – not at the desk: reception may not read them; the
  // clinical team fills §1 in from the linked records later (POST /nicu/:id/prefill)
  const prefill = desk ? { values: null, from: {}, allergyAlert: '' } : await prefillFor(req, baby, motherId);
  const maternal = desk ? null : maternalSchema.parse(prefill.values);
  const year = F03.registerYearOf(b.admittedAt);
  const doc = {
    format: 'f03',
    tenantId: req.tenantId,
    patientId: baby._id,
    clientRequestId: b.clientRequestId,
    serial: await nextNumber(req.tenantId, 'nicu'),
    registerYear: year,
    unit: unit.key,
    source: b.source,
    transferFromName: b.source === 'transfer_other' ? b.transferFromName : '',
    admittedAt: b.admittedAt,
    motherId: motherId ?? null,
    bedId: bed._id,
    bedName: `${bed.ward} · ${bed.name}`,
    bedType: b.bedType ?? bed.nicu.kind,
    allergyAlert: b.allergyAlert ?? prefill.allergyAlert ?? '',
    consultant,
    admittingDoctor: admitting,
    billingType: b.billingType,
    floorDecision,
    fullOverride,
    reasonPrimary: b.reasonPrimary ?? null,
    weightGrams: b.weightGrams ?? null,
    gestationWeeks: b.gestationWeeks ?? null,
    gestationDays: b.gestationDays ?? null,
    temperatureC: b.temperatureC ?? null,
    maternal,
    maternalFrom: prefill.from,
    assessment: desk ? null : { growthChart: F03.defaultChart(b.gestationWeeks) },
    desk: desk ? { by: req.user._id, byName: req.user.name, at: nowOf(req) } : null,
    by: req.user._id,
    byName: req.user.name,
  };
  // The register number: the unit's next number of the year, given only when the admission is saved (no gaps)
  let n;
  for (let i = 0; ; i += 1) {
    const last = await NicuAdmission.findOne({ tenantId: req.tenantId, unit: unit.key, registerYear: year, registerNo: { $type: 'number' } }, { registerNo: 1 }).sort({ registerNo: -1 }).lean();
    try {
      n = await NicuAdmission.create({ ...doc, registerNo: (last?.registerNo ?? 0) + 1 });
      break;
    } catch (e) {
      if (e?.code === 11000 && e.keyPattern?.registerNo && i < 8) continue;
      if (e?.code === 11000 && e.keyPattern?.clientRequestId) {
        const again = await NicuAdmission.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
        return { status: 200, body: { admission: desk ? deskView(again, units) : nicuView(again, baby, await ctx(again)) }, same: true };
      }
      throw e;
    }
  }
  await syncRopEvent(req.tenantId, baby, n, req.user.name);
  await audit(req, 'NICU_ADMITTED', { details: ids(baby, { admissionId: String(n._id), serial: n.serial, unit: n.unit, registerNo: n.registerNo, ...(motherId ? { motherId: String(motherId) } : {}), prefilledFrom: [...new Set(Object.values(prefill.from))], ...(fullOverride ? { override: true } : {}), ...(desk ? { atDesk: true } : {}) }) });
  if (desk) {
    // The admitting doctor and the nurses are told: the admission assessment is theirs (the notification bell)
    await notify(req, { userIds: [admitting.id], roles: ['nurse'] }, { kind: 'nicu', text: `NICU: ${baby.fullName} (${baby.mrn}) admitted at the desk to ${unit.name}, ${bed.name} – the admission assessment is needed.`, link: `/patients/${baby._id}/newborn-care` });
    return { status: 201, body: { admission: deskView(n, units) } };
  }
  const view = nicuView(n, baby, await ctx(n));
  return { status: 201, body: { admission: view, warnings: view.banners } };
}

// A baby with no record yet (born elsewhere, or not registered): registered as "B/O <mother's name>" and admitted to
// the NICU in one step (9 Nov 2026) – the header only, like the desk; the nurse or doctor completes the form. Reception,
// doctors and RMOs (those who register patients). Every NICU check runs first, so no record is made for a baby who
// cannot be admitted; then the same "may already be registered" check as registering by hand.
const newBabyBody = deskBody
  .omit({ patientId: true, motherId: true })
  .extend({
    motherId: z.union([z.null(), z.literal(''), objectId]).optional(),
    motherName: z.string().trim().max(140, "The mother's name is too long").default(''),
    phone: z.string().trim().max(30).default(''),
    address: z.string().trim().max(300).default(''),
    birthAt: time('Date and time of birth'),
    sex: z.enum(['', 'female', 'male', 'indeterminate']).default(''),
    birthWeightGrams: num('Birth weight', 300, 7000),
    registerAnyway: z.boolean().default(false),
  })
  .strict();
// The lists the new-baby form needs (no baby yet): units with their sources, NICU beds (free or taken), doctors
newbornCareRouter.get('/nicu/new-baby/options', async (req, res) => {
  if (!hasRole(req.membership, 'receptionist', 'doctor', 'rmo')) throw forbidden('A new baby is registered by reception, doctors and RMOs.');
  const [units, beds, people] = await Promise.all([unitsOf(req.tenantId), nicuBeds(req.tenantId), doctorsOf(req.tenantId)]);
  res.json({ units: units.filter((u) => u.active).map((u) => ({ ...u, sources: F03.sourcesFor(units, u.key) })), beds: beds.map(bedView), people });
});

newbornCareRouter.post('/nicu/new-baby', async (req, res) => {
  if (!hasRole(req.membership, 'receptionist', 'doctor', 'rmo')) throw forbidden('A new baby is registered by reception, doctors and RMOs.');
  const b = parse(newBabyBody, req.body);
  const fields = {};
  let mother = null;
  if (b.motherId) {
    mother = await Patient.findOne({ _id: b.motherId, tenantId: req.tenantId }, { fullName: 1, phone: 1, address: 1, careType: 1, assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 }).lean();
    // Hidden from this doctor by the department rule: not found (departments, 9 Nov 2026)
    if (mother && !departmentListed(req, mother)) mother = null;
    if (!mother || mother.careType === 'newborn') fields.motherId = "Choose the mother's record.";
  } else if (!b.motherName) fields.motherName = "Write the mother's name (the baby is registered as B/O her name).";
  if (future(req, b.birthAt)) fields.birthAt = "This can't be in the future.";
  if (b.admittedAt < b.birthAt) fields.admittedAt = 'This is before the baby was born.';
  if (Object.keys(fields).length) throw invalid(fields);
  const motherId = mother ? String(mother._id) : null;
  const header = { ...b, patientId: null, motherId };
  // Every NICU check first (nothing saved, no "one more admission" used)
  const dry = await admitBaby(req, header, { _id: null, newborn: { mother: motherId, birthAt: b.birthAt } }, { desk: true, dryRun: true });
  if (dry?.same) return res.status(dry.status).json(dry.body);
  // The record: "B/O <mother>", her phone and address, the admitting doctor as the baby's doctor
  const doctor = b.admittingDoctorId ? await memberWith(req.tenantId, b.admittingDoctorId, ['doctor']) : null;
  const out = await registerPatient(req, {
    careType: 'newborn',
    fullName: babyOfName(mother?.fullName ?? b.motherName),
    ...(b.phone || mother?.phone ? { phone: b.phone || mother.phone } : {}),
    ...(b.address || mother?.address ? { address: b.address || mother.address } : {}),
    ...(doctor ? { assignedDoctor: String(doctor.id) } : {}),
    newborn: { birthAt: b.birthAt.toISOString(), birthWeightGrams: b.birthWeightGrams, sex: b.sex, ...(motherId ? { mother: motherId } : {}) },
    registerAnyway: b.registerAnyway,
  });
  if (out.matches) return res.status(409).json({ error: out.matches });
  const baby = out.patient;
  const admitted = await admitBaby(req, { ...header, patientId: String(baby._id) }, baby, { desk: true });
  res.status(201).json({ baby: { id: String(baby._id), mrn: baby.mrn, fullName: baby.fullName }, ...admitted.body });
});

async function admissionFor(req, write = true) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const n = await NicuAdmission.findOne({ _id: id, tenantId: req.tenantId });
  if (!n) throw new HttpError(404, 'This admission was not found.', 'NOT_FOUND');
  const baby = await babyFor(req, n.patientId, write);
  return { n, baby };
}
const respond = async (req, res, n, baby, extra = {}) => {
  const units = await unitsOf(req.tenantId);
  res.json({ admission: nicuView(n, baby, { units, now: nowOf(req), mothers: await mothersOf(req, [n]) }), ...extra });
};

// The form's parts (§1–§3 until the admitting doctor signs; what follows the admission at any time while it is open)
const editBody = z
  .object({
    weightGrams: need('weight', 300, 7000, true).optional(),
    gestationWeeks: need('gestation', 22, 44, true).optional(),
    gestationDays: z.coerce.number().int().min(0).max(6).optional(),
    temperatureC: need('temperature', 30, 42).optional(),
    reasonPrimary: z.enum(ADMISSION_REASON_KEYS, 'Choose the main reason for admission').optional(),
    allergyAlert: z.string().trim().max(500).optional(),
    bedType: z.enum(Object.keys(F03.BED_KINDS)).optional(),
    consultantId: z.union([z.null(), objectId]).optional(),
    floorDecision: z.object({ decision: z.enum(['admit_here', 'transfer']), consultantId: objectId, note: text('Note', 300) }).strict().optional(),
    maternal: maternalSchema.optional(),
    assessment: assessmentSchema.optional(),
    plan: planSchema.optional(),
    followOn: followOnSchema.optional(),
  })
  .strict();
const LOCKED_WHEN_SIGNED = ['weightGrams', 'gestationWeeks', 'gestationDays', 'temperatureC', 'reasonPrimary', 'allergyAlert', 'bedType', 'floorDecision', 'maternal', 'assessment', 'plan'];
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

newbornCareRouter.put('/nicu/:id', async (req, res) => {
  const { n, baby } = await admissionFor(req);
  const b = parse(editBody, req.body);
  if (n.format !== 'f03') throw conflict('This admission was recorded before the NEO-F-03 form: it is kept as it was.');
  if (n.cancelled) throw conflict('This admission is marked entered in error.');
  const parts = Object.keys(b);
  if (!parts.length) return respond(req, res, n, baby);
  if (n.signed && parts.some((k) => LOCKED_WHEN_SIGNED.includes(k))) throw conflict('The admission is signed: §1 to §3 can no longer be changed. Counselling, consent and the consultant’s review can.');
  const units = await unitsOf(req.tenantId);
  const unit = unitOf(units, n.unit);
  const fields = {};
  // PX-X-01: ventilation and central lines only at a level IIIA unit
  if (!F03.allowsIntensive(unit)) {
    if (F03.GATED_RESPIRATORY.includes(b.assessment?.respiratorySupport)) fields['assessment.respiratorySupport'] = 'Ventilation is not offered at a level II unit (PX-X-01): use the transfer pathway.';
    const gated = (b.plan?.lines ?? []).filter((l) => F03.GATED_LINES.includes(l));
    if (gated.length) fields['plan.lines'] = `${gated.map((l) => F03.LINES[l]).join(', ')}: central lines are placed only at a level IIIA unit (PX-X-01).`;
  }
  for (const [k, v] of Object.entries(b.followOn ?? {})) if (v instanceof Date && future(req, v)) fields[`followOn.${k}`] = "This can't be in the future.";
  for (const [k, v] of Object.entries(b.maternal ?? {})) if (v instanceof Date && future(req, v)) fields[`maternal.${k}`] = "This can't be in the future.";
  if (b.consultantId) {
    const c = await memberWith(req.tenantId, b.consultantId, ['doctor']);
    if (!c) fields.consultantId = 'Choose a doctor who works here.';
    else n.consultant = c;
  } else if (b.consultantId === null) n.consultant = null;
  let counselledBy = null;
  if (b.followOn?.counselledById) {
    counselledBy = await memberWith(req.tenantId, b.followOn.counselledById, ['doctor', 'rmo', 'nurse']);
    if (!counselledBy) fields['followOn.counselledById'] = 'Choose who counselled the parents.';
  }
  const after = { weightGrams: b.weightGrams ?? n.weightGrams, gestationWeeks: b.gestationWeeks ?? n.gestationWeeks };
  if (F03.belowFloor(unit, after.gestationWeeks, after.weightGrams) && !n.floorDecision && !b.floorDecision) fields.floorDecision = "Below the admission floor: record the consultant's decision – admit here or the transfer pathway (NEO-F-18).";
  if (b.floorDecision) {
    const c = await memberWith(req.tenantId, b.floorDecision.consultantId, ['doctor']);
    if (!c) fields['floorDecision.consultantId'] = 'Choose the consultant (a doctor who works here).';
    else n.floorDecision = { decision: b.floorDecision.decision, consultantId: c.id, consultantName: c.name, note: b.floorDecision.note, at: nowOf(req) };
  }
  if (Object.keys(fields).length) throw invalid(fields);
  for (const k of ['weightGrams', 'gestationWeeks', 'gestationDays', 'temperatureC', 'reasonPrimary', 'allergyAlert', 'bedType']) if (b[k] !== undefined) n[k] = b[k];
  if (b.maternal) {
    // A pre-filled value changed by hand no longer says where it came from
    const was = plain(n.maternal) ?? {};
    const now = plain(b.maternal);
    const from = { ...(n.maternalFrom ?? {}) };
    for (const k of Object.keys(from)) if (JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k] ?? null)) delete from[k];
    n.maternal = now;
    n.maternalFrom = from;
    n.markModified('maternal');
    n.markModified('maternalFrom');
  }
  if (b.assessment) {
    n.assessment = plain(b.assessment);
    n.markModified('assessment');
  }
  if (b.plan) {
    n.plan = plain(b.plan);
    n.markModified('plan');
  }
  if (b.followOn) {
    const was = plain(n.followOn) ?? {};
    const f = plain(b.followOn);
    if (f.counselledAt && !counselledBy && !was.counselledById) counselledBy = { id: req.user._id, name: req.user.name };
    if (counselledBy) Object.assign(f, { counselledById: String(counselledBy.id), counselledByName: counselledBy.name });
    else Object.assign(f, { counselledById: was.counselledById ?? null, counselledByName: was.counselledByName ?? null });
    // When each time was typed (the late-entry badge, PX-X-04)
    f.typedAt = { ...(was.typedAt ?? {}) };
    for (const k of ['counselledAt', 'consultantInformedAt', 'consultantReviewAt', 'expressingStartedAt']) if (f[k] && f[k] !== was[k]) f.typedAt[k] = nowOf(req);
    if (f.consultantReviewAt && !was.consultantReviewAt) Object.assign(f, { consultantReviewByName: req.user.name });
    else f.consultantReviewByName = was.consultantReviewByName ?? null;
    n.followOn = f;
    n.markModified('followOn');
  }
  n.editedAt = nowOf(req);
  n.editedByName = req.user.name;
  await n.save();
  await syncRopEvent(req.tenantId, baby, n, req.user.name);
  await audit(req, 'NICU_ADMISSION_UPDATED', { details: ids(baby, { admissionId: String(n._id), parts }) });
  await respond(req, res, n, baby);
});

// §1 filled in from the linked records (PX-X-14) – for an admission made at the desk, or to bring in what was recorded
// since: only fields still empty are filled; nothing typed is changed. The mother's record only for those who may see it.
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
newbornCareRouter.post('/nicu/:id/prefill', async (req, res) => {
  const { n, baby } = await admissionFor(req);
  if (n.format !== 'f03' || n.cancelled) throw conflict('This admission cannot be filled in.');
  if (n.signed) throw conflict('The admission is signed: §1 can no longer be changed.');
  const p = await prefillFor(req, baby, n.motherId ?? baby.newborn?.mother ?? null);
  const was = plain(n.maternal) ?? maternalSchema.parse({});
  const from = { ...(n.maternalFrom ?? {}) };
  const filled = [];
  for (const [k, v] of Object.entries(p.values)) {
    if (k === 'serology') {
      was.serology ??= {};
      for (const [t, r] of Object.entries(v)) {
        if (!isEmpty(was.serology[t])) continue;
        was.serology[t] = r;
        filled.push(`serology.${t}`);
        from.serology = p.from.serology;
      }
    } else if (isEmpty(was[k])) {
      was[k] = v;
      from[k] = p.from[k];
      filled.push(k);
    }
  }
  n.maternal = maternalSchema.parse(was);
  n.maternalFrom = from;
  n.markModified('maternal');
  n.markModified('maternalFrom');
  for (const k of ['allergyAlert', 'weightGrams', 'gestationWeeks']) {
    if (isEmpty(n[k]) && !isEmpty(p[k])) {
      n[k] = p[k];
      filled.push(k);
    }
  }
  n.editedAt = nowOf(req);
  n.editedByName = req.user.name;
  await n.save();
  await syncRopEvent(req.tenantId, baby, n, req.user.name);
  await audit(req, 'NICU_ADMISSION_UPDATED', { details: ids(baby, { admissionId: String(n._id), parts: ['prefill'], prefilledFrom: [...new Set(Object.values(p.from))] }) });
  await respond(req, res, n, baby, { filled: filled.length, motherHidden: p.motherHidden });
});

newbornCareRouter.post('/nicu/:id/sign', async (req, res) => {
  const { n, baby } = await admissionFor(req);
  if (!maySign(req, baby)) throw forbidden('The admission is signed by a doctor or an RMO.');
  if (n.format !== 'f03') throw conflict('This admission was recorded before the NEO-F-03 form.');
  if (n.cancelled) throw conflict('This admission is marked entered in error.');
  if (n.signed) throw conflict('The admission is already signed.');
  const missing = missingForSign(n);
  if (Object.keys(missing).length) throw invalid(missing, 'Fill in the highlighted parts before signing.');
  const role = hasRole(req.membership, 'doctor') ? 'doctor' : 'rmo';
  n.signed = { by: req.user._id, byName: req.user.name, role, at: nowOf(req) };
  if (!n.admittingDoctor?.id) n.admittingDoctor = { id: req.user._id, name: req.user.name };
  await n.save();
  await audit(req, 'NICU_ADMISSION_SIGNED', { details: ids(baby, { admissionId: String(n._id) }) });
  await respond(req, res, n, baby);
});

newbornCareRouter.post('/nicu/:id/outcome', async (req, res) => {
  const { n, baby } = await admissionFor(req, false);
  const b = parse(z.object({ result: outcomeResult, at: time('Time'), note: text('Note', 500), details: outcomeDetailsSchema.default({}) }).strict(), req.body);
  if (!maySign(req, baby)) throw forbidden('How an admission ended is recorded by a doctor or an RMO.');
  if (n.outcome || n.cancelled) throw conflict('This admission is already closed.');
  const fields = {};
  if (b.at < n.admittedAt) fields.at = 'This is before the admission.';
  if (future(req, b.at)) fields.at = "This can't be in the future.";
  const d = b.details;
  if (b.result === 'transferred' && !d.transferTo) fields['details.transferTo'] = 'Write where the baby was transferred to.';
  if (d.transferDecisionAt && d.transferDepartedAt && d.transferDepartedAt < d.transferDecisionAt) fields['details.transferDepartedAt'] = 'The departure is before the decision – please check the times.';
  if (Object.keys(fields).length) throw invalid(fields);
  n.outcome = { result: b.result, at: b.at, note: b.note, by: req.user._id, byName: req.user.name, details: plain(d) };
  await n.save();
  await audit(req, 'NICU_OUTCOME_RECORDED', { details: ids(baby, { admissionId: String(n._id), result: b.result }) });
  await respond(req, res, n, baby);
});

const MODELS = { birth: NewbornBirthCare, exam: NewbornExam, bilirubin: BilirubinReading, nicu: NicuAdmission };
newbornCareRouter.post('/:kind/:id/cancel', async (req, res) => {
  const { kind, id } = parse(z.object({ kind: z.enum(Object.keys(MODELS)), id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Please say why (at least 5 characters).').max(300) }).strict(), req.body);
  const doc = await MODELS[kind].findOne({ _id: id, tenantId: req.tenantId });
  if (!doc) throw new HttpError(404, 'This record was not found.', 'NOT_FOUND');
  const baby = await babyFor(req, doc.patientId, true);
  if (doc.cancelled) throw conflict('Already marked as entered in error.');
  doc.cancelled = { reason, by: req.user._id, byName: req.user.name, at: nowOf(req) };
  if (kind === 'birth') doc.live = false;
  await doc.save();
  // An admission entered in error keeps its register number (no gaps) and takes its ROP screen off the log
  if (kind === 'nicu') await NewbornFollowUp.updateOne({ tenantId: req.tenantId, patientId: baby._id }, { $pull: { events: { admissionId: doc._id } } });
  await audit(req, 'NEWBORN_CARE_CANCELLED', { details: ids(baby, { kind, id: String(doc._id) }) });
  res.json({ cancelled: true });
});

// ---------- The register (NEO-L-05) ----------
const yesNoWord = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'unknown' ? 'Unknown' : '');
const gaWords = (w, d) => (w == null ? '' : `${w}+${d ?? 0}`);
async function registerRows(req, month, unitKey) {
  const { start, end } = monthRange(month);
  const units = await unitsOf(req.tenantId);
  const filter = { tenantId: req.tenantId, admittedAt: { $gte: start, $lt: end }, ...(unitKey ? { unit: unitKey } : {}) };
  const list = await NicuAdmission.find(filter).lean();
  const unitOrder = new Map(units.map((u, i) => [u.key, i]));
  list.sort((a, b) => (unitOrder.get(a.unit) ?? 99) - (unitOrder.get(b.unit) ?? 99) || (a.registerNo == null) - (b.registerNo == null) || (a.registerYear ?? 0) - (b.registerYear ?? 0) || (a.registerNo ?? a.serial) - (b.registerNo ?? b.serial));
  const babies = await Patient.find({ tenantId: req.tenantId, _id: { $in: list.map((n) => n.patientId) } });
  const byId = new Map(babies.map((b) => [String(b._id), b]));
  const shown = list.filter((n) => byId.has(String(n.patientId)) && mayView(req, byId.get(String(n.patientId))));
  const ctx = { units, now: nowOf(req), mothers: await mothersOf(req, shown) };
  const rows = shown.map((n) => {
    const v = nicuView(n, byId.get(String(n.patientId)), ctx);
    const o = n.outcome?.details ?? {};
    const baby = byId.get(String(n.patientId));
    return {
      ...v,
      baby: { id: String(baby._id), fullName: baby.fullName, mrn: baby.mrn },
      register: {
        serial: v.registerLabel,
        admittedAt: n.admittedAt,
        babyUhid: baby.mrn,
        motherUhid: v.motherMrn ?? '',
        inbornOutborn: F03.isInborn(n.source) ? 'inborn' : 'outborn',
        ga: gaWords(n.gestationWeeks, n.gestationDays),
        weightG: n.weightGrams,
        admissionReasonPrimary: n.reasonPrimary ?? (n.reasons ?? []).join(';'),
        ventilated: yesNoWord(o.ventilated),
        surfactant: yesNoWord(o.surfactant),
        tpn: yesNoWord(o.tpn),
        morbidities: (o.morbidities ?? []).join(';'),
        outcome: n.cancelled ? 'entered_in_error' : (n.outcome?.result ?? ''),
        dischargedAt: n.outcome?.at ?? null,
        losDays: n.outcome ? F03.lengthOfStayDays(n.admittedAt, n.outcome.at) : null,
        weightAtDischarge: o.weightAtDischargeG ?? null,
        mmRef: o.mmReviewRef ?? '',
      },
    };
  });
  // No gaps: every number of the unit's year up to the last one this month is there (entered in error included)
  const gaps = [];
  const groups = new Map();
  for (const n of list.filter((x) => x.registerNo)) {
    const k = `${n.unit}|${n.registerYear}`;
    groups.set(k, Math.max(groups.get(k) ?? 0, n.registerNo));
  }
  for (const [k, max] of groups) {
    const [unit, year] = k.split('|');
    const have = new Set((await NicuAdmission.find({ tenantId: req.tenantId, unit, registerYear: Number(year), registerNo: { $lte: max } }, { registerNo: 1 }).lean()).map((x) => x.registerNo));
    const missing = [];
    for (let i = 1; i <= max; i += 1) if (!have.has(i)) missing.push(i);
    gaps.push({ unit, year: Number(year), last: max, missing });
  }
  return { rows, gaps, units, shown };
}
const REGISTER_COLUMNS = ['serial', 'admitted_at', 'baby_uhid', 'mother_uhid', 'inborn_outborn', 'ga', 'weight_g', 'admission_reason_primary', 'ventilated', 'surfactant', 'tpn', 'morbidities', 'outcome', 'discharged_at', 'los_days', 'weight_at_discharge', 'mm_ref'];
const registerQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month (YYYY-MM)'), unit: z.string().regex(/^[a-z0-9_]{2,30}$/).optional() }).strict();

newbornCareRouter.get('/register', async (req, res) => {
  const { month, unit } = parse(registerQuery, req.query);
  const { rows, gaps, units, shown } = await registerRows(req, month, unit);
  const live = shown.filter((n) => !n.cancelled);
  const outcomes = Object.fromEntries([...Object.keys(NICU_OUTCOMES), ...Object.keys(F03.OUTCOMES_F03)].map((k) => [k, live.filter((n) => n.outcome?.result === k).length]));
  const closed = live.filter((n) => n.outcome);
  const band = (test) => {
    const inBand = closed.filter((n) => n.weightGrams != null && test(n.weightGrams));
    return { n: inBand.filter((n) => F03.survived(n.outcome.result)).length, N: inBand.length };
  };
  await audit(req, 'NICU_REGISTER_VIEWED', { details: { month, count: rows.length, ...(unit ? { unit } : {}) } });
  res.json({
    month,
    unit: unit ?? null,
    rows,
    gaps,
    units,
    columns: REGISTER_COLUMNS,
    totals: {
      admissions: live.length,
      inborn: live.filter((n) => F03.isInborn(n.source)).length,
      outborn: live.filter((n) => !F03.isInborn(n.source)).length,
      cold: live.filter((n) => coldAtAdmission(n.temperatureC)).length,
      tempInRange: live.filter((n) => F03.tempInRange(n.temperatureC)).length,
      stillAdmitted: live.filter((n) => !n.outcome).length,
      outcomes,
      survivalByWeight: Object.fromEntries(F03.WEIGHT_BANDS.map((b) => [b.key, band(b.test)])),
      survivalUnder1500: band((g) => g < 1500),
    },
    weightBands: F03.WEIGHT_BANDS.map((b) => ({ key: b.key, label: b.label })),
    rules: NEWBORN_RULES,
  });
});

newbornCareRouter.get('/register.csv', async (req, res) => {
  const { month, unit } = parse(registerQuery, req.query);
  const { rows } = await registerRows(req, month, unit);
  const iso = (d) => (d ? new Date(d).toISOString() : '');
  const lines = [REGISTER_COLUMNS, ...rows.map(({ register: r }) => [r.serial, iso(r.admittedAt), r.babyUhid, r.motherUhid, r.inbornOutborn, r.ga, r.weightG ?? '', r.admissionReasonPrimary, r.ventilated, r.surfactant, r.tpn, r.morbidities, r.outcome, iso(r.dischargedAt), r.losDays ?? '', r.weightAtDischarge ?? '', r.mmRef])];
  await audit(req, 'NICU_REGISTER_EXPORTED', { details: { month, count: rows.length, ...(unit ? { unit } : {}) } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="NEO-L-05-${unit ?? 'all'}-${month}.csv"`);
  res.send(toCsv(lines));
});

// ---------- The unit board (NEO-A-01) ----------
newbornCareRouter.get('/board', async (req, res) => {
  const now = nowOf(req);
  await runNicuAutomations(req.tenantId, now);
  const [units, beds] = await Promise.all([unitsOf(req.tenantId), nicuBeds(req.tenantId)]);
  const open = await NicuAdmission.find({ tenantId: req.tenantId, ...openFilter }).sort({ admittedAt: 1 }).lean();
  const babies = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: open.map((n) => n.patientId) } })).map((p) => [String(p._id), p]));
  const roster = await latestRoster(req.tenantId, units.map((u) => u.key));
  const ctx = { units, now, mothers: await mothersOf(req, open) };
  const shownBaby = (id) => {
    const p = babies.get(String(id));
    return p && mayView(req, p) ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn } : null;
  };
  const out = units
    .filter((u) => u.active)
    .map((u) => {
      const mine = beds.filter((b) => b.nicu.unit === u.key);
      const intensiveBabies = mine.filter((b) => b.nicu.level === 'intensive' && b.occupied).length;
      const nurses = roster[u.key]?.nurses ?? null;
      const admissions = open
        .filter((n) => n.unit === u.key)
        .map((n) => {
          const baby = shownBaby(n.patientId);
          if (!baby) return { id: String(n._id), hidden: true, bedId: n.bedId ? String(n.bedId) : null };
          const v = nicuView(n, babies.get(String(n.patientId)), ctx);
          return { id: v.id, baby, bedId: n.bedId ? String(n.bedId) : null, registerLabel: v.registerLabel, admittedAt: v.admittedAt, format: v.format, flags: v.flags ?? {}, banners: (v.banners ?? []).filter((x) => x.key !== 'late') };
        });
      return {
        key: u.key,
        name: u.name,
        level: u.level,
        capacity: mine.length,
        free: mine.filter((b) => !b.occupied).length,
        intensiveBabies,
        nurses: roster[u.key],
        ratio: ratioWarning(intensiveBabies, nurses),
        beds: mine.map((b) => ({ ...bedView(b), admissionId: b.occupant ? String(b.occupant._id) : null, stay: Boolean(b.stay) })),
        admissions,
        counts: { incomplete: admissions.filter((a) => a.flags?.incomplete).length, counselOverdue: admissions.filter((a) => a.flags?.counselOverdue).length },
      };
    });
  await audit(req, 'NICU_BOARD_VIEWED', { details: { units: out.length } });
  res.json({ units: out, ratio: F03.NURSE_BABY_RATIO, levels: F03.LEVELS, bedKinds: F03.BED_KINDS });
});

newbornCareRouter.post('/roster', async (req, res) => {
  const b = parse(z.object({ unit: z.string().regex(/^[a-z0-9_]{2,30}$/, 'Choose the unit'), nurses: z.coerce.number('Enter the number of nurses').int('A whole number').min(0).max(50) }).strict(), req.body);
  const units = await unitsOf(req.tenantId);
  if (!units.some((u) => u.key === b.unit && u.active)) throw invalid({ unit: 'Choose one of the units.' });
  await NicuRoster.create({ tenantId: req.tenantId, unit: b.unit, nurses: b.nurses, at: nowOf(req), by: req.user._id, byName: req.user.name });
  await audit(req, 'NICU_ROSTER_SET', { details: { unit: b.unit, nurses: b.nurses } });
  res.status(201).json({ unit: b.unit, nurses: b.nurses });
});
