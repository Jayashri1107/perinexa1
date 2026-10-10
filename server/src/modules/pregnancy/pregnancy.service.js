// A pregnancy's scans and vaccinations (owner, 10 Oct 2026): the schedule of the hospital's antenatal care plan
// (Clinic library, cp_antenatal – marked DRAFT until a doctor approves it, the owner's choice) for one patient, worked
// out from her EDD; staff tick what is done with the date; the pregnancy card prints it. And the check-ups due in a week,
// for reminders with a NEUTRAL message (no scan name, no word about pregnancy – a family member may read her phone),
// only to patients who agreed to messages.
//  - the card: those who look after her clinically (doctors, RMOs, nurses – at least clinicalRead);
//  - ticking done: her doctor or an RMO (full access), or a nurse (config.access.pregnancyRecord);
//  - the reminders: Calendar (config.access.calendar) – reception sees names, phones, dates and the message only.
// The patient's plan is the care-plan record (careplans/carePlan.model.js), saved the first time something is ticked or
// a reminder is sent; until then it is worked out from the template each time. Decision support only.
import { config } from '../../config/index.js';
import { todayLocal } from '../../core/dates.js';
import { HttpError, notFoundError } from '../../core/httpError.js';
import { recordAudit } from '../audit/audit.service.js';
import { CarePlan } from '../careplans/carePlan.model.js';
import { addDays, itemStatuses, utcDay, weekZero } from '../careplans/planEngine.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { ensureLibrary } from '../library/library.service.js';
import { LibraryEntry } from '../library/libraryEntry.model.js';
import { EmergencyAccess, Patient } from '../patients/patient.model.js';
import { atLeast, listVisibility, recordLevel } from '../patients/patientAccess.js';

const { access } = config;
const DOCTOR = config.opd.doctorRole;
const TEMPLATE_KEY = 'cp_antenatal';
const CARD_KINDS = ['scan', 'vaccination'];
const DAY = 86400000;
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));

// ---------- Her record and the template ----------

async function loadPatient(req, patientId) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  const emergency = await EmergencyAccess.exists({ hospitalId: req.hospitalId, patientId: patient._id, userId: req.user._id, expiresAt: { $gt: new Date() } });
  const level = recordLevel(req, patient, { emergency: Boolean(emergency) });
  if (!atLeast(level, 'clinicalRead')) throw notFoundError('Patient');
  if (patient.careType !== 'antenatal') throw new HttpError(409, 'The pregnancy card is for patients registered for pregnancy care (antenatal).', 'NOT_ANTENATAL');
  return { patient, level };
}

// Her doctor or an RMO (full access), or a nurse; another doctor who may only read her record does not tick.
const canMark = (req, level) => has(req, access.pregnancyRecord) && (level === 'full' || !req.membership.roles.includes(DOCTOR));

async function templateOf(hospitalId) {
  await ensureLibrary(hospitalId);
  return LibraryEntry.findOne({ hospitalId, kind: 'care_plan', key: TEMPLATE_KEY, isActive: true }).lean();
}

const copyItem = (i) => ({ key: i.key, kind: i.kind, name: i.name, patientText: i.patientText ?? '', source: i.source ?? '', appliesWhen: i.appliesWhen ?? '', atBooking: Boolean(i.atBooking), fromWeek: i.fromWeek ?? null, toWeek: i.toWeek ?? null, after: i.after ?? null });

// Her current antenatal plan, or a new (unsaved) one from the template.
async function planOf(req, patient, template) {
  const saved = await CarePlan.findOne({ hospitalId: req.hospitalId, patientId: patient._id, status: 'active', careType: 'antenatal' });
  if (saved) return saved;
  if (!template) return null;
  return new CarePlan({
    hospitalId: req.hospitalId,
    patientId: patient._id,
    careType: 'antenatal',
    template: { key: template.key, name: template.name, version: template.version },
    bookedOn: utcDay(patient.createdAt ?? new Date()),
    items: (template.content?.items ?? []).map(copyItem),
    createdBy: req.user._id,
    createdByName: req.user.name ?? req.user.email ?? '',
  });
}

const today = () => utcDay(todayLocal());

// Each scan and vaccination with its status today and its window of dates.
function cardItems(plan, patient) {
  if (!plan) return [];
  const p = plan.toObject ? plan.toObject() : plan;
  const statuses = itemStatuses({ ...p, weekZero: weekZero(patient, 'antenatal'), risk: { override: p.riskOverride } }, { patient, today: today() });
  return statuses.filter((s) => CARD_KINDS.includes(s.item.kind));
}

function weeksToday(patient) {
  const zero = weekZero(patient, 'antenatal');
  if (!zero) return null;
  const days = Math.floor((today() - zero) / DAY);
  if (days < 0 || days > 44 * 7) return null;
  return { weeks: Math.floor(days / 7), days: days % 7 };
}

