import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { FERTILITY_NUMBERS, fertilityEmpty } from '../fertility/fertilityFields.js';
import { LADDER_STEPS, PROCEDURES, SWITCH_KEYS, counterFor, stepOf, targetByKey } from '../fertility/ladder.js';
import { dateWords } from '../careplans/dates.js';
import { DRAFT_NOTE, FERTILITY_LIBRARY_VERSION, PROTOCOL_KEYS, SECTION_ORDER, composePlan, libraryView } from '../fertility/protocols.js';
import { fertilityFacts, suggestProtocols } from '../fertility/suggest.js';
import { COMPLETED_KINDS, FertilityPlan, MAX_SECTION_TEXT, MAX_VERSIONS, OUTCOME_KINDS, STOPPED_KINDS } from '../models/FertilityPlan.js';
import { hasRole } from '../models/Membership.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatient } from '../utils/patientLookup.js';
import { dateOnly, objectId, parse } from '../utils/validate.js';

// A patient's fertility treatment plan: /api/patients/:id/fertility-plan (docs/FERTILITY_PLAN.md – DRAFT library).
// Mounted inside the patients router after its role gate (mergeParams gives the patient id).
//   GET  /              her current plan (draft or active), the earlier ones, what the record still lacks
//   GET  /suggestions   the protocols that fit her record, best fit first, with the whole library to browse
//   POST /              build a draft plan from the chosen protocols (one current plan at a time); with `switchFrom`
//                       the current plan is closed as "moved to the next step" and the cycles done under it are added
//                       to her record (the ladder: follicular study → IUI → IVF, or another procedure – fertility/ladder.js)
//   PUT  /:planId       edit the title, dates and section texts (every save keeps the previous version)
//   POST /:planId/status  confirm (draft → active, a doctor), complete or stop (with the outcome)
// Who may do what: seen by those who see her medical details (on an infertility record, or one with a fertility
// history); drafted and edited by those who may change the clinical details – her doctor (any doctor while she has
// none) or an RMO; confirmed by a doctor. Nothing is sent to an outside service. The audit log gets ids and the
// plan's status only – never a protocol name or any text.

export const fertilityPlanRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const notFound = () => new HttpError(404, 'This treatment plan was not found.', 'NOT_FOUND');
const rev = z.number('The plan version is missing – please reload the page').int().min(0);
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const stampView = (s) => (s?.at ? { byName: s.byName ?? null, at: s.at } : null);
const ids = (patient, plan, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, planId: plan ? String(plan._id) : null, ...extra });

/** What this person may do with this patient's fertility plans. */
export function fertilityAccess(req, patient) {
  const a = patientAccess(req, patient);
  const fertilityRecord = patient.careType === 'infertility';
  const view = a.view.has('pregnancy') && (fertilityRecord || !fertilityEmpty(patient.fertility));
  const write = view && a.editClinical === true;
  return {
    view,
    write, // edit a plan, close it
    create: write && fertilityRecord && !isClosed(patient) && !isDuplicate(patient),
    activate: write && hasRole(req.membership, 'doctor'), // a doctor confirms the plan
  };
}

