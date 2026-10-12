// Words, colours and dates for a patient's care plan (all fake sample data).
import { describe, expect, it } from 'vitest';
import { timingText } from '../careplans/templateFormat.js';
import {
  basisText,
  isAntenatalPlan,
  maxPlanWeek,
  planTitle,
  sinceText,
  stagesOf,
  CLOSE_REASONS,
  DONE_WORDS,
  FLAG_LABELS,
  KEPT_WHY,
  LOG_LABELS,
  NOT_NEEDED_REASONS,
  PLAN_STATUS,
  SUMMARY_COUNTS,
  USER_CLOSE_REASONS,
  STATUS_FILTERS,
  WHY_TEXT,
  addDays,
  afterItemWarning,
  answerIsForOtherPlan,
  approvalText,
  canInclude,
  canKeep,
  eddShiftText,
  foldedItems,
  gaOn,
  itemMarkers,
  itemState,
  logText,
  needsDecision,
  nextVisitText,
  pausedOn,
  planCounts,
  planRows,
  previewFor,
  stageOf,
  relativeDays,
  repeatLabel,
  statusLook,
  statusNote,
  toDateInput,
  windowText,
} from './carePlanFormat.js';

// Dates arrive from the server as ISO strings at UTC midnight.
const day = (s) => `${s}T00:00:00.000Z`;
const TONES = ['stable', 'due', 'admitted', 'watch', 'high', 'inactive', 'neutral'];
const plan = { today: day('2026-09-28'), edd: day('2027-03-01'), bookedOn: day('2026-09-17'), bookedAt: { weeks: 16, days: 3 }, status: 'active' };

describe('statuses: colour + icon + word', () => {
  it('every status the server sends has a tone, an icon and a word', () => {
    const statuses = ['overdue', 'due', 'upcoming', 'missed', 'waiting', 'check_needed', 'decide', 'on_hold', 'lapsed', 'done', 'not_needed', 'not_applicable', 'inactive'];
    for (const s of statuses) {
      const look = PLAN_STATUS[s];
      expect(look, s).toBeTruthy();
      expect(TONES).toContain(look.tone);
      expect(look.icon, s).toBeTruthy();
      expect(look.word.length, s).toBeGreaterThan(2);
    }
  });

  it('uses the tones of the specification', () => {
    expect(PLAN_STATUS.overdue.tone).toBe('high');
    expect(PLAN_STATUS.due.tone).toBe('due');
    expect(PLAN_STATUS.upcoming.tone).toBe('neutral');
    expect(PLAN_STATUS.check_needed.tone).toBe('watch');
    expect(PLAN_STATUS.decide.tone).toBe('watch');
    expect(PLAN_STATUS.done.tone).toBe('stable');
    expect(PLAN_STATUS.missed.tone).toBe('inactive');
  });

  it('says what "done" means for each type of item', () => {
    expect(DONE_WORDS).toEqual({ visit: 'Attended', investigation: 'Done', scan: 'Done', vaccination: 'Given', medication: 'Started', advice: 'Given' });
    expect(statusLook({ status: 'done', kind: 'vaccination' }).word).toBe('Given');
    expect(statusLook({ status: 'done', kind: 'visit' }).word).toBe('Attended');
    expect(statusLook({ status: 'done', kind: 'medication' }).tone).toBe('stable');
  });

  it('an open item on a closed plan reads "Not done (plan closed)"; on a paused plan "Paused"', () => {
    expect(statusLook({ status: 'inactive' }, { status: 'closed' }).word).toBe('Not done (plan closed)');
    expect(statusLook({ status: 'inactive' }, { status: 'paused' }).word).toBe('Paused');
  });

  it('an item whose window passed before booking, or before it was added, reads "Before booking" (spec §5.7)', () => {
    expect(statusLook({ status: 'lapsed' }).word).toBe('Before booking');
    // Never "Window passed": those words are a Not needed reason a doctor records.
    expect(statusLook({ status: 'lapsed', lateFrom: 'added' })).toMatchObject({ word: 'Before booking', tone: 'inactive' });
  });

  it('an unknown status still shows a word, never a blank pill', () => {
    expect(statusLook({ status: 'something_new' }).word).toBe('something_new');
  });

  it('the count pills each have a tone, icon and word', () => {
    expect(SUMMARY_COUNTS.map((c) => c.key)).toEqual(['overdue', 'due', 'needsDecision', 'missedVisits']);
    for (const c of SUMMARY_COUNTS) expect(TONES).toContain(c.tone);
  });
});

