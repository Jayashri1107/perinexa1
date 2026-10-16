import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { mobileDigits } from '../abdm/abhaFormat.js';
import { config } from '../config.js';
import { Patient } from '../models/Patient.js';
import { PatientAccount } from '../models/PatientAccount.js';
import { Tenant } from '../models/Tenant.js';
import { isClosed } from '../patients/deathRules.js';
import { currentSender } from '../reminders/sender.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { fakeVerify, hashPassword, passwordSchema, verifyPassword } from '../utils/password.js';
import { parse } from '../utils/validate.js';
import { letterheadFor } from './settings.js';
import { accountAccess, portalAudit, portalSession, startPortalSession } from './portal.js';

// Patients' own accounts on the hospital's portal (owner, 16 Oct 2026 – docs/PATIENT_ACCOUNTS_PLAN.md). Public (no
// staff login), so deliberately small:
//  - On only when the hospital admin switched on "Patients may sign up online" (the hospital's portal code is made
//    then; switching it off makes the address stop working). Needs the portal on.
//  - Sign up: name, age, mobile, agreement – and, if she wants, email and password (owner, 16 Oct 2026: email optional;
//    without one she signs in with mobile and OTP only) → a PENDING account. Nothing is a patient record yet;
//    reception approves (linking her record) or rejects it (routes/patientAccounts.js). The answer is the same whether
//    or not the mobile or email is already signed up here, so this page never tells anyone who is registered.
//  - Sign in: email and password, or mobile and an OTP by SMS. Only an APPROVED account opens her portal; a pending or
//    rejected one is told so only after the right password or OTP. 5 wrong tries lock the account for 30 minutes;
//    tries are also limited per computer.
//  - OTP: 6 digits, 10 minutes, 5 tries, kept only as a keyed hash; sent by the reminders' SMS provider (server/.env).
//    Without a provider, outside production, "practice mode" shows the OTP on screen; in production mobile sign-in is
//    then off.
//  - Her portal session is the same as before (routes/portal.js): its own cookie and key, 15 minutes.
// The sign-in page (/login → Patient) lists the hospitals with sign-up on, by name, and opens these steps there.

const OTP_MINUTES = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 30;
const NOT_FOUND = 'This page is not available. Please check the address, or call the hospital.';
const WRONG = 'The email or password is not right.';
const WRONG_OTP = 'The OTP is not right, or it has expired. Ask for a new one.';
const LOCKED = 'This account is locked for 30 minutes after wrong tries. Please wait, or call the hospital.';

const otpKey = createHmac('sha256', config.JWT_SECRET).update('perinexa-patient-otp-v1').digest();
const hashOtp = (accountId, otp) => createHmac('sha256', otpKey).update(`${accountId}:${otp}`).digest('hex');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const limiter = (limit) =>
  rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many tries. Please wait 15 minutes, or call the hospital.', code: 'RATE_LIMITED' } } });

/** How an OTP reaches her: the SMS provider, practice mode (shown on screen, never in production), or not at all. */
export function otpMode() {
  const sender = currentSender();
  if (sender?.channels?.includes('sms')) return 'sms';
  return config.isProduction ? 'off' : 'practice';
}

/** The hospital of a portal address (active, portal on, sign-up on) – else 404 with the same words. */
async function hospitalOf(req) {
  const key = String(req.params.key ?? '').toUpperCase();
  const tenant = /^[A-Z2-9]{8}$/.test(key) ? await Tenant.findOne({ 'messaging.signupKey': key, isActive: true }) : null;
  if (!tenant || !tenant.messaging?.portalEnabled) throw new HttpError(404, NOT_FOUND, 'NOT_FOUND');
  return tenant;
}

const fieldError = (field, message) => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields: { [field]: message } });
function mobileOf(text) {
  const m = mobileDigits(text);
  if (!m) throw fieldError('mobile', 'Enter a 10-digit mobile number.');
  return m;
}

/** Her account by email or mobile: the live one (pending or approved), else her latest rejected one. */
async function accountBy(tenant, filter) {
  const live = await PatientAccount.findOne({ tenantId: tenant._id, ...filter, status: { $in: ['pending', 'approved'] } });
  return live ?? PatientAccount.findOne({ tenantId: tenant._id, ...filter, status: 'rejected' }).sort({ createdAt: -1 });
}

