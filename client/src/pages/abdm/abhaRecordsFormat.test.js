// Her records in ABHA (ABDM milestone M2) in words: statuses (colour, icon and word), why a record is not shared, the
// consents and what was sent. Made-up data only.
import { describe, expect, it } from 'vitest';
import { CONFIDENTIAL_DRAFT_NOTE, NEVER_SHARED, REASON_WORDS, canChoose, consentLine, consentStatus, practiceConsentDefaults, recordCounts, recordStatus, transferLine, transferStatus, typesLine } from './abhaRecordsFormat.js';

const AT = '2026-10-05T06:00:00.000Z'; // midday in India, the same day everywhere
const visit = { reference: 'V-1', kind: 'visit', display: 'OPD visit on 21 Sep 2026', hiTypes: ['OPConsultation', 'Prescription'], state: 'ready', reason: null, link: null };

describe('a record’s status', () => {
  it('can be linked, linked by the hospital or from her app, waiting, refused by ABDM', () => {
    expect(recordStatus(visit)).toMatchObject({ tone: 'neutral', label: 'Can be linked', hint: '' });
    expect(recordStatus({ ...visit, link: { status: 'linked', via: 'hospital', byName: 'Dr Sample', at: AT } })).toMatchObject({ tone: 'stable', label: 'Linked', hint: 'Linked by Dr Sample, 5 Oct 2026.' });
    expect(recordStatus({ ...visit, link: { status: 'linked', via: 'patient', byName: '', at: AT } }).hint).toBe('Linked from her ABHA app, 5 Oct 2026.');
    expect(recordStatus({ ...visit, link: { status: 'waiting' } })).toMatchObject({ tone: 'due', label: 'Waiting for ABDM' });
    expect(recordStatus({ ...visit, link: { status: 'failed', error: 'ABDM refused: sample refusal.' } })).toMatchObject({ tone: 'high', label: 'Not linked', hint: 'ABDM refused: sample refusal. It can be linked again.' });
    expect(recordStatus({ ...visit, link: { status: 'failed', error: '' } }).hint).toBe('It can be linked again.');
    // ABDM did not answer for 30 minutes: said, and it can be ticked again
    const silent = { ...visit, link: { status: 'no_answer' } };
    expect(recordStatus(silent)).toMatchObject({ tone: 'high', label: 'No answer from ABDM', hint: 'ABDM did not answer within 30 minutes. It can be linked again.' });
    expect(canChoose(silent)).toBe(true);
    expect(recordStatus(silent).icon).toBeTruthy();
    for (const s of [recordStatus(visit), recordStatus({ ...visit, state: 'never', reason: 'entered_in_error' })]) expect(s.icon).toBeTruthy(); // never colour alone
  });

  it('linked but not shared now (changed since, or marked sensitive); a link to her earlier ABHA does not count', () => {
    expect(recordStatus({ ...visit, state: 'not_yet', reason: 'lab_not_reviewed', link: { status: 'linked', via: 'hospital', byName: 'Dr Sample', at: AT } })).toMatchObject({
      tone: 'watch',
      label: 'Linked – not shared now',
      hint: `Linked by Dr Sample, 5 Oct 2026. ${REASON_WORDS.lab_not_reviewed}`,
    });
    const earlier = { ...visit, link: { status: 'linked', via: 'hospital', at: AT, earlierAbha: true } };
    expect(recordStatus(earlier)).toMatchObject({ label: 'Can be linked', hint: 'Linked to her earlier ABHA – link it again to her ABHA now.' });
    expect(canChoose(earlier)).toBe(true);
  });

  it('not yet, never shared – with the reason; the HIV test left out of a shared report', () => {
    expect(recordStatus({ ...visit, state: 'not_yet', reason: 'visit_not_signed' })).toMatchObject({ tone: 'inactive', label: 'Not yet', hint: 'The visit is not signed yet.' });
    expect(recordStatus({ ...visit, state: 'never', reason: 'confidential_test' })).toMatchObject({ label: 'Never shared', hint: 'HIV test – confidential, never shared.' });
    expect(recordStatus({ ...visit, state: 'never', reason: 'sensitive_record' }).hint).toBe('Her record is marked sensitive.');
    expect(recordStatus({ ...visit, state: 'never', reason: 'hiv_on_record' }).hint).toBe('HIV is among her known conditions: her visits and discharge summaries are never shared (confidential).');
    expect(recordStatus({ ...visit, kind: 'lab', confidentialLeftOut: 1 }).hint).toBe('Shared without the HIV test (confidential).');
  });

  it('which can be ticked, and the counts', () => {
    const items = [visit, { ...visit, reference: 'V-2', link: { status: 'linked' } }, { ...visit, reference: 'V-3', link: { status: 'waiting' } }, { ...visit, reference: 'V-4', state: 'not_yet' }, { ...visit, reference: 'V-5', link: { status: 'failed' } }];
    expect(items.filter(canChoose).map((i) => i.reference)).toEqual(['V-1', 'V-5']);
    expect(recordCounts(items)).toEqual({ linked: 1, ready: 2 });
    expect(typesLine(visit.hiTypes)).toBe('Consultation, Prescription');
  });
});

