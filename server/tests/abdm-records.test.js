// ABDM milestone M2 – sharing her records through her ABHA (the hospital as a Health Information Provider), in
// practice mode and with a stand-in for ABDM's V3 APIs: the encryption (with fixed keys, and checked against OpenSSL's
// own ECDH on the curve ABDM's reference library uses), which records may be shared, the FHIR documents, who may see
// and link her records, linking from her ABHA app, consents, sending, refusals, and the audit log. Made-up data only.
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abdmClient, abdmIdle, setAbdmClientForTests } from '../src/abdm/abdmService.js';
import { checkRequest } from '../src/abdm/abdmRecords.js';
import { WEIERSTRASS, checksumOf, decryptFrom, encryptFor, keyAndIv, newKeyPair, readPublicKey, requesterKeyMaterial, sharedSecret } from '../src/abdm/fidelius.js';
import { dosageText, medicineName } from '../src/abdm/fhirRecords.js';
import { practiceClient, practiceSent, resetPractice } from '../src/abdm/practiceClient.js';
import { CONFIDENTIAL_WORDS, CONFIDENTIAL_WORD_LIST, dischargeRecord, labRecord, mentionsConfidential, parseReference, recordsOf, referenceOf, visitRecord, withinRange } from '../src/abdm/shareRules.js';
import { ABDM_CHECKLIST_M2, fromGateway, pushAddressAllowed, v3Client } from '../src/abdm/v3Client.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { AbdmCareContext } from '../src/models/AbdmCareContext.js';
import { AbdmConsent } from '../src/models/AbdmConsent.js';
import { AbdmLinkRequest } from '../src/models/AbdmLinkRequest.js';
import { AbdmTransfer } from '../src/models/AbdmTransfer.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { TEST_SENDER, setTestSender, testSent } from '../src/reminders/sender.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { HttpError } from '../src/utils/httpError.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:30 in India
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharm: 'pharmacist', admin: 'admin' };
const SHARE_ACTIONS = ['ABDM_RECORDS_VIEWED', 'ABDM_RECORDS_LINKED', 'ABDM_RECORDS_DISCOVERED', 'ABDM_CONSENT_RECEIVED', 'ABDM_RECORDS_SHARED', 'ABDM_SHARE_REFUSED'];
// Words typed on the record that must never leave through ABDM
const NEVER = ['PRIVATE-NOTE-TEXT', 'WARNING-REASON-TEXT', 'REVIEW-COMMENT-TEXT', 'NOTE-TO-LAB-TEXT', 'HIV 1 and 2', 'Reactive'];

