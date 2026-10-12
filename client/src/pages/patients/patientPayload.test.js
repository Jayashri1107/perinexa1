import { describe, expect, it } from 'vitest';
import { toPayload } from './PatientForm.jsx';

// What Edit details sends when it is saved. Fake data only.
describe('Edit details: the breastfeeding answer is sent only when it was changed on this form', () => {
  const values = (breastfeeding, notes = '') => ({
    careType: 'postnatal',
    fullName: 'Sample Mother',
    phone: '',
    address: '',
    ageYears: '28',
    obstetric: { gravida: '2', para: '1' },
    medical: { allergies: 'None known' },
    notes,
    delivery: { on: '', mode: '', locked: false },
    postnatal: { breastfeeding },
  });
  const access = { canEditIdentity: true, canEditClinical: true };

  it('a form left open with an older answer does not put it back over a newer one', () => {
    // Opened with "No"; meanwhile someone recorded "Yes"; this form is saved for a note only
    const stale = toPayload(values('no', 'Seen today.'), true, access, undefined, values('no'));
    expect(stale.notes).toBe('Seen today.');
    expect(stale).not.toHaveProperty('postnatal');
    // Changed here: sent – also when it is cleared
    expect(toPayload(values('yes'), true, access, undefined, values('no')).postnatal).toEqual({ breastfeeding: 'yes' });
    expect(toPayload(values(''), true, access, undefined, values('yes')).postnatal).toEqual({ breastfeeding: '' });
    expect(toPayload(values('yes'), true, access, undefined, values('')).postnatal).toEqual({ breastfeeding: 'yes' });
    // Someone who may not edit clinical details never sends it
    expect(toPayload(values('yes'), true, { canEditIdentity: true, canEditClinical: false }, undefined, values(''))).not.toHaveProperty('postnatal');
  });
});

describe("Edit details of a baby: the care after birth (NICU or SNCU stay, feeding at discharge)", () => {
  const values = (care = {}) => ({
    careType: 'newborn',
    fullName: 'Baby Sample',
    phone: '',
    address: '',
    ageYears: '',
    newborn: { birthAt: '2026-10-01T08:30', birthWeightGrams: '2900', sex: 'female', mother: '' },
    medical: { bloodGroup: '' },
    notes: '',
    delivery: { on: '', mode: '', locked: false },
    postnatal: { breastfeeding: '' },
    newbornCare: { admitted: '', from: '', to: '', feedingAtDischarge: '', ...care },
  });
  const doctor = { canEditIdentity: true, canEditNewborn: true, canEditClinical: true };

  it('is sent only when changed here, with the dates of a stay only for "admitted: yes"', () => {
    expect(toPayload(values(), true, doctor, undefined, values())).not.toHaveProperty('newbornCare');
    expect(toPayload(values({ admitted: 'yes', from: '2026-10-02' }), true, doctor, undefined, values()).newbornCare).toEqual({
      nicu: { admitted: 'yes', from: '2026-10-02', to: null },
      feedingAtDischarge: '',
    });
    // "No" drops dates typed before; feeding at discharge alone
    expect(toPayload(values({ admitted: 'no', from: '2026-10-02', to: '2026-10-04' }), true, doctor, undefined, values({ admitted: 'yes', from: '2026-10-02' })).newbornCare.nicu).toEqual({ admitted: 'no', from: null, to: null });
    expect(toPayload(values({ feedingAtDischarge: 'exclusive' }), true, doctor, undefined, values()).newbornCare).toEqual({ nicu: { admitted: '', from: null, to: null }, feedingAtDischarge: 'exclusive' });
    // Reception (birth details only) never sends it; nor does registration
    expect(toPayload(values({ feedingAtDischarge: 'none' }), true, { canEditIdentity: true, canEditNewborn: true, canEditClinical: false }, undefined, values())).not.toHaveProperty('newbornCare');
    expect(toPayload(values({ feedingAtDischarge: 'none' }), false, doctor, undefined, values())).not.toHaveProperty('newbornCare');
  });
});