async function cardView(req, { patient, level }, plan, template) {
  const hospital = await Hospital.findById(req.hospitalId).select('name letterhead logoVersion').lean();
  return {
    patient: {
      id: String(patient._id),
      name: patient.name,
      patientNumber: patient.patientNumber,
      birthDate: patient.birthDate,
      birthDateApprox: Boolean(patient.birthDateApprox),
      phone: patient.phone ?? '',
      consentMessages: Boolean(patient.consentMessages),
      lmp: patient.lmp,
      edd: patient.edd,
      gravida: patient.gravida ?? null,
      para: patient.para ?? null,
      bloodGroup: patient.bloodGroup ?? '',
    },
    weeksToday: weeksToday(patient),
    // DRAFT until a doctor approves the antenatal care plan in the Clinic library
    draft: !template || template.status !== 'approved',
    templateName: template?.name ?? '',
    items: cardItems(plan, patient).map(({ item, status, window }) => ({
      key: item.key,
      kind: item.kind,
      name: item.name,
      patientText: item.patientText ?? '',
      fromWeek: item.fromWeek,
      toWeek: item.toWeek,
      atBooking: Boolean(item.atBooking),
      afterKey: item.after?.key ?? null,
      afterWeeks: item.after?.weeks ?? null,
      appliesWhen: item.appliesWhen ?? '',
      status,
      window,
      done: item.done ? { on: item.done.on, note: item.done.note ?? '', byName: item.done.byName } : null,
      remindedAt: item.remindedAt ?? null,
    })),
    print: { hospitalName: hospital?.name ?? '', letterhead: { ...(hospital?.letterhead ?? {}), logoVersion: hospital?.logoVersion ?? 0 } },
    can: { mark: canMark(req, level) },
  };
}

export async function getCard(req, patientId) {
  const loaded = await loadPatient(req, patientId);
  const template = await templateOf(req.hospitalId);
  const plan = await planOf(req, loaded.patient, template);
  await recordAudit(req, 'PREGNANCY_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id) } });
  return cardView(req, loaded, plan, template);
}

// ---------- Ticking a scan or vaccination done ----------

async function savePlan(plan) {
  try {
    await plan.save();
  } catch (err) {
    // someone saved her first plan at the same moment: one current plan per patient
    if (err.code === 11000) throw new HttpError(409, 'Her plan was just changed by someone else. Reload the page and try again.', 'CONFLICT');
    throw err;
  }
}

async function itemFor(req, patientId, key, { mark = true } = {}) {
  const loaded = await loadPatient(req, patientId);
  if (mark && !canMark(req, loaded.level)) throw new HttpError(403, 'Her doctor, an RMO or a nurse records this.', 'FORBIDDEN');
  const template = await templateOf(req.hospitalId);
  const plan = await planOf(req, loaded.patient, template);
  const item = plan?.items.find((i) => i.key === key && CARD_KINDS.includes(i.kind));
  if (!item) throw notFoundError('Scan or vaccination');
  return { loaded, template, plan, item };
}

export async function markDone(req, patientId, key, { on, note }) {
  const { loaded, template, plan, item } = await itemFor(req, patientId, key);
  if (item.state === 'done') throw new HttpError(409, 'This is already recorded as done.', 'ALREADY_DONE');
  const day = utcDay(on);
  if (day > today()) throw new HttpError(400, 'The date cannot be in the future.', 'VALIDATION', { on: 'The date cannot be in the future.' });
  item.set({ state: 'done', done: { on: day, note, byName: req.user.name ?? '', by: req.user._id, at: new Date() } });
  await savePlan(plan);
  await recordAudit(req, 'PREGNANCY_ITEM_DONE', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), item: key } });
  return cardView(req, loaded, plan, template);
}

export async function undoDone(req, patientId, key, { reason }) {
  const { loaded, template, plan, item } = await itemFor(req, patientId, key);
  if (item.state !== 'done') throw new HttpError(409, 'This is not recorded as done.', 'NOT_DONE');
  item.set({ state: 'open', done: null });
  await savePlan(plan);
  await recordAudit(req, 'PREGNANCY_ITEM_UNDONE', { hospitalId: req.hospitalId, details: { patientId: String(loaded.patient._id), item: key, reason } });
  return cardView(req, loaded, plan, template);
}

// ---------- Check-ups due (reminders) ----------