let app;
let hospital;
let other;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetPractice();
  setAbdmClientForTests(null);
  setTestSender(null);
  app = createApp({ apiRateLimitMax: 100000 });
  hospital = await createTenant('ABDM Share Hospital');
  other = await createTenant('Other ABDM Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.outsider = await createUser({ name: 'Dr Outside' });
  await addMember(people.outsider, other, 'doctor');
});
afterEach(async () => {
  await abdmIdle();
  vi.useRealTimers();
  setAbdmClientForTests(null);
  setTestSender(null);
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const FOLIC = { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' };
const visits = (p, path = '') => `/api/patients/${p.id}/visits${path}`;
const stays = (p, path = '') => `/api/patients/${p.id}/admissions${path}`;
const lab = (path) => `/api/lab/orders/${path}`;
const records = async (who, p) => (await as(who)).get(`/api/abdm/patients/${p.id}/records`);
const post = async (who, path, body) => (await as(who)).post(`/api/abdm${path}`).send(body);

async function register(name = 'Share Mother', extra = {}) {
  const res = await (await as('drA')).post('/api/patients').send(
    samplePatient({ careType: 'antenatal', fullName: name, ageYears: 29, phone: '+91 98765 00001', assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-03-01' }, ...extra }),
  );
  return ok(res, 201).patient;
}

/** Her ABHA verified with the practice OTP and linked to her record (the made-up practice ABHA). */
async function linkAbha(p, value = '91-1111-2222-3333') {
  const r = ok(await post('reception', '/verify/request', { patientId: p.id, hint: 'abha-number', value }));
  ok(await post('reception', '/verify/confirm', { id: r.id, otp: '123456' }));
  ok(await post('reception', '/verify/link', { id: r.id, abhaNumber: value, consent: true }));
}

/** A visit with vital signs, notes (with a private note), a prescription; signed unless sign: false. */
async function visit(p, { visitOn = '2026-09-21', diagnosis = 'Normal pregnancy', sign = true, items = [FOLIC] } = {}) {
  const drA = await as('drA');
  const v = ok(await drA.post(visits(p)).send({ clientRequestId: randomUUID(), visitOn }), 201).visit;
  ok(await drA.patch(visits(p, `/${v.id}`)).send({ vitals: { rev: 0, weightKg: 58, bpSystolic: 110, bpDiastolic: 70, pulse: 82 } }));
  ok(
    await drA.patch(visits(p, `/${v.id}`)).send({
      details: { rev: 0, complaints: 'Mild nausea', diagnosis, advice: 'Rest well', privateNote: 'PRIVATE-NOTE-TEXT', fundalHeightCm: 16, investigations: 'CBC next visit', nextVisitOn: '2026-10-19' },
    }),
  );
  if (items.length) ok(await drA.put(visits(p, `/${v.id}/prescription`)).send({ rev: 0, items, notes: 'Take after breakfast' }));
  // The reasons a doctor gave to go ahead despite a medicine warning (never printed, never shared)
  await Visit.updateOne({ tenantId: hospital._id, _id: v.id }, { $set: { 'prescription.warningReasons': [{ key: 'k', level: 'avoid', title: 'Sample warning', medicines: ['Folic acid'], reason: 'WARNING-REASON-TEXT' }] } });
  if (sign) ok(await drA.post(visits(p, `/${v.id}/sign`)).send({ revs: { vitals: 1, details: 1, prescription: items.length ? 1 : 0 } }));
  return v;
}

/** A lab order reported and (unless review: false) reviewed. tests: the tests and their values. */
async function labOrder(p, tests, { review = true } = {}) {
  const drA = await as('drA');
  const labUser = await as('lab');
  let o = ok(await drA.post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: tests.map((t) => ({ key: t.key })), noteToLab: 'NOTE-TO-LAB-TEXT' }), 201).order;
  o = ok(await labUser.post(lab(`${o.id}/collect`)).send({ rev: o.rev })).order;
  o = ok(await labUser.put(lab(`${o.id}/results`)).send({ rev: o.rev, tests, labNote: 'Sample clear', report: true })).order;
  if (review) o = ok(await drA.post(lab(`${o.id}/review`)).send({ rev: o.rev, comment: 'REVIEW-COMMENT-TEXT' })).order;
  return o;
}
const CBC = { key: 'cbc', values: [{ key: 'hb', value: '9.5' }, { key: 'tlc', value: '8000' }, { key: 'platelets', value: '2.1' }] };
const HIV = { key: 'hiv', values: [{ key: 'hiv', value: 'Reactive' }] };

/** A stay with a discharge card confirmed by her doctor (unless sign: false). */
async function discharge(p, { sign = true } = {}) {
  const drA = await as('drA');
  const a = ok(await drA.post(stays(p)).send({ clientRequestId: randomUUID(), admittedAt: '2026-10-01T04:00:00.000Z', ward: 'Ward 1', bed: '3', reason: 'Observation' }), 201).admission;
  const d = ok(await drA.post(stays(p, `/${a.id}/documents`)).send({ clientRequestId: randomUUID(), kind: 'discharge' }), 201).document;
  const saved = ok(
    await drA.put(stays(p, `/${a.id}/documents/${d.id}`)).send({
      rev: d.rev,
      content: { dischargedAt: '2026-10-03T06:00:00.000Z', finalDiagnosis: 'Hyperemesis, settled', course: 'IV fluids for two days', conditionAtDischarge: 'Well', medicines: [FOLIC], advice: 'Small meals', followUpOn: '2026-10-10' },
    }),
  ).document;
  if (sign) ok(await drA.post(stays(p, `/${a.id}/documents/${d.id}/sign`)).send({ rev: saved.rev }));
  return saved;
}

/** A patient with her ABHA and something of everything. */
async function fullRecord() {
  const p = await register();
  await linkAbha(p);
  const v1 = await visit(p);
  const v2 = await visit(p, { visitOn: '2026-09-28', sign: false }); // not signed yet
  const v3 = await visit(p, { visitOn: '2026-09-14', sign: false });
  ok(await (await as('drA')).post(visits(p, `/${v3.id}/cancel`)).send({ reason: 'Wrong patient' })); // entered in error
  const mixed = await labOrder(p, [CBC, HIV]); // shared without the HIV test
  const hivOnly = await labOrder(p, [HIV]); // never shared
  const unreviewed = await labOrder(p, [CBC], { review: false });
  const card = await discharge(p);
  return { p, v1, v2, v3, mixed, hivOnly, unreviewed, card };
}
const byRef = (items) => Object.fromEntries(items.map((i) => [i.reference, i]));

// ---------- Encryption ----------

/** An EC key on Curve25519 in its Weierstrass form, as ABDM's reference library (BouncyCastle) makes it – via OpenSSL. */
function weierstrassKeyPair(d) {
  const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
  const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
  const seq = (...x) => tlv(0x30, Buffer.concat(x));
  const int = (v) => {
    let h = v.toString(16);
    if (h.length % 2) h = `0${h}`;
    let b = Buffer.from(h, 'hex');
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return tlv(0x02, b);
  };
  const be32 = (v) => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
  const W = WEIERSTRASS;
  const params = seq(int(1n), seq(Buffer.from('06072a8648ce3d0101', 'hex'), int(W.p)), seq(tlv(0x04, be32(W.a)), tlv(0x04, be32(W.b))), tlv(0x04, Buffer.concat([Buffer.from([4]), be32(W.gx), be32(W.gy)])), int(W.n), int(W.h));
  const alg = seq(Buffer.from('06072a8648ce3d0201', 'hex'), params);
  const privateKey = createPrivateKey({ key: seq(int(0n), alg, tlv(0x04, seq(int(1n), tlv(0x04, be32(d))))), format: 'der', type: 'pkcs8' });
  return { privateKey, spki: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) };
}

describe('encryption (ECDH on Curve25519, HKDF-SHA256, AES-256-GCM)', () => {
  const HIP_KEY = Buffer.alloc(32, 7);
  const HIU_KEY = Buffer.alloc(32, 9);
  const HIP_NONCE = Buffer.alloc(32, 1).toString('base64');
  const HIU_NONCE = Buffer.alloc(32, 2).toString('base64');

  it('uses the Weierstrass form of Curve25519 that ABDM’s reference library uses (BouncyCastle’s constants)', () => {
    expect(WEIERSTRASS.a.toString(16)).toBe('2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a144');
    expect(WEIERSTRASS.b.toString(16)).toBe('7b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c864');
    expect(WEIERSTRASS.gx.toString(16)).toBe('2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245a');
    expect(WEIERSTRASS.gy.toString(16)).toBe('20ae19a1b8a086b4e01edd2c7748d14c923d4d7e6d7c61b229e9c5a27eced3d9');
    // The X.509 key of a requester starts as ABDM's examples do (the curve written out)
    expect(requesterKeyMaterial({ privateRaw: HIU_KEY }).keyMaterial.dhPublicKey.keyValue).toMatch(/^MIIBMTCB6gYHKoZIzj0CATCB3gIBATArBgcqhkjOPQEBAiB\/+7TBEBCAq/);
  });

  it('with fixed keys: the same data every time, and the requester decrypts it with its private key', () => {
    const hiu = requesterKeyMaterial({ privateRaw: HIU_KEY, nonce: HIU_NONCE, expiry: '2026-10-06T06:00:00.000Z' });
    const send = () => encryptFor({ text: '{"resourceType":"Bundle"}', requester: { publicKey: hiu.keyMaterial.dhPublicKey.keyValue, nonce: HIU_NONCE }, keys: newKeyPair(HIP_KEY), nonce: HIP_NONCE, expiry: 'x' });
    const a = send();
    expect(send()).toEqual(a);
    expect(a.keyMaterial).toMatchObject({ cryptoAlg: 'ECDH', curve: 'Curve25519', dhPublicKey: { expiry: 'x', parameters: 'Curve25519/32byte random key' }, nonce: HIP_NONCE });
    expect(readPublicKey(a.keyMaterial.dhPublicKey.keyValue).shape).toBe('ec-spki'); // answered in the requester's shape
    const back = decryptFrom({ encryptedData: a.encryptedData, sender: { publicKey: a.keyMaterial.dhPublicKey.keyValue, nonce: HIP_NONCE }, ours: { privateRaw: hiu.privateRaw, nonce: HIU_NONCE } });
    expect(back).toBe('{"resourceType":"Bundle"}');
    // Changed in transit: refused
    const bytes = Buffer.from(a.encryptedData, 'base64');
    bytes[0] ^= 1;
    expect(() => decryptFrom({ encryptedData: bytes.toString('base64'), sender: { publicKey: a.keyMaterial.dhPublicKey.keyValue, nonce: HIP_NONCE }, ours: { privateRaw: hiu.privateRaw, nonce: HIU_NONCE } })).toThrow();
    // A requester using X25519 keys (32 bytes) is answered with X25519
    const x = requesterKeyMaterial({ shape: 'x25519-raw', privateRaw: HIU_KEY, nonce: HIU_NONCE });
    const b = encryptFor({ text: 'sample', requester: { publicKey: x.keyMaterial.dhPublicKey.keyValue, nonce: HIU_NONCE }, keys: newKeyPair(HIP_KEY), nonce: HIP_NONCE });
    expect(Buffer.from(b.keyMaterial.dhPublicKey.keyValue, 'base64')).toHaveLength(32);
    expect(decryptFrom({ encryptedData: b.encryptedData, sender: { publicKey: b.keyMaterial.dhPublicKey.keyValue, nonce: HIP_NONCE }, ours: { privateRaw: x.privateRaw, nonce: HIU_NONCE } })).toBe('sample');
  });

  it('a requester doing ordinary ECDH on the Weierstrass curve (OpenSSL – as BouncyCastle does) gets the same secret and can decrypt', () => {
    const d = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcden % WEIERSTRASS.n;
    const hiu = weierstrassKeyPair(d);
    const hiuKey = hiu.spki.toString('base64');
    const ours = newKeyPair(HIP_KEY);
    const out = encryptFor({ text: 'Sample report text', requester: { publicKey: hiuKey, nonce: HIU_NONCE }, keys: ours, nonce: HIP_NONCE });
    // The requester's side, with OpenSSL's own ECDH on the explicit curve (no X25519 anywhere)
    const ourPublic = createPublicKey({ key: Buffer.from(out.keyMaterial.dhPublicKey.keyValue, 'base64'), format: 'der', type: 'spki' });
    const secret = diffieHellman({ privateKey: hiu.privateKey, publicKey: ourPublic });
    expect(secret).toEqual(sharedSecret(ours, readPublicKey(hiuKey)));
    const { key, iv } = keyAndIv(secret, HIU_NONCE, HIP_NONCE);
    const all = Buffer.from(out.encryptedData, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(all.subarray(-16));
    expect(Buffer.concat([decipher.update(all.subarray(0, -16)), decipher.final()]).toString()).toBe('Sample report text');
    // The bare 65-byte point (04‖x‖y) is read too, and answered the same way
    const raw = Buffer.from(hiu.spki.subarray(-65)).toString('base64');
    expect(Buffer.from(encryptFor({ text: 'x', requester: { publicKey: raw, nonce: HIU_NONCE } }).keyMaterial.dhPublicKey.keyValue, 'base64')).toHaveLength(65);
  });

  it('refuses a key that is not Curve25519, and a nonce that is not 32 bytes', () => {
    const p256 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => readPublicKey(p256)).toThrow(/not a Curve25519 key/);
    expect(() => readPublicKey(Buffer.alloc(65, 4).toString('base64'))).toThrow();
    const hiu = requesterKeyMaterial();
    expect(() => encryptFor({ text: 'x', requester: { publicKey: hiu.keyMaterial.dhPublicKey.keyValue, nonce: 'c2hvcnQ=' } })).toThrow(/32 bytes/);
    expect(checksumOf('abc')).toBe(createHash('md5').update('abc').digest('hex'));
  });
});

// ---------- What may be shared ----------

describe('which records may be shared (pure)', () => {
  const id = () => new mongoose.Types.ObjectId();
  const signed = { by: id(), byName: 'Dr Sample', role: 'doctor', at: NOW };

  it('a signed visit; not yet when unsigned; never when entered in error or when it mentions HIV', () => {
    const v = { _id: id(), visitOn: new Date('2026-09-21'), status: 'active', signed, details: { diagnosis: 'Normal pregnancy' }, prescription: { items: [FOLIC] } };
    expect(visitRecord(v)).toMatchObject({ state: 'ready', hiTypes: ['OPConsultation', 'Prescription'], display: 'OPD visit on 21 Sep 2026' });
    expect(visitRecord({ ...v, prescription: { items: [] } }).hiTypes).toEqual(['OPConsultation']);
    expect(visitRecord({ ...v, signed: null })).toMatchObject({ state: 'not_yet', reason: 'visit_not_signed' });
    expect(visitRecord({ ...v, status: 'cancelled' })).toMatchObject({ state: 'never', reason: 'entered_in_error' });
    expect(visitRecord({ ...v, details: { diagnosis: 'HIV reactive, on ART' } })).toMatchObject({ state: 'never', reason: 'mentions_confidential' });
    expect(visitRecord({ ...v, prescription: { items: [{ ...FOLIC, drug: 'Tenofovir + Lamivudine + Dolutegravir' }] } }).reason).toBe('mentions_confidential');
    // The private note is never shared, so it is not looked at
    expect(visitRecord({ ...v, details: { privateNote: 'HIV counselling done' } }).state).toBe('ready');
    expect(visitRecord({ ...v, additions: [{ text: 'PPTCT referral' }] }).reason).toBe('mentions_confidential');
    // The shorthand of Indian antenatal notes, and antiretroviral medicines by their abbreviations
    for (const words of [{ investigations: 'RVD NR, HBsAg NR, VDRL NR' }, { diagnosis: 'G2P1 28 wks, RVD reactive, on ART' }, { diagnosis: 'Retroviral disease on treatment' }, { investigations: 'Retro negative' }, { investigations: 'Tri-dot NR' }, { advice: 'CD4 count next visit' }]) {
      expect(visitRecord({ ...v, details: words }), JSON.stringify(words)).toMatchObject({ state: 'never', reason: 'mentions_confidential' });
    }
    expect(visitRecord({ ...v, prescription: { items: [{ ...FOLIC, drug: 'TLD', dose: '1', frequency: '1-0-0' }] } }).reason).toBe('mentions_confidential');
    // Words that only look alike are not about HIV
    for (const text of ['Two gestational sacs seen', 'Hives after penicillin', 'Retroverted uterus', 'Retroplacental clot', 'ART cycle planned (IVF)']) expect(mentionsConfidential([text]), text).toBe(false);
  });

  it('HIV among her known conditions: none of her visits or discharge summaries; her lab reports keep their own rules', () => {
    const v = { _id: id(), visitOn: new Date('2026-09-21'), status: 'active', signed, details: { diagnosis: 'G2P1, doing well' }, prescription: { items: [FOLIC] } };
    const o = { _id: id(), status: 'reviewed', reported: { at: NOW }, tests: [{ key: 'cbc', name: 'CBC', values: [] }] };
    const d = { _id: id(), status: 'signed', content: { dischargedAt: NOW, finalDiagnosis: 'Hyperemesis, settled' } };
    const sources = { visits: [v], orders: [o], discharges: [d] };
    const byKind = (patient) => Object.fromEntries(recordsOf(patient, sources).map((r) => [r.kind, [r.state, r.reason]]));
    expect(byKind({ medical: { conditions: ['anaemia'] } })).toEqual({ visit: ['ready', null], lab: ['ready', null], discharge: ['ready', null] });
    expect(byKind({ medical: { conditions: ['hiv'] } })).toEqual({ visit: ['never', 'hiv_on_record'], lab: ['ready', null], discharge: ['never', 'hiv_on_record'] });
    expect(byKind({ medical: { conditions: [], otherConditions: 'RVD positive, on treatment' } }).visit).toEqual(['never', 'hiv_on_record']);
    // A record marked sensitive says so first; an unsigned visit of hers is never shared either
    expect(byKind({ sensitive: true, medical: { conditions: ['hiv'] } }).visit).toEqual(['never', 'sensitive_record']);
    expect(recordsOf({ medical: { conditions: ['hiv'] } }, { visits: [{ ...v, signed: null }] })[0]).toMatchObject({ state: 'never', reason: 'hiv_on_record' });
    expect(dischargeRecord(d).state).toBe('ready');
  });

  it('lab results: reviewed only; the HIV test never (alone: the whole order; with others: left out)', () => {
    const o = { _id: id(), status: 'reviewed', reported: { at: NOW }, tests: [{ key: 'cbc', name: 'CBC', values: [] }, { key: 'hiv', name: 'HIV 1 and 2', values: [] }] };
    expect(labRecord(o)).toMatchObject({ state: 'ready', confidentialLeftOut: 1, display: 'Lab report of 5 Oct 2026' });
    expect(labRecord({ ...o, tests: [o.tests[1]] })).toMatchObject({ state: 'never', reason: 'confidential_test' });
    expect(labRecord({ ...o, tests: [{ key: 'other', name: 'HIV ELISA (typed)', values: [] }] }).reason).toBe('confidential_test');
    // A test the doctor typed as "RVD" or "Retro screening" is the HIV test too: left out of a report that is shared
    expect(labRecord({ ...o, tests: [{ key: 'other', name: 'RVD', values: [] }] }).reason).toBe('confidential_test');
    expect(labRecord({ ...o, tests: [o.tests[0], { key: 'other', name: 'Retro screening', values: [{ key: 'v', value: 'NR' }] }] })).toMatchObject({ state: 'ready', confidentialLeftOut: 1 });
    expect(labRecord({ ...o, status: 'reported' })).toMatchObject({ state: 'not_yet', reason: 'lab_not_reviewed' });
    expect(labRecord({ ...o, status: 'cancelled' })).toMatchObject({ state: 'never', reason: 'cancelled' });
    expect(labRecord({ ...o, labNote: 'Refer to ICTC' }).reason).toBe('mentions_confidential');
  });

  it('a record marked sensitive: nothing of it; references; the confidential words; dates as hospital days', () => {
    const v = { _id: id(), visitOn: new Date('2026-09-21'), status: 'active', signed, details: {}, prescription: { items: [] } };
    expect(recordsOf({ sensitive: true }, { visits: [v] })[0]).toMatchObject({ state: 'never', reason: 'sensitive_record' });
    const ref = referenceOf('visit', v._id);
    expect(parseReference(ref)).toEqual({ kind: 'visit', id: String(v._id) });
    expect(parseReference('V-123')).toBeNull();
    expect(mentionsConfidential(['ART cycle planned (IVF)'])).toBe(false); // assisted reproduction, not antiretroviral therapy
    expect(mentionsConfidential(['Seen at the ART centre'])).toBe(true);
    expect(CONFIDENTIAL_WORDS.length).toBeGreaterThan(5);
    expect(CONFIDENTIAL_WORD_LIST.map((w) => w.shown).join(' ')).toMatch(/RVD/); // shown on Hospital admin → ABDM
    expect(withinRange(new Date('2026-10-05'), '2026-10-05T06:00:00Z', '2026-10-05T07:00:00Z')).toBe(true);
    expect(withinRange(new Date('2026-10-04'), '2026-10-05T00:00:00Z', null)).toBe(false);
  });

  it('a consent is checked on every request: withdrawn, expired, refused, unknown or outside its dates sends nothing', () => {
    const c = { patientId: id(), status: 'GRANTED', from: new Date('2026-01-01'), to: new Date('2026-10-05'), expiresAt: new Date('2026-11-01') };
    expect(checkRequest(c, {}, NOW)).toMatchObject({ refusal: null });
    expect(checkRequest({ ...c, status: 'REVOKED' }, {}, NOW).refusal).toBe('consent_revoked');
    expect(checkRequest({ ...c, status: 'DENIED' }, {}, NOW).refusal).toBe('consent_denied');
    expect(checkRequest({ ...c, expiresAt: new Date('2026-10-05T05:59:00Z') }, {}, NOW).refusal).toBe('consent_expired');
    expect(checkRequest(null, {}, NOW).refusal).toBe('unknown_consent');
    expect(checkRequest({ ...c, patientId: null }, {}, NOW).refusal).toBe('unknown_consent');
    expect(checkRequest(c, { from: '2025-01-01', to: '2025-06-01' }, NOW).refusal).toBe('dates_outside_consent');
    // A consent that does not say until when it lasts, or its dates, is never taken as "for ever" or "any date"
    for (const gap of [{ expiresAt: null }, { from: null }, { to: null }]) expect(checkRequest({ ...c, ...gap }, {}, NOW).refusal, JSON.stringify(gap)).toBe('consent_incomplete');
    expect(checkRequest({ ...c, status: 'REVOKED', expiresAt: null }, {}, NOW).refusal).toBe('consent_revoked');
    // The dates that apply are inside both
    const r = checkRequest(c, { from: '2026-09-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }, NOW);
    expect([r.from.toISOString(), r.to.toISOString()]).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-05T00:00:00.000Z']);
  });

  it('medicines in words, and the push address must be https and not a local one', () => {
    expect(medicineName(FOLIC)).toBe('Tab. Folic acid 5 mg');
    expect(dosageText(FOLIC)).toBe('Dose 1, 1-0-0 (once a day, morning), after food, for 30 days');
    expect(dosageText({ frequency: 'custom', frequencyText: 'twice a week', durationUnit: 'till_delivery' })).toBe('twice a week, until delivery');
    expect(pushAddressAllowed('https://dev.abdm.gov.in/api/hiecm/data-flow/v3/health-information/transfer')).toBe(true);
    for (const bad of ['http://dev.abdm.gov.in/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://[::1]/x', 'not a url']) expect(pushAddressAllowed(bad), bad).toBe(false);
    expect(pushAddressAllowed('https://fcbank.example.com/push')).toBe(true);
  });
});

// ---------- Her ABHA tab: her records ----------

describe('her records on the ABHA tab', () => {
  it('her doctor and RMOs see them; another doctor reads but cannot link; nobody else; another hospital: not found', async () => {
    const { p, v1, v2, v3, mixed, hivOnly, unreviewed, card } = await fullRecord();
    const page = ok(await records('drA', p));
    expect(page).toMatchObject({ mode: 'practice', canLink: true, abhaLinked: true, block: null });
    const items = byRef(page.items);
    expect(items[`V-${v1.id}`]).toMatchObject({ state: 'ready', kind: 'visit', hiTypes: ['OPConsultation', 'Prescription'], display: 'OPD visit on 21 Sep 2026', link: null });
    expect(items[`V-${v2.id}`]).toMatchObject({ state: 'not_yet', reason: 'visit_not_signed' });
    expect(items[`V-${v3.id}`]).toMatchObject({ state: 'never', reason: 'entered_in_error' });
    expect(items[`L-${mixed.id}`]).toMatchObject({ state: 'ready', confidentialLeftOut: 1 });
    expect(items[`L-${hivOnly.id}`]).toMatchObject({ state: 'never', reason: 'confidential_test' });
    expect(items[`L-${unreviewed.id}`]).toMatchObject({ state: 'not_yet', reason: 'lab_not_reviewed' });
    expect(items[`D-${card.id}`]).toMatchObject({ state: 'ready', hiTypes: ['DischargeSummary'] });
    // What her ABHA app would show: the kind and the date – never a test name or a diagnosis
    expect(JSON.stringify(page.items.map((i) => i.display))).not.toMatch(/HIV|CBC|Normal pregnancy|Hyperemesis/);

    expect(ok(await records('rmo', p)).canLink).toBe(true);
    expect(ok(await records('drB', p)).canLink).toBe(false); // another doctor's patient: read-only
    expect((await post('drB', `/patients/${p.id}/records/link`, { references: [`V-${v1.id}`], consent: true })).status).toBe(403);
    for (const who of ['nurse', 'reception', 'lab', 'pharm', 'admin']) expect((await records(who, p)).status, who).toBe(403);
    expect((await records('outsider', p)).status).toBe(404);
    // The ABHA page says who may see them
    expect(ok(await (await as('reception')).get(`/api/abdm/patients/${p.id}`)).canSeeRecords).toBe(false);
    expect(ok(await (await as('drA')).get(`/api/abdm/patients/${p.id}`)).canSeeRecords).toBe(true);
    const viewed = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_RECORDS_VIEWED' }).lean();
    expect(viewed.map((a) => a.details)).toContainEqual({ patientId: p.id, mrn: p.mrn });
  });

  it("another doctor's SENSITIVE record: not even the list; her own doctor sees that nothing of it is shared", async () => {
    const p = await register('Sensitive Mother');
    await linkAbha(p);
    const v = await visit(p);
    ok(await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true }));
    expect((await records('drB', p)).status).toBe(403);
    const page = ok(await records('drA', p));
    expect(page.block).toBe('sensitive_record');
    expect(byRef(page.items)[`V-${v.id}`]).toMatchObject({ state: 'never', reason: 'sensitive_record' });
    const res = await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v.id}`], consent: true });
    expect(res.body.error).toMatchObject({ code: 'SENSITIVE', message: expect.stringContaining('marked sensitive') });
  });
});

// ---------- Link to ABHA (by the hospital) ----------

describe('"Link to ABHA" by the hospital', () => {
  it('with her agreement; only records that may be shared; once; recorded with who and when; counts in the audit log', async () => {
    const { p, v1, v2, mixed, hivOnly, card } = await fullRecord();
    const path = `/patients/${p.id}/records/link`;
    expect((await post('drA', path, { references: [`V-${v1.id}`] })).status).toBe(400); // her agreement
    expect((await post('drA', path, { references: [`V-${v2.id}`], consent: true })).body.error.code).toBe('NOT_SHAREABLE');
    expect((await post('drA', path, { references: [`L-${hivOnly.id}`], consent: true })).body.error.code).toBe('NOT_SHAREABLE');
    expect((await post('drA', path, { references: [`V-${new mongoose.Types.ObjectId()}`], consent: true })).status).toBe(404);
    expect(ok(await post('drA', path, { references: [`V-${v1.id}`, `L-${mixed.id}`, `D-${card.id}`], consent: true }))).toEqual({ linked: 3, status: 'linked' });
    expect((await post('rmo', path, { references: [`V-${v1.id}`], consent: true })).body.error.code).toBe('ALREADY_LINKED');
    const items = byRef(ok(await records('drA', p)).items);
    expect(items[`V-${v1.id}`].link).toMatchObject({ status: 'linked', via: 'hospital', byName: 'Sample drA', earlierAbha: false, practice: true });
    const stored = await AbdmCareContext.findOne({ tenantId: hospital._id, reference: `V-${v1.id}` }).lean();
    expect(stored).toMatchObject({ abhaNumber: '91-1111-2222-3333', abhaAddress: 'sample.abha.mother@sbx', agreement: { byName: 'Sample drA' } });
    // The practice stand-in got the records grouped by type, by reference and the kind and date only
    const sent = practiceSent().find((x) => x.call === 'link').body;
    expect(sent.careContexts.map((c) => c.reference).sort()).toEqual([`D-${card.id}`, `L-${mixed.id}`, `V-${v1.id}`].sort());
    expect(JSON.stringify(sent)).not.toMatch(/Normal pregnancy|PRIVATE|CBC|HIV/);
    const entry = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_RECORDS_LINKED' }).lean();
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, records: 3, via: 'hospital', status: 'linked', practice: true });

    // Her ABHA unlinked and another linked: the earlier links no longer count (linked again to the new one)
    ok(await post('reception', `/patients/${p.id}/unlink`, { reason: 'Wrong ABHA' }));
    await linkAbha(p, '91-4444-5555-6666');
    expect(byRef(ok(await records('drA', p)).items)[`V-${v1.id}`].link).toMatchObject({ status: 'linked', earlierAbha: true });
    expect(ok(await post('drA', path, { references: [`V-${v1.id}`], consent: true }))).toEqual({ linked: 1, status: 'linked' });
  });

  it('no ABHA on her record: link it first', async () => {
    const p = await register('No Abha Mother');
    const v = await visit(p);
    expect((await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v.id}`], consent: true })).body.error).toMatchObject({ code: 'NOT_LINKED', message: 'Link her ABHA to her record first.' });
  });
});

