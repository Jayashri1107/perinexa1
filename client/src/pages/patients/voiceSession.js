// Voice entry: one recording, from Start recording to Stop, on Google Chrome's speech recognition. Plain JavaScript
// (no React), so it can be tested in node with a fake Recognition; VoiceEntry.jsx only shows what it reports.
//
// PRIVACY: speech is turned into text ON THIS COMPUTER only (processLocally) – never online. Before EVERY start (the
// first one and each restart) the session checks that Chrome will keep it on this computer, and records nothing if
// it can't be sure. What is said is only handed to the page (onText / onEnd): never stored, sent or logged. The
// console gets "voice: <code>" only.
//
// Chrome ends a recording by itself after about 8 seconds of silence at the start, or after a 15-second pause.
// Until Stop is pressed, the session starts a new recogniser each time (an ended one can't be started again) and
// joins the text, within limits so the microphone can't stay open for long by mistake. Recording goes on while the
// doctor looks at another tab (a report, say; owner decision 6): only if Chrome stops listening there does it end.
//
// The microphone: asked for once per Start (with noise suppression, and the microphone chosen in "Microphone and speech
// settings" if there is one), then handed to every recogniser of that recording. It is switched off when the recording
// ends, however it ends.

// Errors that end the recording (anything but "no-speech" and one unexpected "aborted").
export const FINAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network', 'bad-grammar', 'phrases-not-supported']);

const RESTART_MS = 300; // gap before a new recogniser starts
const STOP_TIMEOUT_MS = 6 * 1000; // Stop: Chrome's last words, then give up waiting
const NO_WORDS_HINT_MS = 10 * 1000; // "No words yet" hint
const INACTIVITY_MS = 120 * 1000; // no new words for 2 minutes
const TIME_LIMIT_MS = 5 * 60 * 1000; // one recording is 5 minutes at most
const SILENT_IN_A_ROW = 3; // recognisers in a row that heard nothing
const LOOP_WINDOW_MS = 60 * 1000;
const MAX_RESTARTS = 8; // more restarts than this within LOOP_WINDOW_MS: something is wrong
const ABORTED_WINDOW_MS = 30 * 1000; // a second unexpected "aborted" within this is final
// Errors that, in a background tab, mean Chrome stopped listening there (not a microphone or set-up problem)
const HIDDEN_STOPS = new Set(['aborted', 'not-allowed', 'service-not-allowed']);

// What the person sees when a recording can't start or has ended. Keys: speechEnvironment() reasons, onEnd reasons.
export const ERROR_MESSAGES = {
  // Before any recording
  insecure: "Voice entry needs Perinexa's secure (https) address.",
  'not-chrome': 'Recording needs Google Chrome on a Windows or Mac computer. You can still type or paste the details in the box.',
  'old-chrome': 'Update Google Chrome (Settings → About Chrome). Chrome 139 or newer is needed, which needs Windows 10 or later, or a recent macOS.',
  'no-speech': 'Update Google Chrome (Settings → About Chrome). Chrome 139 or newer is needed, which needs Windows 10 or later, or a recent macOS.',
  unavailable: 'Chrome cannot turn speech into text on this computer. You can still type or paste the details in the box.',
  // How a recording ended
  silence: 'Stopped listening because nothing was heard for a while.',
  hidden: 'Chrome stopped listening while you were in another tab. Press Start recording to continue.',
  'time-limit': 'Recording stopped after 5 minutes. Press Start recording to continue.',
  loop: 'Speech recognition kept stopping by itself, so recording was stopped. Press Start recording to try again, or type the details in the box.',
  refused: 'Recording was not started because Chrome could not confirm that speech stays on this computer. You can type the details in the box.',
  'error:aborted': 'Speech recognition may be in use in another Perinexa tab or window. Close the other one and press Start recording.',
  'error:not-allowed': 'The microphone is blocked for this site. Click the microphone icon at the right of the address bar, choose Allow, then press Start recording.',
  'error:audio-capture':
    'No microphone could be used. Check that one is connected. On a Mac, also check System Settings → Privacy & Security → Microphone → Google Chrome.',
  // audio-capture, by cause
  'error:audio-capture:busy': 'The microphone is being used by another program (for example a Zoom, Teams or WhatsApp call). Close it and press Start recording.',
  'error:audio-capture:disconnected': 'The microphone was disconnected. Connect it again, or choose another one in Microphone and speech settings, then press Start recording.',
  'error:service-not-allowed': 'Chrome could not start speech recognition on this computer. Close and reopen Chrome, then try again. You can type the details meanwhile.',
  'error:language-not-supported': 'Speech recognition needs to be set up on this computer again.',
  error: 'Speech recognition stopped. You can type or correct the details in the box instead.',
};
// Recordings that ended for an ordinary reason: shown as "Paused", not as an error.
export const PAUSED_REASONS = new Set(['silence', 'hidden', 'time-limit']);
export const MASKED_WORDS_NOTE =
  "Some words were hidden by Chrome's Live Caption setting 'Mask offensive words'. Turn it off in Chrome Settings → Accessibility.";

