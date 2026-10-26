// "New patient" in the Book dialog (26 Oct 2026): her registration opens inside the dialog – the type of care and
// the visit type first, no page change (rendered to HTML, no browser). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

let roles = ['receptionist'];
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles, tenantName: 'Sample Hospital' }, user: { id: 'u1' } }) }));
const { RegisterAndBook } = await import('./RegisterAndBook.jsx');
const doctor = { id: 'd1', name: 'Sample Doctor' };
const html = () => renderToStaticMarkup(<MemoryRouter><RegisterAndBook doctor={doctor} date="2026-10-26" start="11:50" onBooked={() => {}} onCancel={() => {}} /></MemoryRouter>);

describe('Register and book', () => {
  it('asks the type of care first, with every type for reception, and the visit type (New by default)', () => {
    const out = html();
    expect(out).toContain('Type of care');
    for (const t of ['Pregnancy (antenatal)', 'Gynaecology', 'Infertility', 'Newborn']) expect(out).toContain(t);
    expect(out).toMatch(/<option value="new" selected="">New<\/option>/);
    expect(out).toContain('Choose the type of care to open her registration form.');
    expect(out).not.toContain('Register and book'); // the form (and its button) opens once a type is chosen
  });

  it('the referral desk registers no babies', () => {
    roles = ['referral_desk'];
    expect(html()).not.toContain('Newborn');
    roles = ['receptionist'];
  });
});

describe('a booking line: one Edit info button (in a dialog)', async () => {
  const { AppointmentLine, initialsOf } = await import('./AppointmentsPage.jsx');
  const base = { id: 'a1', date: '2026-10-26', kind: 'slot', start: '10:30', visitType: 'new', status: 'booked', doctor: { id: 'd1', name: 'Sample Doctor' } };
  const line = (a, extra = {}) => renderToStaticMarkup(<MemoryRouter><AppointmentLine a={a} canBook onMove={() => {}} onCancel={() => {}} {...extra} /></MemoryRouter>);
  const both = { onEdit: () => {}, onRegister: () => {} };
  it('Edit info for a registered patient and for one booked by name and phone; Reschedule, then Cancel last', () => {
    const registered = line({ ...base, patient: { id: 'p1', fullName: 'Asha Sample', mrn: 'P-000001', phone: '' } }, both);
    expect(registered).toContain('aria-label="Edit the information of Asha Sample"');
    expect(registered).not.toMatch(/>Register</);
    expect(registered).toMatch(/Edit info.*Reschedule.*Cancel/s);
    const guest = line({ ...base, guest: { name: 'Ishanvi Sample', phone: '98986 53256' } }, both);
    expect(guest).toContain('Not registered yet');
    expect(guest).toContain('aria-label="Edit the information of Ishanvi Sample"');
  });
  it('no Edit info for those who do not register patients, nor for a cancelled booking; the initials when asked', () => {
    expect(line({ ...base, guest: { name: 'Ishanvi Sample', phone: '1' } })).not.toContain('Edit info');
    expect(line({ ...base, status: 'cancelled', guest: { name: 'Ishanvi Sample', phone: '1' } }, both)).not.toContain('Edit info');
    expect(line({ ...base, guest: { name: 'Ishanvi Sample', phone: '1' } }, { avatar: true })).toContain('>IS<');
    expect(initialsOf('asha  sample devi')).toBe('AS');
    expect(initialsOf('')).toBe('');
  });
});
