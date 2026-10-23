// Voice entry: the recording session, with a fake Chrome recogniser and fake timers (all fake sample data).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPhrases,
  careTypeChange,
  checkSpeech,
  createVoiceSession,
  endMessage,
  installSpeech,
  microphoneConstraints,
  microphoneFrom,
  setupWithin,
  speechEnvironment,
  speechResults,
} from './voiceSession.js';

// A stand-in for Chrome's SpeechRecognition. `local`: how processLocally behaves –
// 'ok' (a real setting that reads back), 'no-readback' (reads back false), 'missing' (not a Chrome setting at all).
// `takesTrack`: false for an older Chrome whose start() can't be handed a microphone (it throws a TypeError).
function fakeChrome({ local = 'ok', brands = ['Chromium', 'Google Chrome'], takesTrack = true } = {}) {
  const made = [];
  class FakeRecognition {
    constructor() {
      this.calls = [];
      made.push(this);
    }
    start(track) {
      if (track !== undefined && !takesTrack) throw new TypeError('no arguments expected');
      if (this.calls.includes('start')) throw Object.assign(new Error('already started'), { name: 'InvalidStateError' });
      this.calls.push('start');
      this.track = track;
    }
    stop() {
      this.calls.push('stop');
    }
    abort() {
      this.calls.push('abort');
    }
    fire(type, props = {}) {
      this[`on${type}`]?.({ type, ...props });
    }
    // what Chrome sends: every final result so far, then the words that are not final yet
    hear(finals = [], interim = [], resultIndex = 0) {
      const results = [...finals.map((t) => ({ isFinal: true, 0: { transcript: t }, length: 1 })), ...interim.map((t) => ({ isFinal: false, 0: { transcript: t }, length: 1 }))];
      this.fire('result', { results, resultIndex });
    }
  }
  FakeRecognition.prototype.phrases = [];
  if (local !== 'missing') {
    Object.defineProperty(FakeRecognition.prototype, 'processLocally', {
      get() {
        return local === 'ok' ? Boolean(this.localValue) : false;
      },
      set(value) {
        this.localValue = value;
      },
    });
  }
  const nav = { userAgentData: { brands: brands.map((brand) => ({ brand, version: '155' })) } };
  return { Recognition: FakeRecognition, made, nav };
}

function setup({ chrome = fakeChrome(), phrases = [], Phrase, ...more } = {}) {
  const got = { states: [], texts: [], ends: [], activity: [], mic: [] };
  const log = { warn: vi.fn(), info: vi.fn(), log: vi.fn(), error: vi.fn() };
  let hidden = false;
  const session = createVoiceSession({
    Recognition: chrome.Recognition,
    Phrase,
    lang: 'en-IN',
    phrases,
    onState: (s) => got.states.push(s),
    onText: (t) => got.texts.push(t),
    onEnd: (e) => got.ends.push(e),
    onActivity: (a) => got.activity.push(a),
    onMic: (m) => got.mic.push(m),
    isHidden: () => hidden,
    nav: chrome.nav,
    devices: null,
    log,
    ...more,
  });
  return {
    ...chrome,
    ...got,
    session,
    log,
    rec: () => chrome.made.at(-1),
    state: () => got.states.at(-1),
    // the doctor switches to another tab (a report, say), and back
    hide() {
      hidden = true;
    },
    show() {
      hidden = false;
    },
    // Chrome ends the recogniser by itself (a pause), then the 300 ms gap passes
    pause(r) {
      r.fire('end');
      vi.advanceTimersByTime(300);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 28, 11, 30));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Chrome's result events as sent (16 Oct 2026: the name was lost when Chrome started its list again after a pause)
const event = (finals, interim = [], resultIndex = 0) => ({
  resultIndex,
  results: [...finals.map((t) => ({ isFinal: true, 0: { transcript: t } })), ...interim.map((t) => ({ isFinal: false, 0: { transcript: t } }))],
});

describe('every word said is kept', () => {
  it('keeps the words before a pause when Chrome starts its list again (the name was lost)', () => {
    const h = speechResults();
    expect(h.add(event([], ['Asha']))).toEqual({ finals: '', interim: 'Asha' });
    expect(h.add(event([], ['Asha Patil']))).toEqual({ finals: '', interim: 'Asha Patil' });
    expect(h.add(event(['Asha Patil']))).toEqual({ finals: 'Asha Patil', interim: '' });
    // after the pause Chrome's list holds only the new words
    expect(h.add(event([], ['age']))).toEqual({ finals: 'Asha Patil', interim: 'age' });
    expect(h.add(event(['age 28']))).toEqual({ finals: 'Asha Patil age 28', interim: '' });
    expect(h.add(event([], ['phone 98765']))).toEqual({ finals: 'Asha Patil age 28', interim: 'phone 98765' });
  });

  it('works as before when Chrome sends every result so far, with or without resultIndex', () => {
    const h = speechResults();
    h.add(event(['Asha Patil'], ['age']));
    expect(h.add(event(['Asha Patil', 'age 28'], [], 1))).toEqual({ finals: 'Asha Patil age 28', interim: '' });
    expect(h.add(event(['Asha Patil', 'age 28'], ['phone'], 2))).toEqual({ finals: 'Asha Patil age 28', interim: 'phone' });
    // words not final yet are replaced, never kept
    expect(h.add(event(['Asha Patil', 'age 28'], ['phone 98765 43210'], 2))).toEqual({ finals: 'Asha Patil age 28', interim: 'phone 98765 43210' });
  });

  it('keeps unfinished words when Chrome starts again before finishing them (live, 23 Oct 2026)', () => {
    const h = speechResults();
    h.add(event([], ['name Asha']));
    expect(h.add(event([], ['name Asha Patil age 28']))).toEqual({ finals: '', interim: 'name Asha Patil age 28' });
    // Chrome's new list, nothing of the old one was ever final
    expect(h.add(event([], ['phone']))).toEqual({ finals: 'name Asha Patil age 28', interim: 'phone' });
    expect(h.add(event(['phone 98229 37420']))).toEqual({ finals: 'name Asha Patil age 28 phone 98229 37420', interim: '' });
  });

  it('keeps a short unfinished name when Chrome starts again (2 words)', () => {
    const h = speechResults();
    h.add(event([], ['Asha Patil']));
    expect(h.add(event([], ['age']))).toEqual({ finals: 'Asha Patil', interim: 'age' });
    expect(h.add(event(['age 28']))).toEqual({ finals: 'Asha Patil age 28', interim: '' });
  });

  it('keeps the unfinished words beside finished ones when Chrome starts again', () => {
    const h = speechResults();
    h.add(event(['name Asha Patil'], ['age 28']));
    expect(h.add(event([], ['phone']))).toEqual({ finals: 'name Asha Patil age 28', interim: 'phone' });
  });

  it('a correction of unfinished words is still a correction, not a new start', () => {
    const h = speechResults();
    h.add(event([], ['my name is Asha']));
    expect(h.add(event([], ['my name is Asha Patil']))).toEqual({ finals: '', interim: 'my name is Asha Patil' });
    expect(h.add(event([], ['my name is Asia']))).toEqual({ finals: '', interim: 'my name is Asia' }); // same start
    expect(h.add(event([], ['mine aim is Asia Patil']))).toEqual({ finals: '', interim: 'mine aim is Asia Patil' }); // not fewer words
  });

  it('a recording keeps the name through Chrome starting its list again', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear(['Name Asha Patil']);
    r.hear([], ['age 28']); // Chrome's new list, after a short pause
    expect(t.texts.at(-1).text).toBe('Name Asha Patil age 28');
    r.hear(['age 28 phone 98765 43210']);
    t.session.stop();
    r.fire('end');
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'Name Asha Patil age 28 phone 98765 43210' }]);
  });
});