describe('windowText', () => {
  it('same month', () => expect(windowText(day('2026-10-12'), day('2026-10-26'))).toBe('12–26 Oct 2026'));
  it('different months', () => expect(windowText(day('2026-09-28'), day('2026-10-04'))).toBe('28 Sep – 4 Oct 2026'));
  it('different years', () => expect(windowText(day('2026-12-30'), day('2027-01-05'))).toBe('30 Dec 2026 – 5 Jan 2027'));
  it('a single day', () => {
    expect(windowText(day('2026-10-12'), day('2026-10-12'))).toBe('12 Oct 2026');
    expect(windowText(day('2026-10-12'))).toBe('12 Oct 2026');
  });
  it('nothing for no date', () => expect(windowText(null, null)).toBe(''));
});

describe('dates', () => {
  it('relativeDays counts from the plan’s today', () => {
    expect(relativeDays(day('2026-09-28'), plan.today)).toBe('today');
    expect(relativeDays(day('2026-09-29'), plan.today)).toBe('tomorrow');
    expect(relativeDays(day('2026-10-03'), plan.today)).toBe('in 5 days');
    expect(relativeDays(day('2026-09-27'), plan.today)).toBe('yesterday');
    expect(relativeDays(day('2026-09-06'), plan.today)).toBe('22 days ago');
  });

  it('addDays and toDateInput stay on the calendar day', () => {
    expect(toDateInput(addDays(day('2026-10-12'), 6))).toBe('2026-10-18');
    expect(toDateInput(addDays(day('2026-12-30'), 6))).toBe('2027-01-05');
    expect(toDateInput(null)).toBe('');
  });

  it('gaOn works gestation out from the EDD', () => {
    expect(gaOn(plan.edd, plan.today)).toEqual({ weeks: 18, days: 0 });
    expect(gaOn(plan.edd, day('2026-01-01'))).toBeNull();
  });
});

describe('statusNote', () => {
  it('overdue and due: the last day and how long ago', () => {
    expect(statusNote({ status: 'overdue', due: { from: day('2026-09-12'), to: day('2026-09-25') } }, plan)).toBe('by 25 Sep 2026 · 3 days ago');
    expect(statusNote({ status: 'due', due: { from: day('2026-09-21'), to: day('2026-10-02') } }, plan)).toBe('by 2 Oct 2026 · in 4 days');
  });

  it('upcoming: when it starts', () => {
    expect(statusNote({ status: 'upcoming', due: { from: day('2026-10-03'), to: day('2026-10-16') } }, plan)).toBe('from 3 Oct 2026 · in 5 days');
  });

  it('missed visits', () => expect(statusNote({ status: 'missed' }, plan)).toBe('later visit started'));

  it('waiting: what it is timed after, and about when', () => {
    const item = { status: 'waiting', dependsOn: { name: 'Td – dose 1', weeks: 4 }, estimateFrom: day('2026-11-12') };
    expect(statusNote(item, plan)).toBe('4 w after Td – dose 1 · about 12 Nov 2026');
  });

  it('check needed: the reason', () => {
    expect(statusNote({ status: 'check_needed', why: 'rh_unknown' }, plan)).toBe('Blood group not recorded');
  });

  it('decide: the window that ended before booking, or before the item was added', () => {
    const gaWindow = { from: { weeks: 11, days: 0 }, to: { weeks: 13, days: 6 } };
    const booked20 = { ...plan, bookedAt: { weeks: 20, days: 0 } };
    expect(statusNote({ status: 'decide', gaWindow, lateFrom: 'booking' }, booked20)).toBe('Window 11–13 w ended before booking at 20 w 0 d');
    expect(statusNote({ status: 'decide', gaWindow, lateFrom: 'added', addedOn: day('2026-09-28') }, plan)).toBe(
      'Window 11–13 w ended before this item was added (18 w 0 d)',
    );
    expect(statusNote({ status: 'decide', why: 'not_in_template' }, plan)).toBe(WHY_TEXT.not_in_template);
  });

  it('before booking: covered by the booking visit', () => {
    expect(statusNote({ status: 'lapsed', lateStart: 'covered' }, plan)).toBe('Covered by the booking visit (17 Sep 2026)');
    expect(statusNote({ status: 'lapsed', lateStart: 'lapsed', lateFrom: 'added' }, plan)).toBe('Passed before it was added');
  });

  it('done: the date with gestation, and "elsewhere"', () => {
    const done = { on: day('2026-09-14'), gaOn: { weeks: 16, days: 0 }, elsewhere: true };
    expect(statusNote({ status: 'done', done }, plan)).toBe('14 Sep 2026 (16 w 0 d) · elsewhere');
    expect(statusNote({ status: 'done', done: { ...done, elsewhere: false } }, plan)).toBe('14 Sep 2026 (16 w 0 d)');
  });

  it('not needed: the reason and the words given', () => {
    expect(statusNote({ status: 'not_needed', notNeeded: { reasonCode: 'declined', reason: '' } }, plan)).toBe('Patient declined');
    expect(statusNote({ status: 'not_needed', notNeeded: { reasonCode: 'covered', reason: 'booster given' } }, plan)).toBe('Covered by another item: booster given');
  });

  it('does not apply: the reason, with the blood group for Rh items', () => {
    const item = { status: 'not_applicable', why: 'only_rh_negative' };
    expect(statusNote(item, plan, { medical: { bloodGroup: 'B+' } })).toBe('Only for Rh-negative mothers – blood group B+');
    expect(statusNote(item, plan)).toBe('Only for Rh-negative mothers');
  });
});

