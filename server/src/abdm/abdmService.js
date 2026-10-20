// ABDM linking (M1, docs/ABDM_PLAN.md): which connection is in use (practice stand-in, or ABDM's V3 APIs), the
// short-lived verifications and creations in progress, and linking an ABHA to a patient's record.
//
// PRIVACY: the Aadhaar number is passed straight to the connection and forgotten; it is never kept in a transaction,
// the database or a log. A transaction keeps only what ABDM sent back (her ABHA profile) and its token, for 15 minutes,
// for the person and hospital that started it.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { HttpError } from '../utils/httpError.js';
import * as shared from '../utils/sharedState.js';
import { practiceClient } from './practiceClient.js';
import { v3Client } from './v3Client.js';

let clientForTests = null;
/** Tests only: use another connection (null: back to the configured one). */
export const setAbdmClientForTests = (c) => {
  clientForTests = c;
};
export const abdmClient = () => clientForTests ?? (config.ABDM_MODE === 'practice' ? practiceClient : v3Client);
export const abdmMode = () => abdmClient().mode;

const TTL_MS = 15 * 60 * 1000;

// Work started by a message from ABDM after the answer was sent (e.g. sending her records): tests wait for it.
const pending = new Set();
/** Runs `work` after the answer to ABDM was sent; a failure is written to the server's log (never the records). */
export function track(work) {
  const p = Promise.resolve()
    .then(work)
    .catch((err) => console.error('ABDM: work after a message failed:', err?.message ?? err))
    .finally(() => pending.delete(p));
  pending.add(p);
  return p;
}
/** Tests only: waits until every piece of work started by ABDM's messages has finished. */
export async function abdmIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}
// A step of verifying or creating an ABHA (our id -> { tenantId, userId, kind, abdmTxnId, patientId, accounts, profile,
// token }): in the database, encrypted (utils/sharedState.js), so any copy of the server can continue it.
const TXN = 'abdm-txn';

/**
 * The hospital a message from ABDM (or another hospital's records) is for: the ONE active hospital with this HIP ID
 * (also its HIU ID). null when none has it. Two hospitals with the same HIP ID (Hospital admin refuses to save one
 * that is taken, but older data might have it) is refused: a consent for one hospital's patient must never land in
 * another hospital.
 */
export async function hospitalByHipId(hipId, projection = { name: 1, abdm: 1 }) {
  const id = String(hipId ?? '').trim();
  if (!id) return null;
  const found = await Tenant.find({ isActive: true, 'abdm.hipId': id }, projection).limit(2).lean();
  if (found.length > 1) {
    console.error('ABDM: two hospitals have the same HIP ID – the message was refused. Correct it in Hospital admin → ABDM.');
    throw new HttpError(409, 'Two hospitals on Perinexa have this HIP ID: nothing was done.', 'HIP_ID_IN_USE');
  }
  return found[0] ?? null;
}

export async function startTxn(req, fields) {
  const id = randomUUID();
  const until = Date.now() + TTL_MS;
  await shared.put(TXN, id, { tenantId: String(req.tenantId), userId: String(req.user._id), until, ...fields }, until, { secret: true });
  return id;
}

/** The transaction with this id, started by this person in this hospital (else: expired). */
export async function getTxn(req, id, kind) {
  const t = await shared.get(TXN, id);
  if (!t || t.until < Date.now() || t.tenantId !== String(req.tenantId) || t.userId !== String(req.user._id) || (kind && t.kind !== kind)) {
    throw new HttpError(409, 'This step has expired. Please start again.', 'EXPIRED');
  }
  return t;
}
/** Keeps a step's changes (after getTxn) for the next request, on whichever copy it lands. */
export const saveTxn = (id, t) => shared.put(TXN, id, t, t.until, { secret: true });
export const endTxn = (id) => shared.drop(TXN, id);

/** What the website gets of an ABHA profile from ABDM (to check against her record). */
export const profileView = (p) => ({
  abhaNumber: p.abhaNumber,
  abhaAddress: p.abhaAddress ?? '',
  name: p.name ?? '',
  gender: p.gender ?? '',
  yearOfBirth: p.yearOfBirth ?? null,
  mobile: p.mobile ? `******${String(p.mobile).slice(-4)}` : '',
});

/**
 * Links an ABHA to a patient: her record keeps the ABHA number and address, how, by whom, and that she agreed. Refused
 * when another record of this hospital already has that ABHA, or hers already has another one.
 */
export async function linkAbha(req, patientId, profile, method) {
  if (!profile?.abhaNumber) throw new HttpError(400, 'ABDM sent no ABHA number to link.', 'ABDM');
  const other = await Patient.findOne({ tenantId: req.tenantId, 'abha.number': profile.abhaNumber, _id: { $ne: patientId } }, { fullName: 1, mrn: 1, duplicateOf: 1 }).lean();
  // On a record marked as a duplicate of this one: it is her own earlier record – said plainly, with what to do
  if (other && String(other.duplicateOf?.patient ?? '') === String(patientId)) {
    throw new HttpError(409, `Her ABHA is on her earlier record ${other.mrn}. Unlink it there first (ABHA tab of ${other.mrn}), then link it here.`, 'ABHA_ON_EARLIER_RECORD');
  }
  if (other) throw new HttpError(409, `This ABHA is already linked to ${other.fullName} (${other.mrn}).`, 'ABHA_IN_USE');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: patientId });
  if (!patient) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  if (patient.abha?.number && patient.abha.number !== profile.abhaNumber) throw new HttpError(409, 'Her record already has another ABHA. Unlink it first.', 'ABHA_LINKED');
  patient.abha = {
    number: profile.abhaNumber,
    address: profile.abhaAddress ?? '',
    nameOnAbha: profile.name ?? '',
    genderOnAbha: String(profile.gender ?? '').slice(0, 10),
    yearOfBirthOnAbha: Number(profile.yearOfBirth) >= 1900 && Number(profile.yearOfBirth) <= 2100 ? Number(profile.yearOfBirth) : null,
    method,
    consent: true,
    by: req.user._id,
    byName: req.user.name,
    at: req.now ?? new Date(),
  };
  await patient.save();
  return patient;
}
