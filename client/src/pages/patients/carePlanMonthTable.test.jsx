// The patient copy of the care plan as a month-by-month table (10 Nov 2026, docs/PLAN_TABLE_LAYOUT.md) – which item
// goes in which month and column, "Only from today's visit", and the page as printed. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PatientCopy } from './CarePlanPrint.jsx';
import {
  PREGNANCY_MONTHS,
  TABLE_LABELS,
  addKindForColumn,
  addWeeksForRow,
  canPrintMonthTable,
  itemMonth,
  monthOfWeek,
  monthTable,
  monthWeeks,
  tableHasContent,
  tableLineDate,
  tableUntranslatedCount,
} from './carePlanPrintFormat.js';

// EDD 1 Mar 2027 → day zero (LMP) 25 May 2026; on 5 Oct 2026 she is 19 w 0 d (month 5); booked at 10 w (month 3).
const day = (s) => `${s}T00:00:00.000Z`;
const item = (id, kind, status, extra = {}) => ({
  id,
  kind,
  status,
  name: `${kind} ${id}`,
  patientText: '',
  origin: 'custom',
  key: id,
  due: { from: day('2026-10-12'), to: day('2026-10-26') },
  gaWindow: { from: { weeks: 20, days: 0 }, to: { weeks: 22, days: 0 } },
  done: null,
  notNeeded: null,
  ...extra,
});
const ga = (from, to = from) => ({ from: { weeks: from, days: 0 }, to: { weeks: to, days: 0 } });
const doneOn = (on) => ({ on: day(on), elsewhere: false, result: '', note: '', byName: 'Dr A' });

const ITEMS = [
  item('visit20', 'visit', 'upcoming', { patientText: 'Check-up at about 20 weeks' }),
  item('scanAnomaly', 'scan', 'upcoming', { gaWindow: ga(18, 22), patientText: 'Detailed ultrasound of baby' }),
  item('labGtt', 'investigation', 'upcoming', { gaWindow: ga(24, 28), due: { from: day('2026-11-09'), to: day('2026-12-13') } }),
  item('td2', 'vaccination', 'waiting', { gaWindow: null, due: null, estimateFrom: day('2026-11-30') }), // 26 w → month 6
  item('iron', 'medication', 'due', { gaWindow: ga(14, 40) }), // started in month 4, still to come → this month
  item('visit16', 'visit', 'overdue', { gaWindow: ga(16), due: { from: day('2026-09-14'), to: day('2026-09-20') } }),
  item('scanNt', 'scan', 'done', { gaWindow: ga(11, 13), done: doneOn('2026-08-14') }),
  item('labCbc', 'investigation', 'not_needed', { gaWindow: ga(28), notNeeded: { reasonCode: 'declined', reason: '', byName: 'Dr A' } }),
  item('labNa', 'investigation', 'not_applicable', { gaWindow: ga(28) }),
  item('advMove', 'advice', 'upcoming', { gaWindow: ga(28, 40), patientText: 'Count your baby’s movements every day' }),
];
const PLAN = {
  careType: 'antenatal',
  status: 'active',
  today: day('2026-10-05'),
  edd: day('2027-03-01'),
  dayZero: day('2026-05-25'),
  gestationToday: { weeks: 19, days: 0 },
  bookedAt: { weeks: 10, days: 0 },
  next: null,
  canChangePlan: true,
  items: ITEMS,
};
const ids = (list) => list.map((it) => it.id);
const row = (rows, month) => rows.find((r) => r.month === month);

describe('the months of pregnancy', () => {
  it('follow the owner’s sample sheet: nine months, weeks 0 to 42 without a gap', () => {
    expect(PREGNANCY_MONTHS.map(([m]) => m)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let i = 1; i < PREGNANCY_MONTHS.length; i += 1) expect(PREGNANCY_MONTHS[i][1]).toBe(PREGNANCY_MONTHS[i - 1][2] + 1);
    expect([monthOfWeek(0), monthOfWeek(4), monthOfWeek(5), monthOfWeek(13), monthOfWeek(14), monthOfWeek(35), monthOfWeek(36), monthOfWeek(41)]).toEqual([1, 1, 2, 3, 4, 8, 9, 9]);
    expect(monthOfWeek(-1)).toBe(1);
    expect(monthOfWeek(undefined)).toBeNull();
  });

  it('an item goes in the month its window starts in, else by its estimated date', () => {
    expect(itemMonth(ITEMS[1], PLAN)).toBe(5);
    expect(itemMonth(ITEMS[3], PLAN)).toBe(6);
    expect(itemMonth(item('x', 'scan', 'upcoming', { gaWindow: null, due: null }), PLAN)).toBeNull();
  });

  it('prints month 9 as 36–40 wk, and Marathi with Devanagari digits as on the sample', () => {
    expect(monthWeeks({ month: 9, fromWeek: 36, toWeek: 42 })).toBe('36–40 wk');
    expect(monthWeeks({ month: 5, fromWeek: 18, toWeek: 22 }, 'mr')).toBe('१८–२२ आठवडे');
  });
});

