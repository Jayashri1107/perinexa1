// Every module of the API, in one list. A new module = a folder in modules/ + one line here.
// access: who may call it – 'public', 'user' (any logged-in person), 'superAdmin', or 'hospital' (working in a
// hospital; the hospital comes from the session). roles: for hospital modules, the roles that may use it
// (config.access). The super admin, when working in a hospital, holds every role there.
import { config } from '../config/index.js';
import accountRoutes from './account/account.routes.js';
import admissionRoutes, { wardIssueRouter } from './admissions/admission.routes.js';
import analyticsRoutes from './analytics/analytics.routes.js';
import appointmentRoutes from './appointments/appointment.routes.js';
import auditRoutes from './audit/audit.routes.js';
import authRoutes from './auth/auth.routes.js';
import billRoutes from './bills/bill.routes.js';
import billingReportRoutes from './billingReports/billingReports.routes.js';
import billingSettingsRoutes from './billingSettings/billingSettings.routes.js';
import calendarRoutes from './calendar/calendar.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import hospitalAuditRoutes from './hospitalAudit/hospitalAudit.routes.js';
import hospitalOverviewRoutes from './hospitalOverview/hospitalOverview.routes.js';
import hospitalRoutes from './hospitals/hospital.routes.js';
import hospitalSettingsRoutes from './hospitalSettings/hospitalSettings.routes.js';
import hospitalStaffRoutes from './hospitalStaff/hospitalStaff.routes.js';
import labRoutes from './lab/lab.routes.js';
import libraryRoutes from './library/library.routes.js';
import masterDataRoutes from './masterData/masterData.routes.js';
import medicineRoutes from './medicines/medicine.routes.js';
import memberRoutes from './members/member.routes.js';
import metaRoutes from './meta/meta.routes.js';
import opdTimingsRoutes from './opdTimings/opdTimings.routes.js';
import patientRoutes from './patients/patient.routes.js';
import pharmacyReportRoutes from './pharmacyReports/pharmacyReports.routes.js';
import pharmacySettingsRoutes from './pharmacySettings/pharmacySettings.routes.js';
import platformAnalyticsRoutes from './platformAnalytics/platformAnalytics.routes.js';
import platformBillingRoutes from './platformBilling/platformBilling.routes.js';
import platformPharmacyRoutes from './platformPharmacy/platformPharmacy.routes.js';
import priceListRoutes from './priceList/priceList.routes.js';
import purchaseOrderRoutes from './purchaseOrders/purchaseOrder.routes.js';
import purchaseRoutes from './purchases/purchase.routes.js';
import saleRoutes from './sales/sale.routes.js';
import stockRoutes from './stock/stock.routes.js';
import supplierReturnRoutes from './supplierReturns/supplierReturn.routes.js';
import supplierRoutes from './suppliers/supplier.routes.js';
import todayRoutes from './today/today.routes.js';
import userRoutes from './users/user.routes.js';
import visitRoutes, { pharmacyPrescriptionRouter } from './visits/visit.routes.js';
import dischargeRoutes from './discharges/discharge.routes.js';
import documentRoutes from './documents/document.routes.js';
import medicalHistoryRoutes from './medicalHistory/medicalHistory.routes.js';

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
  { path: '/platform-billing', access: 'superAdmin', router: platformBillingRoutes },
  { path: '/platform-pharmacy', access: 'superAdmin', router: platformPharmacyRoutes },
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
  { path: '/hospital/pharmacy/orders', access: 'hospital', roles: access.pharmacy, router: purchaseOrderRoutes },
  { path: '/hospital/pharmacy/supplier-returns', access: 'hospital', roles: access.pharmacy, router: supplierReturnRoutes },
  { path: '/hospital/pharmacy/stock', access: 'hospital', roles: access.pharmacy, router: stockRoutes },
  { path: '/hospital/pharmacy/sales', access: 'hospital', roles: access.pharmacy, router: saleRoutes },
  { path: '/hospital/pharmacy/reports', access: 'hospital', roles: access.pharmacy, router: pharmacyReportRoutes },
  { path: '/hospital/pharmacy/settings', access: 'hospital', roles: access.pharmacy, router: pharmacySettingsRoutes },

  // Module 6 – analytics
  { path: '/hospital/analytics', access: 'hospital', roles: access.analytics, router: analyticsRoutes },

  // Module 7 – the doctor's work: appointments, calendar, lab, clinic library
  { path: '/hospital/appointments', access: 'hospital', roles: access.appointments, router: appointmentRoutes },
  { path: '/hospital/calendar', access: 'hospital', roles: access.calendar, router: calendarRoutes },
  { path: '/hospital/lab', access: 'hospital', roles: access.lab, router: labRoutes },
  { path: '/hospital/library', access: 'hospital', roles: access.library, router: libraryRoutes },

  // Module 8 – visits and prescriptions
  { path: '/hospital/visits', access: 'hospital', roles: access.patientsClinical, router: visitRoutes },
  { path: '/hospital/pharmacy/prescriptions', access: 'hospital', roles: access.pharmacyCounter, router: pharmacyPrescriptionRouter },

  // Module 9 – inpatients (stays, ward documents, nursing chart) and the pharmacy's issue to ward
  { path: '/hospital/admissions', access: 'hospital', roles: access.patientsClinical, router: admissionRoutes },
  { path: '/hospital/pharmacy/ward-issues', access: 'hospital', roles: access.pharmacyCounter, router: wardIssueRouter },

  // Module 10 – medical history, scanned documents and discharge cards at the front desk (7 Oct 2026)
  { path: '/hospital/medical-history', access: 'hospital', roles: access.patientsClinical, router: medicalHistoryRoutes },
  { path: '/hospital/patient-documents', access: 'hospital', roles: access.patientDocuments, router: documentRoutes },
  { path: '/hospital/discharges', access: 'hospital', roles: access.dischargeCards, router: dischargeRoutes },
];
