// The hospital form. departments: [{ value, label }] from master data.
export function hospitalFields({ departments, isNew }) {
  return [
    ...(isNew
      ? [{ name: 'code', label: 'Hospital code', required: true, width: 'third', help: 'Short fixed code, e.g. SUN1. Cannot be changed later.' }]
      : []),
    { name: 'name', label: 'Hospital name', required: true, width: isNew ? 'two-thirds' : 'full' },
    { name: 'email', label: 'Email', type: 'email', width: 'half' },
    { name: 'phone', label: 'Phone', type: 'tel', width: 'half' },
    { section: 'Address' },
    { name: 'address.line', label: 'Street and area' },
    { name: 'address.city', label: 'City', width: 'third' },
    { name: 'address.state', label: 'State', width: 'third' },
    { name: 'address.pincode', label: 'PIN code', width: 'third' },
    { section: 'Departments' },
    { name: 'departments', label: 'Departments in this hospital', type: 'checkboxes', options: departments, emptyText: 'Add departments under Master data first.' },
    ...(isNew
      ? [
          { section: 'First hospital admin (optional)' },
          { name: 'firstAdmin.name', label: 'Full name', width: 'half' },
          { name: 'firstAdmin.email', label: 'Email', type: 'email', width: 'half', help: 'Gets a temporary password to give them.' },
        ]
      : []),
  ];
}

export const emptyHospital = {
  code: '',
  name: '',
  email: '',
  phone: '',
  address: { line: '', city: '', state: '', pincode: '' },
  departments: [],
  firstAdmin: { name: '', email: '' },
};

export const hospitalToForm = (h) => ({
  name: h.name,
  email: h.email ?? '',
  phone: h.phone ?? '',
  address: { line: '', city: '', state: '', pincode: '', ...h.address },
  departments: h.departments.filter((d) => d.isActive).map((d) => d.id),
});

export function hospitalPayload(values, isNew) {
  const { code, firstAdmin, ...rest } = values;
  if (!isNew) return rest;
  const withAdmin = firstAdmin.name || firstAdmin.email;
  return { ...rest, code, ...(withAdmin && { firstAdmin }) };
}