describe('item markers', () => {
  it('shows who moved it and the watch-tone date flags on open items only', () => {
    const item = { status: 'due', manualDate: { byName: 'Dr Sample' }, flags: ['check_date', 'outside_window'] };
    const m = itemMarkers(item, plan);
    expect(m.map((x) => x.label)).toEqual(['Moved by Dr Sample', 'Check date', 'Outside guideline window']);
    expect(m.find((x) => x.key === 'check_date').tone).toBe('watch');
    expect(itemMarkers({ ...item, status: 'done' }, plan).map((x) => x.key)).toEqual(['moved']);
  });

  it('names the item an added item may repeat (watch tone, with an icon), while it is open', () => {
    const item = { status: 'due', flags: ['possible_duplicate'], possibleDuplicate: { withItemId: 'i1', withName: 'Vitamin D test' } };
    const [m] = itemMarkers(item, plan);
    expect(m).toMatchObject({ key: 'possible_duplicate', label: 'May repeat “Vitamin D test”', tone: 'watch' });
    expect(m.icon).toBeTruthy();
    expect(repeatLabel({ flags: ['possible_duplicate'] })).toBe('May repeat another item');
    expect(itemMarkers({ ...item, status: 'not_needed' }, plan)).toEqual([]);
    expect(itemMarkers({ ...item, flags: [] }, plan)).toEqual([]); // kept, or the other one marked not needed
  });
});

describe('approvalText', () => {
  it('approved', () => {
    const a = approvalText({ approved: true, approvedVersion: 3, newerApprovedVersion: null, label: null });
    expect(a).toMatchObject({ tone: 'stable', word: 'Approved · v3', label: null });
  });

  it('approved, replaced by a newer approved version', () => {
    const a = approvalText({ approved: true, approvedVersion: 2, newerApprovedVersion: 3, label: null });
    expect(a).toMatchObject({ tone: 'watch', word: 'Approved v2 – replaced by approved v3' });
  });

  it('draft content: the visible sentence and the template it is based on', () => {
    const t = { approved: false, draftReason: 'content', label: 'Draft – not approved for clinical use', name: 'Standard antenatal care', version: 1 };
    const a = approvalText(t);
    expect(a).toMatchObject({ tone: 'watch', word: 'Draft', label: 'Draft – not approved for clinical use' });
    expect(a.reason).toContain('Based on “Standard antenatal care” version 1, which no doctor has approved yet');
  });

  it('draft risk rules', () => {
    const a = approvalText({ approved: false, draftReason: 'risk_rules', label: 'Draft – not approved for clinical use' });
    expect(a.word).toBe('Draft');
    expect(a.reason).toBe('The risk rules that decide the high-risk items have changed since a doctor last approved them.');
  });

  it('nothing for no template', () => expect(approvalText(null)).toBeNull());
});