// The message for how a recording ended (none for Stop). cause: what went wrong with the microphone, if known.
export const endMessage = (reason, cause) =>
  (cause && ERROR_MESSAGES[`${reason}:${cause}`]) ?? ERROR_MESSAGES[reason] ?? (reason?.startsWith('error:') ? ERROR_MESSAGES.error : null);

// What is asked of the microphone: Chrome's noise suppression, echo cancellation and volume levelling, one channel, and
// the chosen microphone if it is still there (`ideal`, never `exact`: otherwise Chrome's default).
export function microphoneConstraints(deviceId) {
  return {
    audio: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
    },
  };
}

// getTrack for createVoiceSession, from navigator.mediaDevices: the microphone's track (null without getUserMedia).
export function microphoneFrom(media) {
  if (typeof media?.getUserMedia !== 'function') return null;
  return async (deviceId) => {
    const stream = await media.getUserMedia(microphoneConstraints(deviceId));
    const [track, ...extra] = stream.getAudioTracks();
    extra.forEach((t) => t.stop());
    if (!track) throw Object.assign(new Error('no audio track'), { name: 'NotFoundError' });
    return track;
  };
}

// A getUserMedia error → how the recording ends: { reason, cause }
export function microphoneError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { reason: 'error:not-allowed' };
    case 'NotReadableError':
    case 'AbortError':
      return { reason: 'error:audio-capture', cause: 'busy' };
    default: // NotFoundError, OverconstrainedError, anything else
      return { reason: 'error:audio-capture' };
  }
}

// Google Chrome itself: Edge, Brave and other Chromium browsers may have the same property but another speech service.
export const isGoogleChrome = (nav) => Boolean(nav?.userAgentData?.brands?.some((b) => b.brand === 'Google Chrome'));

// The privacy check, run on each new recogniser just before start(): processLocally exists, is really switched on,
// and this is Google Chrome.
export function staysOnThisComputer(Recognition, r, nav) {
  return Boolean(Recognition?.prototype) && 'processLocally' in Recognition.prototype && r.processLocally === true && isGoogleChrome(nav);
}

// Can this browser record at all? → { ok: true } | { ok: false, reason: 'insecure'|'not-chrome'|'old-chrome'|'no-speech' }
export function speechEnvironment(win = globalThis) {
  if (!win?.isSecureContext) return { ok: false, reason: 'insecure' }; // (the browser name is only readable on https)
  if (!isGoogleChrome(win.navigator)) return { ok: false, reason: 'not-chrome' };
  const Recognition = win.SpeechRecognition; // never webkitSpeechRecognition: it may go online
  if (!Recognition) return { ok: false, reason: 'no-speech' };
  if (!('processLocally' in Recognition.prototype) || typeof Recognition.available !== 'function') return { ok: false, reason: 'old-chrome' };
  return { ok: true };
}

// Is English speech recognition ready on this computer? en-IN first; en-US only if en-IN fails or is unavailable
// (Chrome has one English model for computers, so both give the same model today).
// → { status: 'unsupported'|'ready'|'needs-setup'|'setting-up'|'unavailable', lang }
export async function checkSpeech(Recognition, tags = ['en-IN', 'en-US']) {
  if (typeof Recognition?.available !== 'function') return { status: 'unsupported' };
  for (const lang of tags) {
    let status;
    try {
      status = await Recognition.available({ langs: [lang], processLocally: true });
    } catch {
      continue;
    }
    if (status === 'available') return { status: 'ready', lang };
    if (status === 'downloadable') return { status: 'needs-setup', lang };
    if (status === 'downloading') return { status: 'setting-up', lang };
  }
  return { status: 'unavailable' };
}

