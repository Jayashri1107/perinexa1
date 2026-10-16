import { Router } from 'express';
import { z } from 'zod';
import { aadhaarDigits, abhaAddress, abhaNumber, mobileDigits, verhoeffValid } from '../abdm/abhaFormat.js';
import { abdmClient, abdmMode, endTxn, getTxn, hospitalByHipId, linkAbha, profileView, startTxn } from '../abdm/abdmService.js';
import { PRACTICE_OTP } from '../abdm/practiceClient.js';
import { CONFIDENTIAL_WORDS_SOURCE, CONFIDENTIAL_WORD_LIST } from '../abdm/shareRules.js';
import { ABDM_CHECKLIST, ABDM_CHECKLIST_M2, ABDM_CHECKLIST_M3 } from '../abdm/v3Client.js';
import { config } from '../config.js';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { nextNumber } from '../models/Counter.js';
import { hasRole } from '../models/Membership.js';
import { Patient, maskAbha } from '../models/Patient.js';
import { ScanShare } from '../models/ScanShare.js';
import { Tenant } from '../models/Tenant.js';
import { isDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { objectId, parse } from '../utils/validate.js';
import { ABDM_HIU_CALLBACK_PATHS, abdmFetchPublicRouter, abdmFetchRouter } from './abdmFetch.js';
import { ABDM_CALLBACK_PATHS, abdmRecordsPublicRouter, abdmRecordsRouter, recordsAccess } from './abdmRecords.js';

// ABDM linking, milestone M1 (docs/ABDM_PLAN.md, approved 3 Oct 2026) – M2, sharing her records, in
// routes/abdmRecords.js, and M3, her records from other hospitals, in routes/abdmFetch.js (both mounted below). For
// reception, doctors and RMOs:
//  - verify an existing ABHA by OTP and link it to her record; create a new ABHA with her Aadhaar number and OTP;
//    choose an ABHA address; print the ABHA card; unlink;
//  - the Scan & Share list (patients who scanned the desk's QR in their ABHA app).
// The hospital admin sets the HFR / HIP ID and the counter code. The public route ABDM calls for Scan & Share is
// abdmPublicRouter (no login: ABDM's signature is checked instead).
// PRIVACY: the Aadhaar number goes straight to ABDM (encrypted) and is never stored, shown again or written to any log
// or the audit log. OTPs are never stored. The full ABHA number leaves only through GET /patients/:id.

export const abdmRouter = Router();
export const abdmPublicRouter = Router();
// Milestone M2 – sharing her records through her ABHA (routes/abdmRecords.js)
abdmRouter.use(abdmRecordsRouter);
abdmPublicRouter.use(abdmRecordsPublicRouter);
// Milestone M3 – her records from other hospitals, with her consent (routes/abdmFetch.js)
abdmRouter.use(abdmFetchRouter);
abdmPublicRouter.use(abdmFetchPublicRouter);

export const ABDM_ROLES = ['receptionist', 'doctor', 'rmo'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const desk = (req) => {
  if (!hasRole(req.membership, ...ABDM_ROLES)) throw forbidden('ABHA linking is for reception, doctors and RMOs.');
};
const practiceHint = () => (abdmMode() === 'practice' ? { practiceOtp: PRACTICE_OTP } : {});

async function patientFor(req, id) {
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: id });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (!patientAccess(req, patient).view.has('phone')) throw forbidden("You can't change this patient's ABHA.");
  return patient;
}
const ids = (p, extra = {}) => ({ patientId: String(p._id), mrn: p.mrn, ...extra });
const abhaView = (p) => (p.abha?.number ? { number: p.abha.number, masked: maskAbha(p.abha.number), address: p.abha.address ?? '', nameOnAbha: p.abha.nameOnAbha ?? '', method: p.abha.method, byName: p.abha.byName ?? '', at: p.abha.at ?? null } : null);

// ---------- Status and settings ----------

const settingsView = (t) => ({ hfrId: t?.abdm?.hfrId ?? '', hipId: t?.abdm?.hipId ?? '', counterCode: t?.abdm?.counterCode ?? '' });

