// "Ask by voice" on the new-patient form (owner, 8 Oct 2026): the computer asks one question at a time – out loud and
// on screen – listens for the answer, puts it in that one field, and goes on to the next. Say "skip", "back",
// "repeat" or "stop" at any time (or use the buttons); an answer can also be typed. Speech becomes text ON THIS
// COMPUTER only (utils/speech.js); only the questions are spoken aloud, never the answers. Staff check every field
// before saving.
import { CircleCheck, Mic, MicOff, RotateCcw, SkipForward, StepBack } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../components/Alert.jsx';
import { getPath, setPath } from '../../utils/objectPath.js';
import { listenOnce, speak, speechStatus, stopSpeaking } from '../../utils/speech.js';
import { QUESTIONS, askText, commandOf } from './voiceQuestions.js';

const MAX_TRIES = 2;

export function AskByVoice({ values, onFill, careTypes, sexes, idProofTypes, doctors }) {
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

  useEffect(() => {
    speechStatus().then(setSpeech).catch(() => setSpeech({ status: 'unsupported' }));
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
    if (!canListen) {
      setPhase('listening');
      return undefined; // no microphone: the answer is typed
    }
    setPhase('listening');
    stopRef.current = listenOnce(speech.lang, {
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

  const start = () => {
    setError('');
    setFilled({});
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

  return (
    <section className="card voice-card">
      <div className="card-head">
        <h2><Mic size={18} aria-hidden /> Ask by voice</h2>
        <span className="muted small">One question at a time · speech stays on this computer</span>
      </div>
      {speech.status !== 'ready' && speech.status !== 'checking' && (
        <Alert type="info">The microphone needs Google Chrome with on-device speech (set up with the “Fill by voice” card). The questions still work: type each answer.</Alert>
      )}
      <Alert type="error">{error}</Alert>

      {!running && (
        <div className="voice-row">
          <button type="button" className="btn btn-ghost" onClick={start}><Mic size={16} aria-hidden /> {phase === 'done' ? 'Ask again' : 'Start asking'}</button>
          <span className="muted small">{active.length} questions. Say “skip”, “back”, “repeat” or “stop” at any time.</span>
        </div>
      )}

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
      {phase === 'done' && <p className="muted small top-gap-sm">Done. Check every field in the form below, then register her.</p>}
    </section>
  );
}
