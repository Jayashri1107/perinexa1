// Taking one hospital's data out of Perinexa – for a move to another system, a legal request or an off-site copy.
// This is the riskiest thing Perinexa does (one folder with every patient of a hospital), so it is never a web page:
// only the person who runs the server can do it, with
//   npm run export:hospital -- --hospital "<exact hospital name>" --out "<folder>"
// (server/scripts/export-hospital.js reads the command line and asks for the confirmation; everything else is here,
// so the tests can run it against the test database).
//
//  - The folder must be outside the project folder (so the data can never end up in git or on the website) and new
//    or empty (nothing already there is mixed up with it or overwritten). Checked before anything is read, and again
//    just before writing.
//  - The operator types the hospital's name again to confirm (--yes skips it, for tests).
//  - Only THAT hospital: every query names its tenantId.
//  - What is written is chosen kind by kind (KINDS). A kind of record added to Perinexa later is not written until
//    it is added here on purpose: a test fails until every model is either in KINDS or in LEFT_OUT. Within a kind,
//    only the fields Perinexa's models know today are written (a field removed from the code but still stored in old
//    records stays out); staff and the hospital itself are written field by field (staff.json, hospital.json).
//  - Never: password hashes, sign-in sessions or tokens, patient portal code hashes, the waiting-room screen key,
//    other hospitals' data, staff e-mail addresses, or anything from server/.env – every file is checked for the
//    secret settings of server/.env and for the names of those fields before it is kept.
//  - The stored files (lab report files, scanned signed consent forms) go in the subfolder "files", named by their id
//    (never by the uploaded name, which may hold a patient's name), with a list in stored-files.json.
//  - README.txt says in plain words what each file is, the date, the counts, and that the folder holds confidential
//    patient data, is not encrypted, must be kept on an encrypted disk and deleted when no longer needed.
//  - One entry in the hospital's audit log, counts only: "Hospital data exported by the server operator". An
//    export that could not be recorded there is not kept.
//  - If anything goes wrong (or the operator stops it), what was written is removed again.
// There is no web endpoint for any of this, on purpose.

