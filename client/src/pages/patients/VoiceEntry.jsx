import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronUp, Loader, Mic, MicOff, Pause, Sparkles, Square, TriangleAlert, Undo2 } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, InfoToggle, StatusPill } from '../../components/ui.jsx';
import { startAiRecording, transcribeRecording } from './aiDictation.js';
import { answerToResult, extractPatientDetails, suggestionMeaning, isValueMeaning, onlyLinkWords, questionKey, questionsToShow, withoutFetalSex } from './dictation.js';
import { hearingPhrases, isBlockedLearned } from './obgyTerms.js';
import { CONDITION_LABELS, PAST_COMPLICATION_LABELS } from './patientFormat.js';
import {
  ACTIVITY_EVENT,
  ERROR_MESSAGES,
  PREGNANCY_CARE,
  MASKED_WORDS_NOTE,
  PAUSED_REASONS,
  careTypeChange,
  checkSpeech,
  createVoiceSession,
  endMessage,
  installSpeech,
  microphoneFrom,
  setupWithin,
  speechActivity,
  speechEnvironment,
} from './voiceSession.js';

// PRIVACY: speech is turned into text only ON THIS COMPUTER (Google Chrome's on-device speech recognition).
// If Chrome can't confirm that, the microphone stays off – it never falls back to an online service (see
// voiceSession.js, which checks this before every start). What was said is kept only on this page: it is not saved or
// sent anywhere. Only a word the person asks to remember (e.g. "PCOD" → PCOS) is saved to their own account, never
// anything about the patient. The microphone chosen in "Microphone and speech settings" is remembered in this browser
// (its ID only).
// AI DICTATION (Smart features, the owner's request) is the one exception, and only when the person presses "AI
// dictation": the recording is sent to OpenAI (through Perinexa's server) to be written down, because it hears
// Indian-English medical dictation much better. The card says so next to the button. Nothing is kept.

const SETUP_NOTE_MS = 3 * 1000; // set-up taking longer than this: it is downloading
const SETUP_SLOW_MS = 90 * 1000;
const SETUP_POLL_MS = 5 * 1000;
const MIC_KEY = 'perinexa.voice.microphone'; // the chosen microphone's ID, in this browser only
const AUTO_FILL_MS = 1000; // typing in the box: the form is filled in this long after the last key

