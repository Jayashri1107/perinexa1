// A death recorded on a record (5 Oct 2026), on the screens: the quiet banner ("Died on …" for those who see the
// medical details, "Record closed" for everyone else), the record's history, "Record a death" and its undo, and the
// words said afterwards. Rendered to HTML (no browser). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../../components/ui.jsx';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { ClosedBanner, DeathHistory, RecordDeathDialog, UndoDeathDialog } from './DeathDialogs.jsx';
import { ageAtDeathDays, ageHint, deathFacts, recordedMessage, undoReasonProblem, undoneMessage } from './deathFormat.js';

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

const mother = (over = {}) => ({
  id: 'p1',
  mrn: 'P-000001',
  fullName: 'Asha Sample',
  careType: 'antenatal',
  closed: true,
  death: { on: '2026-10-03T00:00:00.000Z', place: null, timing: 'delivery', ageDays: null, byName: 'Dr. Sample', at: '2026-10-03T06:00:00.000Z' },
  access: { canRecordDeath: false, canUndoDeath: true },
  ...over,
});
const baby = (over = {}) => ({
  id: 'b1',
  mrn: 'P-000009',
  fullName: 'Baby of Asha Sample',
  careType: 'newborn',
  newborn: { birthAt: '2026-10-01T03:00:00.000Z' },
  closed: true,
  death: { on: '2026-10-03T00:00:00.000Z', place: 'here', timing: null, ageDays: 2, byName: 'Dr. Sample', at: '2026-10-03T06:00:00.000Z' },
  access: { canRecordDeath: false, canUndoDeath: true },
  ...over,
});

describe('the banner on a closed record', () => {
  it('for those who see the medical details: a grey "Died on …" status with its icon, when it was, who recorded it, and Undo for the doctor', () => {
    const out = html(<ClosedBanner patient={mother()} onUndo={noop} />);
    const words = text(out);
    expect(out).toMatch(/class="pill pill-inactive"><svg[^>]*lucide-archive[^>]*>.*?<\/svg>Died on 3 Oct 2026<\/span>/);
    expect(words).toContain('During delivery or within 24 hours after it. This record is closed. It can still be read, but it takes nothing new – no visits, appointments, lab orders, admissions, reminders or messages.');
    expect(words).toContain('Recorded by Dr. Sample on');
    expect(words).toContain('Undo – recorded in error');
    expect(out).toContain('alert-neutral');
    expect(out).not.toMatch(/alert-(error|critical|warning)|pill-high|!/); // nothing alarming, no exclamation marks
    // a baby: the age in days and the place
    expect(text(html(<ClosedBanner patient={baby()} onUndo={noop} />))).toContain('Died on 3 Oct 2026 Aged 2 days · This hospital.');
    // no Undo for anyone but the doctor of the record
    expect(text(html(<ClosedBanner patient={mother({ access: { canUndoDeath: false } })} onUndo={noop} />))).not.toContain('Undo');
  });

  it('for reception (no medical details): only "Record closed" – never why, never the date', () => {
    const out = html(<ClosedBanner patient={{ ...mother({ access: {} }), death: undefined }} onUndo={noop} />);
    const words = text(out);
    expect(words).toBe('Record closed It can still be read, but it takes nothing new – no visits, appointments, lab orders, admissions, reminders or messages.');
    expect(words).not.toMatch(/died|death|Oct/i);
  });

  it('nothing on a record that is not closed', () => {
    expect(html(<ClosedBanner patient={{ ...mother(), closed: undefined, death: undefined }} onUndo={noop} />)).toBe('');
  });

  it("a death recorded in error and undone stays in the record's history, with the reason", () => {
    const history = [{ on: '2026-10-02T00:00:00.000Z', place: null, timing: 'pregnancy', byName: 'Dr. Sample', at: '2026-10-02T06:00:00.000Z', undoneReason: 'Recorded on the wrong record', undoneByName: 'Dr. Other', undoneAt: '2026-10-02T07:00:00.000Z' }];
    const words = text(html(<DeathHistory patient={{ careType: 'antenatal', deathHistory: history }} />));
    expect(words).toContain('Deaths recorded in error and undone (1)');
    expect(words).toMatch(/A death on 2 Oct 2026 \(during pregnancy\) was recorded by Dr\. Sample on .* and undone by Dr\. Other on .*: Recorded on the wrong record\./);
    expect(html(<DeathHistory patient={{ careType: 'antenatal' }} />)).toBe('');
  });
});

