// Words and the fields of each ward document (as in Perinexa's pages/inpatient/docFields.js). type: text | area |
// datetime | date | number | select | vitals | babies | medicines.
import { Ban, BedDouble, CircleCheck, DoorOpen, PencilLine } from 'lucide-react';

export const KIND_LABELS = { admission: 'Admission note', round: 'Round note', delivery: 'Delivery note', operation: 'Operation note', discharge: 'Discharge card' };
export const SIGNED_BY = { admission: 'a doctor or RMO', round: 'a doctor or RMO', delivery: 'a doctor', operation: 'a doctor', discharge: 'a doctor' };
const DELIVERY_MODE = { normal: 'Normal vaginal delivery', vacuum: 'Vacuum-assisted', forceps: 'Forceps', lscs: 'Caesarean section (LSCS)', other: 'Other' };
const LABOUR_ONSET = { spontaneous: 'Spontaneous', induced: 'Induced', not_in_labour: 'Not in labour (elective)' };
const PERINEUM = { intact: 'Intact', episiotomy: 'Episiotomy', tear_1: '1st-degree tear', tear_2: '2nd-degree tear', tear_3: '3rd-degree tear', tear_4: '4th-degree tear' };
const ANAESTHESIA = { spinal: 'Spinal', epidural: 'Epidural', general: 'General', local: 'Local', other: 'Other' };
const PPH = { yes: 'Yes – heavy bleeding (PPH)', no: 'No' };
export const BABY_SEX = { female: 'Female', male: 'Male', indeterminate: 'Indeterminate' };
export const OUTCOME = { live: 'Live birth', stillbirth: 'Stillbirth' };
export const STILLBIRTH_TYPE = { fresh: 'Fresh (died during labour)', macerated: 'Macerated (died before labour)' };
export const YES_NO = { yes: 'Yes', no: 'No' };
export const BREASTFED = { yes: 'Yes', no: 'No', not_applicable: 'Not applicable' };

export const DOC_FIELDS = {
  admission: [
    { key: 'reason', label: 'Reason for admission', type: 'text', required: true },
    { key: 'history', label: 'History', type: 'area' },
    { key: 'vitals', label: 'Vital signs', type: 'vitals' },
    { key: 'examination', label: 'Examination', type: 'area' },
    { key: 'provisionalDiagnosis', label: 'Provisional diagnosis', type: 'text' },
    { key: 'plan', label: 'Plan and orders', type: 'area' },
  ],
  round: [
    { key: 'at', label: 'Date and time of the round', type: 'datetime', required: true },
    { key: 'complaints', label: 'Complaints', type: 'area' },
    { key: 'vitals', label: 'Vital signs', type: 'vitals' },
    { key: 'examination', label: 'Examination', type: 'area' },
    { key: 'assessment', label: 'Assessment', type: 'area' },
    { key: 'plan', label: 'Plan and orders', type: 'area' },
  ],
  delivery: [
    { key: 'deliveredAt', label: 'Date and time of delivery', type: 'datetime', required: true },
    { key: 'mode', label: 'Mode of delivery', type: 'select', options: DELIVERY_MODE, required: true },
    { key: 'indication', label: 'Indication (assisted or caesarean)', type: 'text' },
    { key: 'gestationWeeks', label: 'Weeks of pregnancy', type: 'number' },
    { key: 'labourOnset', label: 'Onset of labour', type: 'select', options: LABOUR_ONSET },
    { key: 'perineum', label: 'Perineum', type: 'select', options: PERINEUM },
    { key: 'placenta', label: 'Placenta', type: 'text' },
    { key: 'bloodLossMl', label: 'Blood loss (ml)', type: 'number' },
    { key: 'pph', label: 'Heavy bleeding after delivery (PPH)', type: 'select', options: PPH },
    { key: 'babies', label: 'Baby', type: 'babies', required: true },
    { key: 'motherCondition', label: "Mother's condition", type: 'area' },
    { key: 'conductedBy', label: 'Conducted by', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'area' },
  ],
  operation: [
    { key: 'performedAt', label: 'Date and time of the operation', type: 'datetime', required: true },
    { key: 'procedure', label: 'Operation', type: 'text', required: true },
    { key: 'indication', label: 'Indication', type: 'text' },
    { key: 'surgeon', label: 'Surgeon', type: 'text' },
    { key: 'assistant', label: 'Assistant', type: 'text' },
    { key: 'anaesthetist', label: 'Anaesthetist', type: 'text' },
    { key: 'anaesthesia', label: 'Anaesthesia', type: 'select', options: ANAESTHESIA },
    { key: 'findings', label: 'Findings', type: 'area' },
    { key: 'steps', label: 'Procedure details', type: 'area' },
    { key: 'bloodLossMl', label: 'Blood loss (ml)', type: 'number' },
    { key: 'complications', label: 'Complications', type: 'area' },
    { key: 'specimens', label: 'Specimens sent', type: 'text' },
    { key: 'postOpOrders', label: 'Post-operative orders', type: 'area' },
  ],
  discharge: [
    { section: '1. Discharge' },
    { key: 'dischargedAt', label: 'Date and time of discharge', type: 'datetime', required: true },
    { section: '2. Clinical summary' },
    { key: 'finalDiagnosis', label: 'Final diagnosis', type: 'area', required: true },
    { key: 'procedures', label: 'Procedures and operations', type: 'area' },
    { key: 'course', label: 'Course in hospital (treatment given, investigations, important findings)', type: 'area' },
    { key: 'conditionAtDischarge', label: 'Condition at discharge', type: 'area' },
    { section: '3. Medicines on discharge' },
    { key: 'medicines', label: 'Medicines', type: 'medicines' },
    { section: '4. Advice and follow-up' },
    { key: 'advice', label: 'Advice', type: 'area' },
    { key: 'followUpOn', label: 'Follow-up date', type: 'date' },
    { key: 'followUpNote', label: 'Follow-up note', type: 'text' },
  ],
};

