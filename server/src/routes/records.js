import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { DAY, hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { PatientDocument } from '../models/PatientDocument.js';
import { RecordCopyIssue } from '../models/RecordCopyIssue.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { NOT_DUPLICATE, isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { COPY_WHATS, DOC_TYPES, DRAFT_OPEN_AFTER_DAYS, GIVEN_TO, MAX_DOCUMENT_BYTES, RECEIVER_NAME_NEEDED, VISIT_UNSIGNED_AFTER_DAYS, copyLate, hoursToGive } from '../records/recordRules.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, departmentListFilter, patientAccess } from '../utils/patientAccess.js';
import { findPatient, findPatientById } from '../utils/patientLookup.js';
import { safeText } from '../utils/pcpndt.js';
import { findFile, sendFile, storeFile, uploadSchema } from '../utils/storedFiles.js';
import { dateOnly, escapeRegex, objectId, pageParams, paged, parse, requiredDateOnly, sortParam, toMongoSort } from '../utils/validate.js';

// The medical records module (9 Nov 2026, the owner's request). Two routers:
//  - patientDocumentsRouter, /api/patients/:id/documents: the scanned and outside documents attached to one record –
//    the list, a new one, the file itself, one marked as put on the wrong record. Who: those who may see her
//    medical details (her doctor, RMOs, nurses – a sensitive record: her doctor and RMOs), and the medical records
//    login, which files every record's papers and sees the record's identity details, never the clinical notes.
//    Uploading: those who may record on the record, and the medical records login.
//  - recordsRouter, /api/records (the Records menu: the medical records login, doctors and RMOs): the records index
//    (every record with its last stay and how many documents it has), the incomplete-records list (unsigned visits,
//    inpatient documents still drafts) and the copies register (every copy of a record that left the hospital).
// The audit log gets ids, the kind of document and counts – never a title, a file's content or a name typed in.
// Brought from the other Perinexa copy (girishsolanke/perinexa, 9 Nov 2026). Here the department rule (owner, 9 Nov
// 2026) also holds: a doctor whose only patient role is doctor lists only the patients of their departments
// (utils/patientAccess.js departmentListFilter), and a record hidden from them is "not found".

export const patientDocumentsRouter = Router({ mergeParams: true });
export const recordsRouter = Router();

export const RECORDS_ROLE = 'records';
export const RECORDS_ROLES = [RECORDS_ROLE, 'doctor', 'rmo'];
const FILE_KIND = 'patient_document';

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const stampView = (s) => (s ? { byName: s.byName ?? null, at: s.at ?? null } : null);
const ids = (patient, extra = {}) => ({ patientId: String(patient._id), mrn: patient.mrn, ...extra });
const todayUtc = (req) => utcDay(hospitalToday(req.now));

/** What this person may do with this patient's documents. (Also used by the copy of the whole record.) */
export function documentsAccess(req, patient) {
  const a = patientAccess(req, patient);
  const records = hasRole(req.membership, RECORDS_ROLE);
  const clinical = a.view.has('pregnancy');
  // Reception (documentsDesk): the list and attaching only – never the file or its note
  const desk = a.documentsDesk === true;
  return {
    view: records || clinical || desk,
    open: records || clinical,
    upload: records || desk || Boolean(a.editClinical || a.recordVitals),
    cancel: records || a.editClinical === true,
    stays: clinical, // the stays to link a document to: a clinical detail
    level: a.level,
  };
}

/** One document as sent to the browser (never the file's bytes). */
export function documentView(d, access) {
  return {
    id: String(d._id),
    patientId: String(d.patientId),
    docType: d.docType,
    title: d.title,
    documentOn: isoDay(d.documentOn),
    admissionId: d.admissionId ? String(d.admissionId) : null,
    note: access.open ? (d.note ?? '') : '', // (reception: the list only, never a note)
    file: { id: String(d.file.fileId), fileName: d.file.fileName, mediaType: d.file.mediaType, size: d.file.size },
    uploaded: stampView(d.uploaded),
    cancelled: d.cancelled ? { ...stampView(d.cancelled), reason: d.cancelled.reason ?? '' } : null,
    access: {
      // (a document marked as put on the wrong record is opened only by those who could have marked it – to check)
      canOpen: access.open && (!d.cancelled || access.cancel),
      canCancel: access.cancel && !d.cancelled,
    },
  };
}

// ---------- A patient's documents ----------

async function loadForDocuments(req) {
  const patient = await findPatient(req);
  const access = documentsAccess(req, patient);
  if (!access.view) throw forbidden("You can't see this patient's documents.");
  return { patient, access };
}

