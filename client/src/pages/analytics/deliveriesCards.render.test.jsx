// The Deliveries tab's cards on the screen (rendered to HTML, no browser): what a doctor sees – the caesarean rate,
// the stillbirths, the deaths with their parts indented, links to the patients – and what a hospital admin sees
// ("fewer than 5", no links). Fake sample numbers, shaped as the server sends them.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AnalyticsCard } from './cards/AnalyticsCard.jsx';

const html = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const cell = (key, value, o = {}) => ({
  key,
  code: o.code ?? null,
  label: o.label ?? key,
  sub: o.sub ?? null,
  value,
  unknown: Boolean(o.unknown),
  status: null,
  list: o.list ?? false,
  values: null,
  group: o.group ?? null,
  den: Boolean(o.den),
  partial: null,
  window: null,
  tip: null,
});
const card = (id, title, total, cells, extra = {}) => ({
  id,
  title,
  group: null,
  window: 'period',
  form: 'bars',
  subtitle: '1 Nov 2025 – 15 Oct 2026',
  notes: ['From the delivery notes a doctor confirmed, by the date of delivery.'],
  wholeHospital: false,
  emptyText: 'No stillbirths or deaths were recorded in this period.',
  allMasked: false,
  total,
  cells,
  shares: [],
  trend: null,
  table: null,
  extras: {},
  ...extra,
});
const DOCTOR = { audience: 'doctor', section: 'deliveries', params: { period: '12m', from: '', to: '', scope: 'hospital', careType: 'all' } };
const ADMIN = { audience: 'admin', section: 'deliveries', params: { period: 'last_12m', careType: 'all' } };

const h1 = (v, list) =>
  card(
    'H1',
    'Deliveries and mode of delivery',
    cell('total', v.total, { code: 'c0', label: 'Deliveries', list }),
    [
      cell('normal', v.normal, { code: 'c1', label: 'Normal vaginal', list }),
      cell('vacuum', 0, { code: 'c2', label: 'Vacuum-assisted' }),
      cell('forceps', 0, { code: 'c3', label: 'Forceps' }),
      cell('lscs', v.lscs, { code: 'c4', label: 'Caesarean section', list }),
      cell('other', 0, { code: 'c5', label: 'Other' }),
      cell('noMode', 0, { code: 'c98', label: 'Mode not recorded', unknown: true }),
      cell('known', v.total, { code: 'c99', label: 'Mode recorded', den: true, list }),
      cell('b:m:2026-09', v.sep, { code: 'bm202609', label: 'Sep 2026', group: 'trend' }),
      cell('b:m:2026-10', v.oct, { code: 'bm202610', label: 'Oct 2026', group: 'trend' }),
    ],
    { shares: [{ key: 'lscs', label: 'Caesarean rate', num: 'lscs', den: 'known' }], trend: { cells: ['b:m:2026-09', 'b:m:2026-10'], color: 'bar' } },
  );

