import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, CalendarPlus, Check, CircleMinus, FileText, Info, ListChecks, Pencil, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import {
  COMPLETED_KINDS,
  FIT_LABELS,
  FIT_ORDER,
  MAX_PROTOCOLS,
  OUTCOME_LABELS,
  PLAN_STATUS_LOOK,
  STEP_ORDER,
  STEP_WORDS,
  counterWords,
  missingText,
  outcomeText,
  planDatesText,
  sectionLines,
  switchFlash,
} from './fertilityFormat.js';
import { toDateInput } from './patientFormat.js';
import { SemenResultCard } from './SemenResultCard.jsx';
import { CounsellingNumbers } from './CounsellingNumbers.jsx';
import { CYCLE_STATUS_LOOK, PROTOCOL_KIND_WORDS, cycleSummary, leadFollicleText } from './fertilityCycleFormat.js';

// The Treatment plan tab on an infertility record (docs/FERTILITY_PLAN.md – the approved protocol library):
//  1. no plan: what her record still lacks, and "Suggest plans";
//  2. the suggestions: the protocols that fit her record, best fit first, with why – the doctor ticks one or more;
//  3. the plan built from them: every section as text the doctor edits; a doctor confirms it; it ends with an outcome;
//  4. "Switch to": the ladder – follicular study → IUI → IVF/ICSI – or another procedure; the old plan is closed as moved
//     on, the cycles done under it go to her record, and the next draft is built (fertility/ladder.js on the server);
//  5. the cycle (follicular study) sheets under a confirmed plan: started here, filled on their own page
//     (FertilityCyclePage.jsx); a completed cycle is counted on her record by itself.
// Earlier plans stay below. The server decides who may see or change what (access flags in its answers); nurses read.

const STATUS_ICONS = { draft: Pencil, active: BadgeCheck, completed: Check, stopped: CircleMinus };
const FIT_ICONS = { recommended: Check, consider: Info, other: ListChecks };

function PlanStatus({ plan }) {
  const look = PLAN_STATUS_LOOK[plan.status];
  const Icon = STATUS_ICONS[plan.status];
  return (
    <StatusPill tone={look.tone} icon={Icon}>
      {look.word}
    </StatusPill>
  );
}

/** The library's note (approved by the owner, 27 Oct 2026): what it is drawn from, and that the doctor decides. */
function LibraryNote({ text }) {
  return (
    <Alert type="info">
      <span className="fp-draft">{text}</span>
    </Alert>
  );
}

/** One section of a plan as a list ("• item" lines) with its headings. */
function SectionText({ text }) {
  const lines = sectionLines(text);
  if (!lines.length) return <p className="muted">Nothing written.</p>;
  const out = [];
  let items = [];
  const flush = () => {
    if (items.length) out.push(<ul key={`l${out.length}`}>{items}</ul>);
    items = [];
  };
  lines.forEach((l, i) => {
    if (l.kind === 'heading') {
      flush();
      out.push(
        <strong key={`h${i}`} className="fp-section-heading">
          {l.text}
        </strong>,
      );
    } else items.push(<li key={`i${i}`}>{l.text}</li>);
  });
  flush();
  return out;
}

function PlanSections({ sections }) {
  return sections.map((s) => (
    <div key={s.key} className={`fp-section ${s.key === 'cautions' ? 'fp-section-cautions' : ''}`.trim()}>
      <h3>{s.title}</h3>
      <SectionText text={s.text} />
    </div>
  ));
}

/** The ladder under a plan's title: follicular study → IUI → IVF / ICSI, the plan's step marked; a procedure stands beside it. */
function LadderLine({ step }) {
  return (
    <p className="fp-ladder" aria-label="Treatment ladder">
      <span>Step:</span>
      {STEP_ORDER.map((k, i) => (
        <span key={k} className="fp-ladder-item">
          {i > 0 && (
            <span className="fp-ladder-arrow" aria-hidden="true">
              →{' '}
            </span>
          )}
          <span className={`fp-ladder-step ${step === k ? 'is-current' : ''}`.trim()} aria-current={step === k ? 'step' : undefined}>
            {STEP_WORDS[k]}
          </span>
        </span>
      ))}
      {!step && <span className="fp-ladder-step is-current">Procedure or work-up</span>}
    </p>
  );
}

