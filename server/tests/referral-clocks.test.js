// The clocks of a referral (docs/REFERRALS_PLAN.md – the owner's decision 5): the reply within 2 working hours (Mon–Sat
// 9 am–8 pm, the admin's holidays left out), urgent seen the same day (after 8 pm: by 8 am next morning), routine within
// 48 hours, the consultant note within 24 hours of her first visit, the discharge summary within 24 hours of discharge,
// and the state of each; the due times stored when it is logged; closing never lets a begun promise off. Pure: no
// database, the clock is passed in. All times are the hospital's (India, UTC+5:30).
import { describe, expect, it } from 'vitest';
import { addWorkingMinutes, duesFor, nextPromise, promisesFor, seenDue, workingMinutesBetween } from '../src/referrals/clocks.js';
import { referralSettingsFor } from '../src/referrals/settings.js';

const TZ = 'Asia/Kolkata';
const SETTINGS = { workingHours: { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' }, holidays: [], urgentCutoff: '20:00', urgentNextMorning: '08:00' };
// A moment in the hospital's own time ("2026-10-19T10:00" = Monday 19 Oct 2026, 10:00 in India)
const at = (local) => new Date(`${local}:00+05:30`);
const iso = (local) => at(local).toISOString();
const reply = (from, settings = SETTINGS) => addWorkingMinutes(at(from), 120, settings, TZ).toISOString();
const states = (list) => Object.fromEntries(list.map((p) => [p.key, p.state]));

describe('the reply: 2 working hours', () => {
  it('runs inside the working day', () => {
    expect(reply('2026-10-19T10:00')).toBe(iso('2026-10-19T12:00'));
    expect(reply('2026-10-19T18:00')).toBe(iso('2026-10-19T20:00')); // ends exactly at closing
  });

  it('waits for the morning when it comes before opening or in the evening', () => {
    expect(reply('2026-10-19T07:00')).toBe(iso('2026-10-19T11:00'));
    expect(reply('2026-10-19T19:30')).toBe(iso('2026-10-20T10:30')); // 30 minutes on Monday, 90 on Tuesday
    expect(reply('2026-10-19T22:00')).toBe(iso('2026-10-20T11:00'));
  });

  it('skips Sunday and the hospital admin’s holidays', () => {
    expect(reply('2026-10-24T19:00')).toBe(iso('2026-10-26T10:00')); // Saturday evening → Monday
    expect(reply('2026-10-25T11:00')).toBe(iso('2026-10-26T11:00')); // Sunday → Monday
    const holiday = { ...SETTINGS, holidays: [{ on: '2026-10-26', note: 'Sample holiday' }] };
    expect(reply('2026-10-24T19:00', holiday)).toBe(iso('2026-10-27T10:00'));
  });

  it('follows the working hours the admin set', () => {
    const sundays = { ...SETTINGS, workingHours: { days: [0, 1, 2, 3, 4, 5, 6], from: '10:00', to: '18:00' } };
    expect(reply('2026-10-24T17:00', sundays)).toBe(iso('2026-10-25T11:00'));
    // The defaults filled in by the settings are the guide's: Monday to Saturday, 9 am to 8 pm
    expect(addWorkingMinutes(at('2026-10-24T19:00'), 120, referralSettingsFor({}), TZ).toISOString()).toBe(iso('2026-10-26T10:00'));
  });

  it('counts working minutes between two moments', () => {
    expect(workingMinutesBetween(at('2026-10-19T19:30'), at('2026-10-20T10:30'), SETTINGS, TZ)).toBe(120);
    expect(workingMinutesBetween(at('2026-10-24T21:00'), at('2026-10-26T08:00'), SETTINGS, TZ)).toBe(0);
    expect(workingMinutesBetween(at('2026-10-20T10:30'), at('2026-10-19T19:30'), SETTINGS, TZ)).toBe(0);
  });
});

describe('the due times stored when the referral is logged', () => {
  it('duesFor works out the reply and seen due times as the clocks do', () => {
    expect(duesFor(at('2026-10-19T19:30'), 'urgent', SETTINGS, TZ)).toEqual({ reply: at('2026-10-20T10:30'), seen: new Date('2026-10-19T23:59:59+05:30') });
    expect(duesFor(at('2026-10-19T10:00'), 'routine', SETTINGS, TZ)).toEqual({ reply: at('2026-10-19T12:00'), seen: at('2026-10-21T10:00') });
  });

  it('the stored due times count – a later change of the working hours or holidays never moves a past clock', () => {
    const dues = duesFor(at('2026-10-19T10:00'), 'routine', SETTINGS, TZ);
    const r = { status: 'open', urgency: 'routine', receivedAt: at('2026-10-19T10:00'), dues, messages: [], firstSeen: null, discharge: null, sharing: null, note: null };
    // The admin later makes Monday a holiday and the working day start at 11:00
    const changed = { ...SETTINGS, workingHours: { days: [1, 2, 3, 4, 5, 6], from: '11:00', to: '20:00' }, holidays: [{ on: '2026-10-19', note: 'Sample holiday' }] };
    const reply = promisesFor(r, at('2026-10-19T12:30'), changed, TZ).find((p) => p.key === 'reply');
    expect(reply).toMatchObject({ due: at('2026-10-19T12:00'), state: 'late' });
    // An older referral without stored due times is worked out with today's settings
    const older = promisesFor({ ...r, dues: null }, at('2026-10-19T12:30'), changed, TZ).find((p) => p.key === 'reply');
    expect(older.due).toEqual(at('2026-10-20T13:00'));
  });
});

describe('seen on time', () => {
  it('urgent: the same day, or by 8 am next morning when it came at or after 8 pm', () => {
    expect(seenDue(at('2026-10-19T15:00'), 'urgent', SETTINGS, TZ).toISOString()).toBe(new Date(`2026-10-19T23:59:59+05:30`).toISOString());
    expect(seenDue(at('2026-10-19T19:59'), 'urgent', SETTINGS, TZ).toISOString()).toBe(new Date(`2026-10-19T23:59:59+05:30`).toISOString());
    expect(seenDue(at('2026-10-19T20:00'), 'urgent', SETTINGS, TZ).toISOString()).toBe(iso('2026-10-20T08:00'));
    expect(seenDue(at('2026-10-19T23:30'), 'urgent', SETTINGS, TZ).toISOString()).toBe(iso('2026-10-20T08:00'));
    // Sunday counts: an urgent patient is seen any day, at any hour
    expect(seenDue(at('2026-10-25T10:00'), 'urgent', SETTINGS, TZ).toISOString()).toBe(new Date(`2026-10-25T23:59:59+05:30`).toISOString());
    // The admin's own cut-off and morning
    const late = { ...SETTINGS, urgentCutoff: '21:00', urgentNextMorning: '07:00' };
    expect(seenDue(at('2026-10-19T20:30'), 'urgent', late, TZ).toISOString()).toBe(new Date(`2026-10-19T23:59:59+05:30`).toISOString());
    expect(seenDue(at('2026-10-19T21:00'), 'urgent', late, TZ).toISOString()).toBe(iso('2026-10-20T07:00'));
  });

  it('routine: within 48 hours, whatever the day', () => {
    expect(seenDue(at('2026-10-24T19:00'), 'routine', SETTINGS, TZ).toISOString()).toBe(iso('2026-10-26T19:00'));
  });
});

// A referral as the clocks read it
const referral = (extra = {}) => ({ status: 'open', urgency: 'routine', receivedAt: at('2026-10-19T10:00'), messages: [], firstSeen: null, discharge: null, sharing: null, note: null, ...extra });
const promises = (r, now) => promisesFor(r, at(now), SETTINGS, TZ);

describe('the state of each promise', () => {
  it('waiting, soon (under a quarter of the time left), late, met and met late', () => {
    expect(states(promises(referral(), '2026-10-19T10:30'))).toEqual({ reply: 'waiting', seen: 'waiting', note: 'not_started', discharge: 'not_needed' });
    expect(states(promises(referral(), '2026-10-19T11:40')).reply).toBe('soon');
    expect(states(promises(referral(), '2026-10-19T12:01')).reply).toBe('late');
    expect(states(promises(referral({ messages: [{ what: 'reply', at: at('2026-10-19T11:00') }] }), '2026-10-19T12:01')).reply).toBe('met');
    expect(states(promises(referral({ messages: [{ what: 'reply', at: at('2026-10-19T13:00') }] }), '2026-10-19T14:00')).reply).toBe('met_late');
    // Only the reply counts for the reply clock
    expect(states(promises(referral({ messages: [{ what: 'other', at: at('2026-10-19T11:00') }] }), '2026-10-19T12:01')).reply).toBe('late');
  });

  it('a reply due in the morning is not "soon" all night, only in its last working half hour', () => {
    const evening = referral({ receivedAt: at('2026-10-19T19:30') }); // due Tuesday 10:30
    expect(states(promises(evening, '2026-10-19T23:00')).reply).toBe('waiting');
    expect(states(promises(evening, '2026-10-20T09:30')).reply).toBe('waiting');
    expect(states(promises(evening, '2026-10-20T10:05')).reply).toBe('soon');
  });

  it('seen: met by her first visit or admission; urgent and routine have their own clocks', () => {
    const seen = referral({ firstSeen: { at: at('2026-10-20T11:00') } });
    expect(promises(seen, '2026-10-20T12:00').find((p) => p.key === 'seen')).toMatchObject({ state: 'met', label: 'Seen within 48 hours', due: at('2026-10-21T10:00') });
    const urgent = referral({ urgency: 'urgent', firstSeen: { at: at('2026-10-20T11:00') } });
    expect(promises(urgent, '2026-10-20T12:00').find((p) => p.key === 'seen')).toMatchObject({ state: 'met_late', label: 'Seen the same day' });
    expect(states(promises(referral({ urgency: 'urgent' }), '2026-10-19T23:59')).seen).toBe('soon');
  });

  it('the consultant note: 24 hours from her first visit, met by the note marked sent', () => {
    const seen = referral({ firstSeen: { at: at('2026-10-20T11:00') }, sharing: { answer: 'yes' }, messages: [{ what: 'reply', at: at('2026-10-19T10:30') }] });
    const note = (r, now) => promises(r, now).find((p) => p.key === 'note');
    expect(note(seen, '2026-10-20T12:00')).toMatchObject({ state: 'waiting', due: at('2026-10-21T11:00') });
    expect(note(seen, '2026-10-21T06:00').state).toBe('soon');
    expect(note(seen, '2026-10-21T11:01').state).toBe('late');
    expect(note({ ...seen, messages: [...seen.messages, { what: 'note', at: at('2026-10-21T09:00') }] }, '2026-10-22T10:00')).toMatchObject({ state: 'met', doneAt: at('2026-10-21T09:00') });
    expect(note({ ...seen, messages: [...seen.messages, { what: 'note', at: at('2026-10-21T12:00') }] }, '2026-10-22T10:00').state).toBe('met_late');
    // Not yet answered: the clock runs all the same (her Yes is asked at the first visit)
    expect(note({ ...seen, sharing: null }, '2026-10-21T11:01').state).toBe('late');
  });

  it('her No: the note and the discharge summary are never sent and never a miss', () => {
    const no = referral({
      firstSeen: { at: at('2026-10-20T11:00') },
      sharing: { answer: 'no' },
      note: { status: 'signed', signed: { at: at('2026-10-20T15:00') } },
      discharge: { dischargedAt: at('2026-10-23T10:00') },
    });
    const list = promises(no, '2026-10-30T10:00');
    expect(list.find((p) => p.key === 'note')).toMatchObject({ state: 'no_consent', doneAt: at('2026-10-20T15:00') });
    expect(list.find((p) => p.key === 'discharge')).toMatchObject({ state: 'no_consent', due: at('2026-10-24T10:00') });
    // Not signed yet: still no miss
    expect(states(promises({ ...no, note: { status: 'draft' } }, '2026-10-30T10:00')).note).toBe('no_consent');
  });

  it('the discharge summary: not needed without a stay; its clock starts at discharge', () => {
    const r = referral({ firstSeen: { at: at('2026-10-20T11:00'), admissionId: 'x' }, sharing: { answer: 'yes' } });
    expect(states(promises(r, '2026-10-21T10:00')).discharge).toBe('not_needed');
    expect(states(promises({ ...r, inHospital: true }, '2026-10-21T10:00')).discharge).toBe('not_started');
    const out = { ...r, discharge: { dischargedAt: at('2026-10-23T10:00') } };
    expect(promises(out, '2026-10-23T12:00').find((p) => p.key === 'discharge')).toMatchObject({ state: 'waiting', due: at('2026-10-24T10:00') });
    expect(states(promises(out, '2026-10-24T10:01')).discharge).toBe('late');
    expect(states(promises({ ...out, messages: [{ what: 'discharge', at: at('2026-10-24T09:00') }] }, '2026-10-25T10:00')).discharge).toBe('met');
  });

  it('closing never lets a begun promise off: the reply runs on (late if not kept); seen is not needed only when closed before it was due', () => {
    const closed = referral({ status: 'closed', closed: { at: at('2026-10-19T13:00') } });
    // Not replied: still a miss – closing is not a way to hide one. Closed before she was due to be seen (she went
    // elsewhere): "seen" is not needed
    expect(states(promises(closed, '2026-10-30T10:00'))).toEqual({ reply: 'late', seen: 'not_needed', note: 'not_needed', discharge: 'not_needed' });
    const early = referral({ status: 'closed', closed: { at: at('2026-10-19T10:30') } });
    expect(states(promises(early, '2026-10-19T11:00'))).toEqual({ reply: 'waiting', seen: 'not_needed', note: 'not_needed', discharge: 'not_needed' });
    expect(states(promises(early, '2026-10-21T10:01'))).toMatchObject({ reply: 'late', seen: 'not_needed' });
    // Closed after she was due to be seen, without being seen: that miss stays
    const late = referral({ status: 'closed', closed: { at: at('2026-10-22T09:00') } });
    expect(states(promises(late, '2026-10-30T10:00'))).toMatchObject({ reply: 'late', seen: 'late' });
    // Kept before closing: met, as on an open referral
    const kept = referral({ status: 'closed', closed: { at: at('2026-10-19T13:00') }, messages: [{ what: 'reply', at: at('2026-10-19T11:00') }], firstSeen: { at: at('2026-10-19T12:00') }, sharing: { answer: 'no' } });
    expect(states(promises(kept, '2026-10-30T10:00'))).toEqual({ reply: 'met', seen: 'met', note: 'no_consent', discharge: 'not_needed' });
    expect(promises(referral({ status: 'cancelled' }), '2026-10-30T10:00')).toEqual([]);
  });

  it('closed after her first visit or her discharge: the note and discharge clocks keep running; not begun yet: not needed', () => {
    const seen = { status: 'closed', closed: { at: at('2026-10-20T12:00') }, messages: [{ what: 'reply', at: at('2026-10-19T10:30') }], firstSeen: { at: at('2026-10-20T11:00') }, sharing: { answer: 'yes' } };
    const note = (r, now) => promises(referral(r), now).find((p) => p.key === 'note');
    // Seen at 11:00, closed at 12:00: the note is still due by 11:00 the next day
    expect(note(seen, '2026-10-20T14:00')).toMatchObject({ state: 'waiting', due: at('2026-10-21T11:00') });
    expect(note(seen, '2026-10-21T11:01').state).toBe('late');
    expect(note({ ...seen, messages: [...seen.messages, { what: 'note', at: at('2026-10-21T09:00') }] }, '2026-10-22T10:00').state).toBe('met');
    // Discharged, then closed: the discharge summary is still owed
    const out = { ...seen, closed: { at: at('2026-10-23T12:00') }, discharge: { dischargedAt: at('2026-10-23T10:00') } };
    expect(promises(referral(out), '2026-10-23T13:00').find((p) => p.key === 'discharge')).toMatchObject({ state: 'waiting', due: at('2026-10-24T10:00') });
    expect(states(promises(referral(out), '2026-10-24T10:01')).discharge).toBe('late');
    // Closed while she was still in hospital (not discharged yet): its clock never began
    expect(states(promises(referral({ ...seen, inHospital: true }), '2026-10-30T10:00')).discharge).toBe('not_needed');
  });

  it('the next promise is the running one due first', () => {
    const r = referral({ messages: [], firstSeen: null });
    expect(nextPromise(promises(r, '2026-10-19T10:30'))).toMatchObject({ key: 'reply', state: 'waiting', due: at('2026-10-19T12:00') });
    const replied = referral({ messages: [{ what: 'reply', at: at('2026-10-19T10:15') }] });
    expect(nextPromise(promises(replied, '2026-10-19T10:30'))).toMatchObject({ key: 'seen', due: at('2026-10-21T10:00') });
    const done = referral({ messages: [{ what: 'reply', at: at('2026-10-19T10:15') }], firstSeen: { at: at('2026-10-19T11:00') }, sharing: { answer: 'no' } });
    expect(nextPromise(promises(done, '2026-10-19T12:00'))).toBeNull();
  });
});
