import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarPlus, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { BiLabel, PrintLanguageChoice, Translation } from '../../components/print/Bilingual.jsx';
import { DoctorSignature, Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { DRAFT_TRANSLATION_HINT, ageWords, bilingualWords, defaultPrintLanguage, secondLanguage } from '../../components/print/printLanguage.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import {
  CANCEL_REASON_LABELS,
  CLINICAL_LABELS,
  CYCLE_STATUS_LOOK,
  PATTERN_WORDS,
  PROTOCOL_KIND_WORDS,
  REPORT_WORDS,
  TEST_RESULT_WORDS,
  TIMING_WORDS,
  blankEntry,
  cycleDay,
  dateOfCycleDay,
  cycleErrors,
  cyclePayload,
  cycleValues,
  mmText,
  protocolText,
} from './fertilityCycleFormat.js';
import { counterWords } from './fertilityFormat.js';

// One cycle (follicular study) sheet under a fertility treatment plan (docs/FERTILITY_PLAN.md section 7), at
// /patients/:id/fertility-plan/cycles/:cycleId: day 1 and the medicines of the cycle, the scan days (follicles per
// ovary, endometrium, hormones, what was given), the trigger, timed relations or IUI, luteal support, a cancellation
// and the outcome. Saved as a whole; the state follows what is filled in, and a completed cycle is counted once on her
// record. "Print report" prints the follicular study report for the couple, in English with Marathi or Hindi.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function CycleStatus({ cycle }) {
  const look = CYCLE_STATUS_LOOK[cycle.status];
  return <StatusPill tone={look.tone}>{look.word}</StatusPill>;
}

// ---------- The printed report ----------

/** A value in English with its translation after it; just the English when they read the same. */
function BiValue({ words, lang }) {
  const [en, other] = bilingualWords(words, lang);
  return (
    <>
      {en}
      {other && (
        <>
          {' / '}
          <span lang={secondLanguage(lang)}>{other}</span>
        </>
      )}
    </>
  );
}