// One-time set-up of the speech model on this computer (no patient information is involved). Must be called as the
// first thing in the click handler, before any `await`: Chrome only allows it straight after a click.
// → Promise<'ready'|'failed'|'needs-click'>
export function installSpeech(Recognition, lang) {
  const failed = (err) => (err?.name === 'NotAllowedError' ? 'needs-click' : 'failed');
  let pending;
  try {
    pending = Recognition.install({ langs: [lang], processLocally: true });
  } catch (err) {
    return Promise.resolve(failed(err));
  }
  return Promise.resolve(pending).then((ok) => (ok === true ? 'ready' : 'failed'), failed);
}

// Start recording on a website Chrome hasn't set speech up for yet (it asks once per website, even when the model is
// already on this computer): installSpeech's answer, or 'slow' if it takes longer than `ms` (a download – the caller
// waits for it instead of starting the recording much later by itself).
// → Promise<'ready'|'failed'|'needs-click'|'slow'>
export function setupWithin(installing, ms, timers = globalThis) {
  let timer;
  const slow = new Promise((done) => {
    timer = timers.setTimeout(() => done('slow'), ms);
  });
  return Promise.race([installing, slow]).finally(() => timers.clearTimeout(timer));
}

// The words Chrome should listen out for ([{ text, boost }]). One bad phrase (e.g. an odd learned word) is skipped,
// never the whole list; boosts are kept within Chrome's 0–10.
export function buildPhrases(Phrase, list) {
  const phrases = [];
  for (const { text, boost } of list ?? []) {
    try {
      phrases.push(new Phrase(text, Math.min(10, Math.max(0, Number.isFinite(boost) ? boost : 1))));
    } catch {
      // skipped
    }
  }
  return phrases;
}

// Types of care in pregnancy: what was said there is never read by the newborn rules (PCPNDT).
export const PREGNANCY_CARE = ['antenatal', 'postnatal', 'infertility', 'abortion'];

// Changing the type of care. What was said (or is being said) in pregnancy care is never read by the newborn rules
// (PCPNDT), even by way of another type of care. busy: there is text in the box or a recording (even one finishing or
// starting). fromPregnancy: the text in the box began in pregnancy care. → { clear, fromPregnancy }
export function careTypeChange({ from, to, fromPregnancy, busy }) {
  const pregnancy = busy && (fromPregnancy || PREGNANCY_CARE.includes(from));
  if (to === 'newborn' && pregnancy) return { clear: true, fromPregnancy: false };
  return { clear: false, fromPregnancy: pregnancy };
}

// Speaking counts as using Perinexa (owner decision 8): the 30-minute automatic logout (auth/AuthContext.jsx) listens for
// this window event too. It carries nothing of what was said.
export const ACTIVITY_EVENT = 'perinexa:activity';
const ACTIVITY_EVERY_MS = 10 * 1000;
// For one recording: call the result each time words are heard; it calls `signal` at most every 10 seconds.
export function speechActivity(signal, now = () => Date.now()) {
  let last = -Infinity;
  return () => {
    if (now() - last < ACTIVITY_EVERY_MS) return;
    last = now();
    signal();
  };
}

/**
 * The words of one recogniser from Chrome's result events (16 Oct 2026). Chrome normally sends every result so far in
 * each event; but Chrome's on-device recogniser can start its list again after a pause, so the next event no longer
 * holds the words before the pause ("Asha Patil … age 28" became "age 28": the name was lost). Words Chrome has
 * marked final are therefore kept here, even when a later event leaves them out; words not final yet are replaced.
 * Returns { add(event) → { finals, interim } }. PURE (exported for the tests).
 */
export function speechResults() {
  const kept = []; // finals from an earlier list Chrome started again
  let list = []; // this list: { text, final } by Chrome's index
  return {
    add(e) {
      const results = e?.results ?? [];
      const from = Math.max(0, Math.min(e?.resultIndex ?? 0, results.length));
      const said = (i) => results[i]?.[0]?.transcript?.trim() ?? '';
      // A final result never changes: a different one at its place (or a shorter list) means Chrome started again
      let again = results.length < list.filter((x) => x?.final).length;
      for (let i = from; i < results.length && !again; i += 1) if (list[i]?.final && said(i) !== list[i].text) again = true;
      if (again) {
        kept.push(...list.filter((x) => x?.final && x.text).map((x) => x.text));
        list = [];
      }
      const start = again ? 0 : from;
      const next = list.slice(0, start);
      for (let i = start; i < results.length; i += 1) next[i] = { text: said(i), final: Boolean(results[i]?.isFinal) };
      list = next;
      const words = (final) => list.filter((x) => x && x.text && x.final === final).map((x) => x.text);
      return { finals: [...kept, ...words(true)].join(' '), interim: words(false).join(' ') };
    },
  };
}