describe('recording keeps going through pauses', () => {
  it('starts a new recogniser after a pause and keeps building the text', () => {
    const t = setup();
    t.session.start('Name Asha Sample');
    const first = t.rec();
    expect(first.calls).toEqual(['start']);
    expect(first.localValue).toBe(true);
    expect(first.lang).toBe('en-IN');
    expect(first.continuous).toBe(true);
    first.fire('audiostart');
    expect(t.state()).toBe('listening');
    first.hear(['age 28']);
    t.pause(first);

    const second = t.rec();
    expect(second).not.toBe(first); // an ended recogniser can't be started again
    expect(second.calls).toEqual(['start']);
    second.hear(['LMP 12 July 2026', 'G2 P1 L1 A0']);
    expect(t.texts.at(-1).text).toBe('Name Asha Sample. age 28. LMP 12 July 2026 G2 P1 L1 A0');
    t.session.stop();
    second.fire('end');
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'Name Asha Sample. age 28. LMP 12 July 2026 G2 P1 L1 A0' }]);
    expect(t.state()).toBe('idle');
  });

  it('restarts after "no-speech" – and only once when an error is followed by the end event', () => {
    const t = setup();
    t.session.start('');
    const first = t.rec();
    first.fire('error', { error: 'no-speech' });
    expect(t.made).toHaveLength(1); // never restarted from onerror
    t.pause(first);
    expect(t.made).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(t.made).toHaveLength(2);
    expect(t.ends).toEqual([]);
    expect(t.log.warn).toHaveBeenCalledWith('voice: no-speech');
  });

  it('ignores late events from an older recogniser', () => {
    const t = setup();
    t.session.start('');
    const first = t.rec();
    first.hear(['age 28']);
    t.pause(first);
    const second = t.rec();
    first.hear(['age 28', 'phone 98765 43210']); // late
    first.fire('end'); // late
    vi.advanceTimersByTime(300);
    expect(t.made).toHaveLength(2);
    second.hear(['blood group O positive']);
    t.session.stop();
    second.fire('end');
    expect(t.ends[0].text).toBe('age 28. blood group O positive');
  });

  it('keeps the last unfinished words when a recogniser ends', () => {
    const t = setup();
    t.session.start('');
    const first = t.rec();
    first.hear(['age 28'], ['allergic to penicillin']);
    t.session.stop();
    expect(t.state()).toBe('finishing');
    first.fire('end');
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'age 28 allergic to penicillin' }]);
  });

  it('drops unfinished words that a final result replaced', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear([], ['age twenty']);
    r.hear(['age 28']);
    t.session.stop();
    r.fire('end');
    expect(t.ends[0].text).toBe('age 28');
  });

  it('shows Hearing you while speech is heard', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    expect(t.state()).toBe('starting');
    r.fire('audiostart');
    r.fire('speechstart');
    expect(t.state()).toBe('hearing');
    r.fire('speechend');
    expect(t.state()).toBe('listening');
  });
});

