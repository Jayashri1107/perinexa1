// Patient forms. careTypes, sexes: the server's lists; doctors: [{ value, label }].
import { toOptions } from '../utils/format.js';

const needsLmp = (careTypes) => (values) => careTypes.find((c) => c.key === values.careType)?.needsLmp;

// Who she is and how to reach her (registration and reception's changes). withLmp: may give the LMP.
export const contactFields = ({ careTypes, sexes, doctors, idProofTypes = [], withLmp = true }) => [
  { name: 'name', label: 'Full name', required: true, width: 'two-thirds' },
  { name: 'sex', label: 'Sex', type: 'select', required: true, options: toOptions(sexes), width: 'third' },
  { name: 'birthDate', label: 'Date of birth', type: 'date', width: 'third', help: 'Or give the age.' },
  { name: 'ageYears', label: 'Age (years)', type: 'number', width: 'third', showIf: (v) => !v.birthDate },
  { name: 'phone', label: 'Phone', type: 'tel', width: 'third' },
  { name: 'alternatePhone', label: 'Other phone', type: 'tel', width: 'third' },
  { name: 'abhaNumber', label: 'ABHA number', width: 'third' },
  { name: 'idProof.kind', label: 'ID proof seen', type: 'select', options: toOptions(idProofTypes), placeholder: 'None noted', width: 'third' },
  { name: 'idProof.last4', label: 'Last 4 of the ID number', width: 'third', help: 'Only the last 4 – never the whole number.' },
  { section: 'Emergency contact' },
  { name: 'emergencyContact.name', label: 'Name', width: 'third', help: 'A relative or attendant to call.' },
  { name: 'emergencyContact.relation', label: 'Relation', width: 'third', help: 'For example husband, mother.' },
  { name: 'emergencyContact.phone', label: 'Phone', type: 'tel', width: 'third' },
  { section: 'Address' },
  { name: 'address.line', label: 'House, street, area' },
  { name: 'address.city', label: 'City / village', width: 'third' },
  { name: 'address.state', label: 'State', width: 'third' },
  { name: 'address.pincode', label: 'PIN code', width: 'third' },
  { section: 'Care' },
  { name: 'careType', label: 'Type of care', type: 'select', required: true, options: toOptions(careTypes), width: 'half' },
  { name: 'assignedDoctorId', label: 'Her doctor', type: 'select', options: doctors, width: 'half' },
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
  idProof: { kind: '', last4: '' },
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
  idProof: { kind: '', last4: '', ...p.idProof },
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
