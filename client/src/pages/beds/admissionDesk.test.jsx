// Admission like a hospital system (docs/ADMISSION_DESK_PLAN.md): the admission form, the wristband and the gate pass,
// rendered to HTML from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdmissionForm, GatePass, Wristband, checklistFromPatient } from './AdmissionDesk.jsx';

const text = (html) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const papers = (extra = {}) => ({
  ipdNo: 'IP-2026-000007',
  admittedAt: '2026-10-17T06:00:00Z',
  admissionType: 'planned',
  mlc: true,
  mlcPolice: 'Sample Nagar police station',
  ward: 'General ward',
  bed: 'G1',
  reason: 'Labour',
  admittedByName: 'Sample Reception',
  status: 'admitted',
  dischargedAt: null,
  checklist: { idProof: 'aadhaar', idLast4: '1234', attendantName: 'Sample Husband', attendantRelation: 'Husband', attendantPhone: '98765 11111', payer: 'insurance', payerName: 'Sample Insurance', consentSigned: true, complete: true },
  clearance: null,
  patient: { fullName: 'Sample Mother', mrn: 'P-000099', age: 27, careType: 'antenatal', phone: '98765 00000', address: '1 Sample Road', doctorName: 'Dr Sample' },
  medical: false,
  ...extra,
});

describe('the admission papers', () => {
  it('the form: IPD number with a barcode, ID proof by its last 4 only, payer, attendant, MLC, consent lines', () => {
    const html = renderToStaticMarkup(<AdmissionForm p={papers()} letterhead={{ name: 'Sample Maternity Home' }} />);
    const t = text(html);
    expect(html).toContain('aria-label="Barcode IP-2026-000007"');
    for (const w of ['Admission form', 'IP-2026-000007', 'Aadhaar ending 1234', 'Insurance or TPA – Sample Insurance', 'Sample Husband · Husband · 98765 11111', 'Yes – police: Sample Nagar police station', 'General consent for admission']) expect(t).toContain(w);
  });

  it('the wristband: blood group and allergies only for those who may see them', () => {
    expect(text(renderToStaticMarkup(<Wristband p={papers()} />))).toContain('Blood group and allergies: see the record');
    const nurse = text(renderToStaticMarkup(<Wristband p={papers({ medical: true, patient: { ...papers().patient, bloodGroup: 'B+', allergies: 'Penicillin' } })} />));
    expect(nurse).toContain('Blood group: B+ · Allergies: Penicillin');
  });

  it('the gate pass: its number, who cleared her and what is still due', () => {
    const t = text(renderToStaticMarkup(<GatePass p={papers({ status: 'discharged', dischargedAt: '2026-10-19T06:00:00Z', clearance: { passNo: 'GP-2026-000003', byName: 'Sample Billing', at: '2026-10-19T07:00:00Z', balancePaise: 150000, note: 'Insurance claim pending' } })} letterhead={null} />));
    expect(t).toContain('GP-2026-000003');
    expect(t).toContain('Insurance claim pending');
    expect(t).toContain('Sample Billing');
  });

  it("the checklist starts from her record's details", () => {
    expect(checklistFromPatient({ idProof: { kind: 'pan', last4: '9F2K' }, payer: { type: 'self', name: '' }, emergencyContact: { name: 'Sample Sister', relation: 'Sister', phone: '98765 33333' } })).toMatchObject({ idProof: 'pan', idLast4: '9F2K', payer: 'self', attendantName: 'Sample Sister', consentSigned: false });
  });
});
