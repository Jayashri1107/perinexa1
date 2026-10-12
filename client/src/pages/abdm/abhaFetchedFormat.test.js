// Her records from other hospitals (ABDM milestone M3) in words: each request's and each hospital's status (colour,
// icon and word), what was withheld or not offered and why, and the "Ask" form's starting values. Made-up data only.
import { describe, expect, it } from 'vitest';
import {
  DAY_CHOICES,
  FETCH_HI_TYPES,
  LEFT_OUT_WORDS,
  PRACTICE_LABEL,
  PRACTICE_NOTE,
  dayOf,
  documentDate,
  documentStatusNote,
  documentType,
  fetchDefaults,
  fileLine,
  hospitalStatus,
  keptUntil,
  leftOutLine,
  requestLine,
  requestStatus,
  withheldNote,
  withheldSummary,
} from './abhaFetchedFormat.js';

const AT = '2026-10-05T06:00:00.000Z'; // midday in India, the same day everywhere
const request = { id: 'r1', status: 'waiting', hiTypes: ['OPConsultation', 'DiagnosticReport'], from: '2025-10-05T06:00:00Z', to: AT, days: 30, expiresAt: '2026-11-04T06:00:00Z', hospitals: [] };

describe('a request for her records', () => {
  it('each status with its icon and word – never colour alone', () => {
    expect(requestStatus({ ...request, status: 'requested' })).toMatchObject({ tone: 'due', label: 'Sent to ABDM' });
    expect(requestStatus(request)).toMatchObject({ tone: 'due', label: 'Waiting for her answer', hint: 'She agrees or refuses in her ABHA app. Nothing comes until she agrees.' });
    const granted = { ...request, status: 'granted', hospitals: [{ expiresAt: '2026-10-20T06:00:00Z' }, { expiresAt: '2026-11-04T06:00:00Z' }] };
    expect(requestStatus(granted)).toMatchObject({ tone: 'stable', label: 'She agreed', hint: '2 hospitals answered. Records kept until 20 Oct 2026, then deleted.' });
    expect(requestStatus({ ...request, status: 'granted' }).hint).toBe('No hospital has records for her of these kinds and dates.');
    expect(requestStatus({ ...request, status: 'denied' })).toMatchObject({ tone: 'inactive', label: 'She refused' });
    expect(requestStatus({ ...request, status: 'revoked', hospitals: [{}] })).toMatchObject({ label: 'She withdrew her consent', hint: 'Every record received with it was deleted.' });
    expect(requestStatus({ ...request, status: 'expired', hospitals: [{}] }).label).toBe('Consent ended');
    expect(requestStatus({ ...request, status: 'expired' })).toMatchObject({ label: 'No answer', hint: 'She did not answer in time. Nothing was received.' });
    // She agreed, but no hospital had records: never "she did not answer"
    expect(requestStatus({ ...request, status: 'expired', agreed: true })).toMatchObject({ label: 'Ended – nothing came', hint: 'She agreed, but no hospital had records for her of these kinds and dates. The request has ended.' });
    expect(requestStatus({ ...request, status: 'failed', error: 'Sample refusal' })).toMatchObject({ tone: 'high', label: 'ABDM refused the request', hint: 'ABDM said: Sample refusal' });
    for (const status of ['requested', 'waiting', 'granted', 'denied', 'revoked', 'expired', 'failed']) expect(requestStatus({ ...request, status }).icon, status).toBeTruthy();
    expect(keptUntil(granted)).toBe('2026-10-20T06:00:00Z');
  });

  it('what was asked, in one line', () => {
    expect(requestLine(request)).toBe('Consultation, Lab or scan report · records of 5 Oct 2025 to 5 Oct 2026 · consent for 30 days');
  });

  it('the form starts with the last 12 months, every kind of record and 30 days; the choices of how long', () => {
    expect(fetchDefaults(new Date(2026, 9, 5, 12))).toEqual({ from: '2025-10-05', to: '2026-10-05', hiTypes: FETCH_HI_TYPES, days: 30 });
    expect(FETCH_HI_TYPES).toHaveLength(7);
    expect(DAY_CHOICES.map((c) => c.days)).toEqual([7, 30, 90, 180, 365]);
  });
});

