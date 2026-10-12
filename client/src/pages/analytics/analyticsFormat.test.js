import { describe, expect, it } from 'vitest';
import { nextColumn } from '../../components/charts/ColumnChart.jsx';
import { niceTicks } from '../../components/charts/niceTicks.js';
import { formatMonth } from '../../components/ui.jsx';
import { SECTIONS, SECTION_LABELS, TOO_FEW_TEXT, analyticsParams, analyticsSearch, analyticsTabs, cardNotes, cardWidths, formatCount, isLeftOutCard, isReportMonth, listDetailText, listHref, monthWords, notInThisVersion, perHospitalText, ratioText, shareText, tileWords } from './analyticsFormat.js';

describe('formatCount', () => {
  it('shows exact numbers with Indian grouping and masked values in words', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(123456)).toBe('1,23,456');
    expect(formatCount({ masked: 'lt5' })).toBe('fewer than 5');
    expect(formatCount({ masked: 'hidden' })).toBe('Not shown');
    expect(formatCount({ masked: 'withheld' })).toBe('Not shown');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
  });
});

describe('shareText', () => {
  it('gives a percentage only from a denominator of 20 or more', () => {
    expect(shareText(12, 19)).toBe('12 of 19 · Too few to compare');
    expect(shareText(12, 20)).toBe('12 of 20 · 60%');
    expect(shareText(34, 40)).toBe('34 of 40 · 85%');
  });
  it('never gives a percentage when a side is masked, and takes its words from formatCount', () => {
    expect(shareText({ masked: 'lt5' }, 40)).toBe('fewer than 5 of 40');
    expect(shareText({ masked: 'hidden' }, 40)).toBe('Not shown of 40');
    expect(shareText({ masked: 'withheld' }, 40)).toBe('Not shown of 40');
    expect(shareText(30, { masked: 'hidden' })).toBe('30 of Not shown');
    for (const t of [shareText({ masked: 'hidden' }, 40), shareText({ masked: 'withheld' }, 40)]) expect(t).not.toMatch(/fewer|%/);
  });
  it('reads "None yet" for 0 of 0, and 0 of a number as a share', () => {
    expect(shareText(0, 0)).toBe('None yet');
    expect(shareText(0, 25)).toBe('0 of 25 · 0%');
    expect(shareText(0, 3)).toBe('0 of 3 · Too few to compare');
    expect(shareText(null, 3)).toBe('—');
  });
});

describe('ratioText and formatMonth', () => {
  it('writes the ratio in words and a dash when there is none', () => {
    expect(ratioText(1000)).toBe('1,000 girls per 1,000 boys');
    expect(ratioText(947)).toBe('947 girls per 1,000 boys');
    expect(ratioText(null)).toBe('—');
  });
  it('writes months as "Oct 2026"', () => {
    expect(formatMonth('2026-10')).toBe('Oct 2026');
    expect(formatMonth('m:2025-11')).toBe('Nov 2025');
    expect(formatMonth('2026-10-15')).toBe('Oct 2026');
    expect(formatMonth('2026-13')).toBe('—');
    expect(formatMonth(null)).toBe('—');
  });
});

describe('listDetailText', () => {
  it('has words for every detail type', () => {
    expect(listDetailText({ type: 'ga', weeks: 38, days: 4 })).toBe('38 w 4 d');
    expect(listDetailText({ type: 'booked', weeks: 10, days: 2, on: '2026-10-12' })).toBe('Booked at 10 w 2 d on 12 Oct 2026');
    expect(listDetailText({ type: 'booked', weeks: null, days: null, on: '2026-10-12' })).toBe('Booked on 12 Oct 2026, gestation not known');
    expect(listDetailText({ type: 'edd', on: '2026-10-25' })).toBe('EDD 25 Oct 2026');
    expect(listDetailText({ type: 'hb', value: 8.9, on: '2026-10-12' })).toBe('Hb 8.9 g/dL on 12 Oct 2026');
    expect(listDetailText({ type: 'hb', value: 11, on: '2026-10-12' })).toBe('Hb 11.0 g/dL on 12 Oct 2026');
    expect(listDetailText({ type: 'bp', sys: 164, dia: 112, on: '2026-09-25' })).toBe('BP 164/112 on 25 Sep 2026');
    expect(listDetailText({ type: 'grams', value: 2100 })).toBe('2,100 g');
    expect(listDetailText({ type: 'lastVisit', on: '2026-09-25' })).toBe('Last visit 25 Sep 2026');
    expect(listDetailText({ type: 'items', count: 3 })).toBe('3 items');
    expect(listDetailText({ type: 'items', count: 1 })).toBe('1 item');
    expect(listDetailText(null)).toBe('—');
    // Deliveries tab: a row per delivery or baby, and the deaths
    expect(listDetailText({ type: 'delivery', on: '2026-10-14', mode: 'lscs' })).toBe('Delivered 14 Oct 2026 · Caesarean section (LSCS)');
    expect(listDetailText({ type: 'delivery', on: '2026-10-14', mode: null })).toBe('Delivered 14 Oct 2026');
    expect(listDetailText({ type: 'birth', on: '2026-10-14', baby: 1, of: 1 })).toBe('Born 14 Oct 2026');
    expect(listDetailText({ type: 'birth', on: '2026-10-14', baby: 2, of: 2 })).toBe('Born 14 Oct 2026 · baby 2 of 2');
    expect(listDetailText({ type: 'birth', on: '2026-09-03', baby: 1, of: 1, apgar5: 6 })).toBe('Born 3 Sep 2026 · Apgar 6 at 5 minutes');
    expect(listDetailText({ type: 'birth', on: '2026-09-03', baby: 1, of: 2, apgar5: 0 })).toBe('Born 3 Sep 2026 · baby 1 of 2 · Apgar 0 at 5 minutes');
    expect(listDetailText({ type: 'birth', on: '2026-09-03', baby: 1, of: 1, apgar5: null })).toBe('Born 3 Sep 2026 · Apgar not recorded');
    expect(listDetailText({ type: 'death', on: '2026-09-15' })).toBe('Died 15 Sep 2026');
  });
});

