// Clinical Requirements Group A, item 3: a specimen's status is colour, icon and word; overdue after 21 days in red.
// Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { specimenLook } from './specimenFormat.js';

vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['doctor'] } }) }));
const { SpecimenList } = await import('./SpecimenList.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const s = (over) => ({ id: 'a1', serial: 7, patientId: 'p1', patient: { fullName: 'Sample Patient', mrn: 'P-000001' }, kind: 'histopathology', specimen: 'Uterus', procedure: '', sentAt: '2026-10-01T05:00:00Z', lab: '', status: 'sent', days: 3, overdue: false, report: null, review: null, ...over });

describe('specimens', () => {
  it('says waiting, overdue, to review, reviewed or cancelled – each with its own tone and icon', () => {
    expect(specimenLook(s())).toMatchObject({ tone: 'watch', word: 'Waiting – 3 days' });
    expect(specimenLook(s({ days: 25, overdue: true }))).toMatchObject({ tone: 'high', word: 'Overdue – 25 days' });
    expect(specimenLook(s({ status: 'reported' }))).toMatchObject({ tone: 'due', word: 'Report to review' });
    expect(specimenLook(s({ status: 'reviewed' }))).toMatchObject({ tone: 'stable', word: 'Reviewed' });
    expect(specimenLook(s({ status: 'cancelled' }))).toMatchObject({ tone: 'inactive', word: 'Cancelled' });
    for (const look of [specimenLook(s()), specimenLook(s({ overdue: true }))]) expect(look.icon).toBeTruthy();
  });

  it('offers the next step: enter the report while waiting, review once reported (doctors and RMOs)', () => {
    const out = text(<SpecimenList specimens={[s(), s({ id: 'a2', serial: 8, status: 'reported', report: { summary: 'Benign', file: { fileName: 'r.pdf' } } })]} loading={false} />);
    expect(out).toContain('Sample Patient · P-000001');
    expect(out).toContain('Histopathology: Uterus');
    expect(out).toContain('Enter report');
    expect(out).toContain('Review');
    expect(out).toContain('Open report file');
  });
});