describe('"Record a death"', () => {
  it("a mother's record: the date and when it was, with the DRAFT hint (an accident is \"Other\"); no cause of death; a tick that names her", () => {
    const out = html(<RecordDeathDialog patient={mother({ closed: undefined, death: undefined, access: { canRecordDeath: true } })} onDone={noop} onCancel={noop} />);
    const words = text(out);
    expect(words).toContain('Record a death');
    expect(words).toContain('Asha Sample · P-000001');
    expect(words).toContain('Only when the death is certain.');
    expect(words).toContain('There is no cause of death here');
    expect(out).toMatch(/<input id="death-on" type="date" max="\d{4}-\d{2}-\d{2}"/);
    for (const choice of ['During pregnancy', 'During delivery or within 24 hours after it', 'From 24 hours up to 42 days after delivery (or after the pregnancy ended)', 'Other: an accident or a cause not related to the pregnancy, or later than 42 days']) {
      expect(words).toContain(choice);
    }
    expect(words).toContain('A death from an accident or a cause not related to the pregnancy is “Other” (WHO). These choices are a DRAFT for a doctor to check.');
    expect(words).toContain('I have checked that this is the record of Asha Sample (P-000001), and that the details are right.');
    expect(out).not.toContain('death-place');
    expect(out).not.toMatch(/cause of death<\/label>|id="death-cause"/i);
    expect(out).toMatch(/<button type="submit" class="btn btn-danger">Record the death<\/button>/);
    expect(out.match(/btn-primary/g) ?? []).toHaveLength(0);
    expect(out).not.toMatch(/!/);
  });

  it("a baby's record: the date and the place, and the age worked out from the date of birth", () => {
    const words = text(html(<RecordDeathDialog patient={baby({ closed: undefined, death: undefined, access: { canRecordDeath: true } })} onDone={noop} onCancel={noop} />));
    expect(words).toContain('Where the baby died');
    expect(words).toContain('This hospital');
    expect(words).toContain('Elsewhere');
    expect(words).not.toContain('When was it?');
    expect(words).toMatch(/Born \d+ (Sep|Oct) 2026\. The age is worked out from the date of birth\./);
  });
});

describe('"Undo the recorded death?"', () => {
  it('asks why, and says that nothing comes back by itself', () => {
    const out = html(<UndoDeathDialog patient={mother()} onDone={noop} onCancel={noop} />);
    const words = text(out);
    expect(words).toContain('Undo the recorded death?');
    expect(words).toContain('Asha Sample · P-000001');
    expect(words).toContain('Nothing that was cancelled comes back by itself – appointments, messages and portal access.');
    expect(words).toContain('Why was it recorded in error?');
    expect(out).toMatch(/<button type="submit" class="btn btn-primary">Undo – recorded in error<\/button>/);
  });
});

describe('the words', () => {
  it("a baby's age at death in completed days from the date of birth (0 = the day of birth)", () => {
    expect(ageAtDeathDays('2026-10-01T06:00:00.000Z', '2026-10-01')).toBe(0);
    expect(ageAtDeathDays('2026-10-01T06:00:00.000Z', '2026-10-29')).toBe(28);
    expect(ageAtDeathDays('2026-10-05T06:00:00.000Z', '2026-10-01')).toBeNull();
    expect(ageAtDeathDays(null, '2026-10-01')).toBeNull();
    expect(ageHint('2026-10-01T06:00:00.000Z', '2026-10-01', formatDate)).toBe('Age at death: on the day of birth (worked out from the date of birth, 1 Oct 2026).');
    expect(ageHint('2026-10-01T06:00:00.000Z', '2026-10-04', formatDate)).toBe('Age at death: 3 days (worked out from the date of birth, 1 Oct 2026).');
    expect(ageHint('2026-10-05T06:00:00.000Z', '2026-10-04', formatDate)).toBe('This date is before the day of birth.');
    expect(ageHint(null, '2026-10-04', formatDate)).toMatch(/^The time of birth is not on this record: the age is recorded as not known\./);
    expect(deathFacts({ ageDays: null, place: 'elsewhere' }, { baby: true })).toBe('Age not known (no time of birth on the record) · Elsewhere');
    expect(deathFacts({ ageDays: 1, place: 'here' }, { baby: true })).toBe('Aged 1 day · This hospital');
  });

  it('after recording: what was cancelled, a stay still open, and her babies whose reminders go on', () => {
    expect(recordedMessage({ appointmentsCancelled: 2, messagesCancelled: 1, portalEnded: 1, inHospital: true, babies: [{ id: 'b1', mrn: 'P-000009' }] })).toBe(
      "The death was recorded and this record is closed. 2 appointments from today on were cancelled, with no message to the family; 1 waiting message was stopped; her patient portal access ended. She is still on the In hospital list: the discharge card ends the stay. Her baby's record P-000009 is still in use: reminders for it go on, to the number on the baby's record. Look at it.",
    );
    expect(recordedMessage({ appointmentsCancelled: 0, messagesCancelled: 0, portalEnded: 0, inHospital: false, babies: [] }, { baby: true })).toBe(
      'The death was recorded and this record is closed. Nothing was booked or waiting for the baby.',
    );
  });

  it('after undoing: the appointments to book again, by hand', () => {
    expect(undoneMessage({ undone: true, appointmentsToRebook: [{ date: '2026-10-12', start: '11:00', doctorName: 'Dr. Sample' }] }, { formatDate, timeLabel })).toBe(
      'The death recorded in error was undone: this record is in use again. Nothing that was cancelled comes back by itself. Book again on the Appointments tab what is still wanted: 12 Oct 2026 at 11:00 AM with Dr. Sample.',
    );
    expect(undoneMessage({ undone: true, appointmentsToRebook: [] }, { formatDate, timeLabel })).toBe('The death recorded in error was undone: this record is in use again. No appointment ahead had been cancelled by it.');
    expect(undoneMessage({ undone: false }, { formatDate, timeLabel })).toBe('No death was recorded on this record.');
    expect([undoReasonProblem('oops'), undoReasonProblem('Wrong record')]).toEqual(['Please write why this was recorded in error (at least 5 characters).', null]);
  });
});