describe('next visit', () => {
  it('names the visit, its dates and what else is due', () => {
    const next = {
      visit: { name: 'Antenatal visit (16 weeks)', dueFrom: day('2026-09-07'), dueBy: day('2026-09-27') },
      alsoDue: [{ name: 'Repeat Hb' }, { name: 'Td – dose 2' }],
    };
    expect(nextVisitText(next)).toBe('Next visit: Antenatal visit (16 weeks) · 7–27 Sep 2026 · also due: Repeat Hb, Td – dose 2');
    expect(nextVisitText({ visit: null, alsoDue: [] })).toBe('');
  });

  it('keeps a long "also due" list short', () => {
    const next = {
      visit: { name: 'Antenatal visit (16 weeks)', dueFrom: day('2026-09-07'), dueBy: day('2026-09-27') },
      alsoDue: ['Repeat Hb', 'Td – dose 2', 'HIV test', 'Thyroid test', 'Calcium'].map((name) => ({ name })),
    };
    expect(nextVisitText(next)).toBe('Next visit: Antenatal visit (16 weeks) · 7–27 Sep 2026 · also due: Repeat Hb, Td – dose 2, HIV test and 2 more');
  });
});

describe('labels', () => {
  it('has words for every reason and log entry the server stores', () => {
    expect(Object.keys(NOT_NEEDED_REASONS)).toEqual(['not_indicated', 'declined', 'covered', 'window_passed', 'unavailable', 'other']);
    expect(Object.keys(CLOSE_REASONS)).toEqual(['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere', 'new_pregnancy', 'other']);
    expect(USER_CLOSE_REASONS).not.toContain('new_pregnancy');
    expect(Object.keys(FLAG_LABELS)).toEqual(['check_date', 'outside_window', 'no_longer_indicated', 'possible_duplicate']); // the server's FLAGS
    expect(LOG_LABELS.edd_redated).toBe('Due dates moved');
  });

  it('plan history shows the server\'s sentence once (the label only when there is no sentence)', () => {
    expect(logText({ action: 'paused', text: 'Paused: the type of care is no longer antenatal.' })).toBe('Paused: the type of care is no longer antenatal.');
    expect(logText({ action: 'closed', text: '' })).toBe('Plan closed');
    expect(logText({ action: 'something_new', text: '' })).toBe('something_new');
  });

  it('says in words why an item is kept in a protocol change', () => {
    expect(Object.keys(KEPT_WHY)).toEqual(['done', 'not_needed', 'moved', 'included', 'note', 'history']);
    expect(KEPT_WHY.not_needed).toBe('marked not needed');
    expect(KEPT_WHY.unknown_code).toBeUndefined();
  });

  it('no exclamation marks in any wording', () => {
    const all = [PLAN_STATUS, DONE_WORDS, WHY_TEXT, NOT_NEEDED_REASONS, CLOSE_REASONS, FLAG_LABELS, LOG_LABELS].flatMap((m) =>
      Object.values(m).map((v) => (typeof v === 'string' ? v : v.word)),
    );
    for (const w of all) expect(w).not.toContain('!');
  });
});

describe('plan state lines', () => {
  it('says how far the EDD moved, in whole weeks', () => {
    expect(eddShiftText(day('2026-12-01'), day('2027-03-22'))).toBe('16 weeks');
    expect(eddShiftText(day('2027-03-22'), day('2026-12-01'))).toBe('16 weeks');
    expect(eddShiftText(day('2026-12-01'), day('2026-12-08'))).toBe('1 week');
    expect(eddShiftText(null, day('2026-12-08'))).toBe('');
  });

  it('takes the pause date from the server', () => {
    expect(pausedOn({ status: 'paused', pausedAt: day('2026-10-12') })).toBe(day('2026-10-12'));
    expect(pausedOn({ status: 'active', pausedAt: null })).toBeNull();
    expect(pausedOn(null)).toBeNull();
  });
});

