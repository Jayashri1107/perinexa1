// Reception's dashboard on Today (26 Oct 2026): what a search carries into a new registration, the live queue's
// states, the patients table, the small list cards and To do (rendered to HTML, no browser). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { TodoPanel, prefillFrom, queueCounts, queueWhen } from './ReceptionDesk.jsx';
import { DeskNumbers, DoctorsPanel, ListCards, PatientsTable, UpcomingPanel, greeting, rowMatches } from './ReceptionDashboard.jsx';

const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const who = (id, fullName) => ({ id, fullName, mrn: `P-00000${id}`, phone: '98765 43210', doctorName: 'Sample Doctor' });
const rows = [
  { patient: who('1', 'Urgent Sample'), appointment: { kind: 'token', token: 3, doctorName: 'Sample Doctor' }, arrivedAt: '2026-10-26T05:00:00.000Z', arrivalMarked: true, visitStarted: false, queue: 'waiting', emergency: true, leftMarked: false, age: 26, baby: false },
  { patient: who('2', 'With Sample'), appointment: { kind: 'slot', start: '10:30', visitType: 'follow_up', doctorName: 'Sample Doctor' }, arrivedAt: '2026-10-26T04:50:00.000Z', arrivalMarked: true, visitStarted: true, queue: 'with_doctor', emergency: false, leftMarked: false, age: 31, baby: false },
  { patient: who('3', 'Expected Sample'), appointment: { kind: 'slot', start: '11:30', visitType: 'new', doctorName: 'Other Doctor' }, booked: true, arrivedAt: null, arrivalMarked: false, visitStarted: false, queue: 'expected', emergency: false, leftMarked: false, age: 24, baby: false },
  { patient: who('4', 'Done Sample'), appointment: null, booked: false, arrivedAt: '2026-10-26T04:00:00.000Z', arrivalMarked: true, visitStarted: true, queue: 'done', emergency: true, leftMarked: true, age: null, baby: true },
];

describe('reception: words and numbers', () => {
  it('a phone number typed in a search box becomes her phone, words her name, a patient number nothing', () => {
    expect(prefillFrom('98765 43210')).toEqual({ phone: '98765 43210' });
    expect(prefillFrom('+91 98765-43210')).toEqual({ phone: '+91 98765-43210' });
    expect(prefillFrom('asha sample')).toEqual({ fullName: 'asha sample' });
    expect(prefillFrom('P-000012')).toEqual({});
  });

  it('the queue: each state counted, emergencies still in the queue; her time; the greeting by the hour', () => {
    expect(queueCounts(rows)).toEqual({ all: 4, expected: 1, waiting: 1, with_doctor: 1, done: 1, emergency: 1 });
    expect(rows.map(queueWhen)).toEqual(['Token 3', '10:30 AM', '11:30 AM', 'No booking']);
    expect(greeting(new Date('2026-10-26T09:00:00'))).toBe('Good morning');
    expect(greeting(new Date('2026-10-26T14:00:00'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-10-26T19:00:00'))).toBe('Good evening');
  });

  it('the search box of the table matches her name, patient number or phone digits', () => {
    expect(rowMatches(rows[0], 'urgent')).toBe(true);
    expect(rowMatches(rows[0], 'P-000001')).toBe(true);
    expect(rowMatches(rows[0], '43210')).toBe(true);
    expect(rowMatches(rows[0], 'asha')).toBe(false);
  });

  it('three numbers: patients, appointments, the money collected', () => {
    const shown = text(<DeskNumbers rows={rows} collected={{ totals: { net: 755000 }, payments: [{}, {}] }} />);
    expect(shown).toMatch(/Today's patients 4 3 arrived · 1 waiting/);
    expect(shown).toMatch(/Appointments 3 0 completed · 1 upcoming/);
    expect(shown).toMatch(/Collection today .*7,550 2 payments/);
  });
});

describe('reception: the patients table', () => {
  const table = (extra = {}) => text(<PatientsTable rows={rows} onMark={() => {}} onUndo={() => {}} onFlag={() => {}} onSlip={() => {}} onRefresh={() => {}} onSaved={() => {}} {...extra} />);
  it('tabs with counts, one row each – age, time, visit type, state in words, Check in or View', () => {
    const shown = table();
    expect(shown).toMatch(/All \(4\) Expected \(1\) Waiting \(1\) In consultation \(1\) Completed \(1\)/);
    expect(shown).toMatch(/1 US Urgent Sample P-000001 · Sample Doctor 26 yrs Token 3 arrived .* Walk-in Emergency Waiting View/);
    expect(shown).toMatch(/With Sample .* 31 yrs 10:30 AM .* Follow-up In consultation View/);
    expect(shown).toMatch(/Expected Sample .* 24 yrs 11:30 AM New Expected Check in/);
    expect(shown).toMatch(/Done Sample .* Baby .* No booking Completed View/); // done: no emergency mark any more
    expect(shown).toContain('1 emergency');
    expect(shown).toContain('every 30 seconds');
  });
  it('no Check in for those who may not mark arrivals', () => {
    expect(table({ canMark: false })).not.toContain('Check in');
  });
});

describe('reception: the side and the lists', () => {
  it('the small list cards show only lists with someone in them; the open one is marked', () => {
    const html = renderToStaticMarkup(
      <ListCards
        open="due"
        onOpen={() => {}}
        cards={[
          { key: 'due', icon: Users, label: 'Visits due now', count: 2 },
          { key: 'overdue', icon: Users, label: 'Overdue – not booked', count: 0 },
        ]}
      />,
    );
    expect(html).toContain('Visits due now');
    expect(html).not.toContain('Overdue');
    expect(html).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(<ListCards cards={[{ key: 'x', icon: Users, label: 'X', count: 0 }]} onOpen={() => {}} />)).toBe('');
  });

  it('Doctors today: name, state and hours, then expected, waiting and seen', () => {
    const shown = text(<DoctorsPanel doctors={[{ id: 'd1', name: 'Jayashri Sample', hasTimings: true, sessions: [{ from: '10:00', to: '13:00' }], leave: null, expected: 3, waiting: 1, seen: 2 }]} />);
    expect(shown).toMatch(/JS Jayashri Sample In OPD 10:00 AM–1:00 PM 3 Expected 1 Waiting 2 Seen/);
  });

  it('Upcoming appointments: those still expected with a time, the earliest first', () => {
    const shown = text(<UpcomingPanel rows={rows} />);
    expect(shown).toMatch(/11:30 AM Expected Sample New/);
    expect(shown).not.toContain('With Sample');
  });

  it('To do lists only the jobs with someone in them; nothing waiting says so', () => {
    const busy = text(<TodoPanel calls={5} incomplete={[{ patient: { id: '1' } }, { patient: { id: '2' } }]} toCollect={1} onSaved={() => {}} />);
    expect(busy).toContain('Calls to make');
    expect(busy).toMatch(/Details missing .* 2/);
    expect(busy).toContain('Payments to collect');
    expect(busy).not.toContain('Discharges');
    expect(text(<TodoPanel onSaved={() => {}} />)).toContain('Nothing waiting.');
  });
});
