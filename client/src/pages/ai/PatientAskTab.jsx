import { useEffect, useRef, useState } from 'react';
import { Brain, Copy, MessageSquarePlus, Sparkles, TriangleAlert } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Field, StatusPill, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';

// "Ask AI" on a patient's record (docs/ASK_AI_PLAN.md, owner's decisions of 15 Oct 2026): her doctor (any doctor while
// she has none) or an RMO asks about her and asks follow-up questions. Each answer: what her record shows (with where),
// general medical knowledge (to check against current guidelines), and what her record does not say. "Think harder"
// asks the latest question again with the stronger model. The conversation is NOT kept: it lives only on this screen
// and is gone when the doctor leaves the tab; a useful answer is copied into a visit note by the doctor.

const MAX_TURNS = 8; // questions in one conversation (the server takes at most 8 earlier ones)
const HISTORY_ANSWER_MAX = 10000; // as the server (routes/ai.js)
const STARTERS = ['Summarise her pregnancy so far.', 'What is due or overdue in her care plan?', 'How are her Hb and BP changing across visits?', 'Any medicine to avoid with her allergies and conditions?'];
// HIV is never sent (HIV and AIDS Act 2017) – the server refuses such a question; said here before anything is sent
const HIV_WORDS = /\b(hiv|plhiv|aids|(?:anti\s*-?\s*)?retro\s*-?\s*(?:virals?|positive|reactive)|rvd|pptct|ictc|cd4|viral\s+load)\b/i;
export const HIV_QUESTION_MESSAGE = 'Questions about HIV are not sent to the AI (HIV and AIDS Act 2017). Look at her record directly.';

export const ASK_NOTE = 'Answers are written by AI (OpenAI) from her record – her name, phone, address and patient number are not sent, nor anything about HIV. AI can be wrong: check every point against her record.';

/** An answer as plain text (also what is sent back as the conversation so far). */
export function answerText(a) {
  return [
    ...(a.fromRecord.length ? ['From her record:', ...a.fromRecord.map((p) => `- ${p.text}${p.source ? ` (${p.source})` : ''}`)] : []),
    ...(a.general.length ? ['General medical knowledge – check against current guidelines:', ...a.general.map((p) => `- ${p.text}`)] : []),
    ...(a.notInRecord.length ? ['Not in her record:', ...a.notInRecord.map((t) => `- ${t}`)] : []),
    ...(a.caution ? [`Caution: ${a.caution}`] : []),
  ].join('\n');
}

/** What "Copy the answer" puts on the clipboard: said to be AI, when, and the question – then the answer. */
export const copyText = (turn) => [`AI answer (OpenAI, ${formatDateTime(turn.at)}) to: ${turn.question} – to be checked against her record before use.`, answerText(turn.answer)].join('\n');

