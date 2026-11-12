import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { USG_REFERENCE_KEYS, UsgReference } from '../models/UsgReference.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { parse } from '../utils/validate.js';

// Sonography stage 2 – the reference tables (docs/USG_APPS_REVIEW.md U1, U3, U5): /api/usg-references. A doctor copies
// a published chart in (each week: 5th, 50th, 95th centile) with its source, and a doctor approves it. Doctors, RMOs and
// sonographers read the list. Nothing is built in; only an approved version is used.

export const usgReferencesRouter = Router();
const READERS = ['doctor', 'rmo', 'sonographer'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const bad = (m, fields) => Object.assign(new HttpError(400, m, 'VALIDATION'), fields ? { fields } : {});

usgReferencesRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The scan reference tables are for doctors, RMOs and sonographers.');
  next();
});
const doctor = (req) => {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('A doctor writes and approves the reference tables.');
};

const view = (key, r) => ({
  key,
  ...USG_REFERENCE_KEYS[key],
  source: r?.source ?? '',
  rows: (r?.rows ?? []).map((x) => ({ week: x.week, p5: x.p5, p50: x.p50, p95: x.p95 })),
  version: r?.version ?? 0,
  status: r && r.approvedVersion === r.version ? 'approved' : 'draft',
  approved: r?.approved ? { byName: r.approved.byName, at: r.approved.at, version: r.approvedVersion } : null,
  inUse: r?.inUse ? { source: r.inUse.source, version: r.inUse.version } : null,
  updatedByName: r?.updatedByName ?? '',
});

usgReferencesRouter.get('/', async (req, res) => {
  const saved = new Map((await UsgReference.find({ tenantId: req.tenantId }).lean()).map((r) => [r.key, r]));
  res.json({ references: Object.keys(USG_REFERENCE_KEYS).map((k) => view(k, saved.get(k))), canEdit: hasRole(req.membership, 'doctor') });
});

const keyOf = (req) => {
  if (!(req.params.key in USG_REFERENCE_KEYS)) throw new HttpError(404, 'No such reference table.', 'NOT_FOUND');
  return req.params.key;
};
const rowSchema = z.object({ week: z.number().int().min(10).max(43), p5: z.number().finite().min(0), p50: z.number().finite().min(0), p95: z.number().finite().min(0) }).strict();

usgReferencesRouter.put('/:key', async (req, res) => {
  doctor(req);
  const key = keyOf(req);
  const body = parse(z.object({ source: safeText('Source', 300), rows: z.array(rowSchema).max(40), version: z.number().int().min(0) }).strict(), req.body);
  const fields = {};
  if (body.source.trim().length < 5) fields.source = 'Name the published chart (authors, year, title) the numbers are copied from.';
  const weeks = body.rows.map((r) => r.week);
  if (new Set(weeks).size !== weeks.length) fields.rows = 'A week is written twice.';
  body.rows.forEach((r, i) => {
    if (!(r.p5 <= r.p50 && r.p50 <= r.p95)) fields[`rows.${i}`] = `Week ${r.week}: the 5th must not be above the 50th, nor the 50th above the 95th.`;
  });
  if (Object.keys(fields).length) throw bad('Please check the highlighted fields.', fields);
  let r = await UsgReference.findOne({ tenantId: req.tenantId, key });
  if ((r?.version ?? 0) !== body.version) throw new HttpError(409, 'This table was changed after you opened it. Reload, then make your change again.', 'STALE');
  if (!r) r = new UsgReference({ tenantId: req.tenantId, key, version: 0 });
  r.source = body.source.trim();
  r.rows = [...body.rows].sort((a, b) => a.week - b.week);
  r.version += 1; // a new DRAFT; the approved copy stays in use until this one is approved
  r.updatedByName = req.user.name;
  await r.save();
  await audit(req, 'USG_REFERENCE_CHANGED', { details: { key, version: r.version, weeks: r.rows.length } });
  res.json({ reference: view(key, r.toObject()) });
});

usgReferencesRouter.post('/:key/approve', async (req, res) => {
  doctor(req);
  const key = keyOf(req);
  const { version } = parse(z.object({ version: z.number().int().min(1) }).strict(), req.body);
  const r = await UsgReference.findOne({ tenantId: req.tenantId, key });
  if (!r || r.version !== version) throw new HttpError(409, 'This table was changed after you opened it. Reload and check it again.', 'STALE');
  if (r.rows.length < 2 || r.source.length < 5) throw bad('A table needs its source and at least two weeks before it is approved.');
  r.approvedVersion = r.version;
  r.approved = { by: req.user._id, byName: req.user.name, at: req.now };
  r.inUse = { source: r.source, rows: r.rows, version: r.version };
  await r.save();
  await audit(req, 'USG_REFERENCE_APPROVED', { details: { key, version: r.version, weeks: r.rows.length } });
  res.json({ reference: view(key, r.toObject()) });
});

/** The approved tables in use: { key: { name, unit, source, rows } } – for a scan's page and printed report. */
export async function approvedReferences(tenantId) {
  const out = {};
  for (const r of await UsgReference.find({ tenantId, inUse: { $ne: null } }).lean()) {
    out[r.key] = { ...USG_REFERENCE_KEYS[r.key], source: r.inUse.source, rows: r.inUse.rows.map((x) => ({ week: x.week, p5: x.p5, p50: x.p50, p95: x.p95 })) };
  }
  return out;
}
