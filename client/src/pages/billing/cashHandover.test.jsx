// The daily cash handover screen (docs/WHATSAPP_DESK_PLAN.md), rendered to HTML from fake answers: reception sees its
// own collection and hands over; a doctor sees the day's handovers and confirms – never their own. Made-up amounts.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['receptionist'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles }, user: { id: 'u-doctor', name: 'Sample Doctor' } }) }));

const { CashHandoverPage } = await import('./CashHandoverPage.jsx');
const text = (html) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = () => text(renderToStaticMarkup(<MemoryRouter><CashHandoverPage /></MemoryRouter>));
const modes = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'upi', label: 'UPI' },
  { mode: 'card', label: 'Card' },
  { mode: 'insurance', label: 'Insurance / scheme' },
];
const handover = (extra = {}) => ({ id: 'h1', date: '2026-10-17', userId: 'u-desk', userName: 'Sample Reception', cashPaise: 50000, byMode: { cash: 50000 }, payments: 2, handedPaise: 49000, differencePaise: -1000, note: 'Change given', handed: { byName: 'Sample Reception', at: '2026-10-17T13:00:00Z' }, received: null, ...extra });

describe('the cash handover screen', () => {
  it('reception: its own collection by mode and the handover form', () => {
    roles = ['receptionist'];
    answers['/cash-handover'] = { date: '2026-10-17', today: '2026-10-17', modes, mine: { cashPaise: 50000, byMode: { cash: 50000, upi: 20000, card: 0, insurance: 0 }, payments: 3, handover: null }, handovers: [], canHandOver: true, canConfirm: false };
    const html = render();
    expect(html).toContain('Your collection');
    expect(html).toContain('Hand over the cash');
    expect(html).toMatch(/UPI ₹\s?200/);
    expect(html).not.toContain('Handed over on this day');
  });

  it("a doctor: the day's handovers, a difference shown, Count and confirm", () => {
    roles = ['doctor'];
    answers['/cash-handover'] = { date: '2026-10-17', today: '2026-10-17', modes, mine: null, handovers: [handover(), handover({ id: 'h2', userId: 'u-doctor', userName: 'Sample Doctor' })], canHandOver: false, canConfirm: true };
    const html = render();
    expect(html).toContain('Handed over on this day');
    expect(html).toContain('Sample Reception');
    expect(html).toContain('less by');
    expect(html).toContain('Waiting for confirmation');
    expect(html.match(/Count and confirm/g)).toHaveLength(1); // never their own
  });
});
