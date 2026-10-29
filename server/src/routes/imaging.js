import { Router } from 'express';
import { z } from 'zod';
import { hospitalDayStart, hospitalToday, addDays } from '../careplans/dates.js';
import { MODALITIES, STUDIES, STUDY_KEYS, studyByKey } from '../imaging/templates.js';
import { ImagingOrder } from '../models/ImagingOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient, currentAge } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { audit } from '../utils/audit.js';
import { billScan, billScanCancelled } from '../billing/hooks.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatient } from '../utils/patientLookup.js';
import { PCPNDT_MESSAGE, mentionsFetalSex, safeText } from '../utils/pcpndt.js';
import { eddInUse } from '../patients/pregnancyFindings.js';
import { fileEntry, fileUploadSchema, findFile, sendFile, storeFile } from '../utils/storedFiles.js';
import { DEFAULT_USE, USE_RULES, fetusesOf, sameName, tableOf, usedValue } from '../imaging/machineReadings.js';
import { MachineImage, MachineStudy } from '../models/MachineStudy.js';
import { objectId, parse } from '../utils/validate.js';

// USG and radiology (Lab version 2 part 8 – docs/LAB_V2_PLAN.md). Two routers:
//  - patientImagingRouter, /api/patients/:id/imaging: her studies (those who may see her medical details) and a new
//    order (her doctor or an RMO, or a doctor for an unassigned patient);
//  - imagingRouter, /api/imaging: the study list and DRAFT templates, the worklist (to schedule, scheduled today, done
//    and to report, signed), one study: scheduled, done, the report saved (doctors, RMOs) and signed (a doctor),
//    changed after signing with a reason (the earlier report kept), cancelled with a reason, printed.
// Doctors, RMOs and sonography staff (owner, 24 Oct 2026 – the sonographer role replaces "doctors and RMOs only" of
// 19 Oct 2026): sonography staff schedule, do the scan, add pictures and write the report; a doctor signs. They see
// what a scan needs (indication, EDD by dates, report) for a record that is not sensitive – never the rest of her
// record. The hospital admin sees the dashboard counts only. Reception and nurses do not open Scans. A pregnancy scan's page has her EDD (by her dates) for the weight centile – for those who see her details.
// PCPNDT: no field holds a fetus's sex; any text about it is refused. The audit log gets ids only.

export const imagingRouter = Router();
export const patientImagingRouter = Router({ mergeParams: true });
const WORK_ROLES = ['doctor', 'rmo', 'sonographer'];
const REPORT_ROLES = ['doctor', 'rmo', 'sonographer'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields, message = 'Please check the highlighted fields.') => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
const stampView = (s) => (s ? { byName: s.byName, at: s.at } : null);
const ids = (o, patient, extra = {}) => ({ patientId: String(o.patientId), mrn: patient?.mrn, imagingId: String(o._id), ...extra });

const clinicalOf = (req, patient) => patientAccess(req, patient).view.has('pregnancy') || (hasRole(req.membership, 'sonographer') && !patient.sensitive);
// The machine's readings used in the report: a value changed by hand afterwards is marked edited
const machineUseView = (r) => (r.machine ? { ...r.machine, rows: (r.machine.rows ?? []).map((x) => ({ ...x, edited: Number(r.values?.[x.key]) !== x.value })) } : null);
const reportView = (r) => (r ? { values: r.values ?? {}, findings: r.findings ?? '', impression: r.impression ?? '', machine: machineUseView(r) } : null);

