// A consent or information form: its title and clauses in English, Marathi and Hindi. Blanks in braces are filled
// in when the form is printed for a patient ({patient}, {age}, {mrn}, {hospital}, {doctor}, {procedure}, {reason}) –
// keep the same blanks in every language.
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { LANGUAGE_WORDS } from '../libraryFormat.js';

const LANGS = Object.keys(LANGUAGE_WORDS);

export function FormEditor({ content, editing, onChange }) {
  const [lang, setLang] = useState('en');
  const clauses = content.clauses ?? [];
  const setTitle = (l, value) => onChange({ ...content, title: { ...content.title, [l]: value } });
  const setClause = (i, l, value) => onChange({ ...content, clauses: clauses.map((c, j) => (j === i ? { ...c, [l]: value } : c)) });
  const move = (i, d) => {
    const next = [...clauses];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange({ ...content, clauses: next });
  };

  if (!editing) {
    return (
      <div className="pad">
        <div className="segmented" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{LANGUAGE_WORDS[l]}</button>
          ))}
        </div>
        <h3 className="form-title" lang={lang}>{content.title?.[lang] || <span className="muted">No {LANGUAGE_WORDS[lang]} title yet</span>}</h3>
        <ol className="clauses" lang={lang}>
          {clauses.map((c, i) => <li key={i}>{c[lang] || <span className="muted">Not translated yet</span>}</li>)}
        </ol>
      </div>
    );
  }

  return (
    <div className="pad">
      <p className="muted small">Blanks filled in when printing: {'{patient} {age} {mrn} {hospital} {doctor} {procedure} {reason}'}. Keep the same blanks in every language.</p>
      <div className="form-grid">
        {LANGS.map((l) => (
          <div key={l} className="form-field width-third">
            <label htmlFor={`title-${l}`}>Title – {LANGUAGE_WORDS[l]}{l === 'en' && <span className="required" aria-hidden> *</span>}</label>
            <input id={`title-${l}`} lang={l} value={content.title?.[l] ?? ''} maxLength={3000} onChange={(e) => setTitle(l, e.target.value)} />
          </div>
        ))}
      </div>
      {clauses.map((c, i) => (
        <fieldset key={i} className="clause-edit">
          <legend>Clause {i + 1}</legend>
          <div className="row-actions clause-tools">
            <button type="button" className="icon-btn" aria-label={`Move clause ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
            <button type="button" className="icon-btn" aria-label={`Move clause ${i + 1} down`} disabled={i === clauses.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
            <button type="button" className="icon-btn" aria-label={`Remove clause ${i + 1}`} disabled={clauses.length === 1} onClick={() => onChange({ ...content, clauses: clauses.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
          </div>
          <div className="form-grid">
            {LANGS.map((l) => (
              <div key={l} className="form-field width-third">
                <label htmlFor={`clause-${i}-${l}`}>{LANGUAGE_WORDS[l]}{l === 'en' && <span className="required" aria-hidden> *</span>}</label>
                <textarea id={`clause-${i}-${l}`} lang={l} rows={4} maxLength={3000} value={c[l] ?? ''} onChange={(e) => setClause(i, l, e.target.value)} />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" disabled={clauses.length >= 80} onClick={() => onChange({ ...content, clauses: [...clauses, { en: '', mr: '', hi: '' }] })}>
        <Plus size={14} aria-hidden /> Add a clause
      </button>
    </div>
  );
}
