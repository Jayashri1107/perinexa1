import { useEffect, useRef, useState } from 'react';
import { Loader, Sparkles, Square } from 'lucide-react';
import { api } from '../../api.js';
import { InfoToggle } from '../../components/ui.jsx';
import { startAiRecording, transcribeRecording } from '../patients/aiDictation.js';

// "AI dictation" on the Prescription tab (AI dictation, only when AI is set up): the doctor says the medicines,
// presses Stop, the recording is written down (/ai/transcribe) and turned into rows (/ai/medicines). The rows are
// handed to onMedicines({ items, notes }) to be added to the form for the doctor to check – never saved by themselves.

export function RxDictation({ onMedicines, onError, disabled }) {
  const [aiOn, setAiOn] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'starting' | 'recording' | 'writing'
  const rec = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api('/ai/status')
      .then((res) => alive.current && setAiOn(Boolean(res.enabled)))
      .catch(() => {}); // unknown: no AI button, the form works as before
    return () => {
      alive.current = false;
      rec.current?.abort();
    };
  }, []);

  if (!aiOn) return null;

  const start = async () => {
    onError(null);
    setPhase('starting');
    try {
      rec.current = await startAiRecording({ onAutoStop: () => stop() });
      if (alive.current) setPhase('recording');
    } catch (err) {
      rec.current = null;
      if (!alive.current) return;
      setPhase('idle');
      onError(err?.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it in Chrome (the icon in the address bar) and try again.' : err.message);
    }
  };

  async function stop() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase('writing');
    try {
      const blob = await r.stop();
      const text = await transcribeRecording(blob);
      const res = await api('/ai/medicines', { method: 'POST', body: { text } });
      if (!alive.current) return;
      onMedicines({ items: res.medicines, notes: res.notes });
    } catch (err) {
      if (alive.current) onError(err.message);
    } finally {
      if (alive.current) setPhase('idle');
    }
  }

  return (
    <div className="rx-dictation">
      {phase === 'recording' ? (
        <button type="button" className="btn btn-secondary" onClick={stop}>
          <Square aria-hidden="true" /> Stop recording
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={start} disabled={disabled || phase !== 'idle'}>
          {phase === 'idle' ? <Sparkles aria-hidden="true" /> : <Loader aria-hidden="true" className="voice-turning" />}
          {phase === 'writing' ? ' Writing down…' : phase === 'starting' ? ' Starting…' : ' AI dictation'}
        </button>
      )}
      {phase === 'recording' && <p className="hint">Say each medicine with its strength, dose, how often and for how long – then press Stop.</p>}
      {phase === 'idle' && (
        <InfoToggle label="About AI dictation">
          AI dictation: say the medicines in your own words, press Stop, and each one is added as a row for you to check. The whole
          recording (including any name said) is sent to OpenAI to be written down; nothing is kept. Use fake patients only until the app is reviewed.
        </InfoToggle>
      )}
    </div>
  );
}
