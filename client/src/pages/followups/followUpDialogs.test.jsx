// Follow-ups added by hand and why she came (26 Oct 2026), rendered to HTML (no browser): the purposes as buttons with
// the note's privacy hint, the Add follow-up dialog, Check in asking why, and the desk's table showing both. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { purposeText } from '../appointments/appointmentFormat.js';

// The dialogs remember where the focus was when they open (no browser here: a stand-in)
globalThis.document ??= { activeElement: null };
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: null, error: null, loading: false, reload: () => {} }) }));
const { AddFollowUpDialog, PurposeChoice } = await import('./FollowUpDialogs.jsx');
const { ArrivalDialog } = await import('../appointments/TodayAppointments.jsx');
const { PatientsTable } = await import('../ReceptionDashboard.jsx');
const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const asha = { id: 'p1', fullName: 'Asha Sample', mrn: 'P-000001', phone: '98765 43210', doctorName: 'Sample Doctor' };

describe('why she comes', () => {
  it('six purposes as buttons, the chosen one marked, and a short note without medical details', () => {
    const out = html(<PurposeChoice value="reports" onChange={() => {}} note="" onNote={() => {}} />);
    for (const w of ['Follow-up consultation', 'Show reports', 'Test or scan', 'Dressing or procedure', 'Prescription', 'Other']) expect(out).toContain(w);
    expect(out).toMatch(/aria-checked="true"[^>]*>Show reports/);
    expect(out).toContain('maxLength="120"');
    expect(out).toContain('No medical details');
    expect(purposeText({ kind: 'reports', note: 'bring the blood report' })).toBe('Show reports (bring the blood report)');
    expect(purposeText({ purpose: 'test' })).toBe('Test or scan');
    expect(purposeText(null)).toBe('');
  });

  it('Add follow-up: for a patient – her doctor, from which day, what for; without one, find her first', () => {
    const shown = text(<AddFollowUpDialog patient={asha} onClose={() => {}} onAdded={() => {}} />);
    expect(shown).toMatch(/Add a follow-up – Asha Sample Doctor From(?! \(optional\)).* What for/);
    expect(shown).toContain('Add follow-up');
    expect(text(<AddFollowUpDialog onClose={() => {}} onAdded={() => {}} />)).toContain('Find the patient');
  });

  it('Check in a booked patient: only why she came, then Check in – no doctor or token to choose', () => {
    const shown = text(<ArrivalDialog patient={asha} appointment={{ kind: 'slot', start: '10:30', doctorName: 'Sample Doctor' }} onClose={() => {}} onDone={() => {}} />);
    expect(shown).toMatch(/Check in Asha Sample Booked for 10:30 AM with Sample Doctor Why did she come\?/);
    expect(shown).toContain('Check in');
    expect(shown).not.toContain('Give a token');
    const walkIn = text(<ArrivalDialog patient={asha} onClose={() => {}} onDone={() => {}} />);
    expect(walkIn).toMatch(/Asha Sample has arrived .*Why did she come\? .*Give a token/);
  });

  it('the desk table: a follow-up badge before she comes, why she came after', () => {
    const base = { patient: asha, appointment: { kind: 'slot', start: '10:30', visitType: 'follow_up', doctorName: 'Sample Doctor' }, booked: true, arrivalMarked: false, visitStarted: false, emergency: false, leftMarked: false, age: 28, baby: false };
    const before = text(<PatientsTable rows={[{ ...base, queue: 'expected', arrivedAt: null, purpose: null, followUp: { id: 'f1', purpose: 'reports', note: '', doctor: { name: 'Sample Doctor' } } }]} onRefresh={() => {}} onSaved={() => {}} />);
    expect(before).toMatch(/Follow-up Follow-up: Show reports/);
    const after = text(<PatientsTable rows={[{ ...base, queue: 'waiting', arrivedAt: '2026-10-26T05:00:00.000Z', arrivalMarked: true, purpose: { kind: 'reports', note: 'blood report' }, followUp: null }]} onRefresh={() => {}} onSaved={() => {}} />);
    expect(after).toMatch(/Show reports blood report Waiting/);
  });
});