describe('Change protocol preview', () => {
  const previewA = { from: { id: 'std' }, to: { id: 'A', version: 2 } };
  it('uses only the preview of the protocol chosen now', () => {
    expect(previewFor({ data: previewA, loading: false, error: null }, 'A')).toBe(previewA);
    // Protocol B chosen: A's preview is still in useFetch while B's loads, or after it failed.
    expect(previewFor({ data: previewA, loading: true, error: null }, 'B')).toBeNull();
    expect(previewFor({ data: previewA, loading: false, error: 'This protocol has no items.' }, 'B')).toBeNull();
    expect(previewFor({ data: previewA, loading: false, error: null }, 'B')).toBeNull();
    // The same protocol again: nothing can be applied until its fresh preview is back.
    expect(previewFor({ data: previewA, loading: true, error: null }, 'A')).toBeNull();
    expect(previewFor({ data: null, loading: false, error: null }, '')).toBeNull();
  });
});

describe('which plan the tab shows', () => {
  const current = { id: 'p2', status: 'active' };
  const earlier = { id: 'p1', status: 'closed' };
  it('knows when the last answer is for another plan than the web address asks for', () => {
    expect(answerIsForOtherPlan({ plan: current }, current, undefined)).toBe(false);
    expect(answerIsForOtherPlan({ plan: earlier }, earlier, 'p1')).toBe(false);
    // ?planId=p1 clicked; the current plan is still the last answer.
    expect(answerIsForOtherPlan({ plan: current }, current, 'p1')).toBe(true);
    // Back to the current plan; the earlier plan is still the last answer.
    expect(answerIsForOtherPlan({ plan: earlier }, earlier, undefined)).toBe(true);
    // "No current plan", then an earlier plan clicked.
    expect(answerIsForOtherPlan({ plan: null }, null, 'p1')).toBe(true);
    expect(answerIsForOtherPlan(null, null, 'p1')).toBe(false);
  });
});

describe('timingText (templateFormat)', () => {
  it('weeks, at booking and after another item, as before', () => {
    expect(timingText({ fromWeek: 11, toWeek: 13 })).toBe('11–13 w');
    expect(timingText({ fromWeek: 12, toWeek: 12 })).toBe('12 w');
    expect(timingText({ atBooking: true })).toBe('At first visit');
    expect(timingText({ after: { key: 'td1', weeks: 4 } }, [{ key: 'td1', name: 'Td – dose 1' }])).toBe('4 w after “Td – dose 1”');
  });

  it('fixed dates on an item a doctor added to the plan', () => {
    const timing = { atBooking: false, fromWeek: null, toWeek: null, after: { key: null, weeks: null }, date: day('2026-10-12'), dateBy: day('2026-10-26') };
    expect(timingText({ timing })).toBe('12–26 Oct 2026');
    expect(timingText({ timing: { ...timing, dateBy: null } })).toBe('12–18 Oct 2026');
    expect(timingText({ date: day('2026-09-28') })).toBe('28 Sep – 4 Oct 2026');
  });

  it('a plan item timed in weeks', () => {
    expect(timingText({ timing: { atBooking: false, fromWeek: 18, toWeek: 20, after: { key: null, weeks: null }, date: null } })).toBe('18–20 w');
  });
});