// ---------- Practice: her ABHA app, and another hospital ----------

describe('practice: her ABHA app finds and links her records', () => {
  it('only the records that may be shared and are not linked yet; the OTP; a wrong OTP; linked by her', async () => {
    const { p, v1, mixed, card } = await fullRecord();
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`D-${card.id}`], consent: true }));
    const found = ok(await post('drA', `/patients/${p.id}/practice/discover`, {}));
    expect(found).toMatchObject({ practiceOtp: '123456', error: null });
    expect(found.offered.map((r) => r.reference).sort()).toEqual([`L-${mixed.id}`, `V-${v1.id}`].sort());
    const wrong = ok(await post('drA', `/patients/${p.id}/practice/confirm`, { transactionId: found.transactionId, otp: '000000' }));
    expect(wrong).toMatchObject({ linked: 0, error: 'The OTP is not correct.' });
    expect(ok(await post('drA', `/patients/${p.id}/practice/confirm`, { transactionId: found.transactionId, otp: '123456' }))).toEqual({ linked: 2, error: null });
    expect(byRef(ok(await records('drA', p)).items)[`V-${v1.id}`].link).toMatchObject({ status: 'linked', via: 'patient', byName: '' });
    // Nothing left to link: her app is told so
    expect(ok(await post('drA', `/patients/${p.id}/practice/discover`, {}))).toMatchObject({ offered: [], error: 'No new records to link at this hospital.' });
    const discovered = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_RECORDS_DISCOVERED' }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(discovered.map((a) => a.details.offered)).toEqual([2, 0]);
    expect((await post('nurse', `/patients/${p.id}/practice/discover`, {})).status).toBe(403);
  });
});

