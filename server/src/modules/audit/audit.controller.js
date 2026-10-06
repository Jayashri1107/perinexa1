import { parse } from '../../core/validate.js';
import { listAuditLogs } from './audit.service.js';
import { auditListQuery } from './audit.validation.js';

export async function list(req, res) {
  res.json(await listAuditLogs(parse(auditListQuery, req.query)));
}