// Texts of separate recognisers (and what was already in the box) are joined as sentences.
const joinParts = (parts) => parts.filter(Boolean).reduce((all, part) => (all ? `${all}${/[.,;:?!]$/.test(all) ? ' ' : '. '}${part}` : part), '');

/**
 * One recording. Returns { start(beforeText), stop(), abort() }:
 * - start(beforeText): records; the text continues from beforeText (what is in the box)
 * - stop(): Stop pressed – Chrome's last words are waited for (6 seconds at most), then onEnd({ reason: 'stopped' })
 * - abort(): the page is closing (unmount, logout) – everything stops at once, no more callbacks
 * Callbacks: onState('asking-mic'|'starting'|'listening'|'hearing'|'finishing'|'idle'), onText({ committed, interim,
 * text }), onEnd({ reason, text, cause? }) with reason 'stopped'|'silence'|'hidden'|'loop'|'time-limit'|'refused'|
 * 'error:<code>' (cause: 'busy' or 'disconnected' for a microphone problem; 'hidden': Chrome would not start, or
 * stopped, while the page was in another tab), onActivity('words'|'no-words-yet'), onMic('muted'|'live').
 * The microphone (optional): getTrack(deviceId) → Promise<MediaStreamTrack> (see microphoneFrom), asked once per Start
 * for `deviceId` (the chosen microphone). If that microphone is gone, onDeviceGone() is called and Chrome's default
 * is asked for once. Without getTrack, Chrome uses its own microphone.
 * timers, now, isHidden, devices (where "devicechange" is heard), nav (for the browser name) and log can be replaced in
 * tests.
 */
