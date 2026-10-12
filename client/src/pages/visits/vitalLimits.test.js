import { describe, expect, it } from 'vitest';
import { vitalFlags } from './vitalLimits.js';

const keys = (flags) => flags.map((f) => `${f.key}:${f.level}`);

describe('vitalFlags', () => {
  it('says nothing for usual values or empty boxes', () => {
    expect(vitalFlags({ bpSystolic: '118', bpDiastolic: '76', pulse: '82', temperatureF: '98.6', spo2: '98', hb: '11.5', urineAlbumin: 'nil' }, {}, { pregnant: true })).toEqual([]);
    expect(vitalFlags({ bpSystolic: '', hb: '' }, { fetalHeartRate: '' }, { pregnant: true })).toEqual([]);
  });

  it('raised and severe blood pressure, by either number', () => {
    expect(vitalFlags({ bpSystolic: '142', bpDiastolic: '80' })).toEqual([{ key: 'bp', level: 'high', text: 'BP 142/80 – raised' }]);
    expect(keys(vitalFlags({ bpSystolic: '130', bpDiastolic: '92' }))).toEqual(['bp:high']);
    expect(vitalFlags({ bpSystolic: '165', bpDiastolic: '100' })[0].text).toBe('BP 165/100 – severe range');
    expect(vitalFlags({ bpSystolic: '120', bpDiastolic: '112' })[0].text).toBe('BP 120/112 – severe range');
    expect(vitalFlags({ bpSystolic: '85', bpDiastolic: '50' })[0]).toMatchObject({ level: 'watch', text: 'BP 85/50 – low' });
  });

  it('anaemia (mild only in pregnancy), fever, oxygen, pulse, urine', () => {
    expect(vitalFlags({ hb: '6.5' })[0]).toMatchObject({ level: 'high', text: 'Hb 6.5 – severe anaemia' });
    expect(vitalFlags({ hb: '9' })[0].text).toBe('Hb 9 – moderate anaemia');
    expect(vitalFlags({ hb: '10.5' })).toEqual([]);
    expect(vitalFlags({ hb: '10.5' }, {}, { pregnant: true })[0].text).toBe('Hb 10.5 – mild anaemia');
    expect(keys(vitalFlags({ temperatureF: '100.4', spo2: '93', pulse: '115', urineAlbumin: '2+', urineSugar: '1+' }))).toEqual([
      'pulse:high',
      'temp:high',
      'spo2:watch',
      'albumin:high',
      'sugar:watch',
    ]);
  });

  it('a patient in newborn care: a baby\'s temperature limits, and none of the adult limits', () => {
    const baby = { baby: true };
    expect(vitalFlags({ temperatureF: '98.4', pulse: '140', bpSystolic: '70', bpDiastolic: '40', hb: '16', spo2: '97' }, {}, baby)).toEqual([]);
    expect(vitalFlags({ temperatureF: '97.6' }, {}, baby)).toEqual([{ key: 'temp', level: 'watch', text: 'Temperature 97.6 °F – low for a baby' }]);
    expect(vitalFlags({ temperatureF: '95.8' }, {}, baby)).toEqual([{ key: 'temp', level: 'high', text: 'Temperature 95.8 °F – very low for a baby' }]);
    expect(vitalFlags({ temperatureF: '99.6' }, {}, baby)).toEqual([{ key: 'temp', level: 'high', text: 'Temperature 99.6 °F – high for a baby' }]);
    expect(vitalFlags({ temperatureF: '99.5' }, {}, baby)).toEqual([]);
    expect(keys(vitalFlags({ spo2: '93' }, {}, baby))).toEqual(['spo2:watch']);
    // The same temperature is not a fever by the adult limit
    expect(vitalFlags({ temperatureF: '99.6' })).toEqual([]);
  });

  it('the baby: heart rate outside 110–160, movements reduced or absent – in pregnancy only', () => {
    expect(keys(vitalFlags({}, { fetalHeartRate: '100', fetalMovements: 'reduced' }, { pregnant: true }))).toEqual(['fhr:high', 'movements:high']);
    expect(vitalFlags({}, { fetalHeartRate: '140', fetalMovements: 'present' }, { pregnant: true })).toEqual([]);
    expect(vitalFlags({}, { fetalHeartRate: '100' }, { pregnant: false })).toEqual([]);
  });
});