describe('analyticsSearch', () => {
  it("drops each audience's defaults", () => {
    expect(analyticsSearch({ period: '12m', from: '', to: '', scope: 'hospital', careType: 'all' }, 'doctor')).toBe('');
    expect(analyticsSearch({ period: '3m', scope: 'mine', careType: 'all' }, 'doctor')).toBe('?period=3m&scope=mine');
    expect(analyticsSearch({ period: 'last_12m', careType: 'all' }, 'admin')).toBe('');
    expect(analyticsSearch({ period: 'last_3m', careType: 'antenatal' }, 'admin')).toBe('?period=last_3m&careType=antenatal');
    expect(analyticsSearch({ hospital: 'all', period: 'last_12m', careType: 'all' }, 'platform')).toBe('');
    expect(analyticsSearch({ hospital: 'abc', period: 'custom_months', from: '2026-01', to: '2026-06' }, 'platform')).toBe(
      '?hospital=abc&period=custom_months&from=2026-01&to=2026-06',
    );
  });
  it('sends dates only with a custom period, and nothing an audience cannot choose', () => {
    expect(analyticsSearch({ period: '6m', from: '2026-01-01', to: '2026-02-01' }, 'doctor')).toBe('?period=6m');
    expect(analyticsSearch({ period: 'custom', from: '2026-01-01', to: '2026-02-01' }, 'doctor')).toBe('?period=custom&from=2026-01-01&to=2026-02-01');
    expect(analyticsSearch({ period: 'last_3m', scope: 'mine', hospital: 'x' }, 'admin')).toBe('?period=last_3m');
  });
  it('keeps the filters on every tab', () => {
    expect(analyticsTabs('/analytics', '?period=3m').map((t) => t.to)).toEqual([
      '/analytics?period=3m',
      '/analytics/pregnancy?period=3m',
      '/analytics/risk?period=3m',
      '/analytics/care?period=3m',
      '/analytics/deliveries?period=3m',
      '/analytics/newborn?period=3m',
    ]);
    expect(analyticsTabs('/analytics').map((t) => t.label)).toEqual(['Overview', 'Pregnancy', 'Risk & conditions', 'Care plans & visits', 'Deliveries', 'Newborn']);
  });
  it('the Monthly report tab (doctors) comes right before Ask your records, and only when asked for', () => {
    const labels = (opts) => analyticsTabs('/analytics', '?period=3m', opts).map((t) => t.label);
    expect(labels({ ask: true, report: true }).slice(-2)).toEqual(['Monthly report', 'Ask your records']);
    expect(analyticsTabs('/analytics', '?period=3m', { report: true }).at(-1)).toEqual({ label: 'Monthly report', to: '/analytics/report', end: true });
    expect(labels({ ask: true })).not.toContain('Monthly report');
    expect(labels()).not.toContain('Monthly report');
    expect(labels().join(' ')).not.toMatch(/Register|MTP|Form F/);
  });
});

describe('monthWords', () => {
  it('names the month', () => {
    expect(monthWords('2026-10')).toBe('October 2026');
    expect(monthWords('2027-01')).toBe('January 2027');
  });
});

