// Voice on the new-patient form (owner, 8 Oct 2026): one microphone button at the top, beside the "fake data only"
// notice. Pressed, the computer asks one question at a time – out loud and on screen – listens for the answer, puts it
// in that one field, and goes on to the next. Say "skip", "back", "repeat" or "stop" at any time (or use the buttons);
// an answer can also be typed. The first press sets up Chrome's on-device speech when it is needed. Speech becomes text
// ON THIS COMPUTER only (utils/speech.js); only the questions are spoken aloud, never the answers. Staff check every
// field before saving.
import { CircleCheck, Info, Mic, MicOff, RotateCcw, SkipForward, StepBack } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../components/Alert.jsx';
import { getPath, setPath } from '../../utils/objectPath.js';
import { listenOnce, setUpSpeech, speak, speechStatus, stopSpeaking } from '../../utils/speech.js';
import { QUESTIONS, askText, commandOf } from './voiceQuestions.js';

const MAX_TRIES = 2;

export function AskByVoice({ values, onFill, careTypes, sexes, idProofTypes, doctors, notice }) {
  const ctxBase = useMemo(() => ({ careTypes, sexes, idProofTypes, doctors }), [careTypes, sexes, idProofTypes, doctors]);
  const [speech, setSpeech] = useState({ status: 'checking' });
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('idle'); // asking | listening | understood | not-understood | done
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [filled, setFilled] = useState({}); // key → shown value
  const stopRef = useRef(null);
  const live = useRef({ values, running: false, tries: 0 });
  live.current.values = values;
  live.current.speech ??= speech;

  useEffect(() => {
    const keep = (s) => {
      live.current.speech = s;
      setSpeech(s);
    };
    speechStatus().then(keep).catch(() => keep({ status: 'unsupported' }));
    return () => {
      live.current.running = false;
      stopRef.current?.();
      stopSpeaking();
    };
  }, []);

  const activeFor = (v) => QUESTIONS.filter((q) => !q.when || q.when(v, ctxBase));
  const active = activeFor(values);
  const current = active[index];
  const canListen = speech.status === 'ready';

  const finish = () => {
    live.current.running = false;
    stopRef.current?.();
    stopSpeaking();
    setRunning(false);
    setPhase('done');
  };

  // Asks question i of the questions that apply to these values.
  const ask = async (i, v = live.current.values, again = '') => {
    const list = activeFor(v);
    if (i >= list.length) return finish();
    setIndex(i);
    setHeard('');
    setTyped('');
    setPhase('asking');
    const q = list[i];
    await speak(`${again}${askText(q, v)}`);
    if (!live.current.running) return undefined;
    const sp = live.current.speech; // the latest (a set-up may have just finished)
    if (sp.status !== 'ready') {
      setPhase('listening');
      return undefined; // no microphone: the answer is typed
    }
    setPhase('listening');
    stopRef.current = listenOnce(sp.lang, {
      onText: (finalText, interim) => setHeard(`${finalText} ${interim}`.trim()),
      onDone: (text) => live.current.running && answer(i, text, v),
      onError: (message) => {
        setError(message);
        finish();
      },
    });
    return undefined;
  };

  // What to do with an answer (spoken or typed) to question i.
  const answer = (i, text, v = live.current.values) => {
    const list = activeFor(v);
    const q = list[i];
    if (!q) return finish();
    setHeard(text);
    const command = commandOf(text);
    if (command === 'stop') return finish();
    if (command === 'skip') return next(i, v);
    if (command === 'back') return ask(Math.max(0, i - 1), v);
    if (command === 'repeat') return ask(i, v);
    if (!text) return retry(i, v, 'I did not hear an answer. ');
    const value = q.read(text, { ...ctxBase, values: v });
    if (value === null || value === undefined || value === '') return retry(i, v, 'Sorry, I did not understand. ');
    live.current.tries = 0;
    const nextValues = setPath(v, q.key, value);
    live.current.values = nextValues;
    onFill(q.key, value);
    setFilled((f) => ({ ...f, [q.key]: q.shown ? q.shown(value, ctxBase) : String(value) }));
    setPhase('understood');
    setTimeout(() => live.current.running && ask(i + 1, nextValues), 700);
    return undefined;
  };

  const retry = (i, v, why) => {
    live.current.tries += 1;
    if (live.current.tries > MAX_TRIES) {
      live.current.tries = 0;
      setPhase('not-understood');
      return setTimeout(() => live.current.running && next(i, v), 900);
    }
    setPhase('not-understood');
    return ask(i, v, why);
  };
  const next = (i, v = live.current.values) => {
    live.current.tries = 0;
    return ask(i + 1, v);
  };

  const start = async () => {
    setError('');
    setFilled({});
    // the one-time speech set-up on this computer (Chrome downloads its speech model); answers can be typed meanwhile
    if (speech.status === 'needs-setup') {
      setSpeech({ ...speech, status: 'setting-up' });
      let after;
      try {
        await setUpSpeech(speech.lang);
        after = await speechStatus();
      } catch {
        after = { status: 'unavailable' };
      }
      live.current.speech = after;
      setSpeech(after);
    }
    live.current.running = true;
    live.current.tries = 0;
    setRunning(true);
    ask(0);
  };
  const control = (what) => {
    stopRef.current?.();
    stopSpeaking();
    if (what === 'skip') next(index);
    if (what === 'back') ask(Math.max(0, index - 1));
    if (what === 'repeat') ask(index);
  };
  const submitTyped = (e) => {
    e.preventDefault();
    stopRef.current?.();
    answer(index, typed.trim());
  };

  const noMic = ['unsupported', 'unavailable'].includes(speech.status);
  return (
    <section className={`card voice-bar${running ? ' is-running' : ''}`}>
      <div className="voice-bar-top">
        <p className="voice-bar-notice"><Info size={16} aria-hidden /> {notice}</p>
        {running ? (
          <button type="button" className="voice-mic is-live" onClick={finish} aria-label="Stop asking" title="Stop">
            <MicOff size={20} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="voice-mic"
            onClick={start}
            disabled={speech.status === 'setting-up'}
            aria-label={phase === 'done' ? 'Ask the questions again by voice' : 'Fill the form by voice: one question at a time'}
            title={noMic ? 'Answer the questions by typing (no microphone in this browser)' : 'Fill by voice – one question at a time'}
          >
            <Mic size={20} aria-hidden />
          </button>
        )}
      </div>
      {speech.status === 'setting-up' && <p className="muted small">Setting up speech on this computer… this can take a minute.</p>}
      {running && noMic && <p className="muted small">No microphone here (it needs Google Chrome with on-device speech): type each answer.</p>}
      <Alert type="error">{error}</Alert>

      {running && current && (
        <div className="ask-box" aria-live="polite">
          <p className="muted small">Question {index + 1} of {active.length}</p>
          <p className="ask-question">{askText(current, values)}</p>
          <p className="ask-state">
            {phase === 'asking' && 'Asking…'}
            {phase === 'listening' && (canListen ? <span className="voice-dot">Listening…</span> : 'Type the answer below.')}
            {phase === 'understood' && <><CircleCheck size={14} aria-hidden /> {filled[current.key]}</>}
            {phase === 'not-understood' && 'Not understood – asking again.'}
          </p>
          {heard && <p className="small">Heard: “{heard}”</p>}
          <form className="voice-row" onSubmit={submitTyped}>
            <input aria-label="Type the answer" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type the answer and press Enter" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('back')} disabled={index === 0}><StepBack size={14} aria-hidden /> Back</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('repeat')}><RotateCcw size={14} aria-hidden /> Repeat</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('skip')}><SkipForward size={14} aria-hidden /> Skip</button>
            <button type="button" className="btn btn-link btn-sm" onClick={finish}><MicOff size={14} aria-hidden /> Stop</button>
          </form>
        </div>
      )}

      {Object.keys(filled).length > 0 && (
        <ul className="plain-list rows top-gap-sm">
          {active.filter((q) => filled[q.key] !== undefined && getPath(values, q.key) !== undefined).map((q) => (
            <li key={q.key}><span><CircleCheck size={14} aria-hidden /> {askText(q, values).replace(/\?.*$/, '?')}</span><strong>{filled[q.key]}</strong></li>
          ))}
        </ul>
      )}
      {phase === 'done' && <p className="muted small top-gap-sm">Done. Check every field in the form below, then register her. Press the microphone to ask again.</p>}
    </section>
  );
}
