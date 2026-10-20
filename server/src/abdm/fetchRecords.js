// ABDM milestone M3 – the hospital as a Health Information User (HIU): her doctor or an RMO asks for her records from
// other hospitals; she answers in her ABHA app; when she agrees, each hospital that has records for her sends them,
// encrypted for this request only; Perinexa decrypts and reads them and shows them read-only until her consent ends.
// Works the same in practice mode (practiceClient.js and practiceHospitals.js – nothing leaves this computer) and with
// ABDM's V3 APIs (v3Client.js – not yet tried against ABDM; ABDM_CHECKLIST_M3).
//
// The steps (each ABDM answer may come later, on its own address – routes/abdmFetch.js):
//   ask (consent request) → ABDM's id (on-init) → her answer (notify: GRANTED, one consent per hospital, or DENIED)
//   → each consent's details (fetch / on-fetch) → ask for the records with a new key pair (health-information
//   request / on-request) → the pages arrive (data push) → decrypted, read (fhirReader.js), kept → ABDM told.
//
// Rules kept here:
//  - The private key that decrypts her records is made for ONE request, kept in this server's memory only (never in
//    the database or a log), and forgotten when the records have come, when the consent ends, or after 24 hours.
//  - A page is accepted only for a transfer this hospital is waiting for, only for the records named in her consent,
//    once, and only while the consent is valid. What cannot be decrypted or read is counted, never kept.
//  - What is kept: the readable content after the fetal-sex guard (PC-PNDT), and safe attached files – under her
//    record, until her consent ends. Deleted when it ends (checked every 15 minutes, and whenever her records are
//    opened) or at once when she withdraws it. Never copied into Perinexa's own records, never sent on.
//  - The audit log: ids and counts only – asked, answered, fetched, opened, deleted.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AbdmFetchRequest } from '../models/AbdmFetchRequest.js';
import { AbdmFetchedFile, AbdmFetchedRecord } from '../models/AbdmFetchedRecord.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { isClosed } from '../patients/deathRules.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import * as shared from '../utils/sharedState.js';
import { abhaAddress as cleanAddress } from './abhaFormat.js';
import { abdmClient } from './abdmService.js';
import { checksumOf, decryptFrom, requesterKeyMaterial } from './fidelius.js';
import { FETCH_HI_TYPES, guardText, readDocument } from './fhirReader.js';
import { PRACTICE_HIU_PUSH_URL } from './practiceClient.js';

const DAY = 86_400_000;
const KEY_HOURS = 24;
const STUCK_MINUTES = 30; // "Fetch again" for a hospital that has not sent anything for this long
const MAX_ENTRIES_PER_PAGE = 50;
const MAX_PAGES = 500;
const MAX_DOCUMENT_CHARS = 25_000_000;
export const PURPOSE = Object.freeze({ code: 'CAREMGT', text: 'Care Management', refUri: 'http://terminology.hl7.org/ValueSet/v3-PurposeOfUse' });
const PRACTICE_HIU_ID = 'PRACTICE-HIU-PERINEXA';

const conflict = (message, code) => new HttpError(409, message, code);
const isPractice = (client) => client.mode === 'practice';
const list = (v) => (Array.isArray(v) ? v : []);
const clip = (v, n) => String(v ?? '').slice(0, n);
const hiuIdOf = (tenant) => tenant?.abdm?.hipId ?? '';
const dateOrNull = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const earliest = (...dates) => dates.filter(Boolean).sort((a, b) => a - b)[0] ?? null;
const errText = (err) => clip(err instanceof HttpError ? err.message : 'ABDM could not be reached.', 300);
/** The address other hospitals send her records to (after the bridge URL), with the hospital's HIU ID. */
export const dataPushUrl = (hiuId) => `${String(config.ABDM_PUBLIC_URL ?? '').replace(/\/+$/, '')}/api/abdm/public/api/v3/hiu/data/push/${encodeURIComponent(hiuId)}`;

// ---------- The one-time keys ----------
// dataRequestId -> { privateRaw, nonce }: in the database, encrypted (utils/sharedState.js), so the copy of the server
// that receives her records can read them whichever copy asked; removed when used or when their time has passed.

const KEYS = 'abdm-hiu-key';
const keepKey = (id, key, until) => shared.put(KEYS, id, key, until, { secret: true });
const keyFor = (id) => shared.get(KEYS, id);
const dropKey = (id) => (id ? shared.drop(KEYS, id) : null);
/** Tests only: forgets every key (records that come later cannot be read). */
export const forgetKeysForTests = () => shared.dropAll(KEYS);

// ---------- Small helpers ----------

/** Changes one hospital's entry of a request (by its consent id). */
const setHospital = (tenantId, requestId, consentId, fields) =>
  AbdmFetchRequest.updateOne({ tenantId, _id: requestId, 'hospitals.consentId': consentId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`hospitals.$.${k}`, v])) });

async function patientIds(tenantId, patientId) {
  const p = await Patient.findOne({ tenantId, _id: patientId }, { mrn: 1, careType: 1 }).lean();
  return { who: { patientId: String(patientId), mrn: p?.mrn }, careType: p?.careType ?? '' };
}

/** The doctor who asks, as ABDM's consent request names the requester (name and registration number). */
async function requesterOf(user) {
  const u = await User.findById(user._id, { name: 1, professional: 1 }).lean();
  const reg = u?.professional?.registrationNumber ?? '';
  return { name: u?.name ?? user.name ?? '', ...(reg ? { identifier: { type: 'REGNO', value: reg, system: 'https://www.mciindia.org' } } : {}) };
}

/** Deletes the fetched documents (and files) of one consent: { documents, files }. */
async function removeDocuments(tenantId, consentId) {
  const [documents, files] = await Promise.all([AbdmFetchedRecord.countDocuments({ tenantId, consentId }), AbdmFetchedFile.countDocuments({ tenantId, consentId })]);
  await AbdmFetchedFile.deleteMany({ tenantId, consentId });
  await AbdmFetchedRecord.deleteMany({ tenantId, consentId });
  return { documents, files };
}

