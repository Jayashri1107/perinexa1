import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hospitalDayStart, hospitalToday, addDays } from '../careplans/dates.js';
import { config } from '../config.js';
import { studyByKey } from '../imaging/templates.js';
import { MAX_UNMATCHED, readingsFromSr } from '../imaging/machineReadings.js';
import { nextNumber } from '../models/Counter.js';
import { ImagingOrder } from '../models/ImagingOrder.js';
import { MachineImage, MachineStudy } from '../models/MachineStudy.js';
import { Patient, currentAge } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { looksLike } from '../utils/storedFiles.js';
import { parse } from '../utils/validate.js';

// The ultrasound machine on the LAN (docs/USG_MACHINE_PLAN.md). Two routers:
//  - scanBridgeRouter, /api/scan-bridge: for the scan bridge – the program on a hospital PC next to the DICOM receiver
//    (scan-bridge/bridge.mjs) – never a person. It signs in with the hospital's bridge key (Authorization: Bearer …)
//    and sends each study the machine stored (its structured reports and pictures), and reads the worklist: the day's
//    ultrasound orders the machine shows, so the sonologist picks the patient there instead of typing her.
//  - scanBridgeSetupRouter, /api/tenant/scan-bridge: the hospital admin makes the key (shown once) or switches it off.
// The worklist sends the machine what it needs only: name, patient number, age, the scan's name and order number –
// never anything about the sex of a fetus. Everything received is kept SCAN_BRIDGE_KEEP_DAYS (models/MachineStudy.js).

export const scanBridgeRouter = Router();
export const scanBridgeSetupRouter = Router();

const hashKey = (key) => createHash('sha256').update(key).digest('hex');
const CONTACT_EVERY_MS = 60 * 1000;
const MAX_IMAGES_PER_STUDY = 100;
const DICOM_UID = z.string().trim().regex(/^[0-9.]{1,64}$/, 'a DICOM UID');

// ---------- The bridge ----------

scanBridgeRouter.use(async (req, _res, next) => {
  const m = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.get('authorization') ?? '');
  const tenant = m ? await Tenant.findOne({ 'scanBridge.keyHash': hashKey(m[1]), isActive: true }) : null;
  if (!tenant) throw new HttpError(401, 'This scan bridge key is not valid. Ask the hospital admin for a new one.', 'UNAUTHORIZED');
  req.tenantId = tenant._id;
  const last = tenant.scanBridge?.lastContactAt;
  if (!last || req.now - last > CONTACT_EVERY_MS) await Tenant.updateOne({ _id: tenant._id }, { $set: { 'scanBridge.lastContactAt': req.now } });
  next();
});

/** Whose study it is: the order number the worklist gave the machine, else her patient number typed on it. */
async function matchOf(tenantId, { accession, patientId }) {
  if (/^US\d{8}$/.test(accession)) {
    const o = await ImagingOrder.findOne({ tenantId, accession });
    if (o) return { patientId: o.patientId, imagingId: o._id, matchedBy: 'worklist' };
  }
  if (patientId) {
    const p = await Patient.findOne({ tenantId, mrn: { $in: [...new Set([patientId, patientId.toUpperCase()])] } });
    if (p) return { patientId: p._id, imagingId: null, matchedBy: 'number' };
  }
  return null;
}

const studySchema = z
  .object({
    studyUid: DICOM_UID,
    accession: z.string().trim().max(64).default(''),
    patientId: z.string().trim().max(64).default(''),
    patientName: z.string().trim().max(200).default(''),
    studyAt: z.iso.datetime({ offset: true }).nullable().default(null),
    manufacturer: z.string().trim().max(64).default(''),
    model: z.string().trim().max(64).default(''),
    station: z.string().trim().max(64).default(''),
    srs: z.array(z.object({ sopUid: DICOM_UID, content: z.array(z.any()).max(5000) }).strict()).max(20).default([]),
  })
  .strict();

// A study as the machine stored it; sent again when more arrives (another report, more pictures): its reports replace
// the readings of the same reports, and a study still not matched is tried again.
scanBridgeRouter.post('/studies', async (req, res) => {
  const body = parse(studySchema, req.body);
  let m = await MachineStudy.findOne({ tenantId: req.tenantId, studyUid: body.studyUid });
  const isNew = !m;
  if (!m) m = new MachineStudy({ tenantId: req.tenantId, studyUid: body.studyUid, receivedAt: req.now, expiresAt: addDays(req.now, config.SCAN_BRIDGE_KEEP_DAYS) });
  Object.assign(m, {
    accession: body.accession,
    machinePatientId: body.patientId,
    patientName: body.patientName.replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim(),
    studyAt: body.studyAt ? new Date(body.studyAt) : m.studyAt,
    manufacturer: body.manufacturer,
    model: body.model,
    station: body.station,
  });
  if (!m.patientId) {
    const match = await matchOf(req.tenantId, body);
    if (match) Object.assign(m, match);
  }
  for (const sr of body.srs) {
    const got = readingsFromSr(sr.content, sr.sopUid);
    m.readings = [...m.readings.filter((r) => r.srUid !== sr.sopUid), ...got.readings];
    m.unmatched = [...m.unmatched.filter((r) => r.srUid !== sr.sopUid), ...got.unmatched].slice(0, MAX_UNMATCHED);
    if (!m.srUids.includes(sr.sopUid)) {
      m.srUids.push(sr.sopUid);
      m.droppedSex += got.dropped;
    }
  }
  await m.save();
  if (isNew || body.srs.length) {
    await audit(req, 'SCAN_BRIDGE_STUDY_RECEIVED', { details: { machineStudyId: String(m._id), ...(m.patientId ? { patientId: String(m.patientId) } : {}), readings: m.readings.length } });
  }
  res.status(isNew ? 201 : 200).json({ id: String(m._id), matched: Boolean(m.patientId), readings: m.readings.length, images: m.images.length });
});

