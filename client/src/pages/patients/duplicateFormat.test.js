// The words of the "may already be registered" warning and of a record marked as a duplicate (fake sample data).
import { describe, expect, it } from 'vitest';
import { formatDate } from '../../components/ui.jsx';
import {
  MAIN_SEARCH_ASKED,
  MAIN_SEARCH_SHOWN,
  canBeMainRecord,
  earlierRecordsLabel,
  historyLine,
  leftBehindLines,
  mainRecordChoices,
  markedMessage,
  matchFacts,
  matchedOnText,
  matchesTitle,
  moreMatchesText,
  moreVisitsHere,
  reasonProblem,
  sameKindOfRecord,
  undoneMessage,
} from './duplicateFormat.js';

describe('the "may already be registered" warning', () => {
  it('speaks of "she", and of "this baby" for a newborn', () => {
    expect(matchesTitle('antenatal')).toBe('She may already be registered');
    expect(matchesTitle('gynaecology')).toBe('She may already be registered');
    expect(matchesTitle('newborn')).toBe('This baby may already be registered');
  });

  it('says why a record is shown', () => {
    expect(matchedOnText({ matchedOn: ['phone', 'name'] })).toBe('Same phone number and name');
    expect(matchedOnText({ matchedOn: ['phone'] })).toBe('Same phone number');
    expect(matchedOnText({ matchedOn: ['name'] })).toBe('Same name');
    expect(matchedOnText({})).toBe('Possible match');
  });

  it('lists only the facts the server sent: number, age, doctor, the end of the phone number', () => {
    const full = { mrn: 'P-000001', fullName: 'Asha Sample', baby: false, age: 28, doctorName: 'Dr. Sample', phoneEnd: '3210' };
    expect(matchFacts(full)).toEqual(['P-000001', '28 yrs', 'Doctor: Dr. Sample', 'Phone ending 3210']);
    expect(matchFacts({ ...full, doctorName: null, phoneEnd: '' })).toEqual(['P-000001', '28 yrs', 'No doctor assigned', 'No phone number']);
    // What the person registering may not see is left out, not shown empty
    expect(matchFacts({ mrn: 'P-000002', fullName: 'Asha Sample', baby: false })).toEqual(['P-000002']);
    const now = new Date('2026-10-04T10:00:00Z');
    expect(matchFacts({ mrn: 'P-000003', baby: true, birthAt: '2026-09-27T10:00:00Z', doctorName: null, phoneEnd: '0001' }, now)).toEqual(['P-000003', '7 days old', 'No doctor assigned', 'Phone ending 0001']);
    expect(matchFacts({ mrn: 'P-000003', baby: true }, now)).toEqual(['P-000003']);
  });

  it('says when more records match than are shown', () => {
    expect(moreMatchesText(5, 5)).toBe('');
    expect(moreMatchesText(1, 1)).toBe('');
    expect(moreMatchesText(6, 5)).toBe('and 1 more record with the same phone number or name – look in the Patients list.');
    expect(moreMatchesText(9, 5)).toBe('and 4 more records with the same phone number or name – look in the Patients list.');
    expect(moreMatchesText(undefined, 0)).toBe('');
  });
});

