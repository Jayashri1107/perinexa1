import { Router } from 'express';
import { z } from 'zod';
import { abdmClient, abdmMode, hospitalByHipId, track } from '../abdm/abdmService.js';
import {
  consentNotify,
  discover,
  healthInfoRequest,
  linkByHospital,
  linkConfirm,
  linkInit,
  onLinkResult,
  onLinkToken,
  practiceConfirm,
  practiceConsent,
  practiceDiscover,
  practiceReceived,
  practiceRequestAgain,
  practiceRevoke,
  recordsPage,
} from '../abdm/abdmRecords.js';
import { HI_TYPES } from '../abdm/shareRules.js';
import { addDays, hospitalDayStart } from '../careplans/dates.js';
import { AbdmConsent } from '../models/AbdmConsent.js';
import { AbdmTransfer } from '../models/AbdmTransfer.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// ABDM milestone M2 – sharing her records through her ABHA (abdm/abdmRecords.js). Mounted inside routes/abdm.js.
//  - For her doctor and RMOs (the medical details of THIS record): her records and what is linked to her ABHA, the
//    consents and what was sent; "Link to ABHA" (her doctor or an RMO, with her agreement); and in practice mode the
//    buttons that stand in for her ABHA app and for another hospital. Reception, nurses, the lab, the pharmacist and
//    the hospital admin never see this list (it is about her medical records).
//  - From ABDM (no login – ABDM's signature is checked on every call): linking answers, her ABHA app's discovery and
//    link confirmation, consents and requests for data. Answered 202 at once; the work follows (abdmService.track).

export const abdmRecordsRouter = Router();
export const abdmRecordsPublicRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
export const RECORDS_ROLES = ['doctor', 'rmo'];

/** Who may see her records in ABHA (her medical details) – and, with link: true, link them (her doctor or an RMO). */
export function recordsAccess(req, patient) {
  const access = patientAccess(req, patient);
  const see = hasRole(req.membership, ...RECORDS_ROLES) && access.view.has('pregnancy');
  return { see, link: see && access.editClinical === true };
}

async function patientFor(req, id, { link = false } = {}) {
  if (!hasRole(req.membership, ...RECORDS_ROLES)) throw forbidden('Her records in ABHA are for her doctor and RMOs.');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: id });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const access = recordsAccess(req, patient);
  if (!access.see) throw forbidden("You can't see this patient's medical records.");
  if (link && !access.link) throw forbidden('Only her doctor or an RMO links her records to her ABHA.');
  return { patient, access };
}
const tenantOf = (req) => Tenant.findById(req.tenantId, { name: 1, abdm: 1 }).lean();
const ids = (p, extra = {}) => ({ patientId: String(p._id), mrn: p.mrn, ...extra });

// ---------- Her records (doctors and RMOs) ----------

abdmRecordsRouter.get('/patients/:id/records', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { patient, access } = await patientFor(req, id);
  const page = await recordsPage(req.tenantId, patient, req.now);
  await audit(req, 'ABDM_RECORDS_VIEWED', { details: ids(patient) });
  res.json({ mode: abdmMode(), canLink: access.link, abhaLinked: Boolean(patient.abha?.number), ...page });
});

abdmRecordsRouter.post('/patients/:id/records/link', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(
    z
      .object({
        references: z.array(z.string().max(40)).min(1, 'Choose at least one record.').max(200),
        consent: z.literal(true, 'She must agree before her records are linked to her ABHA.'),
      })
      .strict(),
    req.body,
  );
  const { patient } = await patientFor(req, id, { link: true });
  res.json(await linkByHospital(req, patient, body.references));
});

// ---------- Practice mode: her ABHA app and another hospital ----------

const practiceOnly = () => {
  if (abdmMode() !== 'practice') throw new HttpError(409, 'Only in practice mode.', 'NOT_PRACTICE');
};

abdmRecordsRouter.post('/patients/:id/practice/discover', async (req, res) => {
  practiceOnly();
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { patient } = await patientFor(req, id, { link: true });
  res.json(await practiceDiscover(req, await tenantOf(req), patient));
});

