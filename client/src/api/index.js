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
