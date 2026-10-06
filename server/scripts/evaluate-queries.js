// Query evaluation: runs MongoDB's "explain" on the main list queries and reports whether each one uses an index
// (IXSCAN) or reads the whole collection (COLLSCAN), with the documents examined and the time taken.
// Run it after adding a list or a filter: npm run db:evaluate
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { AuditLog } from '../src/modules/audit/auditLog.model.js';
import { Hospital } from '../src/modules/hospitals/hospital.model.js';
import { MasterData } from '../src/modules/masterData/masterData.model.js';
import { Membership } from '../src/modules/members/membership.model.js';
import { OpdSchedule } from '../src/modules/opdTimings/opdSchedule.model.js';
import { User } from '../src/modules/users/user.model.js';
import { config } from '../src/config/index.js';

const anyId = (Model) => Model.findOne().select('_id').lean().then((d) => d?._id ?? null);

function stagesOf(plan, out = []) {
  if (!plan || typeof plan !== 'object') return out;
  if (plan.stage) out.push(plan.indexName ? `${plan.stage}(${plan.indexName})` : plan.stage);
  for (const value of Object.values(plan)) {
    if (Array.isArray(value)) value.forEach((v) => stagesOf(v, out));
    else if (value && typeof value === 'object') stagesOf(value, out);
  }
  return out;
}

async function evaluate(label, Model, filter, sort) {
  const explained = await Model.find(filter).sort(sort).limit(config.pagination.defaultLimit).explain('executionStats');
  const stats = explained.executionStats ?? explained[0]?.executionStats ?? {};
  const stages = [...new Set(stagesOf(explained.queryPlanner?.winningPlan ?? {}))];
  const usesIndex = stages.some((s) => s.startsWith('IXSCAN')) || stages.includes('EXPRESS_IXSCAN') || stages.some((s) => s.includes('IDHACK'));
  console.log(
    `${usesIndex ? 'OK  ' : 'SCAN'} ${label.padEnd(36)} examined ${String(stats.totalDocsExamined ?? '?').padStart(6)} docs, ` +
      `${String(stats.executionTimeMillis ?? '?').padStart(4)} ms  [${stages.join(' > ')}]`,
  );
}

await connectDatabase();
try {
  // creates missing indexes only (never drops any)
  await Promise.all([User, Hospital, Membership, MasterData, AuditLog, OpdSchedule].map((M) => M.init()));
  const hospitalId = await anyId(Hospital);
  const firstType = config.masterData.types[0].key;

  await evaluate('Users: active super admins, newest', User, { isSuperAdmin: true, isActive: true }, { createdAt: -1 });
  await evaluate('Users: login by email', User, { email: 'someone@example.com' }, {});
  await evaluate('Hospitals: active, by name', Hospital, { isActive: true }, { name: 1 });
  await evaluate('Hospitals: by department', Hospital, { departments: hospitalId }, { name: 1 });
  await evaluate('Staff of a hospital, newest', Membership, { hospitalId, isActive: true }, { createdAt: -1 });
  await evaluate("A person's hospitals", Membership, { userId: hospitalId, isActive: true }, {});
  await evaluate(`Master data: ${firstType}, in order`, MasterData, { type: firstType, isActive: true }, { sortOrder: 1, name: 1 });
  await evaluate("A hospital's doctors (OPD timings)", Membership, { hospitalId, isActive: true, roles: config.opd.doctorRole }, { createdAt: 1 });
  await evaluate("A doctor's OPD timings", OpdSchedule, { hospitalId, doctorId: hospitalId }, {});
  await evaluate("A hospital's audit log, newest", AuditLog, { hospitalId }, { createdAt: -1 });
  await evaluate('Audit log: newest first', AuditLog, {}, { createdAt: -1 });
  await evaluate('Audit log: one event, newest', AuditLog, { action: 'LOGIN_SUCCESS' }, { createdAt: -1 });
  console.log('\nOK = the query uses an index. SCAN = it reads the whole collection: add an index in the model.');
} finally {
  await disconnectDatabase();
}