describe('who gets the table', () => {
  it('pregnancy plans only – not after a delivery, for a baby, or in pregnancy-loss care', () => {
    expect(canPrintMonthTable(PLAN)).toBe(true);
    for (const careType of ['postnatal', 'newborn', 'gynaecology', 'infertility', 'abortion']) expect(canPrintMonthTable({ ...PLAN, careType })).toBe(false);
    expect(canPrintMonthTable({ ...PLAN, dayZero: null })).toBe(false);
  });
});

describe('Only from today’s visit (ticked to start with)', () => {
  const rows = monthTable(PLAN);

  it('starts at this month', () => {
    expect(rows.map((r) => r.month)).toEqual([5, 6, 7, 8, 9]);
    expect(row(rows, 5).current).toBe(true);
  });

  it('puts each item in its month and its column', () => {
    expect(ids(row(rows, 5).cells.visit)).toEqual(['visit20']);
    expect(ids(row(rows, 5).cells.scan)).toEqual(['scanAnomaly']);
    expect(ids(row(rows, 6).cells.test)).toEqual(['labGtt']);
    expect(ids(row(rows, 6).cells.medicine)).toEqual(['td2']);
    expect(ids(row(rows, 7).cells.advice)).toEqual(['advMove']);
  });

  it('puts what is overdue, or still to come from a month that has passed, under Today in this month – in its own column', () => {
    expect(ids(row(rows, 5).today.visit)).toEqual(['visit16']);
    expect(ids(row(rows, 5).today.medicine)).toEqual(['iron']);
    expect(ids(row(rows, 5).cells.medicine)).toEqual([]);
    expect(Object.values(row(rows, 6).today).flat()).toEqual([]); // Today only in this month
  });

  it('leaves out what is done, not needed or does not apply', () => {
    const all = rows.flatMap((r) => [...Object.values(r.today).flat(), ...Object.values(r.cells).flat()]);
    expect(ids(all)).not.toContain('scanNt');
    expect(ids(all)).not.toContain('labCbc');
    expect(ids(all)).not.toContain('labNa');
  });

  it('keeps the Print dialog’s choice of types or items', () => {
    const scans = monthTable(PLAN, { scope: 'kinds', kinds: ['scan'] });
    expect(ids(scans.flatMap((r) => Object.values(r.cells).flat()))).toEqual(['scanAnomaly']);
    expect(tableHasContent(monthTable(PLAN, { scope: 'items', ids: ['nothing'] }))).toBe(false);
  });
});

describe('all nine months (Only from today’s visit unticked)', () => {
  const rows = monthTable(PLAN, { fromToday: false });

  it('has every month, the months before registration marked', () => {
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.beforeRegistration).map((r) => r.month)).toEqual([1, 2]);
  });

  it('lists done items too, in their month', () => {
    expect(ids(row(rows, 3).cells.scan)).toEqual(['scanNt']);
    expect(tableLineDate(ITEMS[6])).toBe('14 Aug');
    expect(tableLineDate(ITEMS[1])).toBe('12 Oct');
  });

  it('still never prints an item that is not needed or does not apply', () => {
    expect(ids(row(rows, 7).cells.test)).toEqual([]);
  });
});

describe('a line added from the table', () => {
  it('starts with the column’s type and the row’s weeks – not before today in this month', () => {
    const rows = monthTable(PLAN);
    expect(addKindForColumn('medicine')).toBe('vaccination');
    expect(addKindForColumn('test')).toBe('investigation');
    expect(addWeeksForRow(row(rows, 5), PLAN)).toEqual({ fromWeek: 19, toWeek: 22 });
    expect(addWeeksForRow(row(rows, 7), PLAN)).toEqual({ fromWeek: 28, toWeek: 31 });
    expect(addWeeksForRow(row(rows, 9), PLAN)).toEqual({ fromWeek: 36, toWeek: 40 });
  });
});