const isLocked = (a, now) => a.lockedUntil && a.lockedUntil > now;
async function failed(a, now) {
  a.failedAttempts += 1;
  if (a.failedAttempts >= MAX_FAILED) {
    a.lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
    a.failedAttempts = 0;
  }
  await a.save();
}

/** After the right password or OTP: a pending or rejected account is told so; an approved one gets her portal. */
async function signIn(req, res, tenant, account, method) {
  const lh = letterheadFor(tenant);
  account.otp = null;
  if (account.status === 'pending') {
    await account.save();
    throw new HttpError(403, `Your registration is waiting for ${lh.name} to approve it. You can sign in once it is approved.`, 'ACCOUNT_PENDING');
  }
  const patient = account.patientId ? await Patient.findOne({ tenantId: tenant._id, _id: account.patientId }) : null;
  if (account.status !== 'approved' || !patient || isClosed(patient)) {
    await account.save();
    throw new HttpError(403, `Your registration was not approved. Please call ${lh.name}${lh.phone ? ` on ${lh.phone}` : ''}.`, 'ACCOUNT_REJECTED');
  }
  account.failedAttempts = 0;
  account.lockedUntil = null;
  account.lastSignInAt = req.now;
  await account.save();
  const access = await accountAccess(tenant._id, patient._id, account._id, req.now);
  startPortalSession(res, access);
  await portalAudit(req, 'PORTAL_LOGIN_SUCCESS', access, { method });
  res.json({ ok: true });
}

async function refuse(req, tenant, reason, message = WRONG) {
  await audit(req, 'PORTAL_LOGIN_FAILED', { actor: null, tenantId: tenant._id, details: { reason } });
  throw new HttpError(401, message, 'PORTAL_LOGIN_FAILED');
}

