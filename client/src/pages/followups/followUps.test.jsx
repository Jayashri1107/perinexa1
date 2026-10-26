// Reception's Follow-ups page (26 Oct 2026): the groups and words (no browser) and both tabs rendered to HTML with a
// sample answer of GET /api/follow-ups. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { bookingTime, callRows, comingDayLabel, comingUpGroups, filterFollowUps, followUpCounts, matchesFilter, visitTypeLabel } from './followUpsFormat.js';

const who = (id, fullName, setting = 'opd') => ({ id, fullName, mrn: `P-00000${id}`, phone: '98765 43210', doctorName: 'Sample Doctor', setting });
const SAMPLE = {
  today: '2026-10-01',
  days: 7,
  comingUp: [
    { patient: who('1', 'Asha Sample'), date: '2026-10-01', start: '10:30', needsTime: false, doctorName: 'Sample Doctor', visitType: 'follow_up', arrived: true, fromNextVisit: false },
    { patient: { ...who('2', 'Meera Sample', 'ipd'), phone: '90000 11111', doctorName: 'Other Doctor' }, date: '2026-10-02', start: null, needsTime: true, doctorName: null, visitType: 'new', arrived: false, fromNextVisit: true },
  ],
  dueNow: [{ patient: who('3', 'Due Sample', 'day_care'), dueFrom: '2026-09-29' }],
  overdue: [{ patient: who('4', 'Late Sample'), dueFrom: null, bookedFor: '2026-09-21' }],
  babiesDue: [{ patient: who('5', 'Baby Late'), dueFrom: '2026-09-20', draft: true }],
  babiesSoon: [{ patient: who('6', 'Baby Soon'), dueFrom: '2026-10-05', draft: false }],
  cut: false,
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: SAMPLE, loading: false, error: null, reload: () => {} }) }));
const { FollowUpsPage, VaccinationFollowUpsPage } = await import('./FollowUpsPage.jsx');
const text = (el, url = '/follow-ups') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fmt = (iso) => `[${iso}]`;

describe('follow-ups: the words', () => {
  it('days read Today, Tomorrow, then the date; bookings are grouped by day in order', () => {
    expect(comingDayLabel('2026-10-01', '2026-10-01')).toBe('Today');
    expect(comingDayLabel('2026-10-02', '2026-10-01')).toBe('Tomorrow');
    expect(comingDayLabel('2026-10-03', '2026-10-01')).toBe('Saturday 3 Oct 2026');
    expect(comingUpGroups([...SAMPLE.comingUp].reverse(), SAMPLE.today).map((g) => [g.label, g.rows.length])).toEqual([
      ['Today', 1],
      ['Tomorrow', 1],
    ]);
  });

  it('a booking shows its time or "Needs a time", and New or Follow-up', () => {
    expect(bookingTime(SAMPLE.comingUp[0])).toBe('10:30 AM');
    expect(bookingTime(SAMPLE.comingUp[1])).toBe('Needs a time');
    expect(visitTypeLabel(SAMPLE.comingUp[0])).toBe('Follow-up');
    expect(visitTypeLabel(SAMPLE.comingUp[1])).toBe('New');
  });

  it('the patients to call: overdue first, each with why; the counts', () => {
    expect(callRows(SAMPLE, fmt).map((r) => [r.patient.fullName, r.late, r.why])).toEqual([
      ['Late Sample', true, 'Booked for [2026-09-21] – did not come'],
      ['Due Sample', false, 'Visit due from [2026-09-29]'],
    ]);
    expect(followUpCounts(SAMPLE)).toEqual({ toCall: 2, babies: 2, today: 1, comingUp: 2 });
    expect(followUpCounts(undefined)).toEqual({ toCall: 0, babies: 0, today: 0, comingUp: 0 });
  });
});

describe('follow-ups: the two tabs', () => {
  it('Follow-ups shows who to call and the coming week, with phones to tap – and no vaccine', () => {
    const shown = text(<FollowUpsPage />);
    expect(shown).toContain('To call – not booked (2)');
    expect(shown).toContain('Late Sample');
    expect(shown).toContain('Coming up – next 7 days (2)');
    expect(shown).toMatch(/Today \(1\).*Asha Sample.*Arrived.*Tomorrow \(1\).*Needs a time.*Meera Sample.*New.*Booked/);
    expect(renderToStaticMarkup(<MemoryRouter><FollowUpsPage /></MemoryRouter>)).toContain('href="tel:9876543210"');
  });

  it('Vaccinations shows babies overdue and due soon in general words, with the draft mark in words', () => {
    const shown = text(<VaccinationFollowUpsPage />);
    expect(shown).toContain('Overdue – not booked (1)');
    expect(shown).toContain('Due in the next 7 days – not booked (1)');
    expect(shown).toContain('A check-up or test is due from 5 Oct 2026');
    expect(shown).toContain('Draft schedule');
    expect(shown).not.toMatch(/BCG|OPV|Hepatitis/);
  });
});

describe('follow-ups: the filter', () => {
  const meera = SAMPLE.comingUp[1];
  it('matches part of the name, the patient number or the doctor in any case, and the phone by its digits', () => {
    expect(matchesFilter(meera, { text: 'meera' })).toBe(true);
    expect(matchesFilter(meera, { text: 'P-000002' })).toBe(true);
    expect(matchesFilter(meera, { text: 'other doc' })).toBe(true);
    expect(matchesFilter(meera, { text: '9000011111' })).toBe(true);
    expect(matchesFilter(meera, { text: '90000 111' })).toBe(true);
    expect(matchesFilter(meera, { text: 'asha' })).toBe(false);
    expect(matchesFilter(meera, { text: '12' })).toBe(false); // too few digits for a phone
    expect(matchesFilter(meera, {})).toBe(true);
  });

  it('OPD, IPD or day care; a patient without the word counts as OPD', () => {
    expect(matchesFilter(meera, { setting: 'ipd' })).toBe(true);
    expect(matchesFilter(meera, { setting: 'opd' })).toBe(false);
    expect(matchesFilter({ patient: { fullName: 'X' } }, { setting: 'opd' })).toBe(true);
    const only = filterFollowUps(SAMPLE, { setting: 'day_care' });
    expect([only.comingUp.length, only.dueNow.length, only.overdue.length, only.babiesDue.length]).toEqual([0, 1, 0, 0]);
    expect(filterFollowUps(undefined, {})).toBeUndefined();
  });

  it('the page keeps the filter in the address bar and says when nothing matches', () => {
    const ipd = text(<FollowUpsPage />, '/follow-ups?type=ipd');
    expect(ipd).toContain('Meera Sample');
    expect(ipd).toContain('P-000002 · IPD');
    expect(ipd).not.toContain('Asha Sample');
    expect(ipd).toContain('No patient matches the filter.');
    expect(text(<VaccinationFollowUpsPage />, '/follow-ups/vaccinations?q=baby%20soon')).not.toContain('Baby Late');
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={['/follow-ups?type=ipd']}><FollowUpsPage /></MemoryRouter>)).toContain('aria-pressed="true">IPD');
  });
});