/**
 * "Switch to…" from the current plan, or "Start with…" when there is none: a step of the ladder or another procedure.
 * With a plan: the cycles completed under it (added to the matching counter on her record) and why. "Choose from all
 * protocols" hands over to the full chooser with the same switch.
 */
function SwitchDialog({ patient, plan, ladder, countedCycles = 0, onDone, onChooseAll, onCancel }) {
  const steps = ladder.steps.filter((s) => s.key !== plan?.step);
  const [target, setTarget] = useState(steps[0]?.key ?? 'all');
  const [cyclesDone, setCyclesDone] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const requestId = useRef(newRequestId());
  const counter = plan ? ladder.steps.find((s) => s.key === plan.step)?.counter ?? null : null;
  const switchFrom = plan ? { planId: plan.id, rev: plan.rev, cyclesDone: counter ? Number(cyclesDone || 0) : 0, note: note.trim() } : undefined;
  const submit = async (e) => {
    e.preventDefault();
    if (target === 'all') return onChooseAll(switchFrom);
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan`, { method: 'POST', body: { clientRequestId: requestId.current, target, ...(switchFrom ? { switchFrom } : {}) } });
      onDone(res);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  const option = (key, label) => (
    <label key={key} className="check">
      <input type="radio" name="fp-target" value={key} checked={target === key} onChange={() => setTarget(key)} /> {label}
    </label>
  );
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="fp-switch-title" onSubmit={submit} noValidate>
        <h2 id="fp-switch-title">{plan ? 'Switch to another step or procedure' : 'Start with a step of the ladder'}</h2>
        <Alert type="error">{error}</Alert>
        {plan && <p className="hint">Her current plan “{plan.title}” is {plan.status === 'active' ? 'completed as moved to the next step' : 'discarded (it was still a draft)'}; the new plan opens as a draft to edit and confirm.</p>}
        <div className="fp-switch-list" role="radiogroup" aria-labelledby="fp-switch-title">
          <p className="fp-switch-group">The ladder</p>
          {steps.map((s) => option(s.key, s.label))}
          <p className="fp-switch-group">Other procedures</p>
          {ladder.procedures.map((s) => option(s.key, s.label))}
          <p className="fp-switch-group">Anything else</p>
          {option('all', 'Choose from all protocols, with the suggestions for her')}
        </div>
        {counter && (
          <Field
            label={`Cycles completed under the current plan without a sheet (${counterWords(counter)})`}
            id="fp-cycles"
            error={fieldErrors['switchFrom.cyclesDone']}
            hint={`Added to her record, so the next suggestions count them.${countedCycles ? ` ${countedCycles} cycle${countedCycles === 1 ? '' : 's'} from the sheets ${countedCycles === 1 ? 'is' : 'are'} counted already – enter only the rest.` : ''}`}
          >
            <input id="fp-cycles" inputMode="numeric" maxLength={2} value={cyclesDone} onChange={(e) => setCyclesDone(e.target.value)} />
          </Field>
        )}
        {plan && (
          <Field label="Why (optional)" id="fp-switch-note" error={fieldErrors['switchFrom.note']}>
            <textarea id="fp-switch-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <ArrowRight aria-hidden="true" /> {saving ? 'Switching…' : target === 'all' ? 'Choose protocols' : plan ? 'Switch' : 'Start'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- The suggestions ----------

function OptionCard({ option, protocol, picked, onToggle, disabled }) {
  const Icon = FIT_ICONS[option.fit];
  return (
    <li className={`fp-option fp-option-${option.fit} ${picked ? 'fp-option-picked' : ''}`.trim()}>
      <label className="fp-option-head">
        <input type="checkbox" checked={picked} disabled={disabled && !picked} onChange={onToggle} aria-describedby={`fp-why-${option.key}`} />
        <span>
          <span className="fp-option-name">{protocol.name}</span>
          <span className="fp-bodies">
            <StatusPill tone={option.fit === 'recommended' ? 'stable' : option.fit === 'consider' ? 'watch' : 'neutral'} icon={Icon}>
              {FIT_LABELS[option.fit]}
            </StatusPill>
            {protocol.bodies.map((b) => (
              <StatusPill key={b} tone="neutral">
                {b}
              </StatusPill>
            ))}
          </span>
        </span>
      </label>
      <p className="fp-summary">{protocol.summary}</p>
      <div id={`fp-why-${option.key}`}>
        {option.reasons.length > 0 && (
          <ul className="fp-reasons">
            {option.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {option.cautions.map((c) => (
          <p key={c} className="fp-caution">
            <TriangleAlert aria-hidden="true" className="inline-icon" /> {c}
          </p>
        ))}
      </div>
      <details className="fp-details">
        <summary>What this protocol contains</summary>
        <p className="hint">When to use: {protocol.whenToUse}</p>
        {protocol.cautions.length > 0 && (
          <>
            <h4>Cautions</h4>
            <ul>
              {protocol.cautions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
        {protocol.sections.map((s) => (
          <div key={s.key}>
            <h4>{s.title}</h4>
            <ul>
              {s.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
        <h4>Sources</h4>
        <ul>
          {protocol.sources.map((src) => (
            <li key={src}>{src}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function SuggestPanel({ patient, switchFrom = null, onBuilt, onCancel }) {
  const { data, error, loading } = useFetch(`/patients/${patient.id}/fertility-plan/suggestions`);
  const [picked, setPicked] = useState([]);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState(null);
  const requestId = useRef(newRequestId());
  const toggle = (key) => setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const build = async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan`, { method: 'POST', body: { clientRequestId: requestId.current, protocolKeys: picked, ...(switchFrom ? { switchFrom } : {}) } });
      onBuilt(res);
    } catch (err) {
      setBuildError(err.message);
      setBuilding(false);
    }
  };
  if (error) return <Alert type="error">{error}</Alert>;
  if (loading || !data) return <div className="card">Reading her record…</div>;
  const library = new Map(data.library.map((p) => [p.key, p]));
  const groups = FIT_ORDER.map((fit) => ({ fit, options: data.options.filter((o) => o.fit === fit) })).filter((g) => g.options.length);
  const missing = missingText(data.facts);
  return (
    <section className="card" aria-labelledby="fp-suggest-title">
      <div className="fp-head">
        <h2 id="fp-suggest-title">
          <Sparkles aria-hidden="true" /> Protocols for her
        </h2>
        <div className="fp-head-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      <LibraryNote text={data.libraryNote} />
      {switchFrom && (
        <Alert type="info" icon={Info}>
          This replaces her current plan: it is closed as moved to the next step when the new plan is built.
        </Alert>
      )}
      {missing && (
        <Alert type="info" icon={Info}>
          {missing} The suggestions are read from what is recorded; add the rest in <Link to={`/patients/${patient.id}/edit`}>Edit details</Link> for a fuller picture.
        </Alert>
      )}
      <p className="hint">Tick one or more protocols (up to {MAX_PROTOCOLS}); the plan is built from their text and you edit every line before confirming it. "Suggested for her" follows the rules written from the guidelines; the decision is yours.</p>
      {groups.map((g) => (
        <div key={g.fit}>
          <h3 className="fp-group-title">{FIT_LABELS[g.fit]}</h3>
          {g.fit === 'other' ? (
            <details className="fp-details">
              <summary>
                Show the other {g.options.length} protocol{g.options.length === 1 ? '' : 's'} in the library
              </summary>
              <ul className="fp-options plain-list">
                {g.options.map((o) => (
                  <OptionCard key={o.key} option={o} protocol={library.get(o.key)} picked={picked.includes(o.key)} onToggle={() => toggle(o.key)} disabled={picked.length >= MAX_PROTOCOLS} />
                ))}
              </ul>
            </details>
          ) : (
            <ul className="fp-options plain-list">
              {g.options.map((o) => (
                <OptionCard key={o.key} option={o} protocol={library.get(o.key)} picked={picked.includes(o.key)} onToggle={() => toggle(o.key)} disabled={picked.length >= MAX_PROTOCOLS} />
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="fp-pick-bar">
        <span className="fp-pick-count">
          {picked.length} of {MAX_PROTOCOLS} picked
        </span>
        <Alert type="error">{buildError}</Alert>
        <button type="button" className="btn btn-primary" disabled={!picked.length || building} onClick={build}>
          <FileText aria-hidden="true" /> {building ? 'Building…' : 'Build the plan from the selected'}
        </button>
      </div>
    </section>
  );
}

// ---------- The plan ----------

function PlanEditor({ patient, plan, onSaved, onCancel }) {
  const [title, setTitle] = useState(plan.title);
  const [startOn, setStartOn] = useState(toDateInput(plan.startOn));
  const [reviewOn, setReviewOn] = useState(toDateInput(plan.reviewOn));
  const [sections, setSections] = useState(plan.sections.map((s) => ({ ...s })));
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const setText = (key, text) => setSections((cur) => cur.map((s) => (s.key === key ? { ...s, text } : s)));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan/${plan.id}`, {
        method: 'PUT',
        body: { rev: plan.rev, title: title.trim(), startOn: startOn || null, reviewOn: reviewOn || null, sections: sections.map((s) => ({ key: s.key, title: s.title, text: s.text })) },
      });
      onSaved(res);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
      if (err.status === 409) onCancel({ reload: true, message: err.message });
    }
  };
  return (
    <form className="card" onSubmit={save} noValidate aria-labelledby="fp-edit-title">
      <div className="fp-head">
        <h2 id="fp-edit-title">
          <Pencil aria-hidden="true" /> Edit the plan
        </h2>
      </div>
      <Alert type="error">{error}</Alert>
      <Field label="Title" id="fp-title" error={fieldErrors.title}>
        <input id="fp-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="fp-dates">
        <Field label="Start date" id="fp-start" error={fieldErrors.startOn}>
          <input id="fp-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </Field>
        <Field label="Review date (optional)" id="fp-review" error={fieldErrors.reviewOn}>
          <input id="fp-review" type="date" value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} />
        </Field>
      </div>
      <p className="hint">Each section is plain text: one line per point, starting with “• ”. Change, remove or add lines as you decide; the earlier text is kept in the plan’s versions.</p>
      {sections.map((s) => (
        <div key={s.key} className="fp-section">
          <Field label={s.title} id={`fp-sec-${s.key}`} error={fieldErrors[`sections.${s.key}`]}>
            <textarea id={`fp-sec-${s.key}`} value={s.text} onChange={(e) => setText(s.key, e.target.value)} maxLength={8000} />
          </Field>
        </div>
      ))}
      <div className="sticky-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save the plan'}
        </button>
        <button type="button" className="btn btn-link" onClick={() => onCancel()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** How the plan ends: confirm (a doctor), completed (pregnant, next step) or stopped (with a reason). */
function OutcomeDialog({ patient, plan, kind: firstKind, onDone, onCancel }) {
  const [kind, setKind] = useState(firstKind);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const status = COMPLETED_KINDS.includes(kind) ? 'completed' : 'stopped';
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan/${plan.id}/status`, { method: 'POST', body: { rev: plan.rev, status, outcome: { kind, note: note.trim() } } });
      onDone(res, status === 'completed' ? 'Plan completed.' : 'Plan stopped.');
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
  };
  const kinds = plan.status === 'draft' ? ['discarded', 'patient_choice', 'other'] : ['pregnant', 'next_step', 'no_response', 'patient_choice', 'other'];
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="fp-outcome-title" onSubmit={save} noValidate>
        <h2 id="fp-outcome-title">End this plan</h2>
        <Alert type="error">{error}</Alert>
        <Field label="How did it end?" id="fp-kind" error={fieldErrors['outcome.kind']}>
          <select id="fp-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {OUTCOME_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === 'discarded' ? 'Note (optional)' : status === 'stopped' ? 'Why (required)' : 'Note (optional)'} id="fp-note" error={fieldErrors['outcome.note']}>
          <textarea id="fp-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="hint">{status === 'completed' ? 'The plan is kept as completed; a new plan can then be built for the next step.' : 'The plan is kept as stopped with this reason; a new plan can then be built.'}</p>
        <div className="row">
          <button type="submit" className={`btn ${status === 'stopped' ? 'btn-danger' : 'btn-primary'}`} disabled={saving}>
            {saving ? 'Saving…' : status === 'completed' ? 'Mark completed' : 'Stop the plan'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** "Start a cycle": day 1 and the medicines of the cycle; the sheet then opens on its own page. */
function StartCycleDialog({ patient, plan, onDone, onCancel }) {
  const guess = plan.protocolKeys.includes('oi_letrozole') || plan.protocolKeys.includes('follicular_study') ? 'letrozole' : plan.protocolKeys.includes('oi_gonadotrophins') ? 'gonadotrophins' : '';
  const [day1, setDay1] = useState('');
  const [protocol, setProtocol] = useState({ kind: guess, drug: guess === 'letrozole' ? 'Letrozole' : '', dose: '', days: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const requestId = useRef(newRequestId());
  const set = (key) => (e) => setProtocol((cur) => ({ ...cur, [key]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!day1) return setFieldErrors({ day1: 'Give day 1 of the cycle (the first day of the period).' });
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan/${plan.id}/cycles`, { method: 'POST', body: { clientRequestId: requestId.current, day1, protocol } });
      onDone(res);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="fc-start-title" onSubmit={submit} noValidate>
        <h2 id="fc-start-title">Start a cycle</h2>
        <Alert type="error">{error}</Alert>
        <Field label="Day 1 of the cycle (first day of the period)" id="fc-start-day1" error={fieldErrors.day1}>
          <input id="fc-start-day1" type="date" value={day1} onChange={(e) => setDay1(e.target.value)} />
        </Field>
        <Field label="Medicines of the cycle" id="fc-start-kind" error={fieldErrors['protocol.kind']}>
          <select id="fc-start-kind" value={protocol.kind} onChange={set('kind')}>
            <option value="">Not decided yet</option>
            {Object.entries(PROTOCOL_KIND_WORDS).map(([k, w]) => (
              <option key={k} value={k}>
                {w.en}
              </option>
            ))}
          </select>
        </Field>
        <div className="fp-dates">
          <Field label="Medicine" id="fc-start-drug" error={fieldErrors['protocol.drug']}>
            <input id="fc-start-drug" maxLength={120} value={protocol.drug} onChange={set('drug')} />
          </Field>
          <Field label="Dose" id="fc-start-dose" error={fieldErrors['protocol.dose']}>
            <input id="fc-start-dose" maxLength={120} value={protocol.dose} onChange={set('dose')} />
          </Field>
          <Field label="Days" id="fc-start-days" error={fieldErrors['protocol.days']} hint="e.g. day 3 to 7">
            <input id="fc-start-days" maxLength={60} value={protocol.days} onChange={set('days')} />
          </Field>
        </div>
        <p className="hint">The scan days, the trigger, the IUI and the outcome are filled on the sheet that opens next. One cycle is open at a time.</p>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <CalendarPlus aria-hidden="true" /> {saving ? 'Starting…' : 'Start the cycle'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** The cycle sheets of a plan, newest first, each a link to its page. */
function CycleList({ patient, cycles }) {
  if (!cycles.length) return <p className="muted">No cycle sheets yet.</p>;
  return (
    <ul className="fc-cycles">
      {cycles.map((c) => (
        <li key={c.id}>
          <Link className="fc-cycle-link" to={`/patients/${patient.id}/fertility-plan/cycles/${c.id}`}>
            Cycle {c.number} – day 1 {formatDate(c.day1)}
          </Link>
          <StatusPill tone={CYCLE_STATUS_LOOK[c.status].tone}>{CYCLE_STATUS_LOOK[c.status].word}</StatusPill>
          <span className="fc-cycle-sub">{[cycleSummary(c, formatDate).replace(/^Cycle \d+ · /, ''), leadFollicleText(c)].filter(Boolean).join(' · ')}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanView({ patient, plan, access, ladder, cycles = [], canStartCycle = false, onChanged, onSwitched, onChooseAll, onEdit, setFlash }) {
  const navigate = useNavigate();
  const [startingCycle, setStartingCycle] = useState(false);
  const [ending, setEnding] = useState(null); // the outcome kind the dialog opens with
  const [switching, setSwitching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const confirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/fertility-plan/${plan.id}/status`, { method: 'POST', body: { rev: plan.rev, status: 'active' } });
      onChanged(res);
      setFlash('Plan confirmed.');
    } catch (err) {
      setError(err.message);
      if (err.status === 409) onChanged(null);
    } finally {
      setConfirming(false);
    }
  };
  const primaryIsConfirm = plan.status === 'draft' && access.canActivate;
  return (
    <section className="card" aria-labelledby="fp-plan-title">
      <div className="fp-head">
        <h2 id="fp-plan-title">
          <FileText aria-hidden="true" /> {plan.title} <PlanStatus plan={plan} />
        </h2>
        {access.canEdit && (
          <div className="fp-head-actions">
            <button type="button" className={`btn ${primaryIsConfirm ? 'btn-secondary' : 'btn-primary'}`} onClick={onEdit}>
              <Pencil aria-hidden="true" /> Edit
            </button>
            {primaryIsConfirm && (
              <button type="button" className="btn btn-positive" onClick={confirm} disabled={confirming}>
                <BadgeCheck aria-hidden="true" /> {confirming ? 'Confirming…' : 'Confirm plan'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setSwitching(true)}>
              <ArrowRight aria-hidden="true" /> Switch to…
            </button>
            {plan.status === 'active' && (
              <button type="button" className="btn btn-secondary" onClick={() => setEnding('pregnant')}>
                <Check aria-hidden="true" /> Record outcome
              </button>
            )}
            <button type="button" className="btn btn-link" onClick={() => setEnding(plan.status === 'draft' ? 'discarded' : 'patient_choice')}>
              <X aria-hidden="true" /> {plan.status === 'draft' ? 'Discard draft' : 'Stop'}
            </button>
          </div>
        )}
      </div>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <LadderLine step={plan.step} />
      <p className="fp-meta">
        <span>{planDatesText(plan, formatDate)}</span>
        {plan.switchedFrom && <span>Switched from “{plan.switchedFrom.title}” on {formatDate(plan.switchedFrom.at)}</span>}
        <span>Built by {plan.created?.byName ?? 'staff'} on {formatDate(plan.created?.at)}</span>
        {plan.lastEdited && <span>Edited by {plan.lastEdited.byName} on {formatDateTime(plan.lastEdited.at)}</span>}
        {plan.activated && <span>Confirmed by {plan.activated.byName} on {formatDate(plan.activated.at)}</span>}
      </p>
      {plan.status === 'draft' && (
        <Alert type="info" icon={Info}>
          A draft: read every section, change what you decide differently, then {access.canActivate ? 'confirm it' : 'a doctor confirms it'}. Nothing is prescribed or ordered by this plan; prescriptions and orders are written on the visit as usual.
        </Alert>
      )}
      <PlanSections sections={plan.sections} />
      <div className="fp-section" aria-labelledby="fc-list-title">
        <div className="fp-head">
          <h3 id="fc-list-title">Cycle sheets (follicular study)</h3>
          {canStartCycle && (
            <div className="fp-head-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStartingCycle(true)}>
                <CalendarPlus aria-hidden="true" /> Start a cycle
              </button>
            </div>
          )}
        </div>
        {plan.status === 'draft' && <p className="hint">Cycle sheets start once the plan is confirmed.</p>}
        <CycleList patient={patient} cycles={cycles} />
      </div>
      {plan.sources.length > 0 && (
        <div className="fp-sources">
          Built from{' '}
          {plan.sources.map((s, i) => (
            <span key={s.key}>
              {i > 0 ? '; ' : ''}
              <strong>{s.label}</strong> ({s.bodies})
            </span>
          ))}
          . Library version {plan.libraryVersion}{plan.libraryVersion?.startsWith('draft') ? ' – built from the draft, before the library was approved' : ''}.
        </div>
      )}
      {plan.versions.length > 0 && (
        <details className="fp-versions">
          <summary>
            Earlier versions of this plan ({plan.versions.length})
          </summary>
          {[...plan.versions].reverse().map((v, i) => (
            <div key={`${v.at}-${i}`} className="fp-version">
              <p className="fp-version-head">
                {v.title} – as saved by {v.byName ?? 'staff'} on {formatDateTime(v.at)}
              </p>
              <PlanSections sections={v.sections} />
            </div>
          ))}
        </details>
      )}
      {startingCycle && (
        <StartCycleDialog
          patient={patient}
          plan={plan}
          onCancel={() => setStartingCycle(false)}
          onDone={(res) => {
            setStartingCycle(false);
            setFlash('Cycle started – fill the sheet as the scans are done.');
            navigate(`/patients/${patient.id}/fertility-plan/cycles/${res.cycle.id}`);
          }}
        />
      )}
      {switching && (
        <SwitchDialog
          patient={patient}
          plan={plan}
          ladder={ladder}
          countedCycles={cycles.filter((c) => c.counted).length}
          onCancel={() => setSwitching(false)}
          onDone={(res) => {
            setSwitching(false);
            onSwitched(res);
          }}
          onChooseAll={(switchFrom) => {
            setSwitching(false);
            onChooseAll(switchFrom);
          }}
        />
      )}
      {ending && (
        <OutcomeDialog
          patient={patient}
          plan={plan}
          kind={ending}
          onCancel={() => setEnding(null)}
          onDone={(res, message) => {
            setEnding(null);
            onChanged(res);
            setFlash(message);
          }}
        />
      )}
    </section>
  );
}

function EarlierPlans({ patient, plans, cycles = [] }) {
  if (!plans.length) return null;
  return (
    <section className="card" aria-labelledby="fp-earlier-title">
      <h2 id="fp-earlier-title">Earlier plans</h2>
      <ul className="fp-earlier-list">
        {plans.map((p) => (
          <li key={p.id}>
            <details>
              <summary className="fp-earlier-line">
                <span className="fp-earlier-title">{p.title}</span>
                <PlanStatus plan={p} />
                {p.step && <StatusPill tone="neutral">{STEP_WORDS[p.step]}</StatusPill>}
                <span className="muted tabular">{planDatesText(p, formatDate)}</span>
              </summary>
              <p className="fp-outcome">{outcomeText(p, formatDate)}</p>
              {cycles.some((c) => c.planId === p.id) && (
                <div className="fp-section">
                  <h3>Cycle sheets</h3>
                  <CycleList patient={patient} cycles={cycles.filter((c) => c.planId === p.id)} />
                </div>
              )}
              <PlanSections sections={p.sections} />
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoPlanCard({ patient, data, onSuggest, onStart }) {
  const missing = missingText(data.facts);
  return (
    <section className="card" aria-labelledby="fp-none-title">
      <div className="fp-head">
        <h2 id="fp-none-title">
          <FileText aria-hidden="true" /> Treatment plan
        </h2>
        {data.access.canCreate && (
          <div className="fp-head-actions">
            <button type="button" className="btn btn-secondary" onClick={onStart}>
              <ArrowRight aria-hidden="true" /> Start with a step…
            </button>
            <button type="button" className="btn btn-primary" onClick={onSuggest}>
              <Sparkles aria-hidden="true" /> Suggest plans
            </button>
          </div>
        )}
      </div>
      <p>No treatment plan yet. The plan is built from the protocols that fit her record – ovulation, tubes, uterus, semen, age and reserve – and then edited by her doctor.</p>
      {!data.facts.recorded ? (
        <Alert type="warning">
          Her fertility history is not entered yet. {data.access.canSuggest ? <>Add it in <Link to={`/patients/${patient.id}/edit`}>Edit details</Link> first: without it only the evaluation can be suggested.</> : 'Her doctor or an RMO adds it in Edit details.'}
        </Alert>
      ) : (
        missing && <Alert type="info" icon={Info}>{missing}</Alert>
      )}
      <p className="hint">
        Her evaluation checklist with dates is on the <Link to={`/patients/${patient.id}/care-plan`}>Care plan</Link> tab.
      </p>
    </section>
  );
}

export function PatientFertilityPlanTab() {
  const { patient, setFlash, reload: reloadPatient } = useOutletContext();
  const { data, error, loading, reload } = useFetch(patient.access?.canViewFertilityPlan ? `/patients/${patient.id}/fertility-plan` : null);
  const [mode, setMode] = useState('view'); // 'view' | 'suggest' | 'edit'
  const [local, setLocal] = useState(null); // the latest answer after a change, until the tab is read again
  const [note, setNote] = useState(null);
  const [switchFrom, setSwitchFrom] = useState(null); // a switch carried into the full chooser
  const [starting, setStarting] = useState(false); // "Start with a step…" when there is no plan
  useEffect(() => setLocal(null), [data]);
  if (!patient.access?.canViewFertilityPlan) return <div className="card">Her treatment plan is not part of your role for this patient.</div>;
  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (loading || !data) return <div className="card">Loading…</div>;
  const plan = local?.plan ?? data.plan;
  const access = local?.access ?? data.access;
  const changed = (res) => {
    setSwitchFrom(null);
    if (!res) {
      reload();
      setMode('view');
      return;
    }
    setLocal(res);
    setMode('view');
    reload(); // the earlier plans and the access flags follow
  };
  // A switch or a start: the new draft opens for editing, with what happened said once
  const switched = (res) => {
    changed(res);
    setMode('edit');
    setNote(switchFlash(res));
  };
  return (
    <div className="fp-tab">
      <Alert type="success" onClose={() => setNote(null)}>
        {note}
      </Alert>
      {mode === 'suggest' && (
        <SuggestPanel
          patient={patient}
          switchFrom={switchFrom}
          onCancel={() => {
            setSwitchFrom(null);
            setMode('view');
          }}
          onBuilt={(res) => (res.closed ? switched(res) : (changed(res), setMode('edit'), setNote('Draft plan built – read and edit it, then confirm.')))}
        />
      )}
      {mode === 'edit' && plan && (
        <PlanEditor
          patient={patient}
          plan={plan}
          onSaved={(res) => {
            changed(res);
            setNote('Plan saved.');
          }}
          onCancel={(why) => {
            setMode('view');
            if (why?.reload) {
              reload();
              setNote(null);
            }
          }}
        />
      )}
      {mode === 'view' && plan && (
        <PlanView
          patient={patient}
          plan={plan}
          access={access}
          ladder={data.ladder}
          cycles={(data.cycles ?? []).filter((c) => c.planId === plan.id)}
          canStartCycle={Boolean(data.access.canStartCycle) && plan.status === 'active'}
          onChanged={changed}
          onSwitched={switched}
          onChooseAll={(from) => {
            setSwitchFrom(from);
            setMode('suggest');
          }}
          onEdit={() => setMode('edit')}
          setFlash={setNote}
        />
      )}
      {mode === 'view' && !plan && <NoPlanCard patient={patient} data={{ ...data, access }} onSuggest={() => setMode('suggest')} onStart={() => setStarting(true)} />}
      {starting && !plan && (
        <SwitchDialog
          patient={patient}
          plan={null}
          ladder={data.ladder}
          onCancel={() => setStarting(false)}
          onDone={(res) => {
            setStarting(false);
            switched(res);
          }}
          onChooseAll={() => {
            setStarting(false);
            setMode('suggest');
          }}
        />
      )}
      {mode === 'view' && !plan && <LibraryNote text={data.libraryNote} />}
      {mode === 'view' && <CounsellingNumbers ageYears={patient.currentAge ?? patient.ageYears} />}
      {mode === 'view' && (
        <SemenResultCard
          patient={patient}
          semen={data.semen}
          onSet={(text) => {
            setNote(text);
            reload();
            reloadPatient?.();
          }}
        />
      )}
      <EarlierPlans patient={patient} plans={data.earlier} cycles={data.cycles ?? []} />
    </div>
  );
}
