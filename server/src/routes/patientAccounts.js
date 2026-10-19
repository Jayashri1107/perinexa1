import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { PatientChangeRequest } from '../models/PatientChangeRequest.js';
import { PatientAccount } from '../models/PatientAccount.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { possibleMatches } from '../patients/duplicateService.js';
import { isClosed } from '../patients/deathRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { objectId, parse } from '../utils/validate.js';
import { isoDay } from '../careplans/dates.js';
import { registerPatient } from './patients.js';

// Patients' own portal accounts, for reception (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md): the sign-ups
// waiting, and approving or rejecting each. Approving checks who she is at the desk (or by phone) and links the account
// to her patient record – an existing one ("she may already be registered" suggests them), or one registered then
// from her details. Approving opens her portal; her records show only as the portal's own rules allow
// (routes/portalRecords.js). Reception, doctors and RMOs (who register patients). Every step is in the audit log.

export const patientAccountsRouter = Router(); // /api/patient-accounts

export const ACCOUNT_ROLES = ['receptionist', 'doctor', 'rmo'];
const forbidden = () => new HttpError(403, 'Patient sign-ups are handled by reception, doctors and RMOs.', 'FORBIDDEN');
patientAccountsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ACCOUNT_ROLES)) throw forbidden();
  next();
});

const view = (a, patients = new Map()) => {
  const p = a.patientId ? patients.get(String(a.patientId)) : null;
  return {
    id: String(a._id),
    fullName: a.fullName,
    ageYears: a.ageYears,
    mobile: a.mobile,
    email: a.email,
    address: a.address ?? '',
    careType: a.careType ?? null,
    lmpSaid: a.lmpSaid ? isoDay(a.lmpSaid) : null,
    status: a.status,
    signedUpAt: a.createdAt,
    reviewed: a.reviewed ? { byName: a.reviewed.byName ?? '', at: a.reviewed.at, reason: a.reviewed.reason ?? '' } : null,
    patient: p ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn } : null,
    lastSignInAt: a.lastSignInAt ?? null,
  };
};

// The sign-ups waiting (oldest first), and the latest handled ones.
patientAccountsRouter.get('/', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['pending', 'handled']).default('pending') }).strict(), req.query);
  const accounts =
    status === 'pending'
      ? await PatientAccount.find({ tenantId: req.tenantId, status: 'pending' }).sort({ createdAt: 1 }).limit(200).lean()
      : await PatientAccount.find({ tenantId: req.tenantId, status: { $ne: 'pending' } }).sort({ updatedAt: -1 }).limit(100).lean();
  const ids = accounts.map((a) => a.patientId).filter(Boolean);
  const patients = new Map((ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }, { fullName: 1, mrn: 1 }).lean() : []).map((p) => [String(p._id), p]));
  res.json({ accounts: accounts.map((a) => view(a, patients)) });
});

async function pendingAccount(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const account = await PatientAccount.findOne({ tenantId: req.tenantId, _id: id });
  if (!account) throw new HttpError(404, 'Sign-up not found.', 'NOT_FOUND');
  if (account.status !== 'pending') throw new HttpError(409, 'This sign-up was already handled.', 'HANDLED');
  return account;
}

// Records of this hospital that may be her (same mobile or name) – to approve against, instead of registering again.
patientAccountsRouter.get('/:id/matches', async (req, res) => {
  const account = await pendingAccount(req);
  const found = await possibleMatches(req, { fullName: account.fullName, phone: account.mobile, careType: 'antenatal' });
  res.json({ matches: found.matches, total: found.total });
});