patientDocumentsRouter.get('/', async (req, res) => {
  const { patient, access } = await loadForDocuments(req);
  const [documents, stays] = await Promise.all([
    // (those in use first, then the ones marked as wrongly attached; by the date on the paper, the undated last; the newest attached first)
    PatientDocument.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ cancelled: 1, documentOn: -1, _id: -1 }).limit(500),
    access.stays ? Admission.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ admittedAt: -1 }).limit(50) : [],
  ]);
  await audit(req, 'PATIENT_FILES_VIEWED', { details: ids(patient, { shown: documents.length }) });
  res.json({
    documents: documents.map((d) => documentView(d, access)),
    canUpload: access.upload && !isDuplicate(patient) && !isClosed(patient),
    stays: stays.map((s) => ({ id: String(s._id), admittedAt: s.admittedAt, dischargedAt: s.dischargedAt ?? null, ward: s.ward ?? '', status: s.status })),
    maxBytes: MAX_DOCUMENT_BYTES,
  });
});

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const newDocumentSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    docType: z.enum(DOC_TYPES, 'Choose what kind of document this is.'),
    title: safeText('Title', 120).min(2, 'Write what the document is (a few words).'),
    documentOn: z.preprocess(emptyToNull, dateOnly('The date on the document')).default(null),
    admissionId: z.preprocess(emptyToNull, z.union([z.null(), objectId])).default(null),
    note: safeText('Note', 500).default(''),
  })
  .merge(uploadSchema(MAX_DOCUMENT_BYTES).omit({ reason: true }))
  .strict();

patientDocumentsRouter.post('/', async (req, res) => {
  const { patient, access } = await loadForDocuments(req);
  if (!access.upload) throw forbidden("Only the patient's doctor, an RMO, a nurse, reception or the medical records staff attaches documents.");
  const body = parse(newDocumentSchema, req.body);
  const repeat = await PatientDocument.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) {
    if (String(repeat.patientId) !== String(patient._id)) throw new HttpError(409, 'This request was already used.', 'CONFLICT');
    return res.status(201).json({ document: documentView(repeat, access) });
  }
  refuseNewOnDuplicate(patient, 'patientFile');
  refuseNewOnClosed(patient, 'patientFile');
  if (body.documentOn && body.documentOn.getTime() > todayUtc(req).getTime()) throw invalid({ documentOn: 'The date on the document cannot be after today.' });
  if (body.admissionId) {
    if (!access.stays) throw forbidden('Linking a document to a stay needs access to her medical details.');
    const stay = await Admission.findOne({ _id: body.admissionId, tenantId: req.tenantId, patientId: patient._id }, { _id: 1 }).lean();
    if (!stay) throw invalid({ admissionId: 'This stay is not on her record. Reload the page and choose again.' });
  }
  // The file is stored under the document's id, then the document itself (utils/storedFiles.js checks the file)
  const documentId = new mongoose.Types.ObjectId();
  const file = await storeFile(req, { patientId: patient._id, kind: FILE_KIND, ownerId: documentId, body, maxBytes: MAX_DOCUMENT_BYTES });
  const document = await PatientDocument.create({
    _id: documentId,
    tenantId: req.tenantId,
    patientId: patient._id,
    docType: body.docType,
    title: body.title,
    documentOn: body.documentOn,
    admissionId: body.admissionId,
    note: body.note,
    file: { fileId: file._id, fileName: file.fileName, mediaType: file.mediaType, size: file.size },
    uploaded: stampOf(req),
    clientRequestId: body.clientRequestId,
  });
  await audit(req, 'PATIENT_FILE_UPLOADED', { details: ids(patient, { documentId: String(document._id), docType: document.docType, fileId: String(file._id), size: file.size }) });
  return res.status(201).json({ document: documentView(document, access) });
});

async function loadDocument(req) {
  const { patient, access } = await loadForDocuments(req);
  const documentId = parse(objectId, req.params.documentId);
  const document = await PatientDocument.findOne({ _id: documentId, tenantId: req.tenantId, patientId: patient._id });
  if (!document) throw new HttpError(404, 'This document was not found.', 'NOT_FOUND');
  return { patient, access, document };
}

// The file itself, shown in the browser (audited every time)
patientDocumentsRouter.get('/:documentId/file', async (req, res) => {
  const { patient, access, document } = await loadDocument(req);
  if (!access.open) throw forbidden("Reception attaches documents and sees the list; the patient's doctor, RMOs, nurses and the medical records staff open them.");
  if (document.cancelled && !access.cancel) throw new HttpError(409, 'This document was marked as put on the wrong record.', 'CANCELLED');
  const file = await findFile(req, { kind: FILE_KIND, ownerId: document._id, fileId: document.file.fileId });
  await audit(req, 'PATIENT_FILE_OPENED', { details: ids(patient, { documentId: String(document._id), docType: document.docType, fileId: String(file._id) }) });
  sendFile(res, file);
});

