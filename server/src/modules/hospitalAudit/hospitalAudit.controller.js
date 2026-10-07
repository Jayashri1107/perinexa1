// The hospital admin's audit log: the same list as the super admin's, always limited to the session's hospital.
import { parse } from '../../core/validate.js';
import { auditSummary, listAuditLogs } from '../audit/audit.service.js';
import { auditListQuery, summaryQuery } from '../audit/audit.validation.js';

export async function list(req, res) {
  const query = parse(auditListQuery, req.query);
  res.json(await listAuditLogs({ ...query, hospitalId: req.hospitalId }, { withPatients: true }));
}

export async function summary(req, res) {
  res.json(await auditSummary({ ...parse(summaryQuery, req.query), hospitalId: req.hospitalId }));
}