// Approve: her identity was checked; the account opens this patient record's portal.
patientAccountsRouter.post('/:id/approve', async (req, res) => {
  const account = await pendingAccount(req);
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (!patientAccess(req, patient).view.has('phone')) throw new HttpError(403, "You can't give portal access to this patient.", 'FORBIDDEN');
  if (isClosed(patient)) throw new HttpError(409, 'This record is closed: it takes no portal access.', 'CLOSED');
  if (isDuplicate(patient)) throw new HttpError(409, `This record is a duplicate of ${patient.duplicateOf.mrn}. Approve her on ${patient.duplicateOf.mrn} instead.`, 'DUPLICATE');
  if (await PatientAccount.exists({ tenantId: req.tenantId, patientId: patient._id, status: 'approved' })) {
    throw new HttpError(409, `${patient.fullName} (${patient.mrn}) already has an approved account. Reject this one, or withdraw her portal access first.`, 'ACCOUNT_EXISTS');
  }
  account.status = 'approved';
  account.patientId = patient._id;
  account.reviewed = { by: req.user._id, byName: req.user.name, at: req.now, reason: '' };
  await account.save();
  await audit(req, 'PORTAL_SIGNUP_APPROVED', { details: { accountId: String(account._id), patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ account: view(account, new Map([[String(patient._id), patient]])) });
});

// Approve as a NEW patient, in one click (owner, 16 Oct 2026): her record is made from the details she typed – the
// same registration as the New patient form (routes/patients.js registerPatient: checks, patient number, audit log).
// Reception saw the records that may be hers first (/matches), so this registers her anyway. What she said about her
// pregnancy goes on her record as a note for the doctor to confirm; a doctor or RMO enters the dates.
patientAccountsRouter.post('/:id/approve-new', async (req, res) => {
  const account = await pendingAccount(req);
  if (!account.careType) throw new HttpError(409, 'She signed up before the registration details were asked for: use "Find her record" or register her on the New patient page.', 'NO_DETAILS');
  const out = await registerPatient(req, {
    careType: account.careType,
    fullName: account.fullName,
    ageYears: account.ageYears,
    phone: account.mobile,
    address: account.address ?? '',
    registerAnyway: true,
  });
  const patient = out.patient;
  if (account.lmpSaid) {
    const said = new Date(account.lmpSaid).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    patient.notes = `Said by the patient when she signed up online (to confirm): first day of her last period ${said}.`;
    await patient.save();
  }
  account.status = 'approved';
  account.patientId = patient._id;
  account.reviewed = { by: req.user._id, byName: req.user.name, at: req.now, reason: '' };
  await account.save();
  await audit(req, 'PORTAL_SIGNUP_APPROVED', { details: { accountId: String(account._id), patientId: String(patient._id), mrn: patient.mrn, registered: true } });
  res.status(201).json({ account: view(account, new Map([[String(patient._id), patient]])) });
});

// Reject (e.g. could not confirm who she is). The reason stays with the hospital; she is told to call the hospital.
patientAccountsRouter.post('/:id/reject', async (req, res) => {
  const account = await pendingAccount(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Please write why.').max(200) }).strict(), req.body);
  account.status = 'rejected';
  account.reviewed = { by: req.user._id, byName: req.user.name, at: req.now, reason };
  await account.save();
  await audit(req, 'PORTAL_SIGNUP_REJECTED', { details: { accountId: String(account._id), reason } });
  res.json({ account: view(account) });
});

// ---------- Her requests to change her name, age, mobile or email (from her portal profile – owner, 19 Oct 2026) ----------
// Reception checks who she is, then approves (her record and her sign-in are changed) or rejects with a reason.

const changeView = (r, patient) => ({
  id: String(r._id),
  patient: patient ? { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn, phone: patient.phone ?? '', age: currentAge(patient) } : null,
  changes: r.changes,
  note: r.note ?? '',
  status: r.status,
  at: r.createdAt,
  reviewed: r.reviewed ? { byName: r.reviewed.byName ?? '', at: r.reviewed.at, reason: r.reviewed.reason ?? '' } : null,
});

/** The requests waiting (oldest first). */
patientAccountsRouter.get('/changes', async (req, res) => {
  const list = await PatientChangeRequest.find({ tenantId: req.tenantId, status: 'pending' }).sort({ createdAt: 1 }).limit(200).lean();
  const patients = new Map((await Patient.find({ tenantId: req.tenantId, _id: { $in: list.map((r) => r.patientId) } })).map((p) => [String(p._id), p]));
  res.json({ requests: list.map((r) => changeView(r, patients.get(String(r.patientId)))) });
});

async function pendingChange(req) {
  const r = await PatientChangeRequest.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!r) throw new HttpError(404, 'This request was not found.', 'NOT_FOUND');
  if (r.status !== 'pending') throw new HttpError(409, 'This request was already handled.', 'CONFLICT');
  return r;
}

patientAccountsRouter.post('/changes/:id/approve', async (req, res) => {
  const r = await pendingChange(req);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: r.patientId });
  if (!patient) throw new HttpError(404, 'Her record was not found.', 'NOT_FOUND');
  const c = r.changes ?? {};
  const account = r.accountId ? await PatientAccount.findOne({ tenantId: req.tenantId, _id: r.accountId }) : null;
  // Her sign-in first: a mobile or email another live account uses is refused (nothing is changed then)
  if (account && (c.phone || c.email)) {
    const clash = await PatientAccount.exists({ tenantId: req.tenantId, _id: { $ne: account._id }, status: { $in: ['pending', 'approved'] }, $or: [...(c.phone ? [{ mobile: c.phone }] : []), ...(c.email ? [{ email: c.email }] : [])] });
    if (clash) throw new HttpError(409, 'Another patient account already uses this mobile number or email.', 'CONFLICT');
    if (c.phone) account.mobile = c.phone;
    if (c.email) account.email = c.email;
    await account.save();
  }
  if (c.fullName) patient.fullName = c.fullName;
  if (c.ageYears != null) Object.assign(patient, { ageYears: c.ageYears, ageRecordedOn: req.now });
  if (c.phone) patient.phone = c.phone;
  await patient.save();
  r.status = 'approved';
  r.reviewed = { by: req.user._id, byName: req.user.name, at: req.now };
  await r.save();
  // Ids and which fields – never the old or new name, age, number or email
  await audit(req, 'PORTAL_CHANGE_APPROVED', { details: { patientId: String(patient._id), mrn: patient.mrn, fields: Object.keys(c).filter((k) => c[k] != null) } });
  res.json({ request: changeView(r, patient) });
});

patientAccountsRouter.post('/changes/:id/reject', async (req, res) => {
  const r = await pendingChange(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Please write why.').max(200) }).strict(), req.body);
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: r.patientId });
  r.status = 'rejected';
  r.reviewed = { by: req.user._id, byName: req.user.name, at: req.now, reason };
  await r.save();
  await audit(req, 'PORTAL_CHANGE_REJECTED', { details: { patientId: String(r.patientId), mrn: patient?.mrn } });
  res.json({ request: changeView(r, patient) });
});