import { mkdir, open, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { AbdmCareContext } from '../models/AbdmCareContext.js';
import { AbdmConsent } from '../models/AbdmConsent.js';
import { AbdmFetchRequest } from '../models/AbdmFetchRequest.js';
import { AbdmTransfer } from '../models/AbdmTransfer.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Arrival } from '../models/Arrival.js';
import { AuditLog } from '../models/AuditLog.js';
import { Bill } from '../models/Bill.js';
import { CarePlan } from '../models/CarePlan.js';
import { CarePlanTemplate } from '../models/CarePlanTemplate.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { ConsentForm } from '../models/ConsentForm.js';
import { Counter } from '../models/Counter.js';
import { LabOrder } from '../models/LabOrder.js';
import { LabPackage } from '../models/LabPackage.js';
import { MedicineSafetyList } from '../models/MedicineSafetyList.js';
import { Membership } from '../models/Membership.js';
import { NursingEntry } from '../models/NursingEntry.js';
import { OpdSchedule } from '../models/OpdSchedule.js';
import { Patient } from '../models/Patient.js';
import { PatientConsent } from '../models/PatientConsent.js';
import { PatientNote } from '../models/PatientNote.js';
import { Medicine, PharmacyInvoice, Purchase, PurchaseOrder, StockBatch, StockMove, Supplier, SupplierReturn } from '../models/Pharmacy.js';
import { PrescriptionDesign } from '../models/PrescriptionDesign.js';
import { PrescriptionSet } from '../models/PrescriptionSet.js';
import { PriceItem } from '../models/PriceItem.js';
import { RedFlagRuleSet } from '../models/RedFlagRuleSet.js';
import { ReminderMessage } from '../models/ReminderMessage.js';
import { ScanShare } from '../models/ScanShare.js';
import { FILE_KINDS, StoredFile } from '../models/StoredFile.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { WorkDone } from '../models/WorkDone.js';

/** The project folder (where package.json and server/ are): the export is never written inside it. */
export const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const AUDIT_ACTION = 'HOSPITAL_DATA_EXPORTED';
const FILES_FOLDER = 'files';

/** A refusal in plain words (the command prints the message; nothing was written). */
export class ExportRefused extends Error {}
const refuse = (message) => new ExportRefused(message);

// ---------- What is written ----------

/**
 * One JSON file per kind of record of the hospital, in the order README.txt lists them. what: for README.txt.
 * Each file is a list of records; "id" is the record's id, and other files point to it (e.g. "patientId").
 */
export const KINDS = [
  { file: 'patients.json', model: Patient, what: 'The patients: name, age, phone, address, type of care, medical and obstetric background, the pregnancy with its risk level and reasons, a pregnancy loss, the last delivery, a baby\'s birth details and mother, a baby\'s NICU or SNCU stay and feeding at discharge, a death recorded by a doctor (and any recorded in error and undone, with the reason), the full ABHA number, and records marked as a duplicate of another.' },
  { file: 'visits.json', model: Visit, what: 'Every outpatient visit: vital signs, the doctor\'s notes (with the private notes), diagnosis, advice, prescriptions, who signed, corrections added later, and visits marked "entered in error" (with their content and the reason).' },
  { file: 'emergency-notes.json', model: PatientNote, what: 'Emergency treatment notes written by a doctor who was not the patient\'s own doctor, with the reason.' },
  { file: 'care-plans.json', model: CarePlan, what: 'The care plans: each check-up, test or vaccination with its due dates and what was done, and each plan\'s history.' },
  { file: 'lab-orders.json', model: LabOrder, what: 'Lab orders: the tests, the sample, the results with their Low/High marks, the lab\'s remarks, the doctor\'s review, results changed after the report, and cancelled orders. The report files themselves are in the "files" folder.' },
  { file: 'scans-and-procedures.json', model: WorkDone, what: 'Scans and procedures recorded as done (what, when, by whom).' },
  { file: 'admissions.json', model: Admission, what: 'Stays in hospital: admission, ward and bed, reason, discharge.' },
  { file: 'inpatient-documents.json', model: ClinicalDocument, what: 'The documents of each stay: admission, round, delivery, operation and discharge notes – signed, draft or marked "entered in error" – with additions.' },
  { file: 'nursing-entries.json', model: NursingEntry, what: 'The nursing chart of each stay: vital signs, medicines given and notes.' },
  { file: 'consents.json', model: PatientConsent, what: 'Consent forms and information sheets printed for a patient, with what was typed into them, and when the signed copy came back. Scanned signed copies are in the "files" folder.' },
  { file: 'appointments.json', model: Appointment, what: 'Appointments and walk-in tokens, and what became of them.' },
  { file: 'arrivals.json', model: Arrival, what: 'Patients marked as arrived at reception, by day.' },
  { file: 'reminder-messages.json', model: ReminderMessage, what: 'Reminder messages to patients by SMS or WhatsApp: the text, the phone number, and whether they were sent.' },
  { file: 'abha-scan-and-share.json', model: ScanShare, what: 'ABHA details that patients shared at the reception desk with the Scan & Share QR code.' },
  { file: 'abha-linked-records.json', model: AbdmCareContext, what: 'Which visits, lab reports and discharge summaries were linked to a patient\'s ABHA, to which ABHA, when, and by whom (or by her from her ABHA app).' },
  { file: 'abha-consents.json', model: AbdmConsent, what: 'Consents patients gave in their ABHA app for another hospital or app to receive their records: who asked, the purpose, the kinds of records, the dates and the expiry, and when they were withdrawn.' },
  { file: 'abha-records-sent.json', model: AbdmTransfer, what: 'Each request for a patient\'s records under a consent: refused, or which records were sent (by reference, with counts – never their content).' },
  { file: 'abha-records-asked-for.json', model: AbdmFetchRequest, what: 'Each time a doctor asked for a patient\'s records from other hospitals through ABDM: who asked and when, the kinds of record and dates asked for, her answer, which hospitals answered and how many documents came (counts only – the documents themselves are never exported).' },
  { file: 'bills.json', model: Bill, what: 'Bills: their lines, discounts, payments, deposits, refunds, insurance details and cancellations.' },
  { file: 'pharmacy-medicines.json', model: Medicine, what: 'Pharmacy: the medicines on the stock list.' },
  { file: 'pharmacy-stock-batches.json', model: StockBatch, what: 'Pharmacy: the stock batches (batch number, expiry, quantity, prices).' },
  { file: 'pharmacy-stock-moves.json', model: StockMove, what: 'Pharmacy: every change of stock (purchases, sales, issues, returns, write-offs, counts) – the registers are read from these.' },
  { file: 'pharmacy-suppliers.json', model: Supplier, what: 'Pharmacy: the suppliers.' },
  { file: 'pharmacy-purchases.json', model: Purchase, what: 'Pharmacy: purchases from suppliers.' },
  { file: 'pharmacy-purchase-orders.json', model: PurchaseOrder, what: 'Pharmacy: purchase orders.' },
  { file: 'pharmacy-supplier-returns.json', model: SupplierReturn, what: 'Pharmacy: stock returned to suppliers.' },
  { file: 'pharmacy-invoices.json', model: PharmacyInvoice, what: 'Pharmacy: sales and issues to patients, with their tax invoices and returns.' },
  { file: 'audit-log.json', model: AuditLog, what: 'The hospital\'s audit log: who did what and when (record ids and counts, never what was written). People are named; their e-mail addresses are left out.' },
  { file: 'numbering.json', model: Counter, what: 'The last number given in each of the hospital\'s numbering series (patient numbers, receipts, invoices …), so another system can go on from there.' },
  { file: 'settings-care-plan-templates.json', model: CarePlanTemplate, what: 'Settings: the care plan templates and risk rules, with their versions and who approved them.' },
  { file: 'settings-consent-forms.json', model: ConsentForm, what: 'Settings: the consent forms and information sheets, with their versions and who approved them.' },
  { file: 'settings-lab-packages.json', model: LabPackage, what: 'Settings: the lab test packages.' },
  { file: 'settings-prescription-sets.json', model: PrescriptionSet, what: 'Settings: the ready-made prescription sets.' },
  { file: 'settings-prescription-layout.json', model: PrescriptionDesign, what: 'Settings: how each doctor\'s prescriptions look when printed.' },
  { file: 'settings-price-list.json', model: PriceItem, what: 'Settings: the price list.' },
  { file: 'settings-red-flag-rules.json', model: RedFlagRuleSet, what: 'Settings: the red flag rules.' },
  { file: 'settings-medicine-safety.json', model: MedicineSafetyList, what: 'Settings: the medicine safety list (pregnancy and breastfeeding warnings).' },
  { file: 'settings-opd-timings.json', model: OpdSchedule, what: 'Settings: each doctor\'s OPD timings and days on leave.' },
];

/** Written field by field (not from KINDS): the hospital itself, its staff and the list of stored files. */
const SPECIAL_FILES = {
  'hospital.json': 'The hospital\'s own details: name, letterhead, the pharmacy\'s licence numbers, the UPI ID for payment links (and earlier ones), the ABDM ids, and which patient messages are switched on.',
  'staff.json': 'The staff of the hospital: name, roles here, whether they still work here, and a doctor\'s qualification and registration number. No e-mail addresses and no passwords. The ids in the other files ("by", "doctorId", "actor" …) are these ids; an id that is not here is someone outside the hospital\'s staff (for example the platform\'s super admin).',
  'stored-files.json': 'The list of the stored files (lab report files and scanned signed consent forms): the patient and the record each belongs to, its name when it was added, type and size, who added it and when, and where it is in the "files" folder.',
};

/**
 * Models that are deliberately not written, and why (the test that every model is accounted for reads this).
 * User, Membership and Tenant are written field by field as staff.json and hospital.json.
 */
export const LEFT_OUT = {
  User: 'Sign-in accounts are shared between hospitals and hold the password hash: only the name and a doctor\'s registration go in staff.json.',
  Membership: 'Written as staff.json (name and roles).',
  Tenant: 'Written as hospital.json, field by field (never the waiting-room screen key).',
  StoredFile: 'Written as stored-files.json and the "files" folder.',
  PortalAccess: 'Patient portal codes (kept only as hashes) never leave Perinexa.',
  DictationWord: 'Personal voice-entry words of staff accounts – not the hospital\'s data, and never patient information.',
  AbdmLinkRequest: 'Short-lived searches of a patient\'s ABHA app (deleted a day after their last change) with the hash of the OTP sent to her mobile – what was linked is in abha-linked-records.json.',
  AbdmFetchedRecord: 'Records other hospitals sent for a patient through ABDM with her consent: kept only until her consent ends and never sent on (ABDM\'s rule) – what was asked for and received is in abha-records-asked-for.json.',
  AbdmFetchedFile: 'Files attached to those records – never sent on, like the records themselves.',
};

/** Field names that never leave, wherever they are (a second guard behind the choices above). */
const NEVER_KEYS = new Set(['passwordHash', 'codeHash', 'tokenVersion', 'displayKey']);
const NEVER_KEYS_PATTERN = new RegExp(`"(${[...NEVER_KEYS].join('|')})"\\s*:`);

/**
 * The secret settings of server/.env (and the passwords the seed scripts read from it). None of their values may
 * appear in an exported file; values shorter than 8 characters are not secrets and are not looked for.
 */
const SECRET_SETTINGS = ['JWT_SECRET', 'MONGO_URI', 'OPENAI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'ABDM_CLIENT_ID', 'ABDM_CLIENT_SECRET', 'SUPER_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'DEMO_PASSWORD'];
export const secretSettings = (env = process.env) =>
  SECRET_SETTINGS.map((name) => [name, String(env[name] ?? '').trim()]).filter(([, value]) => value.length >= 8);

// ---------- Records as plain JSON ----------

const isObjectId = (v) => v instanceof mongoose.Types.ObjectId || v?._bsontype === 'ObjectId';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !isObjectId(v) && !Buffer.isBuffer(v) && v._bsontype === undefined;

/**
 * Only the fields the schema knows (raw records from the database may hold fields that were removed from the code
 * since): nested objects, single sub-documents and lists of sub-documents are followed; a free-form field (Mixed)
 * and a list of plain values are kept as stored.
 */
function known(record, schema, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const full = `${prefix}${key}`;
    if (key === '__v') continue;
    const kind = schema.pathType(full);
    if (kind === 'nested') {
      if (isPlainObject(value)) out[key] = known(value, schema, `${full}.`);
      continue;
    }
    if (kind !== 'real') continue; // not (or no longer) in the code: not written
    const type = schema.path(full);
    if (value == null || !type.schema) out[key] = value;
    else if (type.$isMongooseDocumentArray) out[key] = Array.isArray(value) ? value.map((x) => (isPlainObject(x) ? known(x, type.schema) : x)) : value;
    else out[key] = isPlainObject(value) ? known(value, type.schema) : value;
  }
  return out;
}

