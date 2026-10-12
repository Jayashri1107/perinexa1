// ABDM's V3 APIs (ABDM_MODE=sandbox or production) for milestone M1: ABHA enrolment by Aadhaar OTP, ABHA login and
// verification by OTP, the ABHA address and card, and Scan & Share – for milestone M2: linking her records to her
// ABHA, answering her ABHA app's discovery, consents, and sending her records (encrypted) with her consent – and for
// milestone M3: asking for her records from other hospitals with her consent and receiving them. Written from ABDM's
// public V3 material (Oct 2026); NONE of it has been tried against ABDM yet.
// ⚠️ check every path and field against the sandbox documentation when the credentials arrive (docs/ABDM_PLAN.md) –
// the lists to check are ABDM_CHECKLIST (M1), ABDM_CHECKLIST_M2 and ABDM_CHECKLIST_M3 below.
//
// Rules this file keeps:
//  - the client secret only comes from server/.env and is sent only to ABDM's session endpoint (and the session token
//    only to ABDM's own hosts);
//  - the Aadhaar number, OTPs and mobile numbers are encrypted with ABDM's public key before they leave
//    (RSA/ECB/OAEPWithSHA-1AndMGF1Padding) and are never logged – errors carry ABDM's message, never the request;
//  - a message from ABDM is accepted only with a valid ABDM signature (its keys from the gateway's /certs) AND only
//    from ABDM's gateway itself: ABDM signs every hospital's own session token with the same keys, so a token of
//    another hospital or app is refused (fromGateway).