/** A plan as the website shows it: names, never staff ids. */
export function planView(plan) {
  const p = plan.toObject ? plan.toObject() : plan;
  return {
    id: String(p._id),
    status: p.status,
    protocolKeys: p.protocolKeys ?? [],
    step: stepOf(p.protocolKeys ?? []), // the ladder step the plan stands on, or null for a procedure or work-up
    switchedFrom: p.switchedFrom?.planId ? { planId: String(p.switchedFrom.planId), title: p.switchedFrom.title ?? '', at: p.switchedFrom.at ?? null } : null,
    libraryVersion: p.libraryVersion,
    title: p.title,
    startOn: p.startOn ?? null,
    reviewOn: p.reviewOn ?? null,
    sections: (p.sections ?? []).map((s) => ({ key: s.key, title: s.title, text: s.text ?? '' })),
    sources: (p.sources ?? []).map((s) => ({ key: s.key, label: s.label, bodies: s.bodies })),
    suggested: (p.suggested ?? []).map((s) => ({ key: s.key, fit: s.fit })),
    outcome: p.outcome?.kind ? { kind: p.outcome.kind, note: p.outcome.note ?? '', byName: p.outcome.byName ?? null, at: p.outcome.at ?? null } : null,
    created: stampView(p.created),
    activated: stampView(p.activated),
    lastEdited: stampView(p.lastEdited),
    versions: (p.versions ?? []).map((v) => ({ at: v.at, byName: v.byName ?? null, title: v.title, startOn: v.startOn ?? null, reviewOn: v.reviewOn ?? null, sections: (v.sections ?? []).map((s) => ({ key: s.key, title: s.title, text: s.text ?? '' })) })),
    rev: p.rev ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const isCurrent = (p) => p.status === 'draft' || p.status === 'active';

async function loadPatientAndAccess(req, { need = 'view', message }) {
  const patient = await findPatient(req);
  const access = fertilityAccess(req, patient);
  if (!access[need]) throw forbidden(message ?? (need === 'view' ? 'Her treatment plan is not part of your role for this patient.' : "Only her doctor or an RMO changes this patient's treatment plan."));
  return { patient, access };
}

async function loadPlan(req, patient) {
  const { planId } = parse(z.object({ planId: objectId }).passthrough(), req.params);
  const plan = await FertilityPlan.findOne({ _id: planId, tenantId: req.tenantId, patientId: patient._id });
  if (!plan) throw notFound();
  return plan;
}

const answer = (patient, plan, access, extra = {}) => ({
  plan: planView(plan),
  access: { canEdit: access.write && isCurrent(plan), canActivate: access.activate && plan.status === 'draft', canCreate: false },
  ...extra,
});

// Her current plan, the earlier ones, and what the record still lacks for a confident suggestion.
fertilityPlanRouter.get('/', async (req, res) => {
  const { patient, access } = await loadPatientAndAccess(req, { need: 'view' });
  const plans = await FertilityPlan.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 });
  const current = plans.find(isCurrent) ?? null;
  const facts = fertilityFacts(patient, req.now);
  await audit(req, 'FERTILITY_PLAN_VIEWED', { details: ids(patient, current) });
  res.json({
    plan: current ? planView(current) : null,
    earlier: plans.filter((p) => p !== current).map(planView),
    facts: { recorded: facts.recorded, missing: facts.missing },
    access: { canEdit: access.write && Boolean(current), canActivate: access.activate && current?.status === 'draft', canCreate: access.create && !current, canSuggest: access.write && patient.careType === 'infertility' },
    libraryVersion: FERTILITY_LIBRARY_VERSION,
    sectionOrder: SECTION_ORDER,
    ladder: { steps: LADDER_STEPS, procedures: PROCEDURES },
    draftNote: DRAFT_NOTE,
  });
});

// The protocols that fit her record, best fit first, with their reasons – and the whole library to browse.
fertilityPlanRouter.get('/suggestions', async (req, res) => {
  const { patient } = await loadPatientAndAccess(req, { need: 'write', message: 'Only her doctor or an RMO asks for plan suggestions.' });
  const { options, facts } = suggestProtocols(patient, req.now);
  res.json({ options, facts, library: libraryView(), libraryVersion: FERTILITY_LIBRARY_VERSION, draftNote: DRAFT_NOTE });
});

const createSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    // Either the protocols themselves, or a step of the ladder / a procedure (fertility/ladder.js) that names them
    protocolKeys: z.array(z.enum(PROTOCOL_KEYS, 'Choose protocols from the list')).min(1, 'Choose at least one protocol').max(5, 'Choose at most five protocols').optional(),
    target: z.enum(SWITCH_KEYS, 'Choose a step or procedure from the list').optional(),
    startOn: z.preprocess(emptyToNull, dateOnly('Start date')).optional(),
    // Switching from her current plan: it is closed as moved to the next step (a draft is discarded), and the cycles
    // completed under it are added to the matching counter on her record
    switchFrom: z
      .object({
        planId: objectId,
        rev,
        cyclesDone: z.coerce.number('Cycles must be a number').int('Cycles must be a whole number').min(0, "Cycles can't be negative").max(50, 'Too many cycles').default(0),
        note: z.string().trim().max(500, 'The note is too long').default(''),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => Boolean(b.protocolKeys?.length) !== Boolean(b.target), { path: ['protocolKeys'], message: 'Choose protocols, or one step of the ladder' });

// Build a draft plan from the chosen protocols. One current plan at a time; a repeated request (double click) answers
// with the plan already made.
fertilityPlanRouter.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const { patient, access } = await loadPatientAndAccess(req, { need: 'write' });
  if (patient.careType !== 'infertility') throw new HttpError(400, 'A treatment plan is started on an infertility record.', 'VALIDATION');
  refuseNewOnClosed(patient, 'a treatment plan');
  refuseNewOnDuplicate(patient, 'a treatment plan');
  const existing = await FertilityPlan.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (existing) return res.status(200).json(answer(patient, existing, access));
  // Switching: the plan she is on now, checked before anything is written
  let from = null;
  if (body.switchFrom) {
    from = await FertilityPlan.findOne({ _id: body.switchFrom.planId, tenantId: req.tenantId, patientId: patient._id });
    if (!from) throw notFound();
    if (!isCurrent(from)) throw conflict('This plan is already finished; start the next plan from Suggest plans.', 'PLAN_CLOSED');
    if (from.rev !== body.switchFrom.rev) throw conflict('Someone changed this plan meanwhile – the latest version is shown; please try again.', 'CONFLICT');
  }
  if (await FertilityPlan.exists({ tenantId: req.tenantId, patientId: patient._id, status: { $in: ['draft', 'active'] }, ...(from ? { _id: { $ne: from._id } } : {}) })) {
    throw conflict('She already has a treatment plan in progress – complete or stop it before starting another.', 'PLAN_EXISTS');
  }
  const keys = [...new Set(body.protocolKeys ?? targetByKey.get(body.target).protocols)];
  const composed = composePlan(keys);
  if (from) {
    // The chain stays readable on the new plan: where it came from, and why
    const why = body.switchFrom.note ? `: ${body.switchFrom.note}` : '';
    const line = `• Switched from “${from.title}” on ${dateWords(req.now ?? new Date())}${why}`;
    const aim = composed.sections.find((s) => s.key === 'aim');
    if (aim) aim.text = `${line}\n${aim.text}`;
    else composed.sections.unshift({ key: 'aim', title: 'Aim and basis', text: line });
  }
  const suggested = suggestProtocols(patient, req.now).options.filter((o) => o.fit !== 'other').map(({ key, fit }) => ({ key, fit }));
  let plan;
  try {
    plan = await FertilityPlan.create({
      tenantId: req.tenantId,
      patientId: patient._id,
      status: 'draft',
      protocolKeys: keys,
      libraryVersion: FERTILITY_LIBRARY_VERSION,
      title: composed.title,
      startOn: body.startOn ?? hospitalToday(req.now),
      reviewOn: null,
      sections: composed.sections,
      sources: composed.sources,
      suggested,
      switchedFrom: from ? { planId: from._id, title: from.title, at: req.now ?? new Date() } : null,
      created: stampOf(req),
      clientRequestId: body.clientRequestId,
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const again = await FertilityPlan.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
    if (!again) throw e;
    return res.status(200).json(answer(patient, again, access));
  }
  await audit(req, 'FERTILITY_PLAN_CREATED', { details: ids(patient, plan, { protocols: keys.length, ...(from ? { fromPlanId: String(from._id) } : {}) }) });
  let cyclesRecorded = null;
  if (from) {
    // The old plan is closed – completed as moved to the next step, or a draft discarded – with the switch as its note
    const note = [`Switched to “${composed.title}”`, body.switchFrom.note].filter(Boolean).join(' – ').slice(0, 500);
    const stamp = stampOf(req);
    if (from.status === 'active') {
      from.status = 'completed';
      from.outcome = { kind: 'next_step', note, ...stamp };
    } else {
      from.status = 'stopped';
      from.outcome = { kind: 'discarded', note, ...stamp };
    }
    from.rev += 1;
    await from.save();
    await audit(req, 'FERTILITY_PLAN_STATUS_CHANGED', { details: ids(patient, from, { status: from.status }) });
    // The cycles completed under the old plan go to the matching counter on her record (the suggestions read them)
    const counter = counterFor(from.protocolKeys);
    if (counter && body.switchFrom.cyclesDone > 0) {
      const f = patient.fertility?.toObject?.() ?? patient.fertility ?? {};
      const total = Math.min(FERTILITY_NUMBERS[counter].max, (f[counter] ?? 0) + body.switchFrom.cyclesDone);
      patient.fertility = { ...f, [counter]: total };
      await patient.save();
      await audit(req, 'PATIENT_UPDATED', { details: { patientId: String(patient._id), mrn: patient.mrn, fields: ['fertility'] } });
      cyclesRecorded = { counter, total };
    }
  }
  return res.status(201).json(answer(patient, plan, access, { closed: from ? planView(from) : null, cyclesRecorded }));
});

const sectionSchema = z
  .object({
    key: z.string().min(1).max(40),
    title: z.string().trim().min(1, 'Give the section a title').max(100, 'The section title is too long'),
    text: z.string().max(MAX_SECTION_TEXT, 'A section is too long'),
  })
  .strict();
const editSchema = z
  .object({
    rev,
    title: z.string().trim().min(1, 'Give the plan a title').max(200, 'The title is too long'),
    startOn: z.preprocess(emptyToNull, dateOnly('Start date')).default(null),
    reviewOn: z.preprocess(emptyToNull, dateOnly('Review date')).default(null),
    sections: z.array(sectionSchema).min(1, 'A plan needs at least one section').max(12, 'Too many sections'),
  })
  .strict();

// Edit the plan's title, dates and text. The previous text is kept as a version.
fertilityPlanRouter.put('/:planId', async (req, res) => {
  const body = parse(editSchema, req.body);
  const { patient, access } = await loadPatientAndAccess(req, { need: 'write' });
  const plan = await loadPlan(req, patient);
  if (!isCurrent(plan)) throw conflict('This plan is finished and cannot be changed; start a new plan instead.', 'PLAN_CLOSED');
  if (plan.rev !== body.rev) throw conflict('Someone changed this plan meanwhile – the latest version is shown; please make your change again.', 'CONFLICT');
  const previous = { at: plan.lastEdited?.at ?? plan.created.at, byName: plan.lastEdited?.byName ?? plan.created.byName, title: plan.title, startOn: plan.startOn, reviewOn: plan.reviewOn, sections: plan.sections.map((s) => ({ key: s.key, title: s.title, text: s.text })) };
  plan.versions.push(previous);
  if (plan.versions.length > MAX_VERSIONS) plan.versions.splice(0, plan.versions.length - MAX_VERSIONS);
  plan.title = body.title;
  plan.startOn = body.startOn;
  plan.reviewOn = body.reviewOn;
  plan.sections = body.sections.map((s) => ({ key: s.key, title: s.title, text: s.text }));
  plan.lastEdited = stampOf(req);
  plan.rev += 1;
  await plan.save();
  await audit(req, 'FERTILITY_PLAN_EDITED', { details: ids(patient, plan) });
  res.json(answer(patient, plan, access));
});

const statusSchema = z
  .object({
    rev,
    status: z.enum(['active', 'completed', 'stopped'], 'Choose what happens to the plan'),
    outcome: z.object({ kind: z.enum(OUTCOME_KINDS, 'Choose the outcome from the list'), note: z.string().trim().max(500, 'The note is too long').default('') }).strict().optional(),
  })
  .strict();

// Confirm a draft (a doctor), or end the plan with its outcome.
fertilityPlanRouter.post('/:planId/status', async (req, res) => {
  const body = parse(statusSchema, req.body);
  const { patient, access } = await loadPatientAndAccess(req, { need: 'write' });
  const plan = await loadPlan(req, patient);
  if (!isCurrent(plan)) throw conflict('This plan is already finished.', 'PLAN_CLOSED');
  if (plan.rev !== body.rev) throw conflict('Someone changed this plan meanwhile – the latest version is shown; please try again.', 'CONFLICT');
  const invalid = (message, field = 'status') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { [field]: message } });
  if (body.status === 'active') {
    if (plan.status !== 'draft') throw invalid('This plan is already confirmed.');
    if (!access.activate) throw forbidden('Only a doctor confirms a treatment plan; an RMO drafts and edits it.');
    plan.activated = stampOf(req);
  } else {
    const kind = body.outcome?.kind;
    if (!kind) throw invalid('Say how the plan ended.', 'outcome.kind');
    if (body.status === 'completed' && (plan.status !== 'active' || !COMPLETED_KINDS.includes(kind))) {
      throw invalid(plan.status !== 'active' ? 'A draft is stopped, not completed – confirm it first if it was carried out.' : 'A completed plan ends in a pregnancy or in the next step; choose Stop for anything else.', 'outcome.kind');
    }
    if (body.status === 'stopped' && !STOPPED_KINDS.includes(kind)) throw invalid('A stopped plan needs a reason from the list.', 'outcome.kind');
    if (body.status === 'stopped' && kind !== 'discarded' && body.outcome.note.length < 5) throw invalid('Please say why (at least 5 characters).', 'outcome.note');
    plan.outcome = { kind, note: body.outcome.note, ...stampOf(req) };
  }
  plan.status = body.status;
  plan.rev += 1;
  await plan.save();
  await audit(req, 'FERTILITY_PLAN_STATUS_CHANGED', { details: ids(patient, plan, { status: plan.status }) });
  res.json(answer(patient, plan, access));
});