export function createVoiceSession({
  Recognition,
  Phrase,
  lang,
  phrases = [],
  getTrack = null,
  deviceId = '',
  onDeviceGone = () => {},
  onMic = () => {},
  onState = () => {},
  onText = () => {},
  onEnd = () => {},
  onActivity = () => {},
  timers = globalThis,
  now = () => Date.now(),
  isHidden = () => globalThis.document?.hidden === true,
  devices = globalThis.navigator?.mediaDevices,
  nav = globalThis.navigator,
  log = console,
}) {
  let active = false; // between start() and the end
  let wanted = false; // keep recording: start a new recogniser when Chrome ends one
  let stopping = false; // Stop (or a limit): waiting for Chrome's last words
  let endReason = null; // why it is stopping
  let r = null; // the current recogniser (none in the gap before a restart)
  let generation = 0; // events from older recognisers are ignored
  let before = '';
  const done = []; // the text of each finished recogniser
  let finals = ''; // this recogniser: final words
  let interim = ''; // this recogniser: words not final yet
  let heardThisOne = false;
  let heardAny = false;
  let silentInARow = 0;
  let restarts = []; // times of recent restarts
  let lastAborted = -Infinity;
  let hintStarted = false;
  let shown = 'idle'; // the state last reported
  let track = null; // this recording's microphone (none: Chrome's own)
  let plainStart = false; // this Chrome can't be handed a microphone: start() without it
  let asking = 0; // which Start the microphone was asked for (a late answer to an older one is switched off)
  const pending = {}; // timers by name
  const setState = (state) => {
    shown = state;
    onState(state);
  };

  const clear = (name) => {
    if (pending[name] != null) timers.clearTimeout(pending[name]);
    pending[name] = null;
  };
  const clearAll = () => Object.keys(pending).forEach(clear);
  const after = (name, ms, fn) => {
    clear(name);
    pending[name] = timers.setTimeout(() => {
      pending[name] = null;
      fn();
    }, ms);
  };

  const current = () => [finals, interim].filter(Boolean).join(' ');
  const report = () => onText({ committed: joinParts([before, ...done, finals]), interim, text: joinParts([before, ...done, current()]) });
  // A recogniser has ended: its words (and the last unfinished ones) join the text.
  const commit = () => {
    const said = current();
    if (said) done.push(said);
    finals = '';
    interim = '';
  };
  const detach = (rec) => {
    rec.onaudiostart = null;
    rec.onspeechstart = null;
    rec.onspeechend = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  };
  const dropCurrent = () => {
    if (!r) return;
    const rec = r;
    r = null;
    detach(rec);
    try {
      rec.abort();
    } catch {
      // already ended
    }
  };
  // Another microphone plugged in or out: is this one still there, and is it muted?
  const onDevices = () => {
    if (!track) return;
    if (track.readyState !== 'live') finish('error:audio-capture', 'disconnected');
    else onMic(track.muted ? 'muted' : 'live');
  };
  const watchPage = (on) => {
    devices?.[on ? 'addEventListener' : 'removeEventListener']?.('devicechange', onDevices);
  };
  const quiet = (t) => {
    t.onended = null;
    t.onmute = null;
    t.onunmute = null;
    try {
      t.stop();
    } catch {
      // already stopped
    }
  };
  // The microphone is switched off
  const releaseTrack = () => {
    if (!track) return;
    const t = track;
    track = null;
    quiet(t);
  };

  // The recording is over: everything stops and the text is handed over.
  function finish(reason, cause) {
    if (!active) return;
    active = false;
    wanted = false;
    commit();
    dropCurrent();
    releaseTrack();
    clearAll();
    watchPage(false);
    setState('idle');
    onEnd(cause ? { reason, text: joinParts([before, ...done]), cause } : { reason, text: joinParts([before, ...done]) });
  }

  // Stop, a limit or leaving the page: let Chrome give its last words first (it ends with onend).
  function finishWith(reason) {
    if (!active || stopping) return;
    wanted = false;
    stopping = true;
    endReason = reason;
    ['restart', 'hint', 'inactivity', 'limit'].forEach(clear);
    if (!r) {
      finish(reason); // in the gap before a restart: nothing to wait for
      return;
    }
    setState('finishing');
    try {
      r.stop();
    } catch {
      finish(reason);
      return;
    }
    after('stopTimeout', STOP_TIMEOUT_MS, () => {
      log.warn('voice: stop-timeout');
      finish(reason);
    });
  }

  const heardWords = () => {
    heardThisOne = true;
    heardAny = true;
    silentInARow = 0;
    clear('hint');
    if (!stopping) after('inactivity', INACTIVITY_MS, () => finishWith('silence'));
    onActivity('words');
  };

  // A new recogniser: privacy check, then start.
  function begin() {
    if (track && track.readyState !== 'live') {
      finish('error:audio-capture', 'disconnected');
      return;
    }
    let rec;
    try {
      rec = new Recognition();
      rec.processLocally = true;
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
    } catch (err) {
      log.warn(`voice: ${err?.name ?? 'create-failed'}`);
      finish('error:start-failed');
      return;
    }
    if (Phrase && 'phrases' in rec && phrases.length) {
      try {
        rec.phrases = buildPhrases(Phrase, phrases);
      } catch {
        log.warn('voice: phrases-skipped'); // recording still works, it just hears fewer OBGY words
      }
    }
    if (!staysOnThisComputer(Recognition, rec, nav)) {
      log.warn('voice: refused');
      finish('refused');
      return;
    }

    generation += 1;
    const gen = generation;
    const mine = (fn) => (e) => {
      if (gen === generation && r === rec) fn(e);
    };
    rec.onaudiostart = mine(() => {
      if (stopping) return;
      setState('listening');
      if (!heardAny && !hintStarted) {
        hintStarted = true;
        after('hint', NO_WORDS_HINT_MS, () => onActivity('no-words-yet'));
      }
    });
    rec.onspeechstart = mine(() => !stopping && setState('hearing'));
    rec.onspeechend = mine(() => !stopping && setState('listening'));
    const heard = speechResults(); // this recogniser's words (kept when Chrome starts its list again)
    rec.onresult = mine((e) => {
      const { finals: nextFinals, interim: nextInterim } = heard.add(e);
      if (nextFinals === finals && nextInterim === interim) return;
      finals = nextFinals;
      interim = nextInterim;
      if (finals || interim) heardWords();
      report();
    });
    rec.onerror = mine((e) => {
      const code = e?.error ?? 'unknown';
      log.warn(`voice: ${code}`);
      if (code === 'no-speech') return; // Chrome ends this recogniser next; onend starts a new one
      // Chrome may stop listening in a background tab: the recording ends, saying so
      if (isHidden() && wanted && HIDDEN_STOPS.has(code)) {
        finish('hidden');
        return;
      }
      if (code === 'aborted') {
        if (!wanted) return; // stopping anyway
        if (now() - lastAborted < ABORTED_WINDOW_MS) {
          finish('error:aborted'); // e.g. another Perinexa tab is recording
          return;
        }
        lastAborted = now(); // once: onend starts again
        return;
      }
      // Final. "phrases-not-supported" means Chrome thinks speech is not staying on this computer.
      finish(code === 'phrases-not-supported' ? 'refused' : `error:${code}`); // (language-not-supported has no end event)
    });
    // Restarts happen only here (never in onerror: a recoverable error is followed by onend, so both would start one).
    rec.onend = mine(() => {
      commit();
      r = null;
      detach(rec);
      if (!wanted) {
        finish(endReason ?? 'stopped');
        return;
      }
      silentInARow = heardThisOne ? 0 : silentInARow + 1;
      if (silentInARow >= SILENT_IN_A_ROW) {
        finish('silence');
        return;
      }
      const at = now();
      restarts = [...restarts.filter((t) => at - t < LOOP_WINDOW_MS), at];
      if (restarts.length > MAX_RESTARTS) {
        finish(isHidden() ? 'hidden' : 'loop'); // kept stopping while in another tab
        return;
      }
      if (shown === 'hearing') setState('listening');
      after('restart', RESTART_MS, begin);
    });

    r = rec;
    finals = '';
    interim = '';
    heardThisOne = false;
    try {
      if (track && !plainStart) {
        try {
          rec.start(track); // this recording's microphone
        } catch (err) {
          if (err?.name !== 'TypeError') throw err;
          plainStart = true; // an older Chrome: its own microphone (both silence limits still apply)
          log.warn('voice: plain-start');
          rec.start();
        }
      } else rec.start(); // plain start: Chrome's own microphone
    } catch (err) {
      log.warn(`voice: ${err?.name ?? 'start-failed'}`);
      if (isHidden()) finish('hidden'); // Chrome would not start in a background tab
      else finish(err?.name === 'NotAllowedError' ? 'error:not-allowed' : 'error:start-failed');
    }
  }

  // The microphone for this recording: asked for once, then used by every recogniser until the end.
  function useTrack(t) {
    track = t;
    t.onended = () => {
      if (track === t) finish('error:audio-capture', 'disconnected');
    };
    t.onmute = () => track === t && onMic('muted');
    t.onunmute = () => track === t && onMic('live');
    if (t.muted) onMic('muted');
  }
  // Both limits count from when the microphone is on, never while Chrome is asking to use it (its Allow / Block
  // bubble may stay open for minutes; nothing is recorded meanwhile, and Stop still ends it at once)
  function startLimits() {
    after('limit', TIME_LIMIT_MS, () => finishWith('time-limit'));
    after('inactivity', INACTIVITY_MS, () => finishWith('silence'));
  }
  function askForMicrophone() {
    asking += 1;
    const mine = asking;
    const late = () => !active || stopping || mine !== asking;
    const got = (t) => {
      if (late()) {
        quiet(t); // Stop, or the page closed, while Chrome was asking: switched off at once
        return;
      }
      useTrack(t);
      setState('starting');
      startLimits();
      begin();
    };
    const failed = (err) => {
      if (late()) return;
      log.warn(`voice: ${err?.name ?? 'microphone-failed'}`);
      const { reason, cause } = microphoneError(err);
      finish(reason, cause);
    };
    setState('asking-mic'); // "Chrome is asking to use the microphone" (over at once when already allowed)
    Promise.resolve()
      .then(() => getTrack(deviceId || undefined))
      .then(got, (err) => {
        if (late()) return;
        // The chosen microphone is gone: forget it, and ask once for Chrome's default
        if (deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
          log.warn(`voice: ${err.name}`);
          onDeviceGone();
          Promise.resolve()
            .then(() => getTrack(undefined))
            .then(got, failed);
          return;
        }
        failed(err);
      });
  }

  return {
    start(beforeText = '') {
      if (active) return;
      active = true;
      wanted = true;
      stopping = false;
      endReason = null;
      before = String(beforeText ?? '').trim();
      done.length = 0;
      finals = '';
      interim = '';
      heardAny = false;
      silentInARow = 0;
      restarts = [];
      lastAborted = -Infinity;
      hintStarted = false;
      plainStart = false;
      watchPage(true);
      setState('starting');
      if (getTrack) askForMicrophone();
      else {
        startLimits();
        begin();
      }
    },
    stop() {
      finishWith('stopped');
    },
    abort() {
      if (!active) return;
      active = false;
      wanted = false;
      dropCurrent();
      releaseTrack();
      clearAll();
      watchPage(false);
    },
  };
}