// The pictures still on the report (one taken off is kept in the record, not listed)
const imagesView = (o) => (o.images ?? []).filter((i) => !i.removed).map((i) => ({ ...fileEntry({ _id: i.fileId, fileName: i.fileName, mediaType: i.mediaType, size: i.size }, stampView(i)), inPrint: i.inPrint !== false }));
const MAX_IMAGES = 12;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function view(req, o, patient) {
  const clinical = clinicalOf(req, patient);
  const study = studyByKey.get(o.study);
  return {
    id: String(o._id),
    patientId: String(o.patientId),
    study: o.study,
    studyName: study?.name ?? o.study,
    modality: study?.modality ?? 'other',
    urgent: Boolean(o.urgent),
    status: o.status,
    accession: o.accession ?? null, // the scan number on the machine's worklist
    scheduledFor: o.scheduledFor ?? null,
    ordered: stampView(o.ordered),
    scheduled: stampView(o.scheduled),
    done: stampView(o.done),
    saved: stampView(o.saved),
    signed: stampView(o.signed),
    cancelled: o.cancelled ? { ...stampView(o.cancelled), reason: o.cancelled.reason } : null,
    ...(clinical ? { indication: o.indication ?? '', images: imagesView(o), report: reportView(o.report), amendments: (o.amendments ?? []).map((m) => ({ ...stampView(m), reason: m.reason, report: reportView(m.report) })) } : {}),
    rev: o.rev ?? 0,
    patient: patient
      ? {
          id: String(patient._id),
          fullName: patient.fullName,
          mrn: patient.mrn,
          age: patient.careType === 'newborn' ? null : currentAge(patient),
          careType: patient.careType,
          ...(clinical && patient.careType === 'antenatal' ? { eddByDates: eddInUse(patient) } : {}),
        }
      : null,
    access: {
      canSchedule: hasRole(req.membership, ...WORK_ROLES) && ['ordered', 'scheduled'].includes(o.status),
      canDone: hasRole(req.membership, ...WORK_ROLES) && ['ordered', 'scheduled'].includes(o.status),
      canReport: clinical && hasRole(req.membership, ...REPORT_ROLES) && ['done', 'signed'].includes(o.status),
      canSign: clinical && hasRole(req.membership, 'doctor') && o.status === 'done' && Boolean(o.report),
      canCancel: hasRole(req.membership, ...WORK_ROLES) && ['ordered', 'scheduled'].includes(o.status),
      canPrint: clinical && o.status === 'signed',
      canImages: clinical && hasRole(req.membership, ...REPORT_ROLES) && o.status === 'done',
    },
  };
}

async function loadStudy(req) {
  const o = await ImagingOrder.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!o) throw new HttpError(404, 'This study was not found.', 'NOT_FOUND');
  const patient = await Patient.findOne({ tenantId: req.tenantId, _id: o.patientId });
  if (!patient) throw new HttpError(404, 'This study was not found.', 'NOT_FOUND');
  return { o, patient };
}
const checkRev = (o, rev) => {
  if (rev !== (o.rev ?? 0)) throw conflict('Someone changed this study meanwhile. Reload the page and try again.');
};

// ---------- A patient's studies ----------

patientImagingRouter.get('/', async (req, res) => {
  const patient = await findPatient(req);
  if (!clinicalOf(req, patient)) throw forbidden("You can't see this patient's scans.");
  const list = await ImagingOrder.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ createdAt: -1 }).limit(200);
  await audit(req, 'IMAGING_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  const a = patientAccess(req, patient);
  res.json({ studies: list.map((o) => view(req, o, patient)), canOrder: a.editClinical && hasRole(req.membership, 'doctor', 'rmo') && !isClosed(patient) });
});

