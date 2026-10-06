// Read and write "address.city" style names on plain objects (writes return a new object).
export const getPath = (obj, path) => path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);

export function setPath(obj, path, value) {
  const [key, ...rest] = path.split('.');
  if (!rest.length) return { ...obj, [key]: value };
  return { ...obj, [key]: setPath(obj?.[key] ?? {}, rest.join('.'), value) };
}
