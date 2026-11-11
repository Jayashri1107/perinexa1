// A doctor registers a patient the department rule hides from them (owner, 9 Nov 2026): the form says where she is
// instead of opening a record that would only say "Patient not found"; and "Patient not found" is said only when the
// server said so – a server or connection problem offers "Try again". Rendered to HTML (no browser). Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { doctorsOffered } from '../../platform/departments.js';
import { PatientNotOpened } from './PatientNotFound.jsx';
import { hiddenRegistrationNote } from './patientFormat.js';

const text = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const page = (status, error = 'Patient not found.') => text(<PatientNotOpened status={status} error={error} tenantName="Sample Hospital" breadcrumbs={[{ label: 'Patients', to: '/patients' }]} onRetry={() => {}} />);

describe('a new patient whose record is hidden from the doctor who registered her', () => {
  it('says her department and doctor, or that she is outside their departments', () => {
    expect(hiddenRegistrationNote({ department: 'Pediatric', assignedDoctorName: 'Dr. Sample' })).toBe(
      'Her record is with Pediatric, Dr. Sample, so it does not open for you. Reception, an RMO or that department’s doctors can open it.',
    );
    expect(hiddenRegistrationNote({ department: 'Obgy', assignedDoctorName: null })).toMatch(/^Her record is with Obgy, so it does not open for you\./);
    expect(hiddenRegistrationNote({ department: '', assignedDoctorName: null })).toMatch(/^Her record is outside your departments/);
    expect(hiddenRegistrationNote({ department: 'Obgy' })).not.toMatch(/!/);
  });
});

describe('the doctors offered once a department is chosen', () => {
  const doctors = [
    { id: 'obgy', name: 'Dr. Obgy', departments: ['Obgy'] },
    { id: 'peds', name: 'Dr. Peds', department: 'Pediatric' },
    { id: 'none', name: 'Dr. No Department', departments: [] },
  ];
  const ids = (...a) => doctorsOffered(doctors, ...a).map((d) => d.id);
  it('that department’s doctors; every doctor when none is chosen', () => {
    expect(ids('Obgy')).toEqual(['obgy']);
    expect(ids('')).toEqual(['obgy', 'peds', 'none']);
  });
  it('always the doctor registering her, even without that department – so her name does not disappear', () => {
    expect(ids('Obgy', { me: 'none' })).toEqual(['obgy', 'none']);
    expect(ids('Obgy', { me: 'peds' })).toEqual(['obgy', 'peds']);
  });
  it('and the doctor already chosen, so the list never shows a different name from the one saved', () => {
    expect(ids('Obgy', { current: 'peds' })).toEqual(['obgy', 'peds']);
  });
});

describe('a record that could not be opened', () => {
  it('"Patient not found" when the server said so', () => {
    for (const status of [400, 403, 404]) {
      expect(page(status)).toContain('Patient not found');
      expect(page(status)).toMatch(/This patient doesn't exist in Sample Hospital ?, or you don't have access\./);
      expect(page(status)).not.toContain('Try again');
    }
  });

  it('a server or connection problem says so, with Try again', () => {
    for (const status of [null, 0, 500, 503, 429]) {
      const t = page(status, "Can't reach the server. Please check that the app is running.");
      expect(t, String(status)).toContain('Record not opened');
      expect(t).toContain("The patient's record could not be opened: Can't reach the server.");
      expect(t).toContain('Try again');
      expect(t).not.toContain('Patient not found');
    }
  });
});
