import { Router } from 'express';
import { z } from 'zod';
import { Medicine, NoSubstitute } from '../models/Pharmacy.js';
import { nameKey } from '../pharmacy/stockMatch.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { escapeRegex, objectId, parse } from '../utils/validate.js';

// PH7 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 6): the "High alert" and "looks or sounds like" marks on the
// stock list, written by a doctor and the pharmacist together – /api/medicine-marks. A change makes a new version
// that is in force only once a doctor and a pharmacist – two different people – have both confirmed it (the
// formulary's rule, models/FormularyItem.js isVerified); whoever proposes it confirms it for their own role. Any change
// clears the confirmations. Perinexa ships none. Shown at the counter (Sell and Issue) and on the stock list only while
// in force. Doctors reach this list although they have no pharmacy menu; nothing about a patient is read here.

export const medicineMarksRouter = Router();
const MARK_ROLES = ['doctor', 'pharmacist'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m, code = 'CONFLICT') => new HttpError(409, m, code);

medicineMarksRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...MARK_ROLES)) throw forbidden('The high-alert and look-alike marks are written by doctors and the pharmacist.');
  next();
});

/** In force: a doctor and a pharmacist confirmed THIS version of the marks. PURE. */
export function marksInForce(marks) {
  if (!marks) return false;
  const now = (marks.confirmations ?? []).filter((c) => c.version === marks.version);
  return now.some((c) => c.role === 'doctor') && now.some((c) => c.role === 'pharmacist');
}

const view = (m) => {
  const k = m.marks ?? null;
  const now = (k?.confirmations ?? []).filter((c) => c.version === k?.version);
  return {
    id: String(m._id),
    name: m.name,
    generic: m.generic ?? '',
    strength: m.strength ?? '',
    marks: k
      ? {
          highAlert: Boolean(k.highAlert),
          lookAlike: (k.lookAlike ?? []).map((x) => ({ id: String(x.medicineId), name: x.name })),
          version: k.version,
          inForce: marksInForce(k),
          confirmations: now.map((c) => ({ role: c.role, byName: c.byName, at: c.at })),
          updatedByName: k.updatedByName ?? '',
        }
      : null,
  };
};

// The medicines that have marks (proposed or in force)
medicineMarksRouter.get('/', async (req, res) => {
  const list = await Medicine.find({ tenantId: req.tenantId, marks: { $ne: null } }).sort({ name: 1 }).lean();
  res.json({ medicines: list.filter((m) => m.marks).map(view), canConfirmAs: MARK_ROLES.filter((r) => hasRole(req.membership, r)) });
});

// Finding a medicine on the stock list by name (doctors have no pharmacy screens)
medicineMarksRouter.get('/search', async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(2).max(60) }).strict(), req.query);
  const rx = new RegExp(escapeRegex(q.q), 'i');
  const list = await Medicine.find({ tenantId: req.tenantId, active: true, $or: [{ name: rx }, { generic: rx }] }).sort({ name: 1 }).limit(20).lean();
  res.json({ medicines: list.map(view) });
});

const loadOne = async (req) => {
  const m = await Medicine.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!m) throw new HttpError(404, 'Medicine not found.', 'NOT_FOUND');
  return m;
};

// A proposal or a change: a new version, the confirmations cleared, the proposer's own role confirmed
medicineMarksRouter.put('/:id', async (req, res) => {
  const m = await loadOne(req);
  const body = parse(z.object({ highAlert: z.boolean(), lookAlike: z.array(objectId).max(5, 'At most 5 look-alike medicines.').default([]), version: z.number().int().min(0) }).strict(), req.body);
  if (body.version !== (m.marks?.version ?? 0)) throw conflict('These marks were changed after you opened them. Reload, then make your change again.', 'STALE');
  const others = body.lookAlike.filter((x) => String(x) !== String(m._id));
  const found = others.length ? await Medicine.find({ tenantId: req.tenantId, _id: { $in: others } }, { name: 1 }).lean() : [];
  if (found.length !== new Set(others.map(String)).size) throw new HttpError(400, 'A look-alike medicine is not on the stock list.', 'VALIDATION');
  const role = MARK_ROLES.find((r) => hasRole(req.membership, r));
  const version = (m.marks?.version ?? 0) + 1;
  const empty = !body.highAlert && !found.length;
  m.marks = empty && !m.marks ? null : {
    highAlert: body.highAlert,
    lookAlike: found.map((x) => ({ medicineId: x._id, name: x.name })),
    version,
    confirmations: [{ by: req.user._id, byName: req.user.name, role, at: req.now, version }],
    updatedByName: req.user.name,
  };
  m.markModified('marks');
  await m.save();
  await audit(req, 'MEDICINE_MARKS_CHANGED', { details: { medicineId: String(m._id), version, highAlert: body.highAlert, lookAlike: found.length, role } });
  res.json({ medicine: view(m.toObject()) });
});

