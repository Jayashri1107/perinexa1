// The fields of each inpatient document (Version 2), in the order they are written and printed. Server:
// server/src/inpatient/docSchemas.js. type: text | area | datetime | date | number | select | pph | vitals | babies |
// medicines. pph: the doctor's postpartum haemorrhage answer, with what the blood loss suggests (deliveryOutcomes.js).
import { PPH_LABELS } from './deliveryOutcomes.js';
import { ANAESTHESIA_LABELS, DELIVERY_MODE_LABELS, LABOUR_ONSET_LABELS, PERINEUM_LABELS } from './inpatientFormat.js';

export const DOC_FIELDS = {
  admission: [
    { key: 'reason', label: 'Reason for admission', type: 'text', max: 500, required: true },
    { key: 'history', label: 'History', type: 'area' },
    { key: 'vitals', label: 'Vital signs', type: 'vitals' },
    { key: 'examination', label: 'Examination', type: 'area' },
    { key: 'provisionalDiagnosis', label: 'Provisional diagnosis', type: 'text', max: 500 },
    { key: 'plan', label: 'Plan and orders', type: 'area' },
  ],
  round: [
    { key: 'at', label: 'Date and time of the round', type: 'datetime', required: true },
    { key: 'complaints', label: 'Complaints', type: 'area' },
    { key: 'vitals', label: 'Vital signs', type: 'vitals' },
    { key: 'examination', label: 'Examination', type: 'area' },
    { key: 'assessment', label: 'Assessment', type: 'area', max: 1000 },
    { key: 'plan', label: 'Plan and orders', type: 'area' },
  ],
  delivery: [
    { key: 'deliveredAt', label: 'Date and time of delivery', type: 'datetime', required: true },
    { key: 'mode', label: 'Mode of delivery', type: 'select', options: DELIVERY_MODE_LABELS, required: true },
    { key: 'indication', label: 'Indication (assisted or caesarean)', type: 'text', max: 500 },
    { key: 'gestationWeeks', label: 'Weeks of pregnancy', type: 'number', unit: 'weeks' },
    { key: 'labourOnset', label: 'Onset of labour', type: 'select', options: LABOUR_ONSET_LABELS },
    { key: 'perineum', label: 'Perineum', type: 'select', options: PERINEUM_LABELS },
    { key: 'placenta', label: 'Placenta', type: 'text', max: 500 },
    { key: 'bloodLossMl', label: 'Blood loss', type: 'number', unit: 'ml' },
    { key: 'pph', label: 'Heavy bleeding after delivery (postpartum haemorrhage)', type: 'pph', options: PPH_LABELS },
    { key: 'babies', label: 'Baby', type: 'babies', required: true },
    { key: 'motherCondition', label: "Mother's condition", type: 'area', max: 1000 },
    { key: 'conductedBy', label: 'Conducted by', type: 'text', max: 200 },
    { key: 'notes', label: 'Notes', type: 'area' },
  ],
  operation: [
    { key: 'performedAt', label: 'Date and time of the operation', type: 'datetime', required: true },
    { key: 'procedure', label: 'Operation', type: 'text', max: 300, required: true },
    { key: 'indication', label: 'Indication', type: 'text', max: 500 },
    { key: 'surgeon', label: 'Surgeon', type: 'text', max: 150 },
    { key: 'assistant', label: 'Assistant', type: 'text', max: 150 },
    { key: 'anaesthetist', label: 'Anaesthetist', type: 'text', max: 150 },
    { key: 'anaesthesia', label: 'Anaesthesia', type: 'select', options: ANAESTHESIA_LABELS },
    { key: 'findings', label: 'Findings', type: 'area' },
    { key: 'steps', label: 'Procedure details', type: 'area', max: 4000 },
    { key: 'bloodLossMl', label: 'Blood loss', type: 'number', unit: 'ml' },
    { key: 'complications', label: 'Complications', type: 'area', max: 1000 },
    { key: 'specimens', label: 'Specimens sent', type: 'text', max: 500 },
    { key: 'postOpOrders', label: 'Post-operative orders', type: 'area' },
  ],
  discharge: [
    { key: 'dischargedAt', label: 'Date and time of discharge', type: 'datetime', required: true },
    { key: 'finalDiagnosis', label: 'Final diagnosis', type: 'area', max: 1000, required: true },
    { key: 'procedures', label: 'Procedures and operations', type: 'area', max: 1000 },
    { key: 'course', label: 'Course in hospital', type: 'area', max: 4000 },
    { key: 'conditionAtDischarge', label: 'Condition at discharge', type: 'area', max: 1000 },
    { key: 'medicines', label: 'Medicines on discharge', type: 'medicines' },
    { key: 'advice', label: 'Advice', type: 'area' },
    { key: 'followUpOn', label: 'Follow-up date', type: 'date' },
    { key: 'followUpNote', label: 'Follow-up note', type: 'text', max: 200 },
  ],
};

export const VITAL_FIELDS = [
  { key: 'bpSystolic', label: 'BP upper' },
  { key: 'bpDiastolic', label: 'BP lower' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'temperatureF', label: 'Temp (°F)' },
  { key: 'spo2', label: 'SpO2 (%)' },
];

// stillbirthType: fresh or macerated (a stillbirth only); breastfedWithinHour and nicu (admitted to the NICU or SNCU):
// a baby born alive only. '' = not recorded.
export const emptyBaby = () => ({ sex: '', weightGrams: '', apgar1: '', apgar5: '', outcome: '', stillbirthType: '', breastfedWithinHour: '', nicu: '', notes: '' });
