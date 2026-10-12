// The calendar page while the next month loads (all fake sample data). The website has no browser test setup,
// so the page is rendered to HTML (react-dom/server) at each moment: before ›, while October loads, after.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = { month: null, day: null };
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path, query) => {
    const a = path ? answers[query.view === 'day' ? 'day' : 'month'] : null;
    return { data: a?.data ?? null, loading: a?.loading ?? false, error: null, status: null, reload: () => {} };
  },
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['doctor'] } }) }));

const { CalendarPage } = await import('./CalendarPage.jsx');

const DAY = 86_400_000;
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
function days(from, to, counts = {}) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const date = isoOf(t);
    out.push({ date, booked: 0, plan: 0, attended: 0, edd: 0, lmp: 0, ...(counts[date] ?? {}) });
  }
  return out;
}
const monthAnswer = (date, from, to, counts) => ({
  view: 'month',
  date,
  today: '2026-09-30',
  from,
  to,
  scope: 'mine',
  canChooseScope: true,
  types: ['booked', 'plan', 'edd', 'lmp'],
  days: days(from, to, counts),
  events: [],
  patients: {},
});
const SEPTEMBER = monthAnswer('2026-09-01', '2026-08-31', '2026-10-04', { '2026-09-15': { booked: 2 }, '2026-09-30': { plan: 1 } });
const OCTOBER = monthAnswer('2026-10-01', '2026-09-28', '2026-11-01', {});

const render = (search) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/calendar${search}`]}>
      <CalendarPage />
    </MemoryRouter>,
  );

describe('month view while another month loads', () => {
  beforeEach(() => {
    answers.day = { data: null, loading: true };
  });

  it('shows skeleton cells, never September under "October 2026", and no false "Nothing this month."', () => {
    answers.month = { data: SEPTEMBER, loading: false };
    const before = render('?view=month&date=2026-09-30');
    expect(before).toContain('aria-label="September 2026"');
    expect(before).not.toContain('Nothing this month.');

    // › pressed: the address says 30 Oct, the October answer has not come yet (September's is still held).
    answers.month = { data: SEPTEMBER, loading: true };
    const loading = render('?view=month&date=2026-10-30');
    expect(loading).toContain('October 2026'); // the title already names the new month
    expect(loading).not.toContain('Nothing this month.');
    expect(loading).not.toContain('Showing your patients only.');
    expect(loading).toContain('cal-cell-skeleton');
    expect(loading).not.toContain('role="grid"');

    // October arrives (empty): the October grid, 30 Oct chosen, and now "Nothing this month." is true.
    answers.month = { data: OCTOBER, loading: false };
    const after = render('?view=month&date=2026-10-30');
    expect(after).toContain('role="grid" aria-label="October 2026"');
    expect(after).toMatch(/role="gridcell" aria-selected="true" class="[^"]*"><button[^>]*data-date="2026-10-30"/);
    expect(after).toContain('Nothing this month.');
  });

  it('keeps the counts while another day of the same month is chosen', () => {
    answers.month = { data: SEPTEMBER, loading: true };
    const html = render('?view=month&date=2026-09-15');
    expect(html).toContain('role="grid" aria-label="September 2026"');
    expect(html).toMatch(/role="gridcell" aria-selected="true" class="[^"]*"><button[^>]*data-date="2026-09-15"/);
  });

  it('marks the panel busy without "Loading…" in the title while only the chosen day loads', () => {
    answers.month = { data: SEPTEMBER, loading: false };
    const html = render('?view=month&date=2026-09-30');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Today · Wed, 30 Sep 2026');
    expect(html).not.toMatch(/class="cal-loading"/);
  });
});