describe('Stop', () => {
  it('never restarts after Stop', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    t.session.stop();
    expect(r.calls).toEqual(['start', 'stop']);
    r.fire('end');
    vi.advanceTimersByTime(10_000);
    expect(t.made).toHaveLength(1);
    expect(t.ends.map((e) => e.reason)).toEqual(['stopped']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes at once when pressed in the gap before a restart', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear(['age 28']);
    r.fire('end');
    t.session.stop(); // within the 300 ms gap
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'age 28' }]);
    vi.advanceTimersByTime(1000);
    expect(t.made).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up waiting after 6 seconds, aborts and keeps the text', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear([], ['phone 98765 43210']);
    t.session.stop();
    vi.advanceTimersByTime(5999);
    expect(t.ends).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(r.calls).toEqual(['start', 'stop', 'abort']);
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'phone 98765 43210' }]);
    expect(t.state()).toBe('idle');
    r.fire('end'); // too late: ignored
    expect(t.ends).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('limits', () => {
  it('stops after three recognisers in a row heard nothing', () => {
    const t = setup();
    t.session.start('');
    t.pause(t.rec());
    t.pause(t.rec());
    expect(t.ends).toEqual([]);
    t.rec().fire('end');
    expect(t.ends).toEqual([{ reason: 'silence', text: '' }]);
    expect(t.made).toHaveLength(3);
    expect(endMessage('silence')).toBe('Stopped listening because nothing was heard for a while.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after 2 minutes without new words, even if Chrome keeps the recogniser open', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.fire('audiostart');
    r.hear(['age 28']);
    vi.advanceTimersByTime(119_999);
    expect(r.calls).toEqual(['start']);
    vi.advanceTimersByTime(1);
    expect(r.calls).toEqual(['start', 'stop']);
    r.fire('end');
    expect(t.ends).toEqual([{ reason: 'silence', text: 'age 28' }]);
  });

  it('stops a restart loop', () => {
    const t = setup();
    t.session.start('');
    for (let i = 0; i < 8; i += 1) {
      t.rec().hear([`word ${i}`]);
      t.pause(t.rec());
    }
    expect(t.ends).toEqual([]);
    t.rec().hear(['word 8']);
    t.rec().fire('end'); // the 9th restart within a minute
    expect(t.ends.map((e) => e.reason)).toEqual(['loop']);
    expect(t.made).toHaveLength(9);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after 5 minutes and keeps the text', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    for (let minute = 1; minute <= 4; minute += 1) {
      r.hear(Array.from({ length: minute }, (_, i) => `detail ${i + 1}`));
      vi.advanceTimersByTime(60_000);
    }
    r.hear(['detail 1', 'detail 2', 'detail 3', 'detail 4', 'detail 5']);
    vi.advanceTimersByTime(59_999);
    expect(r.calls).toEqual(['start']);
    vi.advanceTimersByTime(1);
    expect(t.state()).toBe('finishing');
    r.fire('end');
    expect(t.ends).toEqual([{ reason: 'time-limit', text: 'detail 1 detail 2 detail 3 detail 4 detail 5' }]);
    expect(endMessage('time-limit')).toBe('Recording stopped after 5 minutes. Press Start recording to continue.');
  });

  it('shows the "No words yet" hint after 10 seconds of listening without words', () => {
    const t = setup();
    t.session.start('');
    t.rec().fire('audiostart');
    vi.advanceTimersByTime(9999);
    expect(t.activity).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(t.activity).toEqual(['no-words-yet']);
    t.rec().hear(['age 28']);
    expect(t.activity).toEqual(['no-words-yet', 'words']);
  });
});