/** /api/portal/h – otpLimitMax: OTPs one computer may ask for in 15 minutes (each one sends an SMS). */
export function portalSignupRouter({ otpLimitMax = 8 } = {}) {
  const router = Router();
  const otpLimiter = limiter(otpLimitMax);
  const stepLimiter = limiter(Math.max(30, otpLimitMax * 3));

  // ---------- The hospitals a patient can choose on the sign-in page ----------
  // Only hospitals whose admin switched on sign-up (and the portal): their name and portal code – nothing else.
  router.get('/', async (_req, res) => {
    const list = await Tenant.find({ isActive: true, 'messaging.portalEnabled': true, 'messaging.signupKey': { $type: 'string' } }, { name: 1, 'messaging.signupKey': 1 }).sort({ name: 1 }).lean();
    res.json({ hospitals: list.map((t) => ({ key: t.messaging.signupKey, name: t.name })), otp: otpMode() });
  });

  // ---------- The hospital's page ----------
  router.get('/:key', async (req, res) => {
    const tenant = await hospitalOf(req);
    const lh = letterheadFor(tenant);
    res.json({ hospital: { name: lh.name, phone: lh.phone, address: lh.address }, otp: otpMode() });
  });

  // ---------- Sign up ----------
  const signupBody = z
    .object({
      fullName: z.string().trim().min(2, 'Please enter your full name.').max(150),
      ageYears: z.coerce.number({ error: 'Please enter your age.' }).int('Please enter your age in years.').min(1, 'Please enter your age.').max(120, 'Please check your age.'),
      mobile: z.string().max(20),
      email: z.union([z.literal(''), z.email('Please enter a valid email, or leave it empty.').max(254)]).optional(),
      password: z.string().max(128).optional(),
      consent: z.literal(true, 'Please read and tick the agreement.'),
    })
    .strict();

  router.post('/:key/signup', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(signupBody, req.body);
    const mobile = mobileOf(body.mobile);
    const email = body.email ? body.email.trim().toLowerCase() : null;
    // A password only with an email (it is what she signs in with); the staff password rules
    let passwordHash = null;
    if (email) {
      const checked = passwordSchema.safeParse(body.password ?? '');
      if (!checked.success) throw fieldError('password', body.password ? checked.error.issues[0].message : 'With an email, please choose a password.');
      passwordHash = await hashPassword(body.password);
    }
    const taken = await PatientAccount.exists({ tenantId: tenant._id, status: { $in: ['pending', 'approved'] }, $or: [{ mobile }, ...(email ? [{ email }] : [])] });
    // Already signed up with this mobile or email: nothing new, the same answer (never says who is registered here)
    if (!taken) {
      try {
        const account = await PatientAccount.create({ tenantId: tenant._id, fullName: body.fullName, ageYears: body.ageYears, mobile, email, passwordHash });
        await audit(req, 'PORTAL_SIGNUP_RECEIVED', { actor: null, tenantId: tenant._id, details: { accountId: String(account._id) } });
      } catch (err) {
        if (err?.code !== 11000) throw err; // the same sign-up sent twice at once
      }
    }
    res.status(201).json({ ok: true });
  });

  // ---------- Sign in: email and password ----------
  router.post('/:key/login', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(z.object({ email: z.string().trim().max(254), password: z.string().max(128) }).strict(), req.body);
    const email = body.email.toLowerCase();
    const account = email ? await accountBy(tenant, { email }) : null;
    if (!account || !account.passwordHash) {
      await fakeVerify(body.password); // as long as a wrong password
      return refuse(req, tenant, 'unknown_email');
    }
    if (isLocked(account, req.now)) throw new HttpError(429, LOCKED, 'PORTAL_LOCKED');
    if (!(await verifyPassword(body.password, account.passwordHash))) {
      await failed(account, req.now);
      return refuse(req, tenant, 'wrong_password');
    }
    return signIn(req, res, tenant, account, 'password');
  });

  // ---------- Sign in: mobile and OTP ----------
  router.post('/:key/otp', otpLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const mode = otpMode();
    if (mode === 'off') throw new HttpError(409, 'Sign-in with an OTP is not available yet. Please use your email and password.', 'OTP_OFF');
    const mobile = mobileOf(parse(z.object({ mobile: z.string().max(20) }).strict(), req.body).mobile);
    const account = await accountBy(tenant, { mobile });
    let practiceOtp = null;
    if (account && !isLocked(account, req.now)) {
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      account.otp = { hash: hashOtp(account._id, otp), expiresAt: new Date(req.now.getTime() + OTP_MINUTES * 60 * 1000), tries: 0 };
      await account.save();
      const lh = letterheadFor(tenant);
      if (mode === 'sms') await currentSender().send({ channel: 'sms', to: `+91${mobile}`, text: `${otp} is your OTP to sign in to ${lh.name}. It works for ${OTP_MINUTES} minutes. Do not share it.` });
      else practiceOtp = otp;
    }
    // The same answer for every number (practice mode shows the OTP only when one was made)
    res.json({ sentTo: `******${mobile.slice(-4)}`, minutes: OTP_MINUTES, ...(practiceOtp ? { practiceOtp } : {}) });
  });

  router.post('/:key/otp/verify', stepLimiter, async (req, res) => {
    const tenant = await hospitalOf(req);
    const body = parse(z.object({ mobile: z.string().max(20), otp: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits.') }).strict(), req.body);
    const mobile = mobileOf(body.mobile);
    const account = await accountBy(tenant, { mobile });
    if (!account || !account.otp || account.otp.expiresAt <= req.now) return refuse(req, tenant, 'otp_expired', WRONG_OTP);
    if (isLocked(account, req.now)) throw new HttpError(429, LOCKED, 'PORTAL_LOCKED');
    if (!same(hashOtp(account._id, body.otp), account.otp.hash)) {
      account.otp.tries += 1;
      if (account.otp.tries >= MAX_FAILED) account.otp = null; // a new OTP is needed
      await failed(account, req.now);
      return refuse(req, tenant, 'wrong_otp', WRONG_OTP);
    }
    return signIn(req, res, tenant, account, 'otp');
  });

  return router;
}

/** /api/portal/account – her own account, once signed in: a new password (also after signing in with an OTP). */
export const portalAccountRouter = Router();
portalAccountRouter.post('/password', async (req, res) => {
  const { access } = await portalSession(req, res);
  const body = parse(z.object({ password: passwordSchema }).strict(), req.body);
  if (!access.accountId) throw new HttpError(409, 'Signed in with a code from the hospital: there is no password to change.', 'NO_ACCOUNT');
  const account = await PatientAccount.findOne({ tenantId: access.tenantId, _id: access.accountId, status: 'approved' });
  if (!account) throw new HttpError(401, 'Please sign in again.', 'PORTAL_SIGNED_OUT');
  if (!account.email) throw new HttpError(409, 'You signed up without an email: you sign in with your mobile number and an OTP, so there is no password.', 'NO_EMAIL');
  account.passwordHash = await hashPassword(body.password);
  await account.save();
  await portalAudit(req, 'PORTAL_PASSWORD_CHANGED', access);
  res.json({ ok: true });
});