describe('the items table', () => {
  // A small fake plan: today 28 Sep 2026 (18 w 0 d), EDD 1 Mar 2027 (day 0 = 24 May 2026).
  const item = (id, fields) => ({ id, rev: 0, kind: 'investigation', name: `Item ${id}`, flags: [], applies: 'yes', timing: {}, done: null, notNeeded: null, ...fields });
  const due = (from, to) => ({ due: { from: day(from), to: day(to) } });
  const items = [
    item('a', { status: 'overdue', ...due('2026-09-01', '2026-09-20'), timing: { fromWeek: 14, toWeek: 16 } }),
    item('b', { status: 'upcoming', ...due('2026-10-26', '2026-11-15'), kind: 'scan', timing: { fromWeek: 22, toWeek: 24 } }),
    item('c', { status: 'due', ...due('2026-09-21', '2026-10-04'), flags: ['check_date'], manualDate: { byName: 'Dr Rao' } }),
    item('d', { status: 'decide', ...due('2026-06-14', '2026-07-04'), timing: { fromWeek: 3, toWeek: 5 } }),
    item('e', { status: 'done', ...due('2026-08-01', '2026-08-10'), done: { on: day('2026-08-05') }, timing: { atBooking: true } }),
    item('f', { status: 'not_needed', ...due('2026-09-01', '2026-09-07'), notNeeded: { reasonCode: 'declined', at: day('2026-09-10') } }),
    item('g', { status: 'missed', kind: 'visit', ...due('2026-09-01', '2026-09-14') }),
    item('h', { status: 'not_applicable', applies: 'no', why: 'only_rh_negative', ...due('2027-01-10', '2027-01-16') }),
    item('i', { status: 'waiting', estimateFrom: day('2026-11-12'), timing: { after: { key: 'td1', weeks: 4 } } }),
    item('j', { status: 'lapsed', lateStart: 'covered', kind: 'visit', ...due('2026-09-10', '2026-09-20') }),
  ];
  const plan = { today: day('2026-09-28'), edd: day('2027-03-01'), status: 'active', items, counts: { overdue: 1, due: 1, missed: 1, done: 1, total: 10 } };
  const keys = (rows) => rows.map((r) => (r.type === 'item' ? r.item.id : `[${r.key}]`));

  it('works out what was recorded from the done and not-needed records', () => {
    expect(items.map(itemState)).toEqual(['open', 'open', 'open', 'open', 'done', 'not_needed', 'open', 'open', 'open', 'open']);
  });

  it('needs a decision: Decide, Check needed, or a moved date to check (never a paused item)', () => {
    expect(items.filter(needsDecision).map((i) => i.id)).toEqual(['c', 'd']);
    expect(needsDecision({ status: 'check_needed' })).toBe(true);
    expect(needsDecision({ status: 'inactive', flags: ['check_date'] })).toBe(false);
    // Moved outside the window by a doctor (with a reason): already decided.
    expect(needsDecision({ status: 'upcoming', state: 'open', flags: ['outside_window'] })).toBe(false);
    expect(planCounts(plan)).toEqual({ overdue: 1, due: 1, needsDecision: 2, missedVisits: 1, done: 1, total: 10 });
  });

  it('an added item that may repeat another needs a decision, and Keep as planned answers it (as the server counts)', () => {
    const repeat = { status: 'due', flags: ['possible_duplicate'], possibleDuplicate: { withItemId: 'i1', withName: 'Vitamin D test' } };
    expect(needsDecision(repeat)).toBe(true);
    expect(canKeep(repeat)).toBe(true);
    expect(needsDecision({ ...repeat, status: 'inactive' })).toBe(false);
    expect(needsDecision({ ...repeat, done: { on: '2026-09-28' }, status: 'done' })).toBe(false);
    expect(canKeep({ ...repeat, notNeeded: { reasonCode: 'covered' }, status: 'not_needed' })).toBe(false);
  });

  it('To do: decisions first, then by date with the Today divider; missed, not applicable and before booking are folded', () => {
    const rows = planRows(plan, { view: 'todo' });
    expect(keys(rows)).toEqual(['[decision]', 'd', 'c', '[by-date]', 'a', '[today]', 'b', 'i']);
    expect(rows.find((r) => r.key === 'd').decision).toBe(true);
    expect(rows.find((r) => r.key === 'a').decision).toBe(false);
    const folded = foldedItems(plan);
    expect(folded.missed.map((i) => i.id)).toEqual(['g']);
    expect(folded.notApplicable.map((i) => i.id)).toEqual(['h']);
    expect(folded.lapsed.map((i) => i.id)).toEqual(['j']);
  });

  it('never puts the Today divider at the very top or bottom', () => {
    const onlyLater = { ...plan, items: [items[1], items[8]] };
    expect(keys(planRows(onlyLater))).toEqual(['b', 'i']);
    const onlyEarlier = { ...plan, items: [items[0]] };
    expect(keys(planRows(onlyEarlier))).toEqual(['a']);
  });

  it('Done & not needed: newest first', () => {
    expect(keys(planRows(plan, { view: 'done' }))).toEqual(['f', 'e']);
  });

  it('All: grouped by stage using the effective due-from', () => {
    expect(stageOf(items[4], plan)).toBe('booking');
    expect(stageOf(items[3], plan)).toBe('t1');
    expect(stageOf(items[1], plan)).toBe('t2');
    expect(stageOf(item('x', { due: { from: day('2027-01-10') } }), plan)).toBe('t3');
    expect(stageOf(items[8], plan)).toBe('after');
    const rows = planRows(plan, { view: 'all' });
    expect(rows.filter((r) => r.type === 'group').map((r) => r.label)).toEqual([
      'At booking',
      'First trimester (to 13 w 6 d)',
      'Second trimester (14–27 w)',
      'Third trimester (28 w onwards)',
      'Timed after another item',
    ]);
    expect(rows.filter((r) => r.type === 'item')).toHaveLength(items.length);
  });

  it('filters by type and by a count chip (the chip also picks its view)', () => {
    expect(keys(planRows(plan, { view: 'todo', kind: 'scan' }))).toEqual(['b']);
    expect(keys(planRows(plan, { view: 'todo', status: 'overdue' }))).toEqual(['a']);
    expect(keys(planRows(plan, { view: 'all', status: 'missedVisits' }))).toEqual(['[stage-t2]', 'g']);
    expect(keys(planRows(plan, { view: 'todo', status: 'missedVisits' }))).toEqual(['g']);
    expect(STATUS_FILTERS.done.view).toBe('done');
    expect(STATUS_FILTERS.missedVisits.view).toBe('all');
  });

  it('offers Keep as planned and Include anyway only when the server allows them', () => {
    expect(canKeep(items[2])).toBe(true);
    expect(canKeep(items[0])).toBe(false);
    expect(canInclude(items[7])).toBe(true);
    expect(canInclude({ ...items[7], forceInclude: { reason: 'GDM in this pregnancy' } })).toBe(false);
    expect(canInclude(items[0])).toBe(false);
  });

  it('warns (without blocking) when an item timed after another is marked done too early', () => {
    const td1 = item('td1', { kind: 'vaccination', name: 'Td – dose 1' });
    const td2 = { name: 'Td – dose 2', dependsOn: { id: 'td1', name: 'Td – dose 1', state: 'done', doneOn: day('2026-10-15'), weeks: 4 } };
    const p = { items: [td1] };
    expect(afterItemWarning(td2, p, '2026-11-01')).toBe('Td – dose 1 was given on 15 Oct 2026; Td – dose 2 is usually 4 w later (from 12 Nov 2026).');
    expect(afterItemWarning(td2, p, '2026-11-12')).toBe('');
    expect(afterItemWarning({ ...td2, dependsOn: { ...td2.dependsOn, state: 'open', doneOn: null } }, p, '2026-11-12')).toBe('Td – dose 1 is not marked done yet.');
    expect(afterItemWarning({ name: 'Hb' }, p, '2026-11-12')).toBe('');
  });
});