describe('each hospital, and each document', () => {
  it('waiting, received (with what came), not received, deleted – with why', () => {
    expect(hospitalStatus({ step: 'details' })).toMatchObject({ tone: 'due', label: 'Waiting for the consent' });
    expect(hospitalStatus({ step: 'asked' })).toMatchObject({ tone: 'due', label: 'Waiting for the records' });
    expect(hospitalStatus({ step: 'received', documents: 3, files: 1, filesLeftOut: 1, withheld: 1, failed: 0 })).toMatchObject({
      tone: 'stable',
      label: '3 documents received',
      hint: '1 file to download, 1 file not offered, 1 sentence withheld (PC-PNDT).',
    });
    expect(hospitalStatus({ step: 'received', documents: 1, files: 0, filesLeftOut: 0, withheld: 0, failed: 2 }).hint).toBe('2 could not be read.');
    expect(hospitalStatus({ step: 'failed', error: 'Sample reason.' })).toMatchObject({ tone: 'high', label: 'Not received', hint: 'Sample reason.' });
    expect(hospitalStatus({ step: 'deleted', deletedAt: AT, deletedWhy: 'revoked' })).toMatchObject({ tone: 'inactive', label: 'Deleted', hint: 'Deleted 5 Oct 2026 – she withdrew her consent.' });
    expect(hospitalStatus({ step: 'deleted', deletedAt: AT, deletedWhy: 'expired' }).hint).toBe('Deleted 5 Oct 2026 – her consent ended.');
  });

  it('the type in words; withheld sentences said plainly; files not offered and why; file sizes', () => {
    expect(documentType({ hiType: 'DiagnosticReport' })).toBe('Lab or scan report');
    expect(documentType({ hiType: '', typeText: 'Sample type' })).toBe('Sample type');
    expect(documentType({ hiType: '' })).toBe('Health record');
    expect(withheldNote(1)).toBe("A sentence was withheld here: it may mention a baby's sex (PC-PNDT Act).");
    expect(withheldNote(2)).toBe("2 sentences were withheld here: they may mention a baby's sex (PC-PNDT Act).");
    expect(withheldSummary(1)).toMatch(/^1 sentence withheld: it may mention a baby's sex \(PC-PNDT Act\)\./);
    expect(leftOutLine({ title: 'Sample page', why: 'type' })).toBe('Sample page: not a PDF, JPEG or PNG file – not offered, for safety');
    expect(leftOutLine({ title: '', why: 'link' })).toBe('Attached file: a link to another website – never opened');
    expect(fileLine({ contentType: 'application/pdf', size: 785 })).toBe('PDF, 785 bytes');
    expect(fileLine({ contentType: 'image/png', size: 12 * 1024 })).toBe('PNG picture, 12 KB');
    expect(fileLine({ contentType: 'image/jpeg', size: 1.5 * 1024 * 1024 })).toBe('JPEG photo, 1.5 MB');
    expect(dayOf(AT)).toBe('5 Oct 2026');
    expect(dayOf(null)).toBe('');
    // A document's own date only – never the day it was sent or received
    expect(documentDate({ date: AT, receivedAt: AT })).toBe('5 Oct 2026');
    expect(documentDate({ date: null, receivedAt: AT })).toBe('Date not given');
    // The other hospital's status of the whole document
    expect(documentStatusNote('entered-in-error')).toEqual({ type: 'error', text: 'The other hospital marked this whole document as entered in error: it is not valid. Do not act on it.' });
    expect(documentStatusNote('preliminary').type).toBe('warning');
    expect(documentStatusNote('amended').type).toBe('info');
    expect(documentStatusNote('')).toBeNull();
    expect(PRACTICE_LABEL).toBe('Practice – made up');
    for (const line of [PRACTICE_NOTE, documentStatusNote('entered-in-error').text, documentStatusNote('preliminary').text]) expect(line).not.toMatch(/!/);
    for (const line of [...Object.values(LEFT_OUT_WORDS), withheldNote(1), withheldSummary(2), requestStatus(request).hint]) expect(line).not.toMatch(/!/);
  });
});