/** JSON values: ids as text, times as ISO text (UTC), "_id" as "id"; binary data and the never-keys dropped. */
function plain(value) {
  if (value == null) return value;
  if (isObjectId(value)) return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value) || value._bsontype === 'Binary') return undefined;
  if (value._bsontype === 'Decimal128') return String(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (NEVER_KEYS.has(key) || key === '__v') continue;
      const p = plain(v);
      if (p !== undefined) out[key === '_id' ? 'id' : key] = p;
    }
    return out;
  }
  return value;
}

/** A record of a model as written: the fields the model knows, as plain JSON. */
export const recordFor = (model, raw) => plain(known(raw, model.schema));

/**
 * The details of an audit entry without e-mail addresses (an entry about an account change may hold one) and without
 * the ids of other hospitals (e.g. the hospital someone switched from). others: ids of the other hospitals, as text.
 */
function cleanDetails(value, others) {
  if (Array.isArray(value)) return value.filter((v) => !others.has(v)).map((v) => cleanDetails(v, others));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => k !== 'email' && !others.has(v))
        .map(([k, v]) => [k, cleanDetails(v, others)]),
    );
  }
  return value;
}

/** Only these fields of an object (a missing one as null), for the records written field by field. */
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj?.[f] ?? null]));

function hospitalRecord(t) {
  return plain({
    id: t._id,
    name: t.name,
    active: t.isActive !== false,
    createdAt: t.createdAt ?? null,
    // (never the PC-PNDT number removed on 2 Oct 2026, still stored in older hospitals)
    letterhead: pick(t.letterhead, ['name', 'tagline', 'address', 'phone', 'email', 'registrationNumber', 'footer', 'consentLanguage']),
    pharmacy: pick(t.pharmacy, ['name', 'gstin', 'licence20', 'licence21', 'rmi', 'pharmacistName', 'state', 'place', 'pin']),
    billing: { ...pick(t.billing, ['upiId', 'payeeName', 'updatedByName', 'updatedAt']), history: (t.billing?.history ?? []).map((h) => pick(h, ['upiId', 'payeeName', 'byName', 'at'])) },
    abdm: pick(t.abdm, ['hfrId', 'hipId', 'counterCode']),
    // The waiting-room screen: only whether it is on – its key (a secret in its web address) never leaves
    messaging: { ...pick(t.messaging, ['remindersEnabled', 'portalEnabled', 'portalBooking', 'whatsappDocuments']), waitingRoomScreenOn: Boolean(t.messaging?.displayKey) },
  });
}

