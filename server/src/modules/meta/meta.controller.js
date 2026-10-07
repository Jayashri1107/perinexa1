// The settings the website needs (no secrets): it reads them once at start instead of repeating them in its code.
import { config } from '../../config/index.js';
import { PASSWORD_RULE_TEXT } from '../../core/password.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../audit/audit.actions.js';

const { superAdminInHospitals, superAdminPatientAccess, ...roleAccess } = config.access;

const publicSettings = Object.freeze({
  app: config.app,
  pagination: config.pagination,
  sessionTimeoutMinutes: config.auth.sessionTimeoutMinutes,
  password: { ...config.auth.password, ruleText: PASSWORD_RULE_TEXT },
  roles: config.roles,
  adminRole: config.adminRole,
  access: roleAccess,
  superAdmin: { inHospitals: superAdminInHospitals, patientAccess: superAdminPatientAccess },
  prescriberRoles: config.prescriberRoles,
  masterDataTypes: config.masterData.types,
  hospitalDepartmentType: config.masterData.hospitalDepartmentType,
  languages: config.languages,
  opd: config.opd,
  appointments: config.appointments,
  calendar: config.calendar,
  lab: config.lab,
  appearance: config.appearance,
  patients: config.patients,
  billing: config.billing,
  pharmacy: config.pharmacy,
  analytics: config.analytics,
  auditActions: AUDIT_ACTIONS,
  auditCategories: AUDIT_CATEGORIES.map(({ key, label }) => ({ key, label })),
});

export function get(_req, res) {
  res.json(publicSettings);
}