describe('leaving the page', () => {
  it('keeps recording while the doctor looks at another tab, restarting there too (owner decision 6)', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear(['age 28']);
    t.hide();
    expect(r.calls).toEqual(['start']); // not stopped
    r.hear(['age 28', 'G2 P1 L1 A0']);
    t.pause(r); // Chrome's 15-second pause while the page is hidden: a new recogniser starts
    const second = t.rec();
    expect(second).not.toBe(r);
    expect(second.calls).toEqual(['start']);
    second.hear(['LMP 12 July 2026']);
    t.show();
    t.session.stop();
    second.fire('end');
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'age 28 G2 P1 L1 A0. LMP 12 July 2026' }]);
  });

  it('the 5-minute and silence limits still apply while the page is hidden', () => {
    const t = setup();
    t.session.start('');
    t.hide();
    for (let i = 0; i < 3; i += 1) t.pause(t.rec()); // three recognisers in a row hear nothing
    expect(t.ends.map((e) => e.reason)).toEqual(['silence']);

    const u = setup();
    u.session.start('');
    u.hide();
    const said = [];
    for (let i = 1; i <= 5; i += 1) {
      said.push(`detail ${i}`);
      u.rec().hear([...said]); // words every minute: never the 2-minute silence limit
      vi.advanceTimersByTime(60_000);
    }
    u.rec().fire('end');
    expect(u.ends.map((e) => e.reason)).toEqual(['time-limit']);
  });

  it('ends, saying so, when Chrome stops listening in another tab', () => {
    for (const error of ['aborted', 'not-allowed', 'service-not-allowed']) {
      const t = setup();
      t.session.start('');
      const r = t.rec();
      r.hear(['age 28']);
      t.hide();
      r.fire('error', { error });
      r.fire('end');
      expect(t.ends, error).toEqual([{ reason: 'hidden', text: 'age 28' }]);
      expect(t.made, error).toHaveLength(1);
      expect(vi.getTimerCount(), error).toBe(0);
    }
    expect(endMessage('hidden')).toBe('Chrome stopped listening while you were in another tab. Press Start recording to continue.');
  });

  it('ends as "hidden" when Chrome will not start a new recogniser in another tab', () => {
    const chrome = fakeChrome();
    const t = setup({ chrome });
    t.session.start('');
    const r = t.rec();
    r.hear(['age 28']);
    t.hide();
    chrome.Recognition.prototype.start = () => {
      throw Object.assign(new Error('not allowed in the background'), { name: 'NotAllowedError' });
    };
    t.pause(r);
    expect(t.made).toHaveLength(2);
    expect(t.ends).toEqual([{ reason: 'hidden', text: 'age 28' }]);
    expect(t.state()).toBe('idle');
  });

  it('ends as "hidden" when Chrome keeps stopping in another tab', () => {
    const t = setup();
    t.session.start('');
    t.hide();
    for (let i = 0; i < 10 && !t.ends.length; i += 1) {
      t.rec().hear([`detail ${i}`]);
      t.pause(t.rec());
    }
    expect(t.ends.map((e) => e.reason)).toEqual(['hidden']);
  });

  it('an "aborted" on a visible page is still retried once', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    t.hide();
    t.show();
    r.fire('error', { error: 'aborted' });
    t.pause(r);
    expect(t.made).toHaveLength(2);
    expect(t.ends).toEqual([]);
  });

  it('abort (the page closing) stops everything with no more callbacks and clears every timer', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.fire('audiostart');
    r.hear(['age 28']);
    t.session.abort();
    expect(r.calls).toEqual(['start', 'abort']);
    expect(r.onend).toBeNull();
    expect(r.onresult).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(t.ends).toEqual([]);
    expect(t.made).toHaveLength(1);
  });

  it('starts when the page is already hidden (the tab was switched during the speech check)', () => {
    const t = setup();
    t.hide();
    t.session.start('age 28');
    expect(t.made).toHaveLength(1);
    expect(t.rec().calls).toEqual(['start']);
    expect(t.ends).toEqual([]);
    t.rec().fire('error', { error: 'not-allowed' }); // unless Chrome refuses there
    expect(t.ends).toEqual([{ reason: 'hidden', text: 'age 28' }]);
    expect(t.state()).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort while finishing after Stop hands nothing over', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.hear(['LMP 2 March 2026']);
    t.session.stop();
    expect(t.state()).toBe('finishing');
    t.session.abort(); // e.g. the type of care changed to newborn: the text is cleared, never filled in
    r.fire('end');
    vi.advanceTimersByTime(10_000);
    expect(t.ends).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort in the gap before a restart cancels the restart', () => {
    const t = setup();
    t.session.start('');
    t.rec().fire('end');
    t.session.abort();
    vi.advanceTimersByTime(1000);
    expect(t.made).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('changing the type of care (PCPNDT)', () => {
  it('clears pregnancy text on the way to newborn, even by way of another type of care', () => {
    const first = careTypeChange({ from: 'antenatal', to: 'gynaecology', fromPregnancy: false, busy: true });
    expect(first).toEqual({ clear: false, fromPregnancy: true });
    expect(careTypeChange({ from: 'gynaecology', to: 'newborn', fromPregnancy: first.fromPregnancy, busy: true }).clear).toBe(true);
  });

  it.each(['antenatal', 'postnatal', 'infertility', 'abortion'])('clears from %s straight to newborn', (from) => {
    expect(careTypeChange({ from, to: 'newborn', fromPregnancy: false, busy: true })).toEqual({ clear: true, fromPregnancy: false });
  });

  it('keeps gynaecology text for newborn', () => {
    expect(careTypeChange({ from: 'gynaecology', to: 'newborn', fromPregnancy: false, busy: true }).clear).toBe(false);
  });

  it('forgets where the text began once the box is empty and nothing is recording', () => {
    const first = careTypeChange({ from: 'antenatal', to: 'gynaecology', fromPregnancy: false, busy: false });
    expect(first).toEqual({ clear: false, fromPregnancy: false });
    expect(careTypeChange({ from: 'gynaecology', to: 'newborn', fromPregnancy: first.fromPregnancy, busy: true }).clear).toBe(false);
  });
});

describe('errors', () => {
  it('"language-not-supported" finishes even though Chrome sends no end event', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.fire('error', { error: 'language-not-supported' });
    expect(t.ends).toEqual([{ reason: 'error:language-not-supported', text: '' }]);
    expect(t.state()).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    expect(endMessage('error:language-not-supported')).toBe('Speech recognition needs to be set up on this computer again.');
  });

  it('"phrases-not-supported" means speech might leave this computer: refused, never retried', () => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.fire('error', { error: 'phrases-not-supported' });
    r.fire('end');
    vi.advanceTimersByTime(10_000);
    expect(t.ends.map((e) => e.reason)).toEqual(['refused']);
    expect(t.made).toHaveLength(1);
  });

  it.each(['not-allowed', 'audio-capture', 'service-not-allowed', 'network'])('"%s" is final, with its own message', (code) => {
    const t = setup();
    t.session.start('');
    const r = t.rec();
    r.fire('error', { error: code });
    r.fire('end');
    vi.advanceTimersByTime(10_000);
    expect(t.ends.map((e) => e.reason)).toEqual([`error:${code}`]);
    expect(t.made).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(endMessage(`error:${code}`)).toBeTruthy();
  });

  it('an unexpected "aborted" restarts once; a second within 30 seconds is final', () => {
    const t = setup();
    t.session.start('');
    const first = t.rec();
    first.fire('error', { error: 'aborted' });
    t.pause(first);
    expect(t.made).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    t.rec().fire('error', { error: 'aborted' });
    expect(t.ends.map((e) => e.reason)).toEqual(['error:aborted']);
    expect(endMessage('error:aborted')).toMatch(/another Perinexa tab or window/);
  });

  it('an "aborted" more than 30 seconds after the last one restarts again', () => {
    const t = setup();
    t.session.start('');
    t.rec().fire('error', { error: 'aborted' });
    t.rec().hear(['age 28']);
    t.pause(t.rec());
    vi.advanceTimersByTime(31_000);
    t.rec().hear(['phone 98765 43210']);
    t.rec().fire('error', { error: 'aborted' });
    t.pause(t.rec());
    expect(t.made).toHaveLength(3);
    expect(t.ends).toEqual([]);
  });

  it('start() throwing ends as an error, never stuck on Starting', () => {
    const chrome = fakeChrome();
    chrome.Recognition.prototype.start = () => {
      throw Object.assign(new Error('busy'), { name: 'InvalidStateError' });
    };
    const t = setup({ chrome });
    t.session.start('age 28');
    expect(t.states).toEqual(['starting', 'idle']);
    expect(t.ends).toEqual([{ reason: 'error:start-failed', text: 'age 28' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start() blocked by the site settings says the microphone is blocked', () => {
    const chrome = fakeChrome();
    chrome.Recognition.prototype.start = () => {
      throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    };
    const t = setup({ chrome });
    t.session.start('');
    expect(t.ends.map((e) => e.reason)).toEqual(['error:not-allowed']);
  });
});

describe('privacy check before every start', () => {
  it.each([
    ['processLocally is not a Chrome setting', { local: 'missing' }],
    ['processLocally does not read back as true', { local: 'no-readback' }],
    ['the browser is not Google Chrome', { brands: ['Chromium', 'Microsoft Edge'] }],
  ])('refuses when %s, and never starts', (_, options) => {
    const t = setup({ chrome: fakeChrome(options) });
    t.session.start('age 28');
    expect(t.made).toHaveLength(1);
    expect(t.rec().calls).toEqual([]);
    expect(t.ends).toEqual([{ reason: 'refused', text: 'age 28' }]);
    expect(t.state()).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks every restart too', () => {
    const chrome = fakeChrome();
    const t = setup({ chrome });
    t.session.start('');
    t.rec().hear(['age 28']);
    chrome.nav.userAgentData.brands = [{ brand: 'Chromium', version: '155' }];
    t.pause(t.rec());
    expect(t.made).toHaveLength(2);
    expect(t.rec().calls).toEqual([]);
    expect(t.ends).toEqual([{ reason: 'refused', text: 'age 28' }]);
  });

  it('never uses webkitSpeechRecognition', () => {
    const { Recognition, nav } = fakeChrome();
    expect(speechEnvironment({ isSecureContext: true, navigator: nav, webkitSpeechRecognition: Recognition })).toEqual({ ok: false, reason: 'no-speech' });
  });
});

// A stand-in for a microphone track from getUserMedia
function fakeTrack() {
  return {
    readyState: 'live',
    muted: false,
    stopped: 0,
    stop() {
      this.stopped += 1;
      this.readyState = 'ended';
    },
    // unplugged: Chrome ends the track and says so
    unplug() {
      this.readyState = 'ended';
      this.onended?.();
    },
  };
}
const failing = (name) => Object.assign(new Error(name), { name });
// Lets Chrome's answer to the microphone request arrive
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('the microphone', () => {
  it('is asked for once per Start, with the chosen microphone, and handed to every recogniser', async () => {
    const track = fakeTrack();
    const getTrack = vi.fn(() => Promise.resolve(track));
    const t = setup({ getTrack, deviceId: 'mic-2' });
    t.session.start('');
    expect(t.state()).toBe('asking-mic'); // "Allow the microphone" while Chrome may be asking
    expect(t.made).toHaveLength(0);
    await settle();
    expect(getTrack).toHaveBeenCalledWith('mic-2');
    expect(t.states).toEqual(['starting', 'asking-mic', 'starting']);
    expect(t.rec().track).toBe(track);
    t.rec().hear(['age 28']);
    t.pause(t.rec());
    t.pause(t.rec());
    expect(t.made).toHaveLength(3);
    expect(t.made.every((r) => r.track === track)).toBe(true);
    expect(getTrack).toHaveBeenCalledTimes(1);
    expect(track.stopped).toBe(0);
    t.session.stop();
    t.rec().fire('end');
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'age 28' }]);
    expect(track.stopped).toBe(1); // the microphone is off
    t.session.start('age 28'); // the next Start asks again
    await settle();
    expect(getTrack).toHaveBeenCalledTimes(2);
  });

  it('asks for noise suppression and one channel, and the chosen microphone only as a preference', async () => {
    expect(microphoneConstraints('mic-2')).toEqual({
      audio: { deviceId: { ideal: 'mic-2' }, noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: { ideal: 1 } },
    });
    expect(microphoneConstraints('').audio).not.toHaveProperty('deviceId');
    const track = fakeTrack();
    const extra = fakeTrack();
    const media = { getUserMedia: vi.fn(() => Promise.resolve({ getAudioTracks: () => [track, extra] })) };
    await expect(microphoneFrom(media)('mic-2')).resolves.toBe(track);
    expect(media.getUserMedia).toHaveBeenCalledWith(microphoneConstraints('mic-2'));
    expect(extra.stopped).toBe(1);
    expect(microphoneFrom({})).toBeNull(); // no getUserMedia: Chrome's own microphone
    const none = { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [] }) };
    await expect(microphoneFrom(none)()).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('starts without the microphone on a Chrome that cannot take one, and the limits still apply', async () => {
    const track = fakeTrack();
    const t = setup({ chrome: fakeChrome({ takesTrack: false }), getTrack: () => Promise.resolve(track) });
    t.session.start('');
    await settle();
    expect(t.rec().calls).toEqual(['start']);
    expect(t.rec().track).toBeUndefined();
    t.pause(t.rec());
    expect(t.rec().calls).toEqual(['start']);
    t.pause(t.rec());
    t.pause(t.rec());
    expect(t.ends.map((e) => e.reason)).toEqual(['silence']);
    expect(track.stopped).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends with "The microphone was disconnected" when it is unplugged, keeping the text', async () => {
    const track = fakeTrack();
    const t = setup({ getTrack: () => Promise.resolve(track) });
    t.session.start('Name Asha Sample');
    await settle();
    t.rec().hear(['age 28']);
    track.unplug();
    expect(t.ends).toEqual([{ reason: 'error:audio-capture', cause: 'disconnected', text: 'Name Asha Sample. age 28' }]);
    expect(endMessage('error:audio-capture', 'disconnected')).toMatch(/^The microphone was disconnected\./);
    vi.advanceTimersByTime(1000);
    expect(t.made).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks the microphone is still there before each restart', async () => {
    const track = fakeTrack();
    const t = setup({ getTrack: () => Promise.resolve(track) });
    t.session.start('');
    await settle();
    t.rec().hear(['age 28']);
    track.readyState = 'ended'; // gone without an "ended" event
    t.pause(t.rec());
    expect(t.made).toHaveLength(1);
    expect(t.ends).toEqual([{ reason: 'error:audio-capture', cause: 'disconnected', text: 'age 28' }]);
  });

  it('shows "Microphone muted" while the microphone is muted, also after a device change', async () => {
    const track = fakeTrack();
    const devices = new EventTarget();
    const t = setup({ getTrack: () => Promise.resolve(track), devices });
    t.session.start('');
    await settle();
    track.onmute();
    track.onunmute();
    track.muted = true;
    devices.dispatchEvent(new Event('devicechange'));
    expect(t.mic).toEqual(['muted', 'live', 'muted']);
    expect(t.ends).toEqual([]); // muted is not the end
    track.readyState = 'ended';
    devices.dispatchEvent(new Event('devicechange'));
    expect(t.ends.map((e) => [e.reason, e.cause])).toEqual([['error:audio-capture', 'disconnected']]);
    devices.dispatchEvent(new Event('devicechange'));
    expect(t.mic).toHaveLength(3); // no longer listened to
  });

  it.each([
    ['NotAllowedError', 'error:not-allowed', undefined, /blocked for this site/],
    ['NotFoundError', 'error:audio-capture', undefined, /No microphone could be used/],
    ['NotReadableError', 'error:audio-capture', 'busy', /used by another program/],
  ])('%s from getUserMedia ends the recording with the right message', async (name, reason, cause, message) => {
    const t = setup({ getTrack: () => Promise.reject(failing(name)) });
    t.session.start('age 28');
    await settle();
    expect(t.made).toHaveLength(0);
    expect(t.ends).toEqual([cause ? { reason, cause, text: 'age 28' } : { reason, text: 'age 28' }]);
    expect(endMessage(reason, cause)).toMatch(message);
    expect(t.state()).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    expect(t.log.warn).toHaveBeenCalledWith(`voice: ${name}`);
  });

  it.each(['OverconstrainedError', 'NotFoundError'])('a saved microphone that is gone (%s) is forgotten, and the default one used once', async (name) => {
    const track = fakeTrack();
    const getTrack = vi.fn((id) => (id ? Promise.reject(failing(name)) : Promise.resolve(track)));
    const onDeviceGone = vi.fn();
    const t = setup({ getTrack, deviceId: 'old-mic', onDeviceGone });
    t.session.start('');
    await settle();
    expect(getTrack.mock.calls).toEqual([['old-mic'], [undefined]]);
    expect(onDeviceGone).toHaveBeenCalledTimes(1);
    expect(t.rec().track).toBe(track);
    expect(t.ends).toEqual([]);
  });

  it('the default microphone failing too is final (tried only once)', async () => {
    const getTrack = vi.fn(() => Promise.reject(failing('NotFoundError')));
    const t = setup({ getTrack, deviceId: 'old-mic', onDeviceGone: () => {} });
    t.session.start('');
    await settle();
    expect(getTrack).toHaveBeenCalledTimes(2);
    expect(t.ends.map((e) => e.reason)).toEqual(['error:audio-capture']);
  });

  it('Stop while Chrome is asking finishes at once; a microphone that arrives later is switched off', async () => {
    const track = fakeTrack();
    let answer;
    const t = setup({ getTrack: () => new Promise((resolve) => (answer = resolve)) });
    t.session.start('age 28');
    await settle();
    t.session.stop();
    expect(t.ends).toEqual([{ reason: 'stopped', text: 'age 28' }]);
    answer(track);
    await settle();
    expect(track.stopped).toBe(1);
    expect(t.made).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('while Chrome is asking, nothing ends by itself: both limits count from when the microphone is on', async () => {
    const track = fakeTrack();
    let answer;
    const t = setup({ getTrack: () => new Promise((resolve) => (answer = resolve)) });
    t.session.start('age 28');
    await settle();
    vi.advanceTimersByTime(6 * 60 * 1000); // the Allow / Block bubble left open for 6 minutes
    expect(t.ends).toEqual([]); // never "nothing was heard", nor the 5-minute limit
    expect(t.state()).toBe('asking-mic');
    answer(track);
    await settle();
    expect(t.state()).toBe('starting');
    expect(t.made).toHaveLength(1);
    t.rec().fire('audiostart');
    vi.advanceTimersByTime(120_000); // then 2 minutes with no words
    expect(t.rec().calls).toContain('stop');
    t.rec().fire('end');
    expect(t.ends.map((e) => e.reason)).toEqual(['silence']);
    expect(track.stopped).toBe(1);
  });

  it('switches the microphone off on abort and on a final error, and clears every timer', async () => {
    const one = fakeTrack();
    const a = setup({ getTrack: () => Promise.resolve(one) });
    a.session.start('');
    await settle();
    a.session.abort();
    expect(one.stopped).toBe(1);
    expect(one.onended).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const two = fakeTrack();
    const b = setup({ getTrack: () => Promise.resolve(two) });
    b.session.start('');
    await settle();
    b.rec().fire('error', { error: 'network' });
    expect(two.stopped).toBe(1);
    expect(b.ends.map((e) => e.reason)).toEqual(['error:network']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never writes what was said to the console and sends nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network in tests')));
    const track = fakeTrack();
    const t = setup({ getTrack: () => Promise.resolve(track), deviceId: 'mic-2' });
    t.session.start('Name Asha Sample');
    await settle();
    t.rec().hear(['age 28'], ['phone 98765 43210']);
    track.onmute();
    track.unplug();
    const logged = [...t.log.warn.mock.calls, ...t.log.info.mock.calls].flat().join(' ');
    for (const said of ['Asha', '28', '98765']) expect(logged).not.toContain(said);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('what is heard stays on the page', () => {
  it('never writes what was said to the console and sends nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network in tests')));
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const t = setup();
    t.session.start('Name Asha Sample');
    t.rec().hear(['age 28'], ['phone 98765 43210']);
    t.rec().fire('error', { error: 'no-speech' });
    t.pause(t.rec());
    t.rec().hear(['blood group O positive']);
    t.session.stop();
    vi.advanceTimersByTime(6000);
    const logged = [...t.log.warn.mock.calls, ...t.log.info.mock.calls, ...t.log.log.mock.calls, ...t.log.error.mock.calls, ...consoleSpies.flatMap((s) => s.mock.calls)]
      .flat()
      .join(' ');
    for (const said of ['Asha', '28', '98765', 'positive']) expect(logged).not.toContain(said);
    expect(logged).toMatch(/^(voice: [a-z-]+ ?)+$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('phrases for Chrome', () => {
  class FakePhrase {
    constructor(phrase, boost) {
      if (!phrase || boost < 0 || boost > 10) throw new SyntaxError('bad phrase');
      this.phrase = phrase;
      this.boost = boost;
    }
  }

  it('skips one bad phrase and keeps the rest, with boosts within 0–10', () => {
    const phrases = buildPhrases(FakePhrase, [
      { text: 'LSCS', boost: 2 },
      { text: '', boost: 2 },
      { text: 'primigravida', boost: 25 },
      { text: 'caesarean', boost: -1 },
    ]);
    expect(phrases.map((p) => [p.phrase, p.boost])).toEqual([
      ['LSCS', 2],
      ['primigravida', 10],
      ['caesarean', 0],
    ]);
  });

  it('gives each recogniser the phrase list', () => {
    const t = setup({ Phrase: FakePhrase, phrases: [{ text: 'LSCS', boost: 2 }] });
    t.session.start('');
    expect(t.rec().phrases.map((p) => p.phrase)).toEqual(['LSCS']);
    t.pause(t.rec());
    expect(t.rec().phrases.map((p) => p.phrase)).toEqual(['LSCS']);
  });
});

describe('checking Chrome before recording', () => {
  const nav = fakeChrome().nav;
  const withSpeech = (Recognition) => ({ isSecureContext: true, navigator: nav, SpeechRecognition: Recognition });

  it('needs the secure address, Google Chrome, and a Chrome new enough', () => {
    const { Recognition } = fakeChrome();
    Recognition.available = async () => 'available';
    expect(speechEnvironment({ isSecureContext: false, navigator: nav, SpeechRecognition: Recognition })).toEqual({ ok: false, reason: 'insecure' });
    expect(speechEnvironment({ isSecureContext: true, navigator: fakeChrome({ brands: ['Brave'] }).nav, SpeechRecognition: Recognition })).toEqual({
      ok: false,
      reason: 'not-chrome',
    });
    expect(speechEnvironment(withSpeech(fakeChrome({ local: 'missing' }).Recognition))).toEqual({ ok: false, reason: 'old-chrome' });
    expect(speechEnvironment(withSpeech(Recognition))).toEqual({ ok: true });
  });

  it('asks for en-IN first and en-US only when en-IN is unavailable', async () => {
    const asked = [];
    const answers = { 'en-IN': 'unavailable', 'en-US': 'downloadable' };
    const Recognition = {
      available: async ({ langs, processLocally }) => {
        expect(processLocally).toBe(true);
        asked.push(langs[0]);
        return answers[langs[0]];
      },
    };
    expect(await checkSpeech(Recognition)).toEqual({ status: 'needs-setup', lang: 'en-US' });
    expect(asked).toEqual(['en-IN', 'en-US']);
    answers['en-IN'] = 'available';
    asked.length = 0;
    expect(await checkSpeech(Recognition)).toEqual({ status: 'ready', lang: 'en-IN' });
    expect(asked).toEqual(['en-IN']);
    answers['en-IN'] = 'downloading';
    expect(await checkSpeech(Recognition)).toEqual({ status: 'setting-up', lang: 'en-IN' });
    answers['en-IN'] = 'unavailable';
    answers['en-US'] = 'unavailable';
    expect(await checkSpeech(Recognition)).toEqual({ status: 'unavailable' });
    expect(await checkSpeech(undefined)).toEqual({ status: 'unsupported' });
  });

  it('sets up speech recognition: ready, failed, or needs another click', async () => {
    const install = vi.fn();
    const Recognition = { install };
    install.mockResolvedValueOnce(true);
    const ready = installSpeech(Recognition, 'en-IN');
    expect(install).toHaveBeenCalledWith({ langs: ['en-IN'], processLocally: true }); // called at once, before any await
    expect(await ready).toBe('ready');
    install.mockResolvedValueOnce(false);
    expect(await installSpeech(Recognition, 'en-IN')).toBe('failed');
    install.mockRejectedValueOnce(Object.assign(new Error('no click'), { name: 'NotAllowedError' }));
    expect(await installSpeech(Recognition, 'en-IN')).toBe('needs-click');
    install.mockImplementationOnce(() => {
      throw new TypeError('bad');
    });
    expect(await installSpeech(Recognition, 'en-IN')).toBe('failed');
  });

  it('Start recording on a new website: set up at once when the model is already here, "slow" when it downloads', async () => {
    vi.useFakeTimers();
    try {
      expect(await setupWithin(Promise.resolve('ready'), 3000)).toBe('ready');
      expect(await setupWithin(Promise.resolve('needs-click'), 3000)).toBe('needs-click');
      const downloading = setupWithin(new Promise(() => {}), 3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await downloading).toBe('slow');
      expect(vi.getTimerCount()).toBe(0); // no timer left behind
    } finally {
      vi.useRealTimers();
    }
  });
});
