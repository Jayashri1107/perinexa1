// Scan reports worked out from the readings (19 Oct 2026, from the other copy's sonography module). DRAFT numbers –
// checked here against published reference points, with a little room for rounding.
import { describe, expect, it } from 'vitest';
import { draftReport, estimatedWeight, weeksFromBiometry, weeksFromCrl, weightCentile, workOut } from './usgCalc.js';

describe('the weeks, weight and centile (Hadlock)', () => {
  it('CRL: 45 mm is about 11 weeks; outside 2–84 mm nothing', () => {
    expect(weeksFromCrl(45)).toBeGreaterThan(11);
    expect(weeksFromCrl(45)).toBeLessThan(11.6);
    expect(weeksFromCrl(1)).toBeNull();
    expect(weeksFromCrl(90)).toBeNull();
  });
  it('biometry of about 21 weeks gives about 21 weeks and about 400 g', () => {
    const b = { bpd: 50, hc: 185, ac: 160, fl: 35 };
    expect(weeksFromBiometry(b)).toBeGreaterThan(20.5);
    expect(weeksFromBiometry(b)).toBeLessThan(22);
    expect(estimatedWeight(b)).toBeGreaterThan(330);
    expect(estimatedWeight(b)).toBeLessThan(480);
    expect(estimatedWeight({ bpd: 50 })).toBeNull();
  });
  it('the mean weight for the weeks is the 50th centile', () => {
    const mean = Math.exp(0.578 + 0.332 * 30 - 0.00354 * 30 ** 2);
    expect(weightCentile(mean, 30)).toBe(50);
    expect(weightCentile(mean * 0.75, 30)).toBeLessThan(10);
  });
});

describe('a scan worked out and written', () => {
  const on = '2026-10-19T05:00:00.000Z';
  it('early pregnancy: the weeks and EDD by CRL go into the form; the report is written', () => {
    const values = { site: 'Intrauterine', number: 'Single', crl: '45', cardiac: 'Present', fhr: '160' };
    const calc = workOut('usg_early', values, { on });
    expect(calc.gaFrom).toBe('CRL');
    expect(calc.fill.ga).toMatch(/^11 weeks \d days? \(by CRL\)$/);
    expect(calc.fill.edd).toMatch(/ 2027$/);
    const { findings, impression } = draftReport('usg_early', values, calc);
    expect(findings).toContain('Intrauterine gestational sac seen. Single pregnancy seen.');
    expect(findings).toContain('Cardiac activity present, fetal heart rate 160 bpm.');
    expect(impression).toMatch(/^Single live intrauterine pregnancy of 11 weeks \d days? by CRL\.$/);
  });
  it('growth scan: weight and its centile by her dates', () => {
    const values = { presentation: 'Cephalic', bpd: '78', hc: '285', ac: '265', fl: '58', placenta: 'Fundal', liquor: 'Adequate', fhr: '140' };
    const calc = workOut('usg_growth', values, { on, eddByDates: '2026-12-21T00:00:00.000Z' });
    expect(calc.efw).toBeGreaterThan(1300);
    expect(calc.fill.efw).toBe(String(calc.efw));
    expect(calc.fill.efwCentile).toMatch(/centile for 31 weeks \d days? by dates$/);
    const { findings } = draftReport('usg_growth', values, calc);
    expect(findings).toContain('Cephalic presentation.');
    expect(findings).toMatch(/Estimated fetal weight \d+ g \(\d+(st|nd|rd|th) centile/);
    expect(findings).toContain('Placenta fundal.');
  });
  it('a gynaecology scan: no weeks; the readings as lines', () => {
    const fields = [{ key: 'uterus', name: 'Uterus (size, position)' }, { key: 'endometrium', name: 'Endometrial thickness', unit: 'mm' }];
    const calc = workOut('usg_pelvis', { endometrium: '8' }, { on });
    expect(calc.ga).toBeNull();
    expect(draftReport('usg_pelvis', { uterus: 'Anteverted, normal size', endometrium: '8' }, calc, fields)).toEqual({ findings: 'Uterus (size, position): Anteverted, normal size.\nEndometrial thickness: 8 mm.', impression: '' });
  });
  it('nothing is ever written about the sex of a fetus', () => {
    const { findings, impression } = draftReport('usg_anomaly', { bpd: '50', hc: '185', ac: '160', fl: '35' }, workOut('usg_anomaly', { bpd: '50', hc: '185', ac: '160', fl: '35' }, { on }));
    expect(`${findings} ${impression}`).not.toMatch(/\b(sex|male|female|boy|girl)\b/i);
  });
});
