// Sonography stage 1 (docs/USG_APPS_REVIEW.md U1, U4): the twins calculation and report sentences, and the growth across
// scans (rows, graph, table). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GrowthAcrossScans, growthRows } from './GrowthAcrossScans.jsx';
import { draftReport, isPregnancyStudy, twinDiscordance, weeksByDates, weightBand, workOut } from './usgCalc.js';

const TWINS = { chorionicity: 'Dichorionic diamniotic (DCDA)', bpd1: 85, hc1: 310, ac1: 300, fl1: 65, bpd2: 80, hc2: 295, ac2: 260, fl2: 60, fhr1: 140, fhr2: 145 };
const ON = new Date('2026-11-10T05:30:00Z');
const EDD = '2027-01-05T00:00:00.000Z'; // 32 weeks 0 days on 10 Nov 2026

describe('twins (U4)', () => {
  it('works out each twin’s weight and centile by her dates, and the weight difference', () => {
    expect(isPregnancyStudy('usg_twins')).toBe(true);
    const c = workOut('usg_twins', TWINS, { on: ON, eddByDates: EDD });
    expect(c.datesGa).toMatchObject({ weeks: 32, days: 0 });
    expect(c.twins.map((t) => t.efw)).toEqual([2311, 1658]);
    expect(c.discordance).toBe(28);
    expect(c.fill).toMatchObject({ efw1: '2311', efw2: '1658', discordance: '28 % (twin 1 heavier)' });
    expect(c.ga).toBeNull(); // no dating from twins' biometry
  });
  it('writes the findings for each twin and the impression', () => {
    const c = workOut('usg_twins', TWINS, { on: ON, eddByDates: EDD });
    const r = draftReport('usg_twins', TWINS, c);
    expect(r.findings).toContain('Twin pregnancy, Dichorionic diamniotic (DCDA).');
    expect(r.findings).toContain('Twin 2: fetal heart rate 145 bpm');
    expect(r.findings).toContain('Weight difference between the twins 28 %.');
    expect(r.impression).toBe('Twin live pregnancy, Dichorionic diamniotic (DCDA), 32 weeks 0 days by dates.');
  });
  it('the weight difference needs both weights', () => {
    expect(twinDiscordance(2000, null)).toBeNull();
    expect(twinDiscordance(2000, 2000)).toBe(0);
  });
});

describe('growth across scans (U1)', () => {
  const growth = [
    { id: 'a', study: 'usg_anomaly', on: '2026-08-11T05:30:00Z', current: false, values: { bpd: 48, hc: 178, ac: 155, fl: 33, efw: 380 } },
    { id: 'b', study: 'usg_twins', on: '2026-11-10T05:30:00Z', current: true, values: { bpd1: 85, hc1: 310, ac1: 300, fl1: 65, bpd2: 80, hc2: 295, ac2: 260, fl2: 60 } },
  ];
  it('has a row per scan and per twin, with the weeks by her dates and the weight centile', () => {
    const rows = growthRows(growth, EDD);
    expect(rows.map((r) => [r.id, r.twin, r.efw])).toEqual([
      ['a', null, 380],
      ['b1', 1, 2311],
      ['b2', 2, 1658],
    ]);
    expect(Math.round(rows[0].weeks)).toBe(19);
    expect(rows[1].centile).toBe(93);
  });
  it('draws the three Hadlock lines and the points, and lists the measurements', () => {
    const html = renderToStaticMarkup(<GrowthAcrossScans growth={growth} eddByDates={EDD} />);
    expect(html).toContain('Growth across scans');
    expect((html.match(/<polyline/g) ?? []).length).toBe(3);
    expect((html.match(/<circle/g) ?? []).length).toBe(2); // the single scan and twin 1
    expect((html.match(/<rect/g) ?? []).length).toBe(1); // twin 2
    expect(html).toContain('weight difference on this scan 28 %');
    expect(html).toContain('DRAFT');
  });
  it('without an EDD there is no graph, only the table', () => {
    const html = renderToStaticMarkup(<GrowthAcrossScans growth={growth} eddByDates={null} />);
    expect(html).not.toContain('<svg');
    expect(html).toContain('need her dates');
  });
  it('the lines are the app’s own Hadlock 1991 weight curve', () => {
    const b = weightBand(32);
    expect(Math.round(b.p50)).toBe(1953);
    expect(b.p10).toBeLessThan(b.p50);
    expect(b.p90).toBeGreaterThan(b.p50);
    expect(weeksByDates(EDD, ON)).toBe(32);
  });
});
