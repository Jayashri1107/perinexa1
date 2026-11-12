// The simpler lab dashboard (12 Nov 2026), rendered to HTML from fake counts: what waits now as big counts that open
// their lists, a critical and a late line, the period's four numbers, and the other lab screens as plain links.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['lab'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles }, user: { id: 'u-lab', name: 'Sample Lab' } }) }));

const { LabDashboardPage } = await import('./LabDashboardPage.jsx');
const html = () => renderToStaticMarkup(<MemoryRouter><LabDashboardPage /></MemoryRouter>);
const text = (h) => h.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

answers['/lab/dashboard'] = {
  registered: { orders: 9, patients: 7, walkIn: 3, tests: 21 },
  reported: 5,
  chargedPaise: 450000,
  byDepartment: [{ key: 'haematology', tests: 12, chargedPaise: 200000 }],
  waiting: { critical: 1, collect: 4, receive: 0, report: 2, verify: 3, outside: 1, home: 0 },
  late: 2,
};
answers['/lab/worklist'] = { counts: { collect: 6, receive: 1, report: 0, verify: 0, outside: 0, home: 0 } };

describe('the lab dashboard', () => {
  it('lab staff: what waits first, then the numbers, then the other screens', () => {
    roles = ['lab'];
    const h = html();
    const t = text(h);
    expect(t).toContain('New patient test');
    expect(t).toContain('Critical: 1 result not yet called to a doctor');
    expect(t).toContain('Late: 2 past their due time');
    for (const w of ['Samples to take', 'Samples to receive', 'Results to enter', 'Results to check', 'Home visits', 'At outside labs']) expect(t).toContain(w);
    expect(h).toContain('href="/lab?list=collect"');
    expect(t.indexOf('Waiting now')).toBeLessThan(t.indexOf('Reports finished'));
    expect(t.indexOf('Reports finished')).toBeLessThan(t.indexOf('Daily work'));
    expect(t).toContain('Cash handover');
    expect(t).toContain('By department');
  });
  it('a doctor: the counts of her patients and the screens, no numbers, no cash, no registration', () => {
    roles = ['doctor'];
    const t = text(html());
    expect(t).toContain('6 Samples to take');
    expect(t).not.toContain('New patient test');
    expect(t).not.toContain('Reports finished');
    expect(t).not.toContain('Cash handover');
    expect(t).not.toContain('Critical:');
  });
});
