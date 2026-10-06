import { http } from './http.js';

// The standard operations of one server module. Every module that follows the same routes gets them for free.
export function createResource(base) {
  return {
    list: (query) => http.get(base, query),
    get: (id) => http.get(`${base}/${id}`),
    create: (data) => http.post(base, data),
    update: (id, data) => http.patch(`${base}/${id}`, data),
    setStatus: (id, isActive) => http.patch(`${base}/${id}/status`, { isActive }),
  };
}