abdmRouter.get('/status', async (req, res) => {
  if (!hasRole(req.membership, ...ABDM_ROLES, 'admin')) throw forbidden('ABDM is for reception, doctors, RMOs and the hospital admin.');
  const t = await Tenant.findById(req.tenantId, { abdm: 1 }).lean();
  const isAdmin = hasRole(req.membership, 'admin');
  // M2 and M3: the public address ABDM calls (server/.env ABDM_PUBLIC_URL), and what to check against the sandbox
  const publicUrl = (config.ABDM_PUBLIC_URL ?? '').replace(/\/+$/, '');
  const admin = isAdmin
    ? {
        checklist: ABDM_CHECKLIST,
        checklistM2: ABDM_CHECKLIST_M2,
        checklistM3: ABDM_CHECKLIST_M3,
        publicUrl,
        bridgeUrl: publicUrl ? `${publicUrl}/api/abdm/public` : '',
        callbacks: ABDM_CALLBACK_PATHS,
        callbacksM3: ABDM_HIU_CALLBACK_PATHS,
        // M2: the DRAFT words that mark a record as about HIV (never shared), for the hospital's doctor to check
        confidentialWords: { draft: true, source: CONFIDENTIAL_WORDS_SOURCE, words: CONFIDENTIAL_WORD_LIST.map((w) => w.shown) },
      }
    : {};
  res.json({ mode: abdmMode(), settings: settingsView(t), canEdit: isAdmin, canLink: hasRole(req.membership, ...ABDM_ROLES), ...admin });
});

abdmRouter.put('/settings', async (req, res) => {
  if (!hasRole(req.membership, 'admin')) throw forbidden('ABDM settings are kept by the hospital admin.');
  const body = parse(z.object({ hfrId: z.string().trim().max(60), hipId: z.string().trim().max(60), counterCode: z.string().trim().max(40) }).partial().strict(), req.body);
  // ABDM's messages find the hospital by its HIP ID: one HIP ID belongs to one hospital
  if (body.hipId && (await Tenant.exists({ _id: { $ne: req.tenantId }, 'abdm.hipId': body.hipId }))) {
    throw Object.assign(new HttpError(409, 'Another hospital on Perinexa already uses this HIP ID. Check it in the Health Facility Registry.', 'HIP_ID_IN_USE'), { fields: { hipId: 'Already used by another hospital.' } });
  }
  await Tenant.updateOne({ _id: req.tenantId }, { $set: Object.fromEntries(Object.entries(body).map(([k, v]) => [`abdm.${k}`, v])) });
  await audit(req, 'ABDM_SETTINGS_CHANGED', { details: { fields: Object.keys(body) } });
  res.json({ settings: settingsView(await Tenant.findById(req.tenantId, { abdm: 1 }).lean()) });
});

// ---------- Her ABHA ----------

abdmRouter.get('/patients/:id', async (req, res) => {
  desk(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const p = await patientFor(req, id);
  if (p.abha?.number) await audit(req, 'ABHA_VIEWED', { details: ids(p) });
  // canSeeRecords: her doctor or an RMO (M2) – her records linked to her ABHA are medical details
  res.json({ abha: abhaView(p), patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn, currentAge: p.toJSON().currentAge, phone: p.phone ?? '' }, mode: abdmMode(), canSeeRecords: recordsAccess(req, p).see });
});

