// The settings the website needs (no secrets): it reads them once at start instead of repeating them in its code.
import { config } from '../../config/index.js';
import { AUDIT_ACTIONS } from '../audit/audit.actions.js';

const publicSettings = Object.freeze({
  app: config.app,
  pagination: config.pagination,
  sessionTimeoutMinutes: config.auth.sessionTimeoutMinutes,
  password: config.auth.password,
  roles: config.roles,
  adminRole: config.adminRole,
  masterDataTypes: config.masterData.types,
  hospitalDepartmentType: config.masterData.hospitalDepartmentType,
  auditActions: AUDIT_ACTIONS,
});

export function get(_req, res) {
  res.json(publicSettings);
}
