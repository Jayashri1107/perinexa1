import { MeowsChartHeader, MeowsEntry } from '../models/MeowsEntry.js';
import { nextDue } from './meows.js';

// The MEOWS chart on the ward's list (Clinical Requirements Group B, item 8 – E4 of OBG-F-05): for each stay with a
// chart, when the next observations are due, whether they are overdue (the ordered frequency + 15 min; 30 min after a
// trigger), the latest level and the escalation tasks still open (and how many are past their due time).
// Read-only. Every query names the hospital; the aggregate() has its own tenantId match (tenantScoped does not cover it).

export async function meowsWardStatus(tenantId, stays, now = new Date()) {
  const out = new Map();
  if (!stays.length) return out;
  const stayIds = stays.map((s) => s._id);
  const [headers, latest, withTasks] = await Promise.all([
    MeowsChartHeader.find({ tenantId, admissionId: { $in: stayIds } }, { admissionId: 1, frequencyMinutes: 1, startedAt: 1 }).lean(),
    MeowsEntry.aggregate([
      { $match: { tenantId, admissionId: { $in: stayIds }, cancelled: null } },
      { $sort: { at: -1, _id: -1 } },
      { $group: { _id: '$admissionId', at: { $first: '$at' }, level: { $first: '$level' } } },
    ]),
    MeowsEntry.find({ tenantId, admissionId: { $in: stayIds }, cancelled: null, tasks: { $elemMatch: { doneAt: null } } }, { admissionId: 1, tasks: 1 }).lean(),
  ]);
  const t = new Date(now).getTime();
  for (const s of stays) {
    const id = String(s._id);
    const header = headers.find((h) => String(h.admissionId) === id) ?? null;
    const last = latest.find((l) => String(l._id) === id) ?? null;
    if (!header && !last) continue;
    const due = nextDue({ frequency: header?.frequencyMinutes ?? null, last, since: header?.startedAt ?? s.admittedAt }, now);
    const open = withTasks.filter((e) => String(e.admissionId) === id).flatMap((e) => e.tasks.filter((k) => !k.doneAt));
    out.set(id, {
      frequencyMinutes: header?.frequencyMinutes ?? null,
      lastAt: last?.at ?? null,
      level: last?.level ?? null,
      dueAt: due.dueAt,
      overdue: due.overdue,
      openTasks: open.length,
      lateTasks: open.filter((k) => new Date(k.dueAt).getTime() < t).length,
    });
  }
  return out;
}