describe('practice: a consent and her records sent to another hospital', () => {
  async function linkedRecord() {
    const r = await fullRecord();
    ok(await post('drA', `/patients/${r.p.id}/records/link`, { references: [`V-${r.v1.id}`, `L-${r.mixed.id}`, `D-${r.card.id}`], consent: true }));
    return r;
  }
  const consent = (p, body) => post('drA', `/patients/${p.id}/practice/consent`, { from: '2026-01-01', to: '2026-10-05', hiTypes: ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary'], days: 30, ...body });

  it('FHIR documents of each kind are sent, encrypted, and decrypted by the other hospital – without what is never shared', async () => {
    const { p, v1, mixed, card } = await linkedRecord();
    const out = ok(await consent(p));
    expect(out.transfer).toMatchObject({ status: 'sent', records: 3, heldBack: 0, documents: 4, practice: true });
    const received = ok(await (await as('drA')).get(`/api/abdm/transfers/${out.transfer.id}/practice-received`)).documents;
    expect(received.map((d) => d.title).sort()).toEqual(['Consultation report', 'Diagnostic report', 'Discharge summary', 'Prescription']);
    const docOf = (title) => received.find((d) => d.title === title).document;
    const resources = (doc) => doc.entry.map((e) => e.resource);
    // Each is a FHIR document bundle following the NRCeS profiles, the Composition first
    for (const d of received) {
      expect(d.document).toMatchObject({ resourceType: 'Bundle', type: 'document', meta: { profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle'] } });
      expect(d.document.entry[0].resource.resourceType).toBe('Composition');
      for (const e of d.document.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
    }
    const op = docOf('Consultation report');
    expect(op.entry[0].resource).toMatchObject({ meta: { profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord'] }, type: { coding: [{ code: '371530004' }] }, status: 'final', author: [{ display: 'Sample drA' }] });
    expect(resources(op).find((r) => r.resourceType === 'Patient')).toMatchObject({ name: [{ text: 'Share Mother' }], gender: 'female', identifier: [{ value: p.mrn }, { value: '91-1111-2222-3333' }] });
    const bp = resources(op).find((r) => r.code?.coding?.[0]?.code === '85354-9');
    expect(bp.component.map((c) => c.valueQuantity.value)).toEqual([110, 70]);
    expect(resources(op).find((r) => r.code?.coding?.[0]?.code === '11881-0').valueQuantity).toMatchObject({ value: 16, unit: 'cm' });
    expect(resources(op).find((r) => r.resourceType === 'Appointment').requestedPeriod).toEqual([{ start: '2026-10-19', end: '2026-10-19' }]);
    expect(resources(docOf('Prescription')).find((r) => r.resourceType === 'MedicationRequest')).toMatchObject({ medicationCodeableConcept: { text: 'Tab. Folic acid 5 mg' }, dosageInstruction: [{ text: 'Dose 1, 1-0-0 (once a day, morning), after food, for 30 days' }] });
    const dr = resources(docOf('Diagnostic report'));
    expect(dr.filter((r) => r.resourceType === 'DiagnosticReport').map((r) => r.code.text)).toEqual(['Complete blood count (CBC)']); // never the HIV test
    expect(dr.find((r) => r.code?.text === 'Haemoglobin')).toMatchObject({ valueQuantity: { value: 9.5, unit: 'g/dL' }, interpretation: [{ coding: [{ code: 'L' }] }] });
    const ds = resources(docOf('Discharge summary'));
    expect(ds.find((r) => r.resourceType === 'Encounter')).toMatchObject({ class: { code: 'IMP' }, period: { start: '2026-10-01T04:00:00.000Z', end: '2026-10-03T06:00:00.000Z' } });
    expect(ds.find((r) => r.resourceType === 'Condition').code.text).toBe('Hyperemesis, settled');
    // Never: the private note, the medicine-warning reason, the review comment, the note to the lab, the HIV test
    const all = JSON.stringify(received);
    for (const word of NEVER) expect(all, word).not.toContain(word);

    // The transfer and the audit log: references and counts only
    const t = await AbdmTransfer.findOne({ tenantId: hospital._id }).lean();
    expect(t.careContexts.map((c) => [c.reference, c.delivered, c.documents]).sort()).toEqual([[`D-${card.id}`, true, 1], [`L-${mixed.id}`, true, 1], [`V-${v1.id}`, true, 2]].sort());
    const shared = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_RECORDS_SHARED' }).lean();
    expect(shared.details).toEqual({ consentId: out.consentId, transactionId: t.transactionId, patientId: p.id, mrn: p.mrn, records: 3, documents: 4, heldBack: 0, practice: true });
    const entries = await AuditLog.find({ tenantId: hospital._id, action: { $in: SHARE_ACTIONS } }).lean();
    expect(JSON.stringify(entries)).not.toMatch(/Normal pregnancy|Folic|Hyperemesis|PRIVATE|Sample Clinic|Haemoglobin/);
    const c = await AbdmConsent.findOne({ tenantId: hospital._id }).lean();
    expect(c).toMatchObject({ status: 'GRANTED', hiu: { name: 'Sample Clinic (practice)' }, careContexts: expect.any(Array) });
  });

  it('only the types and dates she agreed to; records changed since are not sent; a withdrawn or expired consent sends nothing', async () => {
    const { p, v1, mixed, card } = await linkedRecord();
    // Lab reports only
    const labOnly = ok(await consent(p, { hiTypes: ['DiagnosticReport'] }));
    expect(labOnly.transfer).toMatchObject({ status: 'sent', records: 1, heldBack: 2, documents: 1 });
    // Dates that leave out the visit of 21 Sep
    const late = ok(await consent(p, { from: '2026-10-01', to: '2026-10-05' }));
    expect(late.transfer).toMatchObject({ records: 2, heldBack: 1 });
    const t = await AbdmTransfer.findOne({ tenantId: hospital._id, transactionId: { $exists: true }, careContexts: { $elemMatch: { reference: `V-${v1.id}`, reason: 'outside_dates' } } }).lean();
    expect(t).toBeTruthy();

    // Results changed after the review (not reviewed again): held back
    const order = await LabOrder.findOne({ tenantId: hospital._id, _id: mixed.id });
    const labUser = await as('lab');
    ok(await labUser.put(lab(`${mixed.id}/results`)).send({ rev: order.rev, tests: [CBC, HIV].map((x) => (x.key === 'cbc' ? { ...x, values: [{ key: 'hb', value: '9.9' }, ...x.values.slice(1)] } : x)), labNote: 'Sample clear', reason: 'Typing mistake corrected' }));
    const again = ok(await consent(p));
    expect(again.transfer).toMatchObject({ records: 2, heldBack: 1 });
    expect((await AbdmTransfer.findOne({ tenantId: hospital._id, _id: again.transfer.id }).lean()).careContexts.find((c) => c.reference === `L-${mixed.id}`)).toMatchObject({ delivered: false, reason: 'lab_not_reviewed' });

    // Withdrawn: the next request gets nothing
    const granted = await AbdmConsent.findOne({ tenantId: hospital._id, consentId: again.consentId }).lean();
    ok(await post('drA', `/consents/${granted._id}/practice/revoke`, {}));
    const refused = ok(await post('drA', `/consents/${granted._id}/practice/request`, {}));
    expect(refused.transfer).toMatchObject({ status: 'refused', refusal: 'consent_revoked', records: 0, documents: 0 });
    expect(ok(await (await as('drA')).get(`/api/abdm/transfers/${refused.transfer.id}/practice-received`)).documents).toBeNull();
    // Expired (granted with an end in the past): nothing
    const expired = ok(await consent(p, { days: -1 }));
    expect(expired.transfer).toMatchObject({ status: 'refused', refusal: 'consent_expired' });
    const refusals = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_SHARE_REFUSED' }).lean();
    expect(refusals.map((a) => a.details.refusal).sort()).toEqual(['consent_expired', 'consent_revoked']);

    // Her record marked sensitive after linking: nothing of it is sent
    ok(await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true }));
    const page = ok(await records('drA', p));
    const fresh = ok(await post('drA', `/consents/${page.consents.find((c) => c.status === 'GRANTED').id}/practice/request`, {}));
    expect(fresh.transfer).toMatchObject({ status: 'nothing_to_send', records: 0 });
    expect((await AbdmTransfer.findOne({ tenantId: hospital._id, _id: fresh.transfer.id }).lean()).careContexts.every((c) => c.reason === 'sensitive_record')).toBe(true);
    // The tab lists the consents with what was sent
    ok(await (await as('rmo')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: false }));
    const tab = ok(await records('drA', p));
    expect(tab.consents.length).toBe(4);
    expect(tab.consents.find((c) => c.consentId === again.consentId)).toMatchObject({ status: 'REVOKED', hiu: 'Sample Clinic (practice)', records: 3 });
    expect(tab.consents.find((c) => c.consentId === expired.consentId).status).toBe('EXPIRED');
    expect(card).toBeTruthy();
  });

  it('nothing linked: a consent cannot be tried; another hospital’s consent: not found; only in practice mode', async () => {
    const p = await register();
    await linkAbha(p);
    expect((await consent(p)).body.error.code).toBe('NOTHING_LINKED');
    const theirs = await AbdmConsent.create({ tenantId: other._id, consentId: randomUUID(), status: 'GRANTED', patientId: new mongoose.Types.ObjectId(), practice: true });
    expect((await post('drA', `/consents/${theirs._id}/practice/request`, {})).status).toBe(404);
    setAbdmClientForTests({ ...practiceClient, mode: 'sandbox' });
    expect((await consent(p)).body.error.code).toBe('NOT_PRACTICE');
  });
});

// ---------- From ABDM (a stand-in for the sandbox: the same routes ABDM calls, signed) ----------

describe('from ABDM (sandbox stand-in): discovery, linking from her app, consent and sending', () => {
  let calls;
  let pushes;
  const HIP = 'IN2710000099';
  function sandbox() {
    calls = [];
    pushes = [];
    const record = (call) => async (body) => {
      calls.push({ call, body });
    };
    setAbdmClientForTests({
      ...practiceClient,
      mode: 'sandbox',
      async verifyRequest(auth) {
        if (auth !== 'Bearer signed-by-abdm') throw new HttpError(401, 'Not signed by ABDM.', 'NOT_AUTHENTICATED');
      },
      // As the V3 client: Perinexa gives the request id; ABDM answers later, on its own address
      startLink: async (link) => {
        calls.push({ call: 'generate-token', body: link });
        return { status: 'waiting', step: 'token', requestId: link.requestId };
      },
      linkWithToken: async (link) => {
        calls.push({ call: 'link', body: link });
        return { requestId: link.requestId };
      },
      onDiscover: record('on-discover'),
      onLinkInit: record('on-init'),
      onLinkConfirm: record('on-confirm'),
      consentOnNotify: record('consent-on-notify'),
      healthInfoOnRequest: record('on-request'),
      healthInfoNotify: record('notify'),
      pushData: async ({ url, body }) => {
        pushes.push({ url, body });
      },
    });
  }
  const fromAbdm = (path, body, { signed = true, hip = HIP, requestId = randomUUID() } = {}) => {
    const r = request(app).post(`/api/abdm/public/api/v3${path}`).set('REQUEST-ID', requestId);
    if (hip) r.set('X-HIP-ID', hip);
    if (signed) r.set('Authorization', 'Bearer signed-by-abdm');
    return r.send(body);
  };
  const last = (call) => calls.filter((c) => c.call === call).at(-1)?.body;

  it('refuses unsigned messages and unknown hospitals; her app finds her records only through her linked ABHA', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP } });
    const { p, v1, mixed, card } = await fullRecord();
    sandbox();
    const ask = { transactionId: randomUUID(), patient: { id: 'sample.abha.mother@sbx', name: 'Sample Abha Mother', gender: 'F', yearOfBirth: 1996, verifiedIdentifiers: [{ type: 'ABHA_NUMBER', value: '91-1111-2222-3333' }] } };
    expect((await fromAbdm('/hip/patient/care-context/discover', ask, { signed: false })).status).toBe(401);
    expect((await fromAbdm('/hip/patient/care-context/discover', ask, { hip: 'IN0000000000' })).status).toBe(404);
    expect((await fromAbdm('/hip/patient/care-context/discover', ask, { requestId: 'disc-1' })).status).toBe(202);
    await abdmIdle();
    const answer = last('on-discover');
    expect(answer).toMatchObject({ hipId: HIP, requestId: 'disc-1', transactionId: ask.transactionId, patient: { reference: p.mrn }, matchedBy: ['ABHA_NUMBER'] });
    expect(answer.careContexts.map((c) => c.reference).sort()).toEqual([`D-${card.id}`, `L-${mixed.id}`, `V-${v1.id}`].sort());
    // Someone whose ABHA is on no record here (name, mobile or year of birth are never used to find a record)
    await fromAbdm('/hip/patient/care-context/discover', { transactionId: randomUUID(), patient: { id: 'second.sample@sbx', name: 'Share Mother', verifiedIdentifiers: [{ type: 'MOBILE', value: '9876500001' }] } });
    await abdmIdle();
    expect(last('on-discover').error).toMatchObject({ message: 'No records were found for this ABHA at this hospital.' });

    // She picks two; the OTP goes by SMS to the mobile number on her record
    setTestSender(TEST_SENDER);
    const before = testSent().length;
    await fromAbdm('/hip/link/care-context/init', { transactionId: ask.transactionId, abhaAddress: 'sample.abha.mother@sbx', patient: [{ referenceNumber: p.mrn, careContexts: [{ referenceNumber: `V-${v1.id}` }, { referenceNumber: `L-${mixed.id}` }], hiType: 'OPConsultation', count: 2 }] });
    await abdmIdle();
    const sms = testSent().slice(before);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ channel: 'sms', to: '+919876500001' });
    const otp = /(\d{6}) is your OTP/.exec(sms[0].text)[1];
    const init = last('on-init');
    expect(init).toMatchObject({ transactionId: ask.transactionId, linkRef: expect.any(String) });
    // Never stored or logged: only its hash, for 10 minutes
    expect(JSON.stringify(await mongoose.connection.db.collection('abdmlinkrequests').find({}).toArray())).not.toContain(`"${otp}"`);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain(otp);
    await fromAbdm('/hip/link/care-context/confirm', { confirmation: { linkRefNumber: init.linkRef, token: otp === '000000' ? '111111' : '000000' } });
    await abdmIdle();
    expect(last('on-confirm').error).toMatchObject({ message: 'The OTP is not correct.' });
    await fromAbdm('/hip/link/care-context/confirm', { confirmation: { linkRefNumber: init.linkRef, token: otp } });
    await abdmIdle();
    expect(last('on-confirm').careContexts.map((c) => c.reference).sort()).toEqual([`L-${mixed.id}`, `V-${v1.id}`].sort());
    expect(await AbdmCareContext.countDocuments({ tenantId: hospital._id, status: 'linked', via: 'patient' })).toBe(2);
    const linked = await AuditLog.findOne({ tenantId: hospital._id, action: 'ABDM_RECORDS_LINKED' }).lean();
    expect(linked).toMatchObject({ actor: null, details: { patientId: p.id, mrn: p.mrn, records: 2, via: 'patient', status: 'linked', practice: false } });
  });

  it('a consent and a request: her records go encrypted, one document per page with its own keys; a withdrawn consent gets nothing', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP, 'abdm.hfrId': 'IN2710000099' } });
    const { p, v1, mixed, card } = await fullRecord();
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v1.id}`, `L-${mixed.id}`, `D-${card.id}`], consent: true }));
    sandbox();
    const consentId = randomUUID();
    const careContexts = [`V-${v1.id}`, `L-${mixed.id}`, `D-${card.id}`].map((r) => ({ patientReference: p.mrn, careContextReference: r }));
    const notify = (status, detail = true) => ({
      notification: {
        status,
        consentId,
        ...(detail
          ? { consentDetail: { consentId, patient: { id: 'sample.abha.mother@sbx' }, careContexts, purpose: { code: 'CAREMGT', text: 'Care management' }, hip: { id: HIP }, hiu: { id: 'HIU-1', name: 'Sample Women Clinic' }, hiTypes: ['OPConsultation', 'DiagnosticReport', 'DischargeSummary'], permission: { accessMode: 'VIEW', dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-10-05T18:00:00Z' }, dataEraseAt: '2026-11-05T00:00:00Z' } } }
          : {}),
      },
    });
    expect((await fromAbdm('/consent/request/hip/notify', notify('GRANTED'), { hip: null, requestId: 'cn-1' })).status).toBe(202); // the HIP ID from the consent
    await abdmIdle();
    expect(last('consent-on-notify')).toMatchObject({ consentId, requestId: 'cn-1' });
    const hiu = requesterKeyMaterial({ expiry: '2026-10-06T06:00:00Z' });
    const ask = (url = 'https://dev.abdm.gov.in/api/hiecm/data-flow/v3/health-information/transfer') => ({ transactionId: randomUUID(), hiRequest: { consent: { id: consentId }, dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-10-05T18:00:00Z' }, dataPushUrl: url, keyMaterial: hiu.keyMaterial } });
    const first = ask();
    expect((await fromAbdm('/hip/health-information/request', first, { requestId: 'hi-1' })).status).toBe(202);
    await abdmIdle();
    expect(last('on-request')).toMatchObject({ requestId: 'hi-1', transactionId: first.transactionId, status: 'ACKNOWLEDGED' });
    // Prescription was not asked for: 3 documents (consultation, lab report, discharge summary), one per page
    expect(pushes).toHaveLength(3);
    expect(pushes.map((x) => [x.body.pageNumber, x.body.pageCount])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(new Set(pushes.map((x) => x.body.keyMaterial.dhPublicKey.keyValue)).size).toBe(3); // a new key pair every page
    const docs = pushes.map(({ body }) => {
      const [entry] = body.entries;
      const text = decryptFrom({ encryptedData: entry.content, sender: { publicKey: body.keyMaterial.dhPublicKey.keyValue, nonce: body.keyMaterial.nonce }, ours: { privateRaw: hiu.privateRaw, nonce: hiu.nonce } });
      expect(entry).toMatchObject({ media: 'application/fhir+json', checksum: checksumOf(text) });
      return JSON.parse(text);
    });
    expect(docs.map((d) => d.entry[0].resource.title).sort()).toEqual(['Consultation report', 'Diagnostic report', 'Discharge summary']);
    expect(docs.find((d) => d.entry[0].resource.title === 'Discharge summary').entry.find((e) => e.resource.resourceType === 'Organization').resource.identifier[0].value).toBe('IN2710000099');
    for (const word of NEVER) expect(JSON.stringify(docs), word).not.toContain(word);
    expect(last('notify')).toMatchObject({ consentId, transactionId: first.transactionId, sessionStatus: 'TRANSFERRED', statusResponses: expect.arrayContaining([{ careContextReference: `V-${v1.id}`, hiStatus: 'DELIVERED', description: 'Delivered' }]) });

    // A push address that is not https (or local): refused, nothing sent
    const bad = ask('http://hiu.example.org/push');
    await fromAbdm('/hip/health-information/request', bad);
    await abdmIdle();
    expect(last('on-request')).toMatchObject({ transactionId: bad.transactionId, status: 'ERRORED' });
    expect(pushes).toHaveLength(3);

    // Withdrawn (ABDM sends only the status): the next request gets nothing
    await fromAbdm('/consent/request/hip/notify', notify('REVOKED', false));
    await abdmIdle();
    const after = ask();
    await fromAbdm('/hip/health-information/request', after);
    await abdmIdle();
    expect(last('on-request')).toMatchObject({ transactionId: after.transactionId, status: 'ERRORED', error: { message: 'The consent was withdrawn.' } });
    expect(pushes).toHaveLength(3);
    // The same consent id at another hospital means nothing there
    await Tenant.updateOne({ _id: other._id }, { $set: { 'abdm.hipId': 'IN2710000077' } });
    await fromAbdm('/hip/health-information/request', ask(), { hip: 'IN2710000077' });
    await abdmIdle();
    expect(last('on-request')).toMatchObject({ status: 'ERRORED', error: { message: 'No consent was found for this request.' } });
    const shared = await AuditLog.find({ action: { $in: ['ABDM_RECORDS_SHARED', 'ABDM_SHARE_REFUSED'] } }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(shared.map((a) => [a.action, String(a.tenantId), a.details.refusal ?? a.details.records])).toEqual([
      ['ABDM_RECORDS_SHARED', String(hospital._id), 3],
      ['ABDM_SHARE_REFUSED', String(hospital._id), 'push_address'],
      ['ABDM_SHARE_REFUSED', String(hospital._id), 'consent_revoked'],
      ['ABDM_SHARE_REFUSED', String(other._id), 'unknown_consent'],
    ]);
  });

  it('linking by the hospital waits for ABDM’s two answers (link token, then the link)', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP } });
    const p = await register();
    await linkAbha(p);
    const v = await visit(p);
    sandbox();
    expect(ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v.id}`], consent: true }))).toEqual({ linked: 1, status: 'waiting' });
    const token = last('generate-token');
    expect(token).toMatchObject({ hipId: HIP, requestId: expect.any(String), abha: { number: '91-1111-2222-3333', gender: 'F', yearOfBirth: 1996 } });
    expect(byRef(ok(await records('drA', p)).items)[`V-${v.id}`].link.status).toBe('waiting');
    await fromAbdm('/hip/token/on-generate-token', { abhaAddress: 'sample.abha.mother@sbx', linkToken: 'link-token-sample', response: { requestId: token.requestId } });
    await abdmIdle();
    const link = last('link');
    expect(link).toMatchObject({ linkToken: 'link-token-sample', requestId: expect.any(String), patient: { reference: p.mrn }, careContexts: [expect.objectContaining({ reference: `V-${v.id}` })] });
    expect(link.requestId).not.toBe(token.requestId);
    await fromAbdm('/link/on_carecontext', { abhaAddress: 'sample.abha.mother@sbx', status: 'Successfully Linked care context', response: { requestId: link.requestId } });
    await abdmIdle();
    expect(byRef(ok(await records('drA', p)).items)[`V-${v.id}`].link.status).toBe('linked');
    // Without the gender and year of birth on her ABHA (linked before 5 Oct 2026): verify again first
    await Patient.updateOne({ tenantId: hospital._id, _id: p.id }, { $set: { 'abha.genderOnAbha': '', 'abha.yearOfBirthOnAbha': null } });
    const v2 = await visit(p, { visitOn: '2026-09-30' });
    expect((await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v2.id}`], consent: true })).body.error.code).toBe('VERIFY_AGAIN');
  });

  it('ABDM answering before its call returns still finds the records; no answer for 30 minutes: they can be linked again; a call that fails says why', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP } });
    const p = await register();
    await linkAbha(p);
    const [v1, v2, v3] = [await visit(p), await visit(p, { visitOn: '2026-09-25' }), await visit(p, { visitOn: '2026-09-30' })];
    sandbox();
    // ABDM's two answers arrive while Perinexa's own calls are still on their way
    const answerNow = (path, body) => fromAbdm(path, body).then(() => abdmIdle());
    setAbdmClientForTests({
      ...abdmClient(),
      startLink: async (link) => {
        calls.push({ call: 'generate-token', body: link });
        await answerNow('/hip/token/on-generate-token', { abhaAddress: 'sample.abha.mother@sbx', linkToken: 'link-token-fast', response: { requestId: link.requestId } });
        return { status: 'waiting', step: 'token', requestId: link.requestId };
      },
      linkWithToken: async (link) => {
        calls.push({ call: 'link', body: link });
        await fromAbdm('/link/on_carecontext', { abhaAddress: 'sample.abha.mother@sbx', response: { requestId: link.requestId } }); // its answer is handled at once
        return { requestId: link.requestId };
      },
    });
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v1.id}`], consent: true }));
    await abdmIdle();
    expect(last('link')).toMatchObject({ linkToken: 'link-token-fast' });
    expect(byRef(ok(await records('drA', p)).items)[`V-${v1.id}`].link.status).toBe('linked');

    // ABDM never answers: after 30 minutes the record shows "no answer" and may be linked again
    sandbox();
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v2.id}`], consent: true }));
    expect((await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v2.id}`], consent: true })).body.error.code).toBe('ALREADY_LINKED');
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    sessions = {};
    const stale = byRef(ok(await records('drA', p)).items)[`V-${v2.id}`].link;
    expect(stale.status).toBe('no_answer');
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v2.id}`], consent: true }));
    expect(calls.filter((c) => c.call === 'generate-token')).toHaveLength(2);
    expect(byRef(ok(await records('drA', p)).items)[`V-${v2.id}`].link.status).toBe('waiting');

    // ABDM cannot be reached: nothing waits, the record says why and can be linked again
    setAbdmClientForTests({
      ...abdmClient(),
      startLink: async () => {
        throw new HttpError(502, 'Could not reach ABDM. Please try again in a moment.', 'ABDM');
      },
    });
    expect((await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v3.id}`], consent: true })).status).toBe(502);
    expect(byRef(ok(await records('drA', p)).items)[`V-${v3.id}`].link).toMatchObject({ status: 'failed', error: 'Not linked: Could not reach ABDM. Please try again in a moment.' });
  });

  it('a withdrawn consent stays withdrawn when ABDM repeats an earlier "granted"; a consent not naming her ABHA is bound to nobody', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP } });
    const { p, v1 } = await fullRecord();
    ok(await post('drA', `/patients/${p.id}/records/link`, { references: [`V-${v1.id}`], consent: true }));
    sandbox();
    const hiu = requesterKeyMaterial({ expiry: '2026-10-06T06:00:00Z' });
    const detail = (consentId, patient = { id: 'sample.abha.mother@sbx' }) => ({
      consentId,
      patient,
      careContexts: [{ patientReference: p.mrn, careContextReference: `V-${v1.id}` }],
      purpose: { code: 'CAREMGT', text: 'Care management' },
      hip: { id: HIP },
      hiu: { id: 'HIU-1', name: 'Sample Women Clinic' },
      hiTypes: ['OPConsultation'],
      permission: { accessMode: 'VIEW', dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-10-05T18:00:00Z' }, dataEraseAt: '2026-11-05T00:00:00Z' },
    });
    const notify = async (consentId, status, d) => {
      await fromAbdm('/consent/request/hip/notify', { notification: { status, consentId, ...(d ? { consentDetail: d } : {}) } });
      await abdmIdle(); // one message after the other
    };
    const ask = async (consentId) => {
      const body = { transactionId: randomUUID(), hiRequest: { consent: { id: consentId }, dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-10-05T18:00:00Z' }, dataPushUrl: 'https://dev.abdm.gov.in/api/hiecm/data-flow/v3/health-information/transfer', keyMaterial: hiu.keyMaterial } };
      await fromAbdm('/hip/health-information/request', body);
      await abdmIdle();
      return last('on-request');
    };
    const c1 = randomUUID();
    await notify(c1, 'GRANTED', detail(c1));
    await notify(c1, 'REVOKED');
    // ABDM sends the first "granted" again (it was not acknowledged, or arrives late)
    await notify(c1, 'GRANTED', detail(c1));
    const kept = await AbdmConsent.findOne({ tenantId: hospital._id, consentId: c1 }).lean();
    expect(kept.status).toBe('REVOKED');
    expect(kept.history.map((x) => [x.status, x.ignored ?? false])).toEqual([
      ['GRANTED', false],
      ['REVOKED', false],
      ['GRANTED', true],
    ]);
    expect(await ask(c1)).toMatchObject({ status: 'ERRORED', error: { message: 'The consent was withdrawn.' } });
    const ignored = await AuditLog.find({ tenantId: hospital._id, action: 'ABDM_CONSENT_RECEIVED', 'details.consentId': c1 }).sort({ _id: 1 }).lean();
    expect(ignored.map((a) => [a.details.status, a.details.ignored ?? false])).toEqual([
      ['GRANTED', false],
      ['REVOKED', false],
      ['GRANTED', true],
    ]);
    // Expired, then "granted" again: still expired
    const c2 = randomUUID();
    await notify(c2, 'EXPIRED');
    await notify(c2, 'GRANTED', detail(c2));
    expect(await ask(c2)).toMatchObject({ status: 'ERRORED', error: { message: 'The consent has expired.' } });

    // A consent that names no ABHA, or another one, is bound to no record here: nothing is sent with it
    const c3 = randomUUID();
    const c4 = randomUUID();
    await notify(c3, 'GRANTED', detail(c3, {}));
    await notify(c4, 'GRANTED', detail(c4, { id: 'second.sample@sbx' }));
    expect((await AbdmConsent.find({ tenantId: hospital._id, consentId: { $in: [c3, c4] } }).lean()).map((c) => c.patientId)).toEqual([null, null]);
    expect(await ask(c3)).toMatchObject({ status: 'ERRORED', error: { message: 'No consent was found for this request.' } });
    expect(await ask(c4)).toMatchObject({ status: 'ERRORED', error: { message: 'No consent was found for this request.' } });
    expect(ok(await records('drA', p)).consents.map((c) => c.consentId)).toEqual([c1]); // only the consent bound to her record
  });

  it('her app’s search is continued within 30 minutes; an old one never sends an OTP', async () => {
    await Tenant.updateOne({ _id: hospital._id }, { $set: { 'abdm.hipId': HIP } });
    const { p, v1 } = await fullRecord();
    sandbox();
    setTestSender(TEST_SENDER);
    const transactionId = randomUUID();
    await fromAbdm('/hip/patient/care-context/discover', { transactionId, patient: { id: 'sample.abha.mother@sbx', verifiedIdentifiers: [{ type: 'ABHA_NUMBER', value: '91-1111-2222-3333' }] } });
    await abdmIdle();
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    const before = testSent().length;
    await fromAbdm('/hip/link/care-context/init', { transactionId, patient: [{ referenceNumber: p.mrn, careContexts: [{ referenceNumber: `V-${v1.id}` }] }] });
    await abdmIdle();
    expect(last('on-init').error).toMatchObject({ message: 'This search has expired. Please look for the records again.' });
    expect(testSent().length).toBe(before);
    expect((await AbdmLinkRequest.findOne({ tenantId: hospital._id, transactionId }).lean()).status).toBe('failed');
    // Kept a day at most (MongoDB deletes them)
    expect(AbdmLinkRequest.schema.indexes().find(([keys]) => keys.updatedAt)?.[1]).toMatchObject({ expireAfterSeconds: 86400 });
  });
});

