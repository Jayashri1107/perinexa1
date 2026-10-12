// The practice stand-in for ABDM (ABDM_MODE=practice, the default): answers like the sandbox with made-up ABHAs, so the
// screens can be tried and tested without credentials. The OTP is always 123456 and is said on screen. Nothing leaves
// this computer. Kept in memory: restarting the server forgets the ABHAs made here.

import { randomInt, randomUUID } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';
import { abhaNumber, maskMobile } from './abhaFormat.js';
import { checksumOf, decryptFrom, encryptFor, requesterKeyMaterial } from './fidelius.js';
import { practiceDocuments, practiceMatches } from './practiceHospitals.js';

export const PRACTICE_OTP = '123456';

const practiceProfile = (p) => ({ gender: 'F', address: 'Sample Road, Pune', ...p });
// Ready-made practice ABHAs (made-up people), to try "she already has an ABHA".
const SEED = [
  practiceProfile({ abhaNumber: '91-1111-2222-3333', abhaAddress: 'sample.abha.mother@sbx', name: 'Sample Abha Mother', yearOfBirth: 1996, mobile: '9000000001' }),
  practiceProfile({ abhaNumber: '91-4444-5555-6666', abhaAddress: 'second.sample@sbx', name: 'Second Sample Mother', yearOfBirth: 1992, mobile: '9000000002' }),
];
const registry = new Map(SEED.map((p) => [p.abhaNumber, p]));
const txns = new Map(); // txnId -> { kind, profiles, aadhaar? }

const bad = (message) => new HttpError(400, message, 'ABDM');

// M2 (sharing her records): what the practice stand-in was sent (the answers ABDM would get), and a practice
// receiving hospital (HIU) that asks for her records with its own keys and decrypts what arrives – proving the
// encryption works end to end. Kept in memory only (the last 20 requests); restarting the server forgets them.
export const PRACTICE_HIU = { id: 'PRACTICE-HIU', name: 'Sample Clinic (practice)' };
export const PRACTICE_PUSH_URL = 'practice://sample-clinic/data-push';
const sentToAbdm = []; // [{ call, body }]
const hiuKeys = new Map(); // transactionId -> { privateRaw, nonce }
const received = new Map(); // transactionId -> [{ careContextReference, checksum, document }]
// M3 (asking other hospitals for her records): the consent requests made, the consents she gave (one per practice
// hospital) and the requests for records – in memory only, the last 20 of each.
export const PRACTICE_HIU_PUSH_URL = 'practice://perinexa/hiu-data-push';
const consentRequests = new Map(); // consentRequestId -> { consent, consentIds }
const artefacts = new Map(); // consentId -> consent detail (as ABDM's on-fetch carries it)
const dataRequests = new Map(); // transactionId -> { consentId, dateRange, keyMaterial }
const remember = (map, key, value) => {
  map.set(key, value);
  while (map.size > 20) map.delete(map.keys().next().value);
};
const sent = (call, body) => {
  sentToAbdm.push({ call, body });
  if (sentToAbdm.length > 200) sentToAbdm.shift();
};
/** Tests only: what the practice stand-in was sent (newest last). */
export const practiceSent = () => sentToAbdm;

/** Tests only: back to the ready-made practice ABHAs. */
export function resetPractice() {
  registry.clear();
  for (const p of SEED) registry.set(p.abhaNumber, { ...p });
  txns.clear();
  sentToAbdm.length = 0;
  hiuKeys.clear();
  received.clear();
  consentRequests.clear();
  artefacts.clear();
  dataRequests.clear();
}

