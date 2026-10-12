import { Router } from 'express';
import { z } from 'zod';
import { abdmClient, abdmMode, hospitalByHipId, track } from '../abdm/abdmService.js';
import { askForRecords, consentNotify, fetchAgain, fetchPage, fetchedDocument, fetchedFile, onConsentDetails, onConsentInit, onDataRequested, practiceAnswer, practiceEnd, receivePush } from '../abdm/fetchRecords.js';
import { FETCH_HI_TYPES } from '../abdm/fhirReader.js';
import { addDays, hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { AbdmFetchRequest } from '../models/AbdmFetchRequest.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';
import { RECORDS_ROLES, recordsAccess } from './abdmRecords.js';
import { hasRole } from '../models/Membership.js';

// ABDM milestone M3 – her records from other hospitals, fetched through ABDM with her consent (abdm/fetchRecords.js).
// Mounted inside routes/abdm.js.
//  - For those who may see her medical details (her doctor, another doctor of a record that is not sensitive, RMOs):
//    the requests and the documents received, read-only; each document and file opened is in the audit log.
//  - Her doctor or an RMO asks for them ("Ask for her records from other hospitals"), and in practice mode stands in
//    for her ABHA app (she agrees, refuses, withdraws, or the consent ends).
//  - From ABDM (no login – ABDM's signature checked): its id for the request, her answer, a consent's details, the
//    transfer's id. Answered 202 at once; the work follows (abdmService.track).
//  - From the other hospital (the data push): no signature to check (see ABDM_CHECKLIST_M3) – accepted only for a
//    transfer this hospital is waiting for, only for the records in her consent, and decrypted with a key made for
//    that request alone.

export const abdmFetchRouter = Router();
export const abdmFetchPublicRouter = Router();

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

/** The patient, when this person may see (and, with ask: true, ask for) her records from other hospitals. */
async function patientFor(req, id, { ask = false } = {}) {
  if (!hasRole(req.membership, ...RECORDS_ROLES)) throw forbidden('Her records from other hospitals are for her doctors and RMOs.');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: id });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  const access = recordsAccess(req, patient);
  if (!access.see) throw forbidden("You can't see this patient's medical records.");
  if (ask && !access.link) throw forbidden('Only her doctor or an RMO asks for her records from other hospitals.');
  return { patient, access };
}
const tenantOf = (req) => Tenant.findById(req.tenantId, { name: 1, abdm: 1 }).lean();
const ids = (p, extra = {}) => ({ patientId: String(p._id), mrn: p.mrn, ...extra });

// ---------- Her records from other hospitals ----------

abdmFetchRouter.get('/patients/:id/fetch', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { patient, access } = await patientFor(req, id);
  const page = await fetchPage(req.tenantId, patient, req.now);
  // The list of documents received is in the audit log when there was something to see
  if (page.documents.length) await audit(req, 'ABDM_FETCHED_VIEWED', { details: ids(patient, { documents: page.documents.length }) });
  res.json({ mode: abdmMode(), canAsk: access.link, abhaLinked: Boolean(patient.abha?.number), hiTypes: FETCH_HI_TYPES, ...page });
});

const DAYS = [7, 30, 90, 180, 365];

abdmFetchRouter.post('/patients/:id/fetch', async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(
    z
      .object({
        clientRequestId: z.uuid(),
        hiTypes: z.array(z.enum(FETCH_HI_TYPES)).min(1, 'Choose at least one kind of record.').max(FETCH_HI_TYPES.length),
        from: requiredDateOnly('From'),
        to: requiredDateOnly('To'),
        days: z.number().int().refine((d) => DAYS.includes(d), `Choose how long the consent lasts: ${DAYS.join(', ')} days.`),
      })
      .strict()
      .refine((b) => b.from <= b.to, { path: ['to'], message: 'The end is before the start.' }),
    req.body,
  );
  if (body.to > hospitalToday(req.now)) throw Object.assign(new HttpError(400, 'The records asked for end today at the latest.', 'VALIDATION'), { fields: { to: 'Today at the latest.' } });
  const { patient } = await patientFor(req, id, { ask: true });
  // The dates as whole days in the hospital: from 00:00 on the first day to the end of the last
  const from = hospitalDayStart(body.from);
  const to = new Date(hospitalDayStart(addDays(body.to, 1)).getTime() - 1);
  const r = await askForRecords(req, patient, { hiTypes: [...new Set(body.hiTypes)], from, to, days: body.days, clientRequestId: body.clientRequestId });
  res.status(201).json({ request: { id: String(r._id), status: r.status } });
});