// "Ask AI where these belong" by itself (after Fill in the form or a recording): never her name or a number that
// could be her phone. Each word of the name read from the text, and every run of 5 or more digits, is blanked.
const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const withoutIdentity = (part, name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .reduce((t, w) => t.replace(new RegExp(`\\b${escapeRx(w)}\\b`, 'gi'), '…'), part)
    .replace(/\d[\d\s-]{3,}\d/g, '…');

// The chosen microphone. Browser storage can be switched off (or blocked): then Chrome's default is used.
const savedMic = () => {
  try {
    return window.localStorage.getItem(MIC_KEY) ?? '';
  } catch {
    return '';
  }
};
const saveMic = (id) => {
  try {
    if (id) window.localStorage.setItem(MIC_KEY, id);
    else window.localStorage.removeItem(MIC_KEY);
  } catch {
    // not remembered: the choice still applies until the page closes
  }
};
// The microphones on this computer (not Chrome's "Default" and "Communications" entries, which repeat one of them)
const listMicrophones = async () => {
  try {
    const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  } catch {
    return [];
  }
};

// The loader icon, turning (see pages-patients.css)
const Turning = (props) => <Loader {...props} className="voice-turning" />;

// Status while recording: colour + icon + word
const PHASES = {
  'asking-mic': { tone: 'inactive', icon: Mic, label: 'Allow the microphone' },
  starting: { tone: 'inactive', icon: Turning, label: 'Starting microphone' },
  listening: { tone: 'brand', icon: Mic, label: 'Listening' },
  hearing: { tone: 'stable', icon: AudioLines, label: 'Hearing you' },
  finishing: { tone: 'inactive', icon: Turning, label: 'Finishing' },
};
const MUTED = { tone: 'due', icon: MicOff, label: 'Microphone muted' };
const PAUSED = { tone: 'due', icon: Pause, label: 'Paused' };
const AI_RECORDING = { tone: 'brand', icon: Mic, label: 'Listening – speak now' };
const AI_WRITING = { tone: 'inactive', icon: Turning, label: 'AI is writing it down' };

// The status while recording (colour + icon + word). micAllowed: the microphone is already allowed, so Chrome is not
// asking about it.
const recordingPill = ({ phase, muted, micAllowed }) => {
  if (phase === 'asking-mic' && micAllowed) return PHASES.starting;
  if (muted && phase !== 'finishing') return MUTED;
  return PHASES[phase];
};

/**
 * The recording bar just above the Save button, while recording (the voice card may be scrolled out of view):
 * the status and Stop recording. status: { phase, muted, micAllowed } from VoiceEntry's onStatus.
 */
export function VoiceBar({ status, onStop }) {
  if (!status || status.phase === 'idle') return null;
  const pill = recordingPill(status);
  return (
    <div className="voice-bar">
      <StatusPill tone={pill.tone} icon={pill.icon}>
        {pill.label}
      </StatusPill>
      <button type="button" className="btn btn-secondary" onClick={onStop} disabled={status.phase === 'finishing'}>
        <Square aria-hidden="true" /> Stop recording
      </button>
    </div>
  );
}

const SETUP_NOTES = {
  downloading: 'Chrome is adding English speech recognition to this computer. This needs the internet once. Nothing you say is sent.',
  slow: 'Still downloading (about 100 MB, once). You can type the details meanwhile. If an IT person manages this computer, Chrome downloads may be blocked.',
  failed: 'The download did not finish. Check the internet connection, free about 150 MB of disk space, and press Start recording again.',
  'needs-click': 'Press Start recording again.',
  again: 'Speech recognition needs to be set up again. Press Start recording.',
  ready: 'Ready. Press Start recording.',
};

const TIPS = [
  'Say each detail with its name, for example “age 28” or “LMP 12 July 2026”.',
  'Say phone numbers digit by digit. “Double” and “triple” are fine.',
  'Say short forms letter by letter (“L S C S”) or as a word (“PCOD”).',
  'For test results, say “non-reactive” or “negative” clearly. Perinexa asks you to confirm results and blood group.',
  'If you say something wrong, say “sorry” and the right value, for example “age 25, sorry, 26”.',
  "Chrome's English speech recognition often leaves out Hindi words. If a Hindi word is missed, say it in English (for example “age 25” instead of “pachees saal”).",
  'A headset microphone works best in a busy OPD.',
  'Use Google Chrome on a Windows or Mac computer. The first set-up needs the internet once, and again in an Incognito window.',
  'The corrections were built for Indian English as spoken in the Hindi belt, Punjab, Gujarat, Maharashtra, Bengal, Odisha, Assam and the North-East, ' +
    'Tamil Nadu, Andhra Pradesh and Telangana, Karnataka, Kerala, and in cities.',
];

const INTRO =
  'Say the details and they are filled in below for you to check. Speech is turned into text on this computer: nothing is sent anywhere or ' +
  'kept. Perinexa includes corrections for common Indian English pronunciations of medical words, numbers and dates, asks when it is not ' +
  'sure, and remembers your own corrections.';
const NOTE_TO = [{ key: 'notes', label: 'Add to notes' }];

// Adds what an answer filled in to a list shown, without repeating what is already there
const addNew = (list, more, extra = {}) => [...list, ...more.filter((f) => !list.some((x) => x.label === f.label && x.text === f.text)).map((f) => ({ ...f, ...extra }))];

// "What does XYZ mean?" – everything a short form can mean in the form
function TeachChoice({ question, onAnswer, disabled }) {
  const [value, setValue] = useState('');
  const word = question.heard.toUpperCase();
  const id = `${question.id}-teach`;
  return (
    <div className="voice-teach">
      <label className="sr-only" htmlFor={id}>
        What “{question.heard}” means
      </label>
      <select id={id} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled}>
        <option value="">Choose what it means…</option>
        <optgroup label="Existing conditions">
          {Object.entries(CONDITION_LABELS).map(([k, label]) => (
            <option key={k} value={`condition:${k}`}>
              {label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Problems in previous pregnancies">
          {Object.entries(PAST_COMPLICATION_LABELS).map(([k, label]) => (
            <option key={k} value={`past:${k}`}>
              {label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Write it as it is">
          <option value={`other:${word}`}>In “Other conditions” as “{word}”</option>
          <option value={`note:${word}`}>In the notes as “{word}”</option>
        </optgroup>
      </select>
      <button type="button" className="btn btn-secondary" disabled={!value || disabled} onClick={() => onAnswer(value)}>
        Use this
      </button>
    </div>
  );
}

function Question({ question, onAnswer }) {
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const answer = async (value) => {
    setBusy(true);
    await onAnswer(question, value, question.remember && question.group !== 'confirm' && remember);
    setBusy(false);
  };
  const titleId = `${question.id}-title`;
  return (
    <li className="voice-question" aria-labelledby={titleId}>
      <p id={titleId}>
        {question.heard && (
          <>
            <strong>“{question.heard}”</strong> –{' '}
          </>
        )}
        {question.prompt}
      </p>
      <div className="voice-options">
        {question.teach && <TeachChoice question={question} onAnswer={answer} disabled={busy} />}
        {question.options.map((o) => (
          <button key={`${o.value}|${o.label}`} type="button" className="btn btn-secondary" onClick={() => answer(o.value)} disabled={busy}>
            {o.label}
          </button>
        ))}
      </div>
      {question.remember && question.group !== 'confirm' && (
        <label className="check voice-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my answer for “{question.heard}” next time
        </label>
      )}
    </li>
  );
}

/**
 * Voice entry: records what is said, turns it into text on this computer and fills in the form.
 * - careType: which details to look for
 * - onDetails(result): puts the details into the form; returns what happened ({ here, later, dropped, skippedInfo,
 *   notes, questions, unused })
 * - onAnswer(result): puts one answer (or "Add to notes") into the form; returns { here, later }
 * - onBusy(recording): told when a recording starts and ends (the form can't be saved while recording)
 * - onStatus(status | null): the recording's status for the bar above the Save button (VoiceBar)
 * - control: a ref the form uses to stop the recording ({ stop() }) when it is submitted or the page changes
 * - canNote: this person may add notes (clinical details)
 * - example: an example of what to say on this page
 * - initial: what was already filled when the page opened (details carried over from the previous page)
 * - initialText: what was said on the New patient chooser (the type of care was picked from it): put in the box and
 *   read once when the card opens
 * Optional, for other forms that use the same card (e.g. a visit):
 * - read(text, { careType, words, voice, keep }): reads the text; returns the same shape as extractPatientDetails
 * - answerWith(question, value): turns an answer (or "note:…") into a result for onAnswer (default answerToResult)
 * - noteTo: the "Add to …" buttons for a part not understood ([{ key, label }]; key 'notes' sends "note:<text>",
 *   any other key "note:<key>:<text>")
 * - intro, tips: the card's introduction and its "Tips for clear dictation"
 * - hearing(careType, words): the words Chrome is told to expect ([{ text, boost }], default hearingPhrases)
 */
// Voice entry is folded into a "Dictate" button until someone opens it; the choice is remembered on this computer.
const OPEN_KEY = 'perinexa:voiceOpen';
/** [open, setOpen] for the voice entry card. force: open whatever was remembered (e.g. details said on the last page). */
export function useVoiceOpen(force = false) {
  const [open, setOpenState] = useState(() => {
    if (force) return true;
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setOpen = (value) => {
    setOpenState(value);
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0');
    } catch {
      /* not important if it can't be remembered */
    }
  };
  return [open, setOpen];
}

/** The folded voice entry: one button. */
export function DictateButton({ onOpen }) {
  return (
    <div className="voice-folded">
      <button type="button" className="btn btn-secondary" onClick={onOpen}>
        <Mic aria-hidden="true" /> Dictate
      </button>
    </div>
  );
}

export function VoiceEntry({
  careType,
  onDetails,
  onAnswer,
  onBusy,
  onStatus,
  control,
  canNote,
  example,
  initial,
  initialText = '',
  emptyNote = 'No details could be read from the text. Check the words in the box or type the details.', // null: not shown
  read = extractPatientDetails,
  answerWith,
  noteTo = NOTE_TO,
  intro = INTRO,
  tips = TIPS,
  hearing = hearingPhrases,
  aiForm = 'patient', // "Ask AI where these belong": which form's fields
  aiMeaning = suggestionMeaning, // an AI suggestion → an answer for this form
  onHide = null, // folds the card back into the Dictate button (not while recording)
}) {
  const [env] = useState(() => speechEnvironment(typeof window === 'undefined' ? undefined : window));
  const [Recognition] = useState(() => (env.ok ? window.SpeechRecognition : undefined)); // never webkitSpeechRecognition
  const [speech, setSpeech] = useState(env.ok ? { status: 'checking' } : { status: 'unsupported', reason: env.reason });
  const [setupNote, setSetupNote] = useState(null);
  const [phase, setPhase] = useState('idle'); // 'idle' or the recording's state
  const [paused, setPaused] = useState(null); // why the last recording paused
  const [noWords, setNoWords] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [sexRemoved, setSexRemoved] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [summary, setSummary] = useState(initial ?? null);
  const [summaryFor, setSummaryFor] = useState(careType);
  const [words, setWords] = useState([]);
  const [kept, setKept] = useState([]); // corrections undone: words kept as heard, for this form only (never saved)
  const [allQuestions, setAllQuestions] = useState(false); // "More questions (N)" pressed
  const [mics, setMics] = useState([]);
  const [micId, setMicId] = useState(savedMic);
  const [muted, setMuted] = useState(false);
  const [aiPhase, setAiPhase] = useState('idle'); // AI dictation: 'idle' | 'starting' | 'recording' | 'writing'
  // The AI dictation button shows beside Start recording (owner, 15 Oct 2026), as in Perinexa: hidden only when the
  // server says plainly that AI is not set up. A failed check never hides it (20 Oct 2026: it vanished without a word);
  // pressing it then shows the server's own message.
  const [aiOn, setAiOn] = useState(true);
  const [aiHelp, setAiHelp] = useState(null); // "Ask AI where these belong": { busy, items: [{ part, text, label, meaning }] }
  const aiRec = useRef(null);
  const answered = useRef(new Set()); // questions answered on this form (questionKey)
  const noted = useRef(new Set()); // "Not understood" parts added to the notes
  const session = useRef(null);
  const starting = useRef(null); // a Start waiting for Chrome's check: Stop or another type of care cancels it
  const startedWith = useRef('');
  const alive = useRef(true);
  const setupRun = useRef({ timers: [], poll: null }); // set-up in progress: its timers
  const lastCare = useRef(careType);
  const fromPregnancy = useRef(false); // the text in the box began in pregnancy care
  const latest = useRef({}); // what the recording's callbacks use, kept up to date
  const lastRead = useRef(null); // the latest reading of the text (for "Use what was said")
  const typed = useRef(false); // the box was typed in since it was last read

  // Filled from speech (`voice`): results and blood group go to the confirmation card. In a pregnancy (antenatal or
  // abortion care), anything said about the baby's sex is taken out of the box first (PCPNDT). The whole text is read each time; questions
  // already answered are not asked again, and answers given stay in the list. keep: words left as heard (Undo).
  // ai: also ask AI about the parts not understood – only when her name was read from the text (so it can be blanked;
  // an unread name could be in those parts), and never in typing pauses.
  const fill = (source, keep = kept, { ai = false } = {}) => {
    let said = source;
    if (careType === 'antenatal' || careType === 'abortion') {
      const cut = withoutFetalSex(source);
      if (cut.removed) {
        said = cut.text;
        setText(said);
        setSexRemoved(true);
      }
    }
    const result = read(said, { careType, words, voice: true, keep });
    lastRead.current = result;
    const next = onDetails({ ...result, questions: result.questions.filter((q) => !answered.current.has(questionKey(q))) });
    const before = summaryFor === careType ? summary : null;
    // Answers given stay in the list – unless that detail was changed by hand since
    const byHand = new Set(next.handEdited ?? []);
    const sources = (f) => [f.path, ...(f.ticks ?? []).map((t) => t.key), ...(f.pieces ?? []).map((x) => x.path)];
    const stillAnswer = (f) => f.answered && !sources(f).some((p) => p && byHand.has(p) && p !== 'notes' && p !== 'medical.otherConditions');
    setSummary({
      ...next,
      here: addNew(next.here, (before?.here ?? []).filter(stillAnswer), { answered: true }),
      later: addNew(next.later, (before?.later ?? []).filter((f) => f.answered), { answered: true }),
      unused: next.unused.filter((u) => !noted.current.has(u.text)),
    });
    setAllQuestions(false);
    setAiHelp(null);
    const name = result.values?.fullName;
    const parts = next.unused.filter((u) => !u.sex && !noted.current.has(u.text));
    if (ai && name && parts.length) askAiAbout(parts, { name, quiet: true });
  };
  const recording = phase !== 'idle' || aiPhase !== 'idle';
  const micAllowed = mics.some((m) => m.label); // Chrome names the microphones only once one is allowed
  const refreshMics = () => listMicrophones().then((list) => alive.current && setMics(list));

  // Choosing another type of care from the menu: the old summary no longer applies.
  if (summaryFor !== careType) {
    setSummaryFor(careType);
    setSummary(null);
  }

  const stopSetup = () => {
    setupRun.current.timers.forEach((t) => clearTimeout(t));
    clearInterval(setupRun.current.poll);
    setupRun.current = { timers: [], poll: null };
  };
  // Waits for the speech model: install()'s answer, or available() asked every 5 seconds.
  const watchSetup = (lang, installing) => {
    stopSetup();
    const run = setupRun.current;
    const current = () => alive.current && setupRun.current === run;
    const ready = () => {
      if (!current()) return;
      stopSetup();
      setSpeech({ status: 'ready', lang });
      setSetupNote('ready'); // never starts recording by itself
    };
    run.timers.push(
      setTimeout(() => current() && setSetupNote('downloading'), SETUP_NOTE_MS),
      setTimeout(() => current() && setSetupNote('slow'), SETUP_SLOW_MS),
    );
    run.poll = setInterval(() => {
      checkSpeech(Recognition, [lang]).then((s) => s.status === 'ready' && ready());
    }, SETUP_POLL_MS);
    installing?.then((result) => {
      if (!current()) return;
      if (result === 'ready') {
        ready();
        return;
      }
      stopSetup();
      setSpeech({ status: 'needs-setup', lang });
      setSetupNote(result === 'needs-click' ? 'needs-click' : 'failed');
    });
  };
  const showCheck = (s) => {
    if (import.meta.env.DEV) console.info(`voice: model ${s.status}`); // the live site prints nothing in the console
    setSpeech(s);
    if (s.status === 'setting-up') watchSetup(s.lang, null);
  };

  useEffect(() => {
    latest.current = { fill, speech, text, careType, words, micId, finishAi };
  });

  // Said on the New patient chooser: read into this form once (the same as typed text)
  useEffect(() => {
    if (!initialText.trim()) return;
    fromPregnancy.current = PREGNANCY_CARE.includes(careType);
    setText(initialText);
    fill(initialText);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    alive.current = true;
    if (Recognition) checkSpeech(Recognition).then((s) => alive.current && showCheck(s));
    api('/ai/status')
      .then((res) => alive.current && setAiOn(res?.enabled !== false))
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('voice: AI status check failed – the AI dictation button stays', err?.message);
      });
    api('/me/dictation-words')
      .then((res) => alive.current && setWords(res.words))
      .catch(() => {}); // without them, voice entry still works (it just asks more)
    // An unused speech model can expire: check again when the window gets focus.
    const recheck = () => {
      if (!Recognition || session.current || setupRun.current.poll) return;
      checkSpeech(Recognition).then((s) => {
        if (!alive.current || session.current || setupRun.current.poll) return;
        if (s.status === 'ready' && latest.current.speech.status !== 'ready') setSetupNote(null);
        showCheck(s);
      });
    };
    window.addEventListener('focus', recheck);
    // The microphone list: now, and when one is plugged in or out
    refreshMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', recheck);
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMics);
      session.current?.abort(); // the page is closing: microphone off, every timer cleared
      session.current = null;
      aiRec.current?.abort();
      aiRec.current = null;
      stopSetup();
    };
  }, []); // once, when the page opens

  // Stop: a Start still waiting for Chrome's check records nothing; otherwise the recording finishes.
  const stopRecording = () => {
    if (aiRec.current) {
      latest.current.finishAi?.();
      return;
    }
    if (starting.current) {
      starting.current = null;
      setPhase('idle');
      return;
    }
    session.current?.stop();
  };

  // The Stop button. The second click of a double-click on Start lands on it: that one is ignored.
  const pressStop = (e) => {
    if (e.detail > 1) return;
    stopRecording();
  };

  // The form stops the recording when it is submitted or the page changes.
  useEffect(() => {
    if (!control) return undefined;
    control.current = { stop: stopRecording }; // (uses only refs and setPhase, so this one stays correct)
    return () => {
      control.current = null;
    };
  }, [control]);

  useEffect(() => {
    onBusy?.(recording);
  }, [recording, onBusy]);

  // Typing in the box: the form is filled in a moment after the last key (by Perinexa's own reader only)
  useEffect(() => {
    if (!typed.current || recording || !text.trim()) return undefined;
    const timer = setTimeout(() => {
      typed.current = false;
      latest.current.fill(latest.current.text);
    }, AUTO_FILL_MS);
    return () => clearTimeout(timer);
  }, [text, recording]);

  useEffect(() => {
    const shown = aiPhase === 'starting' ? 'starting' : aiPhase === 'recording' ? 'listening' : aiPhase === 'writing' ? 'finishing' : phase;
    onStatus?.(recording ? { phase: shown, muted, micAllowed } : null);
  }, [recording, phase, aiPhase, muted, micAllowed, onStatus]);

  // The first time the microphone is allowed, Chrome names the microphones: list them again (for the choice).
  useEffect(() => {
    if (phase === 'listening' && !micAllowed) refreshMics();
  }, [phase, micAllowed]);

  // Another type of care while recording: stop (the form is filled for the new type when it ends). From pregnancy
  // care to newborn, by any route (e.g. antenatal → gynaecology → newborn), what was said is cleared instead (PCPNDT).
  useEffect(() => {
    const was = lastCare.current;
    if (was === careType) return;
    lastCare.current = careType;
    // The form drops the answers given for the old type of care (clinical details wait for page 2 per type): they are
    // asked again, and the parts not understood are shown again
    answered.current.clear();
    noted.current.clear();
    const busy = Boolean(session.current || starting.current) || Boolean(latest.current.text.trim());
    const next = careTypeChange({ from: was, to: careType, fromPregnancy: fromPregnancy.current, busy });
    fromPregnancy.current = next.fromPregnancy;
    if (next.clear) {
      session.current?.abort(); // also a recording that is still finishing: its onEnd never comes
      session.current = null;
      aiRec.current?.abort();
      aiRec.current = null;
      setAiPhase('idle');
      starting.current = null;
      setPhase('idle');
      setNoWords(false);
      setPaused(null);
      setError(null);
      setCleared(Boolean(latest.current.text.trim()));
      setText('');
      setKept([]);
    } else {
      stopRecording();
    }
  }, [careType]);

  // Chrome's speech model is set up once per website (app.perinexa.com even when localhost already has it): Start
  // recording does it. Ready within a few seconds (the model is already on this computer): the recording starts.
  // Longer (a download of about 100 MB): the set-up is watched and the person presses Start again once it is ready.
  // → { status: 'ready', lang }, or null when the recording does not start now.
  const setUpOnStart = async (lang, installing, token) => {
    const result = await setupWithin(installing, SETUP_NOTE_MS);
    if (!alive.current || starting.current !== token) return null; // closed, or Stop / another type of care meanwhile
    if (result === 'ready') return { status: 'ready', lang };
    starting.current = null;
    setPhase('idle');
    if (result === 'slow') {
      setSpeech({ status: 'setting-up', lang });
      setSetupNote('downloading');
      watchSetup(lang, installing);
    } else {
      setSpeech({ status: 'needs-setup', lang });
      setSetupNote(result === 'needs-click' ? 'needs-click' : 'failed');
    }
    return null;
  };

  const start = async () => {
    if (recording || session.current || starting.current) return;
    // First, before any await: Chrome allows the set-up only straight after the click
    const { status: known, lang: knownLang } = latest.current.speech;
    const installing = known === 'needs-setup' ? installSpeech(Recognition, knownLang) : null;
    setError(null);
    setPaused(null);
    setNoWords(false);
    setCleared(false);
    setSexRemoved(false);
    setSetupNote(null);
    setMuted(false);
    setPhase('starting');
    const token = {};
    starting.current = token;
    let s;
    if (installing) {
      s = await setUpOnStart(knownLang, installing, token);
      if (!s) return;
    } else {
      s = await checkSpeech(Recognition); // before every start: the model can expire
      if (!alive.current || starting.current !== token) return; // closed, or Stop / another type of care while checking
      // Expired since the page opened: set it up again (still within Chrome's moment after the click)
      if (s.status === 'needs-setup') {
        s = await setUpOnStart(s.lang, installSpeech(Recognition, s.lang), token);
        if (!s) return;
      }
    }
    starting.current = null;
    if (s.status !== 'ready') {
      setPhase('idle');
      showCheck(s);
      if (s.status === 'needs-setup') setSetupNote('again');
      return;
    }
    setSpeech(s);
    const { careType: care, words: learned, text: before, micId: chosen } = latest.current; // now, not when Start was pressed
    startedWith.current = before.trim();
    const spoke = speechActivity(() => window.dispatchEvent(new Event(ACTIVITY_EVENT)));
    const recorder = createVoiceSession({
      Recognition,
      Phrase: window.SpeechRecognitionPhrase,
      lang: s.lang,
      phrases: hearing(care, learned),
      getTrack: microphoneFrom(navigator.mediaDevices), // asked once for this recording
      deviceId: chosen,
      onDeviceGone: () => {
        // the chosen microphone is no longer there: Chrome's default from now on
        saveMic('');
        setMicId('');
      },
      onMic: (state) => setMuted(state === 'muted'),
      onState: setPhase,
      onText: ({ text: said }) => setText(said),
      onActivity: (what) => {
        setNoWords(what === 'no-words-yet');
        if (what === 'words') spoke(); // speaking counts as using Perinexa (automatic logout)
      },
      onEnd: ({ reason, text: said, cause }) => {
        session.current = null;
        setNoWords(false);
        setMuted(false);
        setText(said);
        if (PAUSED_REASONS.has(reason)) setPaused(reason);
        else if (reason === 'error:language-not-supported') {
          // Chrome needs the set-up again (the model expired, or this address hasn't set it up yet): the message
          // shows next to the Set up button
          checkSpeech(Recognition).then((again) => {
            if (!alive.current) return;
            showCheck(again.status === 'ready' ? { status: 'needs-setup', lang: again.lang } : again);
            setSetupNote('again');
          });
        } else if (reason !== 'stopped') setError(endMessage(reason, cause));
        // Filled in once, when the recording ends (for the type of care chosen now)
        if (said.trim() && said !== startedWith.current) latest.current.fill(said, undefined, { ai: true });
      },
    });
    session.current = recorder;
    recorder.start(before);
  };

  // AI dictation: record, then (on Stop) have OpenAI write it down; the text is added to the box and the form is
  // filled in by the same reader as on-device voice entry.
  const startAi = async () => {
    if (recording) return;
    setError(null);
    setPaused(null);
    setCleared(false);
    setSexRemoved(false);
    setAiPhase('starting'); // "Listening" only once the recorder has really started
    try {
      const rec = await startAiRecording({ deviceId: latest.current.micId, onAutoStop: () => latest.current.finishAi?.() });
      if (!alive.current) {
        rec.abort();
        return;
      }
      aiRec.current = rec;
      setAiPhase('recording');
      refreshMics();
    } catch (err) {
      aiRec.current = null;
      setAiPhase('idle');
      setError(err?.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it with the microphone icon in the address bar, then try again.' : err.message);
    }
  };
  const finishAi = async () => {
    const rec = aiRec.current;
    if (!rec) return;
    aiRec.current = null;
    setAiPhase('writing');
    try {
      const said = await transcribeRecording(await rec.stop());
      if (!alive.current) return;
      if (!said) {
        setError('Nothing could be written down from the recording. Speak a little closer to the microphone and try again.');
        return;
      }
      const all = [latest.current.text.trim(), said].filter(Boolean).join(' ');
      setText(all);
      latest.current.fill(all, undefined, { ai: true });
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setAiPhase('idle');
    }
  };

  // An answer to a question: into the form, and remembered as this doctor's word if they asked for that
  const toResult = (question, value) => (answerWith ? answerWith(question, value) : answerToResult(question, value, careType));
  const answer = async (question, value, remember) => {
    answered.current.add(questionKey(question));
    const result = onAnswer(toResult(question, value));
    setSummary((cur) => ({
      ...cur,
      here: addNew(cur.here, result.here, { answered: true }),
      later: addNew(cur.later, result.later, { answered: true }),
      questions: cur.questions.filter((q) => q.id !== question.id),
    }));
    // Only a word's meaning is ever remembered: never a patient's value, a result, or a word that could flip a "no"
    if (!remember || !question.key || isValueMeaning(value) || isBlockedLearned(question.key)) return;
    try {
      const res = await api('/me/dictation-words', { method: 'PUT', body: { phrase: question.key, meaning: value } });
      setWords((cur) => [...cur.filter((w) => w.phrase !== res.word.phrase), res.word]);
      setSaved(`Remembered: “${question.heard}”. You can change your words in My settings → Voice words.`);
    } catch (err) {
      setSaved(null);
      setError(`Your answer was used, but it couldn't be remembered: ${err.message}`);
    }
  };

  // "Ask AI where these belong": only the parts not understood are sent (never one about the baby's sex); each
  // suggestion is filled in only when the person taps Yes – as an answer to a question.
  // name / quiet: asked by itself after filling in – the name is blanked, and nothing is shown if AI can't help
  const askAiAbout = async (parts, { name = '', quiet = false } = {}) => {
    setAiHelp({ busy: true, items: [] });
    if (!quiet) setError(null);
    try {
      const sent = parts.map((u) => withoutIdentity(u.note || u.text, name));
      const res = await api('/ai/understand', { method: 'POST', body: { form: aiForm, careType, parts: sent } });
      const items = res.suggestions
        .map((s) => ({ ...s, unused: parts[s.part], meaning: aiMeaning(s) }))
        .filter((s) => s.meaning && s.unused);
      setAiHelp({ busy: false, items, none: !quiet && items.length === 0 });
    } catch (err) {
      setAiHelp(null);
      if (!quiet) setError(err.message);
    }
  };
  const acceptAi = (item) => {
    noted.current.add(item.unused.text);
    const result = onAnswer(toResult(null, item.meaning));
    setSummary((cur) => ({
      ...cur,
      here: addNew(cur.here, result.here, { answered: true }),
      later: addNew(cur.later, result.later, { answered: true }),
      unused: cur.unused.filter((u) => u !== item.unused),
    }));
    setAiHelp((cur) => cur && { ...cur, items: cur.items.filter((x) => x !== item) });
  };
  const refuseAi = (item) => setAiHelp((cur) => cur && { ...cur, items: cur.items.filter((x) => x !== item) });

  // "Use what was said" on a detail changed by hand: the person chooses the spoken value, so it replaces theirs (as
  // an answer to a question would), still marked "From voice" to be checked.
  const itemPaths = (item) => [item.path, ...(item.paths ?? []), ...(item.pieces ?? []).map((x) => x.path)].filter(Boolean);
  const useSaid = (item) => {
    const result = lastRead.current;
    if (!result) return;
    const paths = itemPaths(item);
    const done = onAnswer({ ...result, paths, found: [item], questions: [], unused: [], notes: [] });
    setSummary((cur) => ({
      ...cur,
      here: addNew(cur.here, done.here?.length ? done.here : [item], { answered: true }),
      notChanged: (cur.notChanged ?? []).filter((x) => x !== item),
    }));
  };

  const addNote = (item, key = 'notes') => {
    noted.current.add(item.text);
    const result = onAnswer(toResult(null, key === 'notes' ? `note:${item.note}` : `note:${key}:${item.note}`));
    // Marked as the person's answer, so it stays in the "filled in" list when the text is read again
    setSummary((cur) => ({
      ...cur,
      here: addNew(cur.here, result.here, { answered: true }),
      later: addNew(cur.later, result.later, { answered: true }),
      unused: cur.unused.filter((u) => u !== item),
    }));
  };

  // A correction undone: the words are kept as heard for this form only (nothing is saved), and the form is filled in
  // again. Learning a word needs Remember on a question, or My settings → Voice words.
  const undo = (c) => {
    const next = [...kept, c.heard];
    setKept(next);
    fill(text, next);
  };
  const chooseMic = (e) => {
    setMicId(e.target.value);
    saveMic(e.target.value);
  };

  // Questions in order (results card, safety checks, the rest), at most 5 at a time
  const questions = summary?.questions ?? [];
  const { shown, more: moreQuestions } = questionsToShow(questions, allQuestions);
  const toConfirm = shown.filter((q) => q.group === 'confirm');
  const toCheck = shown.filter((q) => q.group !== 'confirm');
  const unused = summary?.unused ?? [];
  // Ask AI where these belong: only the parts not understood (never one about the baby's sex)
  const aiParts = unused.filter((u) => !u.sex);
  const canAskAi = aiOn && !recording && !aiHelp?.busy && !aiHelp?.items?.length && aiParts.length > 0;
  const askAiHint = !aiOn
    ? 'AI is not set up for this hospital.'
    : !text.trim()
      ? 'Say or type the details first. Parts Perinexa does not understand can then be placed by AI.'
      : aiHelp?.items?.length
        ? 'Check the AI suggestions under Not understood.'
        : aiParts.length
          ? 'Only the parts not understood are sent to OpenAI. You accept each suggestion yourself.'
          : 'Everything said was understood – nothing to ask AI.';
  // Each word once; Undo only where every use of it allows it (not for a number: it is changed in the form itself)
  const same = (a, b) => a.heard.toLowerCase() === b.heard.toLowerCase() && a.to === b.to;
  const changed = summary?.corrections ?? [];
  const corrections = changed
    .filter((c, i) => changed.findIndex((x) => same(x, c)) === i)
    .map((c) => ({ ...c, undo: changed.filter((x) => same(x, c)).every((x) => x.undo !== false) }));
  const notChanged = summary?.notChanged ?? [];
  const nothing = summary && !summary.here.length && !summary.later.length && !questions.length && !notChanged.length;
  const pickMic = mics.length > 1 && micAllowed; // the choice only when there is one to make
  const pill =
    aiPhase === 'starting'
      ? PHASES.starting
      : aiPhase === 'recording'
      ? AI_RECORDING
      : aiPhase === 'writing'
        ? AI_WRITING
        : recording
          ? recordingPill({ phase, muted, micAllowed })
          : paused
            ? PAUSED
            : null;
  // Without on-device speech, the AI dictation button still records (it works in any browser that can record)
  const cannot = speech.status === 'unsupported'
      ? (ERROR_MESSAGES[speech.reason] ?? ERROR_MESSAGES['old-chrome'])
      : speech.status === 'unavailable'
        ? ERROR_MESSAGES.unavailable
        : null;
  const note = setupNote;

  return (
    <section className="card form-section voice-card" aria-labelledby="voice-title">
      <div className="voice-head">
        <h2 id="voice-title">Voice entry</h2>
        <span role="status" className="voice-status">
          {pill && (
            <StatusPill tone={pill.tone} icon={pill.icon}>
              {pill.label}
            </StatusPill>
          )}
        </span>
        {onHide && (
          <button type="button" className="btn btn-link btn-sm voice-hide" onClick={onHide} disabled={recording}>
            <ChevronUp aria-hidden="true" /> Hide
          </button>
        )}
      </div>
      <p className="hint help voice-intro">{intro}</p>

      <div className="voice-controls">
        {recording ? (
          <button type="button" className="btn btn-secondary" onClick={pressStop} disabled={phase === 'finishing' || aiPhase === 'starting' || aiPhase === 'writing'}>
            <Square aria-hidden="true" /> Stop recording
          </button>
        ) : speech.status === 'ready' || speech.status === 'needs-setup' ? (
          <button type="button" className="btn btn-secondary" onClick={start}>
            <Mic aria-hidden="true" /> Start recording
          </button>
        ) : speech.status === 'setting-up' ? (
          <button type="button" className="btn btn-secondary" disabled>
            <Turning aria-hidden="true" /> Getting speech recognition ready…
          </button>
        ) : null}
        {!recording && aiOn && (
          <button type="button" className="btn btn-secondary" onClick={startAi}>
            <Sparkles aria-hidden="true" /> AI dictation
          </button>
        )}
        {!recording && aiOn && (
          <InfoToggle label="About AI dictation">
            AI dictation: say everything in your own words, press Stop, and every detail is filled in for you to check. The whole recording
            (including any name or phone said) is sent to OpenAI to be written down; nothing is kept. Use fake patients only until the app is reviewed.
          </InfoToggle>
        )}
        {recording && aiPhase === 'recording' && <p className="hint">Speak normally – the whole recording is written down when you press Stop.</p>}
        {note && <p className="hint">{SETUP_NOTES[note]}</p>}
        {phase === 'asking-mic' && !micAllowed && <p className="hint">Chrome is asking to use the microphone. Choose Allow.</p>}
        {recording && noWords && phase === 'listening' && (
          <p className="hint voice-no-words">
            {pickMic
              ? 'No words yet. Check that the right microphone is chosen (Microphone and speech settings) and speak a little closer.'
              : 'No words yet. Check that the right microphone is chosen in Chrome (the microphone icon in the address bar) and speak a little closer.'}
          </p>
        )}
        {cannot && <p className="hint voice-unavailable">{cannot}</p>}
      </div>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <Alert type="info" icon={Pause} onClose={() => setPaused(null)}>
        {paused && endMessage(paused)}
      </Alert>
      <Alert type="info" onClose={() => setCleared(false)}>
        {cleared && 'The spoken text was cleared because the type of care changed to newborn. Please record again.'}
      </Alert>
      <Alert type="info" onClose={() => setSexRemoved(false)}>
        {sexRemoved && "Part of the text was removed because the baby's sex cannot be recorded before birth."}
      </Alert>

      <Field
        label="What was said"
        id="dictation"
        hint={
          recording
            ? 'Stop recording to correct the text. The form is filled in when you press Stop.'
            : `You can also type or correct it here – the form is filled in as you type. For example: ${example}`
        }
      >
        <textarea
          id="dictation"
          rows={3}
          value={text}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
          }}
          readOnly={recording}
          maxLength={5000}
        />
      </Field>
      {text.includes('*') && <p className="hint voice-masked">{MASKED_WORDS_NOTE}</p>}
      <div className="voice-controls">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            typed.current = false;
            fill(text, kept, { ai: true });
          }}
          disabled={recording || !text.trim()}
        >
          Fill in the form
        </button>
      </div>
      {/* Ask AI where these belong: always here (owner, 23 Oct 2026), usable once there are parts not understood */}
      <div className="voice-ai-help">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => askAiAbout(aiParts)} disabled={!canAskAi}>
          <Sparkles aria-hidden="true" /> {aiHelp?.busy ? 'Asking AI…' : 'Ask AI where these belong'}
        </button>
        <span className="hint">{askAiHint}</span>
      </div>
      {!cannot && (
        <div className="voice-more">
          <details>
            <summary>Microphone and speech settings</summary>
            <p className="hint help">
              Speech model: English, on this computer (Chrome). Chrome has one English model for computers. Perinexa adds corrections for common
              Indian English pronunciations.
            </p>
            {pickMic && (
              <div className="voice-mic">
                <Field label="Microphone" id="voice-mic" hint={recording ? 'Used from the next Start recording.' : 'Remembered in this browser.'}>
                  <select id="voice-mic" value={mics.some((m) => m.deviceId === micId) ? micId : ''} onChange={chooseMic}>
                    <option value="">Chrome's default microphone</option>
                    {mics.map((m, i) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </details>
          <details>
            <summary>Tips for clear dictation</summary>
            <ul className="voice-tips">
              {tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <div className="voice-summary" role="status">
        {summary?.here.length > 0 && (
          <Alert type="warning">
            <strong>
              {summary.here.length} {summary.here.length === 1 ? 'detail was' : 'details were'} filled in from what was said
              {summary.carried ? ' on the previous page' : ''}.
            </strong>{' '}
            Check each one (marked “From voice”) before saving.
            <ul className="voice-found">
              {summary.here.map((f, i) => (
                <li key={`${f.label}-${i}`}>
                  <span className="muted">{f.label}:</span> {f.text}
                  {f.answered && <span className="muted"> (your answer)</span>}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {summary?.later.length > 0 && (
          <Alert type="info">
            <strong>Clinical details for the next page</strong> – filled in there after you save:
            <ul className="voice-found">
              {summary.later.map((f, i) => (
                <li key={`${f.label}-${i}`}>
                  <span className="muted">{f.label}:</span> {f.text}
                  {f.answered && <span className="muted"> (your answer)</span>}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {notChanged.length > 0 && (
          <Alert type="info">
            <strong>Not changed, because you changed {notChanged.length === 1 ? 'this detail' : 'these details'} by hand.</strong> The form keeps what you
            entered. What was said:
            <ul className="voice-found">
              {notChanged.map((f, i) => (
                <li key={`${f.label}-${i}`}>
                  <span className="muted">{f.label}:</span> {f.text}
                  {itemPaths(f).length > 0 && (
                    <button type="button" className="btn btn-link voice-use-said" onClick={() => useSaid(f)} disabled={recording}>
                      Use what was said
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <Alert type="success" onClose={() => setSaved(null)}>
          {saved}
        </Alert>
        {(corrections.length > 0 || kept.length > 0) && (
          <section className="voice-corrections" aria-labelledby="voice-corrections-title">
            <h3 id="voice-corrections-title">Words corrected</h3>
            <p className="hint help">
              Changed because of how they are often heard. The box keeps what Chrome heard. Undo applies to this form only and fills it in again. A
              number is changed in the form itself.
            </p>
            <ul>
              {corrections.map((c) => (
                <li key={`${c.heard}|${c.to}`}>
                  <span>
                    “{c.heard}” → {c.to}
                  </span>
                  {c.undo && (
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => undo(c)}
                      disabled={recording || !text.trim()}
                      aria-label={`Undo: keep “${c.heard}” as heard`}
                    >
                      <Undo2 aria-hidden="true" /> Undo
                    </button>
                  )}
                </li>
              ))}
              {kept.map((k) => (
                <li key={`kept|${k}`} className="muted">
                  “{k}” kept as heard
                </li>
              ))}
            </ul>
          </section>
        )}
        {toConfirm.length > 0 && (
          <section className="voice-questions voice-confirm" aria-labelledby="voice-confirm-title">
            <h3 id="voice-confirm-title">
              <TriangleAlert aria-hidden="true" /> Please confirm {toConfirm.length === 1 ? 'this result' : 'these results'}
            </h3>
            <p className="hint">Results, and a blood group that was not heard clearly, are filled in only after you confirm them.</p>
            <ul>
              {toConfirm.map((q) => (
                <Question key={q.id} question={q} onAnswer={answer} />
              ))}
            </ul>
          </section>
        )}
        {toCheck.length > 0 && (
          <section className="voice-questions" aria-labelledby="voice-questions-title">
            <h3 id="voice-questions-title">Please check {toCheck.length === 1 ? 'this' : `these ${toCheck.length}`}</h3>
            <ul>
              {toCheck.map((q) => (
                <Question key={q.id} question={q} onAnswer={answer} />
              ))}
            </ul>
          </section>
        )}
        {moreQuestions > 0 && (
          <div className="voice-more-questions">
            <button type="button" className="btn btn-secondary" onClick={() => setAllQuestions(true)}>
              More questions ({moreQuestions})
            </button>
          </div>
        )}
        {unused.length > 0 && (
          <section className="voice-unused" aria-labelledby="voice-unused-title">
            <h3 id="voice-unused-title">Not understood</h3>
            <p className="hint">Nothing was filled in from these parts. Enter them by hand, say them with the detail's name, or ask AI.</p>
            {aiHelp?.none && <p className="hint">AI could not place these parts either – enter them by hand.</p>}
            {aiHelp?.items?.length > 0 && (
              <div className="voice-ai-suggestions">
                <h4>AI suggestions – check each one</h4>
                <ul>
                  {aiHelp.items.map((s, i) => (
                    <li key={`${s.part}-${s.field}-${i}`}>
                      <span>
                        “{s.unused.text}” → <strong>{s.label}</strong>
                      </span>
                      <span className="voice-ai-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => acceptAi(s)} disabled={recording}>
                          Yes, fill in
                        </button>
                        <button type="button" className="btn btn-link btn-sm" onClick={() => refuseAi(s)}>
                          No
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul>
              {unused.map((u, index) => (
                <li key={`${u.start ?? index}-${u.text}`}>
                  {u.sex ? (
                    <span className="muted">Part of what was said is not recorded: the baby's sex is never written down during a pregnancy (PCPNDT).</span>
                  ) : (
                    <>
                      “{u.text}”
                      {/* never a result, a "no" or "known case of" alone (dictation.js leaves those out already) */}
                      {canNote &&
                        u.canNote &&
                        !onlyLinkWords(u.text) &&
                        noteTo.map((to) => (
                          <button key={to.key} type="button" className="btn btn-link" onClick={() => addNote(u, to.key)}>
                            {to.label}
                          </button>
                        ))}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {nothing && emptyNote && <Alert type="info">{emptyNote}</Alert>}
        {summary?.dropped && <p className="hint">Medical details that were said are not used here: a doctor or RMO adds them.</p>}
        {summary?.skippedInfo && <p className="hint">Name, age and contact details are not changed on this page – use Edit details on the record.</p>}
        {summary?.notes.length > 0 && (
          <ul className="voice-notes">
            {summary.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