describe('marking a record as a duplicate', () => {
  const adult = { id: 'a1', careType: 'antenatal' };
  it("joins a baby's record only with a baby's, and never a record with itself or with a duplicate", () => {
    expect(sameKindOfRecord({ careType: 'postnatal' }, { careType: 'gynaecology' })).toBe(true);
    expect(sameKindOfRecord({ careType: 'newborn' }, { careType: 'newborn' })).toBe(true);
    expect(sameKindOfRecord({ careType: 'newborn' }, { careType: 'postnatal' })).toBe(false);
    expect(canBeMainRecord(adult, { id: 'a2', careType: 'infertility' })).toBe(true);
    expect(canBeMainRecord(adult, { id: 'a1', careType: 'antenatal' })).toBe(false);
    expect(canBeMainRecord(adult, { id: 'b1', careType: 'newborn' })).toBe(false);
    expect(canBeMainRecord(adult, { id: 'a3', careType: 'antenatal', duplicateOf: { mrn: 'P-000009' } })).toBe(false);
  });

  it('asks for a reason of at least 5 characters', () => {
    expect(reasonProblem('')).toMatch(/at least 5 characters/);
    expect(reasonProblem('  ab  ')).toMatch(/at least 5 characters/);
    expect(reasonProblem('Same woman')).toBeNull();
  });

  it('offers the main record after leaving out what cannot be one – and says when to type more', () => {
    const baby = { id: 'b0', careType: 'newborn' };
    // The mother's records come first in the search; the other baby is further down
    const found = [{ id: 'm1', careType: 'postnatal' }, { id: 'm2', careType: 'antenatal' }, { id: 'b0', careType: 'newborn' }, { id: 'b1', careType: 'newborn' }];
    expect(mainRecordChoices(baby, found)).toEqual({ shown: [{ id: 'b1', careType: 'newborn' }], more: false });
    expect(mainRecordChoices(adult, [])).toEqual({ shown: [], more: false });
    expect(mainRecordChoices(adult, undefined)).toEqual({ shown: [], more: false });
    // A full page from the server: there may be more than were looked at
    const page = Array.from({ length: MAIN_SEARCH_ASKED }, (_, n) => ({ id: `p${n}`, careType: 'gynaecology' }));
    const many = mainRecordChoices(adult, page);
    expect(many.shown).toHaveLength(MAIN_SEARCH_SHOWN);
    expect(many.more).toBe(true);
    expect(mainRecordChoices(baby, page)).toEqual({ shown: [], more: true }); // none fits, but there may be more: "type more"
    expect(MAIN_SEARCH_ASKED).toBeGreaterThan(MAIN_SEARCH_SHOWN);
  });

  const DETAILS = [
    { key: 'allergy', text: 'Penicillin – rash', onMain: 'none' },
    { key: 'bloodGroup', value: 'O-', onMain: '' },
    { key: 'conditions', values: ['asthma', 'thyroid'] },
    { key: 'otherConditions', text: 'Migraine' },
    { key: 'previousCaesareans', value: 1 },
    { key: 'pastComplications', values: ['pph'] },
    { key: 'pregnancyDates', edd: '2027-03-01', onMain: null },
    { key: 'findings', values: ['gdm'] },
    { key: 'risk', level: 'high', onMain: null },
    { key: 'carePlan' },
  ];
  it('writes what only the duplicate has, one line each', () => {
    expect(leftBehindLines(DETAILS, 'P-000001', formatDate)).toEqual([
      'Allergy: Penicillin – rash (P-000001: none known)',
      'Blood group O- (P-000001: not known)',
      'Conditions: Asthma, Thyroid disease',
      'Other conditions: Migraine',
      '1 previous caesarean',
      'Problems in previous pregnancies: Heavy bleeding after delivery (PPH)',
      'Pregnancy dates: EDD 1 Mar 2027 (P-000001: no dates)',
      'Findings in this pregnancy: Gestational diabetes (GDM)',
      'High risk (P-000001: no risk level)',
      'A care plan in use (P-000001 has none)',
    ]);
    expect(
      leftBehindLines(
        [
          { key: 'allergy', text: 'Sulfa', onMain: 'recorded' },
          { key: 'allergy', text: 'Sulfa', onMain: 'not_asked' },
          { key: 'bloodGroup', value: 'A+', onMain: 'B+' },
          { key: 'pregnancyDates', edd: '2027-03-01', onMain: '2027-03-20' },
          { key: 'risk', level: 'moderate', onMain: 'low' },
          { key: 'something_new' },
        ],
        'P-000001',
        formatDate,
      ),
    ).toEqual(['Allergy: Sulfa (P-000001: another note)', 'Allergy: Sulfa (P-000001: not recorded)', 'Blood group A+ (P-000001: B+)', 'Pregnancy dates: EDD 1 Mar 2027 (P-000001: EDD 20 Mar 2027)', 'Moderate risk (P-000001: low risk)']);
    expect(leftBehindLines([], 'P-000001')).toEqual([]);
    expect(leftBehindLines(undefined, 'P-000001')).toEqual([]);
  });

  it('says when the record being marked is the one with the visits', () => {
    expect(moreVisitsHere({ here: 5, main: 0 }, 'P-000001')).toBe('This record has 5 visits, P-000001 has none. If this is the record with her history, keep it: open P-000001 and mark that one as the duplicate instead.');
    expect(moreVisitsHere({ here: 1, main: 0 }, 'P-000001', true)).toBe("This record has 1 visit, P-000001 has none. If this is the record with the baby's history, keep it: open P-000001 and mark that one as the duplicate instead.");
    expect(moreVisitsHere({ here: 3, main: 2 }, 'P-000001')).toMatch(/^This record has 3 visits, P-000001 has 2\./);
    for (const visits of [{ here: 0, main: 0 }, { here: 2, main: 2 }, { here: 1, main: 4 }, undefined]) expect(moreVisitsHere(visits, 'P-000001')).toBe('');
  });

  it('says what happened, and what staff must still do – never how many bills she has', () => {
    const main = { id: 'm', mrn: 'P-000001' };
    const BILLS = 'Any open bill stays on this record for reception to settle.';
    expect(markedMessage({ main, appointmentsMoved: 0, arrivedToday: false })).toBe(`Marked as a duplicate of P-000001. Nothing was moved or deleted. ${BILLS}`);
    // The sentence about bills is the same every time: the doctor or RMO who marks does not see billing
    expect(markedMessage({ main, appointmentsMoved: 1, openBills: 3, arrivedToday: false })).toBe(`Marked as a duplicate of P-000001. Nothing was moved or deleted. 1 appointment from today on is now on P-000001. ${BILLS}`);
    expect(markedMessage({ main, appointmentsMoved: 2, arrivedToday: true })).toBe(
      `Marked as a duplicate of P-000001. Nothing was moved or deleted. 2 appointments from today on are now on P-000001. ${BILLS} She was marked as arrived today on this record: mark her as arrived on P-000001, so that she stays on today's waiting list.`,
    );
    expect(markedMessage({})).toMatch(/^Marked as a duplicate of the main record\./);
    // What only this record has is said again, with what to do about her reminders and her ABHA
    const full = markedMessage({ main, appointmentsMoved: 0, details: DETAILS.slice(0, 2), remindersHere: true, abhaHere: true }, { formatDate });
    expect(full).toContain('This record has details that P-000001 does not have – copy what still applies to P-000001: Allergy: Penicillin – rash (P-000001: none known); Blood group O- (P-000001: not known).');
    expect(full).toContain('She agreed to reminders on this record only: ask again and record it on P-000001 (More → Reminders and portal), or no reminders are sent.');
    expect(full).toContain('Her ABHA is linked on this record: unlink it here and link it on P-000001 (ABHA tab).');
    // A baby's record is never "she" or "her"
    const baby = markedMessage({ main, appointmentsMoved: 1, arrivedToday: true, remindersHere: true, abhaHere: true }, { baby: true });
    expect(baby).toContain("The baby was marked as arrived today on this record: mark the baby as arrived on P-000001, so that the baby stays on today's waiting list.");
    expect(baby).toContain('The parents agreed to reminders on this record only');
    expect(baby).not.toMatch(/\b(she|her)\b/i);
    expect(full).not.toContain('!');
  });

  it('says what undo did', () => {
    expect(undoneMessage({ undone: true, appointmentsMoved: 0 })).toBe('The duplicate marking was removed: this record is in use again.');
    expect(undoneMessage({ undone: true, appointmentsMoved: 2 })).toBe('The duplicate marking was removed: this record is in use again. 2 appointments came back to this record.');
    expect(undoneMessage({ undone: false, appointmentsMoved: 0 })).toBe('This record was not marked as a duplicate.');
    // Today's appointment came back while she was marked as arrived on the main record
    expect(undoneMessage({ undone: true, appointmentsMoved: 1, arrivedOnMain: true, main: { mrn: 'P-000001' } })).toBe(
      "The duplicate marking was removed: this record is in use again. 1 appointment came back to this record. She was marked as arrived today on P-000001: mark her as arrived on this record, so that she stays on today's waiting list.",
    );
    expect(undoneMessage({ undone: true, appointmentsMoved: 1, arrivedOnMain: true, main: { mrn: 'P-000001' } }, { baby: true })).toContain('The baby was marked as arrived today on P-000001: mark the baby as arrived on this record');
  });

  it('labels the earlier records, and writes an undone marking as a sentence', () => {
    expect(earlierRecordsLabel([{ mrn: 'P-000002' }])).toBe('Earlier record');
    expect(earlierRecordsLabel([{ mrn: 'P-000002' }, { mrn: 'P-000005' }])).toBe('Earlier records');
    const h = { mrn: 'P-000001', reason: 'Registered twice', byName: 'Dr. Sample', at: '2026-09-28T06:00:00Z', undoneByName: 'Sample RMO', undoneAt: '2026-09-29T06:00:00Z' };
    expect(historyLine(h, formatDate)).toBe('Marked as a duplicate of P-000001 by Dr. Sample on 28 Sep 2026: Registered twice. Undone by Sample RMO on 29 Sep 2026.');
    expect(historyLine({ mrn: 'P-000001', reason: '' }, formatDate)).toBe('Marked as a duplicate of P-000001.');
  });
});
