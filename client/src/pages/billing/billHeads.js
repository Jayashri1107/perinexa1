// The headings of the printed bill (11 Nov 2026), as on the hospital's old IP final bill: Registration, Hospital
// charges, Doctor charges, OT charges, then the rest – each with its own total. A line's heading comes from its key
// (the app's own items) or its name (the built-in items without a key, builtInPrices.js), else from its group.

export const BILL_HEADS = [
  { key: 'registration', label: 'Registration' },
  { key: 'hospital', label: 'Hospital charges' },
  { key: 'doctor', label: 'Doctor charges' },
  { key: 'ot', label: 'OT charges' },
  { key: 'procedure', label: 'Procedure charges' },
  { key: 'lab', label: 'Pathology charges' },
  { key: 'scan', label: 'Scan charges' },
  { key: 'pharmacy', label: 'Pharmacy charges' },
  { key: 'other', label: 'Other charges' },
];

const BY_GROUP = { consultation: 'doctor', inpatient: 'hospital', procedure: 'procedure', lab: 'lab', scan: 'scan', medicine: 'pharmacy', other: 'other' };

/** The heading key of one bill line. */
export function billHeadOf(line) {
  const key = line.key ?? '';
  const name = String(line.name ?? '');
  if (key === 'registration' || /^registration/i.test(name)) return 'registration';
  if (key === 'ipd_round' || key.startsWith('consult_') || /surgeon|an(a)?esthe|doctor visit|consultation/i.test(name)) return 'doctor';
  if (/operation theatre|\bOT\b|labour room/i.test(name)) return 'ot';
  return BY_GROUP[line.group] ?? 'other';
}

/** [{ key, label, lines, amountPaise }] in the printed order; headings with no line are left out. */
export function linesByHead(lines) {
  const map = new Map(BILL_HEADS.map((h) => [h.key, { ...h, lines: [], amountPaise: 0 }]));
  for (const l of lines) {
    const h = map.get(billHeadOf(l));
    h.lines.push(l);
    h.amountPaise += l.amountPaise;
  }
  return [...map.values()].filter((h) => h.lines.length);
}
