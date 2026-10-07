// One entry per server module (server/src/modules/index.js).
import { apiUrl, http } from './http.js';
import { createResource } from './resource.js';

export const metaApi = {
  get: () => http.get('/meta'),
};

export const authApi = {
  login: (data) => http.post('/auth/login', data),
  logout: () => http.post('/auth/logout'),
  me: () => http.get('/auth/me'),
  changePassword: (data) => http.post('/auth/change-password', data),
  switchHospital: (hospitalId) => http.post('/auth/switch-hospital', { hospitalId }),
  leaveHospital: () => http.post('/auth/leave-hospital'),
};

export const accountApi = {
  get: () => http.get('/account'),
  updateProfessional: (data) => http.put('/account/professional', data),
  updateAppearance: (data) => http.put('/account/appearance', data),
};

// Module 2 – the hospital of the session (the server takes it from the login, never from the address).
export const hospitalOverviewApi = {
  get: () => http.get('/hospital/overview'),
};

export const hospitalStaffApi = {
  ...createResource('/hospital/staff'),
  updateRoles: (memberId, roles) => http.patch(`/hospital/staff/${memberId}/roles`, { roles }),
  resetPassword: (memberId) => http.post(`/hospital/staff/${memberId}/reset-password`),
};

export const opdTimingsApi = {
  list: (query) => http.get('/hospital/opd-timings', query),
  get: (doctorId) => http.get(`/hospital/opd-timings/${doctorId}`),
  save: (doctorId, data) => http.put(`/hospital/opd-timings/${doctorId}`, data),
};

export const hospitalSettingsApi = {
  get: () => http.get('/hospital/settings'),
  update: (section, data) => http.put(`/hospital/settings/${section}`, data),
};

export const hospitalAuditApi = {
  list: (query) => http.get('/hospital/audit-logs', query),
};

export const dashboardApi = {
  summary: () => http.get('/dashboard/summary'),
};

export const hospitalsApi = {
  ...createResource('/hospitals'),
  options: () => http.get('/hospitals/options'),
};

export const membersApi = (hospitalId) => {
  const base = `/hospitals/${hospitalId}/members`;
  return {
    ...createResource(base),
    updateRoles: (memberId, roles) => http.patch(`${base}/${memberId}/roles`, { roles }),
  };
};

export const usersApi = {
  ...createResource('/users'),
  resetPassword: (id) => http.post(`/users/${id}/reset-password`),
};

export const masterDataApi = (type) => ({
  ...createResource(`/master-data/${type}`),
  options: () => http.get(`/master-data/${type}/options`),
});

export const auditApi = {
  list: (query) => http.get('/audit-logs', query),
};

export const todayApi = { get: () => http.get('/hospital/today') };

export const platformAnalyticsApi = { get: () => http.get('/platform-analytics') };
export const platformBillingApi = { get: () => http.get('/platform-billing') };
export const platformPharmacyApi = { get: () => http.get('/platform-pharmacy') };

// Module 3 – patients
const PATIENTS = '/hospital/patients';
export const patientsApi = {
  list: (query) => http.get(PATIENTS, query),
  get: (id) => http.get(`${PATIENTS}/${id}`),
  register: (data) => http.post(PATIENTS, data),
  updateContact: (id, data) => http.patch(`${PATIENTS}/${id}/contact`, data),
  updateClinical: (id, data) => http.patch(`${PATIENTS}/${id}/clinical`, data),
  setStatus: (id, status) => http.patch(`${PATIENTS}/${id}/status`, { status }),
  emergencyAccess: (id, reason) => http.post(`${PATIENTS}/${id}/emergency-access`, { reason }),
  doctors: () => http.get(`${PATIENTS}/doctors`),
};

// Module 4 – billing
const BILLING = '/hospital/billing';
export const priceListApi = {
  ...createResource(`${BILLING}/price-list`),
  options: () => http.get(`${BILLING}/price-list/options`),
};
export const billsApi = {
  list: (query) => http.get(`${BILLING}/bills`, query),
  get: (id) => http.get(`${BILLING}/bills/${id}`),
  create: (data) => http.post(`${BILLING}/bills`, data),
  addLines: (id, lines) => http.post(`${BILLING}/bills/${id}/lines`, { lines }),
  removeLine: (id, lineId) => http.post(`${BILLING}/bills/${id}/lines/${lineId}/remove`),
  discount: (id, data) => http.put(`${BILLING}/bills/${id}/discount`, data),
  cancel: (id, reason) => http.post(`${BILLING}/bills/${id}/cancel`, { reason }),
  pay: (id, data) => http.post(`${BILLING}/bills/${id}/payments`, data),
  refund: (id, data) => http.post(`${BILLING}/bills/${id}/refunds`, data),
  patients: (search) => http.get(`${BILLING}/bills/patients`, { search }),
};
export const billingReportsApi = {
  unpaid: (query) => http.get(`${BILLING}/reports/unpaid`, query),
  daily: (date) => http.get(`${BILLING}/reports/daily`, { date }),
  monthly: () => http.get(`${BILLING}/reports/monthly`),
  exportUrl: (from, to) => `${apiUrl(`${BILLING}/reports/export`)}?from=${from}&to=${to}`,
};
export const billingSettingsApi = {
  get: () => http.get(`${BILLING}/settings`),
  update: (data) => http.put(`${BILLING}/settings`, data),
  payee: () => http.get(`${BILLING}/settings/payee`),
  letterhead: () => http.get(`${BILLING}/settings/letterhead`),
};