export const practiceClient = {
  mode: 'practice',

  async requestLoginOtp({ hint, value }) {
    let profiles;
    if (hint === 'abha-number') profiles = [registry.get(abhaNumber(value))].filter(Boolean);
    else if (hint === 'abha-address') profiles = [...registry.values()].filter((p) => p.abhaAddress === value || p.abhaAddress.split('@')[0] === value);
    else profiles = [...registry.values()].filter((p) => p.mobile === value);
    if (!profiles.length) throw bad(hint === 'mobile' ? 'No ABHA is linked to this mobile number (practice).' : 'This ABHA was not found (practice).');
    const txnId = randomUUID();
    txns.set(txnId, { kind: 'login', profiles });
    return { txnId, sentTo: maskMobile(profiles[0].mobile) };
  },

  async verifyLoginOtp({ txnId, otp }) {
    const t = txns.get(txnId);
    if (!t || t.kind !== 'login') throw bad('This verification has expired. Please start again.');
    if (otp !== PRACTICE_OTP) throw bad('The OTP is not correct.');
    return { accounts: t.profiles.map((p) => ({ ...p })), token: `practice-${txnId}` };
  },

  async requestEnrolOtp({ aadhaar }) {
    const txnId = randomUUID();
    // The Aadhaar number is only held for this practice transaction, to make up the ABHA – never stored elsewhere.
    txns.set(txnId, { kind: 'enrol', last4: aadhaar.slice(-4) });
    return { txnId, sentTo: `******${aadhaar.slice(-4)}` };
  },

  async enrolByAadhaar({ txnId, otp, mobile }) {
    const t = txns.get(txnId);
    if (!t || t.kind !== 'enrol') throw bad('This ABHA creation has expired. Please start again.');
    if (otp !== PRACTICE_OTP) throw bad('The OTP is not correct.');
    const number = abhaNumber(`91${String(randomInt(1e11, 1e12 - 1)).padStart(12, '0')}`);
    const profile = practiceProfile({ abhaNumber: number, abhaAddress: '', name: `Practice ABHA ${t.last4}`, yearOfBirth: 1995, mobile });
    registry.set(number, profile);
    t.profile = profile;
    return { profile: { ...profile }, token: `practice-${txnId}`, isNew: true };
  },

  async addressSuggestions({ txnId }) {
    const t = txns.get(txnId);
    if (!t?.profile) throw bad('This ABHA creation has expired. Please start again.');
    const base = t.profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '.');
    return [`${base}@sbx`, `${base}.${t.profile.yearOfBirth}@sbx`, `${base}${t.profile.abhaNumber.slice(-4)}@sbx`];
  },

  async setAddress({ txnId, address }) {
    const t = txns.get(txnId);
    if (!t?.profile) throw bad('This ABHA creation has expired. Please start again.');
    const full = address.includes('@') ? address : `${address}@sbx`;
    if ([...registry.values()].some((p) => p.abhaAddress === full)) throw bad('This ABHA address is taken. Choose another.');
    t.profile.abhaAddress = full;
    registry.get(t.profile.abhaNumber).abhaAddress = full;
    return { abhaAddress: full };
  },

  async card({ profile }) {
    const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" rx="24" fill="#ffffff" stroke="#3b3f8f" stroke-width="4"/><text x="32" y="60" font-family="sans-serif" font-size="26" font-weight="700" fill="#3b3f8f">ABHA – practice card (not real)</text><text x="32" y="140" font-family="sans-serif" font-size="22">${esc(profile.name)}</text><text x="32" y="190" font-family="sans-serif" font-size="30" font-weight="700">${esc(profile.abhaNumber)}</text><text x="32" y="240" font-family="sans-serif" font-size="20">${esc(profile.abhaAddress)}</text><text x="32" y="290" font-family="sans-serif" font-size="18">Year of birth ${esc(profile.yearOfBirth)} · Gender ${esc(profile.gender)}</text><text x="32" y="360" font-family="sans-serif" font-size="14" fill="#666">Made in Perinexa practice mode – not connected to ABDM.</text></svg>`;
    return { contentType: 'image/svg+xml', base64: Buffer.from(svg).toString('base64') };
  },

  /** Practice: a made-up Scan & Share, as if a patient scanned the desk's QR code. */
  practiceShare() {
    const [p] = SEED;
    return { abhaNumber: p.abhaNumber, abhaAddress: p.abhaAddress, name: p.name, gender: p.gender, yearOfBirth: p.yearOfBirth, mobile: p.mobile, address: p.address };
  },

  async verifyShareRequest() {
    throw new HttpError(404, 'Scan & Share messages from ABDM are not received in practice mode.', 'NOT_FOUND');
  },

  async acknowledgeShare() {},

  // ---------- M2: sharing her records ----------

  /** Messages from ABDM are not received in practice mode (the practice buttons stand in for them). */
  async verifyRequest() {
    throw new HttpError(404, 'Messages from ABDM are not received in practice mode.', 'NOT_FOUND');
  },

  /** Linking records by the hospital: the practice stand-in links them at once. */
  async startLink(link) {
    sent('link', link);
    return { status: 'linked' };
  },
  async linkWithToken() {
    throw new HttpError(409, 'Not used in practice mode.', 'NOT_PRACTICE');
  },
  async onDiscover(body) {
    sent('on-discover', body);
  },
  async onLinkInit(body) {
    sent('on-init', body);
  },
  async onLinkConfirm(body) {
    sent('on-confirm', body);
  },
  async consentOnNotify(body) {
    sent('consent-on-notify', body);
  },
  async healthInfoOnRequest(body) {
    sent('on-request', body);
  },
  async healthInfoNotify(body) {
    sent('notify', body);
  },

  /** The practice receiving hospital's key material for one request (its private key stays here). */
  practiceHiuKeyMaterial(transactionId, expiry) {
    const k = requesterKeyMaterial({ expiry });
    remember(hiuKeys, transactionId, { privateRaw: k.privateRaw, nonce: k.nonce });
    return k.keyMaterial;
  },

  /** One page of records "arrives" at the practice receiving hospital, which decrypts it with its own key. */
  async pushData({ url, body }) {
    if (url !== PRACTICE_PUSH_URL) throw new HttpError(400, 'Practice mode sends only to the practice receiving hospital.', 'ABDM');
    const keys = hiuKeys.get(body.transactionId);
    if (!keys) throw new HttpError(409, 'The practice receiving hospital did not ask for this.', 'ABDM');
    const sender = { publicKey: body.keyMaterial?.dhPublicKey?.keyValue, nonce: body.keyMaterial?.nonce };
    const docs = body.entries.map((e) => ({ careContextReference: e.careContextReference, checksum: e.checksum, document: JSON.parse(decryptFrom({ encryptedData: e.content, sender, ours: keys })) }));
    remember(received, body.transactionId, [...(received.get(body.transactionId) ?? []), ...docs]);
  },

  /** What the practice receiving hospital decrypted for one request (null: not kept – the server was restarted). */
  practiceReceived(transactionId) {
    return received.get(transactionId) ?? null;
  },
  // ---------- M3: asking other hospitals for her records (the hospital as a Health Information User) ----------

  /**
   * A consent request: practice mode gives its id at once (ABDM answers later, on-init). The practice hospitals'
   * documents never carry her name: they are made up, for "Practice patient (made up)" (practiceHospitals.js).
   */
  async consentRequestInit(body) {
    sent('consent-request-init', body);
    const consentRequestId = randomUUID();
    remember(consentRequests, consentRequestId, { consent: body.consent, consentIds: [] });
    return { consentRequestId };
  },

  /**
   * Practice: she answers in her ABHA app. Agreeing makes one consent for each practice hospital that has records of
   * the kinds asked for inside the dates (none: she agreed, but no hospital has anything). Returns ABDM's notification.
   */
  practiceAnswer(consentRequestId, approve, now = new Date()) {
    const r = consentRequests.get(consentRequestId);
    if (!r) throw new HttpError(409, 'This practice request is not known any more (the server was restarted). Ask again.', 'EXPIRED');
    if (!approve) return { notification: { consentRequestId, status: 'DENIED', consentArtefacts: [] } };
    const c = r.consent;
    const range = c.permission?.dateRange ?? {};
    for (const { hip, records } of practiceMatches({ hiTypes: c.hiTypes, from: range.from, to: range.to }, now)) {
      const consentId = randomUUID();
      const types = [...new Set(records.flatMap((x) => x.hiTypes))].filter((t) => c.hiTypes.includes(t));
      remember(artefacts, consentId, {
        consentId,
        status: 'GRANTED',
        createdAt: now.toISOString(),
        patient: c.patient,
        careContexts: records.map((x) => ({ patientReference: `${hip.id}-SAMPLE-1`, careContextReference: x.reference })),
        purpose: c.purpose,
        hip: { id: hip.id, name: hip.name },
        hiu: c.hiu,
        requester: c.requester,
        hiTypes: types,
        permission: c.permission,
      });
      r.consentIds.push(consentId);
    }
    return { notification: { consentRequestId, status: 'GRANTED', consentArtefacts: r.consentIds.map((id) => ({ id })) } };
  },

  /** Practice: she withdraws her consent, or it ends (ABDM's notification). */
  practiceEnd(consentRequestId, status) {
    const r = consentRequests.get(consentRequestId);
    for (const id of r?.consentIds ?? []) if (artefacts.has(id)) artefacts.get(id).status = status;
    return { notification: { consentRequestId, status, consentArtefacts: (r?.consentIds ?? []).map((id) => ({ id })) } };
  },

  async hiuOnNotify(body) {
    sent('hiu-on-notify', body);
  },

  /** The details of one consent: practice mode answers at once (ABDM answers later, on-fetch). */
  async fetchConsent(body) {
    sent('consent-fetch', body);
    const detail = artefacts.get(body.consentId);
    if (!detail) throw new HttpError(409, 'This practice consent is not known any more (the server was restarted). Ask again.', 'EXPIRED');
    return { consent: { status: detail.status, consentDetail: { ...detail } } };
  },

  /** Asking for the records of one consent: practice mode gives the transfer's id at once. */
  async requestHealthInfo(body) {
    sent('health-information-request', { ...body, keyMaterial: { ...body.keyMaterial } });
    if (body.dataPushUrl !== PRACTICE_HIU_PUSH_URL) throw new HttpError(400, 'Practice mode receives records only at the practice address.', 'ABDM');
    if (!artefacts.has(body.consentId)) throw new HttpError(409, 'This practice consent is not known any more (the server was restarted). Ask again.', 'EXPIRED');
    const transactionId = randomUUID();
    remember(dataRequests, transactionId, { consentId: body.consentId, dateRange: body.dateRange, keyMaterial: body.keyMaterial });
    return { transactionId };
  },

  /**
   * Practice: the other hospital sends the records of one request – each document encrypted for Perinexa's key of
   * that request, one document per page with its own key pair and nonce (as Perinexa sends its own in M2). Returns
   * the pages, as they would arrive at the data push address. Nothing is sent once the consent has ended.
   */
  practiceDeliver(transactionId, now = new Date()) {
    const t = dataRequests.get(transactionId);
    const detail = t ? artefacts.get(t.consentId) : null;
    if (!detail || detail.status !== 'GRANTED') return [];
    const docs = detail.careContexts.flatMap((cc) => practiceDocuments(detail.hip.id, cc.careContextReference, { hiTypes: detail.hiTypes, now }).map((d) => ({ reference: cc.careContextReference, d })));
    const requester = { publicKey: t.keyMaterial?.dhPublicKey?.keyValue, nonce: t.keyMaterial?.nonce };
    return docs.map(({ reference, d }, i) => {
      const text = JSON.stringify(d.bundle);
      const out = encryptFor({ text, requester, expiry: t.keyMaterial?.dhPublicKey?.expiry });
      return { pageNumber: i + 1, pageCount: docs.length, transactionId, entries: [{ content: out.encryptedData, media: 'application/fhir+json', checksum: checksumOf(text), careContextReference: reference }], keyMaterial: out.keyMaterial };
    });
  },

  async healthInfoNotifyHiu(body) {
    sent('hiu-health-information-notify', body);
  },
};