import { constants, createPublicKey, publicEncrypt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { abhaNumber } from './abhaFormat.js';

const BASES = {
  sandbox: { abha: 'https://abhasbx.abdm.gov.in/abha/api/v3', gateway: 'https://dev.abdm.gov.in/api/hiecm/gateway/v3', hiecm: 'https://dev.abdm.gov.in/api/hiecm', cm: 'sbx' },
  production: { abha: 'https://abha.abdm.gov.in/abha/api/v3', gateway: 'https://live.abdm.gov.in/api/hiecm/gateway/v3', hiecm: 'https://live.abdm.gov.in/api/hiecm', cm: 'abdm' },
};

/** What to check against the sandbox documentation before calling this connection ready. */
export const ABDM_CHECKLIST = [
  'Gateway session: POST {gateway}/sessions with { clientId, clientSecret, grantType: "client_credentials" }',
  'Public key: GET {abha}/profile/public/certificate',
  'Enrol OTP: POST {abha}/enrollment/request/otp { scope: ["abha-enrol"], loginHint: "aadhaar", loginId, otpSystem: "aadhaar" }',
  'Enrol: POST {abha}/enrollment/enrol/byAadhaar { authData: { authMethods: ["otp"], otp: { txnId, otpValue, mobile } }, consent: { code: "abha-enrollment", version: "1.4" } }',
  'Address: GET {abha}/enrollment/enrol/suggestion (Transaction_Id header); POST {abha}/enrollment/enrol/abha-address { txnId, abhaAddress, preferred: 1 }',
  'Login OTP: POST {abha}/profile/login/request/otp { scope: ["abha-login", "mobile-verify"], loginHint: "abha-number" | "mobile", loginId, otpSystem: "abdm" }',
  'Login verify: POST {abha}/profile/login/verify { scope, authData: { authMethods: ["otp"], otp: { txnId, otpValue } } }',
  'Profile: GET {abha}/profile/account and card GET {abha}/profile/account/abha-card (X-token: Bearer …)',
  'Scan & Share: bridge URL https://<host>/api/abdm/public, so ABDM posts to …/api/abdm/public/api/v3/hip/patient/share (signed); reply {gateway}/patient-share/on-share',
];

/**
 * Milestone M2 (sharing her records – the hospital as a Health Information Provider): what to check against the
 * sandbox documentation. {hiecm} = https://dev.abdm.gov.in/api/hiecm (sandbox); every call carries REQUEST-ID,
 * TIMESTAMP, X-CM-ID and X-HIP-ID; ABDM's own calls to Perinexa (bridge URL + path) carry its signature.
 */
export const ABDM_CHECKLIST_M2 = [
  'Bridge: register the bridge URL https://<host>/api/abdm/public and the HIP services (HFR ID as the HIP ID) with ABDM',
  "ABDM's own calls (M1, M2 and M3): the Authorization token must be the GATEWAY's – Perinexa accepts it only when its clientId (or azp) is ABDM_GATEWAY_CLIENT_ID (default \"gateway\") or its roles (realm_access or resource_access) include \"gateway\"; check the claims of a real gateway call, and that a hospital's own session token (same signing keys) is refused",
  'Link token: POST {hiecm}/v3/token/generate-token { abhaNumber (14 digits, no dashes), abhaAddress, name, gender, yearOfBirth } → ABDM calls …/api/v3/hip/token/on-generate-token { abhaAddress, linkToken, response.requestId }',
  'Link records: POST {hiecm}/hip/v3/link/carecontext (X-LINK-TOKEN) { abhaNumber, abhaAddress, patient: [{ referenceNumber (patient number), display, careContexts: [{ referenceNumber, display }], hiType, count }] } → ABDM calls …/api/v3/link/on_carecontext',
  'Discovery: ABDM calls …/api/v3/hip/patient/care-context/discover { transactionId, patient: { id, verifiedIdentifiers } } → POST {hiecm}/user-initiated-linking/v3/patient/care-context/on-discover { transactionId, patient: [...], matchedBy, response.requestId }',
  'Link from her app: ABDM calls …/api/v3/hip/link/care-context/init { transactionId, abhaAddress, patient: [{ referenceNumber, careContexts }] } → OTP by SMS to the mobile on her record → POST {hiecm}/user-initiated-linking/v3/link/care-context/on-init { transactionId, link: { referenceNumber, authenticationType: "DIRECT", meta } }',
  'Link confirm: ABDM calls …/api/v3/hip/link/care-context/confirm { confirmation: { linkRefNumber, token } } → POST {hiecm}/user-initiated-linking/v3/link/care-context/on-confirm { patient: [...] }',
  'Consent: ABDM calls …/api/v3/consent/request/hip/notify { notification: { status, consentId, consentDetail: { patient.id, careContexts, hiTypes, permission: { dateRange, dataEraseAt } } } } → POST {hiecm}/consent/v3/request/hip/on-notify { acknowledgement: { status: "ok", consentId } }',
  'Data request: ABDM calls …/api/v3/hip/health-information/request { transactionId, hiRequest: { consent.id, dateRange, dataPushUrl, keyMaterial } } → POST {hiecm}/data-flow/v3/health-information/hip/on-request { hiRequest: { transactionId, sessionStatus: "ACKNOWLEDGED" } }',
  'Data push: POST to dataPushUrl { pageNumber, pageCount, transactionId, entries: [{ content, media: "application/fhir+json", checksum, careContextReference }], keyMaterial } – one document per page, each page with its own key pair and nonce; the session token is sent only when dataPushUrl is on the ABDM gateway',
  'Transfer notify: POST {hiecm}/data-flow/v3/health-information/notify { notification: { consentId, transactionId, doneAt, notifier: { type: "HIP", id }, statusNotification: { sessionStatus: "TRANSFERRED", hipId, statusResponses: [{ careContextReference, hiStatus: "DELIVERED" | "ERRORED", description }] } } }',
  'Encryption (fidelius.js): check against ABDM\'s Fidelius test vectors – the shape of dhPublicKey.keyValue (X.509 with Curve25519 written out, answered in the same shape), HKDF on the raw 32-byte secret, salt = first 20 and IV = last 12 bytes of the XORed nonces, ciphertext followed by the GCM tag; checksum = MD5 (hex) of the document before encryption',
  'FHIR documents (fhirRecords.js): validate a sample of each (OPConsultRecord, PrescriptionRecord, DiagnosticReportRecord, DischargeSummaryRecord) with the NRCeS FHIR validator – section codes, vital-sign LOINC codes, and whether Practitioner needs the doctor\'s HPR ID and Organization the HFR ID',
  'Error codes: the codes and words ABDM expects in error answers (no records found, OTP wrong or expired, consent not found or expired)',
  "Consent artefact signature (NOT checked yet): verify notification.signature of every consent with the consent manager's public key (which key, and over which serialisation of consentDetail) and refuse a GRANTED consent whose signature does not match; until then Perinexa relies on the gateway check above, binds a consent to a record only when its patient.id is that patient's ABHA address, and treats a withdrawn, expired or refused consent as final",
  'Request ids: Perinexa makes the REQUEST-ID of generate-token and link/carecontext itself and saves the records as waiting before calling, so a fast answer finds them – check that ABDM answers with response.requestId = that REQUEST-ID; records with no answer for 30 minutes may be linked again',
];

/**
 * Milestone M3 (asking for her records from other hospitals – the hospital as a Health Information User): what to
 * check against the sandbox documentation. Every call carries REQUEST-ID, TIMESTAMP, X-CM-ID and X-HIU-ID.
 */
export const ABDM_CHECKLIST_M3 = [
  'HIU: register the facility as a Health Information User too (Perinexa uses the HIP ID as its HIU ID – check that ABDM accepts the same HFR ID for both) and add the HIU services to the bridge',
  'Consent request: POST {hiecm}/consent/v3/request/init { consent: { purpose: { text: "Care Management", code: "CAREMGT", refUri }, patient: { id: <ABHA address> }, hiu: { id }, requester: { name, identifier: { type: "REGNO", value, system } }, hiTypes, permission: { accessMode: "VIEW", dateRange: { from, to }, dataEraseAt, frequency: { unit: "HOUR", value: 1, repeats: 0 } } } } → ABDM calls …/api/v3/hiu/consent/request/on-init { consentRequest: { id }, response.requestId }',
  "Requester: whether ABDM needs the doctor's HPR ID instead of the medical council registration number (sent as REGNO with system https://www.mciindia.org), and what to send for an RMO without a registration number",
  'Her answer: ABDM calls …/api/v3/hiu/consent/request/notify { notification: { consentRequestId, status: GRANTED | DENIED | REVOKED | EXPIRED, consentArtefacts: [{ id }] } } → POST {hiecm}/consent/v3/request/hiu/on-notify { acknowledgement: [{ consentId, status: "ok" }], response.requestId }',
  'Consent details: POST {hiecm}/consent/v3/fetch { consentId } → ABDM calls …/api/v3/hiu/consent/on-fetch { consent: { status, consentDetail: { consentId, patient.id, hip: { id, name }, hiu.id, careContexts, hiTypes, permission: { dateRange, dataEraseAt } } }, response.requestId }',
  'Records: POST {hiecm}/data-flow/v3/health-information/request { hiRequest: { consent: { id }, dateRange, dataPushUrl, keyMaterial } } → ABDM calls …/api/v3/hiu/health-information/on-request { hiRequest: { transactionId, sessionStatus }, response.requestId }',
  'Data push: the other hospital posts to the dataPushUrl https://<host>/api/abdm/public/api/v3/hiu/data/push/<HIU ID> { pageNumber, pageCount, transactionId, entries: [{ content, media: "application/fhir+json", checksum, careContextReference }], keyMaterial } – check whether ABDM routes it through the gateway (signed, perhaps to a fixed path); Perinexa accepts a page only for a transfer it is waiting for, only for the records in the consent, once per page, and only while the consent and its one-time key are valid',
  'Transfer notify: POST {hiecm}/data-flow/v3/health-information/notify { notification: { consentId, transactionId, doneAt, notifier: { type: "HIU", id }, statusNotification: { sessionStatus: "TRANSFERRED" | "FAILED", hipId, statusResponses: [{ careContextReference, hiStatus: "OK" | "ERRORED", description }] } } }',
  "Decryption (fidelius.js, from the receiving side): with ABDM's Fidelius test vectors – Perinexa's key is sent as X.509 with Curve25519 written out; the checksum (MD5, hex, of the document before encryption) – a document whose checksum does not match is kept and marked on screen",
  'Deletion: the records are deleted at dataEraseAt (checked every 15 minutes and whenever her records are opened) and at once on REVOKED or EXPIRED – check whether ABDM also expects a confirmation',
  'Reading (fhirReader.js): try documents from several HIPs in the sandbox – NRCeS profiles, nested sections, attachments as DocumentReference, Binary or Media, and how other HIPs write dates, doses (text or structured: doseAndRate, timing.repeat) and statuses (stopped, cancelled, refuted, entered-in-error, preliminary)',
  "Consent details: Perinexa asks for records only when the consent names her ABHA address and this hospital's HIU ID; check that on-fetch always carries patient.id and hiu.id, and verify the consent's signature (not checked yet, as for M2)",
  'Data push limits: at most 500 pages in one transfer (more: the transfer is marked failed with that reason, and ABDM told) and a page of at most 30 MB; the public addresses have their own limit of 3000 calls a minute from one address (ABDM gateway and other hospitals)',
];

const base = () => BASES[config.ABDM_MODE];
const listOf = (v) => (Array.isArray(v) ? v : []);

/**
 * Is this (signature-checked) token ABDM's gateway's own? Its client is the gateway (ABDM_GATEWAY_CLIENT_ID, default
 * "gateway"), or it carries the gateway role. Every hospital's and app's own session token is signed with the same
 * keys, so a valid signature alone is not enough (ABDM_CHECKLIST_M2).
 */
export function fromGateway(claims, gatewayId = config.ABDM_GATEWAY_CLIENT_ID || 'gateway') {
  if (!claims || typeof claims !== 'object') return false;
  const id = String(claims.clientId ?? claims.azp ?? '');
  const roles = [...listOf(claims.realm_access?.roles), ...listOf(claims.resource_access?.[id]?.roles)];
  return id === gatewayId || roles.includes('gateway');
}
const fail = (status, data) => new HttpError(502, `ABDM did not accept the request (${status}${data?.code ? `, ${data.code}` : ''}): ${data?.message ?? data?.error?.message ?? 'no reason given'}.`, 'ABDM');

let session = null; // { token, until }
let publicKey = null; // { key, until }
let gatewayKeys = null; // { keys: Map(kid -> KeyObject), until }

const headers = (extra = {}) => ({ 'Content-Type': 'application/json', 'REQUEST-ID': randomUUID(), TIMESTAMP: new Date().toISOString(), 'X-CM-ID': base().cm, ...extra });

async function call(url, { method = 'GET', body, token = true, extra = {} } = {}) {
  const auth = token ? { Authorization: `Bearer ${await sessionToken()}` } : {};
  let res;
  try {
    res = await fetch(url, { method, headers: headers({ ...auth, ...extra }), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(502, 'Could not reach ABDM. Please try again in a moment.', 'ABDM');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw fail(res.status, data);
  return data;
}

async function sessionToken() {
  if (session && session.until > Date.now()) return session.token;
  if (!config.ABDM_CLIENT_ID || !config.ABDM_CLIENT_SECRET) throw new HttpError(503, 'ABDM is not set up: add ABDM_CLIENT_ID and ABDM_CLIENT_SECRET to server/.env.', 'ABDM_NOT_SET_UP');
  const data = await call(`${base().gateway}/sessions`, { method: 'POST', token: false, body: { clientId: config.ABDM_CLIENT_ID, clientSecret: config.ABDM_CLIENT_SECRET, grantType: 'client_credentials' } });
  session = { token: data.accessToken, until: Date.now() + Math.max(60, (data.expiresIn ?? 600) - 60) * 1000 };
  return session.token;
}

async function encrypt(value) {
  if (!publicKey || publicKey.until < Date.now()) {
    const data = await call(`${base().abha}/profile/public/certificate`);
    const pem = `-----BEGIN PUBLIC KEY-----\n${String(data.publicKey ?? data).replace(/-----[^-]+-----|\s/g, '').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    publicKey = { key: createPublicKey(pem), until: Date.now() + 6 * 3600 * 1000 };
  }
  return publicEncrypt({ key: publicKey.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(String(value))).toString('base64');
}

/** ABDM's profile → ours. */
function profileOf(p) {
  if (!p) return null;
  return {
    abhaNumber: abhaNumber(p.ABHANumber ?? p.abhaNumber ?? p.healthIdNumber),
    abhaAddress: (p.preferredAbhaAddress ?? p.abhaAddress ?? p.phrAddress?.[0] ?? '').toLowerCase(),
    name: p.name ?? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
    gender: p.gender ?? '',
    yearOfBirth: Number(p.yearOfBirth ?? String(p.dob ?? p.dateOfBirth ?? '').slice(-4)) || null,
    mobile: p.mobile ?? '',
    address: p.address ?? '',
  };
}

export const v3Client = {
  get mode() {
    return config.ABDM_MODE;
  },

  async requestLoginOtp({ hint, value }) {
    const scope = hint === 'mobile' ? ['abha-login', 'mobile-verify'] : ['abha-login', 'mobile-verify'];
    const data = await call(`${base().abha}/profile/login/request/otp`, {
      method: 'POST',
      body: { scope, loginHint: hint === 'abha-address' ? 'abha-address' : hint, loginId: await encrypt(hint === 'abha-number' ? value.replace(/-/g, '') : value), otpSystem: 'abdm' },
    });
    return { txnId: data.txnId, sentTo: data.message ?? '' };
  },

  async verifyLoginOtp({ txnId, otp }) {
    const data = await call(`${base().abha}/profile/login/verify`, {
      method: 'POST',
      body: { scope: ['abha-login', 'mobile-verify'], authData: { authMethods: ['otp'], otp: { txnId, otpValue: await encrypt(otp) } } },
    });
    const token = data.token ?? data.tokens?.token;
    const accounts = (data.accounts ?? []).map(profileOf);
    if (accounts.length === 1 && token) {
      const full = await call(`${base().abha}/profile/account`, { extra: { 'X-token': `Bearer ${token}` } });
      return { accounts: [profileOf(full)], token };
    }
    return { accounts, token };
  },

  async requestEnrolOtp({ aadhaar }) {
    const data = await call(`${base().abha}/enrollment/request/otp`, {
      method: 'POST',
      body: { txnId: '', scope: ['abha-enrol'], loginHint: 'aadhaar', loginId: await encrypt(aadhaar), otpSystem: 'aadhaar' },
    });
    return { txnId: data.txnId, sentTo: data.message ?? '' };
  },

  async enrolByAadhaar({ txnId, otp, mobile }) {
    const data = await call(`${base().abha}/enrollment/enrol/byAadhaar`, {
      method: 'POST',
      body: { authData: { authMethods: ['otp'], otp: { txnId, otpValue: await encrypt(otp), mobile } }, consent: { code: 'abha-enrollment', version: '1.4' } },
    });
    return { profile: profileOf(data.ABHAProfile ?? data.profile), token: data.tokens?.token ?? data.token, isNew: data.isNew !== false, txnId: data.txnId ?? txnId };
  },

  async addressSuggestions({ txnId }) {
    const data = await call(`${base().abha}/enrollment/enrol/suggestion`, { extra: { Transaction_Id: txnId } });
    return data.abhaAddressList ?? [];
  },

  async setAddress({ txnId, address }) {
    const data = await call(`${base().abha}/enrollment/enrol/abha-address`, { method: 'POST', body: { txnId, abhaAddress: address.split('@')[0], preferred: 1 } });
    return { abhaAddress: (data.preferredAbhaAddress ?? address).toLowerCase() };
  },

  async card({ token }) {
    const url = `${base().abha}/profile/account/abha-card`;
    const res = await fetch(url, { headers: headers({ Authorization: `Bearer ${await sessionToken()}`, 'X-token': `Bearer ${token}` }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) throw new HttpError(502, 'ABDM did not send the ABHA card. Please try again.', 'ABDM');
    return { contentType: res.headers.get('content-type') ?? 'image/png', base64: Buffer.from(await res.arrayBuffer()).toString('base64') };
  },

  /** Checks a Scan & Share message's ABDM signature (Authorization: Bearer <JWT>) – throws a 401 otherwise. */
  async verifyShareRequest(authorization) {
    const token = String(authorization ?? '').replace(/^Bearer\s+/i, '');
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded?.header?.kid) throw new HttpError(401, 'Not signed by ABDM.', 'NOT_AUTHENTICATED');
    if (!gatewayKeys || gatewayKeys.until < Date.now()) {
      const data = await call(`${base().gateway}/certs`, { token: false });
      gatewayKeys = { keys: new Map((data.keys ?? []).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])), until: Date.now() + 3600 * 1000 };
    }
    const key = gatewayKeys.keys.get(decoded.header.kid);
    if (!key) throw new HttpError(401, 'Not signed by ABDM.', 'NOT_AUTHENTICATED');
    let claims;
    try {
      claims = jwt.verify(token, key, { algorithms: ['RS256', 'RS512'] });
    } catch {
      throw new HttpError(401, 'Not signed by ABDM.', 'NOT_AUTHENTICATED');
    }
    // Signed by ABDM is not enough: it must be ABDM's gateway, not another hospital's own session token
    if (!fromGateway(claims)) throw new HttpError(401, "Not sent by ABDM's gateway.", 'NOT_AUTHENTICATED');
  },

  /** Tells ABDM the token number given to a Scan & Share (the patient sees it in her ABHA app). */
  async acknowledgeShare({ requestId, hipId, abhaAddress, context, token }) {
    await call(`${base().gateway}/patient-share/on-share`, {
      method: 'POST',
      extra: { 'X-HIP-ID': hipId },
      body: { acknowledgement: { status: 'SUCCESS', abhaAddress, profile: { context, tokenNumber: String(token), expiry: '1800' } }, response: { requestId } },
    });
  },
};

// ---------- M2: sharing her records (the hospital as a Health Information Provider) ----------

const hip = (hipId) => ({ 'X-HIP-ID': hipId });
const digits = (n) => String(n ?? '').replace(/\D/g, '');

/** Care contexts grouped by ABDM health information type, as ABDM's V3 linking and discovery expect them. */
export function careContextGroups(patient, careContexts) {
  const types = [...new Set(careContexts.flatMap((c) => c.hiTypes))];
  return types.map((hiType) => {
    const own = careContexts.filter((c) => c.hiTypes.includes(hiType)).map((c) => ({ referenceNumber: c.reference, display: c.display }));
    return { referenceNumber: patient.reference, display: patient.display, careContexts: own, hiType, count: own.length };
  });
}

/** The push address must be https and not a private or local address (it comes from ABDM's signed request). */
export function pushAddressAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.includes(':') && (h.startsWith('::') || /^(fc|fd|fe80)/.test(h))) return false; // IPv6 loopback, local and private
  return true;
}

Object.assign(v3Client, {
  /** Checks that a message really comes from ABDM (its signature) – throws a 401 otherwise. */
  verifyRequest(authorization) {
    return v3Client.verifyShareRequest(authorization);
  },

  /**
   * Linking records by the hospital, step 1: ask ABDM for a link token (ABDM answers later, on-generate-token, with
   * response.requestId = requestId – made and saved by the caller first, so a fast answer finds the records).
   */
  async startLink({ hipId, requestId = randomUUID(), abha }) {
    await call(`${base().hiecm}/v3/token/generate-token`, {
      method: 'POST',
      extra: { ...hip(hipId), 'REQUEST-ID': requestId },
      body: { abhaNumber: digits(abha.number), abhaAddress: abha.address, name: abha.name, gender: abha.gender || 'F', yearOfBirth: abha.yearOfBirth ?? undefined },
    });
    return { status: 'waiting', step: 'token', requestId };
  },

  /** Step 2, with the token: link the records (ABDM answers later, on_carecontext, with this requestId). */
  async linkWithToken({ hipId, requestId = randomUUID(), linkToken, abha, patient, careContexts }) {
    await call(`${base().hiecm}/hip/v3/link/carecontext`, {
      method: 'POST',
      extra: { ...hip(hipId), 'REQUEST-ID': requestId, 'X-LINK-TOKEN': linkToken },
      body: { abhaNumber: digits(abha.number), abhaAddress: abha.address, patient: careContextGroups(patient, careContexts) },
    });
    return { requestId };
  },

  async onDiscover({ hipId, requestId, transactionId, patient, careContexts, matchedBy, error }) {
    await call(`${base().hiecm}/user-initiated-linking/v3/patient/care-context/on-discover`, {
      method: 'POST',
      extra: hip(hipId),
      body: error ? { transactionId, error, response: { requestId } } : { transactionId, patient: careContextGroups(patient, careContexts), matchedBy, response: { requestId } },
    });
  },

  async onLinkInit({ hipId, requestId, transactionId, linkRef, expiry, error }) {
    await call(`${base().hiecm}/user-initiated-linking/v3/link/care-context/on-init`, {
      method: 'POST',
      extra: hip(hipId),
      body: error
        ? { transactionId, error, response: { requestId } }
        : { transactionId, link: { referenceNumber: linkRef, authenticationType: 'DIRECT', meta: { communicationMedium: 'MOBILE', communicationHint: 'OTP', communicationExpiry: expiry } }, response: { requestId } },
    });
  },

  async onLinkConfirm({ hipId, requestId, patient, careContexts, error }) {
    await call(`${base().hiecm}/user-initiated-linking/v3/link/care-context/on-confirm`, {
      method: 'POST',
      extra: hip(hipId),
      body: error ? { error, response: { requestId } } : { patient: careContextGroups(patient, careContexts), response: { requestId } },
    });
  },

  async consentOnNotify({ hipId, requestId, consentId, error }) {
    await call(`${base().hiecm}/consent/v3/request/hip/on-notify`, {
      method: 'POST',
      extra: hip(hipId),
      body: error ? { acknowledgement: { status: 'ok', consentId }, error, response: { requestId } } : { acknowledgement: { status: 'ok', consentId }, response: { requestId } },
    });
  },

  async healthInfoOnRequest({ hipId, requestId, transactionId, status, error }) {
    await call(`${base().hiecm}/data-flow/v3/health-information/hip/on-request`, {
      method: 'POST',
      extra: hip(hipId),
      body: { hiRequest: { transactionId, sessionStatus: status }, ...(error ? { error } : {}), response: { requestId } },
    });
  },

  /** One page of encrypted records to the push address ABDM gave. Our session token only goes to ABDM's own host. */
  async pushData({ url, body }) {
    if (!pushAddressAllowed(url)) throw new HttpError(400, 'The address to send the records to is not allowed.', 'ABDM');
    const onGateway = new URL(url).host === new URL(base().hiecm).host;
    const auth = onGateway ? { Authorization: `Bearer ${await sessionToken()}` } : {};
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: headers(auth), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new HttpError(502, 'Could not reach the address to send the records to.', 'ABDM');
    }
    if (!res.ok) throw new HttpError(502, `The records were not accepted (${res.status}).`, 'ABDM');
  },

  async healthInfoNotify({ hipId, consentId, transactionId, sessionStatus, statusResponses, doneAt }) {
    await call(`${base().hiecm}/data-flow/v3/health-information/notify`, {
      method: 'POST',
      extra: hip(hipId),
      body: { notification: { consentId, transactionId, doneAt, notifier: { type: 'HIP', id: hipId }, statusNotification: { sessionStatus, hipId, statusResponses } } },
    });
  },
});

// ---------- M3: asking for her records from other hospitals (the hospital as a Health Information User) ----------

const hiu = (hiuId) => ({ 'X-HIU-ID': hiuId });

Object.assign(v3Client, {
  /** The consent request (ABDM answers later, on-init, with its id). */
  async consentRequestInit({ hiuId, requestId, consent }) {
    await call(`${base().hiecm}/consent/v3/request/init`, { method: 'POST', extra: { ...hiu(hiuId), 'REQUEST-ID': requestId }, body: { consent } });
    return {};
  },

  /** Acknowledges ABDM's notification of her answer (or of a consent withdrawn or ended). */
  async hiuOnNotify({ hiuId, requestId, consentIds }) {
    await call(`${base().hiecm}/consent/v3/request/hiu/on-notify`, { method: 'POST', extra: hiu(hiuId), body: { acknowledgement: consentIds.map((consentId) => ({ consentId, status: 'ok' })), response: { requestId } } });
  },

  /** Asks for the details of one consent (ABDM answers later, on-fetch). */
  async fetchConsent({ hiuId, requestId, consentId }) {
    await call(`${base().hiecm}/consent/v3/fetch`, { method: 'POST', extra: { ...hiu(hiuId), 'REQUEST-ID': requestId }, body: { consentId } });
    return {};
  },

  /** Asks for the records of one consent, with Perinexa's one-time public key (ABDM answers later, on-request). */
  async requestHealthInfo({ hiuId, requestId, consentId, dateRange, dataPushUrl, keyMaterial }) {
    await call(`${base().hiecm}/data-flow/v3/health-information/request`, { method: 'POST', extra: { ...hiu(hiuId), 'REQUEST-ID': requestId }, body: { hiRequest: { consent: { id: consentId }, dateRange, dataPushUrl, keyMaterial } } });
    return {};
  },

  /** Tells ABDM which records arrived (OK) and which did not (ERRORED). */
  async healthInfoNotifyHiu({ hiuId, consentId, transactionId, hipId, sessionStatus, statusResponses, doneAt }) {
    await call(`${base().hiecm}/data-flow/v3/health-information/notify`, {
      method: 'POST',
      extra: hiu(hiuId),
      body: { notification: { consentId, transactionId, doneAt, notifier: { type: 'HIU', id: hiuId }, statusNotification: { sessionStatus, hipId, statusResponses } } },
    });
  },
});

export { profileOf };