patientImagingRouter.post('/', async (req, res) => {
  const patient = await findPatient(req);
  if (!(patientAccess(req, patient).editClinical && hasRole(req.membership, 'doctor', 'rmo'))) throw forbidden("Only the patient's doctor or an RMO orders a scan.");
  const body = parse(
    z.object({ clientRequestId: z.string().min(8).max(64), study: z.enum(STUDY_KEYS, 'Choose the study'), urgent: z.boolean().default(false), indication: safeText('Indication', 300).default(''), scheduledFor: z.iso.datetime().nullable().default(null) }).strict(),
    req.body,
  );
  const repeat = await ImagingOrder.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId });
  if (repeat) return res.status(201).json({ study: view(req, repeat, patient) });
  refuseNewOnDuplicate(patient, 'lab');
  refuseNewOnClosed(patient, 'lab');
  const o = await ImagingOrder.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    study: body.study,
    urgent: body.urgent,
    indication: body.indication.trim(),
    status: body.scheduledFor ? 'scheduled' : 'ordered',
    scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
    ordered: stampOf(req),
    scheduled: body.scheduledFor ? stampOf(req) : null,
    clientRequestId: body.clientRequestId,
  });
  await audit(req, 'IMAGING_ORDERED', { details: ids(o, patient) });
  await billScan(req, patient, o); // the scan on her bill (its price-list item)
  res.status(201).json({ study: view(req, o, patient) });
});

// ---------- The department ----------

imagingRouter.use((req, _res, next) => {
  // The hospital admin: the dashboard's counts only (owner, 24 Oct 2026)
  if (req.method === 'GET' && req.path === '/dashboard' && hasRole(req.membership, 'admin')) return next();
  if (!hasRole(req.membership, ...WORK_ROLES)) throw forbidden('Scans are for doctors, RMOs and sonography staff.');
  next();
});

imagingRouter.get('/studies', (_req, res) => {
  res.json({ modalities: MODALITIES, studies: STUDIES });
});

const LISTS = {
  ordered: { status: 'ordered', sort: { urgent: -1, createdAt: 1 } },
  scheduled: { status: 'scheduled', sort: { scheduledFor: 1 } },
  report: { status: 'done', sort: { urgent: -1, 'done.at': 1 } },
  signed: { status: 'signed', sort: { 'signed.at': -1 } },
};
imagingRouter.get('/worklist', async (req, res) => {
  const { list } = parse(z.object({ list: z.enum(Object.keys(LISTS)).default('ordered') }).strict(), req.query);
  const since = addDays(hospitalToday(req.now), -7);
  const where = { tenantId: req.tenantId, status: LISTS[list].status, ...(list === 'signed' ? { 'signed.at': { $gte: hospitalDayStart(since) } } : {}) };
  const rows = await ImagingOrder.find(where).sort(LISTS[list].sort).limit(300);
  const patients = new Map((rows.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: rows.map((r) => r.patientId) } }) : []).map((p) => [String(p._id), p]));
  const counts = {};
  for (const [k, l] of Object.entries(LISTS)) if (k !== 'signed') counts[k] = await ImagingOrder.countDocuments({ tenantId: req.tenantId, status: l.status });
  res.json({ list, studies: rows.map((o) => view(req, o, patients.get(String(o.patientId)))).filter((v) => v.patient), counts });
});

// The sonography dashboard (24 Oct 2026, docs/IDEAS_FOR_LATER.md 21): counts only, no patient. Today: studies booked
// for today (not cancelled); to scan: ordered or scheduled; to report: done, no report yet; to sign: done with a report;
// signed today.
imagingRouter.get('/dashboard', async (req, res) => {
  const today = hospitalToday(req.now);
  const from = hospitalDayStart(today);
  const to = hospitalDayStart(addDays(today, 1));
  const count = (where) => ImagingOrder.countDocuments({ tenantId: req.tenantId, ...where });
  const [bookedToday, toScan, toReport, toSign, signedToday] = await Promise.all([
    count({ status: { $ne: 'cancelled' }, scheduledFor: { $gte: from, $lt: to } }),
    count({ status: { $in: ['ordered', 'scheduled'] } }),
    count({ status: 'done', report: null }),
    count({ status: 'done', report: { $ne: null } }),
    count({ status: 'signed', 'signed.at': { $gte: from, $lt: to } }),
  ]);
  res.json({ counts: { bookedToday, toScan, toReport, toSign, signedToday } });
});

imagingRouter.get('/:id', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  await audit(req, 'IMAGING_VIEWED', { details: ids(o, patient) });
  res.json({ study: view(req, o, patient), template: studyByKey.get(o.study) ?? null });
});

