// The hospital admin's audit log: the same list as the super admin's, always limited to the session's hospital.
import { parse } from '../../core/validate.js';
import { listAuditLogs } from '../audit/audit.service.js';
import { auditListQuery } from '../audit/audit.validation.js';

export async function list(req, res) {
  const query = parse(auditListQuery, req.query);
  res.json(await listAuditLogs({ ...query, hospitalId: req.hospitalId }, { withPatients: true }));
}
