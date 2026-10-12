// Duplicate records on the screens (rendered to HTML, no browser): the "may already be registered" warning, the
// banner on a duplicate, "Earlier record" on the main record, the undone markings and the "Mark as a duplicate"
// pop-up. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DuplicateBanner, DuplicateHistory, EarlierRecordsNote, MarkDuplicateDialog, MarkingCheckNote } from './DuplicateDialogs.jsx';
import { PossibleMatchesDialog } from './PossibleMatchesDialog.jsx';

// A dialog remembers which button opened it (document.activeElement): there is no page here, so nothing was focused.
beforeAll(() => vi.stubGlobal('document', { activeElement: null }));
afterAll(() => vi.unstubAllGlobals());

const html = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

const MATCH = { id: 'm1', mrn: 'P-000001', fullName: 'Asha Sample', matchedOn: ['phone'], baby: false, age: 28, doctorName: 'Dr. Sample', phoneEnd: '3210' };

describe('"She may already be registered"', () => {
  it('shows the record, why it matches and the two choices; one record: opening it is the main button', () => {
    const out = html(<PossibleMatchesDialog careType="antenatal" matches={[MATCH]} total={1} onOpen={noop} onRegisterAnyway={noop} onBack={noop} />);
    const words = text(out);
    expect(words).toContain('She may already be registered');
    expect(words).toContain('A record with the same phone number or name is already in this hospital. Nothing was saved yet. If this is her, open her record. If it is someone else, register a new patient.');
    expect(words).toContain('Asha Sample');
    expect(words).toContain('P-000001 · 28 yrs · Doctor: Dr. Sample · Phone ending 3210');
    expect(words).toContain('Same phone number');
    expect(out).toMatch(/<button type="button" class="btn btn-primary btn-sm">Open this record<\/button>/);
    expect(out).toMatch(/<button type="button" class="btn btn-secondary">Register as a new patient anyway<\/button>/);
    expect(words).toContain('Back to the form');
    expect(out).toContain('role="alertdialog"');
    expect(out).not.toMatch(/!|infertility|antenatal/i); // no exclamation marks, and never a type of care
    expect(out.match(/btn-primary/g)).toHaveLength(1); // one primary button
  });

  it('several records: no button is the main one; more than are shown is said; a baby is "this baby"', () => {
    const second = { ...MATCH, id: 'm2', mrn: 'P-000007', fullName: 'Asha S', matchedOn: ['phone', 'name'], doctorName: null, phoneEnd: '' };
    const out = html(<PossibleMatchesDialog careType="gynaecology" matches={[second, MATCH]} total={4} onOpen={noop} onRegisterAnyway={noop} onBack={noop} openNote="Her appointment is added to the record you open." />);
    const words = text(out);
    expect(words).toContain('Records with the same phone number or name are already in this hospital.');
    expect(words).toContain('P-000007 · 28 yrs · No doctor assigned · No phone number');
    expect(words).toContain('Same phone number and name');
    expect(words).toContain('and 2 more records with the same phone number or name – look in the Patients list.');
    expect(words).toContain('Her appointment is added to the record you open.');
    expect(out).not.toContain('btn-primary');
    const baby = text(html(<PossibleMatchesDialog careType="newborn" matches={[{ id: 'b1', mrn: 'P-000009', fullName: 'Baby of Asha Sample', matchedOn: ['name'], baby: true }]} total={1} onOpen={noop} onRegisterAnyway={noop} onBack={noop} />));
    expect(baby).toContain('This baby may already be registered');
    expect(baby).toContain('If this is the same baby, open the record.');
    expect(baby).toContain('Same name');
  });

  it('while a choice is carried out the buttons wait, and a refusal is shown', () => {
    const out = html(<PossibleMatchesDialog careType="antenatal" matches={[MATCH]} total={1} onOpen={noop} onRegisterAnyway={noop} onBack={noop} busy="register" error="Please check the highlighted fields. Go back to the form to correct them." />);
    expect(out).toContain('Saving…');
    expect(out).not.toContain('Opening…');
    expect(out.match(/disabled=""/g)).toHaveLength(3);
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain('Go back to the form to correct them.');
  });

  it('"Open this record" never makes the other button read "Saving…": the pressed button says "Opening…"', () => {
    const second = { ...MATCH, id: 'm2', mrn: 'P-000007' };
    const out = html(<PossibleMatchesDialog careType="antenatal" matches={[MATCH, second]} total={2} onOpen={noop} onRegisterAnyway={noop} onBack={noop} busy="m2" />);
    expect(out).not.toContain('Saving…');
    expect(text(out)).toContain('Register as a new patient anyway');
    expect(out.match(/Opening…/g)).toHaveLength(1); // only the record that was pressed
    expect(out.match(/Open this record/g)).toHaveLength(1);
    expect(out.match(/disabled=""/g)).toHaveLength(4);
  });
});