// Module 5 – pharmacy
const PHARMACY = '/hospital/pharmacy';
export const medicinesApi = {
  ...createResource(`${PHARMACY}/medicines`),
  options: (search) => http.get(`${PHARMACY}/medicines/options`, { search }),
};
export const suppliersApi = {
  ...createResource(`${PHARMACY}/suppliers`),
  options: () => http.get(`${PHARMACY}/suppliers/options`),
};
export const purchasesApi = {
  list: (query) => http.get(`${PHARMACY}/purchases`, query),
  get: (id) => http.get(`${PHARMACY}/purchases/${id}`),
  create: (data) => http.post(`${PHARMACY}/purchases`, data),
};
export const stockApi = {
  list: (query) => http.get(`${PHARMACY}/stock`, query),
  batches: (medicineId) => http.get(`${PHARMACY}/stock/${medicineId}/batches`),
  adjust: (batchId, data) => http.post(`${PHARMACY}/stock/batches/${batchId}/adjust`, data),
};
export const salesApi = {
  list: (query) => http.get(`${PHARMACY}/sales`, query),
  get: (id) => http.get(`${PHARMACY}/sales/${id}`),
  create: (data) => http.post(`${PHARMACY}/sales`, data),
  returnItems: (id, data) => http.post(`${PHARMACY}/sales/${id}/returns`, data),
  patients: (search) => http.get(`${PHARMACY}/sales/patients`, { search }),
};
export const pharmacyReportsApi = {
  alerts: () => http.get(`${PHARMACY}/reports/alerts`),
  expiry: () => http.get(`${PHARMACY}/reports/expiry`),
  value: () => http.get(`${PHARMACY}/reports/value`),
  register: (query) => http.get(`${PHARMACY}/reports/register`, query),
  sales: (from, to) => http.get(`${PHARMACY}/reports/sales`, { from, to }),
};
export const pharmacySettingsApi = {
  get: () => http.get(`${PHARMACY}/settings`),
  update: (data) => http.put(`${PHARMACY}/settings`, data),
};

// Module 6 – analytics
export const analyticsApi = { get: (mine) => http.get('/hospital/analytics', { mine }) };

// Module 7 – the doctor's work
const APPOINTMENTS = '/hospital/appointments';
export const appointmentsApi = {
  doctors: () => http.get(`${APPOINTMENTS}/doctors`),
  timings: (doctorId) => http.get(`${APPOINTMENTS}/timings/${doctorId}`),
  saveTimings: (doctorId, data) => http.put(`${APPOINTMENTS}/timings/${doctorId}`, data),
  day: (doctorId, date) => http.get(`${APPOINTMENTS}/day`, { doctorId, date }),
  needsTime: () => http.get(`${APPOINTMENTS}/needs-time`),
  patients: (search) => http.get(`${APPOINTMENTS}/patients`, { search }),
  forPatient: (patientId) => http.get(`${APPOINTMENTS}/patient/${patientId}`),
  reminders: (date) => http.get(`${APPOINTMENTS}/reminders`, { date }),
  book: (data) => http.post(APPOINTMENTS, data),
  token: (doctorId, patientId) => http.post(`${APPOINTMENTS}/tokens`, { doctorId, patientId }),
  move: (id, data) => http.post(`${APPOINTMENTS}/${id}/move`, data),
  cancel: (id, data) => http.post(`${APPOINTMENTS}/${id}/cancel`, data),
  link: (id, patientId) => http.post(`${APPOINTMENTS}/${id}/link`, { patientId }),
  arrive: (id) => http.post(`${APPOINTMENTS}/${id}/arrive`),
  undoArrival: (id) => http.post(`${APPOINTMENTS}/${id}/undo-arrival`),
  seen: (id) => http.post(`${APPOINTMENTS}/${id}/seen`),
  reminderSent: (id) => http.post(`${APPOINTMENTS}/${id}/reminder-sent`),
};

export const calendarApi = {
  events: (query) => http.get('/hospital/calendar', query),
};

const LAB = '/hospital/lab';
export const labApi = {
  catalogue: () => http.get(`${LAB}/tests`),
  list: (query) => http.get(`${LAB}/orders`, query),
  get: (id) => http.get(`${LAB}/orders/${id}`),
  order: (data) => http.post(`${LAB}/orders`, data),
  forPatient: (patientId) => http.get(`${LAB}/patient/${patientId}`),
  collect: (id) => http.post(`${LAB}/orders/${id}/collect`),
  results: (id, data) => http.put(`${LAB}/orders/${id}/results`, data),
  review: (id) => http.post(`${LAB}/orders/${id}/review`),
  cancel: (id, reason) => http.post(`${LAB}/orders/${id}/cancel`, { reason }),
};

const LIBRARY = '/hospital/library';
export const libraryApi = {
  summary: () => http.get(`${LIBRARY}/summary`),
  list: (query) => http.get(LIBRARY, query),
  get: (id) => http.get(`${LIBRARY}/${id}`),
  create: (data) => http.post(LIBRARY, data),
  update: (id, data) => http.put(`${LIBRARY}/${id}`, data),
  approve: (id) => http.post(`${LIBRARY}/${id}/approve`),
  setStatus: (id, isActive) => http.patch(`${LIBRARY}/${id}/status`, { isActive }),
  duplicate: (id) => http.post(`${LIBRARY}/${id}/duplicate`),
};
