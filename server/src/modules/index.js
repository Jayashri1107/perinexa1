// Every module of the API, in one list. A new module = a folder in modules/ + one line here.
// access: who may call it – 'public', 'user' (any logged-in person), 'superAdmin', or 'hospital' (working in a
// hospital; the hospital comes from the session). roles: for hospital modules, the roles that may use it.
import { config } from '../config/index.js';
import accountRoutes from './account/account.routes.js';
import auditRoutes from './audit/audit.routes.js';
import authRoutes from './auth/auth.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import hospitalAuditRoutes from './hospitalAudit/hospitalAudit.routes.js';
import hospitalOverviewRoutes from './hospitalOverview/hospitalOverview.routes.js';
import hospitalRoutes from './hospitals/hospital.routes.js';
import hospitalSettingsRoutes from './hospitalSettings/hospitalSettings.routes.js';
import hospitalStaffRoutes from './hospitalStaff/hospitalStaff.routes.js';
import masterDataRoutes from './masterData/masterData.routes.js';
import memberRoutes from './members/member.routes.js';
import metaRoutes from './meta/meta.routes.js';
import opdTimingsRoutes from './opdTimings/opdTimings.routes.js';
import userRoutes from './users/user.routes.js';

const HOSPITAL_ADMIN = [config.adminRole];

export const modules = [
  // Everyone
  { path: '/meta', access: 'public', router: metaRoutes },
  { path: '/auth', access: 'public', router: authRoutes },
  { path: '/account', access: 'user', router: accountRoutes },

  // Module 1 – main admin (super admin)
  { path: '/dashboard', access: 'superAdmin', router: dashboardRoutes },
  { path: '/hospitals/:hospitalId/members', access: 'superAdmin', router: memberRoutes },
  { path: '/hospitals', access: 'superAdmin', router: hospitalRoutes },
  { path: '/users', access: 'superAdmin', router: userRoutes },
  { path: '/master-data', access: 'superAdmin', router: masterDataRoutes },
  { path: '/audit-logs', access: 'superAdmin', router: auditRoutes },

  // Module 2 – hospital admin (the hospital of the session)
  { path: '/hospital/overview', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalOverviewRoutes },
  { path: '/hospital/staff', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalStaffRoutes },
  { path: '/hospital/opd-timings', access: 'hospital', roles: HOSPITAL_ADMIN, router: opdTimingsRoutes },
  { path: '/hospital/settings', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalSettingsRoutes },
  { path: '/hospital/audit-logs', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalAuditRoutes },
];
