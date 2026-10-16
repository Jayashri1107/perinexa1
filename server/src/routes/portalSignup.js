import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { abhaAddress, abhaNumber, mobileDigits } from '../abdm/abhaFormat.js';
import { abdmClient, abdmMode } from '../abdm/abdmService.js';
import { PRACTICE_OTP } from '../abdm/practiceClient.js';
import { addDays, hospitalToday } from '../careplans/dates.js';
import { Patient } from '../models/Patient.js';
import { ScanShare } from '../models/ScanShare.js';
import { Tenant } from '../models/Tenant.js';
import { isClosed } from '../patients/deathRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';
import { letterheadFor } from './settings.js';
import { PORTAL_SIGNUP_DAYS, receiveShare } from './abdm.js';
import { abhaAccess, portalAudit, startPortalSession } from './portal.js';

// The patient portal's own page of a hospital (/portal/h/<code>, docs/PATIENT_SIGNUP_PLAN.md, 16 Oct 2026): no staff
// login, open to the internet, so deliberately small.
//  - On only when the hospital admin switched on "Patients may sign up online" (the code is then made; switching it
//    off makes the address stop working). Needs the portal on.
//  - Sign-up: her ABHA number, ABHA address or Aadhaar-linked mobile → OTP from ABDM → her ABHA details → she agrees →
//    a sign-up waits in reception's Scan & Share list for up to 7 days. She is NOT a patient until reception registers
//    her or links her to her record. She is never told whether she is already registered here.
//  - Sign-in with ABHA: the same OTP; works only when a record of this hospital has that ABHA linked. Every refusal
//    gives the same answer.
//  - Never stored: the Aadhaar card or number (never asked for), the OTP. Her ABHA details are kept only in the sign-up.
// The sign-in page (/login → Patient) lists these hospitals by name and opens the same steps there (owner, 16 Oct
// 2026: one sign-in page for staff and patients; the sessions stay separate – a patient never gets a staff session).
// The steps are kept in this server's memory for 10 minutes (one server – HANDOVER.md section 7).

const STEP_MINUTES = 10;
const MAX_STEPS = 2000; // steps kept at once: a flood of OTP requests cannot fill the memory
const steps = new Map(); // id -> { tenantId, purpose, abdmTxnId, accounts?, until }
const NOT_FOUND = 'This page is not available. Please check the address on the poster, or call the hospital.';
const NO_SIGN_IN = 'We could not sign you in. If you registered recently, the hospital may not have confirmed it yet. Please call the hospital.';
const EXPIRED = 'This step has expired. Please start again.';

const limiter = (limit, minutes = 15) =>
  rateLimit({ windowMs: minutes * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many tries. Please wait 15 minutes, or call the hospital.', code: 'RATE_LIMITED' } } });

/** The hospital of a portal address (active, portal on, sign-up on) – else 404 with the same words. */
async function hospitalOf(req) {
  const key = String(req.params.key ?? '').toUpperCase();
  const tenant = /^[A-Z2-9]{8}$/.test(key) ? await Tenant.findOne({ 'messaging.signupKey': key, isActive: true }) : null;
  if (!tenant || !tenant.messaging?.portalEnabled) throw new HttpError(404, NOT_FOUND, 'NOT_FOUND');
  return tenant;
}

function startStep(fields) {
  const now = Date.now();
  for (const [id, s] of steps) if (s.until < now) steps.delete(id);
  if (steps.size >= MAX_STEPS) throw new HttpError(503, 'The hospital page is busy. Please try again in a few minutes.', 'BUSY');
  const id = randomUUID();
  steps.set(id, { ...fields, until: now + STEP_MINUTES * 60 * 1000 });
  return id;
}
function stepOf(id, tenant, purpose) {
  const s = steps.get(id);
  if (!s || s.until < Date.now() || s.tenantId !== String(tenant._id) || s.purpose !== purpose) throw new HttpError(409, EXPIRED, 'EXPIRED');
  return s;
}

/** Her ABHA as she typed it: a number, an address or a mobile number – or a 400 on the field. */
function abhaHint(hint, raw) {
  const value = hint === 'abha-number' ? abhaNumber(raw) : hint === 'mobile' ? mobileDigits(raw) : abhaAddress(raw);
  if (value) return value;
  const message = hint === 'abha-number' ? 'An ABHA number has 14 digits.' : hint === 'mobile' ? 'Enter a 10-digit mobile number.' : 'Enter an ABHA address like name@abdm.';
  throw Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { value: message } });
}

