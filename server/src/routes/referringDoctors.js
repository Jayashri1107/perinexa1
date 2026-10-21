import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { currentAge } from '../models/Patient.js';
import { Referral } from '../models/Referral.js';
import { ReferringDoctor } from '../models/ReferringDoctor.js';
import { isMissed, promisesFor } from '../referrals/clocks.js';
import { reasonLabels } from '../referrals/reasons.js';
import { REFERRAL_ROLES, clockFacts, patientsOf, quarterKey, quarterOf, referralAccess, refreshFacts, viewContext } from '../referrals/referralService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';
import { capitalizeName } from '../utils/personName.js';

// The doctors outside the hospital who send patients (Referrals, docs/REFERRALS_PLAN.md), /api/referring-doctors:
//  - GET  /             the list (?search= name, clinic, area or number; ?active=true|false), with how many referrals each sent
//  - POST /, PUT /:id   add or change one (never deleted: made inactive)
//  - GET  /:id/summary  the quarterly one-page summary for that doctor (?quarter=2026-Q4): what happened to the patients
//    they sent, what returned to them and any promise missed – her name, the outcome, the note and discharge summary
//    promises only when she said Yes.
// For the referral desk, doctors and RMOs (REFERRAL_ROLES). The audit log gets ids only, never a name or a number.

export const referringDoctorsRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const notFound = () => new HttpError(404, 'This referring doctor was not found.', 'NOT_FOUND');
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });

referringDoctorsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...REFERRAL_ROLES)) throw forbidden('Referrals are for the referral desk, doctors and RMOs.');
  next();
});

// ---------- One doctor ----------

const text = (label, max) => z.string().trim().max(max, `${label} is too long (at most ${max} characters).`);
const FIELDS = {
  name: text('Name', 150).min(2, "Enter the doctor's name.").transform(capitalizeName),
  qualification: text('Qualification', 150),
  clinic: text('Clinic', 150),
  area: text('Area', 150),
  phone: text('WhatsApp number', 30).regex(/^[0-9+()\-\s]*$/, 'The WhatsApp number can only contain numbers, spaces, +, ( ) and -'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(150, 'The email address is too long.')
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Please enter a valid email address'),
  registrationNumber: text('Registration number', 60),
  notes: safeText('Notes', 500),
  partner: z.object({ joined: z.boolean(), caseOfMonth: z.boolean(), cme: z.boolean(), quarterlySummary: z.boolean() }).partial().strict(),
  isActive: z.boolean(),
};
// No defaults on a change: what is left out stays as it is
const createSchema = z.object(Object.fromEntries(Object.entries(FIELDS).map(([k, s]) => [k, k === 'name' ? s : s.optional()]))).strict();
const updateSchema = z.object(Object.fromEntries(Object.entries(FIELDS).map(([k, s]) => [k, s.optional()]))).strict();
const PARTNER_KEYS = ['joined', 'caseOfMonth', 'cme', 'quarterlySummary'];

function doctorView(d, referrals = 0) {
  return {
    id: String(d._id),
    name: d.name,
    qualification: d.qualification ?? '',
    clinic: d.clinic ?? '',
    area: d.area ?? '',
    phone: d.phone ?? '',
    email: d.email ?? '',
    registrationNumber: d.registrationNumber ?? '',
    notes: d.notes ?? '',
    partner: Object.fromEntries(PARTNER_KEYS.map((k) => [k, Boolean(d.partner?.[k])])),
    isActive: d.isActive !== false,
    referrals,
  };
}

/** How many referrals (not cancelled) each of these doctors sent: Map "<id>" → count. */
async function referralCounts(tenantId, doctorIds) {
  if (!doctorIds.length) return new Map();
  const rows = await Referral.aggregate([
    // (aggregate needs its own hospital filter: tenantScoped checks the first stage)
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), referringDoctorId: { $in: doctorIds.map((id) => new mongoose.Types.ObjectId(String(id))) }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$referringDoctorId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function findDoctor(req) {
  const id = parse(objectId, req.params.doctorId);
  const doctor = await ReferringDoctor.findOne({ _id: id, tenantId: req.tenantId });
  if (!doctor) throw notFound();
  return doctor;
}

// ---------- The list ----------

referringDoctorsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(100).default(''), active: z.enum(['true', 'false', 'all', '']).default('') }), req.query);
  const filter = { tenantId: req.tenantId, ...(q.active === 'true' || q.active === 'false' ? { isActive: q.active === 'true' } : {}) };
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ nameKey: new RegExp(escapeRegex(q.search.toLowerCase())) }, { clinic: re }, { area: re }, { phone: re }];
  }
  const doctors = await ReferringDoctor.find(filter).sort({ isActive: -1, nameKey: 1 }).limit(300).lean();
  const counts = await referralCounts(req.tenantId, doctors.map((d) => d._id));
  res.json({ doctors: doctors.map((d) => doctorView(d, counts.get(String(d._id)) ?? 0)) });
});

referringDoctorsRouter.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const doctor = await ReferringDoctor.create({
    tenantId: req.tenantId,
    ...body,
    nameKey: body.name.toLowerCase(),
    partner: Object.fromEntries(PARTNER_KEYS.map((k) => [k, Boolean(body.partner?.[k])])),
    created: stampOf(req),
  });
  await audit(req, 'REFERRING_DOCTOR_ADDED', { details: { referringDoctorId: String(doctor._id) } });
  res.status(201).json({ doctor: doctorView(doctor) });
});

