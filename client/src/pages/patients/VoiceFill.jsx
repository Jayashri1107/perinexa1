// "Fill by voice" on the new-patient form: say (or type) her details, see what was understood, and put them in the
// form – where staff check every field before saving. Speech becomes text ON THIS COMPUTER only (utils/speech.js);
// nothing said is saved or sent anywhere.
import { CircleCheck, Mic, MicOff, ShieldCheck, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../components/Alert.jsx';
import { listen, setUpSpeech, speechStatus } from '../../utils/speech.js';
import { patientFromSpeech } from './patientFromSpeech.js';

const EXAMPLE = 'Name Asha Patil, 28 years, female, phone 98765 43210, from Pune, pregnant, last period 5 August, doctor Mehta, agrees to reminders';

export function VoiceFill({ careTypes, doctors, onUse }) {
  const [speech, setSpeech] = useState({ status: 'checking' });
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const stop = useRef(null);

  useEffect(() => {
    speechStatus().then(setSpeech).catch(() => setSpeech({ status: 'unsupported' }));
    return () => stop.current?.();
  }, []);

  const start = () => {
    setError('');
    setListening(true);
    const before = text ? `${text} ` : '';
    stop.current = listen(speech.lang, {
      onText: (finalText, partial) => {
        setText(`${before}${finalText}`.trim());
        setInterim(partial);
      },
      onEnd: () => {
        setListening(false);
        setInterim('');
      },
      onError: (message) => {
        setError(message);
        setListening(false);
      },
    });
  };
  const end = () => stop.current?.();
  const setUp = async () => {
    setSpeech({ ...speech, status: 'setting-up' });
    try {
      await setUpSpeech(speech.lang);
      setSpeech(await speechStatus());
    } catch {
      setSpeech({ status: 'unavailable' });
    }
  };
  const read = () => setResult(patientFromSpeech(text, { careTypes, doctors }));

  return (
    <section className="card voice-card">
      <div className="card-head">
        <h2><Mic size={18} aria-hidden /> Fill by voice</h2>
        <span className="muted small"><ShieldCheck size={14} aria-hidden /> Speech stays on this computer</span>
      </div>
      <p className="muted small">Say her details in one go, for example: “{EXAMPLE}”. You can also type or correct the text below.</p>

      {speech.status === 'unsupported' && <Alert type="info">The microphone needs Google Chrome with on-device speech. Type or paste the details below instead – they are read the same way.</Alert>}
      {speech.status === 'unavailable' && <Alert type="info">Speech recognition is not available on this computer. Type the details below instead.</Alert>}
      {speech.status === 'needs-setup' && (
        <Alert type="info">
          Speech needs a one-time set-up on this computer (Chrome downloads its speech model).{' '}
          <button type="button" className="btn btn-link" onClick={setUp}>Set up speech</button>
        </Alert>
      )}
      {speech.status === 'setting-up' && <Alert type="info">Setting up speech on this computer… this can take a minute.</Alert>}
      <Alert type="error">{error}</Alert>

      <div className="voice-row">
        {speech.status === 'ready' && (
          listening ? (
            <button type="button" className="btn btn-ghost voice-live" onClick={end}><MicOff size={16} aria-hidden /> Stop listening</button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={start}><Mic size={16} aria-hidden /> Start speaking</button>
          )
        )}
        {listening && <span className="voice-dot" aria-live="polite">Listening…</span>}
      </div>
      <textarea className="full-textarea top-gap-sm" rows={3} aria-label="What was said" placeholder="What you say appears here – or type it" value={interim ? `${text} ${interim}` : text} onChange={(e) => setText(e.target.value)} />
      <div className="voice-row top-gap-sm">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!text.trim()} onClick={read}><Wand2 size={14} aria-hidden /> Read the details</button>
        {text && <button type="button" className="btn btn-link btn-sm" onClick={() => { setText(''); setResult(null); }}>Clear</button>}
      </div>

      {result && (
        <div className="voice-result top-gap-sm">
          {result.understood.length === 0 ? (
            <p className="muted">Nothing could be read. Try saying “name …”, “… years”, “phone …”.</p>
          ) : (
            <>
              <ul className="plain-list rows">
                {result.understood.map((u) => (
                  <li key={u.key}><span><CircleCheck size={14} aria-hidden /> {u.label}</span><strong>{u.text}</strong></li>
                ))}
              </ul>
              <button type="button" className="btn btn-ghost top-gap-sm" onClick={() => onUse(result.values)}>Put these in the form</button>
              <p className="muted small">Check every field in the form before you register her.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
