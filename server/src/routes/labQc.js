import { Router } from 'express';
import { z } from 'zod';
import { RULE_WORDS, westgard, zScore } from '../lab/qc.js';
import { labCatalogue } from '../lab/labSetup.js';
import { hasRole } from '../models/Membership.js';
import { QcLot } from '../models/QcLot.js';
import { QcRun } from '../models/QcRun.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Quality control (/api/lab-qc – Lab version 2, docs/LAB_V2_PLAN.md). The lab, doctors and RMOs keep control lots
// (a test's value, level 1–3, lot number, expiry, the insert's mean and SD) and enter the day's control runs; each run
// is checked with the Westgard rules (lab/qc.js); a rejected run needs a corrective action. The Levey-Jennings chart
// reads a lot's runs. While a test's latest run today is rejected without an action, reporting it needs a reason
// (routes/lab.js). No patient data. The audit log gets ids only.

export const labQcRouter = Router();
const ROLES = ['lab', 'doctor', 'rmo'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });

labQcRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Quality control is for the lab, doctors and RMOs.');
  next();
});

const lotView = (l) => ({ id: String(l._id), testKey: l.testKey, fieldKey: l.fieldKey, level: l.level, material: l.material ?? '', lotNo: l.lotNo, expiresOn: l.expiresOn ? l.expiresOn.toISOString().slice(0, 10) : null, mean: l.mean, sd: l.sd, active: l.active !== false });
const runView = (r) => ({ id: String(r._id), lotId: String(r.lotId), value: r.value, z: Math.round(r.z * 100) / 100, violations: r.violations, rules: r.violations.map((v) => RULE_WORDS[v]), status: r.status, run: { byName: r.run.byName, at: r.run.at }, action: r.action ? { byName: r.action.byName, at: r.action.at, text: r.action.text } : null });

// The lots with their latest run, and today's runs (the QC page)
labQcRouter.get('/', async (req, res) => {
  const lots = await QcLot.find({ tenantId: req.tenantId }).sort({ active: -1, testKey: 1, fieldKey: 1, level: 1 }).lean();
  const latest = new Map();
  if (lots.length) {
    const runs = await QcRun.find({ tenantId: req.tenantId, lotId: { $in: lots.map((l) => l._id) } }).sort({ 'run.at': -1, _id: -1 }).limit(2000).lean();
    for (const r of runs) if (!latest.has(String(r.lotId))) latest.set(String(r.lotId), r);
  }
  const catalogue = await labCatalogue(req.tenantId);
  const numberFields = catalogue.tests.filter((t) => t.active).flatMap((t) => t.fields.filter((f) => f.type === 'number').map((f) => ({ testKey: t.key, testName: t.name, fieldKey: f.key, fieldName: f.name, unit: f.unit ?? '' })));
  res.json({ lots: lots.map((l) => ({ ...lotView(l), latest: latest.has(String(l._id)) ? runView(latest.get(String(l._id))) : null })), fields: numberFields });
});

const lotSchema = z
  .object({
    testKey: z.string().max(40),
    fieldKey: z.string().max(40),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)], 'Choose level 1, 2 or 3'),
    material: safeText('Control material', 120).default(''),
    lotNo: safeText('Lot number', 60).refine((t) => t.trim().length > 0, 'Write the lot number'),
    expiresOn: z.iso.date().nullable().default(null),
    mean: z.number('Enter the mean').finite(),
    sd: z.number('Enter the SD').finite().positive('The SD must be more than 0'),
    active: z.boolean().default(true),
  })
  .strict();

async function checkField(req, body) {
  const catalogue = await labCatalogue(req.tenantId);
  const f = catalogue.byKey.get(body.testKey)?.fields.find((x) => x.key === body.fieldKey && x.type === 'number');
  if (!f) throw invalid({ fieldKey: 'Choose a number value of a test on the list.' });
}

