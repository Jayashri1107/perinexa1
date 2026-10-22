// The Export button (21 Oct 2026): doctors only, their own patients; the dialog asks for the dates (or none, for all
// her own patients) and warns that the file holds names and phone numbers. Rendered to HTML, like the other screen tests.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let auth = {};
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }));
vi.mock('./ui.jsx', async (importOriginal) => ({ ...(await importOriginal()), useDialogFocus: () => null }));

const { EXPORT_LISTS, ExportButton, ExportDialog, canExport, thisMonth } = await import('./ExportButton.jsx');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&rsquo;/g, '’').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  auth = { activeMembership: { roles: ['doctor'] } };
});

describe('Export', () => {
  it('is for doctors working in the hospital only', () => {
    expect(canExport({ roles: ['doctor'] })).toBe(true);
    expect(canExport({ roles: ['admin', 'doctor'] })).toBe(true);
    expect(canExport({ roles: ['admin'] })).toBe(false);
    expect(canExport({ roles: ['receptionist', 'nurse', 'rmo'] })).toBe(false);
    expect(canExport({ roles: ['doctor'], platform: true })).toBe(false); // a super admin who opened the setup
    expect(canExport(null)).toBe(false);
    expect(renderToStaticMarkup(<ExportButton what="patients" />)).toMatch(/btn btn-secondary/);
    auth = { activeMembership: { roles: ['admin'] } };
    expect(renderToStaticMarkup(<ExportButton what="patients" />)).toBe('');
  });

  it('has a list for each export, the dated ones with this month as the start', () => {
    expect(Object.keys(EXPORT_LISTS)).toEqual(['patients', 'appointments', 'admissions', 'lab', 'scans', 'referrals']);
    expect(EXPORT_LISTS.patients.dated).toBe(false);
    expect(thisMonth(new Date(2026, 9, 21))).toEqual({ from: '2026-10-01', to: '2026-10-21' });
    expect(EXPORT_LISTS.lab.help).toMatch(/never the results/);
    expect(EXPORT_LISTS.scans.help).toMatch(/never the report/);
  });

  it('the dialog: dates, the warning about names and phones, one primary button, no exclamation marks', () => {
    const html = renderToStaticMarkup(<ExportDialog what="appointments" onClose={() => {}} />);
    const shown = text(html);
    expect(shown).toMatch(/Export appointments/);
    expect(shown).toMatch(/never send it by WhatsApp or email/);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect((html.match(/class="btn btn-primary"/g) ?? []).length).toBe(1);
    expect(shown).not.toMatch(/!/);
    expect(text(renderToStaticMarkup(<ExportDialog what="patients" onClose={() => {}} />))).toMatch(/Registered from/);
  });
});
