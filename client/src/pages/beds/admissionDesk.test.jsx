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
  it("the form in the hospital's layout: details on rules, Aadhaar by its last 4 only, relatives, MLC, then the consent page", () => {
    const html = renderToStaticMarkup(<AdmissionForm p={papers({ patient: { ...papers().patient, sex: 'female' } })} letterhead={{ name: 'Sample Maternity Home' }} />);
    const t = text(html);
    expect(html).toContain('aria-label="Barcode IP-2026-000007"');
    for (const w of ['Admission form', 'UHID', 'P-000099', 'Patient name', 'Age / Gender', '27 Y / Female', 'Marital status', 'IP no', 'IP-2026-000007', 'Bed no & room', 'General ward · G1', 'Aadhaar no', 'XXXX XXXX 1234', 'Insurance or TPA – Sample Insurance', 'Relatives information', 'Relative name', 'Sample Husband', 'Relationship', 'Relative phone no', '98765 11111', 'Is MLC', 'Yes', 'Police station', 'Sample Nagar police station', 'Provisional diagnosis', 'Transfer 1', 'Surgery name', 'Consent for hospital', 'fully informed in my own language', 'Critical Care Unit (CCU)', 'I understand that:', 'For patients with medical insurance:', 'ready to admit myself / our patient in Sample Maternity Home', "Patient's relative's signature"]) expect(t).toContain(w);
    expect(t).not.toContain('DRAFT');
    expect(t).not.toMatch(/\d{4}\s?\d{4}\s?1234/); // never more than the last 4 digits
    // Another ID proof is named, with its last 4 only
    const pan = text(renderToStaticMarkup(<AdmissionForm p={papers({ checklist: { ...papers().checklist, idProof: 'pan', idLast4: '9F2K' } })} letterhead={null} />));
    expect(pan).toContain('ID proof');
    expect(pan).toContain('9F2K');
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