abdmRecordsRouter.post('/patients/:id/practice/confirm', async (req, res) => {
  practiceOnly();
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(z.object({ transactionId: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits.') }).strict(), req.body);
  const { patient } = await patientFor(req, id, { link: true });
  res.json(await practiceConfirm(req, await tenantOf(req), patient, body));
});

abdmRecordsRouter.post('/patients/:id/practice/consent', async (req, res) => {
  practiceOnly();
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(
    z
      .object({
        from: requiredDateOnly('From'),
        to: requiredDateOnly('To'),
        hiTypes: z.array(z.enum(HI_TYPES)).min(1, 'Choose at least one kind of record.').max(HI_TYPES.length),
        days: z.number().int().min(-30, 'Between -30 and 365 days.').max(365, 'At most 365 days.'),
      })
      .strict()
      .refine((b) => b.from <= b.to, { path: ['to'], message: 'The end is before the start.' }),
    req.body,
  );
  const { patient } = await patientFor(req, id, { link: true });
  // The dates as whole days in the hospital: from 00:00 on the first day to the end of the last
  const from = hospitalDayStart(body.from).toISOString();
  const to = new Date(hospitalDayStart(addDays(body.to, 1)).getTime() - 1).toISOString();
  res.json(await practiceConsent(req, await tenantOf(req), patient, { from, to, hiTypes: [...new Set(body.hiTypes)], days: body.days }));
});

async function consentFor(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const consent = await AbdmConsent.findOne({ tenantId: req.tenantId, _id: id }).lean();
  if (!consent?.patientId) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  await patientFor(req, consent.patientId, { link: true });
  return consent;
}

abdmRecordsRouter.post('/consents/:id/practice/request', async (req, res) => {
  practiceOnly();
  const consent = await consentFor(req);
  if (!consent.practice) throw new HttpError(409, 'Only practice consents can be tried here.', 'NOT_PRACTICE');
  res.json(await practiceRequestAgain(req, await tenantOf(req), consent));
});

abdmRecordsRouter.post('/consents/:id/practice/revoke', async (req, res) => {
  practiceOnly();
  const consent = await consentFor(req);
  if (!consent.practice) throw new HttpError(409, 'Only practice consents can be withdrawn here.', 'NOT_PRACTICE');
  await practiceRevoke(req, await tenantOf(req), consent);
  res.json({ ok: true });
});

// What "Sample Clinic (practice)" received and decrypted – to see the FHIR documents exactly as they were sent.
abdmRecordsRouter.get('/transfers/:id/practice-received', async (req, res) => {
  practiceOnly();
  const { id } = parse(z.object({ id: objectId }), req.params);
  const transfer = await AbdmTransfer.findOne({ tenantId: req.tenantId, _id: id }).lean();
  if (!transfer?.patientId || !transfer.practice) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  const { patient } = await patientFor(req, transfer.patientId);
  await audit(req, 'ABDM_RECORDS_VIEWED', { details: ids(patient, { practice: true }) });
  res.json({ documents: practiceReceived(transfer) });
});

// ---------- From ABDM (no login: ABDM's signature is checked) ----------

/** The addresses ABDM calls, after the bridge URL (https://<public address>/api/abdm/public) – shown to the admin. */
export const ABDM_CALLBACK_PATHS = [
  '/api/v3/hip/patient/share',
  '/api/v3/hip/token/on-generate-token',
  '/api/v3/link/on_carecontext',
  '/api/v3/hip/patient/care-context/discover',
  '/api/v3/hip/link/care-context/init',
  '/api/v3/hip/link/care-context/confirm',
  '/api/v3/consent/request/hip/notify',
  '/api/v3/hip/health-information/request',
];

/** Checks ABDM's signature, finds the hospital by its HIP ID, answers 202 and then does the work. */
const fromAbdm = (work, hipIdOf = () => '') => async (req, res) => {
  await abdmClient().verifyRequest(req.get('authorization'));
  const hipId = String(req.get('x-hip-id') || hipIdOf(req.body ?? {}) || '').slice(0, 60);
  if (!hipId) throw new HttpError(400, 'No HIP ID.', 'VALIDATION');
  const tenant = await hospitalByHipId(hipId);
  if (!tenant) throw new HttpError(404, 'Unknown HIP ID.', 'NOT_FOUND');
  const requestId = String(req.get('request-id') ?? '').slice(0, 100);
  res.status(202).json({ ok: true });
  track(() => work(req, tenant, req.body ?? {}, requestId));
};

abdmRecordsPublicRouter.post('/api/v3/hip/token/on-generate-token', fromAbdm((req, tenant, body) => onLinkToken(req, tenant, body)));
abdmRecordsPublicRouter.post('/api/v3/link/on_carecontext', fromAbdm((req, tenant, body) => onLinkResult(req, tenant, body)));
abdmRecordsPublicRouter.post('/api/v3/hip/patient/care-context/discover', fromAbdm((req, tenant, body, requestId) => discover(req, tenant, body, { requestId })));
abdmRecordsPublicRouter.post('/api/v3/hip/link/care-context/init', fromAbdm((req, tenant, body, requestId) => linkInit(req, tenant, body, { requestId })));
abdmRecordsPublicRouter.post('/api/v3/hip/link/care-context/confirm', fromAbdm((req, tenant, body, requestId) => linkConfirm(req, tenant, body, { requestId })));
abdmRecordsPublicRouter.post(
  '/api/v3/consent/request/hip/notify',
  fromAbdm(
    (req, tenant, body, requestId) => consentNotify(req, tenant, body, { requestId }),
    (b) => b.notification?.consentDetail?.hip?.id,
  ),
);
abdmRecordsPublicRouter.post(
  '/api/v3/hip/health-information/request',
  fromAbdm((req, tenant, body, requestId) =>
    healthInfoRequest(req, tenant, body, {
      requestId,
      then: (work) => {
        track(work);
      },
    }),
  ),
);
