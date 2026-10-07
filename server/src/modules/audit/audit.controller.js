import { parse } from '../../core/validate.js';
import { auditSummary, listAuditLogs } from './audit.service.js';
import { auditListQuery, summaryQuery } from './audit.validation.js';

export async function list(req, res) {
  res.json(await listAuditLogs(parse(auditListQuery, req.query)));
}

export async function summary(req, res) {
  res.json(await auditSummary(parse(summaryQuery, req.query)));
}