// ---------- The folder ----------

// (the disks of a Mac and of Windows usually do not tell capitals from small letters: compared without them there)
const caseless = process.platform === 'darwin' || process.platform === 'win32';
const norm = (p) => (caseless ? p.toLowerCase() : p);
const inside = (child, parent) => norm(child) === norm(parent) || norm(child).startsWith(`${norm(parent)}${path.sep}`);

/** Where a path really is on disk: the nearest folder that exists, with its links followed, and the rest. */
async function realPlace(target) {
  const rest = [];
  let at = target;
  for (;;) {
    try {
      return path.join(await realpath(at), ...rest.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const up = path.dirname(at);
      if (up === at) throw err;
      rest.push(path.basename(at));
      at = up;
    }
  }
}

/**
 * Checks the folder the export is written to: given, outside the project folder (also through a link), and new or
 * empty. Returns { path, exists } (the real place); throws ExportRefused otherwise. Nothing is created here.
 */
export async function checkOutputFolder(out, { projectRoot = PROJECT_ROOT, cwd = process.cwd() } = {}) {
  if (!out || !String(out).trim()) throw refuse('Say where to write the files: --out "<folder>" – a new or empty folder outside the Perinexa folder, best on an encrypted disk.');
  const target = path.resolve(cwd, String(out).trim());
  const place = await realPlace(target);
  const root = await realpath(projectRoot);
  if (inside(place, root)) {
    throw refuse(`The folder ${target} is inside the Perinexa folder (${root}). Choose a folder outside it – for example on an encrypted external disk – so the patient data can never end up in git or on the website.`);
  }
  let found = null;
  try {
    found = await stat(place);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (found && !found.isDirectory()) throw refuse(`${target} is a file, not a folder. Choose a new or empty folder.`);
  if (found && (await readdir(place)).length > 0) {
    throw refuse(`The folder ${target} is not empty. Choose a new or empty folder, so that nothing already in it is mixed up with the patient data or overwritten.`);
  }
  return { path: place, exists: Boolean(found) };
}

// ---------- The hospital ----------

/** The hospital with exactly this name (Platform → Hospitals). Throws ExportRefused when there is none. */
export async function findHospital(name) {
  const wanted = String(name ?? '').trim();
  if (!wanted) throw refuse('Say which hospital: --hospital "<the hospital\'s name, exactly as on the platform\'s Hospitals page>".');
  const tenant = await Tenant.findOne({ nameKey: wanted.toLowerCase() });
  if (!tenant || tenant.name !== wanted) {
    throw refuse(`No hospital is named exactly "${wanted}".${tenant ? ` Did you mean "${tenant.name}"? The name must be typed exactly, capitals included.` : ' Type the name exactly as on the platform\'s Hospitals page.'}`);
  }
  return tenant;
}

// ---------- Writing ----------

const MEDIA_EXTENSIONS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const CHUNK = 1 << 20; // write about a megabyte at a time

/**
 * Writes the export of one hospital into `out` (checked again here: outside the project, new or empty) and records
 * it in the hospital's audit log. tenant: the hospital (findHospital). now: the time written in README.txt.
 * secrets: [name, value] pairs that must not appear in any file (default: from server/.env). signal: an AbortSignal
 * that stops the export (Ctrl+C) – what was written is then removed, as after any error.
 * Returns { folder, counts: { [file]: records }, files, records, patients }.
 */
export async function exportHospital({ tenant, out, now = new Date(), projectRoot = PROJECT_ROOT, cwd = process.cwd(), secrets = secretSettings(), signal = null }) {
  const folder = await checkOutputFolder(out, { projectRoot, cwd });
  const tenantId = tenant._id;
  const written = []; // files written and folders made, for removing them again
  const stopIfAsked = () => {
    if (signal?.aborted) throw refuse('The export was stopped. Nothing was kept.');
  };
  /** A file's text must hold no secret setting and no never-key. */
  const assertClean = (text, file) => {
    const found = secrets.find(([, value]) => text.includes(value));
    if (found) throw refuse(`A secret setting of server/.env (${found[0]}) was found in the data for ${file}. Nothing was kept. Ask the developer to look into it before taking the data out.`);
    // (the value itself is never printed)
    if (NEVER_KEYS_PATTERN.test(text)) throw refuse(`A field that must never leave Perinexa was found in the data for ${file}. Nothing was kept.`);
  };
  /** Makes the folder (and any missing folders above it), noting each one made for removing it again. */
  const makeFolder = async (dir) => {
    const first = await mkdir(dir, { recursive: true, mode: 0o700 }); // the first folder made (undefined: none)
    if (!first) return;
    const made = [];
    for (let at = dir; ; at = path.dirname(at)) {
      made.push(at);
      if (at === first || path.dirname(at) === at) break;
    }
    written.push(...made.reverse().map((d) => ({ dir: d })));
  };
  const openNew = async (file) => {
    const handle = await open(file, 'wx', 0o600); // never over an existing file
    written.push({ file });
    return handle;
  };
  /** One JSON file: a list of records, one per line. */
  const writeList = async (file, records) => {
    const handle = await openNew(path.join(folder.path, file));
    let count = 0;
    let text = '[';
    try {
      for await (const record of records) {
        stopIfAsked();
        const line = JSON.stringify(record);
        assertClean(line, file);
        text += `${count ? ',' : ''}\n${line}`;
        count += 1;
        if (text.length > CHUNK) {
          await handle.write(text);
          text = '';
        }
      }
      await handle.write(`${text}${count ? '\n' : ''}]\n`);
    } finally {
      await handle.close();
    }
    return count;
  };
  const writeText = async (file, text) => {
    assertClean(text, file);
    const handle = await openNew(path.join(folder.path, file));
    try {
      await handle.write(text);
    } finally {
      await handle.close();
    }
  };
  const records = (model, filter = {}, map = (raw) => recordFor(model, raw)) => ({
    async *[Symbol.asyncIterator]() {
      for await (const raw of model.find({ ...filter, tenantId }).sort({ _id: 1 }).lean().cursor({ batchSize: 200 })) yield map(raw);
    },
  });

  try {
    if (!folder.exists) await makeFolder(folder.path);
    const counts = {};

    // The hospital and its staff, field by field
    counts['hospital.json'] = 1;
    await writeText('hospital.json', `${JSON.stringify(hospitalRecord(tenant.toObject ? tenant.toObject() : tenant), null, 2)}\n`);
    const members = await Membership.find({ tenantId }).sort({ createdAt: 1, _id: 1 }).lean();
    const people = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1, professional: 1 }).lean()).map((u) => [String(u._id), u]));
    counts['staff.json'] = await writeList(
      'staff.json',
      members.map((m) => {
        const u = people.get(String(m.userId));
        return plain({ id: m.userId, name: u?.name ?? null, roles: m.roles, activeHere: m.isActive !== false, since: m.createdAt ?? null, professional: pick(u?.professional, ['qualification', 'registrationNumber', 'council']) });
      }),
    );

    // The records, kind by kind. The audit log names people (never their e-mail addresses) and no other hospital.
    const others = new Set((await Tenant.find({ _id: { $ne: tenantId } }, { _id: 1 }).lean()).map((t) => String(t._id)));
    const auditPeople = new Set([...(await AuditLog.distinct('actor', { tenantId })), ...(await AuditLog.distinct('target', { tenantId }))].filter(Boolean).map(String));
    const names = new Map((await User.find({ _id: { $in: [...auditPeople] } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
    for (const kind of KINDS) {
      stopIfAsked();
      const map =
        kind.model === AuditLog
          ? (raw) => {
              const { actorEmail: _a, targetEmail: _t, details, ...entry } = recordFor(AuditLog, raw);
              return { ...entry, actorName: entry.actor ? (names.get(entry.actor) ?? null) : null, targetName: entry.target ? (names.get(entry.target) ?? null) : null, details: cleanDetails(details ?? {}, others) };
            }
          : undefined;
      counts[kind.file] = await writeList(kind.file, records(kind.model, {}, map));
    }

    // The stored files, named by id, and their list (only the kinds Perinexa still reads)
    const filesDir = path.join(folder.path, FILES_FOLDER);
    await makeFolder(filesDir);
    let stored = 0;
    counts['stored-files.json'] = await writeList('stored-files.json', {
      async *[Symbol.asyncIterator]() {
        for await (const f of StoredFile.find({ tenantId, kind: { $in: FILE_KINDS } }).sort({ _id: 1 }).cursor({ batchSize: 10 })) {
          stopIfAsked();
          const name = `${f._id}.${MEDIA_EXTENSIONS[f.mediaType] ?? 'bin'}`;
          const handle = await openNew(path.join(filesDir, name));
          try {
            await handle.write(f.data);
          } finally {
            await handle.close();
          }
          stored += 1;
          yield plain({ id: f._id, kind: f.kind, patientId: f.patientId, ownerId: f.ownerId, fileName: f.fileName, mediaType: f.mediaType, size: f.size, by: f.by, byName: f.byName, createdAt: f.createdAt, path: `${FILES_FOLDER}/${name}` });
        }
      },
    });

    const total = Object.entries(counts).reduce((sum, [file, n]) => sum + (file === 'hospital.json' ? 0 : n), 0);
    const summary = { folder: folder.path, counts, files: stored, records: total, patients: counts['patients.json'] };
    await writeText('README.txt', readmeText({ tenant, now, summary }));

    // Recorded in the hospital's audit log – counts only. If it cannot be recorded, the export is not kept.
    stopIfAsked();
    await AuditLog.create({
      action: AUDIT_ACTION,
      tenantId,
      actor: null,
      details: { patients: summary.patients, records: total, files: stored, counts: Object.fromEntries(Object.entries(counts).map(([file, n]) => [file.replace(/\.json$/, ''), n])) },
    });
    return summary;
  } catch (err) {
    if (!(await removeWritten(written))) err.folderLeft = folder.path;
    throw err;
  }
}

/**
 * Removes what this export wrote: its files, then its folders (only when empty – never anything else). Returns
 * false when something could not be removed.
 */
async function removeWritten(written) {
  let all = true;
  for (const item of [...written].reverse()) {
    try {
      if (item.file) await rm(item.file, { force: true });
      else await rmdir(item.dir);
    } catch {
      all = false; // (e.g. a folder someone else put something in meanwhile: it stays)
    }
  }
  return all;
}

// ---------- README.txt ----------

function hospitalTime(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.HOSPITAL_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${v('day')} ${v('month')} ${v('year')}, ${v('hour')}:${v('minute')}`;
}
const counted = (n) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'record' : 'records'}`;

export function readmeText({ tenant, now, summary }) {
  const c = summary.counts;
  const line = (file, what) => `${file} (${counted(c[file] ?? 0)})\n${wrap(what, '    ')}`;
  return [
    'PERINEXA – THE DATA OF ONE HOSPITAL',
    '',
    `Hospital: ${tenant.name}`,
    `Taken out: ${hospitalTime(now)} (${config.HOSPITAL_TIME_ZONE} time) – ${now.toISOString()} in UTC`,
    'By: the person who runs the Perinexa server, with the command "npm run export:hospital".',
    `In this folder: ${counted(summary.records)} in ${Object.keys(c).length} files, and ${summary.files} stored ${summary.files === 1 ? 'file' : 'files'} in the "${FILES_FOLDER}" folder.`,
    '',
    'WARNING – CONFIDENTIAL PATIENT DATA',
    'This folder holds the confidential medical records of every patient of this hospital.',
    'It is NOT encrypted: anyone who can open this folder can read all of it.',
    '  - Keep it only on an encrypted disk (for example a disk protected with FileVault or BitLocker).',
    '  - Do not e-mail or upload it, or copy it to a shared folder or an unencrypted USB stick.',
    '  - Give it only to the people it was taken out for.',
    '  - Delete it (and empty the bin) as soon as it is no longer needed.',
    wrap('Taking the data out is recorded in the hospital\'s audit log as "Hospital data exported by the server operator".'),
    '',
    'WHAT EACH FILE HOLDS',
    '',
    ...[...KINDS.map((k) => line(k.file, k.what)), ...Object.entries(SPECIAL_FILES).map(([file, what]) => line(file, what))].flatMap((x) => [x, '']),
    `${FILES_FOLDER}/ (${summary.files} ${summary.files === 1 ? 'file' : 'files'})`,
    wrap('The stored files themselves (PDFs and photos), each named by its id. stored-files.json says which patient and record each belongs to.', '    '),
    '',
    'HOW TO READ THE FILES',
    wrap('- Each .json file is a list of records, one per line (hospital.json is one record). They can be opened with any text editor or read by another program.'),
    wrap('- "id" is the record\'s id in Perinexa. Other files point to it: for example "patientId" in visits.json is the "id" of a patient in patients.json, and "by", "doctorId" or "actor" is the "id" of a person in staff.json.'),
    wrap('- Times are in UTC (they end in "Z"). Days without a time – a date of birth, the LMP, the EDD, the day of a visit – are written as midnight UTC of that day.'),
    wrap('- Amounts of money are in paise (100 paise = 1 rupee).'),
    wrap('- Only what Perinexa uses today is written: a field that was removed from Perinexa but is still stored in older records is not.'),
    '',
    'NOT IN THIS FOLDER',
    wrap('- Passwords and password hashes, sign-in sessions and their keys, patient portal codes, the key of the waiting-room screen, and the server\'s own settings (server/.env).'),
    wrap('- Staff e-mail addresses (staff are named), and staff members\' personal voice-entry words.'),
    wrap('- Anything of another hospital.'),
    '',
  ].join('\n');
}

/** Lines of at most 100 characters, for reading in any text editor. */
function wrap(text, indent = '') {
  const lines = [];
  let current = indent;
  for (const word of text.split(' ')) {
    if (current.trim() && `${current} ${word}`.length > 100) {
      lines.push(current);
      current = `${indent}  ${word}`;
    } else current = current.trim() ? `${current} ${word}` : `${current}${word}`;
  }
  if (current.trim()) lines.push(current);
  return lines.join('\n');
}

// ---------- The command ----------

export const USAGE = [
  'Takes one hospital\'s data out of Perinexa into a folder (for a move to another system, a legal request or an off-site copy).',
  '',
  '  npm run export:hospital -- --hospital "<exact hospital name>" --out "<folder>"',
  '',
  '  --hospital  the hospital\'s name, exactly as on the platform\'s Hospitals page',
  '  --out       a new or empty folder OUTSIDE the Perinexa folder, best on an encrypted disk',
  '  --yes       do not ask to type the name again (for automatic tests only)',
].join('\n');

/** The command line: { hospital, out, yes, help }. Throws ExportRefused (with the usage) for anything else. */
export function parseExportArgs(argv) {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { hospital: { type: 'string' }, out: { type: 'string' }, yes: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } }, strict: true, allowPositionals: true });
    if (positionals.length) throw new Error(`Unexpected "${positionals[0]}" – put names with spaces in quotes.`);
    return values;
  } catch (err) {
    throw refuse(`${err.message}\n\n${USAGE}`);
  }
}