labQcRouter.post('/lots', async (req, res) => {
  const body = parse(lotSchema, req.body);
  await checkField(req, body);
  const lot = await QcLot.create({ tenantId: req.tenantId, ...body, lotNo: body.lotNo.trim(), expiresOn: body.expiresOn ? new Date(`${body.expiresOn}T00:00:00Z`) : null, createdByName: req.user.name });
  await audit(req, 'LAB_QC_LOT_CHANGED', { details: { lotId: String(lot._id), added: true } });
  res.status(201).json({ lot: lotView(lot) });
});

labQcRouter.patch('/lots/:id/active', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }).strict(), req.body);
  const lot = await QcLot.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!lot) throw new HttpError(404, 'This lot was not found.', 'NOT_FOUND');
  lot.active = active;
  await lot.save();
  await audit(req, 'LAB_QC_LOT_CHANGED', { details: { lotId: String(lot._id), active } });
  res.json({ lot: lotView(lot) });
});

// A control run: its z-score and the Westgard rules it breaks (against the lot's earlier runs)
labQcRouter.post('/lots/:id/runs', async (req, res) => {
  const { value } = parse(z.object({ value: z.number('Enter the control value').finite() }).strict(), req.body);
  const lot = await QcLot.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!lot) throw new HttpError(404, 'This lot was not found.', 'NOT_FOUND');
  if (!lot.active) throw new HttpError(409, 'This lot is no longer in use.', 'CONFLICT');
  if (lot.expiresOn && lot.expiresOn < (req.now ?? new Date())) throw new HttpError(409, 'This lot has expired: use a new lot.', 'CONFLICT');
  const earlier = (await QcRun.find({ tenantId: req.tenantId, lotId: lot._id }, { z: 1 }).sort({ 'run.at': -1, _id: -1 }).limit(9).lean()).reverse().map((r) => r.z);
  const score = zScore(value, lot);
  const { violations, status } = westgard(score, earlier);
  const run = await QcRun.create({ tenantId: req.tenantId, lotId: lot._id, testKey: lot.testKey, fieldKey: lot.fieldKey, level: lot.level, value, z: score, violations, status, run: { by: req.user._id, byName: req.user.name, at: req.now ?? new Date() } });
  await audit(req, 'LAB_QC_RUN', { details: { lotId: String(lot._id), runId: String(run._id), status } });
  res.status(201).json({ run: runView(run) });
});

// The corrective action of a rejected run (what was done: recalibrated, new reagent, control repeated …)
labQcRouter.post('/runs/:id/action', async (req, res) => {
  const { text } = parse(z.object({ text: safeText('Corrective action', 500) }).strict(), req.body);
  if (text.trim().length < 5) throw invalid({ text: 'Write what was done.' });
  const run = await QcRun.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!run) throw new HttpError(404, 'This run was not found.', 'NOT_FOUND');
  if (run.status !== 'rejected') throw new HttpError(409, 'Only a rejected run needs a corrective action.', 'CONFLICT');
  if (run.action) throw new HttpError(409, 'This run already has its corrective action.', 'CONFLICT');
  run.action = { by: req.user._id, byName: req.user.name, at: req.now ?? new Date(), text: text.trim() };
  await run.save();
  await audit(req, 'LAB_QC_ACTION', { details: { runId: String(run._id) } });
  res.json({ run: runView(run) });
});

// The Levey-Jennings chart of a lot: its runs (oldest first, the last 60)
labQcRouter.get('/lots/:id/runs', async (req, res) => {
  const lot = await QcLot.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) }).lean();
  if (!lot) throw new HttpError(404, 'This lot was not found.', 'NOT_FOUND');
  const runs = (await QcRun.find({ tenantId: req.tenantId, lotId: lot._id }).sort({ 'run.at': -1, _id: -1 }).limit(60).lean()).reverse();
  res.json({ lot: lotView(lot), runs: runs.map(runView) });
});