imagingRouter.post('/:id/schedule', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(z.object({ rev: z.number().int().min(0), scheduledFor: z.iso.datetime('Choose the day and time') }).strict(), req.body);
  if (!view(req, o, patient).access.canSchedule) throw forbidden('This study cannot be scheduled now.');
  checkRev(o, body.rev);
  Object.assign(o, { status: 'scheduled', scheduledFor: new Date(body.scheduledFor), scheduled: stampOf(req), rev: o.rev + 1 });
  await o.save();
  await audit(req, 'IMAGING_SCHEDULED', { details: ids(o, patient) });
  res.json({ study: view(req, o, patient) });
});

imagingRouter.post('/:id/done', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(z.object({ rev: z.number().int().min(0) }).strict(), req.body);
  if (!view(req, o, patient).access.canDone) throw forbidden('This study cannot be marked done now.');
  checkRev(o, body.rev);
  Object.assign(o, { status: 'done', done: stampOf(req), rev: o.rev + 1 });
  await o.save();
  await audit(req, 'IMAGING_DONE', { details: ids(o, patient) });
  res.json({ study: view(req, o, patient) });
});

/** The report's values checked against the template (numbers, choices, text) – and against any fetal-sex words. */
function checkedReport(o, body) {
  const t = studyByKey.get(o.study);
  const fields = {};
  const values = {};
  for (const f of t?.fields ?? []) {
    const v = body.values?.[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) fields[`values.${f.key}`] = 'Enter a number.';
      else values[f.key] = n;
    } else if (f.type === 'choice') {
      if (!f.options.includes(v)) fields[`values.${f.key}`] = 'Choose one of the options.';
      else values[f.key] = v;
    } else {
      const s = String(v).trim().slice(0, 300);
      if (mentionsFetalSex(s)) fields[`values.${f.key}`] = PCPNDT_MESSAGE;
      values[f.key] = s;
    }
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return { values, findings: body.findings.trim(), impression: body.impression.trim() };
}

imagingRouter.put('/:id/report', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(
    z.object({ rev: z.number().int().min(0), values: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.null()])).default({}), findings: safeText('Findings', 4000).default(''), impression: safeText('Impression', 1000).default(''), reason: safeText('Reason', 300).default('') }).strict(),
    req.body,
  );
  if (!view(req, o, patient).access.canReport) throw forbidden('A doctor, RMO or sonography staff writes the report once the study is done.');
  checkRev(o, body.rev);
  const report = { ...checkedReport(o, body), machine: o.report?.machine ?? null };
  if (o.status === 'signed') {
    if (body.reason.trim().length < 5) throw invalid({ reason: 'The report is signed: write why it is changed.' });
    o.amendments.push({ ...stampOf(req), reason: body.reason.trim(), report: o.report });
    o.status = 'done';
    o.signed = null;
  }
  Object.assign(o, { report, saved: stampOf(req), rev: o.rev + 1 });
  o.markModified('report');
  await o.save();
  await audit(req, o.amendments.length && body.reason ? 'IMAGING_AMENDED' : 'IMAGING_SAVED', { details: ids(o, patient) });
  res.json({ study: view(req, o, patient) });
});

imagingRouter.post('/:id/sign', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(z.object({ rev: z.number().int().min(0) }).strict(), req.body);
  if (!view(req, o, patient).access.canSign) throw forbidden('A doctor signs the report once it is written.');
  checkRev(o, body.rev);
  if (!o.report.impression && !o.report.findings) throw invalid({ impression: 'Write the findings or the impression before signing.' });
  Object.assign(o, { status: 'signed', signed: stampOf(req), rev: o.rev + 1 });
  await o.save();
  await audit(req, 'IMAGING_SIGNED', { details: ids(o, patient) });
  res.json({ study: view(req, o, patient) });
});

