import { Router } from 'express';
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { FORM_REGISTER_SOURCE, FORM_SCREENS, FORM_SCREEN_KEYS } from '../clinical/formRegister.js';
import { FormVersion } from '../models/FormVersion.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The document register (Clinical Requirements Group C – PX-X-02) and the form printed on a record (PX-X-03):
// /api/forms.
//  - GET /: the register – every version of every form, with which one is in force today;
//  - GET /in-force?screen=&on=: the code, title and version in force on a day – for the header of a printout;
//  - POST /: record a new version (a draft); POST /:id/approve: a doctor approves it; POST /:id/withdraw: a draft
//    entered by mistake is withdrawn with a reason. Never changed after approval, never deleted.
// Who: everyone working in the hospital may read what is in force (it goes on printouts); the register is read by the
// admin, the quality lead, doctors, RMOs and nurses; the quality lead and the admin record; a doctor approves.
// No patient data.

export const formRegisterRouter = Router();
const READERS = ['admin', 'quality', 'doctor', 'rmo', 'nurse'];
const KEEPERS = ['admin', 'quality'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const isoDay = (d) => d.toISOString().slice(0, 10);
const dayRule = z.iso.date('Please enter a valid date');

/** The approved version of a screen in force on a day ('YYYY-MM-DD'), or null. */
export async function formInForce(tenantId, screen, onDay) {
  return FormVersion.findOne({ tenantId, screen, status: 'approved', effectiveFrom: { $lte: onDay } }).sort({ effectiveFrom: -1, 'approved.at': -1 }).lean();
}

function view(v, inForceIds, today) {
  const state =
    v.status === 'draft' ? 'draft' : v.status === 'withdrawn' ? 'withdrawn' : inForceIds.has(String(v._id)) ? 'in_force' : v.effectiveFrom > today ? 'future' : 'superseded';
  return {
    id: String(v._id),
    screen: v.screen,
    screenLabel: FORM_SCREENS[v.screen]?.label ?? v.screen,
    code: v.code,
    title: v.title,
    version: v.version,
    effectiveFrom: v.effectiveFrom,
    reviewDue: v.reviewDue,
    reviewOverdue: state === 'in_force' && Boolean(v.reviewDue) && v.reviewDue < today,
    note: v.note,
    state,
    recorded: { byName: v.recorded.byName, at: v.recorded.at },
    approved: v.approved ? { byName: v.approved.byName, at: v.approved.at } : null,
    withdrawn: v.withdrawn ? { byName: v.withdrawn.byName, at: v.withdrawn.at, reason: v.withdrawn.reason } : null,
  };
}

formRegisterRouter.get('/in-force', async (req, res) => {
  const q = parse(z.object({ screen: z.enum(FORM_SCREEN_KEYS), on: dayRule.optional() }).strict(), req.query);
  const v = await formInForce(req.tenantId, q.screen, q.on ?? isoDay(hospitalToday(req.now ?? new Date())));
  res.json({ form: v ? { code: v.code, title: v.title, version: v.version, effectiveFrom: v.effectiveFrom } : null, screen: { key: q.screen, label: FORM_SCREENS[q.screen].label } });
});

formRegisterRouter.get('/', async (req, res) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The document register is for the admin, the quality lead, doctors, RMOs and nurses.');
  const today = isoDay(hospitalToday(req.now ?? new Date()));
  const all = await FormVersion.find({ tenantId: req.tenantId }).sort({ screen: 1, effectiveFrom: -1 }).lean();
  const inForce = new Set();
  for (const key of FORM_SCREEN_KEYS) {
    const v = all.filter((x) => x.screen === key && x.status === 'approved' && x.effectiveFrom <= today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (v) inForce.add(String(v._id));
  }
  res.json({
    versions: all.map((v) => view(v, inForce, today)),
    access: { record: hasRole(req.membership, ...KEEPERS), approve: hasRole(req.membership, 'doctor') },
    rules: { screens: FORM_SCREENS, source: FORM_REGISTER_SOURCE },
    today,
  });
});

const addBody = z
  .object({
    screen: z.enum(FORM_SCREEN_KEYS, 'Choose the Perinexa screen'),
    code: safeText('Code', 30).refine((v) => v.trim().length >= 2, 'Enter the form’s code from the manual'),
    title: safeText('Title', 150).refine((v) => v.trim().length >= 3, 'Enter the form’s title'),
    version: safeText('Version', 20).refine((v) => v.trim().length >= 1, 'Enter the version'),
    effectiveFrom: dayRule,
    reviewDue: z.union([z.literal(''), dayRule]).default(''),
    note: safeText('Note', 300).default(''),
  })
  .strict();

formRegisterRouter.post('/', async (req, res) => {
  if (!hasRole(req.membership, ...KEEPERS)) throw forbidden('The quality lead or the admin records a form version.');
  const b = parse(addBody, req.body);
  if (b.reviewDue && b.reviewDue <= b.effectiveFrom) throw invalid({ reviewDue: 'The review is due after the form comes into force.' });
  const same = await FormVersion.exists({ tenantId: req.tenantId, screen: b.screen, version: b.version.trim(), status: { $ne: 'withdrawn' } });
  if (same) throw invalid({ version: 'This version of this form is already in the register.' });
  const v = await FormVersion.create({ ...b, code: b.code.trim().toUpperCase(), title: b.title.trim(), version: b.version.trim(), note: b.note.trim(), tenantId: req.tenantId, recorded: stamp(req) });
  await audit(req, 'FORM_VERSION_RECORDED', { details: { formVersionId: String(v._id), screen: v.screen, code: v.code, version: v.version } });
  res.status(201).json({ version: view(v, new Set(), isoDay(hospitalToday(req.now ?? new Date()))) });
});

async function loadDraft(req) {
  const { id } = parse(z.object({ id: objectId }).strict(), req.params);
  const v = await FormVersion.findOne({ _id: id, tenantId: req.tenantId });
  if (!v) throw new HttpError(404, 'This form version was not found.', 'NOT_FOUND');
  if (v.status !== 'draft') throw conflict(v.status === 'approved' ? 'This version is approved and cannot be changed – record a new version.' : 'This version was withdrawn.');
  return v;
}

formRegisterRouter.post('/:id/approve', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('A doctor approves a form version.');
  const v = await loadDraft(req);
  v.status = 'approved';
  v.approved = stamp(req);
  await v.save();
  await audit(req, 'FORM_VERSION_APPROVED', { details: { formVersionId: String(v._id), screen: v.screen, code: v.code, version: v.version } });
  res.json({ version: view(v, new Set(), isoDay(hospitalToday(req.now ?? new Date()))) });
});

formRegisterRouter.post('/:id/withdraw', async (req, res) => {
  if (!hasRole(req.membership, ...KEEPERS)) throw forbidden('The quality lead or the admin withdraws a draft.');
  const { reason } = parse(z.object({ reason: safeText('Reason', 300).refine((t) => t.trim().length >= 3, 'Write why it is withdrawn') }).strict(), req.body);
  const v = await loadDraft(req);
  v.status = 'withdrawn';
  v.withdrawn = { ...stamp(req), reason: reason.trim() };
  await v.save();
  await audit(req, 'FORM_VERSION_WITHDRAWN', { details: { formVersionId: String(v._id), screen: v.screen } });
  res.json({ version: view(v, new Set(), isoDay(hospitalToday(req.now ?? new Date()))) });
});