function Answer({ turn, number, isLast, busy, deepening, onDeeper }) {
  const a = turn.answer;
  const [copied, setCopied] = useState(null); // 'yes' | 'no' | null
  useEffect(() => {
    setCopied(null); // a new answer (Think harder) is not "copied" yet
  }, [a]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(turn));
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };
  const empty = !a.fromRecord.length && !a.general.length && !a.notInRecord.length;
  const headingId = `ask-turn-${number}`;
  return (
    <section className="card ai-card" aria-labelledby={headingId} aria-busy={deepening}>
      <div className="ai-card-head">
        <h2 id={headingId}>
          Question {number}: <span className="ai-question-text">{turn.question}</span>
        </h2>
        <StatusPill tone="neutral" icon={turn.model === 'stronger' ? Brain : Sparkles}>
          {turn.model === 'stronger' ? 'AI answer, thought harder' : 'AI answer'} – check against her record
        </StatusPill>
      </div>
      {a.caution && (
        <Alert type="warning" icon={TriangleAlert}>
          {a.caution}
        </Alert>
      )}
      {a.fromRecord.length > 0 && (
        <>
          <h3>From her record</h3>
          <ul className="ai-points">
            {a.fromRecord.map((p, i) => (
              <li key={i}>
                <span>
                  {p.text}
                  {p.source && <span className="muted"> – {p.source}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.general.length > 0 && (
        <>
          <h3>General medical knowledge – check against current guidelines</h3>
          <ul className="ai-points">
            {a.general.map((p, i) => (
              <li key={i}>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.notInRecord.length > 0 && (
        <>
          <h3>Not in her record</h3>
          <ul className="ai-points">
            {a.notInRecord.map((t, i) => (
              <li key={i}>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {empty && !a.caution && <p className="hint">The AI gave no answer to this question.</p>}
      {copied === 'no' && <Alert type="error">This browser didn't allow copying. Select the text and copy it by hand.</Alert>}
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy} aria-describedby={headingId}>
          <Copy aria-hidden="true" /> {copied === 'yes' ? 'Copied' : 'Copy the answer'}
        </button>
        {/* Only the latest answer: later answers would have been built on the one it replaces */}
        {isLast && turn.model !== 'stronger' && (
          <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={onDeeper} aria-describedby={headingId}>
            <Brain aria-hidden="true" /> {deepening ? 'Thinking harder…' : 'Think harder (stronger model, costs more)'}
          </button>
        )}
      </div>
    </section>
  );
}

export function PatientAskTab() {
  const { patient } = useOutletContext();
  const { activeMembership } = useAuth();
  const allowed = hasRole(activeMembership, 'doctor', 'rmo') && Boolean(patient.access?.canEditClinical);
  const status = useFetch(allowed ? `/patients/${patient.id}/ai/status` : null);
  const [turns, setTurns] = useState([]); // [{ question, answer, model, at }] – this screen only, never saved
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(null); // null | 'ask' | 'deeper'
  const [error, setError] = useState(null);
  const [said, setSaid] = useState(''); // for screen readers: "Answer ready" …
  const asked = useRef(0); // an answer that comes back for an earlier patient or conversation is not shown
  const inputRef = useRef(null);
  const endRef = useRef(null);

  // Another patient: the conversation is put away (it was about her)
  useEffect(() => {
    asked.current += 1;
    setTurns([]);
    setQuestion('');
    setError(null);
    setBusy(null);
  }, [patient.id]);
  // (in braces: scrollIntoView returns a promise in newer browsers, and an effect may only return a clean-up)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns.length]);

  if (!allowed) return <div className="card">Ask AI is for her doctor (any doctor while she has none) and RMOs.</div>;
  const off = status.data?.enabled === false;

  // The conversation so far, as the server takes it (each answer at most HISTORY_ANSWER_MAX characters)
  const history = (list) => list.slice(-MAX_TURNS).map((t) => ({ question: t.question, answer: answerText(t.answer).slice(0, HISTORY_ANSWER_MAX) }));

  // Asks a question; deeper: the latest question asked again with the stronger model
  const ask = async (text, { deeper = false } = {}) => {
    const q = text.trim();
    if (q.length < 3) return setError('Write your question.');
    if (patient.careType !== 'newborn' && mentionsFetalSex(q)) return setError(PCPNDT_MESSAGE);
    if (HIV_WORDS.test(q)) return setError(HIV_QUESTION_MESSAGE);
    const mine = ++asked.current;
    setBusy(deeper ? 'deeper' : 'ask');
    setError(null);
    setSaid(deeper ? 'Thinking harder…' : 'Thinking…');
    try {
      const earlier = deeper ? turns.slice(0, -1) : turns;
      const res = await api(`/patients/${patient.id}/ai/ask`, { method: 'POST', body: { question: q, history: history(earlier), deep: deeper } });
      if (mine !== asked.current) return undefined;
      const turn = { question: q, answer: res.answer, model: res.model, at: res.generatedAt ?? new Date().toISOString() };
      setTurns((list) => (deeper ? [...list.slice(0, -1), turn] : [...list, turn]));
      if (!deeper) setQuestion('');
      setSaid('Answer ready.');
    } catch (err) {
      if (mine !== asked.current) return undefined;
      setError(err.fields ? (Object.values(err.fields)[0] ?? err.message) : err.message);
      setSaid('');
    } finally {
      if (mine === asked.current) {
        setBusy(null);
        setTimeout(() => inputRef.current?.focus(), 0); // the keyboard goes back to the question box
      }
    }
    return undefined;
  };
  const newConversation = () => {
    asked.current += 1;
    setTurns([]);
    setError(null);
    setBusy(null);
    setSaid('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const full = turns.length >= MAX_TURNS;
  const newButton = turns.length > 0 && (
    <button type="button" className="btn btn-link" onClick={newConversation} disabled={Boolean(busy)}>
      <MessageSquarePlus aria-hidden="true" /> New conversation
    </button>
  );

  return (
    <div className="vs-tab">
      <section className="card vs-intro">
        <span className="vs-intro-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <div className="vs-intro-text">
          <h2>Ask AI about her</h2>
          <p className="hint">{ASK_NOTE}</p>
          <p className="hint">This conversation is not kept: it is gone when you leave this tab. Copy a useful answer into her visit notes yourself.</p>
        </div>
        {newButton && <div className="row">{newButton}</div>}
      </section>
      {off && <Alert type="warning">AI is not set up for this hospital yet – ask your administrator.</Alert>}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>

      {turns.map((t, i) => (
        <Answer key={i} turn={t} number={i + 1} isLast={i === turns.length - 1} busy={Boolean(busy) || off} deepening={busy === 'deeper' && i === turns.length - 1} onDeeper={() => ask(t.question, { deeper: true })} />
      ))}
      <div ref={endRef} />

      <section className="card" aria-labelledby="ask-title" aria-busy={busy === 'ask'}>
        <h2 id="ask-title">{turns.length ? 'Ask a follow-up question' : 'Your question'}</h2>
        {!turns.length && (
          <div className="row">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || off} onClick={() => setQuestion(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <Alert type="error">{error}</Alert>
        {full ? (
          <>
            <p className="hint">This conversation has {MAX_TURNS} questions. Start a new conversation to ask more.</p>
            <div className="row">{newButton}</div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
            noValidate
          >
            <Field label="Question about her" id="ask-question" hint="e.g. Is her BP trend worrying? What should I check at this visit?" keepHint>
              <textarea ref={inputRef} id="ask-question" rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} readOnly={Boolean(busy)} disabled={off} />
            </Field>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || off || question.trim().length < 3}>
                <Sparkles aria-hidden="true" /> {busy === 'ask' ? 'Thinking…' : 'Ask'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