const dup = (over = {}) => ({
  id: 'p2',
  mrn: 'P-000002',
  fullName: 'Asha S',
  careType: 'antenatal',
  duplicateOf: { id: 'p1', mrn: 'P-000001', byName: 'Dr. Sample', at: '2026-09-28T06:00:00.000Z' },
  duplicateReason: 'Registered twice at the desk',
  access: { canUndoDuplicate: true },
  ...over,
});

describe('a record marked as a duplicate', () => {
  it('says what it is, links to the main record, and offers Undo to those who may', () => {
    const out = html(<DuplicateBanner patient={dup()} onUndo={noop} />);
    const words = text(out);
    expect(words).toContain('Duplicate record. This record is marked as a duplicate of P-000001 . It can still be read, but it takes nothing new – no visits, prescriptions, lab orders, admissions, appointments, scans or bills.');
    expect(out.match(/href="\/patients\/p1"/g)).toHaveLength(2);
    expect(words).toContain('Marked by Dr. Sample on 28 Sep 2026. Reason: Registered twice at the desk');
    expect(words).toContain('Undo duplicate marking');
    expect(out).toContain('alert-warning');
    expect(out).toMatch(/<svg[^>]*lucide/); // an icon with the words, never colour alone
  });

  it('reception sees no reason and no Undo; a record that is not a duplicate shows nothing', () => {
    const out = html(<DuplicateBanner patient={dup({ duplicateReason: undefined, access: { canUndoDuplicate: false } })} onUndo={noop} />);
    expect(text(out)).toContain('Marked by Dr. Sample on 28 Sep 2026.');
    expect(out).not.toMatch(/Reason:|Undo/);
    expect(html(<DuplicateBanner patient={{ id: 'p1', access: {} }} onUndo={noop} />)).toBe('');
  });

  it("a baby's duplicate record is not spoken of as \"her\"", () => {
    const words = text(html(<DuplicateBanner patient={dup({ careType: 'newborn' })} onUndo={noop} />));
    expect(words).toContain("Use P-000001 for the baby's care.");
    expect(words).not.toMatch(/\b(she|her)\b/i);
    expect(text(html(<DuplicateBanner patient={dup()} onUndo={noop} />))).toContain('Use P-000001 for her care.');
  });

  it('the main record says what the earlier record has that it does not – for those the server sent it to', () => {
    const details = [{ id: 'p2', mrn: 'P-000002', details: [{ key: 'allergy', text: 'Penicillin – rash', onMain: 'none' }, { key: 'bloodGroup', value: 'O-', onMain: '' }, { key: 'carePlan' }] }];
    const out = html(<EarlierRecordsNote patient={{ id: 'p1', earlierRecords: [{ id: 'p2', mrn: 'P-000002' }], earlierRecordDetails: details }} />);
    const words = text(out);
    expect(words).toContain('Earlier record: P-000002 – marked as a duplicate of this record. Its visits, results and bills stay there.');
    expect(words).toContain('On P-000002 and not on this record: Allergy: Penicillin – rash (this record: none known); Blood group O- (this record: not known); A care plan in use (this record has none). Copy what still applies to this record (Edit details).');
    expect(out.match(/href="\/patients\/p2"/g)).toHaveLength(2);
    expect(out).not.toContain('!');
    // Reception gets no details from the server: only the link
    expect(text(html(<EarlierRecordsNote patient={{ id: 'p1', earlierRecords: [{ id: 'p2', mrn: 'P-000002' }] }} />))).not.toMatch(/Allergy|not on this record/);
  });

  it('the main record shows "Earlier record" with a link; nothing when there is none', () => {
    const one = html(<EarlierRecordsNote patient={{ id: 'p1', earlierRecords: [{ id: 'p2', mrn: 'P-000002' }] }} />);
    expect(text(one)).toBe('Earlier record: P-000002 – marked as a duplicate of this record. Its visits, results and bills stay there.');
    expect(one).toContain('href="/patients/p2"');
    const two = text(html(<EarlierRecordsNote patient={{ id: 'p1', earlierRecords: [{ id: 'p2', mrn: 'P-000002' }, { id: 'p5', mrn: 'P-000005' }] }} />));
    expect(two).toBe('Earlier records: P-000002 , P-000005 – marked as duplicates of this record. Their visits, results and bills stay there.');
    expect(html(<EarlierRecordsNote patient={{ id: 'p1' }} />)).toBe('');
  });

  it('lists the markings that were undone', () => {
    const history = [{ mrn: 'P-000001', reason: 'Registered twice', byName: 'Dr. Sample', at: '2026-09-28T06:00:00Z', undoneByName: 'Sample RMO', undoneAt: '2026-09-29T06:00:00Z' }];
    const words = text(html(<DuplicateHistory patient={{ duplicateHistory: history }} />));
    expect(words).toContain('Duplicate markings that were undone (1)');
    expect(words).toContain('Marked as a duplicate of P-000001 by Dr. Sample on 28 Sep 2026: Registered twice. Undone by Sample RMO on 29 Sep 2026.');
    expect(html(<DuplicateHistory patient={{}} />)).toBe('');
  });
});