describe('plans for the other types of care (Version 2)', () => {
  // A postnatal plan: delivered 28 Sep 2026, so "week 0" starts that day (edd = start + 280 days)
  const pnc = { careType: 'postnatal', startWord: 'delivery', startOn: day('2026-09-28'), dayZero: day('2026-09-28'), edd: day('2027-07-05') };

  it('says weeks after delivery / birth instead of weeks of pregnancy', () => {
    expect(isAntenatalPlan(plan)).toBe(true);
    expect(isAntenatalPlan(pnc)).toBe(false);
    expect(sinceText(pnc, { weeks: 6, days: 2 })).toBe('6 w 2 d after delivery');
    expect(sinceText({ ...pnc, startWord: 'birth' }, { weeks: 0, days: 3 })).toBe('0 w 3 d after birth');
    expect(sinceText(plan, { weeks: 18, days: 0 })).toBe('18 w 0 d');
    expect(basisText(pnc)).toBe('Delivered 28 Sep 2026');
    expect(planTitle(pnc)).toBe('Postnatal care plan');
    expect(planTitle(plan)).toBe('Antenatal care plan');
  });

  it('allows weeks up to 900 outside pregnancy, and groups items by first 6 weeks / first year / later', () => {
    expect(maxPlanWeek(plan)).toBe(44);
    expect(maxPlanWeek(pnc)).toBe(900);
    expect(stagesOf(pnc).map((s) => s.key)).toEqual(['booking', 'w6', 'y1', 'later', 'after']);
    expect(stageOf({ due: { from: day('2026-11-09') }, timing: {} }, pnc)).toBe('w6');
    expect(stageOf({ due: { from: day('2027-06-28') }, timing: {} }, pnc)).toBe('y1');
    expect(stageOf({ due: { from: day('2028-01-01') }, timing: {} }, pnc)).toBe('later');
  });
});
