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
  updateProfile: (data) => http.put('/account/profile', data),
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
  summary: (query) => http.get('/hospital/audit-logs/summary', query),
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
  summary: (query) => http.get('/audit-logs/summary', query),
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
  pincode: (pin) => http.get(`${PATIENTS}/pincode/${pin}`),
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
  updateLine: (id, lineId, data) => http.patch(`${BILLING}/bills/${id}/lines/${lineId}`, data),
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
// Reception books lab tests from Today
export const labBookingsApi = {
  tests: () => http.get('/hospital/lab-bookings/tests'),
  book: (data) => http.post('/hospital/lab-bookings', data),
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
export const purchaseOrdersApi = {
  list: (query) => http.get(`${PHARMACY}/orders`, query),
  suggest: () => http.get(`${PHARMACY}/orders/suggest`),
  get: (id) => http.get(`${PHARMACY}/orders/${id}`),
  create: (data) => http.post(`${PHARMACY}/orders`, data),
  update: (id, data) => http.put(`${PHARMACY}/orders/${id}`, data),
  send: (id) => http.post(`${PHARMACY}/orders/${id}/send`),
  cancel: (id, reason) => http.post(`${PHARMACY}/orders/${id}/cancel`, { reason }),
  close: (id, reason) => http.post(`${PHARMACY}/orders/${id}/close`, { reason }),
};
export const supplierReturnsApi = {
  list: (query) => http.get(`${PHARMACY}/supplier-returns`, query),
  batches: (supplierId) => http.get(`${PHARMACY}/supplier-returns/batches/${supplierId}`),
  get: (id) => http.get(`${PHARMACY}/supplier-returns/${id}`),
  create: (data) => http.post(`${PHARMACY}/supplier-returns`, data),
  cancel: (id, data) => http.post(`${PHARMACY}/supplier-returns/${id}/cancel`, data),
};

// Module 8 – visits and prescriptions
const VISITS = '/hospital/visits';
export const visitsApi = {
  list: (patientId) => http.get(`${VISITS}/patient/${patientId}`),
  start: (patientId, clientRequestId) => http.post(`${VISITS}/patient/${patientId}`, { clientRequestId }),
  get: (patientId, visitId) => http.get(`${VISITS}/patient/${patientId}/${visitId}`),
  vitals: (patientId, visitId, data) => http.put(`${VISITS}/patient/${patientId}/${visitId}/vitals`, data),
  details: (patientId, visitId, data) => http.put(`${VISITS}/patient/${patientId}/${visitId}/details`, data),
  prescription: (patientId, visitId, data) => http.put(`${VISITS}/patient/${patientId}/${visitId}/prescription`, data),
  sign: (patientId, visitId) => http.post(`${VISITS}/patient/${patientId}/${visitId}/sign`),
  cancel: (patientId, visitId, reason) => http.post(`${VISITS}/patient/${patientId}/${visitId}/cancel`, { reason }),
  addition: (patientId, visitId, text) => http.post(`${VISITS}/patient/${patientId}/${visitId}/additions`, { text }),
  sendToPharmacy: (patientId, visitId) => http.post(`${VISITS}/patient/${patientId}/${visitId}/send-to-pharmacy`),
  sets: (careType) => http.get(`${VISITS}/sets`, { careType }),
};
// Giving a prescription: medicines, other charges, payment and the bill (the pharmacy and the front desk)
const DISPENSING = '/hospital/dispensing';
export const dispensingApi = {
  queue: () => http.get(`${DISPENSING}/queue`),
  get: (visitId) => http.get(`${DISPENSING}/${visitId}`),
  medicines: (search) => http.get(`${DISPENSING}/medicines`, { search }),
  give: (visitId, data) => http.post(`${DISPENSING}/${visitId}/give`, data),
  bill: (billId) => http.get(`${DISPENSING}/bills/${billId}`),
};
export const pharmacyPrescriptionsApi = {
  queue: () => http.get(`${PHARMACY}/prescriptions/queue`),
  markGiven: (visitId) => http.post(`${PHARMACY}/prescriptions/queue/${visitId}/given`),
  forPatient: (patientId) => http.get(`${PHARMACY}/prescriptions/${patientId}`),
};

// Module 9 – inpatients
const ADMISSIONS = '/hospital/admissions';
export const admissionsApi = {
  inpatients: () => http.get(ADMISSIONS),
  frontDesk: () => http.get(`${ADMISSIONS}/front-desk`),
  ofPatient: (patientId) => http.get(`${ADMISSIONS}/patient/${patientId}`),
  admit: (data) => http.post(ADMISSIONS, data),
  get: (id) => http.get(`${ADMISSIONS}/${id}`),
  bed: (id, data) => http.patch(`${ADMISSIONS}/${id}/bed`, data),
  newDocument: (id, kind, clientRequestId) => http.post(`${ADMISSIONS}/${id}/documents`, { kind, clientRequestId }),
  saveDocument: (id, docId, data) => http.put(`${ADMISSIONS}/${id}/documents/${docId}`, data),
  signDocument: (id, docId) => http.post(`${ADMISSIONS}/${id}/documents/${docId}/sign`),
  readyDocument: (id, docId) => http.post(`${ADMISSIONS}/${id}/documents/${docId}/ready`),
  cancelDocument: (id, docId, reason) => http.post(`${ADMISSIONS}/${id}/documents/${docId}/cancel`, { reason }),
  addToDocument: (id, docId, text) => http.post(`${ADMISSIONS}/${id}/documents/${docId}/additions`, { text }),
  nursing: (id, data) => http.post(`${ADMISSIONS}/${id}/nursing`, data),
  cancelNursing: (id, entryId, reason) => http.post(`${ADMISSIONS}/${id}/nursing/${entryId}/cancel`, { reason }),
};
export const wardIssuesApi = {
  admitted: () => http.get(`${PHARMACY}/ward-issues/admitted`),
  issue: (data) => http.post(`${PHARMACY}/ward-issues`, data),
};

// Module 10 – medical history, scanned documents and discharge cards at the front desk
const DOCUMENTS = '/hospital/patient-documents';
const enc = (v) => (v ? encodeURIComponent(v) : undefined);
export const documentsApi = {
  list: (patientId) => http.get(`${DOCUMENTS}/patient/${patientId}`),
  upload: (patientId, file, { kind, title, documentDate, admissionId }) =>
    http.upload(`${DOCUMENTS}/patient/${patientId}`, file, Object.fromEntries(Object.entries({
      'X-Document-Kind': enc(kind),
      'X-Document-Title': enc(title),
      'X-Document-Date': enc(documentDate),
      'X-Admission-Id': enc(admissionId),
    }).filter(([, v]) => v))),
  file: (id) => http.file(`${DOCUMENTS}/${id}/file`),
  cancel: (id, reason) => http.post(`${DOCUMENTS}/${id}/cancel`, { reason }),
};
export const dischargesApi = {
  list: (query) => http.get('/hospital/discharges', query),
  card: (id) => http.get(`/hospital/discharges/${id}`),
};
export const medicalHistoryApi = {
  get: (patientId) => http.get(`/hospital/medical-history/${patientId}`),
};
export const notificationsApi = {
  list: () => http.get('/hospital/notifications'),
  read: (id) => http.post(`/hospital/notifications/${id}/read`),
  readAll: (types) => http.post('/hospital/notifications/read-all', types ? { types } : {}),
};
export const wardsApi = {
  availability: (query) => http.get('/hospital/wards/availability', query),
  list: () => http.get('/hospital/wards'),
  create: (data) => http.post('/hospital/wards', data),
  update: (id, data) => http.patch(`/hospital/wards/${id}`, data),
};
