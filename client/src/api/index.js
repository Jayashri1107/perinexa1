// One entry per server module (server/src/modules/index.js).
import { http } from './http.js';
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
