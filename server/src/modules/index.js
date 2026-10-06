// Every module of the API, in one list. A new module = a folder in modules/ + one line here.
// access: who may call it – 'public', 'user' (any logged-in person) or 'superAdmin' (middleware/auth.js).
import auditRoutes from './audit/audit.routes.js';
import authRoutes from './auth/auth.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import hospitalRoutes from './hospitals/hospital.routes.js';
import masterDataRoutes from './masterData/masterData.routes.js';
import memberRoutes from './members/member.routes.js';
import metaRoutes from './meta/meta.routes.js';
import userRoutes from './users/user.routes.js';

export const modules = [
  { path: '/meta', access: 'public', router: metaRoutes },
  { path: '/auth', access: 'public', router: authRoutes },
  { path: '/dashboard', access: 'superAdmin', router: dashboardRoutes },
  { path: '/hospitals/:hospitalId/members', access: 'superAdmin', router: memberRoutes },
  { path: '/hospitals', access: 'superAdmin', router: hospitalRoutes },
  { path: '/users', access: 'superAdmin', router: userRoutes },
  { path: '/master-data', access: 'superAdmin', router: masterDataRoutes },
  { path: '/audit-logs', access: 'superAdmin', router: auditRoutes },
];
