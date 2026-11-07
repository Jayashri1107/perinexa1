// Clinical Requirements Group C (PX-X-02, PX-X-03): the document register and the form box printed on a record.
// Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const data = {
  versions: [
    { id: 'v2', screen: 'who_checklist', code: 'OBG-F-16', title: 'Surgical safety checklist', version: '2.0', effectiveFrom: '2026-12-01', reviewDue: '', note: '', state: 'draft', recorded: { byName: 'Sample Quality' }, approved: null, withdrawn: null },
    { id: 'v1', screen: 'who_checklist', code: 'OBG-F-16', title: 'Surgical safety checklist', version: '1.0', effectiveFrom: '2026-10-01', reviewDue: '2026-11-01', reviewOverdue: true, note: '', state: 'in_force', recorded: { byName: 'Sample Quality' }, approved: { byName: 'Dr Sample', at: '2026-10-01T04:00:00.000Z' }, withdrawn: null },
  ],
  access: { record: false, approve: true },
  rules: { screens: { who_checklist: { label: 'WHO Surgical Safety Checklist (theatre case)', code: 'OBG-F-16' }, meows: { label: 'MEOWS chart', code: 'OBG-F-05' } }, source: 'DRAFT – sample' },
  today: '2026-11-10',
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data, error: null, loading: false, reload: () => {} }) }));
const { DocumentRegisterPage } = await import('./DocumentRegisterPage.jsx');
const { FormBox } = await import('../../components/print/ManualPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the document register', () => {
  it('shows each screen with its versions, what is in force, what to approve and what is overdue', () => {
    const out = text(<DocumentRegisterPage />);
    expect(out).toContain('WHO Surgical Safety Checklist (theatre case)');
    expect(out).toContain('Draft – to approve OBG-F-16 · version 2.0');
    expect(out).toContain('In force OBG-F-16 · version 1.0');
    expect(out).toContain('Review overdue');
    expect(out).toContain('Approve');
    expect(out).not.toContain('Record a form version');
    expect(out).toContain('MEOWS chart Not in the register yet (manual code OBG-F-05)');
    expect(out).not.toMatch(/!/);
  });

  it('the printed form box names the code and version, or says the form is not in the register', () => {
    expect(text(<FormBox form={{ code: 'OBG-F-16', title: 'Surgical safety checklist', version: '1.0', effectiveFrom: '2026-10-01' }} screenLabel="x" />)).toMatch(/^OBG-F-16 Surgical safety checklist Version 1\.0 · in force from 1 Oct 2026$/);
    expect(text(<FormBox form={null} screenLabel="MEOWS chart" />)).toBe('No form code MEOWS chart: not in the document register yet');
  });
});
