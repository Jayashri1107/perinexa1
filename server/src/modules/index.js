// Every module of the API, in one list. A new module = a folder in modules/ + one line here.
// access: who may call it – 'public', 'user' (any logged-in person), 'superAdmin', or 'hospital' (working in a
// hospital; the hospital comes from the session). roles: for hospital modules, the roles that may use it
// (config.access). The super admin, when working in a hospital, holds every role there.
import { config } from '../config/index.js';
import accountRoutes from './account/account.routes.js';
import analyticsRoutes from './analytics/analytics.routes.js';
import auditRoutes from './audit/audit.routes.js';
import authRoutes from './auth/auth.routes.js';
import billRoutes from './bills/bill.routes.js';
import billingReportRoutes from './billingReports/billingReports.routes.js';
import billingSettingsRoutes from './billingSettings/billingSettings.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import hospitalAuditRoutes from './hospitalAudit/hospitalAudit.routes.js';
import hospitalOverviewRoutes from './hospitalOverview/hospitalOverview.routes.js';
import hospitalRoutes from './hospitals/hospital.routes.js';
import hospitalSettingsRoutes from './hospitalSettings/hospitalSettings.routes.js';
import hospitalStaffRoutes from './hospitalStaff/hospitalStaff.routes.js';
import masterDataRoutes from './masterData/masterData.routes.js';
import medicineRoutes from './medicines/medicine.routes.js';
import memberRoutes from './members/member.routes.js';
import metaRoutes from './meta/meta.routes.js';
import opdTimingsRoutes from './opdTimings/opdTimings.routes.js';
import patientRoutes from './patients/patient.routes.js';
import pharmacyReportRoutes from './pharmacyReports/pharmacyReports.routes.js';
import pharmacySettingsRoutes from './pharmacySettings/pharmacySettings.routes.js';
import platformAnalyticsRoutes from './platformAnalytics/platformAnalytics.routes.js';
import priceListRoutes from './priceList/priceList.routes.js';
import purchaseRoutes from './purchases/purchase.routes.js';
import saleRoutes from './sales/sale.routes.js';
import stockRoutes from './stock/stock.routes.js';
import supplierRoutes from './suppliers/supplier.routes.js';
import todayRoutes from './today/today.routes.js';
import userRoutes from './users/user.routes.js';

const { access } = config;
const HOSPITAL_ADMIN = [config.adminRole];

export const modules = [
  // Everyone
  { path: '/meta', access: 'public', router: metaRoutes },
  { path: '/auth', access: 'public', router: authRoutes },
  { path: '/account', access: 'user', router: accountRoutes },

  // Module 1 – main admin (super admin)
  { path: '/dashboard', access: 'superAdmin', router: dashboardRoutes },
  { path: '/platform-analytics', access: 'superAdmin', router: platformAnalyticsRoutes },
  { path: '/hospitals/:hospitalId/members', access: 'superAdmin', router: memberRoutes },
  { path: '/hospitals', access: 'superAdmin', router: hospitalRoutes },
  { path: '/users', access: 'superAdmin', router: userRoutes },
  { path: '/master-data', access: 'superAdmin', router: masterDataRoutes },
  { path: '/audit-logs', access: 'superAdmin', router: auditRoutes },

  // Module 2 – hospital admin (the hospital of the session)
  { path: '/hospital/today', access: 'hospital', router: todayRoutes },
  { path: '/hospital/overview', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalOverviewRoutes },
  { path: '/hospital/staff', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalStaffRoutes },
  { path: '/hospital/opd-timings', access: 'hospital', roles: HOSPITAL_ADMIN, router: opdTimingsRoutes },
  { path: '/hospital/settings', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalSettingsRoutes },
  { path: '/hospital/audit-logs', access: 'hospital', roles: HOSPITAL_ADMIN, router: hospitalAuditRoutes },

  // Module 3 – patients
  { path: '/hospital/patients', access: 'hospital', roles: access.patients, router: patientRoutes },

  // Module 4 – billing
  { path: '/hospital/billing/price-list', access: 'hospital', roles: access.billing, router: priceListRoutes },
  { path: '/hospital/billing/bills', access: 'hospital', roles: access.billing, router: billRoutes },
  { path: '/hospital/billing/reports', access: 'hospital', roles: access.billing, router: billingReportRoutes },
  { path: '/hospital/billing/settings', access: 'hospital', roles: access.billing, router: billingSettingsRoutes },

  // Module 5 – pharmacy
  { path: '/hospital/pharmacy/medicines', access: 'hospital', roles: access.pharmacy, router: medicineRoutes },
  { path: '/hospital/pharmacy/suppliers', access: 'hospital', roles: access.pharmacy, router: supplierRoutes },
  { path: '/hospital/pharmacy/purchases', access: 'hospital', roles: access.pharmacy, router: purchaseRoutes },
  { path: '/hospital/pharmacy/stock', access: 'hospital', roles: access.pharmacy, router: stockRoutes },
  { path: '/hospital/pharmacy/sales', access: 'hospital', roles: access.pharmacy, router: saleRoutes },
  { path: '/hospital/pharmacy/reports', access: 'hospital', roles: access.pharmacy, router: pharmacyReportRoutes },
  { path: '/hospital/pharmacy/settings', access: 'hospital', roles: access.pharmacy, router: pharmacySettingsRoutes },

  // Module 6 – analytics
  { path: '/hospital/analytics', access: 'hospital', roles: access.analytics, router: analyticsRoutes },
];