// What she sees of an ABHA from ABDM: hers (she proved it with the OTP), to choose the right one.
const accountView = (p) => ({ abhaNumber: p.abhaNumber, name: p.name ?? '', yearOfBirth: p.yearOfBirth ?? null, gender: p.gender ?? '' });
const practiceHint = () => (abdmMode() === 'practice' ? { practiceOtp: PRACTICE_OTP } : {});

/** /api/portal/h – otpLimitMax: OTPs one computer may ask for in 15 minutes (each one sends an SMS). */
export function portalSignupRouter({ otpLimitMax = 8 } = {}) {
  const router = Router();
  const otpLimiter = limiter(otpLimitMax);
  const stepLimiter = limiter(Math.max(30, otpLimitMax * 3));

  // ---------- The hospitals a patient can choose on the sign-in page (owner, 16 Oct 2026) ----------
  // Only hospitals whose admin switched on sign-up (and the portal): their name and portal code – nothing else.
  router.get('/', async (_req, res) => {
    const list = await Tenant.find({ isActive: true, 'messaging.portalEnabled': true, 'messaging.signupKey': { $type: 'string' } }, { name: 1, 'messaging.signupKey': 1 }).sort({ name: 1 }).lean();
    res.json({ hospitals: list.map((t) => ({ key: t.messaging.signupKey, name: t.name })) });
  });

  // ---------- The hospital's page ----------

  router.get('/:key', async (req, res) => {
    const tenant = await hospitalOf(req);
    const lh = letterheadFor(tenant);
    res.json({ hospital: { name: lh.name, phone: lh.phone, address: lh.address }, practice: abdmMode() === 'practice', signupDays: PORTAL_SIGNUP_DAYS });
  });

  // ---------- The OTP (sign-up and sign-in) ----------

  const otpBody = z
    .object({ purpose: z.enum(['signup', 'signin']), hint: z.enum(['abha-number', 'abha-address', 'mobile']), value: z.string().trim().min(3).max(100) })
    .strict();

  router.post('/:key/otp', otpLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(otpBody, req.body);
    const out = await abdmClient().requestLoginOtp({ hint: body.hint, value: abhaHint(body.hint, body.value) });
    const id = startStep({ tenantId: String(tenant._id), purpose: body.purpose, abdmTxnId: out.txnId });
    res.json({ id, sentTo: out.sentTo, ...practiceHint() });
  });

  const verifyBody = z.object({ id: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits.') }).strict();

  /** Her ABHAs from ABDM after the OTP (kept with the step for the next call). */
  async function verified(req, tenant, purpose) {
    const body = parse(verifyBody, req.body);
    const s = stepOf(body.id, tenant, purpose);
    const out = await abdmClient().verifyLoginOtp({ txnId: s.abdmTxnId, otp: body.otp });
    s.accounts = (out.accounts ?? []).filter((a) => a?.abhaNumber);
    if (!s.accounts.length) throw new HttpError(400, 'ABDM sent no ABHA for this. Please check what you typed.', 'ABDM');
    return { id: body.id, step: s };
  }

  // ---------- Sign-up ----------

  router.post('/:key/signup/verify', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const { id, step } = await verified(req, tenant, 'signup');
    res.json({ id, accounts: step.accounts.map(accountView) });
  });

  router.post('/:key/signup', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(z.object({ id: z.uuid(), abhaNumber: z.string().max(30), consent: z.literal(true, 'Please read and tick the agreement.') }).strict(), req.body);
    const s = stepOf(body.id, tenant, 'signup');
    const profile = (s.accounts ?? []).find((a) => a.abhaNumber === abhaNumber(body.abhaNumber));
    if (!profile) throw new HttpError(400, 'Please choose one of your ABHAs.', 'VALIDATION');
    steps.delete(body.id);
    // Already registered here, or already waiting: nothing new is made – and she gets the same answer, so this page never
    // tells anyone whether an ABHA is known at this hospital.
    const today = hospitalToday(req.now);
    const [registered, waiting] = await Promise.all([
      Patient.exists({ tenantId: tenant._id, 'abha.number': profile.abhaNumber }),
      ScanShare.exists({ tenantId: tenant._id, source: 'portal', status: 'waiting', 'profile.abhaNumber': profile.abhaNumber, on: { $gte: addDays(today, 1 - PORTAL_SIGNUP_DAYS) } }),
    ]);
    if (!registered && !waiting) {
      const share = await receiveShare(
        tenant._id,
        { abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress ?? '', name: profile.name ?? '', gender: profile.gender ?? '', yearOfBirth: profile.yearOfBirth ?? null, mobile: profile.mobile ?? '', address: profile.address ?? '' },
        { source: 'portal' },
        req.now,
      );
      // ids only (never her name or ABHA)
      await audit(req, 'PORTAL_SIGNUP_RECEIVED', { actor: null, tenantId: tenant._id, details: { shareId: String(share._id), token: share.token } });
    }
    res.status(201).json({ ok: true, signupDays: PORTAL_SIGNUP_DAYS });
  });

  // ---------- Sign-in with ABHA ----------

  /** The records of this hospital that have one of these ABHAs linked and may sign in (not closed). */
  async function linkedRecords(tenant, accounts) {
    const numbers = accounts.map((a) => a.abhaNumber);
    const records = await Patient.find({ tenantId: tenant._id, 'abha.number': { $in: numbers } });
    return records.filter((p) => !isClosed(p));
  }

  async function signIn(req, res, tenant, patient) {
    const access = await abhaAccess(tenant._id, patient._id, req.now);
    startPortalSession(res, access);
    await portalAudit(req, 'PORTAL_LOGIN_SUCCESS', access, { method: 'abha' });
    res.json({ ok: true });
  }

  async function refuse(req, tenant, reason) {
    await audit(req, 'PORTAL_LOGIN_FAILED', { actor: null, tenantId: tenant._id, details: { reason } });
    throw new HttpError(401, NO_SIGN_IN, 'PORTAL_LOGIN_FAILED');
  }

  router.post('/:key/signin/verify', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const { id, step } = await verified(req, tenant, 'signin');
    const records = await linkedRecords(tenant, step.accounts);
    if (!records.length) {
      steps.delete(id);
      return refuse(req, tenant, 'abha_not_registered');
    }
    if (records.length === 1) {
      steps.delete(id);
      return signIn(req, res, tenant, records[0]);
    }
    // One mobile, several ABHAs registered here (e.g. a mother and her baby): she chooses by name.
    step.records = records.map((p) => String(p._id));
    return res.json({ id, choose: records.map((p) => ({ id: String(p._id), name: p.fullName })) });
  });

  router.post('/:key/signin', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(z.object({ id: z.uuid(), patientId: z.string().max(30) }).strict(), req.body);
    const s = stepOf(body.id, tenant, 'signin');
    if (!(s.records ?? []).includes(body.patientId)) throw new HttpError(400, 'Please choose one of the names shown.', 'VALIDATION');
    steps.delete(body.id);
    const patient = await Patient.findOne({ tenantId: tenant._id, _id: body.patientId });
    if (!patient || isClosed(patient)) return refuse(req, tenant, 'abha_not_registered');
    return signIn(req, res, tenant, patient);
  });

  return router;
}

/** Tests only: forget every step. */
export const resetSignupSteps = () => steps.clear();