describe('Deliveries tab cards', () => {
  it('deliveries: the caesarean rate with its denominator, every mode with "not recorded" last, the total and the months; a doctor can open the patients', () => {
    const out = html(<AnalyticsCard card={h1({ total: 4, normal: 1, lscs: 2, sep: 1, oct: 3 }, true)} ctx={DOCTOR} wide />);
    const words = text(out);
    expect(words).toContain('Deliveries and mode of delivery');
    expect(words).toContain('Caesarean rate');
    expect(words).toContain('2 of 4 · Too few to compare');
    expect(words.indexOf('Caesarean section')).toBeLessThan(words.indexOf('Mode not recorded'));
    expect(out).toContain('href="/analytics/list?metric=H1&cell=c4&back=deliveries"');
    expect(out).toContain('href="/analytics/list?metric=H1&cell=c0&back=deliveries"');
    expect(words).toContain('Show as table');
    expect(out).not.toMatch(/!/);
  });

  it('a hospital admin: small numbers in words, never a link', () => {
    const lt5 = { masked: 'lt5' };
    const out = html(<AnalyticsCard card={h1({ total: lt5, normal: lt5, lscs: 0, sep: lt5, oct: 0 }, false)} ctx={ADMIN} wide />);
    expect(text(out)).toContain('fewer than 5');
    expect(out).not.toContain('/analytics/list');
  });

  it('births: the stillbirths, then fresh or macerated under them', () => {
    const out = html(
      <AnalyticsCard
        card={card('H3', 'Births and stillbirths', cell('total', 5, { code: 'c0', label: 'Babies born', list: true }), [
          cell('live', 4, { code: 'c1', label: 'Live births', list: true }),
          cell('still', 1, { code: 'c2', label: 'Stillbirths', list: true }),
          cell('noOutcome', 0, { code: 'c3', label: 'Live birth or stillbirth not recorded', unknown: true }),
          cell('fresh', 1, { code: 'c4', label: 'Fresh', sub: 'died during labour', group: 'still', list: true }),
          cell('macerated', 0, { code: 'c5', label: 'Macerated', sub: 'died before labour', group: 'still' }),
          cell('stillKindNotRecorded', 0, { code: 'c6', label: 'Fresh or macerated not recorded', group: 'still', unknown: true }),
        ], { shares: [{ key: 'still', label: 'Stillbirths', num: 'still', den: 'total' }] })}
        ctx={DOCTOR}
      />,
    );
    const words = text(out);
    expect(words).toContain('1 of 5 · Too few to compare');
    expect(words).toContain('Of the stillbirths');
    expect(words.indexOf('Of the stillbirths')).toBeLessThan(words.indexOf('Macerated'));
    expect(out).toContain('href="/analytics/list?metric=H3&cell=c4&back=deliveries"');
  });

  it('stillbirths and deaths: one line each, the parts indented, the hints under the lines', () => {
    const deaths = (v) =>
      card('H7', 'Stillbirths and deaths', null, [
        cell('still', v.still, { code: 'c1', label: 'Stillbirths', sub: 'on the confirmed delivery notes', list: v.still > 0 }),
        cell('newborn', v.newborn, { code: 'c2', label: 'Newborn deaths', sub: 'in the first 28 days of life', list: v.newborn > 0 }),
        cell('early', v.early, { code: 'c3', label: 'In the first 7 days', group: 'newborn', list: v.early > 0 }),
        cell('ageUnknown', 0, { code: 'c4', label: "Babies' deaths, age not known", unknown: true }),
        cell('maternal', v.maternal, { code: 'c5', label: 'Maternal deaths', sub: 'during pregnancy or within 42 days after it', list: v.maternal > 0 }),
        cell('m:pregnancy', v.maternal ? 1 : 0, { code: 'c6', label: 'During pregnancy', group: 'maternal', list: v.maternal > 0 }),
        cell('m:delivery', v.maternal ? 1 : 0, { code: 'c7', label: 'During or within 24 hours of delivery', group: 'maternal', list: v.maternal > 0 }),
        cell('m:postpartum', 0, { code: 'c8', label: 'Within 42 days after delivery (or after the pregnancy ended)', group: 'maternal' }),
      ]);
    const out = html(<AnalyticsCard card={deaths({ still: 1, newborn: 1, early: 1, maternal: 2 })} ctx={DOCTOR} />);
    const words = text(out);
    for (const w of ['Stillbirths', 'Babies', 'Newborn deaths', 'in the first 28 days of life', 'In the first 7 days', 'Mothers', 'Maternal deaths', 'During pregnancy']) expect(words).toContain(w);
    expect(words.indexOf('Newborn deaths')).toBeLessThan(words.indexOf('In the first 7 days'));
    expect(words.indexOf('Maternal deaths')).toBeLessThan(words.indexOf('During pregnancy'));
    expect(out.match(/an-fact-indent/g)).toHaveLength(4); // the 7 days, and the three timings
    expect(out).toContain('href="/analytics/list?metric=H7&cell=c5&back=deliveries"');
    expect(out).not.toMatch(/\b(boys?|girls?|males?|females?)\b/i);
    // Nothing recorded: the card says so.
    expect(text(html(<AnalyticsCard card={deaths({ still: 0, newborn: 0, early: 0, maternal: 0 })} ctx={DOCTOR} />))).toContain('No stillbirths or deaths were recorded in this period.');
  });
});