/** Deletes one hospital's documents and writes "deleted" to the audit log (when there was something to delete). */
async function deleteFor(req, tenantId, r, h, why, now) {
  const counts = await removeDocuments(tenantId, h.consentId);
  await dropKey(h.dataRequestId);
  if (why !== 'replaced') await setHospital(tenantId, r._id, h.consentId, { step: 'deleted', deletedAt: now, deletedWhy: why });
  if (counts.documents || counts.files) {
    const { who } = await patientIds(tenantId, r.patientId);
    await audit(req, 'ABDM_FETCHED_DELETED', { tenantId, details: { ...who, requestId: String(r._id), consentId: h.consentId, why, documents: counts.documents, files: counts.files, practice: Boolean(r.practice) } });
  }
  return counts;
}

// ---------- Asking (her doctor or an RMO) ----------

/**
 * "Ask for her records from other hospitals": a consent request to her ABHA app for care management – the kinds of
 * record, the dates of the records, and how many days the consent (and the records kept here) should last.
 */
export async function askForRecords(req, patient, { hiTypes, from, to, days, clientRequestId = '' }) {
  const tenantId = req.tenantId;
  const sameClick = async () => {
    const same = clientRequestId ? await AbdmFetchRequest.findOne({ tenantId, clientRequestId }).lean() : null;
    if (same && String(same.patientId) !== String(patient._id)) throw conflict('This request was already made for another patient. Reload the page.', 'CONFLICT');
    return same; // the same click again (even at the same moment): asked once
  };
  const same = await sameClick();
  if (same) return same;
  if (!patient.abha?.number) throw conflict('Link her ABHA to her record first.', 'NOT_LINKED');
  if (isClosed(patient)) throw conflict('This record is closed, so it takes no new requests for records.', 'RECORD_CLOSED');
  refuseNewOnDuplicate(patient, 'abdmFetch');
  const client = abdmClient();
  const practice = isPractice(client);
  const tenant = await Tenant.findById(tenantId, { name: 1, abdm: 1 }).lean();
  const hiuId = hiuIdOf(tenant);
  const address = patient.abha.address || '';
  if (!practice) {
    if (!hiuId) throw conflict("The hospital's HIP ID (also its HIU ID) is not set yet (Hospital admin → ABDM).", 'NO_HIP_ID');
    if (!config.ABDM_PUBLIC_URL) throw conflict('Perinexa is not on the internet yet (ABDM_PUBLIC_URL in server/.env), so other hospitals cannot send her records to it.', 'NO_PUBLIC_URL');
    if (!address) throw conflict('ABDM needs her ABHA address: verify her ABHA again (above), then ask.', 'VERIFY_AGAIN');
  }
  const now = req.now ?? new Date();
  const expiresAt = new Date(now.getTime() + days * DAY);
  const initRequestId = randomUUID();
  const consent = {
    purpose: { ...PURPOSE },
    patient: { id: address || patient.abha.number },
    hiu: { id: hiuId || PRACTICE_HIU_ID },
    requester: await requesterOf(req.user),
    hiTypes,
    permission: { accessMode: 'VIEW', dateRange: { from: from.toISOString(), to: to.toISOString() }, dataEraseAt: expiresAt.toISOString(), frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
  };
  // Saved BEFORE ABDM is asked: its answer (on-init, with the id her later "yes" carries) may come before the call
  // returns, and must find the request. A double click at the same moment meets the unique clientRequestId.
  let r;
  try {
    r = await AbdmFetchRequest.create({
      tenantId,
      patientId: patient._id,
      abhaNumber: patient.abha.number,
      abhaAddress: address,
      asked: { by: req.user._id, byName: req.user.name ?? '', at: now },
      purpose: { code: PURPOSE.code, text: 'Care management' },
      hiTypes,
      from,
      to,
      expiresAt,
      days,
      clientRequestId,
      initRequestId,
      status: 'requested',
      history: [{ status: 'requested', at: now }],
      practice,
    });
  } catch (err) {
    const again = err?.code === 11000 ? await sameClick() : null;
    if (again) return again;
    throw err;
  }
  let out;
  try {
    // Practice mode: made-up documents carry a made-up name, never hers (ABDM's request carries no name)
    out = await client.consentRequestInit({ hiuId, requestId: initRequestId, consent });
  } catch (err) {
    // A refusal by ABDM is said to the doctor at once (nothing is kept)
    await AbdmFetchRequest.deleteOne({ tenantId, _id: r._id });
    throw err;
  }
  // Practice mode gives ABDM's id at once (ABDM's own answer may have come already: then nothing changes here)
  const consentRequestId = clip(out?.consentRequestId, 100);
  if (consentRequestId) await AbdmFetchRequest.updateOne({ tenantId, _id: r._id, status: 'requested' }, { $set: { status: 'waiting', consentRequestId }, $push: { history: { status: 'waiting', at: now } } });
  await audit(req, 'ABDM_FETCH_REQUESTED', { tenantId, details: { patientId: String(patient._id), mrn: patient.mrn, requestId: String(r._id), types: hiTypes.length, days, practice } });
  return AbdmFetchRequest.findOne({ tenantId, _id: r._id }).lean();
}

/** ABDM's answer to the consent request: its id (now waiting for her), or a refusal. */
export async function onConsentInit(req, tenant, body) {
  const requestId = String(body?.response?.requestId ?? '');
  if (!requestId) return;
  const r = await AbdmFetchRequest.findOne({ tenantId: tenant._id, initRequestId: requestId, status: 'requested' });
  if (!r) return;
  const id = clip(body?.consentRequest?.id, 100);
  if (body.error || !id) {
    r.status = 'failed';
    r.error = clip(body.error?.message ?? 'ABDM gave no id for the request.', 300);
  } else {
    r.status = 'waiting';
    r.consentRequestId = id;
  }
  r.history.push({ status: r.status, at: new Date() });
  await r.save();
}

// ---------- Her answer, and a consent withdrawn or ended ----------

const ANSWERS = ['GRANTED', 'DENIED', 'REVOKED', 'EXPIRED'];

/**
 * ABDM: she answered in her ABHA app (GRANTED: one consent per hospital; DENIED), or a consent was withdrawn
 * (REVOKED) or ended (EXPIRED) – its records are deleted at once. Acknowledged in every case.
 * body: { notification: { consentRequestId, status, consentArtefacts: [{ id }] } }.
 */
export async function consentNotify(req, tenant, body, { requestId = '' } = {}) {
  const client = abdmClient();
  const tenantId = tenant._id;
  const hiuId = hiuIdOf(tenant);
  const n = body?.notification ?? {};
  const consentRequestId = clip(n.consentRequestId, 100);
  const status = ANSWERS.includes(n.status) ? n.status : null;
  if (!consentRequestId || !status) throw new HttpError(400, 'A notification needs the request id and the status.', 'VALIDATION');
  const ids = [...new Set(list(n.consentArtefacts).map((a) => clip(a?.id, 100)).filter(Boolean))].slice(0, 50);
  const ack = () => client.hiuOnNotify({ hiuId, requestId, consentIds: ids });
  const r = await AbdmFetchRequest.findOne({ tenantId, consentRequestId });
  if (!r) {
    await ack();
    return null;
  }
  const now = req.now ?? new Date();
  const { who } = await patientIds(tenantId, r.patientId);
  const answered = (hospitals) => audit(req, 'ABDM_FETCH_ANSWERED', { tenantId, details: { ...who, requestId: String(r._id), status, hospitals, practice: Boolean(r.practice) } });

  if (status === 'GRANTED') {
    const open = ['requested', 'waiting', 'granted'];
    if (!open.includes(r.status)) {
      await ack(); // a late answer to a request that already ended
      return r.toObject();
    }
    // Each hospital is added by one atomic change that skips a consent already there, so the same answer arriving
    // twice (even at the same moment – ABDM may send a message again) adds it once and asks for its details once
    const added = [];
    for (const consentId of ids) {
      const one = await AbdmFetchRequest.updateOne(
        { tenantId, _id: r._id, status: { $in: open }, 'hospitals.consentId': { $ne: consentId } },
        { $push: { hospitals: { consentId, status: 'GRANTED', step: 'details', fetchRequestId: randomUUID(), expiresAt: r.expiresAt } } },
      );
      if (one.modifiedCount) added.push(consentId);
    }
    const changed = await AbdmFetchRequest.updateOne({ tenantId, _id: r._id, status: { $in: ['requested', 'waiting'] } }, { $set: { status: 'granted' }, $push: { history: { status: 'granted', at: now } } });
    await ack();
    if (!added.length && !changed.modifiedCount) return r.toObject(); // the same answer again: nothing new
    await answered(ids.length);
    for (const consentId of added) await askConsentDetails(req, tenant, r._id, consentId);
    return AbdmFetchRequest.findOne({ tenantId, _id: r._id }).lean();
  }

  if (status === 'DENIED') {
    if (['requested', 'waiting'].includes(r.status)) {
      r.status = 'denied';
      r.history.push({ status: 'denied', at: now });
      await r.save();
    }
    await ack();
    await answered(0);
    return r.toObject();
  }

  // REVOKED or EXPIRED: the consents named (every one of this request when none is named) end, and their records go
  const why = status === 'REVOKED' ? 'revoked' : 'expired';
  const ending = r.hospitals.filter((h) => !ids.length || ids.includes(h.consentId));
  for (const h of ending) h.status = status;
  if (!r.hospitals.some((h) => h.status === 'GRANTED') && ['requested', 'waiting', 'granted'].includes(r.status)) {
    r.status = why;
    r.history.push({ status: why, at: now });
  }
  await r.save();
  for (const h of ending.filter((x) => x.step !== 'deleted')) await deleteFor(req, tenantId, r, h, why, now);
  await ack();
  await answered(ending.length);
  return AbdmFetchRequest.findOne({ tenantId, _id: r._id }).lean();
}

// ---------- Each hospital's consent, and asking for its records ----------

async function askConsentDetails(req, tenant, requestDocId, consentId) {
  const client = abdmClient();
  const tenantId = tenant._id;
  const r = await AbdmFetchRequest.findOne({ tenantId, _id: requestDocId }).lean();
  const h = r?.hospitals.find((x) => x.consentId === consentId);
  if (!h) return;
  try {
    const out = await client.fetchConsent({ hiuId: hiuIdOf(tenant), requestId: h.fetchRequestId, consentId });
    // Practice mode answers at once; ABDM answers later (on-fetch)
    if (out?.consent) await onConsentDetails(req, tenant, { consent: out.consent, response: { requestId: h.fetchRequestId } });
  } catch (err) {
    await setHospital(tenantId, r._id, consentId, { step: 'failed', error: errText(err) });
  }
}

/**
 * ABDM: the details of one consent (on-fetch) – the hospital, the records in it, their kinds and dates, and until
 * when they may be kept. Checked: it is for her ABHA and for this hospital. Then the records are asked for.
 */
export async function onConsentDetails(req, tenant, body) {
  const tenantId = tenant._id;
  const practice = isPractice(abdmClient());
  const detail = body?.consent?.consentDetail ?? null;
  const consentId = clip(detail?.consentId, 100);
  const byRequest = String(body?.response?.requestId ?? '');
  const filter = consentId ? { 'hospitals.consentId': consentId } : byRequest ? { 'hospitals.fetchRequestId': byRequest } : null;
  if (!filter) return;
  const r = await AbdmFetchRequest.findOne({ tenantId, ...filter });
  const h = r?.hospitals.find((x) => (consentId ? x.consentId === consentId : x.fetchRequestId === byRequest));
  if (!h || h.step !== 'details') return;
  const now = req.now ?? new Date();
  const fail = async (error) => {
    h.step = 'failed';
    h.error = clip(error, 300);
    await r.save();
  };
  if (body.error || !detail) return fail(body.error?.message ?? 'ABDM sent no details of the consent.');
  const status = body.consent.status ?? detail.status ?? 'GRANTED';
  if (status !== 'GRANTED') {
    if (['REVOKED', 'EXPIRED'].includes(status)) h.status = status;
    return fail('The consent is no longer valid.');
  }
  // Outside practice mode the consent must name her ABHA address and this hospital (a consent that names neither is
  // not taken as hers)
  const forHer = cleanAddress(detail.patient?.id);
  if ((r.abhaAddress || !practice) && forHer !== r.abhaAddress) return fail('The consent is for another ABHA: nothing was asked for.');
  if (!practice && detail.hiu?.id !== hiuIdOf(tenant)) return fail('The consent is for another hospital: nothing was asked for.');
  h.hipId = clip(detail.hip?.id, 100);
  h.hipName = clip(detail.hip?.name || detail.hip?.id || 'Another hospital', 200);
  h.hiTypes = list(detail.hiTypes).filter((t) => FETCH_HI_TYPES.includes(t));
  h.from = dateOrNull(detail.permission?.dateRange?.from);
  h.to = dateOrNull(detail.permission?.dateRange?.to);
  h.expiresAt = earliest(dateOrNull(detail.permission?.dataEraseAt), r.expiresAt);
  h.careContexts = list(detail.careContexts)
    .map((c) => clip(c?.careContextReference, 200))
    .filter(Boolean)
    .slice(0, 500);
  await r.save();
  if (h.expiresAt <= now) return fail('The consent has already ended.');
  if (!h.careContexts.length) return fail('The consent names no records.');
  await requestData(req, tenant, r._id, h.consentId);
}

/** Asks one hospital's records, with a new key pair made for this request only. */
async function requestData(req, tenant, requestDocId, consentId) {
  const client = abdmClient();
  const practice = isPractice(client);
  const tenantId = tenant._id;
  const r = await AbdmFetchRequest.findOne({ tenantId, _id: requestDocId }).lean();
  const h = r?.hospitals.find((x) => x.consentId === consentId);
  if (!h) return;
  const now = req.now ?? new Date();
  const hiuId = hiuIdOf(tenant);
  const dataRequestId = randomUUID();
  const until = new Date(Math.min(now.getTime() + KEY_HOURS * 3600 * 1000, (h.expiresAt ?? r.expiresAt).getTime()));
  const k = requesterKeyMaterial({ expiry: until.toISOString() });
  await keepKey(dataRequestId, { privateRaw: k.privateRaw, nonce: k.nonce }, until.getTime());
  await setHospital(tenantId, r._id, consentId, { step: 'asked', dataRequestId, transactionId: '', askedAt: now, receivedAt: null, pageCount: 0, pagesReceived: [], pagesDone: [], refsReceived: [], refsFailed: [], documents: 0, files: 0, filesLeftOut: 0, withheld: 0, failedEntries: 0, error: '' });
  const dateRange = { from: (h.from ?? r.from).toISOString(), to: (h.to ?? r.to).toISOString() };
  try {
    const out = await client.requestHealthInfo({ hiuId, requestId: dataRequestId, consentId, dateRange, dataPushUrl: practice ? PRACTICE_HIU_PUSH_URL : dataPushUrl(hiuId), keyMaterial: k.keyMaterial });
    if (out?.transactionId) {
      await onDataRequested(req, tenant, { hiRequest: { transactionId: out.transactionId, sessionStatus: 'REQUESTED' }, response: { requestId: dataRequestId } });
      // Practice: the made-up hospital sends the pages now, to the same receiving code ABDM's pages go to
      if (practice) for (const page of client.practiceDeliver(out.transactionId, now)) await receivePush(req, tenant, page);
    }
  } catch (err) {
    await dropKey(dataRequestId);
    await setHospital(tenantId, r._id, consentId, { step: 'failed', error: errText(err) });
  }
}

/** ABDM's answer to "send her records" (on-request): the transfer's id, or a refusal. */
export async function onDataRequested(req, tenant, body) {
  const tenantId = tenant._id;
  const dataRequestId = String(body?.response?.requestId ?? '');
  if (!dataRequestId) return;
  const r = await AbdmFetchRequest.findOne({ tenantId, 'hospitals.dataRequestId': dataRequestId });
  const h = r?.hospitals.find((x) => x.dataRequestId === dataRequestId);
  if (!h || h.step !== 'asked' || h.transactionId) return;
  const transactionId = clip(body?.hiRequest?.transactionId, 100);
  if (body.error || !transactionId) {
    await dropKey(dataRequestId);
    h.step = 'failed';
    h.error = clip(body.error?.message ?? 'ABDM did not accept the request for her records.', 300);
  } else {
    h.transactionId = transactionId;
  }
  await r.save();
}

// ---------- The records arrive ----------

const KEY_GONE = 'These records came after the key to read them was forgotten (the server was restarted, or they came too late). Use “Fetch again”.';

/**
 * One page of her records from another hospital (the data push): each entry decrypted with this request's key,
 * read (fhirReader.js – the fetal-sex guard included) and kept under her record until her consent ends. When every
 * page has come, ABDM is told which records arrived. Returns counts: { kept, failed, duplicate }.
 */
export async function receivePush(req, tenant, body) {
  const tenantId = tenant._id;
  const transactionId = clip(body?.transactionId, 100);
  if (!transactionId) throw new HttpError(400, 'No transaction id.', 'VALIDATION');
  const r = await AbdmFetchRequest.findOne({ tenantId, hospitals: { $elemMatch: { transactionId, step: 'asked' } } }).lean();
  if (!r) throw new HttpError(404, 'No request is waiting for these records.', 'NOT_FOUND');
  const h = r.hospitals.find((x) => x.transactionId === transactionId);
  const pageNumber = Number(body.pageNumber);
  const pageCount = Number(body.pageCount);
  if (![pageNumber, pageCount].every(Number.isInteger) || pageNumber < 1 || pageCount < 1 || pageNumber > pageCount) throw new HttpError(400, 'The page number is not valid.', 'VALIDATION');
  const now = new Date();
  if (pageCount > MAX_PAGES) {
    // Said on her ABHA tab (with what to do), and ABDM told: nothing of this transfer is read
    const failed = await AbdmFetchRequest.updateOne(
      { tenantId, _id: r._id, hospitals: { $elemMatch: { transactionId, step: 'asked' } } },
      { $set: { 'hospitals.$.step': 'failed', 'hospitals.$.error': `The other hospital sent more than ${MAX_PAGES} pages at once, more than Perinexa takes in one transfer. Ask again for fewer kinds of record or a shorter period.` } },
    );
    if (failed.modifiedCount) {
      await dropKey(h.dataRequestId);
      await notifyAbdm(tenant, r, { ...h, refsReceived: [] }, now);
    }
    return { kept: 0, failed: list(body.entries).length, duplicate: false };
  }
  const ended = h.status !== 'GRANTED' || (h.expiresAt && h.expiresAt <= now);
  const key = await keyFor(h.dataRequestId);
  // The page is claimed first, so the same page sent twice (even at the same moment) is kept once
  const claimed = await AbdmFetchRequest.updateOne(
    { tenantId, _id: r._id, hospitals: { $elemMatch: { transactionId, step: 'asked', pagesReceived: { $ne: pageNumber } } } },
    { $addToSet: { 'hospitals.$.pagesReceived': pageNumber }, $set: { 'hospitals.$.pageCount': pageCount } },
  );
  if (!claimed.modifiedCount) return { kept: 0, failed: 0, duplicate: true };
  if (ended || !key) {
    await dropKey(h.dataRequestId);
    await setHospital(tenantId, r._id, h.consentId, { step: 'failed', error: ended ? 'Her consent ended before the records came: nothing was kept.' : KEY_GONE });
    await notifyAbdm(tenant, r, { ...h, refsReceived: [] }, now);
    return { kept: 0, failed: list(body.entries).length, duplicate: false };
  }
  const { careType } = await patientIds(tenantId, r.patientId);
  const guard = careType !== 'newborn'; // PC-PNDT: for every patient who is not a baby
  const allowed = new Set(h.careContexts);
  const sender = { publicKey: body.keyMaterial?.dhPublicKey?.keyValue, nonce: body.keyMaterial?.nonce };
  const counts = { documents: 0, files: 0, filesLeftOut: 0, withheld: 0, failed: 0 };
  const ok = [];
  const bad = [];
  const savedRecords = [];
  const savedFiles = [];
  for (const entry of list(body.entries).slice(0, MAX_ENTRIES_PER_PAGE)) {
    const ref = clip(entry?.careContextReference, 200);
    const files = [];
    try {
      if (!allowed.has(ref)) throw new Error('not in the consent');
      if (entry.media && entry.media !== 'application/fhir+json') throw new Error('not a FHIR document');
      const text = decryptFrom({ encryptedData: entry.content, sender, ours: key });
      if (text.length > MAX_DOCUMENT_CHARS) throw new Error('too large');
      const doc = readDocument(JSON.parse(text), { guard });
      const record = new AbdmFetchedRecord({
        tenantId,
        patientId: r.patientId,
        requestId: r._id,
        consentId: h.consentId,
        transactionId,
        hipId: h.hipId,
        hipName: h.hipName,
        careContextReference: ref,
        hiType: doc.hiType,
        typeText: doc.typeText,
        title: doc.title,
        titleWithheld: doc.titleWithheld,
        date: doc.date,
        documentStatus: doc.status,
        hospital: doc.hospital,
        authors: doc.authors,
        nameInDocument: doc.nameInDocument,
        sections: doc.sections,
        withheld: doc.withheld,
        truncated: doc.truncated,
        filesLeftOut: doc.filesLeftOut,
        checksumOk: String(entry.checksum ?? '').toLowerCase() === checksumOf(text),
        expiresAt: h.expiresAt ?? r.expiresAt,
        practice: Boolean(r.practice),
      });
      for (const f of doc.files) {
        const file = await AbdmFetchedFile.create({ tenantId, patientId: r.patientId, recordId: record._id, consentId: h.consentId, title: f.title, contentType: f.contentType, size: f.size, data: f.data, expiresAt: record.expiresAt });
        files.push(file._id);
        record.files.push({ fileId: file._id, title: f.title, contentType: f.contentType, size: f.size });
      }
      await record.save();
      savedRecords.push(record._id);
      savedFiles.push(...files);
      counts.documents += 1;
      counts.files += doc.files.length;
      counts.filesLeftOut += doc.filesLeftOut.length;
      counts.withheld += doc.withheld;
      ok.push(ref);
    } catch {
      if (files.length) await AbdmFetchedFile.deleteMany({ tenantId, _id: { $in: files } }); // a document not kept keeps no file
      counts.failed += 1;
      bad.push(ref);
    }
  }
  // Her consent may have been withdrawn (or "Fetch again" pressed) while this page was being read: what it saved is
  // deleted at once – never kept under a consent that ended
  if (!(await stillWanted(tenantId, r._id, h.consentId, transactionId))) {
    await AbdmFetchedFile.deleteMany({ tenantId, _id: { $in: savedFiles } });
    await AbdmFetchedRecord.deleteMany({ tenantId, _id: { $in: savedRecords } });
    return { kept: 0, failed: counts.failed, duplicate: false };
  }
  await AbdmFetchRequest.updateOne(
    { tenantId, _id: r._id, hospitals: { $elemMatch: { transactionId, step: 'asked' } } },
    {
      $addToSet: { 'hospitals.$.pagesDone': pageNumber, 'hospitals.$.refsReceived': { $each: ok }, 'hospitals.$.refsFailed': { $each: bad } },
      $inc: { 'hospitals.$.documents': counts.documents, 'hospitals.$.files': counts.files, 'hospitals.$.filesLeftOut': counts.filesLeftOut, 'hospitals.$.withheld': counts.withheld, 'hospitals.$.failedEntries': counts.failed },
    },
  );
  await finishIfComplete(req, tenant, r._id, transactionId, now);
  return { kept: counts.documents, failed: counts.failed, duplicate: false };
}

/** Is this hospital's transfer still one to keep records of: her consent given, not ended, and this transfer the one asked for? */
async function stillWanted(tenantId, requestDocId, consentId, transactionId) {
  const fresh = await AbdmFetchRequest.findOne({ tenantId, _id: requestDocId }, { hospitals: 1 }).lean();
  const h = fresh?.hospitals.find((x) => x.consentId === consentId);
  return Boolean(h && h.status === 'GRANTED' && h.step === 'asked' && h.transactionId === transactionId && (!h.expiresAt || h.expiresAt > new Date()));
}

/** When every page of a transfer has come: received, the key forgotten, ABDM told, and the audit log written once. */
async function finishIfComplete(req, tenant, requestDocId, transactionId, now) {
  const tenantId = tenant._id;
  const r = await AbdmFetchRequest.findOne({ tenantId, _id: requestDocId }).lean();
  const h = r?.hospitals.find((x) => x.transactionId === transactionId);
  if (!h || h.step !== 'asked' || !h.pageCount || (h.pagesDone ?? []).length < h.pageCount) return;
  // Only one page's handler finishes it (pages may arrive at the same moment)
  const won = await AbdmFetchRequest.findOneAndUpdate({ tenantId, _id: r._id, hospitals: { $elemMatch: { transactionId, step: 'asked' } } }, { $set: { 'hospitals.$.step': 'received', 'hospitals.$.receivedAt': now } });
  if (!won) return;
  await dropKey(h.dataRequestId);
  await notifyAbdm(tenant, r, h, now);
  const { who } = await patientIds(tenantId, r.patientId);
  await audit(req, 'ABDM_RECORDS_FETCHED', {
    tenantId,
    details: { ...who, requestId: String(r._id), consentId: h.consentId, transactionId, hospitals: 1, documents: h.documents, files: h.files, filesLeftOut: h.filesLeftOut, withheld: h.withheld, failed: h.failedEntries, practice: Boolean(r.practice) },
  });
}

/** Tells ABDM which records of the consent arrived (OK) and which did not (ERRORED). A failure here is logged only. */
async function notifyAbdm(tenant, r, h, now) {
  const received = new Set(h.refsReceived ?? []);
  const failed = new Set(h.refsFailed ?? []);
  try {
    await abdmClient().healthInfoNotifyHiu({
      hiuId: hiuIdOf(tenant),
      consentId: h.consentId,
      transactionId: h.transactionId,
      hipId: h.hipId,
      doneAt: now.toISOString(),
      sessionStatus: received.size ? 'TRANSFERRED' : 'FAILED',
      statusResponses: h.careContexts.map((ref) => ({ careContextReference: ref, hiStatus: received.has(ref) ? 'OK' : 'ERRORED', description: received.has(ref) ? 'Received' : failed.has(ref) ? 'Could not be read' : 'Not received' })),
    });
  } catch (err) {
    console.error('ABDM: telling ABDM what arrived failed:', err?.message ?? err);
  }
}

/** "Fetch again": one hospital's records asked for again (it failed, or nothing came for 30 minutes). */
export async function fetchAgain(req, tenant, r, consentId) {
  const h = r.hospitals.find((x) => x.consentId === consentId);
  if (!h) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  const now = req.now ?? new Date();
  if (!mayFetchAgain(r, h, now)) throw conflict('These records cannot be asked for again now.', 'NOT_NOW');
  // What came of this hospital before is replaced by what comes now
  await deleteFor(req, tenant._id, r, h, 'replaced', now);
  if (!h.careContexts.length) {
    await setHospital(tenant._id, r._id, consentId, { step: 'details', fetchRequestId: randomUUID(), error: '' });
    await askConsentDetails(req, tenant, r._id, consentId);
  } else {
    await requestData(req, tenant, r._id, consentId);
  }
  return AbdmFetchRequest.findOne({ tenantId: tenant._id, _id: r._id }).lean();
}

export function mayFetchAgain(r, h, now) {
  if (r.status !== 'granted' || h.status !== 'GRANTED' || !h.expiresAt || h.expiresAt <= now) return false;
  if (h.step === 'failed') return true;
  const since = (h.askedAt ?? r.updatedAt ?? now).getTime();
  return ['asked', 'details'].includes(h.step) && now.getTime() - since >= STUCK_MINUTES * 60 * 1000;
}

// ---------- Deleted when her consent ends ----------

/**
 * Deletes every fetched record whose consent has ended (one hospital, or one patient, or the whole hospital), and
 * marks requests she never answered whose time has passed. Each deletion is in the audit log (counts only).
 */
export async function expireDue(tenantId, now = new Date(), { patientId } = {}) {
  const req = { tenantId, now }; // the server itself (no one signed in)
  const scope = { tenantId, ...(patientId ? { patientId } : {}) };
  let deleted = 0;
  const due = await AbdmFetchRequest.find({ ...scope, hospitals: { $elemMatch: { expiresAt: { $lte: now }, step: { $ne: 'deleted' } } } });
  for (const r of due) {
    for (const h of r.hospitals) {
      if (!h.expiresAt || h.expiresAt > now || h.step === 'deleted') continue;
      if (h.status === 'GRANTED') h.status = 'EXPIRED';
      deleted += (await deleteFor(req, tenantId, r, h, 'expired', now)).documents;
    }
    const fresh = await AbdmFetchRequest.findOne({ tenantId, _id: r._id });
    for (const h of fresh.hospitals) if (h.expiresAt && h.expiresAt <= now && h.status === 'GRANTED') h.status = 'EXPIRED';
    if (fresh.status === 'granted' && !fresh.hospitals.some((h) => h.status === 'GRANTED')) {
      fresh.status = 'expired';
      fresh.history.push({ status: 'expired', at: now });
    }
    await fresh.save();
  }
  // A request she never answered (or agreed to when no hospital had records), past the time the consent would last
  await AbdmFetchRequest.updateMany({ ...scope, status: { $in: ['requested', 'waiting'] }, expiresAt: { $lte: now } }, { $set: { status: 'expired' }, $push: { history: { status: 'expired', at: now } } });
  await AbdmFetchRequest.updateMany({ ...scope, status: 'granted', hospitals: { $size: 0 }, expiresAt: { $lte: now } }, { $set: { status: 'expired' }, $push: { history: { status: 'expired', at: now } } });
  // A second guard: anything kept under a consent that has ended or was withdrawn, or of an earlier transfer
  deleted += await deleteNotLive(req, tenantId, scope, now);
  // A third guard: anything kept past its time, whatever its request says
  const left = await AbdmFetchedRecord.find({ ...scope, expiresAt: { $lte: now } }, { consentId: 1, requestId: 1, patientId: 1 }).lean();
  for (const consentId of new Set(left.map((x) => x.consentId))) {
    const one = left.find((x) => x.consentId === consentId);
    const counts = await removeDocuments(tenantId, consentId);
    deleted += counts.documents;
    const { who } = await patientIds(tenantId, one.patientId);
    await audit(req, 'ABDM_FETCHED_DELETED', { tenantId, details: { ...who, requestId: String(one.requestId), consentId, why: 'expired', documents: counts.documents, files: counts.files } });
  }
  await AbdmFetchedFile.deleteMany({ ...scope, expiresAt: { $lte: now } });
  return deleted;
}

// ---------- Which records may be kept and shown: her consent still given, and the transfer the one asked for ----------

const transferKey = (consentId, transactionId) => `${consentId}\n${transactionId}`;

/** The hospitals' entries of the requests that hold these consents: Map(consentId -> entry). */
async function entriesFor(tenantId, consentIds) {
  if (!consentIds.length) return new Map();
  const requests = await AbdmFetchRequest.find({ tenantId, 'hospitals.consentId': { $in: consentIds } }, { hospitals: 1 }).lean();
  return new Map(requests.flatMap((r) => r.hospitals.filter((h) => consentIds.includes(h.consentId)).map((h) => [h.consentId, h])));
}
/** May records of this hospital's entry be kept and shown now (with this transfer)? */
const live = (h, transactionId, now) => Boolean(h && h.status === 'GRANTED' && h.step !== 'deleted' && h.transactionId && h.transactionId === transactionId && (!h.expiresAt || h.expiresAt > now));

/** The consents and transfers whose records may be shown now: Set of transferKey. */
async function liveTransfers(tenantId, records, now) {
  const entries = await entriesFor(tenantId, [...new Set(records.map((d) => d.consentId))]);
  return new Set(records.filter((d) => live(entries.get(d.consentId), d.transactionId, now)).map((d) => transferKey(d.consentId, d.transactionId)));
}

/**
 * Deletes what is kept under a consent no longer given (withdrawn, ended, or its entry deleted) or of a transfer that
 * is not the one asked for now – e.g. a page that was still being read when she withdrew her consent. Returns the
 * number of documents deleted; each deletion is in the audit log (counts only).
 */
async function deleteNotLive(req, tenantId, scope, now) {
  const consentIds = await AbdmFetchedRecord.distinct('consentId', scope);
  if (!consentIds.length) return 0;
  const entries = await entriesFor(tenantId, consentIds);
  let deleted = 0;
  for (const consentId of consentIds) {
    const h = entries.get(consentId);
    const stale = await AbdmFetchedRecord.find({ ...scope, consentId }, { transactionId: 1, requestId: 1, patientId: 1 }).lean();
    const gone = stale.filter((d) => !live(h, d.transactionId, now));
    if (!gone.length) continue;
    const ids = gone.map((d) => d._id);
    const files = await AbdmFetchedFile.countDocuments({ tenantId, recordId: { $in: ids } });
    await AbdmFetchedFile.deleteMany({ tenantId, recordId: { $in: ids } });
    await AbdmFetchedRecord.deleteMany({ tenantId, _id: { $in: ids } });
    deleted += ids.length;
    const why = h?.status === 'REVOKED' ? 'revoked' : h?.status === 'EXPIRED' || !h ? 'expired' : 'replaced';
    const { who } = await patientIds(tenantId, gone[0].patientId);
    await audit(req, 'ABDM_FETCHED_DELETED', { tenantId, details: { ...who, requestId: String(gone[0].requestId), consentId, why, documents: ids.length, files } });
  }
  return deleted;
}

/** Every hospital: the round run when the server starts and every 15 minutes (index.js). */
export async function expireAllDue(now = new Date()) {
  let deleted = 0;
  for (const t of await Tenant.find({}, { _id: 1 }).lean()) {
    try {
      deleted += await expireDue(t._id, now);
    } catch (err) {
      console.error('ABDM: deleting ended records failed for a hospital:', err?.message ?? err);
    }
  }
  return deleted;
}

// ---------- What the doctor sees ----------

const hospitalView = (r, h, now) => ({
  consentId: h.consentId,
  hipName: h.hipName || 'Another hospital',
  status: h.status,
  step: h.step,
  hiTypes: h.hiTypes,
  from: h.from,
  to: h.to,
  expiresAt: h.expiresAt,
  records: h.careContexts.length,
  documents: h.documents,
  files: h.files,
  filesLeftOut: h.filesLeftOut,
  withheld: h.withheld,
  failed: h.failedEntries,
  error: h.error || null,
  askedAt: h.askedAt,
  receivedAt: h.receivedAt,
  deletedAt: h.deletedAt,
  deletedWhy: h.deletedWhy || null,
  canFetchAgain: mayFetchAgain(r, h, now),
});

const requestView = (r, now) => ({
  id: String(r._id),
  agreed: (r.history ?? []).some((x) => x.status === 'granted'), // she agreed (even when no hospital had records)
  at: r.asked.at,
  byName: r.asked.byName,
  purpose: r.purpose?.text || 'Care management',
  hiTypes: r.hiTypes,
  from: r.from,
  to: r.to,
  days: r.days,
  expiresAt: r.expiresAt,
  status: r.status,
  error: r.error || null,
  practice: Boolean(r.practice),
  hospitals: r.hospitals.map((h) => hospitalView(r, h, now)),
});

const summaryView = (d) => ({
  id: String(d._id),
  hiType: d.hiType,
  typeText: d.typeText,
  title: d.title,
  date: d.date,
  documentStatus: d.documentStatus || '',
  hospital: d.hipName || d.hospital || 'Another hospital',
  receivedAt: d.createdAt,
  expiresAt: d.expiresAt,
  withheld: d.withheld,
  files: d.files.length,
  filesLeftOut: d.filesLeftOut.length,
  practice: Boolean(d.practice),
});

/** Her requests and the documents received (without their content) – the old ones deleted first. */
export async function fetchPage(tenantId, patient, now = new Date()) {
  await expireDue(tenantId, now, { patientId: patient._id });
  const [requests, kept] = await Promise.all([
    AbdmFetchRequest.find({ tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(50).lean(),
    AbdmFetchedRecord.find({ tenantId, patientId: patient._id, expiresAt: { $gt: now } }, { sections: 0 }).sort({ date: -1, createdAt: -1 }).limit(500).lean(),
  ]);
  // Only while her consent is given (never a document of a consent that has ended, even before it is deleted)
  const shown = await liveTransfers(tenantId, kept, now);
  const documents = kept.filter((d) => shown.has(transferKey(d.consentId, d.transactionId)));
  return { requests: requests.map((r) => requestView(r, now)), documents: documents.map(summaryView) };
}

/** One document to read: its facts and its sections – the fetal-sex guard run again on what is shown. */
export async function fetchedDocument(tenantId, patient, recordId, now = new Date()) {
  await expireDue(tenantId, now, { patientId: patient._id });
  const d = await AbdmFetchedRecord.findOne({ tenantId, patientId: patient._id, _id: recordId, expiresAt: { $gt: now } }).lean();
  if (!d || !(await liveTransfers(tenantId, [d], now)).size) throw new HttpError(404, 'This document is not here any more: her consent has ended, or it was withdrawn.', 'NOT_FOUND');
  const guard = patient.careType !== 'newborn';
  let withheld = d.withheld;
  const sections = d.sections.map((s) => {
    const title = guardText(s.title, guard);
    const lines = s.lines.map((l) => {
      const g = guardText(l.text, guard);
      withheld += g.withheld;
      return { text: g.text, withheld: l.withheld + g.withheld, sub: l.sub };
    });
    withheld += title.withheld;
    return { title: title.withheld ? 'Section' : title.text, lines };
  });
  return {
    ...summaryView(d),
    withheld,
    documentHospital: d.hospital,
    authors: d.authors,
    nameInDocument: d.nameInDocument,
    titleWithheld: d.titleWithheld,
    sections,
    truncated: d.truncated,
    checksumOk: d.checksumOk,
    files: d.files.map((f) => ({ id: String(f.fileId), title: f.title, contentType: f.contentType, size: f.size })),
    filesLeftOut: d.filesLeftOut.map((f) => ({ title: f.title, contentType: f.contentType, why: f.why })),
  };
}

/** One attached file of a document (a PDF or a photo) to download. */
export async function fetchedFile(tenantId, patient, recordId, fileId, now = new Date()) {
  await expireDue(tenantId, now, { patientId: patient._id });
  const d = await AbdmFetchedRecord.findOne({ tenantId, patientId: patient._id, _id: recordId }, { consentId: 1, transactionId: 1 }).lean();
  const f = d && (await liveTransfers(tenantId, [d], now)).size ? await AbdmFetchedFile.findOne({ tenantId, patientId: patient._id, recordId, _id: fileId, expiresAt: { $gt: now } }) : null;
  if (!f) throw new HttpError(404, 'This file is not here any more: her consent has ended, or it was withdrawn.', 'NOT_FOUND');
  return f;
}

// ---------- Practice mode: the control that stands in for her ABHA app ----------

const practiceOnly = (client) => {
  if (!isPractice(client)) throw conflict('Only in practice mode.', 'NOT_PRACTICE');
};

/** Practice: she agrees (or refuses) in her ABHA app. Agreeing brings the made-up hospitals' records at once. */
export async function practiceAnswer(req, tenant, r, approve) {
  const client = abdmClient();
  practiceOnly(client);
  if (r.status !== 'waiting') throw conflict('She has already answered this request.', 'ANSWERED');
  const body = client.practiceAnswer(r.consentRequestId, approve, req.now ?? new Date());
  return consentNotify(req, tenant, body, { requestId: randomUUID() });
}

/** Practice: she withdraws her consent, or it ends – the records are deleted at once. */
export async function practiceEnd(req, tenant, r, status) {
  const client = abdmClient();
  practiceOnly(client);
  if (r.status !== 'granted') throw conflict('This consent is not in force.', 'NOT_GRANTED');
  return consentNotify(req, tenant, client.practiceEnd(r.consentRequestId, status), { requestId: randomUUID() });
}