describe('isReportMonth', () => {
  it('accepts a real month only, like the server', () => {
    expect(isReportMonth('2026-10')).toBe(true);
    expect(isReportMonth('2026-01')).toBe(true);
    expect(isReportMonth('2026-12')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', 'October', '', null, undefined]) expect(isReportMonth(bad)).toBe(false);
  });
});

describe('listHref', () => {
  it('carries only codes and filters, never label text', () => {
    const href = listHref({ metric: 'D1', cell: 'c9', section: 'risk', params: { period: '3m', from: '', to: '', scope: 'mine', careType: 'all' } });
    expect(href).toBe('/analytics/list?metric=D1&cell=c9&back=risk&period=3m&scope=mine');
    const keys = [...new URL(href, 'http://x').searchParams.keys()];
    expect(keys.every((k) => ['metric', 'cell', 'back', 'period', 'from', 'to', 'scope', 'careType'].includes(k))).toBe(true);
    expect(href).not.toMatch(/hiv|trimester|condition|risk=|high/i);
    expect(listHref({ metric: 'A2', cell: 'c3', section: 'pregnancy', params: {} })).toBe('/analytics/list?metric=A2&cell=c3&back=pregnancy');
  });
});

describe('niceTicks', () => {
  it('gives 3 to 5 round ticks from 0', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(20)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe('analyticsParams', () => {
  it("replaces a period from another kind of user with this user's default", () => {
    expect(analyticsParams({ period: '3m', careType: 'all' }, 'admin').period).toBe('last_12m');
    expect(analyticsParams({ period: 'custom', from: '2026-01-01', to: '2026-02-01', careType: 'all' }, 'admin').period).toBe('last_12m');
    const doc = analyticsParams({ period: 'last_3m', from: '2026-01-01', to: '2026-02-01', scope: 'hospital', careType: 'all' }, 'doctor');
    expect(doc).toEqual({ period: '12m', from: '', to: '', scope: 'hospital', careType: 'all' });
    expect(analyticsParams({ hospital: 'all', period: '6m', from: '', to: '', careType: 'all' }, 'platform').period).toBe('last_12m');
  });
  it('leaves a period this user can choose as it is, with its dates', () => {
    const custom = { period: 'custom', from: 'x', to: 'y' };
    expect(analyticsParams(custom, 'doctor')).toBe(custom);
    const admin = { period: 'last_3m', careType: 'all' };
    expect(analyticsParams(admin, 'admin')).toBe(admin);
  });
  it('sends the default, and keeps it out of the tabs, once the period is replaced', () => {
    const params = analyticsParams({ period: '3m', careType: 'all' }, 'admin');
    expect(analyticsSearch(params, 'admin')).toBe('');
  });
});

describe('cardWidths', () => {
  const WIDE = new Set(['A1', 'A3', 'C4', 'E4', 'V1']);
  const widths = (ids) => cardWidths(ids.map((id) => ({ id })), WIDE);
  it('keeps full-width cards full width and pairs half-width cards', () => {
    expect(widths(['D1', 'D3', 'D4', 'D6'])).toEqual([false, false, false, false]);
    expect(widths(['A1', 'V1'])).toEqual([true, true]);
  });
  it('widens a half-width card that would sit alone before a full-width card or at the end', () => {
    // Pregnancy: [A2] [A3] [D9 D10] [B1]
    expect(widths(['A2', 'A3', 'D9', 'D10', 'B1'])).toEqual([true, true, false, false, true]);
    // Risk for doctors: [C1 C2] [C9] [C4] [D1 D3] [D4 D6]
    expect(widths(['C1', 'C2', 'C9', 'C4', 'D1', 'D3', 'D4', 'D6'])).toEqual([false, false, true, true, false, false, false, false]);
    // Risk for hospital admins (C2 and C9 hidden): [C1] [C4] [D1 D3] [D4 D6]
    expect(widths(['C1', 'C4', 'D1', 'D3', 'D4', 'D6'])).toEqual([true, true, false, false, false, false]);
    // Care: [E1] [E4] [B4]
    expect(widths(['E1', 'E4', 'B4'])).toEqual([true, true, true]);
    expect(widths([])).toEqual([]);
  });
});

describe('nextColumn (column chart keys)', () => {
  it('moves one column with the arrows and to the ends with Home and End, never past them', () => {
    expect(nextColumn('ArrowRight', 3, 12)).toBe(4);
    expect(nextColumn('ArrowLeft', 3, 12)).toBe(2);
    expect(nextColumn('ArrowRight', 11, 12)).toBe(11);
    expect(nextColumn('ArrowLeft', 0, 12)).toBe(0);
    expect(nextColumn('Home', 7, 12)).toBe(0);
    expect(nextColumn('End', 2, 12)).toBe(11);
  });
  it('ignores other keys and empty charts', () => {
    expect(nextColumn('Tab', 3, 12)).toBeNull();
    expect(nextColumn('Enter', 3, 12)).toBeNull();
    expect(nextColumn('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('the small-hospital switch (super admin)', () => {
  const note = 'Information missing is never counted as low risk.';
  it('a card is "too few" only when every hospital picked is left out', () => {
    expect(isLeftOutCard({ tooFew: null })).toBe(false);
    expect(isLeftOutCard({})).toBe(false);
    expect(isLeftOutCard({ tooFew: [] })).toBe(false);
    expect(isLeftOutCard({ tooFew: [false, true] })).toBe(false);
    expect(isLeftOutCard({ tooFew: [true] })).toBe(true);
    expect(isLeftOutCard({ tooFew: [true, true] })).toBe(true);
  });
  it('the notes do not repeat "Too few patients…" under a card that already says it', () => {
    expect(TOO_FEW_TEXT).toBe('Too few patients in this hospital to show');
    expect(cardNotes({ tooFew: [true], notes: [note, `${TOO_FEW_TEXT}.`] })).toEqual([note]);
    const named = `${TOO_FEW_TEXT}: Sample Hospital Two. Left out of the numbers for all hospitals.`;
    expect(cardNotes({ tooFew: [false, true], notes: [note, named] })).toEqual([note, named]);
    expect(cardNotes({ tooFew: [true, true], notes: [note, named] })).toEqual([note, named]);
    expect(cardNotes({ tooFew: null, notes: [note] })).toEqual([note]);
    expect(cardNotes({ tooFew: null })).toEqual([]);
  });
});

describe('the small-hospital switch on tiles and "by hospital" rows', () => {
  const note = 'Too few patients in this hospital to show: Sample Hospital Two. Left out of the numbers for all hospitals.';
  it('a tile keeps its time window and adds the note naming the hospitals left out', () => {
    expect(tileWords({ window: 'now', value: 9, tooFew: [false, true], note })).toEqual({ sub: `As of today · ${note}`, tooFew: false });
    expect(tileWords({ window: 'period', value: 9, sub: 'of 12', tooFew: [false, true], note })).toEqual({ sub: `In the period · of 12 · ${note}`, tooFew: false });
    // Every hospital left out: no number, the window stays.
    expect(tileWords({ window: 'now', value: null, tooFew: [true], note: `${TOO_FEW_TEXT}.` })).toEqual({ sub: 'As of today', tooFew: true });
    // Switch off: as before.
    expect(tileWords({ window: 'now', value: 3, tooFew: null, note: null })).toEqual({ sub: 'As of today', tooFew: false });
    expect(tileWords({ window: 'period', value: 3, sub: 'of 12' })).toEqual({ sub: 'In the period · of 12', tooFew: false });
  });
  it('a hospital left out reads "Too few patients…" on count rows and on the ratio and median rows', () => {
    const tooFew = [false, true];
    expect(perHospitalText(4, 0, tooFew)).toBe('4');
    expect(perHospitalText(null, 1, tooFew)).toBe(TOO_FEW_TEXT);
    const grams = (v) => (typeof v === 'number' ? `${v} g` : '—');
    expect(perHospitalText(3000, 0, tooFew, grams)).toBe('3000 g');
    expect(perHospitalText(null, 1, tooFew, grams)).toBe(TOO_FEW_TEXT);
    // A hospital that is counted but has no median (fewer than 5 weighed) keeps the dash.
    expect(perHospitalText(null, 0, tooFew, grams)).toBe('—');
    expect(perHospitalText(null, 1, null, grams)).toBe('—');
  });
});

describe('the Deliveries tab', () => {
  it('is a tab of its own, before Newborn, with a label', () => {
    expect(SECTIONS).toEqual(['overview', 'pregnancy', 'risk', 'care', 'deliveries', 'newborn']);
    for (const s of SECTIONS) expect(SECTION_LABELS[s], s).toBeTruthy();
    expect(SECTION_LABELS.deliveries).toBe('Deliveries');
  });

  it('"Not in this version" no longer lists what the Deliveries tab counts, and points to it', () => {
    for (const audience of ['doctor', 'admin', 'platform']) {
      const [notYet, planned, where] = notInThisVersion(audience);
      expect(`${notYet} ${planned}`, audience).not.toMatch(/caesarean|mode of delivery|stillbirth|death|Apgar|NICU|SNCU|breastfeeding|delivery outcomes/i);
      expect(where, audience).toMatch(/Deliveries tab/);
      expect(notInThisVersion(audience).join(' '), audience).not.toMatch(/!/);
    }
    expect(notInThisVersion('admin')[2]).toMatch(/only for doctors/);
    expect(notInThisVersion('doctor')[2]).toMatch(/caesarean rate.*stillbirths.*newborn and maternal deaths/);
  });
});