// Put on the wrong record (or otherwise not hers): kept, marked, no longer opened by those who only read
patientDocumentsRouter.post('/:documentId/cancel', async (req, res) => {
  const { patient, access, document } = await loadDocument(req);
  if (!access.cancel) throw forbidden("Only the patient's doctor, an RMO or the medical records staff marks a document as wrongly attached.");
  const body = parse(z.object({ reason: safeText('Reason', 300) }).strict(), req.body);
  if (document.cancelled) return res.json({ document: documentView(document, access) });
  if (body.reason.length < 5) throw invalid({ reason: 'Write why this document does not belong here.' });
  document.cancelled = { ...stampOf(req), reason: body.reason };
  await document.save();
  await audit(req, 'PATIENT_FILE_CANCELLED', { details: ids(patient, { documentId: String(document._id), docType: document.docType }) });
  return res.json({ document: documentView(document, access) });
});

// ---------- The Records menu ----------

recordsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...RECORDS_ROLES)) throw forbidden('The records module is for the medical records staff, doctors and RMOs.');
  next();
});

/** The names of these doctors, by id. */
async function doctorNames(ids_) {
  const unique = [...new Set(ids_.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}
/** A record as the Records pages name it: identity details only. */
const patientLine = (p, doctors, now) => ({
  id: String(p._id),
  mrn: p.mrn,
  fullName: p.fullName,
  age: currentAge(p, now),
  careType: p.careType,
  assignedDoctorName: p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? null) : null,
  registeredOn: p.createdAt,
  closed: isClosed(p),
  duplicate: isDuplicate(p),
});

const indexQuery = z.object({
  search: z.string().trim().max(100).default(''),
  careType: z.string().trim().max(30).default(''),
  sort: sortParam(['mrn', 'fullName', 'createdAt'], '-createdAt'),
  ...pageParams,
});

// Every record, with its last stay and how many documents are attached
recordsRouter.get('/index', async (req, res) => {
  const q = parse(indexQuery, req.query);
  const and = [];
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    and.push({ $or: [{ fullName: rx }, { mrn: rx }, { phone: rx }] });
  }
  if (q.careType) and.push({ careType: q.careType });
  // (as the Patients list: records marked as duplicates are left out, unless their number is searched for exactly)
  and.push(q.search ? { $or: [NOT_DUPLICATE, { mrn: new RegExp(`^${escapeRegex(q.search)}$`, 'i') }] } : NOT_DUPLICATE);
  and.push(departmentListFilter(req)); // a doctor: the patients of their departments ({} for everyone else)
  const filter = { tenantId: req.tenantId, $and: and };
  const fields = 'mrn fullName ageYears ageRecordedOn careType assignedDoctor createdAt death duplicateOf';
  const [patients, total] = await Promise.all([
    Patient.find(filter).sort(toMongoSort(q.sort)).skip((q.page - 1) * q.limit).limit(q.limit).select(fields).lean(),
    Patient.countDocuments(filter),
  ]);
  const pids = patients.map((p) => p._id);
  const [doctors, stays, docs] = await Promise.all([
    doctorNames(patients.map((p) => p.assignedDoctor)),
    pids.length
      ? Admission.aggregate([
          { $match: { tenantId: req.tenantId, patientId: { $in: pids } } },
          { $sort: { admittedAt: -1 } },
          { $group: { _id: '$patientId', admittedAt: { $first: '$admittedAt' }, dischargedAt: { $first: '$dischargedAt' }, status: { $first: '$status' }, stays: { $sum: 1 } } },
        ])
      : [],
    pids.length ? PatientDocument.aggregate([{ $match: { tenantId: req.tenantId, patientId: { $in: pids }, cancelled: null } }, { $group: { _id: '$patientId', n: { $sum: 1 } } }]) : [],
  ]);
  const stayOf = new Map(stays.map((s) => [String(s._id), { admittedAt: s.admittedAt, dischargedAt: s.dischargedAt ?? null, status: s.status, count: s.stays }]));
  const docsOf = new Map(docs.map((d) => [String(d._id), d.n]));
  const rows = patients.map((p) => ({ ...patientLine(p, doctors, req.now), lastStay: stayOf.get(String(p._id)) ?? null, documents: docsOf.get(String(p._id)) ?? 0 }));
  await audit(req, 'RECORDS_INDEX_VIEWED', { details: { shown: rows.length, page: q.page } });
  res.json({ rows, ...paged(q, total) });
});