function ReportDocument({ patient, cycle, plan, lang, letterhead, advice, nextVisit, printedAt, printedByName, signer }) {
  const W = REPORT_WORDS;
  const bi = (key) => <BiLabel words={W[key]} lang={lang} />;
  const dayWords = (on) => (on ? `${formatDate(on)} (${cycleDay(cycle.day1, on) != null ? `${bilingualWords(W.cycleDay, 'en')[0].toLowerCase()} ${cycleDay(cycle.day1, on)}` : ''})`.replace(' ()', '') : '');
  const protocol = cycle.protocol?.kind ? (
    <>
      <BiValue words={PROTOCOL_KIND_WORDS[cycle.protocol.kind]} lang={lang} />
      {[cycle.protocol.drug, cycle.protocol.dose, cycle.protocol.days].filter(Boolean).length > 0 && ` – ${[cycle.protocol.drug, cycle.protocol.dose, cycle.protocol.days].filter(Boolean).join(' ')}`}
    </>
  ) : (
    protocolText(cycle.protocol) || <BiValue words={W.notRecorded} lang={lang} />
  );
  const lines = [];
  if (cycle.trigger?.at || cycle.trigger?.drug) lines.push([W.trigger, `${[cycle.trigger.drug, cycle.trigger.dose].filter(Boolean).join(' ')}${cycle.trigger.at ? ` – ${dayWords(cycle.trigger.at)}` : ''}`]);
  if (cycle.timing?.kind) {
    lines.push([W.timing, <><BiValue key="t" words={TIMING_WORDS[cycle.timing.kind]} lang={lang} />{cycle.timing.on ? ` – ${dayWords(cycle.timing.on)}` : ''}{cycle.timing.note ? ` – ${cycle.timing.note}` : ''}</>]);
    if (cycle.timing.kind === 'iui' && cycle.timing.postWashMillions != null) lines.push([W.postWash, String(cycle.timing.postWashMillions)]);
  }
  if (cycle.luteal) lines.push([W.luteal, cycle.luteal]);
  if (cycle.outcome?.test) {
    lines.push([W.test, <><BiValue key="r" words={TEST_RESULT_WORDS[cycle.outcome.test]} lang={lang} />{cycle.outcome.testOn ? ` – ${formatDate(cycle.outcome.testOn)}` : ''}{cycle.outcome.betaHcg != null ? ` – beta hCG ${cycle.outcome.betaHcg} IU/L${cycle.outcome.betaHcgOn ? ` (${formatDate(cycle.outcome.betaHcgOn)})` : ''}` : ''}</>]);
  }
  if (cycle.cancelled) lines.push([W.cancelled, `${CANCEL_REASON_LABELS[cycle.cancelled.reason] ?? ''}${cycle.cancelled.at ? ` – ${formatDate(cycle.cancelled.at)}` : ''}`]);
  if (advice.trim()) lines.push([W.advice, advice.trim()]);
  if (nextVisit) lines.push([W.nextVisit, formatDate(nextVisit)]);
  return (
    <PrintDocument
      footer={
        <>
          <span>
            {patient.fullName} · {patient.mrn}
          </span>
          <span>
            Printed {formatDateTime(printedAt)} by {printedByName}
          </span>
        </>
      }
    >
      <Letterhead letterhead={letterhead} />
      <h1 className="pdoc-title">{bi('title')}</h1>
      <PrintFacts
        items={[
          [bi('name'), patient.fullName],
          [bi('patientNo'), <span key="mrn" className="pdoc-tabular">{patient.mrn}</span>],
          [bi('age'), ageWords(patient, lang)],
          [bi('cycle'), String(cycle.number)],
          [bi('day1'), formatDate(cycle.day1)],
          [bi('medicines'), protocol, true],
        ]}
      />
      <h2 className="pdoc-sub">{bi('scans')}</h2>
      {cycle.entries.length ? (
        <table className="ptable pdoc-table">
          <thead>
            <tr>
              <th scope="col">{bi('date')}</th>
              <th scope="col">{bi('cycleDay')}</th>
              <th scope="col">{bi('right')}</th>
              <th scope="col">{bi('left')}</th>
              <th scope="col">{bi('endometrium')}</th>
              <th scope="col">{bi('given')}</th>
            </tr>
          </thead>
          <tbody>
            {cycle.entries.map((e) => (
              <tr key={e.on}>
                <td className="pdoc-tabular pdoc-nowrap">{formatDate(e.on)}</td>
                <td className="pdoc-tabular">{e.day}</td>
                <td className="pdoc-tabular">{mmText(e.right) || '—'}</td>
                <td className="pdoc-tabular">{mmText(e.left) || '—'}</td>
                <td className="pdoc-tabular">
                  {e.endometriumMm ?? '—'}
                  {e.pattern ? (
                    <>
                      {' '}
                      <BiValue words={PATTERN_WORDS[e.pattern]} lang={lang} />
                    </>
                  ) : null}
                </td>
                <td>{e.given || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pdoc-note">
          <BiValue words={W.notRecorded} lang={lang} />
        </p>
      )}
      {lines.length > 0 && <PrintFacts items={lines.map(([words, value]) => [<BiLabel key={words.en} words={words} lang={lang} />, value, true])} />}
      <p className="pdoc-note">
        {W.explain.en}
        <Translation text={W.explain[secondLanguage(lang)]} english={W.explain.en} lang={lang} />
      </p>
      <p className="pdoc-note">
        {W.emergency.en}
        <Translation text={W.emergency[secondLanguage(lang)]} english={W.emergency.en} lang={lang} />
      </p>
      {signer && <DoctorSignature user={signer} />}
      <LetterheadFooter letterhead={letterhead} />
    </PrintDocument>
  );
}

/** The print preview of the report: the language, advice and the next visit typed here (printed, never saved). */
function ReportPreview({ patient, cycle, plan, onClose }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const [language, setLanguage] = useState(() => defaultPrintLanguage(patient));
  const [advice, setAdvice] = useState('');
  const [nextVisit, setNextVisit] = useState('');
  const printedAt = new Date();
  const second = secondLanguage(language);
  const record = () => api(`/patients/${patient.id}/fertility-plan/cycles/${cycle.id}/printed`, { method: 'POST', body: { language } });
  return (
    <PrintPreview
      title="Follicular study report"
      hint={
        <>
          {lh.error && !lh.data ? "The letterhead couldn't be loaded, so only the hospital's name is printed. " : ''}
          For the couple. Check the page, then print it on A4 paper.{patient.sensitive ? ' This is a sensitive record: hand the report to her in person.' : ''}
        </>
      }
      controls={
        <>
          <PrintLanguageChoice value={language} onChange={setLanguage} hints={second ? [DRAFT_TRANSLATION_HINT] : []} />
          <div className="fp-dates">
            <Field label="Advice for the couple (printed, not saved)" id="fc-advice">
              <textarea id="fc-advice" rows={2} maxLength={500} value={advice} onChange={(e) => setAdvice(e.target.value)} />
            </Field>
            <Field label="Next visit (optional)" id="fc-next">
              <input id="fc-next" type="date" value={nextVisit} onChange={(e) => setNextVisit(e.target.value)} />
            </Field>
          </div>
        </>
      }
      onPrint={record}
      onClose={onClose}
    >
      <ReportDocument
        patient={patient}
        cycle={cycle}
        plan={plan}
        lang={language}
        letterhead={letterhead}
        advice={advice}
        nextVisit={nextVisit}
        printedAt={printedAt}
        printedByName={user.name}
        signer={hasRole(activeMembership, 'doctor', 'rmo') ? user : null}
      />
    </PrintPreview>
  );
}

// ---------- The sheet ----------

function EntryRow({ e, i, day1, set, remove, fe, disabled }) {
  const cell = (key, extra = {}) => (
    <input
      aria-label={`${extra.label ?? key} on scan day ${i + 1}`}
      value={e[key]}
      disabled={disabled}
      onChange={(ev) => set(i, key, ev.target.value)}
      className={fe(`entries.${i}.${key}`) ? 'is-invalid' : undefined}
      {...(extra.props ?? {})}
    />
  );
  const d = cycleDay(day1, e.on);
  return (
    <tr>
      <td>{cell('on', { label: 'Date', props: { type: 'date' } })}</td>
      <td className="tabular fc-day">{d != null && d > 0 ? d : '—'}</td>
      <td>{cell('right', { label: 'Right ovary follicles (mm)', props: { placeholder: '16, 12', inputMode: 'decimal' } })}</td>
      <td>{cell('left', { label: 'Left ovary follicles (mm)', props: { placeholder: '10', inputMode: 'decimal' } })}</td>
      <td>{cell('endometriumMm', { label: 'Endometrium (mm)', props: { inputMode: 'decimal', maxLength: 5 } })}</td>
      <td>
        <select aria-label={`Endometrial pattern on scan day ${i + 1}`} value={e.pattern} disabled={disabled} onChange={(ev) => set(i, 'pattern', ev.target.value)}>
          <option value="">—</option>
          {Object.entries(PATTERN_WORDS).map(([k, w]) => (
            <option key={k} value={k}>
              {w.en}
            </option>
          ))}
        </select>
      </td>
      <td>{cell('e2', { label: 'E2', props: { inputMode: 'decimal', maxLength: 6 } })}</td>
      <td>{cell('lh', { label: 'LH', props: { inputMode: 'decimal', maxLength: 5 } })}</td>
      <td>{cell('p4', { label: 'Progesterone', props: { inputMode: 'decimal', maxLength: 5 } })}</td>
      <td>{cell('given', { label: 'Medicine given', props: { maxLength: 200 } })}</td>
      <td>{cell('note', { label: 'Note', props: { maxLength: 300 } })}</td>
      <td className="fc-by">
        {e.byName ? (
          <span className="muted">
            {e.byName}
            <br />
            {formatDate(e.at)}
          </span>
        ) : (
          <span className="muted">new</span>
        )}
        {!disabled && (
          <button type="button" className="icon-btn" aria-label={`Remove scan day ${i + 1}`} onClick={() => remove(i)}>
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * The next scan booked from the cycle sheet (fertility idea F7, the owner's go-ahead of 27 Oct 2026): the cycle day,
 * its date worked out from day 1, and Book – the Appointments page opens on that day with her doctor and her chosen.
 */
function NextScan({ patient, day1, today }) {
  const navigate = useNavigate();
  const [n, setN] = useState('');
  const day = Number(n);
  const on = dateOfCycleDay(day1, day);
  const past = on && today && on < today;
  const book = () =>
    navigate(`/appointments?date=${on}${patient.assignedDoctor ? `&doctor=${patient.assignedDoctor}` : ''}`, {
      state: { bookFor: { id: patient.id, fullName: patient.fullName, mrn: patient.mrn, phone: patient.phone ?? '' } },
    });
  return (
    <div className="fc-next-scan">
      <Field label="Next scan on cycle day" id="fc-next-day" hint={on ? `${formatDate(on)}${past ? ' – already past' : ''}` : 'Day 1 is the first day of the period.'} keepHint>
        <input id="fc-next-day" inputMode="numeric" className="hs-num" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </Field>
      <button type="button" className="btn btn-secondary" disabled={!on || past} onClick={book}>
        <CalendarPlus aria-hidden="true" /> Book the next scan
      </button>
    </div>
  );
}

export function FertilityCyclePage() {
  const { patient } = useOutletContext();
  const { cycleId } = useParams();
  const { data, error, loading, reload } = useFetch(patient.access?.canViewFertilityPlan ? `/patients/${patient.id}/fertility-plan/cycles/${cycleId}` : null);
  const [v, setV] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [note, setNote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (data?.cycle) {
      setV(cycleValues(data.cycle));
      setStopping(Boolean(data.cycle.cancelled));
    }
  }, [data]);
  if (!patient.access?.canViewFertilityPlan) return <div className="card">Her treatment plan is not part of your role for this patient.</div>;
  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (loading || !data || !v) return <div className="card">Loading…</div>;
  const { cycle, plan, access } = data;
  const disabled = !access.canEdit;
  const fe = (path) => fieldErrors[path];
  const base = `/patients/${patient.id}/fertility-plan`;
  const setTop = (key, value) => setV((cur) => ({ ...cur, [key]: value }));
  const setIn = (section, key) => (ev) => setV((cur) => ({ ...cur, [section]: { ...cur[section], [key]: ev.target.value } }));
  const setEntry = (i, key, value) => setV((cur) => ({ ...cur, entries: cur.entries.map((e, j) => (j === i ? { ...e, [key]: value } : e)) }));
  const addEntry = () => setV((cur) => ({ ...cur, entries: [...cur.entries, blankEntry(today())] }));
  const removeEntry = (i) => setV((cur) => ({ ...cur, entries: cur.entries.filter((_, j) => j !== i) }));
  const save = async (ev) => {
    ev.preventDefault();
    const local = cycleErrors(v);
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setSaveError('Please check the highlighted fields.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const res = await api(`${base}/cycles/${cycle.id}`, { method: 'PUT', body: cyclePayload(v, cycle.rev) });
      const counted = res.counted ? ` Counted on her record: ${res.counted.total} ${counterWords(res.counted.counter, res.counted.total)}.` : '';
      setNote(`Sheet saved.${counted}`);
      reload();
    } catch (err) {
      setSaveError(err.message);
      setFieldErrors(err.fields ?? {});
      if (err.status === 409) reload();
    } finally {
      setSaving(false);
    }
  };
  const positive = cycle.outcome?.test === 'positive' || cycle.outcome?.clinical === 'yes';
  return (
    <form className="fp-tab" onSubmit={save} noValidate>
      <section className="card" aria-labelledby="fc-title">
        <div className="fp-head">
          <h2 id="fc-title">
            Cycle {cycle.number} <CycleStatus cycle={cycle} />
          </h2>
          <div className="fp-head-actions">
            <Link to={base} className="btn btn-link">
              <ArrowLeft aria-hidden="true" /> Treatment plan
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => setPrinting(true)}>
              <Printer aria-hidden="true" /> Print report
            </button>
            {!disabled && (
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save the sheet'}
              </button>
            )}
          </div>
        </div>
        <p className="fp-meta">
          {plan && <span>Plan: {plan.title}</span>}
          <span>Started by {cycle.created?.byName ?? 'staff'} on {formatDate(cycle.created?.at)}</span>
          {cycle.lastEdited && <span>Edited by {cycle.lastEdited.byName} on {formatDateTime(cycle.lastEdited.at)}</span>}
          {cycle.counted && <span>Counted on her record</span>}
        </p>
        <Alert type="success" onClose={() => setNote(null)}>
          {note}
        </Alert>
        <Alert type="error" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
        {positive && (
          <Alert type="info">
            A positive result: record the plan's outcome as pregnant on the <Link to={base}>Treatment plan</Link> tab when it is confirmed, and register the pregnancy as antenatal care when she books.
          </Alert>
        )}
        {disabled && <p className="hint">Read only: her doctor or an RMO fills the sheet.</p>}
        <fieldset className="fieldset-plain" disabled={disabled}>
          <div className="fp-dates">
            <Field label="Day 1 of the cycle (first day of the period)" id="fc-day1" error={fe('day1')}>
              <input id="fc-day1" type="date" value={v.day1} onChange={(ev) => setTop('day1', ev.target.value)} />
            </Field>
            <Field label="Medicines of the cycle" id="fc-kind" error={fe('protocol.kind')}>
              <select id="fc-kind" value={v.protocol.kind} onChange={setIn('protocol', 'kind')}>
                <option value="">Not recorded</option>
                {Object.entries(PROTOCOL_KIND_WORDS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w.en}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Medicine" id="fc-drug" error={fe('protocol.drug')}>
              <input id="fc-drug" maxLength={120} value={v.protocol.drug} onChange={setIn('protocol', 'drug')} />
            </Field>
            <Field label="Dose" id="fc-dose" error={fe('protocol.dose')}>
              <input id="fc-dose" maxLength={120} value={v.protocol.dose} onChange={setIn('protocol', 'dose')} />
            </Field>
            <Field label="Days" id="fc-days" error={fe('protocol.days')} hint="e.g. day 3 to 7">
              <input id="fc-days" maxLength={60} value={v.protocol.days} onChange={setIn('protocol', 'days')} />
            </Field>
          </div>
        </fieldset>
      </section>

      <section className="card" aria-labelledby="fc-scans-title">
        <div className="fp-head">
          <h2 id="fc-scans-title">Scan days</h2>
          {!disabled && (
            <div className="fp-head-actions">
              <button type="button" className="btn btn-secondary" onClick={addEntry}>
                <Plus aria-hidden="true" /> Add scan day
              </button>
            </div>
          )}
        </div>
        <p className="hint">Follicle sizes in mm, separated by commas (the largest first is usual). The cycle day is worked out from day 1. Cancel the cycle when more than 2 follicles reach 14 mm.</p>
        {Object.keys(fieldErrors).some((k) => k.startsWith('entries.')) && <Alert type="error">{Object.entries(fieldErrors).filter(([k]) => k.startsWith('entries.')).map(([k, m]) => `Scan day ${Number(k.split('.')[1]) + 1}: ${m}`).join(' ')}</Alert>}
        <div className="dt-wrap fc-table-wrap">
          <table className="dt fc-entries">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Day</th>
                <th scope="col">Right (mm)</th>
                <th scope="col">Left (mm)</th>
                <th scope="col">Endometrium</th>
                <th scope="col">Pattern</th>
                <th scope="col">E2</th>
                <th scope="col">LH</th>
                <th scope="col">P4</th>
                <th scope="col">Given</th>
                <th scope="col">Note</th>
                <th scope="col">Entered by</th>
              </tr>
            </thead>
            <tbody>
              {v.entries.map((e, i) => (
                <EntryRow key={`${i}-${e.at ?? 'new'}`} e={e} i={i} day1={v.day1} set={setEntry} remove={removeEntry} fe={fe} disabled={disabled} />
              ))}
              {!v.entries.length && (
                <tr>
                  <td colSpan={12} className="dt-empty">
                    No scan days yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!disabled && !cycle.cancelled && cycle.status !== 'completed' && <NextScan patient={patient} day1={v.day1} today={new Date().toISOString().slice(0, 10)} />}
      </section>

      <section className="card" aria-labelledby="fc-after-title">
        <h2 id="fc-after-title">Trigger, relations or IUI, and support</h2>
        <fieldset className="fieldset-plain" disabled={disabled}>
          <div className="fp-dates">
            <Field label="Trigger medicine" id="fc-trig-drug" error={fe('trigger.drug')} hint="e.g. hCG">
              <input id="fc-trig-drug" maxLength={120} value={v.trigger.drug} onChange={setIn('trigger', 'drug')} />
            </Field>
            <Field label="Trigger dose" id="fc-trig-dose" error={fe('trigger.dose')}>
              <input id="fc-trig-dose" maxLength={60} value={v.trigger.dose} onChange={setIn('trigger', 'dose')} />
            </Field>
            <Field label="Trigger date" id="fc-trig-at" error={fe('trigger.at')}>
              <input id="fc-trig-at" type="date" value={v.trigger.at} onChange={setIn('trigger', 'at')} />
            </Field>
          </div>
          <div className="fp-dates">
            <Field label="Relations or IUI" id="fc-timing-kind" error={fe('timing.kind')}>
              <select id="fc-timing-kind" value={v.timing.kind} onChange={setIn('timing', 'kind')}>
                <option value="">Not recorded</option>
                {Object.entries(TIMING_WORDS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w.en}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={v.timing.kind === 'iui' ? 'IUI date' : 'Date advised'} id="fc-timing-on" error={fe('timing.on')}>
              <input id="fc-timing-on" type="date" value={v.timing.on} onChange={setIn('timing', 'on')} />
            </Field>
            {v.timing.kind === 'iui' && (
              <Field label="Post-wash motile count (million)" id="fc-postwash" error={fe('timing.postWashMillions')}>
                <input id="fc-postwash" inputMode="decimal" maxLength={6} value={v.timing.postWashMillions} onChange={setIn('timing', 'postWashMillions')} />
              </Field>
            )}
            <Field label="Note" id="fc-timing-note" error={fe('timing.note')}>
              <input id="fc-timing-note" maxLength={300} value={v.timing.note} onChange={setIn('timing', 'note')} />
            </Field>
          </div>
          <Field label="Luteal support" id="fc-luteal" error={fe('luteal')} hint="e.g. progesterone 200 mg vaginally at night from the day after the IUI">
            <input id="fc-luteal" maxLength={200} value={v.luteal} onChange={(ev) => setTop('luteal', ev.target.value)} />
          </Field>
        </fieldset>
      </section>

      <section className="card" aria-labelledby="fc-outcome-title">
        <h2 id="fc-outcome-title">Outcome</h2>
        <fieldset className="fieldset-plain" disabled={disabled}>
          <div className="fp-dates">
            <Field label="Pregnancy test" id="fc-test" error={fe('outcome.test')}>
              <select id="fc-test" value={v.outcome.test} onChange={setIn('outcome', 'test')}>
                <option value="">Awaited</option>
                {Object.entries(TEST_RESULT_WORDS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w.en}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Test date" id="fc-test-on" error={fe('outcome.testOn')}>
              <input id="fc-test-on" type="date" value={v.outcome.testOn} onChange={setIn('outcome', 'testOn')} />
            </Field>
            <Field label="Beta hCG (IU/L)" id="fc-beta" error={fe('outcome.betaHcg')}>
              <input id="fc-beta" inputMode="decimal" maxLength={7} value={v.outcome.betaHcg} onChange={setIn('outcome', 'betaHcg')} />
            </Field>
            <Field label="Beta hCG date" id="fc-beta-on" error={fe('outcome.betaHcgOn')}>
              <input id="fc-beta-on" type="date" value={v.outcome.betaHcgOn} onChange={setIn('outcome', 'betaHcgOn')} />
            </Field>
            <Field label="Clinical pregnancy" id="fc-clinical" error={fe('outcome.clinical')}>
              <select id="fc-clinical" value={v.outcome.clinical} onChange={setIn('outcome', 'clinical')}>
                <option value="">—</option>
                {Object.entries(CLINICAL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scan date" id="fc-scan-on" error={fe('outcome.scanOn')}>
              <input id="fc-scan-on" type="date" value={v.outcome.scanOn} onChange={setIn('outcome', 'scanOn')} />
            </Field>
          </div>
          <Field label="Outcome note" id="fc-outcome-note" error={fe('outcome.note')}>
            <input id="fc-outcome-note" maxLength={300} value={v.outcome.note} onChange={setIn('outcome', 'note')} />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={stopping}
              onChange={(ev) => {
                setStopping(ev.target.checked);
                setTop('cancelled', ev.target.checked ? (v.cancelled ?? { reason: 'too_many_follicles', note: '' }) : null);
              }}
            />{' '}
            <strong>This cycle was stopped</strong> – not counted as a completed cycle
          </label>
          {stopping && (
            <div className="fp-dates">
              <Field label="Why" id="fc-cancel-reason" error={fe('cancelled.reason')}>
                <select id="fc-cancel-reason" value={v.cancelled?.reason ?? 'too_many_follicles'} onChange={(ev) => setTop('cancelled', { ...(v.cancelled ?? {}), reason: ev.target.value })}>
                  {Object.entries(CANCEL_REASON_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note" id="fc-cancel-note" error={fe('cancelled.note')}>
                <input id="fc-cancel-note" maxLength={300} value={v.cancelled?.note ?? ''} onChange={(ev) => setTop('cancelled', { ...(v.cancelled ?? { reason: 'too_many_follicles' }), note: ev.target.value })} />
              </Field>
            </div>
          )}
        </fieldset>
        {!disabled && (
          <div className="sticky-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save the sheet'}
            </button>
            <Link to={base} className="btn btn-link">
              Back to the plan
            </Link>
          </div>
        )}
      </section>
      {printing && <ReportPreview patient={patient} cycle={cycle} plan={plan} onClose={() => setPrinting(false)} />}
    </form>
  );
}