// A doctor's or the pharmacist's confirmation of the version they saw (one person never makes both)
medicineMarksRouter.post('/:id/confirm', async (req, res) => {
  const m = await loadOne(req);
  const { version } = parse(z.object({ version: z.number().int() }).strict(), req.body);
  if (!m.marks || version !== m.marks.version) throw conflict('These marks were changed after you opened them. Reload and check them again.', 'STALE');
  const done = (m.marks.confirmations ?? []).filter((c) => c.version === m.marks.version);
  if (done.some((c) => String(c.by) === String(req.user._id))) throw conflict('You have already confirmed this version – the other confirmation is by another person.', 'SAME_PERSON');
  const roles = MARK_ROLES.filter((r) => hasRole(req.membership, r) && !done.some((c) => c.role === r));
  if (!roles.length) throw conflict('This version already has that confirmation.', 'ALREADY_CONFIRMED');
  m.marks.confirmations.push({ by: req.user._id, byName: req.user.name, role: roles[0], at: req.now, version: m.marks.version });
  m.markModified('marks');
  await m.save();
  await audit(req, 'MEDICINE_MARKS_CONFIRMED', { details: { medicineId: String(m._id), version: m.marks.version, role: roles[0], inForce: marksInForce(m.marks) } });
  res.json({ medicine: view(m.toObject()) });
});

// ---------- PH10: the doctors' "never substitute" list (doctors write it; the pharmacist reads it) ----------
const noSubView = (x) => ({ id: String(x._id), text: x.text, active: x.active, addedByName: x.added?.byName ?? '', at: x.added?.at ?? null, stopped: x.stopped ? { byName: x.stopped.byName, at: x.stopped.at, reason: x.stopped.reason } : null });

medicineMarksRouter.get('/no-substitute', async (req, res) => {
  const list = await NoSubstitute.find({ tenantId: req.tenantId }).sort({ active: -1, text: 1 }).lean();
  res.json({ entries: list.map(noSubView), canEdit: hasRole(req.membership, 'doctor') });
});

medicineMarksRouter.post('/no-substitute', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('Only doctors write the never-substitute list.');
  const { text } = parse(z.object({ text: z.string().trim().min(3, 'Write the medicine (generic or brand name).').max(120) }).strict(), req.body);
  const key = nameKey(text);
  if (!key) throw new HttpError(400, 'Write the medicine by its name.', 'VALIDATION');
  if (await NoSubstitute.exists({ tenantId: req.tenantId, key, active: true })) throw conflict('This medicine is already on the list.', 'DUPLICATE');
  const x = await NoSubstitute.create({ tenantId: req.tenantId, text, key, added: { by: req.user._id, byName: req.user.name, at: req.now } });
  await audit(req, 'NO_SUBSTITUTE_CHANGED', { details: { entryId: String(x._id), added: true } });
  res.status(201).json({ entry: noSubView(x.toObject()) });
});

medicineMarksRouter.post('/no-substitute/:id/stop', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('Only doctors write the never-substitute list.');
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Write why.').max(200) }).strict(), req.body);
  const x = await NoSubstitute.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id), active: true });
  if (!x) throw new HttpError(404, 'Entry not found.', 'NOT_FOUND');
  x.active = false;
  x.stopped = { by: req.user._id, byName: req.user.name, at: req.now, reason };
  await x.save();
  await audit(req, 'NO_SUBSTITUTE_CHANGED', { details: { entryId: String(x._id), stopped: true } });
  res.json({ entry: noSubView(x.toObject()) });
});