describe('"Mark this record as a duplicate"', () => {
  it('explains what happens, asks for the main record and a reason, and has one primary button', () => {
    const out = html(<MarkDuplicateDialog patient={dup({ duplicateOf: null, access: { canMarkDuplicate: true } })} onDone={noop} onCancel={noop} />);
    const words = text(out);
    expect(words).toContain('Mark this record as a duplicate');
    expect(words).toContain('This record (P-000002) becomes the duplicate; choose the main record – the one to keep using.');
    expect(words).toContain('Nothing is moved or deleted');
    expect(words).toContain('Only her appointments from today on go to the main record. You can undo it.');
    expect(out).toContain('Main record (search by name, phone or patient number)');
    expect(out).toContain('<label for="dup-reason">Reason</label>');
    expect(out.match(/btn-primary/g)).toHaveLength(1);
    expect(out).not.toContain('!');
    expect(out).toContain('the same woman and phone number');
    const babyOut = html(<MarkDuplicateDialog patient={dup({ careType: 'newborn', duplicateOf: null })} onDone={noop} onCancel={noop} />);
    const baby = text(babyOut);
    expect(baby).toContain('Only the appointments from today on go to the main record.');
    expect(babyOut).toContain('the same baby and mother'); // the example reason for a baby
    expect(babyOut).not.toContain('the same woman');
  });

  it('once the main record is chosen: what only this record has, before the doctor confirms', () => {
    const check = {
      problem: null,
      details: [{ key: 'allergy', text: 'Penicillin – rash', onMain: 'none' }, { key: 'pregnancyDates', edd: '2027-03-01', onMain: null }, { key: 'carePlan' }],
      visits: { here: 5, main: 0 },
      remindersHere: true,
      abhaHere: true,
    };
    const out = html(<MarkingCheckNote check={check} mainMrn="P-000001" />);
    const words = text(out);
    expect(words).toContain('Before you mark, look at what only this record has. Nothing is copied by itself.');
    expect(out).toContain('<li>Allergy: Penicillin – rash (P-000001: none known)</li>');
    expect(out).toContain('<li>Pregnancy dates: EDD 1 Mar 2027 (P-000001: no dates)</li>');
    expect(out).toContain('<li>A care plan in use (P-000001 has none)</li>');
    expect(words).toContain('Copy what still applies to P-000001 (Edit details), or keep this record as the main one.');
    expect(words).toContain('This record has 5 visits, P-000001 has none. If this is the record with her history, keep it: open P-000001 and mark that one as the duplicate instead.');
    expect(words).toContain('She agreed to reminders on this record only. P-000001 sends none until the agreement is recorded there (More → Reminders and portal).');
    expect(words).toContain('Her ABHA is linked on this record only. It is unlinked here and linked on P-000001 (ABHA tab).');
    expect(out).toContain('alert-warning');
    expect(out).toMatch(/<svg[^>]*lucide/); // an icon with the words
    expect(out).not.toContain('!');
    expect(out).not.toContain('btn'); // it tells; it never stops the marking
  });

  it('nothing to tell: nothing is shown; a reason it cannot be marked is said in plain words', () => {
    expect(html(<MarkingCheckNote check={null} mainMrn="P-000001" />)).toBe('');
    expect(html(<MarkingCheckNote check={{ problem: null, details: [], visits: { here: 0, main: 3 }, remindersHere: false, abhaHere: false }} mainMrn="P-000001" />)).toBe('');
    const open = text(html(<MarkingCheckNote check={{ problem: "Today's visit on this record is still open. Sign it or mark it entered in error first – or mark P-000001 as the duplicate of this record instead.", details: [], visits: { here: 1, main: 0 } }} mainMrn="P-000001" />));
    expect(open).toContain("Today's visit on this record is still open.");
    expect(open).toContain('This record has 1 visit, P-000001 has none.');
    const baby = text(html(<MarkingCheckNote check={{ problem: null, details: [], visits: { here: 0, main: 0 }, remindersHere: true, abhaHere: true }} mainMrn="P-000009" baby />));
    expect(baby).toContain('The parents agreed to reminders on this record only.');
    expect(baby).toContain('The ABHA is linked on this record only.');
    expect(baby).not.toMatch(/\b(she|her)\b/i);
  });
});