// [key, label, unit]
export const VITAL_FIELDS = [
  ['bpSystolic', 'BP upper (systolic)', 'mmHg'],
  ['bpDiastolic', 'BP lower (diastolic)', 'mmHg'],
  ['pulse', 'Pulse', '/min'],
  ['temperatureF', 'Temperature', '°F'],
  ['spo2', 'SpO₂', '%'],
];

export const emptyBaby = () => ({ sex: '', weightGrams: '', apgar1: '', apgar5: '', outcome: '', stillbirthType: '', breastfedWithinHour: '', nicu: '', notes: '' });

export function docLook(d) {
  if (d.status === 'cancelled') return { tone: 'inactive', icon: Ban, word: 'Entered in error' };
  if (d.status === 'signed') return { tone: 'active', icon: CircleCheck, word: 'Signed' };
  return { tone: 'pending', icon: PencilLine, word: 'Draft' };
}
export const stayLook = (s) => (s.status === 'admitted' ? { tone: 'info', icon: BedDouble, word: 'In hospital' } : { tone: 'inactive', icon: DoorOpen, word: 'Discharged' });

// "2026-10-07T09:30" for a datetime-local input, from a date (this computer's clock).
export const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

// A field's value in words (read view and print).
export function valueText(field, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (field.type === 'datetime') return new Date(v).toLocaleString();
  if (field.type === 'select') return field.options[v] ?? v;
  if (field.type === 'vitals') {
    const parts = VITAL_FIELDS.filter(([k]) => v[k] != null && v[k] !== '').map(([k, l]) => `${l} ${v[k]}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(v);
}

/** "BP 120/80 mmHg · Pulse 78 /min · Temperature 98.6 °F · SpO₂ 98 %" (only what was recorded). */
export function vitalsText(v = {}) {
  const parts = [];
  if (v.bpSystolic != null || v.bpDiastolic != null) parts.push(`BP ${v.bpSystolic ?? '–'}/${v.bpDiastolic ?? '–'} mmHg`);
  for (const [k, l, unit] of VITAL_FIELDS) if (!k.startsWith('bp') && v[k] != null) parts.push(`${l} ${v[k]} ${unit}`);
  return parts.join(' · ');
}