const isoDay = (d) => utcDay(d).toISOString().slice(0, 10);
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';
const firstPhone = (phones) => String(phones ?? '').split(/[,/]/)[0].trim();
const dateWords = (d, lang) => new Intl.DateTimeFormat(lang === 'mr' ? 'mr-IN' : 'en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);

// The neutral message, in Marathi and in English. The Marathi wording is a draft – to be checked by a Marathi speaker.
function messages({ name, hospital, phone, from, to }) {
  const call = (text) => (phone ? text : '');
  return {
    mr: `नमस्कार ${name}, ${hospital} कडून आठवण: आपली पुढील तपासणी ${dateWords(from, 'mr')} ते ${dateWords(to, 'mr')} या कालावधीत आहे.${call(` वेळ घेण्यासाठी कृपया ${phone} वर संपर्क साधा.`)}`,
    en: `Namaste ${name}, a reminder from ${hospital}: your next check-up is due between ${dateWords(from, 'en')} and ${dateWords(to, 'en')}.${call(` Please call ${phone} to book a time.`)}`,
  };
}

// The check-ups (scans and vaccinations) whose dates fall in the week from `from`, for patients who agreed to messages.
export async function reminders(req, { from }) {
  const start = from ? utcDay(from) : today();
  const end = addDays(start, 6);
  const clinical = has(req, access.calendarClinical);
  const base = { hospitalId: req.hospitalId, careType: 'antenatal', status: 'active', edd: { $gte: addDays(start, -14) }, ...listVisibility(req) };
  const [patients, notAgreed, template, hospital] = await Promise.all([
    Patient.find({ ...base, consentMessages: true }).select('name patientNumber phone edd lmp createdAt bloodGroup').limit(2000).lean(),
    Patient.countDocuments({ ...base, consentMessages: { $ne: true } }),
    templateOf(req.hospitalId),
    Hospital.findById(req.hospitalId).select('name letterhead').lean(),
  ]);
  const saved = new Map(
    (await CarePlan.find({ hospitalId: req.hospitalId, patientId: { $in: patients.map((p) => p._id) }, status: 'active', careType: 'antenatal' }).lean()).map((p) => [String(p.patientId), p]),
  );
  const virtual = template ? { bookedOn: null, items: (template.content?.items ?? []).map((i) => ({ ...copyItem(i), state: 'open' })) } : null;
  const phone = firstPhone(hospital?.letterhead?.phone);
  const hospitalName = hospital?.name ?? '';

  const items = [];
  for (const p of patients) {
    const plan = saved.get(String(p._id)) ?? (virtual && { ...virtual, bookedOn: utcDay(p.createdAt ?? new Date()) });
    // open in this week, and reminded once only (a reminder sent this week still shows, as sent)
    const due = cardItems(plan, p).filter(
      (s) => ['due', 'upcoming', 'overdue'].includes(s.status) && s.window && new Date(s.window.from) <= end && new Date(s.window.to) >= start && (!s.item.remindedAt || new Date(s.item.remindedAt) >= addDays(start, -7)),
    );
    if (!due.length) continue;
    const winFrom = new Date(Math.max(start, Math.min(...due.map((s) => new Date(s.window.from)))));
    // at most two weeks in the message: a long window (e.g. the flu vaccine) reads as "the next two weeks"
    const winTo = new Date(Math.min(addDays(winFrom, 13), ...due.map((s) => new Date(s.window.to))));
    const to = winTo < winFrom ? end : winTo;
    items.push({
      patient: { id: String(p._id), name: p.name, patientNumber: p.patientNumber, phone: p.phone ?? '' },
      from: isoDay(winFrom),
      to: isoDay(to),
      keys: due.map((s) => s.item.key),
      // what is due – for doctors and RMOs only; reception sees the dates
      ...(clinical && { what: due.map((s) => s.item.name) }),
      sentAt: due.every((s) => s.item.remindedAt) ? due.map((s) => s.item.remindedAt).sort().at(-1) : null,
      message: messages({ name: firstName(p.name), hospital: hospitalName, phone, from: winFrom, to }),
    });
  }
  items.sort((a, b) => a.from.localeCompare(b.from) || a.patient.name.localeCompare(b.patient.name));
  return { from: isoDay(start), to: isoDay(end), items, notAgreed, draft: !template || template.status !== 'approved', noTemplate: !template };
}

export async function markReminded(req, patientId, keys) {
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: patientId, careType: 'antenatal', consentMessages: true }).lean();
  if (!patient) throw notFoundError('Patient');
  const template = await templateOf(req.hospitalId);
  const plan = await planOf(req, patient, template);
  if (!plan) throw notFoundError('Plan');
  const now = new Date();
  let marked = 0;
  for (const item of plan.items) {
    if (keys.includes(item.key) && CARD_KINDS.includes(item.kind)) {
      item.remindedAt = now;
      marked += 1;
    }
  }
  if (!marked) throw notFoundError('Scan or vaccination');
  await savePlan(plan);
  await recordAudit(req, 'PREGNANCY_REMINDER_SENT', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), items: marked } });
  return { sentAt: now };
}
