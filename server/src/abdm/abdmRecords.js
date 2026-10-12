// ABDM milestone M2 – the hospital as a Health Information Provider (HIP): her records linked to her ABHA, and sent
// to another hospital or app when she consents in her ABHA app. Works the same in practice mode (practiceClient.js –
// nothing leaves this computer) and with ABDM's V3 APIs (v3Client.js – not yet tried against ABDM).
//
//  - Linking: by the hospital ("Link to ABHA" on her ABHA tab, her agreement recorded), or from her ABHA app
//    (discovery → she picks records → an OTP to the mobile number on her record → linked).
//  - Her ABHA app's discovery finds her ONLY through the ABHA linked to her record at this hospital (verified with an
//    OTP at the desk) – never by name, mobile number or year of birth, so nobody learns that someone else is a patient
//    here.
//  - Consents from ABDM are kept with their dates, types and expiry; every request for data is checked against its
//    consent (withdrawn, expired, unknown or outside its dates: nothing is sent), and every record against the
//    hospital's own rules again (shareRules.js) – at the moment it would be sent.
//  - What is sent: FHIR documents (fhirRecords.js), encrypted for the requester (fidelius.js), one document per page,
//    each page with its own key pair and nonce (so a key and IV are never used twice).
//  - The audit log: ids and counts and the consent id – never what was sent.

import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { toHospitalDate } from '../careplans/dates.js';
import { AbdmCareContext } from '../models/AbdmCareContext.js';
import { AbdmConsent } from '../models/AbdmConsent.js';
import { AbdmLinkRequest } from '../models/AbdmLinkRequest.js';
import { AbdmTransfer } from '../models/AbdmTransfer.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { mobileNumber } from '../reminders/phone.js';
import { currentSender } from '../reminders/sender.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { abhaAddress as cleanAddress, abhaNumber } from './abhaFormat.js';
import { abdmClient } from './abdmService.js';
import { checksumOf, encryptFor } from './fidelius.js';
import { dischargeDocuments, labDocuments, visitDocuments } from './fhirRecords.js';
import { PRACTICE_HIU, PRACTICE_OTP, PRACTICE_PUSH_URL } from './practiceClient.js';
import { pushAddressAllowed } from './v3Client.js';
import { HI_TYPES, dischargeRecord, labRecord, parseReference, patientBlock, recordsOf, visitRecord, withPatientRules, withinRange } from './shareRules.js';

const OTP_MINUTES = 10;
const OTP_TRIES = 5;
const OFFER_MINUTES = 30; // her app's search (discovery) is continued within this time, or looked for again
const WAITING_MINUTES = 30; // records sent to ABDM to link with no answer for this long may be linked again
const MINUTE = 60 * 1000;
const conflict = (message, code = 'CONFLICT') => new HttpError(409, message, code);
const isPractice = (client) => client.mode === 'practice';
const errorOf = (code, message) => ({ code, message });

// ---------- Her records ----------

async function loadSources(tenantId, patientId) {
  const [visits, orders, discharges] = await Promise.all([
    Visit.find({ tenantId, patientId }).lean(),
    LabOrder.find({ tenantId, patientId }).lean(),
    ClinicalDocument.find({ tenantId, patientId, kind: 'discharge' }).lean(),
  ]);
  return { visits, orders, discharges };
}

/** One record by its reference (only on THIS patient's record, with her record's own rules): { record, source } or null. */
async function loadOne(tenantId, patient, reference) {
  const r = parseReference(reference);
  if (!r) return null;
  const patientId = patient._id;
  let one = null;
  if (r.kind === 'visit') {
    const v = await Visit.findOne({ tenantId, patientId, _id: r.id }).lean();
    one = v ? { record: visitRecord(v), source: v } : null;
  } else if (r.kind === 'lab') {
    const o = await LabOrder.findOne({ tenantId, patientId, _id: r.id }).lean();
    one = o ? { record: labRecord(o), source: o } : null;
  } else {
    const d = await ClinicalDocument.findOne({ tenantId, patientId, _id: r.id, kind: 'discharge' }).lean();
    one = d ? { record: dischargeRecord(d), source: d } : null;
  }
  return one && { ...one, record: withPatientRules(patient, one.record) };
}

/** Is this link to her CURRENT ABHA (her record may have had another one since)? */
const linkedToCurrent = (link, patient) => link?.status === 'linked' && Boolean(patient.abha?.number) && link.abhaNumber === patient.abha.number;

/** Sent to ABDM to be linked to her current ABHA, and ABDM may still answer (no answer for 30 minutes: link it again). */
const waitingNow = (link, patient, now) =>
  link?.status === 'waiting' && link.abhaNumber === patient.abha?.number && now.getTime() - new Date(link.updatedAt ?? link.createdAt ?? 0).getTime() < WAITING_MINUTES * MINUTE;

const linkView = (l, patient, now) =>
  l
    ? {
        // no_answer: ABDM did not answer for 30 minutes – the record may be linked again
        status: l.status === 'waiting' && !waitingNow(l, patient, now) ? 'no_answer' : l.status,
        via: l.via,
        byName: l.agreement?.byName ?? '',
        at: l.linkedAt ?? l.createdAt ?? null,
        error: l.error ?? '',
        earlierAbha: Boolean(patient.abha?.number) && l.abhaNumber !== patient.abha.number,
        practice: Boolean(l.practice),
      }
    : null;

const transferView = (t) => ({
  id: String(t._id),
  at: t.createdAt,
  status: t.status,
  refusal: t.refusal || null,
  records: (t.careContexts ?? []).filter((c) => c.delivered).length,
  heldBack: (t.careContexts ?? []).filter((c) => !c.delivered).length,
  documents: t.documents ?? 0,
  error: t.error || null,
  practice: Boolean(t.practice),
});