/** One document, to read. */
abdmFetchRouter.get('/patients/:id/fetched/:recordId', async (req, res) => {
  const { id, recordId } = parse(z.object({ id: objectId, recordId: objectId }), req.params);
  const { patient } = await patientFor(req, id);
  const document = await fetchedDocument(req.tenantId, patient, recordId, req.now);
  await audit(req, 'ABDM_FETCHED_VIEWED', { details: ids(patient, { recordId }) });
  res.json({ document });
});

/** An attached file (a PDF or a photo on the safe list), as a download – never shown inside Perinexa's pages. */
abdmFetchRouter.get('/patients/:id/fetched/:recordId/files/:fileId', async (req, res) => {
  const { id, recordId, fileId } = parse(z.object({ id: objectId, recordId: objectId, fileId: objectId }), req.params);
  const { patient } = await patientFor(req, id);
  const file = await fetchedFile(req.tenantId, patient, recordId, fileId, req.now);
  await audit(req, 'ABDM_FETCHED_VIEWED', { details: ids(patient, { recordId, fileId }) });
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[file.contentType];
  res.set('Content-Type', file.contentType);
  // Named by its kind, never by the title another hospital gave it (it may hold a name)
  res.set('Content-Disposition', `attachment; filename="record-from-another-hospital.${ext}"`);
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(file.data);
});

async function requestFor(req, { ask = true } = {}) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const r = await AbdmFetchRequest.findOne({ tenantId: req.tenantId, _id: id }).lean();
  if (!r) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  await patientFor(req, r.patientId, { ask });
  return r;
}

/** "Fetch again": one hospital's records asked for again (they failed, or nothing came for 30 minutes). */
abdmFetchRouter.post('/fetch/:id/hospitals/:consentId/again', async (req, res) => {
  const { consentId } = parse(z.object({ id: objectId, consentId: z.string().min(1).max(100) }), req.params);
  const r = await requestFor(req);
  const out = await fetchAgain(req, await tenantOf(req), r, consentId);
  res.json({ request: { id: String(out._id), status: out.status } });
});

// ---------- Practice mode: the control that stands in for her ABHA app ----------

const practiceOnly = () => {
  if (abdmMode() !== 'practice') throw new HttpError(409, 'Only in practice mode.', 'NOT_PRACTICE');
};

abdmFetchRouter.post('/fetch/:id/practice/answer', async (req, res) => {
  practiceOnly();
  const { approve } = parse(z.object({ approve: z.boolean() }).strict(), req.body);
  const r = await requestFor(req);
  if (!r.practice) throw new HttpError(409, 'Only practice requests can be answered here.', 'NOT_PRACTICE');
  const out = await practiceAnswer(req, await tenantOf(req), r, approve);
  res.json({ request: { id: String(out._id), status: out.status } });
});

abdmFetchRouter.post('/fetch/:id/practice/end', async (req, res) => {
  practiceOnly();
  const { status } = parse(z.object({ status: z.enum(['REVOKED', 'EXPIRED']) }).strict(), req.body);
  const r = await requestFor(req);
  if (!r.practice) throw new HttpError(409, 'Only practice requests can be ended here.', 'NOT_PRACTICE');
  const out = await practiceEnd(req, await tenantOf(req), r, status);
  res.json({ request: { id: String(out._id), status: out.status } });
});

