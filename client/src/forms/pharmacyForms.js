// Pharmacy forms. pharmacy: the server's config.pharmacy (forms, schedules, GST rates, reasons).
import { toOptions } from '../utils/format.js';

export const medicineFields = ({ pharmacy }) => [
  { name: 'name', label: 'Medicine (brand) name', required: true, width: 'two-thirds' },
  { name: 'strength', label: 'Strength', width: 'third', placeholder: 'e.g. 500 mg' },
  { name: 'generic', label: 'Generic name', width: 'two-thirds' },
  { name: 'form', label: 'Form', type: 'select', required: true, options: toOptions(pharmacy.forms), width: 'third' },
  { name: 'schedule', label: 'Schedule', type: 'select', required: true, options: toOptions(pharmacy.schedules), width: 'third', help: 'H1, X and narcotic sales go into their registers.' },
  { name: 'gstRate', label: 'GST %', type: 'select', required: true, options: pharmacy.gstRates.map((r) => ({ value: r, label: `${r}%` })), width: 'third' },
  { name: 'hsn', label: 'HSN code', width: 'third' },
  { name: 'reorderLevel', label: 'Reorder level (units)', type: 'number', width: 'third', help: 'Shown as low stock at or below this.' },
];
export const emptyMedicine = (pharmacy) => ({
  name: '',
  strength: '',
  generic: '',
  form: pharmacy.forms[0].key,
  schedule: pharmacy.schedules[0].key,
  gstRate: pharmacy.gstRates[pharmacy.gstRates.length - 2] ?? pharmacy.gstRates[0],
  hsn: '',
  reorderLevel: 0,
});
export const medicineValues = (m) => ({ name: m.name, strength: m.strength, generic: m.generic, form: m.form, schedule: m.schedule, gstRate: m.gstRate, hsn: m.hsn, reorderLevel: m.reorderLevel });

export const supplierFields = [
  { name: 'name', label: 'Supplier name', required: true },
  { name: 'gstin', label: 'GSTIN', width: 'half' },
  { name: 'drugLicence', label: 'Drug licence number', width: 'half' },
  { name: 'phone', label: 'Phone', type: 'tel', width: 'half' },
  { name: 'email', label: 'Email', type: 'email', width: 'half' },
  { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
];
export const emptySupplier = { name: '', gstin: '', drugLicence: '', phone: '', email: '', address: '' };
export const supplierValues = (s) => ({ name: s.name, gstin: s.gstin, drugLicence: s.drugLicence, phone: s.phone, email: s.email, address: s.address });

export const adjustFields = ({ pharmacy }) => [
  { name: 'kind', label: 'What to do', type: 'select', required: true, options: [{ value: 'writeoff', label: 'Write off units (expired, damaged, lost)' }, { value: 'count', label: 'Correct to the counted number' }] },
  { name: 'qty', label: 'Units', type: 'number', required: true, width: 'half', help: 'Write-off: units taken out. Count: the units actually there.' },
  { name: 'reason', label: 'Reason', type: 'select', required: true, options: toOptions(pharmacy.adjustReasons), width: 'half' },
  { name: 'note', label: 'Note', help: 'Needed for H1, X and narcotic medicines.' },
];

export const pharmacySettingsFields = [
  { name: 'name', label: 'Pharmacy name (on invoices)', width: 'two-thirds' },
  { name: 'gstin', label: 'GSTIN', width: 'third' },
  { name: 'licence20', label: 'Drug licence (Form 20)', width: 'half' },
  { name: 'licence21', label: 'Drug licence (Form 21)', width: 'half' },
  { name: 'rmi', label: 'NDPS recognition (RMI) number', width: 'half', help: 'Needed to stock narcotic medicines.' },
  { name: 'pharmacistName', label: 'Registered pharmacist', width: 'half' },
  { name: 'place', label: 'City / town', width: 'third' },
  { name: 'state', label: 'State', width: 'third' },
  { name: 'pin', label: 'PIN code', width: 'third' },
];