imagingRouter.post('/:id/cancel', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(z.object({ rev: z.number().int().min(0), reason: safeText('Reason', 300) }).strict(), req.body);
  if (!view(req, o, patient).access.canCancel) throw forbidden('This study cannot be cancelled now.');
  checkRev(o, body.rev);
  if (body.reason.trim().length < 3) throw invalid({ reason: 'Write why it is cancelled.' });
  Object.assign(o, { status: 'cancelled', cancelled: { ...stampOf(req), reason: body.reason.trim() }, rev: o.rev + 1 });
  await o.save();
  await audit(req, 'IMAGING_CANCELLED', { details: ids(o, patient) });
  await billScanCancelled(req, o);
  res.json({ study: view(req, o, patient) });
});

// ---------- Pictures from the machine (24 Oct 2026, docs/IDEAS_FOR_LATER.md 19) ----------
// Added, chosen for print or taken off (with a reason) while the study is done and not yet signed; a signed report is
// changed first (with a reason). Seen by those who see her details. PCPNDT: staff choose pictures that do not show the
// baby's sex – the screen says so; a picture cannot be checked for it.

const imageOf = (o, fileId) => (o.images ?? []).find((i) => String(i.fileId) === String(fileId) && !i.removed);

imagingRouter.post('/:id/images', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const { rev, ...file } = parse(fileUploadSchema.omit({ reason: true }).extend({ rev: z.number().int().min(0) }).strict(), req.body);
  if (!view(req, o, patient).access.canImages) throw forbidden('Pictures are added by a doctor, RMO or sonography staff once the study is done, before it is signed.');
  checkRev(o, rev);
  if ((o.images ?? []).filter((i) => !i.removed).length >= MAX_IMAGES) throw invalid({ file: `At most ${MAX_IMAGES} pictures per study.` });
  const stored = await storeFile(req, { patientId: patient._id, kind: 'scan_image', ownerId: o._id, body: file, types: IMAGE_TYPES });
  o.images.push({ fileId: stored._id, fileName: stored.fileName, mediaType: stored.mediaType, size: stored.size, ...stampOf(req), inPrint: true });
  o.rev += 1;
  await o.save();
  await audit(req, 'IMAGING_IMAGE_ADDED', { details: ids(o, patient, { fileId: String(stored._id) }) });
  res.status(201).json({ study: view(req, o, patient) });
});

imagingRouter.get('/:id/images/:fileId', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  if (!clinicalOf(req, patient)) throw forbidden("You can't see this patient's scans.");
  const fileId = parse(objectId, req.params.fileId);
  if (!imageOf(o, fileId)) throw new HttpError(404, 'This picture was not found.', 'NOT_FOUND');
  const file = await findFile(req, { kind: 'scan_image', ownerId: o._id, fileId });
  await audit(req, 'IMAGING_IMAGE_VIEWED', { details: ids(o, patient, { fileId: String(fileId) }) });
  res.set('Cache-Control', 'private, no-store');
  sendFile(res, file);
});

imagingRouter.patch('/:id/images/:fileId', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(z.object({ rev: z.number().int().min(0), inPrint: z.boolean().optional(), remove: safeText('Reason', 300).optional() }).strict(), req.body);
  if (!view(req, o, patient).access.canImages) throw forbidden('Pictures are changed by a doctor, RMO or sonography staff before the report is signed.');
  checkRev(o, body.rev);
  const image = imageOf(o, parse(objectId, req.params.fileId));
  if (!image) throw new HttpError(404, 'This picture was not found.', 'NOT_FOUND');
  if (body.remove !== undefined) {
    if (body.remove.trim().length < 3) throw invalid({ reason: 'Write why the picture is taken off.' });
    image.removed = { ...stampOf(req), reason: body.remove.trim() };
  } else if (body.inPrint !== undefined) image.inPrint = body.inPrint;
  o.rev += 1;
  o.markModified('images');
  await o.save();
  await audit(req, body.remove !== undefined ? 'IMAGING_IMAGE_REMOVED' : 'IMAGING_IMAGE_CHANGED', { details: ids(o, patient, { fileId: String(image.fileId) }) });
  res.json({ study: view(req, o, patient) });
});