// Records with something unfinished: a visit not signed the day after, an inpatient document still a draft once the
// stay is over or after a week
recordsRouter.get('/incomplete', async (req, res) => {
  const now = req.now ?? new Date();
  const today = todayUtc(req);
  const visitCutoff = new Date(today.getTime() - VISIT_UNSIGNED_AFTER_DAYS * DAY);
  const draftCutoff = new Date(now.getTime() - DRAFT_OPEN_AFTER_DAYS * DAY);
  const [visits, drafts] = await Promise.all([
    Visit.find({ tenantId: req.tenantId, status: 'active', signed: null, visitOn: { $lte: visitCutoff } }).sort({ visitOn: 1 }).limit(500).select('patientId visitOn').lean(),
    ClinicalDocument.find({ tenantId: req.tenantId, status: 'draft' }).sort({ createdAt: 1 }).limit(2000).select('patientId admissionId kind createdAt').lean(),
  ]);
  const admissions = drafts.length ? await Admission.find({ tenantId: req.tenantId, _id: { $in: drafts.map((d) => d.admissionId) } }).select('status dischargedAt').lean() : [];
  const admissionOf = new Map(admissions.map((a) => [String(a._id), a]));
  const openDrafts = drafts.filter((d) => {
    const stay = admissionOf.get(String(d.admissionId));
    return stay?.status === 'discharged' || new Date(d.createdAt).getTime() <= draftCutoff.getTime();
  });
  const pids = [...new Set([...visits, ...openDrafts].map((x) => String(x.patientId)))];
  const patients = pids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: pids }, ...departmentListFilter(req) }).select('mrn fullName ageYears ageRecordedOn careType assignedDoctor createdAt death duplicateOf').lean() : [];
  const doctors = await doctorNames(patients.map((p) => p.assignedDoctor));
  const patientOf = new Map(patients.map((p) => [String(p._id), patientLine(p, doctors, now)]));
  const days = (from) => Math.max(0, Math.floor((today.getTime() - utcDay(from).getTime()) / DAY));
  const rows = [
    ...visits.map((v) => ({ kind: 'visit_unsigned', patient: patientOf.get(String(v.patientId)), on: isoDay(v.visitOn), daysOpen: days(v.visitOn), visitId: String(v._id), admissionId: null, documentId: null, documentKind: null })),
    ...openDrafts.map((d) => ({
      kind: 'document_draft',
      patient: patientOf.get(String(d.patientId)),
      on: isoDay(d.createdAt),
      daysOpen: days(d.createdAt),
      visitId: null,
      admissionId: String(d.admissionId),
      documentId: String(d._id),
      documentKind: d.kind,
      stayOver: admissionOf.get(String(d.admissionId))?.status === 'discharged',
    })),
  ]
    .filter((r) => r.patient)
    .sort((a, b) => b.daysOpen - a.daysOpen || a.patient.mrn.localeCompare(b.patient.mrn));
  await audit(req, 'RECORDS_INCOMPLETE_VIEWED', { details: { shown: rows.length, visits: visits.length, documents: openDrafts.length } });
  res.json({ rows, counts: { visits: visits.length, documents: openDrafts.length }, rules: { visitUnsignedAfterDays: VISIT_UNSIGNED_AFTER_DAYS, draftOpenAfterDays: DRAFT_OPEN_AFTER_DAYS } });
});

// ---------- The copies register ----------

function issueView(i, patient, now) {
  return {
    id: String(i._id),
    patient: patient ? { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn, careType: patient.careType } : null,
    what: i.what,
    whatNote: i.whatNote ?? '',
    givenTo: i.givenTo,
    receiverName: i.receiverName ?? '',
    authorisation: i.authorisation ?? '',
    requestedOn: isoDay(i.requestedOn),
    givenOn: isoDay(i.givenOn),
    hoursToGive: hoursToGive(i, now),
    late: copyLate(i, now),
    note: i.note ?? '',
    recorded: stampView(i.recorded),
    cancelled: i.cancelled ? { ...stampView(i.cancelled), reason: i.cancelled.reason ?? '' } : null,
  };
}

const copiesQuery = z.object({ from: z.preprocess(emptyToNull, dateOnly('From')).default(null), to: z.preprocess(emptyToNull, dateOnly('To')).default(null), patientId: z.preprocess(emptyToNull, z.union([z.null(), objectId])).default(null), ...pageParams });