describe("ABDM's calls: only from ABDM's gateway, and one hospital per HIP ID", () => {
  it("a token signed with ABDM's keys is accepted only when it is the gateway's own (not another hospital's session token)", async () => {
    expect(fromGateway({ clientId: 'gateway' })).toBe(true);
    expect(fromGateway({ azp: 'gateway' })).toBe(true);
    expect(fromGateway({ clientId: 'SBX_SAMPLE_HIP', resource_access: { SBX_SAMPLE_HIP: { roles: ['gateway'] } } })).toBe(true);
    expect(fromGateway({ clientId: 'SBX_SAMPLE_HIP', realm_access: { roles: ['hip', 'hiu'] }, resource_access: { SBX_SAMPLE_HIP: { roles: ['hiu'] } } })).toBe(false);
    expect(fromGateway({})).toBe(false);
    expect(fromGateway(null)).toBe(false);
    expect(ABDM_CHECKLIST_M2.join(' ')).toMatch(/GATEWAY/);
    expect(ABDM_CHECKLIST_M2.join(' ')).toMatch(/signature \(NOT checked yet\)/);

    // The real check, with a made-up set of ABDM keys (no network: the gateway's /certs is answered here)
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = `sample-${randomUUID()}`;
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const mode = config.ABDM_MODE;
    config.ABDM_MODE = 'sandbox';
    try {
      const sign = (claims) => `Bearer ${jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: kid, expiresIn: '10m' })}`;
      await expect(v3Client.verifyRequest(sign({ clientId: 'gateway' }))).resolves.toBeUndefined();
      await expect(v3Client.verifyRequest(sign({ clientId: 'SBX_SAMPLE_HIP', realm_access: { roles: ['hip', 'hiu'] } }))).rejects.toMatchObject({ status: 401, message: "Not sent by ABDM's gateway." });
      const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      await expect(v3Client.verifyRequest(`Bearer ${jwt.sign({ clientId: 'gateway' }, otherKey, { algorithm: 'RS256', keyid: kid })}`)).rejects.toMatchObject({ status: 401 });
      expect(fetchStub).toHaveBeenCalled();
    } finally {
      config.ABDM_MODE = mode;
      vi.unstubAllGlobals();
    }
  });

  it('a HIP ID another hospital uses cannot be saved; two hospitals with one HIP ID: ABDM’s messages are refused', async () => {
    ok(await (await as('admin')).put('/api/abdm/settings').send({ hipId: 'IN2710000099' }));
    people.otherAdmin = await createUser({ name: 'Other Admin' });
    await addMember(people.otherAdmin, other, 'admin');
    const taken = await (await as('otherAdmin')).put('/api/abdm/settings').send({ hipId: 'IN2710000099' });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'HIP_ID_IN_USE', fields: { hipId: 'Already used by another hospital.' } });
    ok(await (await as('admin')).put('/api/abdm/settings').send({ hipId: 'IN2710000099', counterCode: 'DESK-1' })); // its own: fine
    // Older data with the same HIP ID twice: nothing is done for either hospital
    await Tenant.updateOne({ _id: other._id }, { $set: { 'abdm.hipId': 'IN2710000099' } });
    setAbdmClientForTests({
      ...practiceClient,
      mode: 'sandbox',
      async verifyRequest() {},
    });
    const res = await request(app).post('/api/abdm/public/api/v3/consent/request/hip/notify').set('X-HIP-ID', 'IN2710000099').set('Authorization', 'Bearer signed-by-abdm').send({ notification: { status: 'GRANTED', consentId: 'c-sample' } });
    expect(res.status).toBe(409);
    expect(await AbdmConsent.countDocuments({ tenantId: { $in: [hospital._id, other._id] } })).toBe(0);
  });

  it("ABDM's addresses have their own limit, not a browser's", async () => {
    const strict = createApp({ apiRateLimitMax: 2 });
    for (let i = 0; i < 4; i += 1) {
      const res = await request(strict).post('/api/abdm/public/api/v3/hip/patient/care-context/discover').send({});
      expect(res.status, `call ${i + 1}`).toBe(404); // practice mode: not received – never "too many requests"
    }
    expect((await request(strict).get('/api/health')).status).toBe(200);
  });
});