abdmRouter.post('/patients/:id/unlink', async (req, res) => {
  desk(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Please write why.').max(200) }).strict(), req.body);
  const p = await patientFor(req, id);
  if (!p.abha?.number) throw new HttpError(409, 'Her record has no ABHA linked.', 'NOT_LINKED');
  p.abha = null;
  await p.save();
  await audit(req, 'ABHA_UNLINKED', { details: ids(p, { reason }) });
  res.json({ abha: null });
});

// ---------- Verify an existing ABHA (OTP to her mobile) ----------

const verifySchema = z
  .object({ patientId: objectId, hint: z.enum(['abha-number', 'abha-address', 'mobile']), value: z.string().trim().min(3).max(100) })
  .strict();

abdmRouter.post('/verify/request', async (req, res) => {
  desk(req);
  const body = parse(verifySchema, req.body);
  const p = await patientFor(req, body.patientId);
  const value = body.hint === 'abha-number' ? abhaNumber(body.value) : body.hint === 'mobile' ? mobileDigits(body.value) : abhaAddress(body.value);
  if (!value) throw Object.assign(new HttpError(400, body.hint === 'abha-number' ? 'An ABHA number has 14 digits.' : body.hint === 'mobile' ? 'Enter a 10-digit mobile number.' : 'Enter an ABHA address like name@abdm.', 'VALIDATION'), { fields: { value: 'Please check this.' } });
  const out = await abdmClient().requestLoginOtp({ hint: body.hint, value });
  const id = startTxn(req, { kind: 'verify', abdmTxnId: out.txnId, patientId: String(p._id) });
  res.json({ id, sentTo: out.sentTo, ...practiceHint() });
});

abdmRouter.post('/verify/confirm', async (req, res) => {
  desk(req);
  const body = parse(z.object({ id: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits.') }).strict(), req.body);
  const t = getTxn(req, body.id, 'verify');
  const out = await abdmClient().verifyLoginOtp({ txnId: t.abdmTxnId, otp: body.otp });
  t.accounts = out.accounts;
  t.token = out.token;
  const p = await Patient.findOne({ tenantId: req.tenantId, _id: t.patientId }, { mrn: 1 }).lean();
  await audit(req, 'ABHA_VERIFIED', { details: { patientId: t.patientId, mrn: p?.mrn, accounts: out.accounts.length } });
  res.json({ accounts: out.accounts.map(profileView) });
});

abdmRouter.post('/verify/link', async (req, res) => {
  desk(req);
  const body = parse(z.object({ id: z.uuid(), abhaNumber: z.string(), consent: z.literal(true, 'She must agree to link her ABHA.') }).strict(), req.body);
  const t = getTxn(req, body.id, 'verify');
  const profile = (t.accounts ?? []).find((a) => a.abhaNumber === abhaNumber(body.abhaNumber));
  if (!profile) throw new HttpError(400, 'Choose one of the ABHAs ABDM sent.', 'VALIDATION');
  const p = await linkAbha(req, t.patientId, profile, 'verified');
  t.profile = profile;
  await audit(req, 'ABHA_LINKED', { details: ids(p, { method: 'verified' }) });
  res.json({ abha: abhaView(p), cardId: body.id });
});

// ---------- Create a new ABHA (Aadhaar and OTP) ----------

abdmRouter.post('/create/request', async (req, res) => {
  desk(req);
  const body = parse(z.object({ patientId: objectId, aadhaar: z.string().max(20), consent: z.literal(true, 'She must agree before her ABHA is created.') }).strict(), req.body);
  const p = await patientFor(req, body.patientId);
  if (p.abha?.number) throw new HttpError(409, 'Her record already has an ABHA.', 'ABHA_LINKED');
  // The Aadhaar number: checked, passed to ABDM, forgotten (never in the transaction, the database or a log).
  const aadhaar = aadhaarDigits(body.aadhaar);
  if (!aadhaar || (abdmMode() !== 'practice' && !verhoeffValid(aadhaar))) {
    throw Object.assign(new HttpError(400, 'This is not a valid Aadhaar number. Please check the 12 digits.', 'VALIDATION'), { fields: { aadhaar: 'Please check the 12 digits.' } });
  }
  const out = await abdmClient().requestEnrolOtp({ aadhaar });
  const id = startTxn(req, { kind: 'create', abdmTxnId: out.txnId, patientId: String(p._id) });
  res.json({ id, sentTo: out.sentTo, ...practiceHint() });
});

abdmRouter.post('/create/confirm', async (req, res) => {
  desk(req);
  const body = parse(z.object({ id: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits.'), mobile: z.string().max(20) }).strict(), req.body);
  const mobile = mobileDigits(body.mobile);
  if (!mobile) throw Object.assign(new HttpError(400, 'Enter her 10-digit mobile number for ABHA.', 'VALIDATION'), { fields: { mobile: 'Enter a 10-digit mobile number.' } });
  const t = getTxn(req, body.id, 'create');
  const out = await abdmClient().enrolByAadhaar({ txnId: t.abdmTxnId, otp: body.otp, mobile });
  t.profile = out.profile;
  t.token = out.token;
  if (out.txnId) t.abdmTxnId = out.txnId;
  const suggestions = out.profile.abhaAddress ? [] : await abdmClient().addressSuggestions({ txnId: t.abdmTxnId }).catch(() => []);
  const p = await Patient.findOne({ tenantId: req.tenantId, _id: t.patientId }, { mrn: 1 }).lean();
  await audit(req, 'ABHA_CREATED', { details: { patientId: t.patientId, mrn: p?.mrn, isNew: out.isNew !== false } });
  res.json({ profile: profileView(out.profile), isNew: out.isNew !== false, suggestions });
});

abdmRouter.post('/create/address', async (req, res) => {
  desk(req);
  const body = parse(z.object({ id: z.uuid(), address: z.string().trim().max(60) }).strict(), req.body);
  const address = abhaAddress(body.address);
  if (!address) throw Object.assign(new HttpError(400, 'An ABHA address has 4 to 32 letters, numbers, dots or underscores.', 'VALIDATION'), { fields: { address: 'Please check it.' } });
  const t = getTxn(req, body.id, 'create');
  const out = await abdmClient().setAddress({ txnId: t.abdmTxnId, address });
  t.profile = { ...t.profile, abhaAddress: out.abhaAddress };
  res.json({ profile: profileView(t.profile) });
});

abdmRouter.post('/create/link', async (req, res) => {
  desk(req);
  const body = parse(z.object({ id: z.uuid() }).strict(), req.body);
  const t = getTxn(req, body.id, 'create');
  if (!t.profile) throw new HttpError(409, 'Her ABHA is not created yet.', 'EXPIRED');
  const p = await linkAbha(req, t.patientId, t.profile, 'created');
  await audit(req, 'ABHA_LINKED', { details: ids(p, { method: 'created' }) });
  res.json({ abha: abhaView(p), cardId: body.id });
});

// Her ABHA card (right after verifying or creating, while ABDM's token is valid).
abdmRouter.get('/card/:id', async (req, res) => {
  desk(req);
  const { id } = parse(z.object({ id: z.uuid() }), req.params);
  const t = getTxn(req, id);
  if (!t.profile || !t.token) throw new HttpError(409, 'Verify or create her ABHA first.', 'EXPIRED');
  const card = await abdmClient().card({ token: t.token, profile: t.profile });
  const p = await Patient.findOne({ tenantId: req.tenantId, _id: t.patientId }, { mrn: 1 }).lean();
  await audit(req, 'ABHA_CARD_PRINTED', { details: { patientId: t.patientId, mrn: p?.mrn } });
  res.json(card);
});

abdmRouter.post('/done/:id', (req, res) => {
  desk(req);
  endTxn(parse(z.object({ id: z.uuid() }), req.params).id);
  res.json({ ok: true });
});

// ---------- Scan & Share ----------

const shareView = (s) => ({
  id: String(s._id),
  token: s.token,
  date: isoDay(s.on),
  receivedAt: s.createdAt,
  source: s.source,
  status: s.status,
  patientId: s.patientId ? String(s.patientId) : null,
  profile: { ...profileView(s.profile), phone: s.profile.mobile ?? '', address: s.profile.address ?? '' },
  handledBy: s.handled?.byName ?? '',
});

/** Saves a Scan & Share with the day's next token, and finds a record that already has this ABHA. */
export async function receiveShare(tenantId, profile, meta, now = new Date()) {
  const on = hospitalToday(now);
  const token = await nextNumber(tenantId, `scan-share:${isoDay(on)}`);
  return ScanShare.create({ tenantId, on, token, profile, ...meta });
}

// A sign-up from the patient portal waits this many days (a Scan & Share at the desk is for its own day only).
export const PORTAL_SIGNUP_DAYS = 7;

abdmRouter.get('/scan-share', async (req, res) => {
  desk(req);
  const on = hospitalToday(req.now);
  const list = await ScanShare.find({
    tenantId: req.tenantId,
    $or: [{ on }, { source: 'portal', status: 'waiting', on: { $gte: addDays(on, 1 - PORTAL_SIGNUP_DAYS), $lt: on } }],
  })
    .sort({ on: 1, token: 1 })
    .lean();
  const holders = await Patient.find({ tenantId: req.tenantId, 'abha.number': { $in: list.map((s) => s.profile.abhaNumber) } }, { fullName: 1, mrn: 1, 'abha.number': 1, duplicateOf: 1 }).lean();
  // An ABHA that is on a record marked as a duplicate: the desk is pointed to her main record, and told that the
  // ABHA is still on the earlier one (abhaOn) – it is unlinked there and linked on the main record (nothing moves by itself)
  const mainIds = holders.filter(isDuplicate).map((p) => p.duplicateOf.patient);
  const mains = new Map((mainIds.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: mainIds } }, { fullName: 1, mrn: 1 }).lean() : []).map((m) => [String(m._id), m]));
  const known = new Map(
    holders.map((p) => {
      const main = isDuplicate(p) ? mains.get(String(p.duplicateOf.patient)) : null;
      const shown = main ?? p;
      return [p.abha.number, { id: String(shown._id), fullName: shown.fullName, mrn: shown.mrn, abhaOn: main ? { id: String(p._id), mrn: p.mrn } : null }];
    }),
  );
  res.json({ mode: abdmMode(), shares: list.map((s) => ({ ...shareView(s), knownPatient: known.get(s.profile.abhaNumber) ?? null })) });
});

abdmRouter.post('/scan-share/practice', async (req, res) => {
  desk(req);
  if (abdmMode() !== 'practice') throw new HttpError(409, 'Only in practice mode.', 'NOT_PRACTICE');
  const s = await receiveShare(req.tenantId, abdmClient().practiceShare(), { source: 'practice' }, req.now);
  await audit(req, 'ABDM_SCAN_SHARE_RECEIVED', { details: { shareId: String(s._id), token: s.token, practice: true } });
  res.status(201).json({ share: shareView(s) });
});

abdmRouter.post('/scan-share/:id/link', async (req, res) => {
  desk(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.body);
  const s = await ScanShare.findOne({ tenantId: req.tenantId, _id: id });
  if (!s) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  if (s.status !== 'waiting') throw new HttpError(409, 'This one was already handled.', 'HANDLED');
  await patientFor(req, patientId);
  const p = await linkAbha(req, patientId, s.profile, 'scan_share');
  s.status = 'linked';
  s.patientId = p._id;
  s.handled = { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() };
  await s.save();
  await audit(req, 'ABHA_LINKED', { details: ids(p, { method: 'scan_share', token: s.token }) });
  res.json({ share: shareView(s), abha: abhaView(p) });
});

abdmRouter.post('/scan-share/:id/dismiss', async (req, res) => {
  desk(req);
  const { id } = parse(z.object({ id: objectId }), req.params);
  const s = await ScanShare.findOneAndUpdate({ tenantId: req.tenantId, _id: id, status: 'waiting' }, { $set: { status: 'dismissed', handled: { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } } }, { returnDocument: 'after' }).lean();
  if (!s) throw new HttpError(409, 'This one was already handled.', 'HANDLED');
  await audit(req, 'ABDM_SCAN_SHARE_HANDLED', { tenantId: req.tenantId, details: { shareId: id, token: s.token, dismissed: true } });
  res.json({ share: shareView(s) });
});

// ---------- From ABDM: Scan & Share (no login – ABDM's signature is checked) ----------

const shareBody = z.object({
  intent: z.string().optional(),
  metaData: z.object({ hipId: z.string().min(1), context: z.string().optional() }).passthrough(),
  profile: z.object({
    patient: z
      .object({
        abhaNumber: z.string(),
        abhaAddress: z.string().optional(),
        name: z.string().optional(),
        gender: z.string().optional(),
        yearOfBirth: z.union([z.string(), z.number()]).optional(),
        phoneNumber: z.string().optional(),
        address: z.object({ line: z.string().optional(), district: z.string().optional(), state: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
  }),
});

abdmPublicRouter.post('/api/v3/hip/patient/share', async (req, res) => {
  const client = abdmClient();
  await client.verifyShareRequest(req.get('authorization'));
  const body = parse(shareBody, req.body);
  const tenant = await hospitalByHipId(body.metaData.hipId, { _id: 1 });
  if (!tenant) throw new HttpError(404, 'Unknown HIP ID.', 'NOT_FOUND');
  const pt = body.profile.patient;
  const number = abhaNumber(pt.abhaNumber);
  if (!number) throw new HttpError(400, 'No ABHA number.', 'VALIDATION');
  const profile = {
    abhaNumber: number,
    abhaAddress: (pt.abhaAddress ?? '').toLowerCase(),
    name: pt.name ?? '',
    gender: pt.gender ?? '',
    yearOfBirth: Number(pt.yearOfBirth) || null,
    mobile: mobileDigits(pt.phoneNumber) ?? '',
    address: [pt.address?.line, pt.address?.district, pt.address?.state].filter(Boolean).join(', '),
  };
  const requestId = req.get('request-id') ?? '';
  const s = await receiveShare(tenant._id, profile, { source: 'abdm', requestId, context: body.metaData.context ?? '' });
  await audit(req, 'ABDM_SCAN_SHARE_RECEIVED', { tenantId: tenant._id, details: { shareId: String(s._id), token: s.token } });
  res.status(202).json({ ok: true });
  // ABDM shows her the token number in her ABHA app
  client.acknowledgeShare({ requestId, hipId: body.metaData.hipId, abhaAddress: profile.abhaAddress, context: body.metaData.context ?? '', token: s.token }).catch((err) => console.error('ABDM: Scan & Share acknowledgement failed:', err?.message ?? err));
});