describe('consents and what was sent', () => {
  it('status in words; what she agreed to', () => {
    expect(consentStatus({ status: 'GRANTED' })).toEqual({ tone: 'stable', label: 'Consent given' });
    expect(consentStatus({ status: 'REVOKED' }).label).toBe('Withdrawn');
    expect(consentStatus({ status: 'EXPIRED' }).label).toBe('Expired');
    expect(consentLine({ hiTypes: ['DiagnosticReport'], from: '2026-01-01T06:00:00Z', to: AT, expiresAt: '2026-11-04T06:00:00Z' })).toBe('Lab report · records of 1 Jan 2026 to 5 Oct 2026 · until 4 Nov 2026');
  });

  it('each request in words – counts only', () => {
    expect(transferLine({ status: 'sent', records: 3, documents: 4, heldBack: 1 })).toBe('Sent: 3 records (4 documents), 1 record held back.');
    expect(transferLine({ status: 'sent', records: 1, documents: 1, heldBack: 0 })).toBe('Sent: 1 record (1 document).');
    expect(transferLine({ status: 'refused', refusal: 'consent_revoked' })).toBe('Nothing sent: the consent was withdrawn.');
    expect(transferLine({ status: 'refused', refusal: 'consent_expired' })).toBe('Nothing sent: the consent had expired.');
    expect(transferLine({ status: 'nothing_to_send', heldBack: 2 })).toBe('Nothing sent: none of the records may be shared now, 2 records held back.');
    expect(transferLine({ status: 'failed', error: 'The records were not accepted (500).' })).toBe('Not sent: The records were not accepted (500).');
  });

  it('each request as a status – colour, icon and word – with the counts as the hint', () => {
    expect(transferStatus({ status: 'sent', records: 3, documents: 4, heldBack: 1 })).toMatchObject({ tone: 'stable', label: 'Sent', hint: '3 records (4 documents), 1 record held back.' });
    expect(transferStatus({ status: 'refused', refusal: 'consent_revoked' })).toMatchObject({ tone: 'inactive', label: 'Nothing sent', hint: 'The consent was withdrawn.' });
    expect(transferStatus({ status: 'refused', refusal: 'consent_incomplete' }).hint).toBe('The consent did not say its dates or until when it lasts.');
    expect(transferStatus({ status: 'working' })).toMatchObject({ tone: 'due', label: 'Being sent' });
    expect(transferStatus({ status: 'failed', error: 'The records were not accepted (500).' })).toMatchObject({ tone: 'high', label: 'Not sent', hint: 'The records were not accepted (500).' });
    expect(transferStatus({ status: 'nothing_to_send', heldBack: 2 })).toMatchObject({ tone: 'inactive', label: 'Nothing sent', hint: 'None of the records may be shared now, 2 records held back.' });
    for (const status of ['sent', 'refused', 'working', 'failed', 'nothing_to_send']) expect(transferStatus({ status, records: 0, documents: 0, heldBack: 0 }).icon, status).toBeTruthy();
  });

  it('what is never shared is said plainly; the practice consent starts with the last 12 months', () => {
    expect(NEVER_SHARED.join(' ')).toMatch(/sensitive/);
    expect(NEVER_SHARED.join(' ')).toMatch(/HIV/);
    expect(NEVER_SHARED.join(' ')).toMatch(/private note/);
    expect(NEVER_SHARED.join(' ')).toMatch(/entered in error/);
    expect(NEVER_SHARED.join(' ')).toMatch(/HIV is among her known conditions/);
    // Procedures written on a discharge summary are shared with it: never said to be withheld
    expect(NEVER_SHARED.join(' ')).toMatch(/A discharge summary still lists the procedures/);
    expect(NEVER_SHARED.join(' ')).not.toMatch(/scans and procedures/);
    expect(CONFIDENTIAL_DRAFT_NOTE).toMatch(/draft list, to be checked by the hospital's doctor/);
    for (const line of [...NEVER_SHARED, ...Object.values(REASON_WORDS), CONFIDENTIAL_DRAFT_NOTE]) expect(line).not.toMatch(/!/);
    expect(practiceConsentDefaults(new Date(2026, 9, 5, 12))).toEqual({ from: '2025-10-05', to: '2026-10-05', hiTypes: ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary'], days: 30 });
    // Just after midnight it is already the new day on this computer (not yesterday, as the UTC date would say in India)
    expect(practiceConsentDefaults(new Date(2026, 9, 5, 0, 30)).to).toBe('2026-10-05');
  });
});
