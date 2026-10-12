import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CallRow, babiesDueNote, babyDueLine, overdueLine } from './TodayPage.jsx';
import { vaccinationLine } from './worklist/WorklistSections.jsx';

describe('overdueLine', () => {
  it('a missed booking, a passed window, or both – the first day of the window only', () => {
    expect(overdueLine({ bookedFor: '2026-09-21', dueFrom: null })).toBe('Booked for 21 Sep 2026 – no visit recorded');
    expect(overdueLine({ bookedFor: null, dueFrom: '2026-09-07' })).toBe('Visit was due from 7 Sep 2026');
    expect(overdueLine({ bookedFor: '2026-09-21', dueFrom: '2026-09-07' })).toBe('Booked for 21 Sep 2026 – no visit recorded · Visit was due from 7 Sep 2026');
  });
});

describe('babies with an overdue vaccination', () => {
  it('reception reads general words and the first day only – never what is due', () => {
    expect(babyDueLine({ dueFrom: '2026-10-01' })).toBe('A check-up or test was due from 1 Oct 2026');
    expect(babyDueLine({ dueFrom: '2026-10-01' })).not.toMatch(/vaccin|BCG|dose/i);
  });

  it('a date from a schedule no doctor has approved is marked for reception – in words, not only colour', () => {
    const row = (draft) => ({ patient: { id: '1', fullName: 'Baby One', mrn: 'P-000001', phone: '98765 43210' }, dueFrom: '2026-10-01', draft });
    const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const marked = text(createElement(CallRow, { row: row(true), line: babyDueLine }));
    expect(marked).toContain('Draft schedule');
    expect(marked).toContain('A check-up or test was due from 1 Oct 2026');
    expect(marked).toContain('98765 43210');
    expect(text(createElement(CallRow, { row: row(false), line: babyDueLine }))).not.toContain('Draft schedule');
    // An answer from before the mark existed (no draft field) reads as before
    expect(text(createElement(CallRow, { row: { patient: { id: '1', phone: '' }, dueFrom: '2026-10-01' }, line: babyDueLine }))).not.toContain('Draft');
    expect(babiesDueNote([row(false)])).toBe('Babies for whom a check-up or test became overdue in the last 6 weeks and nothing is booked. A baby in hospital is not listed.');
    expect(babiesDueNote([row(false), row(true)])).toContain('"Draft schedule": the date comes from a schedule no doctor has approved yet – ask the doctor before calling.');
    expect(babiesDueNote([row(true)])).not.toMatch(/vaccin|BCG|dose/i);
  });

  it('doctors, RMOs and nurses read whether the baby is booked', () => {
    expect(vaccinationLine({ bookedFor: '2026-10-12' })).toBe('Booked for 12 Oct 2026');
    expect(vaccinationLine({ bookedFor: null })).toBe('No appointment booked');
  });
});