// ---------- Hospital admin and the audit log ----------

describe('Hospital admin → ABDM, and the audit log', () => {
  it('the admin sees the addresses ABDM calls and the M2 checklist; nobody else does', async () => {
    const status = ok(await (await as('admin')).get('/api/abdm/status'));
    expect(status.bridgeUrl).toBe(status.publicUrl ? `${status.publicUrl}/api/abdm/public` : ''); // empty until ABDM_PUBLIC_URL is set
    expect(status.callbacks).toEqual(expect.arrayContaining(['/api/v3/hip/patient/care-context/discover', '/api/v3/consent/request/hip/notify', '/api/v3/hip/health-information/request']));
    expect(status.checklistM2.length).toBeGreaterThan(8);
    expect(status.checklistM2.join(' ')).toMatch(/Fidelius/);
    const doctor = ok(await (await as('drA')).get('/api/abdm/status'));
    expect(doctor.checklistM2).toBeUndefined();
    expect(doctor.callbacks).toBeUndefined();
  });

  it('entries keep ids and counts; the platform keeps counts only', () => {
    const details = { consentId: 'c', transactionId: 't', patientId: 'p', mrn: 'P-000001', records: 2, documents: 3, heldBack: 1, practice: true, hiu: 'Sample Clinic', diagnosis: 'x' };
    expect(safeAuditDetails('ABDM_RECORDS_SHARED', details)).toEqual({ consentId: 'c', transactionId: 't', patientId: 'p', mrn: 'P-000001', records: 2, documents: 3, heldBack: 1, practice: true });
    expect(safeAuditDetails('ABDM_RECORDS_SHARED', details, { scope: 'platform' })).toEqual({ records: 2, documents: 3, heldBack: 1, practice: true });
    expect(safeAuditDetails('ABDM_SHARE_REFUSED', { consentId: 'c', refusal: 'consent_revoked', reason: 'typed' }, { scope: 'platform' })).toEqual({ refusal: 'consent_revoked' });
  });
});