recordsRouter.get('/copies', async (req, res) => {
  const q = parse(copiesQuery, req.query);
  const filter = { tenantId: req.tenantId };
  if (q.from || q.to) filter.givenOn = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.patientId) filter.patientId = q.patientId;
  const byDepartment = departmentListFilter(req);
  if (Object.keys(byDepartment).length) {
    const listed = await Patient.find({ tenantId: req.tenantId, ...byDepartment, ...(q.patientId ? { _id: q.patientId } : {}) }, { _id: 1 }).lean();
    filter.patientId = { $in: listed.map((p) => p._id) };
  }
  const [issues, total] = await Promise.all([RecordCopyIssue.find(filter).sort({ givenOn: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), RecordCopyIssue.countDocuments(filter)]);
  const patients = issues.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: issues.map((i) => i.patientId) } }).select('mrn fullName careType').lean() : [];
  const patientOf = new Map(patients.map((p) => [String(p._id), p]));
  const rows = issues.map((i) => issueView(i, patientOf.get(String(i.patientId)), req.now));
  await audit(req, 'RECORD_COPIES_VIEWED', { details: { shown: rows.length, page: q.page } });
  res.json({ rows, ...paged(q, total), late: rows.filter((r) => r.late && !r.cancelled).length });
});

const newIssueSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    patientId: objectId,
    what: z.enum(COPY_WHATS, 'Choose what was given.'),
    whatNote: safeText('Which documents', 300).default(''),
    givenTo: z.enum(GIVEN_TO, 'Choose who received it.'),
    receiverName: safeText('Name of the receiver', 120).default(''),
    authorisation: safeText('Request or authorisation', 300).default(''),
    requestedOn: z.preprocess(emptyToNull, dateOnly('Requested on')).default(null),
    givenOn: requiredDateOnly('Given on'),
    note: safeText('Note', 500).default(''),
  })
  .strict();

recordsRouter.post('/copies', async (req, res) => {
  const body = parse(newIssueSchema, req.body);
  const patient = assertNotHidden(req, await findPatientById(req.tenantId, body.patientId));
  const repeat = await RecordCopyIssue.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) return res.status(201).json({ issue: issueView(repeat, patient, req.now) });
  const fields = {};
  if (['documents', 'other'].includes(body.what) && body.whatNote.length < 3) fields.whatNote = body.what === 'documents' ? 'Write which documents were given.' : 'Write what was given.';
  if (RECEIVER_NAME_NEEDED.includes(body.givenTo) && body.receiverName.length < 2) fields.receiverName = 'Write who received the copy.';
  if (body.givenTo !== 'patient' && body.authorisation.length < 3) fields.authorisation = "Write what the copy rests on: her written consent, a court order, the insurer's request letter …";
  if (body.givenOn.getTime() > todayUtc(req).getTime()) fields.givenOn = 'The day it was given cannot be after today.';
  if (body.requestedOn && body.requestedOn.getTime() > body.givenOn.getTime()) fields.requestedOn = 'The request cannot be after the day it was given.';
  if (Object.keys(fields).length) throw invalid(fields);
  const issue = await RecordCopyIssue.create({ tenantId: req.tenantId, ...body, recorded: stampOf(req) });
  await audit(req, 'RECORD_COPY_ISSUED', { details: ids(patient, { issueId: String(issue._id), what: issue.what, givenTo: issue.givenTo, late: copyLate(issue, req.now) }) });
  return res.status(201).json({ issue: issueView(issue, patient, req.now) });
});

recordsRouter.post('/copies/:issueId/cancel', async (req, res) => {
  const issueId = parse(objectId, req.params.issueId);
  const body = parse(z.object({ reason: safeText('Reason', 300) }).strict(), req.body);
  const issue = await RecordCopyIssue.findOne({ _id: issueId, tenantId: req.tenantId });
  if (!issue) throw new HttpError(404, 'This entry of the register was not found.', 'NOT_FOUND');
  assertNotHidden(req, await findPatientById(req.tenantId, issue.patientId)); // (a record hidden from this doctor: "not found")
  const patient = await Patient.findOne({ _id: issue.patientId, tenantId: req.tenantId }).select('mrn fullName careType').lean();
  if (issue.cancelled) return res.json({ issue: issueView(issue, patient, req.now) });
  if (body.reason.length < 5) throw invalid({ reason: 'Write why this entry was made by mistake.' });
  issue.cancelled = { ...stampOf(req), reason: body.reason };
  await issue.save();
  await audit(req, 'RECORD_COPY_ISSUE_CANCELLED', { details: { patientId: String(issue.patientId), mrn: patient?.mrn ?? null, issueId: String(issue._id) } });
  return res.json({ issue: issueView(issue, patient, req.now) });
});