imagingRouter.post('/:id/printed', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  if (!view(req, o, patient).access.canPrint) throw forbidden('The report is printed once it is signed.');
  await audit(req, 'IMAGING_PRINTED', { details: ids(o, patient) });
  res.json({ ok: true });
});

// ---------- From the ultrasound machine (docs/USG_MACHINE_PLAN.md) ----------
// What the machine sent through the scan bridge (routes/scanBridge.js): on a study, the machine studies of this patient
// since the day before it was ordered; their pictures are chosen and added to the scan's pictures (copied, so they stay
// after the machine study is deleted), and their readings fill the report through the average table. Studies the
// bridge could not match wait on Scans → From the machine for staff to link by her patient number. PCPNDT: whoever adds
// pictures confirms they do not show the baby's sex (recorded in the audit log); nothing about it is in the readings.

const DAY_MS = 24 * 60 * 60 * 1000;
const UNMATCHED_DAYS = 7;
const machineName = (m) => [m.manufacturer, m.model].filter(Boolean).join(' ');

async function loadMachineStudy(req, id) {
  const m = await MachineStudy.findOne({ tenantId: req.tenantId, _id: parse(objectId, id) });
  if (!m) throw new HttpError(404, 'This study from the machine was not found. It may have been deleted after its keep period.', 'NOT_FOUND');
  return m;
}

function machineStudyView(m, { template = null, patient = null, imagingId = null } = {}) {
  const fields = new Map((template?.fields ?? []).filter((f) => f.type === 'number').map((f) => [f.key, f.name]));
  return {
    id: String(m._id),
    receivedAt: m.receivedAt,
    studyAt: m.studyAt ?? null,
    machine: machineName(m),
    station: m.station,
    nameOnMachine: m.patientName,
    numberOnMachine: m.machinePatientId,
    matchedBy: m.matchedBy,
    linked: m.linked ? { byName: m.linked.byName, at: m.linked.at } : null,
    ...(patient ? { nameDiffers: Boolean(m.patientName) && !sameName(m.patientName, patient.fullName) } : {}),
    images: m.images.map((i) => ({ id: String(i.imageId), size: i.size, inThisStudy: Boolean(imagingId) && i.usedIn.some((x) => String(x) === String(imagingId)) })),
    fetuses: fetusesOf(m.readings).map((fetus) => ({
      fetus,
      rows: tableOf(m.readings, fetus).map((r) => ({ ...r, ...(template ? { inTemplate: fields.has(r.key), name: fields.get(r.key) ?? r.name } : {}) })),
    })),
    unmatched: m.unmatched.map((u) => ({ meaning: u.meaning, value: u.value, unit: u.unit, fetus: u.fetus })),
    droppedSex: m.droppedSex,
  };
}

// The studies no one is matched to yet (for staff to link), and whether the machine is connected: the bridge is set up
// and when it was last heard from (never the key)
imagingRouter.get('/machine/unmatched', async (req, res) => {
  const list = await MachineStudy.find({ tenantId: req.tenantId, patientId: null, receivedAt: { $gte: new Date(req.now - UNMATCHED_DAYS * DAY_MS) } })
    .sort({ receivedAt: -1 })
    .limit(100);
  await audit(req, 'MACHINE_UNMATCHED_VIEWED', { details: { count: list.length } });
  const b = (await Tenant.findById(req.tenantId).lean())?.scanBridge;
  res.json({ studies: list.map((m) => machineStudyView(m)), bridge: { on: Boolean(b?.keyHash), lastContactAt: b?.lastContactAt ?? null } });
});

