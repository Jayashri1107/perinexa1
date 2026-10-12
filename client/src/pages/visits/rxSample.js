// A fake visit to show the prescription designs on the design page (never a real patient). The dates fit
// together: LMP 10 Apr 2026 → EDD 15 Jan 2027 → 24 w 3 d on 28 Sep 2026.

export const SAMPLE = {
  patient: { fullName: 'Sample Patient (Demo)', ageText: '28 yrs', mrn: 'P-000000', careType: 'antenatal', allergies: 'None known' },
  visit: {
    visitOn: '2026-09-28T00:00:00.000Z',
    ga: { weeks: 24, days: 3 },
    vitals: { bpSystolic: 112, bpDiastolic: 72, pulse: 84, weightKg: 61, temperatureF: 98.4, spo2: null, hb: 10.8, urineAlbumin: 'nil', urineSugar: 'nil' },
    details: {
      complaints: 'Mild backache. No bleeding or leaking.',
      fundalHeightCm: 24,
      fetalHeartRate: 142,
      presentation: 'variable',
      fetalMovements: 'present',
      oedema: 'none',
      examination: 'General condition good. Mild pallor.',
      diagnosis: 'G2 P1 L1 A0 at 24 weeks with mild anaemia',
      investigations: 'OGTT (75 g), repeat Hb after 4 weeks',
      advice: 'Iron-rich food, rest lying on the left side, drink plenty of water. Come at once for bleeding, leaking of water or reduced movements of the baby.',
      nextVisitOn: '2026-10-26T00:00:00.000Z',
      nextVisitNote: 'with the OGTT report',
    },
    items: [
      { id: 's1', drug: 'Ferrous ascorbate + folic acid', form: 'tab', strength: '100 mg + 1.5 mg', dose: '1', frequency: '1-0-1', frequencyText: '', timing: 'after_food', route: '', durationValue: 30, durationUnit: 'days', instructions: 'Not with milk or tea' },
      { id: 's2', drug: 'Calcium carbonate + vitamin D3', form: 'tab', strength: '500 mg + 250 IU', dose: '1', frequency: '0-1-0', frequencyText: '', timing: 'after_food', route: '', durationValue: null, durationUnit: 'till_delivery', instructions: '' },
      { id: 's3', drug: 'Doxylamine + pyridoxine', form: 'tab', strength: '10 mg + 10 mg', dose: '1', frequency: '0-0-1', frequencyText: '', timing: 'bedtime', route: '', durationValue: 10, durationUnit: 'days', instructions: '' },
      { id: 's4', drug: 'Paracetamol', form: 'tab', strength: '500 mg', dose: '1', frequency: 'sos', frequencyText: '', timing: 'after_food', route: '', durationValue: 3, durationUnit: 'days', instructions: 'For pain – not more than 3 in a day' },
    ],
    notes: 'Take the iron and the calcium at least 2 hours apart.',
  },
  pregnancy: { lmp: '2026-04-10T00:00:00.000Z', edd: '2027-01-15T00:00:00.000Z', eddSource: 'LMP', gpla: 'G2 P1 L1 A0', bloodGroup: 'B+', risk: 'Moderate' },
  nextDue: [
    { text: 'Repeat sugar test (glucose drink test)', when: '24–28 weeks' },
    { text: 'Tdap injection (protects baby from whooping cough)', when: 'from 27 weeks' },
  ],
};