const consentView = (c, transfers, now) => ({
  id: String(c._id),
  consentId: c.consentId,
  status: c.status === 'GRANTED' && c.expiresAt && c.expiresAt <= now ? 'EXPIRED' : c.status,
  hiu: c.hiu?.name || c.hiu?.id || '',
  purpose: c.purpose?.text || c.purpose?.code || '',
  hiTypes: c.hiTypes ?? [],
  from: c.from,
  to: c.to,
  expiresAt: c.expiresAt,
  records: (c.careContexts ?? []).length,
  receivedAt: c.createdAt,
  practice: Boolean(c.practice),
  transfers: transfers.filter((t) => t.consentId === c.consentId).map(transferView),
});

/** Her records, what is linked, and the consents and transfers – for her ABHA tab (doctors and RMOs). */
export async function recordsPage(tenantId, patient, now = new Date()) {
  const sources = await loadSources(tenantId, patient._id);
  const links = await AbdmCareContext.find({ tenantId, patientId: patient._id }).lean();
  const byRef = new Map(links.map((l) => [l.reference, l]));
  const items = recordsOf(patient, sources).map((r) => ({
    reference: r.reference,
    kind: r.kind,
    date: r.date,
    display: r.display,
    hiTypes: r.hiTypes,
    state: r.state,
    reason: r.reason,
    confidentialLeftOut: r.confidentialLeftOut ?? 0,
    link: linkView(byRef.get(r.reference), patient, now),
  }));
  const [consents, transfers] = await Promise.all([
    AbdmConsent.find({ tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(50).lean(),
    AbdmTransfer.find({ tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);
  return { block: patientBlock(patient), items, consents: consents.map((c) => consentView(c, transfers, now)) };
}

// ---------- Linking by the hospital ----------

const patientRefOf = (p) => ({ reference: p.mrn, display: p.fullName });
const abhaOf = (p) => ({ number: p.abha.number, address: p.abha.address ?? '', name: p.abha.nameOnAbha || p.fullName, gender: p.abha.genderOnAbha || '', yearOfBirth: p.abha.yearOfBirthOnAbha ?? null });
const clip300 = (text) => String(text).slice(0, 300);
/** Why the records were not linked, when asking ABDM failed (said on her ABHA tab). */
const notLinked = (err) => clip300(`Not linked: ${err instanceof HttpError ? err.message : 'ABDM could not be reached.'}`);
/** ABDM's own refusal, in words. */
const abdmRefused = (message) => clip300(`ABDM refused: ${String(message ?? 'no reason given').replace(/\.$/, '')}.`);
const BLOCK_WORDS = {
  sensitive_record: 'Her record is marked sensitive: nothing from it is linked to her ABHA or shared through ABDM.',
  no_abha: 'Link her ABHA to her record first.',
};

/**
 * "Link to ABHA": the chosen records (references) are linked to her ABHA, with her agreement recorded by this person.
 * Each must be ready to share now (shareRules.js); one already linked to her current ABHA is left as it is.
 */
export async function linkByHospital(req, patient, references) {
  const block = patientBlock(patient);
  if (block) throw conflict(BLOCK_WORDS[block], block === 'no_abha' ? 'NOT_LINKED' : 'SENSITIVE');
  const tenantId = req.tenantId;
  const client = abdmClient();
  const practice = isPractice(client);
  const tenant = await Tenant.findById(tenantId, { name: 1, abdm: 1 }).lean();
  const hipId = tenant?.abdm?.hipId ?? '';
  if (!practice && !hipId) throw conflict("The hospital's HIP ID is not set yet (Hospital admin → ABDM).", 'NO_HIP_ID');
  if (!practice && (!patient.abha.genderOnAbha || !patient.abha.yearOfBirthOnAbha)) {
    throw conflict('ABDM needs the gender and year of birth on her ABHA: verify her ABHA again (above), then link her records.', 'VERIFY_AGAIN');
  }

  const now = req.now ?? new Date();
  const records = new Map(recordsOf(patient, await loadSources(tenantId, patient._id)).map((r) => [r.reference, r]));
  const existing = new Map((await AbdmCareContext.find({ tenantId, patientId: patient._id, reference: { $in: references } }).lean()).map((l) => [l.reference, l]));
  const chosen = [];
  for (const ref of new Set(references)) {
    const r = records.get(ref);
    if (!r) throw new HttpError(404, 'One of these records is not on her record.', 'NOT_FOUND');
    if (r.state !== 'ready') throw conflict(`${r.display} cannot be linked to her ABHA.`, 'NOT_SHAREABLE');
    const e = existing.get(ref);
    if (waitingNow(e, patient, now)) continue; // already on its way
    if (linkedToCurrent(e, patient)) continue;
    chosen.push(r);
  }
  if (!chosen.length) throw conflict('These records are already linked to her ABHA.', 'ALREADY_LINKED');

  // Saved as waiting, with the request id, BEFORE ABDM is asked: its answer (on-generate-token) may come before the
  // call returns, and must find them
  const requestId = randomUUID();
  for (const r of chosen) {
    await AbdmCareContext.updateOne(
      { tenantId, reference: r.reference },
      {
        $set: {
          patientId: patient._id,
          kind: r.kind,
          sourceId: r.sourceId,
          display: r.display,
          hiTypes: r.hiTypes,
          recordDate: r.date,
          abhaNumber: patient.abha.number,
          abhaAddress: patient.abha.address ?? '',
          status: 'waiting',
          via: 'hospital',
          agreement: { by: req.user._id, byName: req.user.name, at: now },
          linkedAt: null,
          requestId,
          step: 'token',
          error: '',
          practice,
        },
      },
      { upsert: true },
    );
  }
  let out;
  try {
    out = await client.startLink({ hipId, requestId, abha: abhaOf(patient), patient: patientRefOf(patient), careContexts: chosen });
  } catch (err) {
    await AbdmCareContext.updateMany({ tenantId, requestId, status: 'waiting' }, { $set: { status: 'failed', step: '', error: notLinked(err) } });
    throw err;
  }
  // Practice mode links at once; ABDM answers later (on-generate-token, then on_carecontext)
  const status = out?.status === 'linked' ? 'linked' : 'waiting';
  if (status === 'linked') await AbdmCareContext.updateMany({ tenantId, requestId, status: 'waiting' }, { $set: { status: 'linked', linkedAt: now, requestId: '', step: '' } });
  await audit(req, 'ABDM_RECORDS_LINKED', { details: { patientId: String(patient._id), mrn: patient.mrn, records: chosen.length, via: 'hospital', status, practice } });
  return { linked: chosen.length, status };
}

/** ABDM's answer with the link token (sandbox or production): the waiting records are sent to be linked. */
export async function onLinkToken(req, tenant, body) {
  const requestId = body?.response?.requestId ?? '';
  if (!requestId) return;
  const rows = await AbdmCareContext.find({ tenantId: tenant._id, requestId, status: 'waiting', step: 'token' }).lean();
  if (!rows.length) return;
  const fail = (error) => AbdmCareContext.updateMany({ tenantId: tenant._id, requestId, status: 'waiting' }, { $set: { status: 'failed', step: '', error: clip300(error) } });
  if (body.error || !body.linkToken) return fail(abdmRefused(body.error?.message ?? 'it gave no link token'));
  const patient = await Patient.findOne({ tenantId: tenant._id, _id: rows[0].patientId }).lean();
  // Checked again: her record may have been marked sensitive, or her ABHA changed, while ABDM was answering
  if (!patient || patientBlock(patient) || patient.abha.number !== rows[0].abhaNumber) return fail('Not linked: her record changed meanwhile.');
  const careContexts = [];
  for (const row of rows) {
    const one = await loadOne(tenant._id, patient, row.reference);
    if (one?.record.state === 'ready') careContexts.push(one.record);
  }
  if (!careContexts.length) return fail('Not linked: the records can no longer be shared.');
  const refs = careContexts.map((c) => c.reference);
  await AbdmCareContext.updateMany({ tenantId: tenant._id, requestId, status: 'waiting', reference: { $nin: refs } }, { $set: { status: 'failed', step: '', error: 'Not linked: the record can no longer be shared.' } });
  // The new request id is saved BEFORE ABDM is asked: its answer (on_carecontext) may come before the call returns
  const linkRequestId = randomUUID();
  await AbdmCareContext.updateMany({ tenantId: tenant._id, requestId, status: 'waiting', reference: { $in: refs } }, { $set: { requestId: linkRequestId, step: 'link' } });
  try {
    await abdmClient().linkWithToken({ hipId: tenant.abdm?.hipId ?? '', requestId: linkRequestId, linkToken: body.linkToken, abha: abhaOf(patient), patient: patientRefOf(patient), careContexts });
  } catch (err) {
    await AbdmCareContext.updateMany({ tenantId: tenant._id, requestId: linkRequestId, status: 'waiting' }, { $set: { status: 'failed', step: '', error: notLinked(err) } });
  }
}

/** ABDM's answer to "link these records" (sandbox or production). */
export async function onLinkResult(req, tenant, body) {
  const requestId = body?.response?.requestId ?? '';
  if (!requestId) return;
  const rows = await AbdmCareContext.find({ tenantId: tenant._id, requestId, status: 'waiting', step: 'link' }).lean();
  if (!rows.length) return;
  const ok = !body.error;
  await AbdmCareContext.updateMany(
    { tenantId: tenant._id, requestId, status: 'waiting' },
    { $set: ok ? { status: 'linked', step: '', linkedAt: new Date(), error: '' } : { status: 'failed', step: '', error: abdmRefused(body.error?.message) } },
  );
  const patient = await Patient.findOne({ tenantId: tenant._id, _id: rows[0].patientId }, { mrn: 1 }).lean();
  await audit(req, 'ABDM_RECORDS_LINKED', { tenantId: tenant._id, details: { patientId: String(rows[0].patientId), mrn: patient?.mrn, records: rows.length, via: 'hospital', status: ok ? 'linked' : 'refused' } });
}

// ---------- Her ABHA app finds and links her records (discovery) ----------

/** The patient of this hospital whose record has this ABHA (number, or else address); null when none. */
async function patientByAbha(tenantId, number, address) {
  if (number) return Patient.findOne({ tenantId, 'abha.number': number }).lean();
  if (address) return Patient.findOne({ tenantId, 'abha.address': address }).lean();
  return null;
}

/** Records she may link now from her app: ready to share, and not linked to her current ABHA (or on their way). */
async function linkableRecords(tenantId, patient, now) {
  if (patientBlock(patient)) return [];
  const links = new Map((await AbdmCareContext.find({ tenantId, patientId: patient._id }).lean()).map((l) => [l.reference, l]));
  return recordsOf(patient, await loadSources(tenantId, patient._id)).filter((r) => {
    const l = links.get(r.reference);
    return r.state === 'ready' && !linkedToCurrent(l, patient) && !waitingNow(l, patient, now);
  });
}

const NOT_FOUND_HERE = errorOf('ABDM-1010', 'No records were found for this ABHA at this hospital.');

/**
 * ABDM: "which records do you have for this ABHA?" body: { transactionId, patient: { id, verifiedIdentifiers } }.
 * Returns what was answered ({ offered, error }).
 */
export async function discover(req, tenant, body, { requestId = '' } = {}) {
  const client = abdmClient();
  const practice = isPractice(client);
  const hipId = tenant.abdm?.hipId ?? '';
  const transactionId = String(body?.transactionId ?? '');
  const ids = body?.patient?.verifiedIdentifiers ?? [];
  const number = abhaNumber(ids.find((i) => /ABHA_NUMBER|HEALTH_ID_NUMBER|NDHM_HEALTH_NUMBER/i.test(i.type ?? ''))?.value);
  const address = cleanAddress(body?.patient?.id);
  const patient = transactionId ? await patientByAbha(tenant._id, number, address) : null;
  // A record of another ABHA (the same address on two records cannot happen: one record per ABHA)
  const offered = patient ? await linkableRecords(tenant._id, patient, req.now ?? new Date()) : [];
  if (!patient || !offered.length) {
    await client.onDiscover({ hipId, requestId, transactionId, error: patient ? errorOf('ABDM-1010', 'No new records to link at this hospital.') : NOT_FOUND_HERE });
    await audit(req, 'ABDM_RECORDS_DISCOVERED', { tenantId: tenant._id, details: patient ? { patientId: String(patient._id), mrn: patient.mrn, offered: 0, found: true, practice } : { offered: 0, found: false, practice } });
    return { offered: [], error: patient ? 'No new records to link at this hospital.' : NOT_FOUND_HERE.message };
  }
  await AbdmLinkRequest.create({ tenantId: tenant._id, transactionId, patientId: patient._id, abhaAddress: address ?? patient.abha?.address ?? '', offered: offered.map((r) => r.reference), practice });
  await client.onDiscover({ hipId, requestId, transactionId, patient: patientRefOf(patient), careContexts: offered, matchedBy: [number ? 'ABHA_NUMBER' : 'ABHA_ADDRESS'] });
  await audit(req, 'ABDM_RECORDS_DISCOVERED', { tenantId: tenant._id, details: { patientId: String(patient._id), mrn: patient.mrn, offered: offered.length, found: true, practice } });
  return { offered: offered.map((r) => ({ reference: r.reference, display: r.display, hiTypes: r.hiTypes })), error: null };
}

const otpHash = (transactionId, otp) => createHash('sha256').update(`${transactionId}:${otp}`).digest('hex');

/**
 * Her app asks to link some of the records offered: an OTP goes to the mobile number on her record (practice mode:
 * shown on screen). body: { transactionId, patient: [{ referenceNumber, careContexts: [{ referenceNumber }] }] }.
 */
export async function linkInit(req, tenant, body, { requestId = '' } = {}) {
  const client = abdmClient();
  const practice = isPractice(client);
  const hipId = tenant.abdm?.hipId ?? '';
  const transactionId = String(body?.transactionId ?? '');
  const answer = async (error) => {
    await client.onLinkInit({ hipId, requestId, transactionId, error });
    return { error: error.message };
  };
  const lr = transactionId ? await AbdmLinkRequest.findOne({ tenantId: tenant._id, transactionId, status: 'offered' }) : null;
  const now = req.now ?? new Date();
  // A search is continued within 30 minutes (an old one is never used to send an OTP)
  if (!lr || now.getTime() - new Date(lr.createdAt ?? 0).getTime() > OFFER_MINUTES * MINUTE) {
    if (lr) {
      lr.status = 'failed';
      await lr.save();
    }
    return answer(errorOf('ABDM-1011', 'This search has expired. Please look for the records again.'));
  }
  const patient = await Patient.findOne({ tenantId: tenant._id, _id: lr.patientId }).lean();
  const groups = Array.isArray(body?.patient) ? body.patient : [body?.patient].filter(Boolean);
  const chosen = [...new Set(groups.flatMap((g) => (g.referenceNumber === patient?.mrn ? (g.careContexts ?? []).map((c) => c.referenceNumber) : [])))];
  if (!patient || !chosen.length || chosen.some((ref) => !lr.offered.includes(ref))) return answer(errorOf('ABDM-1011', 'These records were not offered for linking.'));

  const otp = practice ? PRACTICE_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
  if (!practice) {
    // A real OTP goes by SMS to the mobile number on her record – never written anywhere
    const to = mobileNumber(patient.phone);
    const sender = currentSender();
    if (!to || !sender?.channels.includes('sms')) {
      lr.status = 'failed';
      await lr.save();
      return answer(errorOf('ABDM-1012', 'This hospital cannot send an OTP to her mobile number. She can ask at the reception desk to link her records.'));
    }
    try {
      await sender.send({ channel: 'sms', to, text: `${tenant.name}: ${otp} is your OTP to link your records at this hospital to your ABHA. It is valid for ${OTP_MINUTES} minutes. Do not share it with anyone.` });
    } catch {
      return answer(errorOf('ABDM-1012', 'The OTP could not be sent. Please try again in a moment.'));
    }
  }
  const until = new Date(now.getTime() + OTP_MINUTES * MINUTE);
  lr.chosen = chosen;
  lr.linkRef = randomUUID();
  lr.otpHash = otpHash(transactionId, otp);
  lr.otpUntil = until;
  lr.tries = 0;
  lr.status = 'otp_sent';
  await lr.save();
  await client.onLinkInit({ hipId, requestId, transactionId, linkRef: lr.linkRef, expiry: until.toISOString() });
  return { linkRef: lr.linkRef, error: null, ...(practice ? { practiceOtp: PRACTICE_OTP } : {}) };
}

/** She typed the OTP in her app: the records are linked (each checked again now). body: { confirmation: { linkRefNumber, token } }. */
export async function linkConfirm(req, tenant, body, { requestId = '' } = {}) {
  const client = abdmClient();
  const practice = isPractice(client);
  const hipId = tenant.abdm?.hipId ?? '';
  const answer = async (error) => {
    await client.onLinkConfirm({ hipId, requestId, error });
    return { linked: 0, error: error.message };
  };
  const linkRef = String(body?.confirmation?.linkRefNumber ?? '');
  const lr = linkRef ? await AbdmLinkRequest.findOne({ tenantId: tenant._id, linkRef, status: 'otp_sent' }) : null;
  if (!lr) return answer(errorOf('ABDM-1013', 'This link request has expired. Please start again in the ABHA app.'));
  const now = req.now ?? new Date();
  if (!lr.otpUntil || lr.otpUntil <= now || lr.tries >= OTP_TRIES) {
    lr.status = 'failed';
    lr.otpHash = '';
    await lr.save();
    return answer(errorOf('ABDM-1013', 'The OTP has expired. Please start again in the ABHA app.'));
  }
  const given = Buffer.from(otpHash(lr.transactionId, String(body?.confirmation?.token ?? '')), 'hex');
  if (!timingSafeEqual(given, Buffer.from(lr.otpHash, 'hex'))) {
    lr.tries += 1;
    if (lr.tries >= OTP_TRIES) {
      lr.status = 'failed';
      lr.otpHash = '';
    }
    await lr.save();
    return answer(errorOf('ABDM-1014', 'The OTP is not correct.'));
  }
  const patient = await Patient.findOne({ tenantId: tenant._id, _id: lr.patientId }).lean();
  const linkable = patient ? new Map((await linkableRecords(tenant._id, patient, now)).map((r) => [r.reference, r])) : new Map();
  const records = lr.chosen.map((ref) => linkable.get(ref)).filter(Boolean);
  lr.status = records.length ? 'linked' : 'failed';
  lr.otpHash = '';
  await lr.save();
  if (!records.length) return answer(errorOf('ABDM-1015', 'These records can no longer be linked.'));
  for (const r of records) {
    await AbdmCareContext.updateOne(
      { tenantId: tenant._id, reference: r.reference },
      {
        $set: {
          patientId: patient._id,
          kind: r.kind,
          sourceId: r.sourceId,
          display: r.display,
          hiTypes: r.hiTypes,
          recordDate: r.date,
          abhaNumber: patient.abha.number,
          abhaAddress: lr.abhaAddress || patient.abha.address || '',
          status: 'linked',
          via: 'patient',
          agreement: { by: null, byName: '', at: now },
          linkedAt: now,
          requestId: '',
          step: '',
          error: '',
          practice,
        },
      },
      { upsert: true },
    );
  }
  await client.onLinkConfirm({ hipId, requestId, patient: patientRefOf(patient), careContexts: records });
  await audit(req, 'ABDM_RECORDS_LINKED', { tenantId: tenant._id, details: { patientId: String(patient._id), mrn: patient.mrn, records: records.length, via: 'patient', status: 'linked', practice } });
  return { linked: records.length, error: null };
}

// ---------- Consents ----------

const CONSENT_STATUSES = ['GRANTED', 'REVOKED', 'EXPIRED', 'DENIED'];
/** A consent withdrawn, expired or refused stays so: a later "granted" (ABDM repeats messages) never brings it back. */
const FINAL = ['REVOKED', 'EXPIRED', 'DENIED'];
const dateOrNull = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const latest = (...dates) => dates.filter(Boolean).sort((a, b) => b - a)[0] ?? null;
const earliest = (...dates) => dates.filter(Boolean).sort((a, b) => a - b)[0] ?? null;

/**
 * The patient a consent is about: the record its references name (her patient number) AND whose ABHA it names – her
 * ABHA address on her record, or the one her records were linked with. A consent that names no ABHA, or another
 * one, is bound to nobody (every request under it is refused). Practice consents are made here for her record.
 */
async function consentPatient(tenantId, mrn, forHer, practice) {
  const patient = mrn ? await Patient.findOne({ tenantId, mrn }, { _id: 1, abha: 1 }).lean() : null;
  if (!patient?.abha?.number) return null;
  if (practice && !forHer) return patient;
  if (!forHer) return null;
  const linked = await AbdmCareContext.find({ tenantId, patientId: patient._id, abhaNumber: patient.abha.number }, { abhaAddress: 1 }).lean();
  return [patient.abha.address, ...linked.map((l) => l.abhaAddress)].filter(Boolean).includes(forHer) ? patient : null;
}

/**
 * ABDM: a consent was granted, withdrawn or expired. body: { notification: { status, consentId, consentDetail } }.
 * The consent is kept (or its status changed) and acknowledged. Once withdrawn, expired or refused it stays so: a
 * repeated or late "granted" is written to its history as ignored, and nothing is sent with it.
 */
export async function consentNotify(req, tenant, body, { requestId = '' } = {}) {
  const client = abdmClient();
  const practice = isPractice(client);
  const n = body?.notification ?? {};
  const detail = n.consentDetail ?? null;
  const consentId = String(n.consentId ?? detail?.consentId ?? '').slice(0, 100);
  const status = CONSENT_STATUSES.includes(n.status) ? n.status : null;
  if (!consentId || !status) throw new HttpError(400, 'A consent needs its id and status.', 'VALIDATION');
  const now = req.now ?? new Date();
  const set = { status };
  if (detail) {
    const careContexts = (detail.careContexts ?? []).map((c) => ({ patientReference: String(c.patientReference ?? ''), careContextReference: String(c.careContextReference ?? '') })).slice(0, 500);
    const forHer = cleanAddress(detail.patient?.id) ?? '';
    const patient = await consentPatient(tenant._id, careContexts[0]?.patientReference, forHer, practice);
    Object.assign(set, {
      patientId: patient?._id ?? null,
      abhaAddress: forHer,
      hiTypes: (detail.hiTypes ?? []).filter((t) => typeof t === 'string').slice(0, 20),
      from: dateOrNull(detail.permission?.dateRange?.from),
      to: dateOrNull(detail.permission?.dateRange?.to),
      expiresAt: dateOrNull(detail.permission?.dataEraseAt),
      purpose: { code: String(detail.purpose?.code ?? '').slice(0, 40), text: String(detail.purpose?.text ?? '').slice(0, 200) },
      hiu: { id: String(detail.hiu?.id ?? '').slice(0, 100), name: String(detail.hiu?.name ?? detail.requester?.name ?? '').slice(0, 200) },
      careContexts,
      practice,
    });
  }
  const tenantId = tenant._id;
  const open = { tenantId, consentId, status: { $nin: FINAL } };
  const change = { $set: set, $push: { history: { status, at: now } } };
  let ignored = false;
  let saved = await AbdmConsent.findOneAndUpdate(open, change, { returnDocument: 'after' }).lean();
  if (!saved) {
    try {
      // A withdrawal or expiry of a consent never received here is kept too, so a later request is refused
      saved = (await AbdmConsent.create({ tenantId, consentId, practice, ...set, history: [{ status, at: now }] })).toObject();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // It exists: changed by a message at the same moment, or already withdrawn, expired or refused (it stays so)
      saved = await AbdmConsent.findOneAndUpdate(open, change, { returnDocument: 'after' }).lean();
      if (!saved) {
        ignored = true;
        saved = await AbdmConsent.findOneAndUpdate({ tenantId, consentId }, { $push: { history: { status, at: now, ignored: true } } }, { returnDocument: 'after' }).lean();
      }
    }
  }
  await client.consentOnNotify({ hipId: tenant.abdm?.hipId ?? '', requestId, consentId });
  const patient = saved.patientId ? await Patient.findOne({ tenantId, _id: saved.patientId }, { mrn: 1 }).lean() : null;
  await audit(req, 'ABDM_CONSENT_RECEIVED', {
    tenantId,
    details: { consentId, status, ...(ignored ? { ignored: true } : {}), ...(patient ? { patientId: String(patient._id), mrn: patient.mrn } : {}), records: (saved.careContexts ?? []).length, practice },
  });
  return saved;
}

// ---------- A request for data ----------

/** Why nothing is sent for this request (null: it may go ahead), and the dates that apply. */
export function checkRequest(consent, range, now) {
  if (!consent) return { refusal: 'unknown_consent' };
  if (consent.status === 'REVOKED') return { refusal: 'consent_revoked' };
  if (consent.status === 'DENIED') return { refusal: 'consent_denied' };
  if (consent.status === 'EXPIRED' || (consent.expiresAt && consent.expiresAt <= now)) return { refusal: 'consent_expired' };
  // Bound to no record here (its ABHA is not hers, or her record was not found), or not a consent given
  if (!consent.patientId || consent.status !== 'GRANTED') return { refusal: 'unknown_consent' };
  // Every consent says its dates and until when it lasts: one that does not is never taken as "any date" or "for ever"
  if (!consent.expiresAt || !consent.from || !consent.to) return { refusal: 'consent_incomplete' };
  // The dates that apply: inside both the consent and the request
  const from = latest(dateOrNull(consent.from), dateOrNull(range?.from));
  const to = earliest(dateOrNull(consent.to), dateOrNull(range?.to));
  if (from && to && toHospitalDate(from) > toHospitalDate(to)) return { refusal: 'dates_outside_consent' };
  return { refusal: null, from, to };
}

const REFUSAL_WORDS = {
  unknown_consent: 'No consent was found for this request.',
  consent_revoked: 'The consent was withdrawn.',
  consent_denied: 'The consent was refused.',
  consent_expired: 'The consent has expired.',
  consent_incomplete: 'The consent does not say its dates or until when it lasts.',
  dates_outside_consent: 'The dates asked for are outside the consent.',
  push_address: 'The address to send the records to is not allowed.',
  key: "The receiving side's key could not be read.",
};

/**
 * ABDM: "send the records of this consent". body: { transactionId, hiRequest: { consent: { id }, dateRange,
 * dataPushUrl, keyMaterial } }. Answers at once (acknowledged or refused); the records are then sent by `then`
 * (track() for ABDM's own messages, awaited in practice mode). Returns the transfer.
 */
export async function healthInfoRequest(req, tenant, body, { requestId = '', then = (work) => work() } = {}) {
  const client = abdmClient();
  const practice = isPractice(client);
  const hipId = tenant.abdm?.hipId ?? '';
  const transactionId = String(body?.transactionId ?? '').slice(0, 100);
  const hi = body?.hiRequest ?? {};
  const consentId = String(hi.consent?.id ?? '').slice(0, 100);
  if (!transactionId || !consentId) throw new HttpError(400, 'A request needs its transaction and consent ids.', 'VALIDATION');
  const done = await AbdmTransfer.findOne({ tenantId: tenant._id, transactionId }).lean();
  if (done) return done; // the same request again: answered already
  const now = req.now ?? new Date();
  const consent = await AbdmConsent.findOne({ tenantId: tenant._id, consentId }).lean();
  let { refusal, from, to } = checkRequest(consent, hi.dateRange, now);
  const url = String(hi.dataPushUrl ?? '');
  if (!refusal && (practice ? url !== PRACTICE_PUSH_URL : !pushAddressAllowed(url))) refusal = 'push_address';
  const transfer = await AbdmTransfer.create({
    tenantId: tenant._id,
    transactionId,
    consentId,
    patientId: consent?.patientId ?? null,
    from: dateOrNull(hi.dateRange?.from),
    to: dateOrNull(hi.dateRange?.to),
    status: refusal ? 'refused' : 'working',
    refusal: refusal ?? '',
    practice,
  });
  await client.healthInfoOnRequest({ hipId, requestId, transactionId, status: refusal ? 'ERRORED' : 'ACKNOWLEDGED', ...(refusal ? { error: errorOf('ABDM-1020', REFUSAL_WORDS[refusal]) } : {}) });
  const patient = consent?.patientId ? await Patient.findOne({ tenantId: tenant._id, _id: consent.patientId }).lean() : null;
  const who = patient ? { patientId: String(patient._id), mrn: patient.mrn } : {};
  if (refusal) {
    await audit(req, 'ABDM_SHARE_REFUSED', { tenantId: tenant._id, details: { consentId, transactionId, ...who, refusal, practice } });
    return transfer.toObject();
  }
  await then(() => sendRecords(req, tenant, { transfer, consent, patient, from, to, keyMaterial: hi.keyMaterial, url, who, practice }));
  return AbdmTransfer.findOne({ tenantId: tenant._id, _id: transfer._id }).lean();
}

/** What may be sent of each record in the consent, now: { reference, reason } or the documents to send. */
async function documentsFor(tenant, patient, consent, from, to) {
  const tenantId = tenant._id;
  const links = new Map((await AbdmCareContext.find({ tenantId, patientId: patient._id }).lean()).map((l) => [l.reference, l]));
  const block = patientBlock(patient);
  const types = new Set((consent.hiTypes ?? []).filter((t) => HI_TYPES.includes(t)));
  const out = [];
  const signers = [];
  const pending = [];
  for (const cc of consent.careContexts ?? []) {
    const ref = cc.careContextReference;
    const link = links.get(ref);
    const no = (reason) => out.push({ reference: ref, reason, documents: [] });
    if (cc.patientReference !== patient.mrn) {
      no('not_this_patient');
      continue;
    }
    if (block) {
      no(block);
      continue;
    }
    if (!linkedToCurrent(link, patient)) {
      no(link ? 'abha_changed' : 'not_linked');
      continue;
    }
    // Her ABHA address in the consent must be the one on her record or the one the record was linked with (a practice
    // consent, made here for her record, may name none)
    if ((consent.abhaAddress || !consent.practice) && ![patient.abha.address, link.abhaAddress].filter(Boolean).includes(consent.abhaAddress)) {
      no('abha_changed');
      continue;
    }
    const one = await loadOne(tenantId, patient, ref);
    if (!one) {
      no('not_linked');
      continue;
    }
    if (one.record.state !== 'ready') {
      no(one.record.reason);
      continue;
    }
    if (!withinRange(one.record.date, from, to)) {
      no('outside_dates');
      continue;
    }
    if (!one.record.hiTypes.some((t) => types.has(t))) {
      no('other_types');
      continue;
    }
    pending.push({ ref, one });
    const s = one.source;
    signers.push(s.signed?.by, s.reviewed?.by);
  }
  const ids = signers.filter(Boolean).map(String);
  const people = new Map((ids.length ? await User.find({ _id: { $in: ids } }, { name: 1, professional: 1 }).lean() : []).map((u) => [String(u._id), { name: u.name, registrationNumber: u.professional?.registrationNumber ?? '', council: u.professional?.council ?? '' }]));
  const ctx = {
    hospital: { name: tenant.name, key: tenant.abdm?.hipId || String(tenant._id), hfrId: tenant.abdm?.hfrId ?? '' },
    patient: {
      mrn: patient.mrn,
      fullName: patient.fullName,
      careType: patient.careType,
      newbornSex: patient.newborn?.sex ?? '',
      birthDate: patient.careType === 'newborn' && patient.newborn?.birthAt ? toHospitalDate(patient.newborn.birthAt).toISOString().slice(0, 10) : null,
      abhaNumber: patient.abha?.number ?? null,
    },
    people,
    now: new Date(),
  };
  for (const { ref, one } of pending) {
    let docs;
    if (one.record.kind === 'visit') docs = visitDocuments(ctx, one.source);
    else if (one.record.kind === 'lab') docs = labDocuments(ctx, one.source);
    else {
      const admission = await Admission.findOne({ tenantId, _id: one.source.admissionId }, { admittedAt: 1, dischargedAt: 1 }).lean();
      docs = dischargeDocuments(ctx, one.source, admission);
    }
    out.push({ reference: ref, reason: null, documents: docs.filter((d) => types.has(d.hiType)) });
  }
  return out;
}

async function sendRecords(req, tenant, { transfer, consent, patient, from, to, keyMaterial, url, who, practice }) {
  const client = abdmClient();
  const hipId = tenant.abdm?.hipId ?? '';
  const results = patient ? await documentsFor(tenant, patient, consent, from, to) : (consent.careContexts ?? []).map((cc) => ({ reference: cc.careContextReference, reason: 'not_linked', documents: [] }));
  const pages = results.flatMap((r) => r.documents.map((d) => ({ reference: r.reference, d })));
  let error = '';
  const sent = new Map(); // reference -> documents sent
  const requester = { publicKey: keyMaterial?.dhPublicKey?.keyValue, nonce: keyMaterial?.nonce };
  const expiry = keyMaterial?.dhPublicKey?.expiry;
  for (const [i, page] of pages.entries()) {
    const text = JSON.stringify(page.d.bundle);
    let encrypted;
    try {
      // A new key pair and nonce for every page: a key and IV are never used twice
      encrypted = encryptFor({ text, requester, expiry });
    } catch {
      error = REFUSAL_WORDS.key;
      break;
    }
    const pushBody = {
      pageNumber: i + 1,
      pageCount: pages.length,
      transactionId: transfer.transactionId,
      entries: [{ content: encrypted.encryptedData, media: 'application/fhir+json', checksum: checksumOf(text), careContextReference: page.reference }],
      keyMaterial: encrypted.keyMaterial,
    };
    try {
      await client.pushData({ url, body: pushBody });
      sent.set(page.reference, (sent.get(page.reference) ?? 0) + 1);
    } catch (err) {
      error = err instanceof HttpError ? err.message : 'The records could not be sent.';
      break;
    }
  }
  // A record is delivered when all its documents went
  const careContexts = results.map((r) => {
    const n = sent.get(r.reference) ?? 0;
    const ok = !r.reason && r.documents.length > 0 && n === r.documents.length;
    return { reference: r.reference, delivered: ok, documents: n, reason: ok ? '' : (r.reason ?? (r.documents.length ? 'not_sent' : 'other_types')) };
  });
  const deliveredCount = careContexts.filter((c) => c.delivered).length;
  const documents = careContexts.reduce((n, c) => n + c.documents, 0);
  const now = new Date();
  let notifiedAt = null;
  try {
    await client.healthInfoNotify({
      hipId,
      consentId: consent.consentId,
      transactionId: transfer.transactionId,
      doneAt: now.toISOString(),
      sessionStatus: deliveredCount ? 'TRANSFERRED' : 'FAILED',
      statusResponses: careContexts.map((c) => ({ careContextReference: c.reference, hiStatus: c.delivered ? 'DELIVERED' : 'ERRORED', description: c.delivered ? 'Delivered' : 'Not available' })),
    });
    notifiedAt = new Date();
  } catch (err) {
    if (!error) error = err instanceof HttpError ? `Sent, but ABDM was not told: ${err.message}` : 'Sent, but ABDM was not told.';
  }
  const status = deliveredCount ? 'sent' : error ? 'failed' : 'nothing_to_send';
  await AbdmTransfer.updateOne({ tenantId: tenant._id, _id: transfer._id }, { $set: { status, careContexts, documents, error: error.slice(0, 300), pushedAt: pages.length ? now : null, notifiedAt } });
  await audit(req, 'ABDM_RECORDS_SHARED', { tenantId: tenant._id, details: { consentId: consent.consentId, transactionId: transfer.transactionId, ...who, records: deliveredCount, documents, heldBack: careContexts.length - deliveredCount, practice } });
}

// ---------- Practice mode: the buttons that stand in for her ABHA app and another hospital ----------

const practiceOnly = (client) => {
  if (!isPractice(client)) throw conflict('Only in practice mode.', 'NOT_PRACTICE');
};

/** Practice: her ABHA app looks for her records here and asks to link all of them (the OTP is shown). */
export async function practiceDiscover(req, tenant, patient) {
  const client = abdmClient();
  practiceOnly(client);
  if (!patient.abha?.number) throw conflict(BLOCK_WORDS.no_abha, 'NOT_LINKED');
  const transactionId = randomUUID();
  const found = await discover(req, tenant, { transactionId, patient: { id: patient.abha.address || '', verifiedIdentifiers: [{ type: 'ABHA_NUMBER', value: patient.abha.number }] } });
  if (!found.offered.length) return { transactionId, offered: [], error: found.error };
  const init = await linkInit(req, tenant, { transactionId, patient: [{ referenceNumber: patient.mrn, careContexts: found.offered.map((r) => ({ referenceNumber: r.reference })) }] });
  return { transactionId, offered: found.offered, error: init.error, practiceOtp: init.practiceOtp };
}

/** Practice: she types the OTP in her ABHA app. */
export async function practiceConfirm(req, tenant, patient, { transactionId, otp }) {
  practiceOnly(abdmClient());
  const lr = await AbdmLinkRequest.findOne({ tenantId: tenant._id, transactionId, patientId: patient._id }).lean();
  if (!lr?.linkRef) throw conflict('This practice search has expired. Please start again.', 'EXPIRED');
  return linkConfirm(req, tenant, { confirmation: { linkRefNumber: lr.linkRef, token: otp } });
}

/** Practice: another hospital ("Sample Clinic (practice)") asks for her records with this consent, and receives them. */
async function practiceRequestFor(req, tenant, consent, range) {
  const client = abdmClient();
  const transactionId = randomUUID();
  const keyMaterial = client.practiceHiuKeyMaterial(transactionId, new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  const t = await healthInfoRequest(req, tenant, { transactionId, hiRequest: { consent: { id: consent.consentId }, dateRange: range ?? { from: consent.from, to: consent.to }, dataPushUrl: PRACTICE_PUSH_URL, keyMaterial } });
  return transferView(t);
}

/** Practice: she grants a consent in her ABHA app (all her linked records), and the other hospital asks at once. */
export async function practiceConsent(req, tenant, patient, { from, to, hiTypes, days }) {
  practiceOnly(abdmClient());
  if (!patient.abha?.number) throw conflict(BLOCK_WORDS.no_abha, 'NOT_LINKED');
  const links = (await AbdmCareContext.find({ tenantId: tenant._id, patientId: patient._id, status: 'linked' }).lean()).filter((l) => linkedToCurrent(l, patient));
  if (!links.length) throw conflict('Link some of her records to her ABHA first.', 'NOTHING_LINKED');
  const now = req.now ?? new Date();
  const consentId = randomUUID();
  const consent = await consentNotify(req, tenant, {
    notification: {
      status: 'GRANTED',
      consentId,
      consentDetail: {
        consentId,
        createdAt: now.toISOString(),
        patient: { id: patient.abha.address || '' },
        careContexts: links.map((l) => ({ patientReference: patient.mrn, careContextReference: l.reference })),
        purpose: { code: 'CAREMGT', text: 'Care management' },
        hip: { id: tenant.abdm?.hipId || 'PRACTICE-HIP' },
        hiu: PRACTICE_HIU,
        hiTypes,
        permission: { accessMode: 'VIEW', dateRange: { from, to }, dataEraseAt: new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString(), frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
      },
    },
  });
  return { consentId: consent.consentId, transfer: await practiceRequestFor(req, tenant, consent) };
}

/** Practice: the other hospital asks again with an earlier consent (refused when it was withdrawn or has expired). */
export async function practiceRequestAgain(req, tenant, consent) {
  practiceOnly(abdmClient());
  return { transfer: await practiceRequestFor(req, tenant, consent) };
}

/** Practice: she withdraws the consent in her ABHA app. */
export async function practiceRevoke(req, tenant, consent) {
  practiceOnly(abdmClient());
  await consentNotify(req, tenant, { notification: { status: 'REVOKED', consentId: consent.consentId } });
}

/** Practice: what "Sample Clinic (practice)" received and decrypted for one request (null: forgotten after a restart). */
export function practiceReceived(transfer) {
  practiceOnly(abdmClient());
  const docs = abdmClient().practiceReceived(transfer.transactionId);
  if (!docs) return null;
  return docs.map((x) => {
    const composition = x.document?.entry?.[0]?.resource ?? {};
    return { reference: x.careContextReference, title: composition.title ?? '', date: composition.date ?? null, document: x.document };
  });
}