describe('the table on paper', () => {
  const html = (lang = 'en', options = {}, edit = null) =>
    renderToStaticMarkup(<PatientCopy patient={{ fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 28 }} plan={PLAN} options={{ scope: 'all', kinds: [], ids: [], layout: 'table', fromToday: true, advice: '', ...options }} lang={lang} edit={edit} />)
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&');
  const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('has the six columns, the months with their weeks, and the items in the patient’s words', () => {
    const t = text(html());
    for (const h of ['Month', 'Visit dates', 'Scans', 'Tests', 'Medicines & vaccines', 'Advice']) expect(t).toContain(h);
    expect(t).toContain('Month 5 18–22 wk 28 Sep–01 Nov');
    expect(t).toContain('Detailed ultrasound of baby · 12 Oct');
    expect(t).toContain('Today:');
    expect(t).not.toContain('What is planned'); // not the list as well
  });

  it('is laid out like the owner’s sample sheet: title, danger signs, reminders and the closing line (DRAFT wording)', () => {
    const t = text(html());
    expect(t).toContain('9-Month Pregnancy Plan');
    expect(t).toContain('Danger signs – come to hospital immediately');
    expect(t).toContain('Baby moving less');
    expect(t).toContain('Bring this plan and all reports to every visit.');
    expect(t).toContain('Fetal sex is not disclosed (PC-PNDT Act).');
  });

  it('prints the delivery plan and the doctor’s remarks only when typed', () => {
    expect(text(html())).not.toContain('Delivery plan');
    const t = text(html('en', { deliveryPlan: 'Sample plan: delivery at this hospital', advice: 'Sample remark' }));
    expect(t).toContain('Delivery plan Sample plan: delivery at this hospital');
    expect(t).toContain('Doctor’s remarks Sample remark');
  });

  it('prints Special care needed in plain words, and never the reasons a family must not read', () => {
    const risk = { reasons: [{ key: 'age' }, { key: 'hb10' }, { key: 'hb7' }, { key: 'infection' }, { key: 'mental' }, { key: 'stillbirth' }, { key: 'tb' }, { key: 'rhneg' }] };
    const t = text(renderToStaticMarkup(<PatientCopy patient={{ fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 36, risk }} plan={PLAN} options={{ scope: 'all', kinds: [], ids: [], layout: 'table', advice: '' }} />));
    expect(t).toContain('Special care needed');
    expect(t).toContain('Mother’s age (under 18 or over 35) · Anaemia · Rh-negative blood group');
    for (const never of ['Infection', 'Mental', 'Stillbirth', 'Tuberculosis', 'HIV']) expect(t).not.toContain(never);
  });

  it('prints her facts from the record: obstetric score, LMP, blood group and mobile', () => {
    const patient = { fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 36, phone: '9800000010', obstetric: { gravida: 3, para: 2, living: 2, abortions: 0 }, medical: { bloodGroup: 'B-' }, pregnancy: { lmp: day('2026-05-25') } };
    const t = text(renderToStaticMarkup(<PatientCopy patient={patient} plan={PLAN} options={{ scope: 'all', kinds: [], ids: [], layout: 'table', advice: '' }} />));
    for (const fact of ['G3 P2 L2 A0', '25 May 2026', 'B-', '9800000010']) expect(t).toContain(fact);
  });

  it('prints the headings in Marathi under the English (DRAFT wording)', () => {
    const t = text(html('mr'));
    expect(t).toContain(TABLE_LABELS.medicine.mr);
    expect(t).toContain('महिना ५');
    expect(tableUntranslatedCount(monthTable(PLAN), 'mr')).toBeGreaterThan(0); // items a doctor added print as typed
  });

  it('shows Add and Remove only when the preview may change the plan', () => {
    expect(html()).not.toContain('pmt-edit');
    const withEdit = html('en', {}, { onAdd: () => {}, onRemove: () => {} });
    expect(withEdit).toContain('Remove scan scanAnomaly – mark it not needed');
    expect(withEdit).toContain('Add to Scans, Month 5');
  });

  it('a plan that cannot have the table prints the list as before', () => {
    const t = renderToStaticMarkup(
      <PatientCopy patient={{ fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 28 }} plan={{ ...PLAN, careType: 'postnatal', startOn: day('2026-10-01'), startWord: 'delivery' }} options={{ scope: 'all', kinds: [], ids: [], layout: 'table', advice: '' }} />,
    );
    expect(t).not.toContain('pmt');
    expect(t).toContain('What is planned');
  });
});
