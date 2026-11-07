import { Router } from 'express';
import { z } from 'zod';
import { departmentRows } from '../clinical/dashboardData.js';
import { DASHBOARD_SOURCE, DEPARTMENTS, INDICATORS, againstTarget } from '../clinical/dashboards.js';
import { DashboardSignoff, DashboardTarget } from '../models/DashboardSignoff.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { parse } from '../utils/validate.js';
import { monthRange } from './clinicalAudit.js';

// Monthly dashboards with targets and the lead's sign-off (Clinical Requirements Group B, item 17): /api/dashboards.
//  - GET /?department=&month=YYYY-MM: the department's rows for the month (numbers only, never a patient), each with
//    its target and whether it was met; and the sign-off, if any – a signed-off month shows the rows as signed;
//  - PUT /targets: a row's target (doctors and the quality lead);
//  - POST /signoff: a doctor signs off a department's finished month, with a comment; it is kept as it was.
// Who reads: doctors, RMOs, the quality lead and the hospital admin (the admin without the rows marked adminHidden).

export const dashboardsRouter = Router();
const READERS = ['doctor', 'rmo', 'quality', 'admin'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const monthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month (YYYY-MM)');
const isAdminOnly = (req) => hasRole(req.membership, 'admin') && !hasRole(req.membership, 'doctor', 'rmo', 'quality');
const thisMonth = (now) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 7);

dashboardsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...READERS)) throw forbidden('The dashboards are for doctors, RMOs, the quality lead and the hospital admin.');
  next();
});

async function rowsWithTargets(req, department, month) {
  const rows = await departmentRows(req.tenantId, department, monthRange(month), req.now ?? new Date());
  const targets = await DashboardTarget.find({ tenantId: req.tenantId, key: { $in: rows.map((r) => r.key) } }).lean();
  const byKey = new Map(targets.map((t) => [t.key, t]));
  return rows.map((r) => {
    const def = INDICATORS.find((i) => i.key === r.key);
    const t = byKey.get(r.key);
    // A row's target: the hospital's own, else the target its manual page gives (defaultTarget – NEO-A-05)
    const target = t ? t.target : (def.defaultTarget ?? null);
    return { ...r, target, targetSetBy: t?.setByName ?? (def.defaultTarget != null ? 'NEO-A-05' : null), status: againstTarget(def, r.value, target) };
  });
}

dashboardsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ department: z.enum(Object.keys(DEPARTMENTS)), month: monthField }).strict(), req.query);
  const live = await rowsWithTargets(req, q.department, q.month);
  const signoff = await DashboardSignoff.findOne({ tenantId: req.tenantId, department: q.department, month: q.month }).lean();
  const hidden = isAdminOnly(req) ? new Set(INDICATORS.filter((i) => i.adminHidden).map((i) => i.key)) : new Set();
  const keep = (rows) => rows.filter((r) => !hidden.has(r.key));
  await audit(req, 'DASHBOARD_VIEWED', { details: { department: q.department, month: q.month } });
  res.json({
    department: q.department,
    month: q.month,
    rows: keep(live),
    signoff: signoff ? { byName: signoff.byName, at: signoff.at, comment: signoff.comment, rows: keep(signoff.rows) } : null,
    access: { setTargets: hasRole(req.membership, 'doctor', 'quality'), signOff: hasRole(req.membership, 'doctor') && !signoff && q.month < thisMonth(req.now ?? new Date()) },
    definitions: INDICATORS.filter((i) => i.department === q.department && !hidden.has(i.key)),
    departments: DEPARTMENTS,
    source: DASHBOARD_SOURCE,
  });
});

dashboardsRouter.put('/targets', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'quality')) throw forbidden('Targets are set by doctors and the quality lead.');
  const b = parse(z.object({ key: z.enum(INDICATORS.map((i) => i.key)), target: z.union([z.null(), z.number('The target must be a number').min(0, 'The target cannot be below 0').max(100000)]) }).strict(), req.body);
  const def = INDICATORS.find((i) => i.key === b.key);
  if (!def.better && b.target != null) throw invalid({ target: 'This row has no target: it is counted, not judged.' });
  if (def.unit === 'percent' && b.target != null && b.target > 100) throw invalid({ target: 'A percentage target is at most 100.' });
  await DashboardTarget.updateOne({ tenantId: req.tenantId, key: b.key }, { $set: { target: b.target, setBy: req.user._id, setByName: req.user.name } }, { upsert: true });
  await audit(req, 'DASHBOARD_TARGET_SET', { details: { key: b.key, target: b.target } });
  res.json({ key: b.key, target: b.target });
});

dashboardsRouter.post('/signoff', async (req, res) => {
  if (!hasRole(req.membership, 'doctor')) throw forbidden('A month is signed off by a doctor (the department lead).');
  const b = parse(z.object({ department: z.enum(Object.keys(DEPARTMENTS)), month: monthField, comment: safeText('Comment', 2000).default('') }).strict(), req.body);
  if (b.month >= thisMonth(req.now ?? new Date())) throw invalid({ month: 'A month is signed off once it is over.' });
  const rows = await rowsWithTargets(req, b.department, b.month);
  const s = await DashboardSignoff.create({ tenantId: req.tenantId, ...b, rows, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() }).catch((e) => {
    if (e?.code === 11000) throw conflict('This month was already signed off.');
    throw e;
  });
  await audit(req, 'DASHBOARD_SIGNED_OFF', { details: { department: b.department, month: b.month } });
  res.status(201).json({ signoff: { byName: s.byName, at: s.at, comment: s.comment, rows: s.rows } });
});