/**
 * The whole command (server/scripts/export-hospital.js): checks the arguments and the folder before connecting to
 * the database, finds the hospital, asks for its name again (unless --yes), exports, and prints what was written.
 * connect: connects to the database (the script's; a no-op in tests). ask(question): the operator's answer.
 * print(text): a line for the operator. Returns the exit code (0: done; 1: refused, not confirmed or failed –
 * then nothing is kept).
 */
export async function runExportCommand({ argv, cwd = process.cwd(), connect = async () => {}, ask, print = console.log, projectRoot = PROJECT_ROOT, now = () => new Date(), signal = null }) {
  try {
    const args = parseExportArgs(argv);
    if (args.help) {
      print(USAGE);
      return 0;
    }
    if (!args.hospital) throw refuse(`Say which hospital: --hospital "<exact hospital name>".\n\n${USAGE}`);
    const folder = await checkOutputFolder(args.out, { projectRoot, cwd });
    await connect();
    const tenant = await findHospital(args.hospital);
    const patients = await Patient.countDocuments({ tenantId: tenant._id });
    print(`This writes the records of every patient of "${tenant.name}" (${patients.toLocaleString('en-IN')} ${patients === 1 ? 'patient' : 'patients'}), its staff list and its audit log to:`);
    print(`  ${folder.path}`);
    print('The files are not encrypted. Anyone who can open the folder can read them.');
    if (!args.yes) {
      const answer = String((await ask('Type the hospital\'s name again to go on (anything else stops): ')) ?? '').trim();
      if (answer !== tenant.name) {
        print('Not confirmed – nothing was written.');
        return 1;
      }
    }
    const done = await exportHospital({ tenant, out: args.out, now: now(), projectRoot, cwd, signal });
    print('');
    print(`Done: ${counted(done.records)} and ${done.files} stored ${done.files === 1 ? 'file' : 'files'} were written to ${done.folder}`);
    for (const [file, n] of Object.entries(done.counts)) print(`  ${file.padEnd(36)} ${n.toLocaleString('en-IN')}`);
    if (done.files) print(`  ${`${FILES_FOLDER}/`.padEnd(36)} ${done.files.toLocaleString('en-IN')}`);
    print('');
    print('This folder holds confidential patient data and is NOT encrypted. Keep it only on an encrypted disk, give it only to');
    print('the people it is for, and delete it as soon as it is no longer needed. README.txt in the folder says what each file is.');
    print('The export is recorded in the hospital\'s audit log ("Hospital data exported by the server operator").');
    return 0;
  } catch (err) {
    const left = err?.folderLeft ? ` Some of what was written could not be removed: delete the folder ${err.folderLeft} by hand.` : '';
    if (err instanceof ExportRefused) print(`${err.message}${left}`);
    else print(`The export failed: ${err?.message ?? err}.${left || ' Nothing was kept.'}`);
    return 1;
  }
}