imagingRouter.post('/machine/:machineId/link', async (req, res) => {
  const m = await loadMachineStudy(req, req.params.machineId);
  const body = parse(z.object({ mrn: z.string().trim().min(1, 'Enter her patient number').max(40) }).strict(), req.body);
  if (m.patientId) throw conflict('This study is already linked to a patient.');
  const patient = await Patient.findOne({ tenantId: req.tenantId, mrn: { $in: [...new Set([body.mrn, body.mrn.toUpperCase()])] } });
  if (!patient) throw invalid({ mrn: 'No patient has this number.' });
  Object.assign(m, { patientId: patient._id, matchedBy: 'hand', linked: stampOf(req) });
  await m.save();
  await audit(req, 'MACHINE_STUDY_LINKED', { details: { machineStudyId: String(m._id), patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ study: machineStudyView(m, { patient }), patient: { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn } });
});

// A picture of a machine study: anyone in Scans for a study not yet linked (to see whose it is), otherwise those who
// see her scans
imagingRouter.get('/machine/:machineId/images/:imageId', async (req, res) => {
  const m = await loadMachineStudy(req, req.params.machineId);
  const imageId = parse(objectId, req.params.imageId);
  if (!m.images.some((i) => String(i.imageId) === String(imageId))) throw new HttpError(404, 'This picture was not found.', 'NOT_FOUND');
  if (m.patientId) {
    const patient = await Patient.findOne({ tenantId: req.tenantId, _id: m.patientId });
    if (!patient || !clinicalOf(req, patient)) throw forbidden("You can't see this patient's scans.");
  }
  const image = await MachineImage.findOne({ tenantId: req.tenantId, _id: imageId, machineStudyId: m._id });
  if (!image) throw new HttpError(404, 'This picture was not found.', 'NOT_FOUND');
  await audit(req, 'MACHINE_IMAGE_VIEWED', { details: { machineStudyId: String(m._id), imageId: String(imageId), ...(m.patientId ? { patientId: String(m.patientId) } : {}) } });
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Type', image.mediaType);
  res.send(image.data);
});

// This patient's machine studies, for one scan
imagingRouter.get('/:id/machine', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  if (!clinicalOf(req, patient)) throw forbidden("You can't see this patient's scans.");
  const since = new Date(new Date(o.createdAt ?? req.now) - DAY_MS);
  const list = await MachineStudy.find({ tenantId: req.tenantId, $or: [{ imagingId: o._id }, { patientId: o.patientId, receivedAt: { $gte: since } }] })
    .sort({ receivedAt: -1 })
    .limit(10);
  await audit(req, 'IMAGING_MACHINE_VIEWED', { details: ids(o, patient, { count: list.length }) });
  const template = studyByKey.get(o.study);
  res.json({ studies: list.map((m) => machineStudyView(m, { template, patient, imagingId: o._id })), defaultUse: DEFAULT_USE });
});

async function machineStudyOf(req, o, machineId) {
  const m = await loadMachineStudy(req, machineId);
  if (String(m.patientId) !== String(o.patientId)) throw conflict('This study from the machine is not linked to this patient.');
  return m;
}

