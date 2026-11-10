// The medical records module: the words of its lists, the 72-hour rule of the copies register, and who has the
// Records menu (no browser needed).
import { describe, expect, it } from 'vitest';
import { RECORDS_ROLES, hospitalModules, patientTabs } from '../../platform/modules.js';
import { COPY_WHATS, COPY_WHAT_LABELS, DOC_TYPES, DOC_TYPE_LABELS, GIVEN_TO, GIVEN_TO_LABELS, GIVEN_TO_WORDS, INCOMPLETE_KINDS, INCOMPLETE_KIND_LABELS, RECEIVER_NAME_NEEDED, RECORDS_TABS, copyLate, copyTimingWords, hoursToGive } from './recordLists.js';

describe('the records module', () => {
  it('every kind, receiver and list has plain words; identity documents are not a kind', () => {
    expect(Object.keys(DOC_TYPE_LABELS)).toEqual(DOC_TYPES);
    expect(Object.keys(COPY_WHAT_LABELS)).toEqual(COPY_WHATS);
    expect(Object.keys(GIVEN_TO_LABELS)).toEqual(GIVEN_TO);
    expect(Object.keys(GIVEN_TO_WORDS)).toEqual(GIVEN_TO);
    expect(Object.keys(INCOMPLETE_KIND_LABELS)).toEqual(INCOMPLETE_KINDS);
    expect(DOC_TYPES.join(' ')).not.toMatch(/aadhaar|identity|id_card/i);
    expect(RECEIVER_NAME_NEEDED).toEqual(GIVEN_TO.filter((k) => k !== 'patient'));
    expect(RECORDS_TABS.map((t) => t.to)).toEqual(['/records', '/records/incomplete', '/records/copies']);
    for (const w of [...Object.values(DOC_TYPE_LABELS), ...Object.values(GIVEN_TO_LABELS), ...Object.values(INCOMPLETE_KIND_LABELS)]) expect(w).not.toMatch(/!/);
  });

  it('a copy is due within 72 hours of the request', () => {
    const now = new Date('2026-11-09T06:00:00Z');
    expect(hoursToGive({ requestedOn: null, givenOn: '2026-11-09' }, now)).toBeNull();
    expect(hoursToGive({ requestedOn: '2026-11-06', givenOn: '2026-11-09' }, now)).toBe(72);
    expect(copyLate({ requestedOn: '2026-11-06', givenOn: '2026-11-09' }, now)).toBe(false); // exactly 72 hours: in time
    expect(copyLate({ requestedOn: '2026-11-05', givenOn: '2026-11-09' }, now)).toBe(true);
    expect(copyLate({ requestedOn: '2026-11-04', givenOn: null }, now)).toBe(true); // asked 5 days ago, still not given
    expect(copyLate({ requestedOn: null, givenOn: null }, now)).toBe(false);
    expect(copyTimingWords({ requestedOn: null, givenOn: '2026-11-09' }, now)).toBe('');
    expect(copyTimingWords({ requestedOn: '2026-11-09', givenOn: '2026-11-09' }, now)).toBe('Given the same day as the request');
    expect(copyTimingWords({ requestedOn: '2026-11-08', givenOn: '2026-11-09' }, now)).toBe('Given 1 day after the request');
    expect(copyTimingWords({ requestedOn: '2026-11-05', givenOn: '2026-11-09' }, now)).toBe('Given 4 days after the request – over 72 hours');
    expect(copyTimingWords({ requestedOn: '2026-11-04', givenOn: null }, now)).toBe('Requested 5 days ago – over 72 hours');
    expect(copyTimingWords({ requestedOn: '2026-11-08', givenOn: null }, now)).toBe('Requested, not given yet');
  });

  it('the Records menu: the medical records login, doctors and RMOs; the records login finds patients but registers none', () => {
    expect(RECORDS_ROLES).toEqual(['records', 'doctor', 'rmo']);
    for (const role of RECORDS_ROLES) expect(hospitalModules([role]).map((m) => m.label), role).toContain('Records');
    for (const role of ['nurse', 'receptionist', 'lab', 'pharmacist', 'sonographer', 'billing', 'referral_desk', 'admin', 'followup_coordinator', 'quality']) expect(hospitalModules([role]).map((m) => m.label), role).not.toContain('Records');
    expect(hospitalModules(['records']).map((m) => m.label)).toEqual(['Today', 'Patients', 'Records']);
    expect(patientTabs(['records']).map((t) => t.label)).toEqual(['All patients']);
  });
});
