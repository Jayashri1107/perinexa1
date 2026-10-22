// A super admin who is also a doctor – one login (21 Oct 2026): the switch's wording in both directions, "Work as a
// doctor" (choose a hospital; no second email or password) and "Switch back to super admin" (asks their password).
// Rendered to HTML from fake answers, like the other screen tests. Made-up names only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let auth = {};
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }));
// No browser here: the dialogs' focus handling (it reads document) is left out
vi.mock('./ui.jsx', async (importOriginal) => ({ ...(await importOriginal()), useDialogFocus: () => null }));
vi.mock('../hooks/useFetch.js', () => ({
  useFetch: (path) => ({
    data: path === '/platform/tenants' ? { tenants: [{ id: 'a'.repeat(24), name: 'Sample Hospital A', isActive: true }, { id: 'b'.repeat(24), name: 'Closed Hospital', isActive: false }] } : null,
    loading: false,
    error: null,
  }),
}));

const { DoctorAccountDialog, SwitchBackDialog, switchLabel, switchTitle } = await import('./AppLayout.jsx');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (node) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const primaries = (html) => (html.match(/class="btn btn-primary"/g) ?? []).length;

beforeEach(() => {
  auth = { platform: null, makeDoctorAccount: vi.fn(), switchToDoctor: vi.fn(), switchToSuperAdmin: vi.fn() };
});

describe('switching between super admin and their own doctor account', () => {
  it('says which way the switch goes, and whether a password is asked', () => {
    expect(switchLabel(false)).toBe('Switch to your doctor account');
    expect(switchLabel(true)).toBe('Switch back to super admin');
    expect(switchTitle({ linkedAccount: { email: 'asha+doctor@example.com', own: true } }, false)).toMatch(/no password needed/);
    expect(switchTitle({ linkedAccount: { email: 'real.doctor@example.com', own: false } }, false)).toBe('Switch to real.doctor@example.com – asks for its password');
    expect(switchTitle(null, true)).toMatch(/asks for your super admin password/);
    expect(switchTitle({ linkedAccount: null }, false)).toBe('Set up your doctor account');
  });

  it('"Work as a doctor": active hospitals to choose from, no email or password asked, one primary button', () => {
    const html = render(<DoctorAccountDialog error={null} onOtherLogin={() => {}} onClose={() => {}} />);
    const shown = text(html);
    expect(shown).toMatch(/Work as a doctor/);
    expect(shown).toMatch(/no second email or password/);
    expect(shown).toContain('Sample Hospital A');
    expect(shown).not.toContain('Closed Hospital');
    expect(html).not.toMatch(/type="password"|type="email"/);
    expect(shown).toMatch(/Use that login/);
    expect(primaries(html)).toBe(1);
    expect(shown).not.toMatch(/!/);
  });

  it('names the existing own doctor account, and offers no other login then', () => {
    auth.platform = { linkedAccount: { email: 'asha+doctor@example.com', own: true } };
    const shown = text(render(<DoctorAccountDialog error="Your doctor account is not in any hospital yet." onOtherLogin={null} onClose={() => {}} />));
    expect(shown).toContain('asha+doctor@example.com');
    expect(shown).toContain('Your doctor account is not in any hospital yet.');
    expect(shown).not.toMatch(/Use that login/);
  });

  it('"Switch back to super admin" asks for the super admin password', () => {
    const html = render(<SwitchBackDialog onClose={() => {}} />);
    expect(text(html)).toMatch(/Switch back to super admin/);
    expect(text(html)).toMatch(/Super admin password/);
    expect(html).toMatch(/id="switch-back-password"/);
    expect(primaries(html)).toBe(1);
  });
});