// ---------- From ABDM, and from the other hospital ----------

/** The addresses ABDM calls for M3, after the bridge URL – shown to the admin. */
export const ABDM_HIU_CALLBACK_PATHS = [
  '/api/v3/hiu/consent/request/on-init',
  '/api/v3/hiu/consent/request/notify',
  '/api/v3/hiu/consent/on-fetch',
  '/api/v3/hiu/health-information/on-request',
  '/api/v3/hiu/data/push/<HIU ID>',
];

/** Checks ABDM's signature, finds the hospital by its HIU ID (its HIP ID), answers 202 and then does the work. */
const fromAbdm = (work, hiuIdOf = () => '') => async (req, res) => {
  await abdmClient().verifyRequest(req.get('authorization'));
  const hiuId = String(req.get('x-hiu-id') || hiuIdOf(req.body ?? {}) || '').slice(0, 60);
  if (!hiuId) throw new HttpError(400, 'No HIU ID.', 'VALIDATION');
  const tenant = await hospitalByHipId(hiuId);
  if (!tenant) throw new HttpError(404, 'Unknown HIU ID.', 'NOT_FOUND');
  const requestId = String(req.get('request-id') ?? '').slice(0, 100);
  res.status(202).json({ ok: true });
  track(() => work(req, tenant, req.body ?? {}, requestId));
};

abdmFetchPublicRouter.post('/api/v3/hiu/consent/request/on-init', fromAbdm((req, tenant, body) => onConsentInit(req, tenant, body)));
abdmFetchPublicRouter.post('/api/v3/hiu/consent/request/notify', fromAbdm((req, tenant, body, requestId) => consentNotify(req, tenant, body, { requestId })));
abdmFetchPublicRouter.post(
  '/api/v3/hiu/consent/on-fetch',
  fromAbdm(
    (req, tenant, body) => onConsentDetails(req, tenant, body),
    (b) => b.consent?.consentDetail?.hiu?.id,
  ),
);
abdmFetchPublicRouter.post('/api/v3/hiu/health-information/on-request', fromAbdm((req, tenant, body) => onDataRequested(req, tenant, body)));

/**
 * Before the body of a data push is read (up to 30 MB – app.js): refused at once in practice mode and for an unknown
 * HIU ID, so a stranger's large post is never read.
 */
export async function beforePushBody(req, _res, next) {
  if (abdmMode() === 'practice') throw new HttpError(404, 'Records from other hospitals are not received in practice mode.', 'NOT_FOUND');
  let hiuId = '';
  try {
    hiuId = decodeURIComponent(new URL(req.originalUrl, 'http://perinexa.invalid').pathname.split('/').pop() ?? '').slice(0, 60);
  } catch {
    hiuId = '';
  }
  if (!(await hospitalByHipId(hiuId, { _id: 1 }))) throw new HttpError(404, 'Unknown HIU ID.', 'NOT_FOUND');
  next();
}

// The other hospital sends her records here (the dataPushUrl Perinexa gave). Not in practice mode.
abdmFetchPublicRouter.post('/api/v3/hiu/data/push/:hiuId', async (req, res) => {
  if (abdmMode() === 'practice') throw new HttpError(404, 'Records from other hospitals are not received in practice mode.', 'NOT_FOUND');
  const hiuId = String(req.params.hiuId ?? '').slice(0, 60);
  const tenant = await hospitalByHipId(hiuId);
  if (!tenant) throw new HttpError(404, 'Unknown HIU ID.', 'NOT_FOUND');
  const transactionId = String(req.body?.transactionId ?? '').slice(0, 100);
  const waiting = transactionId ? await AbdmFetchRequest.exists({ tenantId: tenant._id, hospitals: { $elemMatch: { transactionId, step: 'asked' } } }) : null;
  if (!waiting) throw new HttpError(404, 'No request is waiting for these records.', 'NOT_FOUND');
  res.status(202).json({ ok: true });
  track(() => receivePush(req, tenant, req.body ?? {}));
});