referringDoctorsRouter.put('/:doctorId', async (req, res) => {
  const doctor = await findDoctor(req);
  const body = parse(updateSchema, req.body);
  const fields = [];
  for (const [k, value] of Object.entries(body)) {
    if (k === 'partner') {
      const next = { ...Object.fromEntries(PARTNER_KEYS.map((p) => [p, Boolean(doctor.partner?.[p])])), ...value };
      if (PARTNER_KEYS.some((p) => next[p] !== Boolean(doctor.partner?.[p]))) {
        doctor.partner = next;
        fields.push(k);
      }
    } else if (doctor[k] !== value) {
      doctor[k] = value;
      fields.push(k);
    }
  }
  if (body.name) doctor.nameKey = body.name.toLowerCase();
  if (fields.length) {
    doctor.updated = stampOf(req);
    await doctor.save();
    await audit(req, 'REFERRING_DOCTOR_UPDATED', { details: { referringDoctorId: String(doctor._id), fields } });
  }
  const counts = await referralCounts(req.tenantId, [doctor._id]);
  res.json({ doctor: doctorView(doctor, counts.get(String(doctor._id)) ?? 0) });
});

// ---------- The quarterly summary ----------

// The guide's "Your referral summary, on request" (page 7): every referral the doctor sent in the quarter, with the
// promises kept or missed. The counts cover them all; each row says only what this person may open and she agreed to:
//  - a referral this person may not open (a sensitive record of another doctor's patient): its number and date only
//    (hidden) – not even its reasons or its clocks;
//  - without her Yes: its reasons from the list (never the free-text reason), and the reply and seen promises only –
//    not the note and discharge promises (they would tell whether and when she was admitted or discharged), nor her
//    answer: the page and its print say only that the details are not shared;
//  - with her Yes: also her name and age, the outcome (the signed note's diagnosis and what returns to the referring
//    doctor), the free-text reason and every promise.
referringDoctorsRouter.get('/:doctorId/summary', async (req, res) => {
  const doctor = await findDoctor(req);
  const q = parse(z.object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'Choose a quarter like 2026-Q4').optional() }), req.query);
  const now = req.now ?? new Date();
  const quarter = quarterOf(q.quarter ?? quarterKey(hospitalToday(now)));
  const refs = await Referral.find({
    tenantId: req.tenantId,
    referringDoctorId: doctor._id,
    status: { $ne: 'cancelled' },
    receivedAt: { $gte: hospitalDayStart(quarter.from), $lt: hospitalDayStart(addDays(quarter.to, 1)) },
  })
    .sort({ receivedAt: 1 })
    .limit(1000);
  const facts = await refreshFacts(req.tenantId, refs.filter((r) => r.status === 'open'));
  const patients = await patientsOf(req.tenantId, refs);
  const ctx = await viewContext(req, refs, { patients, facts });
  const counts = { received: refs.length, seen: 0, notesSent: 0, missed: 0, returned: 0 };
  const referrals = refs.map((r) => {
    const p = r.patientId ? patients.get(String(r.patientId)) : null;
    const may = referralAccess(req, r, p).view && (!r.patientId || Boolean(p));
    const shown = may && r.sharing?.answer === 'yes';
    const signed = r.note?.status === 'signed';
    const promises = promisesFor(clockFacts(r, facts), now, ctx.settings);
    if (r.firstSeen?.at) counts.seen += 1;
    if ((r.messages ?? []).some((m) => m.what === 'note')) counts.notesSent += 1;
    if (promises.some((x) => isMissed(x.state))) counts.missed += 1;
    if (signed && String(r.note.returnsToYouFor ?? '').trim()) counts.returned += 1;
    if (!may) return { number: r.number, receivedAt: r.receivedAt, hidden: true };
    if (!shown) {
      return {
        number: r.number,
        receivedAt: r.receivedAt,
        hidden: false,
        patient: null,
        reasonLabels: reasonLabels(r.reasons ?? []),
        outcome: null,
        returnsToYouFor: null,
        sharing: null,
        promises: promises.filter((x) => x.key === 'reply' || x.key === 'seen'),
      };
    }
    return {
      number: r.number,
      receivedAt: r.receivedAt,
      hidden: false,
      patient: p ? { fullName: p.fullName, ageYears: currentAge(p, now) } : r.guest ? { fullName: r.guest.name, ageYears: r.guest.ageYears ?? null } : null,
      reasonLabels: [...reasonLabels(r.reasons ?? []), ...(r.otherReason ? [r.otherReason] : [])],
      outcome: signed ? r.note.diagnosis || null : null,
      returnsToYouFor: signed ? r.note.returnsToYouFor || null : null,
      sharing: 'yes',
      promises,
    };
  });
  const total = await referralCounts(req.tenantId, [doctor._id]);
  await audit(req, 'REFERRAL_SUMMARY_VIEWED', { details: { referringDoctorId: String(doctor._id), quarter: quarter.key } });
  res.json({
    doctor: doctorView(doctor, total.get(String(doctor._id)) ?? 0),
    quarter: { key: quarter.key, from: isoDay(quarter.from), to: isoDay(quarter.to) },
    counts,
    referrals,
  });
});
