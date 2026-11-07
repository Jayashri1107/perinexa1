// Clinical Requirements Group C (PX-X-07): the privileges register and the check on a theatre case. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const data = {
  staff: [
    { id: 'u1', name: 'Sample Doctor', roles: ['doctor'], privileges: [{ id: 'p1', key: 'caesarean', label: 'Caesarean section', validUntil: '2027-11-09', note: '', byName: 'Sample Quality', at: '2026-11-07T04:00:00.000Z', state: 'in_force', ended: null }] },
    { id: 'u2', name: 'Sample Nurse', roles: ['nurse'], privileges: [] },
  ],
  access: { keep: true },
  rules: { privileges: { caesarean: { label: 'Caesarean section', role: 'doctor' } }, source: 'DRAFT – sample list' },
  today: '2026-11-07',
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data, error: null, loading: false, reload: () => {} }) }));
const { PrivilegesPage } = await import('./PrivilegesPage.jsx');
const { PrivilegeCheck } = await import('../theatre/TheatreCasePage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('clinical privileges', () => {
  it('lists each member of staff with the privileges in force', () => {
    const out = text(<PrivilegesPage />);
    expect(out).toContain('Staff · 2');
    expect(out).toContain('Sample Doctor Doctor 1 in force');
    expect(out).toMatch(/Caesarean section Until .*2027.*In force End/);
    expect(out).toContain('Sample Nurse Nurse None in force No privileges recorded.');
    expect(out).toContain('Grant a privilege');
    expect(out).toContain('DRAFT – sample list');
    expect(out).not.toMatch(/!/);
  });

  it('the theatre case says who holds the privilege and warns otherwise', () => {
    const out = text(
      <PrivilegeCheck
        surgeon="Dr Sample Doctor"
        anaesthetist="Visiting anaesthetist"
        privileges={{ surgeon: { state: 'in_force', label: 'Caesarean section' }, anaesthetist: { state: 'not_staff', label: 'Spinal and epidural anaesthesia' } }}
      />,
    );
    expect(out).toContain('Dr Sample Doctor holds the privilege: Caesarean section');
    expect(out).toContain('Visiting anaesthetist is not a member of staff by this name');
    expect(text(<PrivilegeCheck surgeon="" anaesthetist="" privileges={{ surgeon: { state: 'not_set' }, anaesthetist: { state: 'not_set' } }} />)).toBe('');
    expect(text(<PrivilegeCheck surgeon="Dr X" anaesthetist="" privileges={{ surgeon: { state: 'none', label: 'Hysterectomy' }, anaesthetist: { state: 'not_set' } }} />)).toContain('No privilege recorded for Dr X: Hysterectomy');
  });
});
