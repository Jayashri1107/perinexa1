// Patient forms. careTypes, sexes: the server's lists; doctors: [{ value, label }].
import { toOptions } from '../utils/format.js';

const needsLmp = (careTypes) => (values) => careTypes.find((c) => c.key === values.careType)?.needsLmp;

// Who she is and how to reach her (registration and reception's changes). withLmp: may give the LMP.
export const contactFields = ({ careTypes, sexes, doctors, idProofTypes = [], withLmp = true }) => [
  { name: 'name', label: 'Full name', required: true, width: 'two-thirds' },
  { name: 'sex', label: 'Sex', type: 'select', required: true, options: toOptions(sexes), width: 'third' },
  { name: 'birthDate', label: 'Date of birth', type: 'date', width: 'third', help: 'Or give the age.' },
  { name: 'ageYears', label: 'Age (years)', type: 'number', width: 'third', showIf: (v) => !v.birthDate },
  { name: 'phone', label: 'Mobile', type: 'tel', required: true, digits: true, maxLength: 10, width: 'third', help: '10 digits.' },
  { name: 'alternatePhone', label: 'Other mobile', type: 'tel', digits: true, maxLength: 10, width: 'third' },
  { name: 'abhaNumber', label: 'ABHA number', width: 'third' },
  { name: 'idProof.kind', label: 'ID proof', type: 'select', required: true, options: toOptions(idProofTypes), width: 'third' },
  {
    name: 'idProof.number',
    label: 'ID number',
    required: true,
    upper: true,
    maxLength: 30,
    width: 'two-thirds',
    help: 'The full number as on the card. For Aadhaar only the last 4 digits – the whole Aadhaar number is never kept.',
  },
  { section: 'Relative / attendant (required)' },
  { name: 'emergencyContact.name', label: 'Name', required: true, width: 'third', help: 'A relative or attendant to call.' },
  { name: 'emergencyContact.relation', label: 'Relation', required: true, width: 'third', help: 'For example husband, mother.' },
  { name: 'emergencyContact.phone', label: 'Mobile', type: 'tel', required: true, digits: true, maxLength: 10, width: 'third' },
  { section: 'Address' },
  { name: 'address.pincode', label: 'PIN code', digits: true, maxLength: 6, width: 'third', help: 'City and state fill in by themselves.' },
  { name: 'address.city', label: 'City / district', width: 'third' },
  { name: 'address.state', label: 'State', width: 'third' },
  { name: 'address.line', label: 'House, street, area' },
  { section: 'Care' },
  { name: 'careType', label: 'Type of care', type: 'select', required: true, options: toOptions(careTypes), width: 'half' },
  {
    name: 'assignedDoctorId',
    label: 'Her doctor',
    type: 'select',
    options: doctors,
    width: 'half',
    placeholder: doctors.length ? 'Choose…' : 'No doctors in this hospital yet',
    help: doctors.length ? undefined : 'The hospital admin adds doctors in Hospital admin → Staff.',
  },
  ...(withLmp ? [{ name: 'lmp', label: 'Last menstrual period (LMP)', type: 'date', width: 'half', help: 'The due date (EDD) is worked out from it.', showIf: needsLmp(careTypes) }] : []),
  { name: 'consentMessages', label: 'Agrees to receive reminders (SMS / WhatsApp)', type: 'switch' },
];

export const emptyPatient = (careTypes, sexes) => ({
  name: '',
  sex: sexes[0].key,
  birthDate: '',
  ageYears: '',
  phone: '',
  alternatePhone: '',
  abhaNumber: '',
  emergencyContact: { name: '', relation: '', phone: '' },
  idProof: { kind: '', number: '' },
  address: { line: '', city: '', state: '', pincode: '' },
  careType: careTypes[0].key,
  assignedDoctorId: '',
  lmp: '',
  consentMessages: false,
});

const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const contactValues = (p) => ({
  name: p.name,
  sex: p.sex,
  birthDate: p.birthDateApprox ? '' : dateInput(p.birthDate),
  ageYears: p.birthDateApprox ? new Date().getFullYear() - new Date(p.birthDate).getFullYear() : '',
  phone: p.phone ?? '',
  alternatePhone: p.alternatePhone ?? '',
  abhaNumber: p.abhaNumber ?? '',
  emergencyContact: { name: '', relation: '', phone: '', ...p.emergencyContact },
  idProof: { kind: p.idProof?.kind ?? '', number: p.idProof?.number || p.idProof?.last4 || '' },
  address: { line: '', city: '', state: '', pincode: '', ...p.address },
  careType: p.careType,
  assignedDoctorId: p.assignedDoctorId ?? '',
  lmp: dateInput(p.lmp),
  consentMessages: Boolean(p.consentMessages),
});

// Clinical details (her doctor, RMOs).
export const clinicalFields = ({ careTypes, bloodGroups }) => [
  { name: 'careType', label: 'Type of care', type: 'select', required: true, options: toOptions(careTypes), width: 'half' },
  { name: 'bloodGroup', label: 'Blood group', type: 'select', options: bloodGroups.map((b) => ({ value: b, label: b })), width: 'half' },
  { name: 'lmp', label: 'LMP', type: 'date', width: 'third', showIf: needsLmp(careTypes) },
  { name: 'edd', label: 'EDD', type: 'date', width: 'third', help: 'Leave empty to work it out from the LMP.', showIf: needsLmp(careTypes) },
  { name: 'gravida', label: 'Gravida', type: 'number', width: 'third' },
  { name: 'para', label: 'Para', type: 'number', width: 'third' },
  { name: 'allergies', label: 'Allergies', type: 'textarea', rows: 2 },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
  { name: 'isSensitive', label: 'Sensitive record (only her doctor and RMOs can open it)', type: 'switch' },
];

export const clinicalValues = (p) => ({
  careType: p.careType,
  bloodGroup: p.bloodGroup ?? '',
  lmp: dateInput(p.lmp),
  edd: dateInput(p.edd),
  gravida: p.gravida ?? '',
  para: p.para ?? '',
  allergies: p.allergies ?? '',
  notes: p.notes ?? '',
  isSensitive: Boolean(p.isSensitive),
});

export const emergencyFields = [
  { name: 'reason', label: 'Why you need this record now', type: 'textarea', rows: 3, required: true, help: 'Recorded with your name. Access ends automatically.' },
];