scanBridgeRouter.post('/studies/:studyUid/images', async (req, res) => {
  const studyUid = parse(DICOM_UID, req.params.studyUid);
  const body = parse(z.object({ sopUid: DICOM_UID, mediaType: z.enum(['image/jpeg', 'image/png']), data: z.string().min(8).max(7_000_000) }).strict(), req.body);
  const m = await MachineStudy.findOne({ tenantId: req.tenantId, studyUid });
  if (!m) throw new HttpError(404, 'Send the study first.', 'NOT_FOUND');
  if (m.images.some((i) => i.sopUid === body.sopUid)) return res.json({ duplicate: true });
  if (m.images.length >= MAX_IMAGES_PER_STUDY) throw new HttpError(400, `At most ${MAX_IMAGES_PER_STUDY} pictures per study.`, 'VALIDATION');
  const data = Buffer.from(body.data, 'base64');
  if (data.length > 5 * 1024 * 1024) throw new HttpError(400, 'The picture is too large (at most 5 MB).', 'VALIDATION');
  if (!looksLike(body.mediaType, data)) throw new HttpError(400, 'This is not a readable JPEG or PNG picture.', 'VALIDATION');
  const image = await MachineImage.create({ tenantId: req.tenantId, machineStudyId: m._id, sopUid: body.sopUid, mediaType: body.mediaType, size: data.length, data, expiresAt: m.expiresAt });
  // $push, not save: the bridge sends a study's pictures one after another
  await MachineStudy.updateOne({ tenantId: req.tenantId, _id: m._id }, { $push: { images: { imageId: image._id, sopUid: body.sopUid, mediaType: body.mediaType, size: data.length, at: req.now } } });
  res.status(201).json({ ok: true });
});

// DICOM text: plain letters, digits and a few signs (the machine's character set may be basic)
const dicomText = (s, max) => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\^]/g, ' ').trim().slice(0, max);

// The machine's worklist: ultrasound orders booked for today, and those ordered in the last 3 days not yet booked.
// Each gets its scan number (the accession number) the first time it is listed; the machine sends it back with the
// study, so the study is matched to the order without anyone typing.
scanBridgeRouter.get('/worklist', async (req, res) => {
  const today = hospitalToday(req.now);
  const usg = [...studyByKey.values()].filter((s) => s.modality === 'usg').map((s) => s.key);
  const orders = await ImagingOrder.find({
    tenantId: req.tenantId,
    study: { $in: usg },
    $or: [
      { status: 'scheduled', scheduledFor: { $gte: hospitalDayStart(today), $lt: hospitalDayStart(addDays(today, 1)) } },
      { status: 'ordered', createdAt: { $gte: hospitalDayStart(addDays(today, -3)) } },
    ],
  })
    .sort({ urgent: -1, scheduledFor: 1, createdAt: 1 })
    .limit(200);
  for (const o of orders) {
    if (o.accession) continue;
    const accession = `US${String(await nextNumber(req.tenantId, 'scan-accession')).padStart(8, '0')}`;
    const set = await ImagingOrder.updateOne({ tenantId: req.tenantId, _id: o._id, accession: null }, { $set: { accession } });
    // Two worklist reads at once: the number given first stays
    o.accession = set.modifiedCount ? accession : (await ImagingOrder.findOne({ tenantId: req.tenantId, _id: o._id }))?.accession;
  }
  const patients = new Map((orders.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: orders.map((o) => o.patientId) } }) : []).map((p) => [String(p._id), p]));
  const items = orders
    .map((o) => ({ o, p: patients.get(String(o.patientId)) }))
    .filter(({ p }) => p)
    .map(({ o, p }) => ({
      accession: o.accession,
      patientId: p.mrn,
      patientName: dicomText(p.fullName, 64),
      age: currentAge(p, req.now),
      study: o.study,
      studyName: dicomText(studyByKey.get(o.study)?.name, 64),
      scheduledFor: o.scheduledFor ?? null,
      urgent: Boolean(o.urgent),
    }));
  res.json({ items });
});

// ---------- The hospital admin ----------

const statusOf = (tenant) => {
  const b = tenant?.scanBridge ?? {};
  return { on: Boolean(b.keyHash), keyHint: b.keyHash ? b.keyHint : '', madeAt: b.madeAt ?? null, madeByName: b.madeByName ?? '', lastContactAt: b.lastContactAt ?? null, keepDays: config.SCAN_BRIDGE_KEEP_DAYS };
};

scanBridgeSetupRouter.get('/', async (req, res) => {
  res.json({ bridge: statusOf(await Tenant.findById(req.tenantId)) });
});

// A new key, shown this once: the old key stops working
scanBridgeSetupRouter.post('/key', async (req, res) => {
  const key = randomBytes(32).toString('base64url');
  const tenant = await Tenant.findByIdAndUpdate(
    req.tenantId,
    { $set: { 'scanBridge.keyHash': hashKey(key), 'scanBridge.keyHint': key.slice(-4), 'scanBridge.madeAt': req.now, 'scanBridge.madeByName': req.user.name, 'scanBridge.lastContactAt': null } },
    { returnDocument: 'after' },
  );
  await audit(req, 'SCAN_BRIDGE_KEY_MADE', {});
  res.status(201).json({ key, bridge: statusOf(tenant) });
});

scanBridgeSetupRouter.delete('/key', async (req, res) => {
  const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: { 'scanBridge.keyHash': null, 'scanBridge.keyHint': '' } }, { returnDocument: 'after' });
  await audit(req, 'SCAN_BRIDGE_SWITCHED_OFF', {});
  res.json({ bridge: statusOf(tenant) });
});