// Chosen pictures added to the scan's pictures
imagingRouter.post('/:id/machine/:machineId/pictures', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(
    z.object({ rev: z.number().int().min(0), imageIds: z.array(objectId).min(1, 'Choose the pictures').max(MAX_IMAGES), noSexShown: z.literal(true, "Confirm that the pictures do not show the baby's sex.") }).strict(),
    req.body,
  );
  if (!view(req, o, patient).access.canImages) throw forbidden('Pictures are added by a doctor, RMO or sonography staff once the study is done, before it is signed.');
  checkRev(o, body.rev);
  const m = await machineStudyOf(req, o, req.params.machineId);
  const wanted = [...new Set(body.imageIds)].map((id) => m.images.find((i) => String(i.imageId) === id));
  if (wanted.some((i) => !i)) throw new HttpError(404, 'A picture was not found.', 'NOT_FOUND');
  const fresh = wanted.filter((i) => !i.usedIn.some((x) => String(x) === String(o._id)));
  if ((o.images ?? []).filter((i) => !i.removed).length + fresh.length > MAX_IMAGES) throw invalid({ file: `At most ${MAX_IMAGES} pictures per study.` });
  const added = [];
  for (const i of fresh) {
    const image = await MachineImage.findOne({ tenantId: req.tenantId, _id: i.imageId, machineStudyId: m._id });
    if (!image) throw new HttpError(404, 'A picture was not found.', 'NOT_FOUND');
    const n = m.images.indexOf(i) + 1;
    const stored = await storeFile(req, {
      patientId: patient._id,
      kind: 'scan_image',
      ownerId: o._id,
      body: { fileName: `machine-${n}.${image.mediaType === 'image/png' ? 'png' : 'jpg'}`, mediaType: image.mediaType, data: image.data.toString('base64') },
      types: IMAGE_TYPES,
    });
    o.images.push({ fileId: stored._id, fileName: stored.fileName, mediaType: stored.mediaType, size: stored.size, ...stampOf(req), inPrint: true });
    i.usedIn.push(o._id);
    added.push(String(stored._id));
  }
  if (added.length) {
    o.rev += 1;
    await o.save();
    m.markModified('images');
    await m.save();
    await audit(req, 'IMAGING_IMAGE_ADDED', { details: ids(o, patient, { machineStudyId: String(m._id), fileIds: added, fromMachine: true, noSexShownConfirmed: true }) });
  }
  res.status(201).json({ study: view(req, o, patient), added: added.length });
});

// The average table's choices put in the report: the server works the values out again from the readings it keeps
imagingRouter.post('/:id/machine/:machineId/fill', async (req, res) => {
  const { o, patient } = await loadStudy(req);
  const body = parse(
    z
      .object({
        rev: z.number().int().min(0),
        fetus: z.string().trim().min(1).max(10),
        rows: z
          .array(z.object({ key: z.string().max(20), ticked: z.array(z.boolean()).max(30).default([]), use: z.enum(USE_RULES).default(DEFAULT_USE), reading: z.number().int().min(0).max(29).default(0) }).strict())
          .min(1, 'Choose the readings to use')
          .max(20),
      })
      .strict(),
    req.body,
  );
  if (!view(req, o, patient).access.canReport || o.status !== 'done') throw forbidden('Readings are put in the report once the study is done, before it is signed.');
  checkRev(o, body.rev);
  const m = await machineStudyOf(req, o, req.params.machineId);
  const numbers = new Set((studyByKey.get(o.study)?.fields ?? []).filter((f) => f.type === 'number').map((f) => f.key));
  const table = new Map(tableOf(m.readings, body.fetus).map((r) => [r.key, r]));
  const values = {};
  const rows = [];
  for (const choice of body.rows) {
    const row = table.get(choice.key);
    if (!row || !numbers.has(choice.key)) continue;
    const value = usedValue(row, choice);
    if (value == null) continue;
    values[choice.key] = value;
    rows.push({ key: row.key, name: row.name, unit: row.unit, readings: row.readings, ticked: row.readings.map((_, i) => choice.ticked[i] !== false), machine: row.machine?.value ?? null, use: choice.use, reading: choice.reading, value });
  }
  if (!rows.length) throw invalid({ rows: 'None of these readings belongs in this template.' });
  o.report = {
    values: { ...(o.report?.values ?? {}), ...values },
    findings: o.report?.findings ?? '',
    impression: o.report?.impression ?? '',
    machine: { machineStudyId: String(m._id), studyUid: m.studyUid, machine: machineName(m), studyAt: m.studyAt ?? null, fetus: body.fetus, ...stampOf(req), rows },
  };
  o.saved = stampOf(req);
  o.rev += 1;
  o.markModified('report');
  await o.save();
  await audit(req, 'IMAGING_MACHINE_READINGS_USED', { details: ids(o, patient, { machineStudyId: String(m._id), fields: rows.map((r) => r.key) }) });
  res.json({ study: view(req, o, patient) });
});
