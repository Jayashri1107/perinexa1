import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { ShowChoice } from '../quality/SimpleTable.jsx';
import { EPDS_ITEMS, epdsResult, vteConflict, vteFactorsFor, vteResult } from './scoreRules.js';

// Her EPDS and VTE risk scores (Clinical Requirements Group A, item 5). The EPDS is filled in on the hospital's paper
// form: here only the ten answers' scores (0–3) are typed – the questions are not shown (copyright of the Royal
// College of Psychiatrists). The VTE score ticks the RCOG 37a risk factors and shows its advice – never a dose.
// DRAFT rules until the Lead Obstetrician checks them against OBG-F-10 and OBG-F-11.

const BAND_LOOK = {
  unlikely: { tone: 'stable', word: 'Depression unlikely' },
  possible: { tone: 'watch', word: 'Possible depression' },
  likely: { tone: 'high', word: 'Likely depression' },
  low: { tone: 'stable', word: 'Lower risk' },
  intermediate: { tone: 'watch', word: 'Intermediate risk' },
  high: { tone: 'high', word: 'High risk' },
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function Result({ kind, r }) {
  const look = BAND_LOOK[r.band];
  return (
    <div className="ip-derived" aria-live="polite">
      <p>
        <StatusPill tone={look.tone}>{look.word}</StatusPill> {`${kind === 'epds' ? 'EPDS' : 'VTE score'} ${r.total}`}
        {r.selfHarm && (
          <>
            {' '}
            <StatusPill tone="high">Question 10 scored</StatusPill>
          </>
        )}
      </p>
      {r.advice.map((a) => (
        <p key={a}>{a}</p>
      ))}
    </div>
  );
}

function EpdsForm({ patient, onSaved }) {
  const [scores, setScores] = useState(() => Array(EPDS_ITEMS).fill(''));
  const [on, setOn] = useState(today());
  const [phase, setPhase] = useState(patient.careType === 'antenatal' ? 'antenatal' : 'postnatal');
  const [requestId, setRequestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const complete = scores.every((x) => x !== '');
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/clinical-scores', { method: 'POST', body: { clientRequestId: requestId, patientId: patient.id, kind: 'epds', on, phase, epdsScores: scores.map(Number) } });
      setScores(Array(EPDS_ITEMS).fill(''));
      setRequestId(newRequestId());
      setError(null);
      onSaved('EPDS saved.');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form onSubmit={save} className="stack">
      <p className="hint">Type the score (0 to 3) of each answer from her paper EPDS form, in the order of the form.</p>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        <Field label="Date" id="epds-on" error={error?.fields?.on}>
          <input id="epds-on" type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label="When" id="epds-phase">
          <select id="epds-phase" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="antenatal">In pregnancy</option>
            <option value="postnatal">After delivery</option>
          </select>
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>Scores from her paper EPDS form (0 to 3 each)</legend>
        <div className="form-grid epds-grid">
        {scores.map((v, i) => (
          // The answers have no ids: their place on the form is their key
          // eslint-disable-next-line react/no-array-index-key
          <Field key={i} label={`Answer ${i + 1}`} id={`epds-${i}`} error={i === 0 ? error?.fields?.epdsScores : undefined}>
            <select id={`epds-${i}`} value={v} onChange={(e) => setScores(scores.map((x, j) => (j === i ? e.target.value : x)))}>
              <option value="">–</option>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        ))}
        </div>
      </fieldset>
      {complete && <Result kind="epds" r={epdsResult(scores.map(Number))} />}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={!complete}>
          Save the EPDS
        </button>
      </div>
    </form>
  );
}

function VteForm({ patient, onSaved }) {
  const [phase, setPhase] = useState(patient.careType === 'antenatal' ? 'antenatal' : 'postnatal');
  const [picked, setPicked] = useState([]);
  const [lmwh, setLmwh] = useState(false);
  const [on, setOn] = useState(today());
  const [requestId, setRequestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const factors = vteFactorsFor(phase);
  const keys = picked.filter((k) => factors.some((f) => f.key === k));
  const problem = vteConflict(keys);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/clinical-scores', { method: 'POST', body: { clientRequestId: requestId, patientId: patient.id, kind: 'vte', on, phase, vteFactors: keys, antenatalLmwh: phase === 'postnatal' && lmwh } });
      setPicked([]);
      setRequestId(newRequestId());
      setError(null);
      onSaved('VTE score saved.');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form onSubmit={save} className="stack">
      <Alert type="error">{error?.message ?? (problem || null)}</Alert>
      <div className="form-grid">
        <Field label="Date" id="vte-on" error={error?.fields?.on}>
          <input id="vte-on" type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label="When" id="vte-phase">
          <select id="vte-phase" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="antenatal">In pregnancy</option>
            <option value="postnatal">After delivery</option>
          </select>
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>Risk factors she has</legend>
        {error?.fields?.vteFactors && <p className="field-error">{error.fields.vteFactors}</p>}
        <div className="check-grid">
          {factors.map((f) => (
            <label key={f.key} className="check">
              <input type="checkbox" checked={picked.includes(f.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.key] : picked.filter((x) => x !== f.key))} /> {`${f.label} (${f.score})`}
            </label>
          ))}
        </div>
      </fieldset>
      {phase === 'postnatal' && (
        <label className="check">
          <input type="checkbox" checked={lmwh} onChange={(e) => setLmwh(e.target.checked)} /> She was on LMWH before birth
        </label>
      )}
      <Result kind="vte" r={vteResult(phase, keys, { antenatalLmwh: phase === 'postnatal' && lmwh })} />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={Boolean(problem)}>
          Save the VTE score
        </button>
      </div>
    </form>
  );
}

export function PatientScoresTab() {
  const { patient } = useOutletContext();
  const { data, error, reload } = useFetch('/clinical-scores', { patientId: patient.id });
  const [which, setWhich] = useState('epds');
  const [notice, setNotice] = useState(null);
  const saved = (text) => {
    setNotice(text);
    reload();
  };
  return (
    <div className="stack">
      <Alert type="error">{error}</Alert>
      {notice && (
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {data?.access.write && (
        <section className="card" aria-labelledby="sc-new">
          <h2 id="sc-new">Add a score</h2>
          <ShowChoice label="Which score" options={[['epds', 'EPDS'], ['vte', 'VTE risk']]} value={which} onChange={setWhich} />
          {which === 'epds' ? <EpdsForm patient={patient} onSaved={saved} /> : <VteForm patient={patient} onSaved={saved} />}
          <p className="muted small">DRAFT rules until the Lead Obstetrician checks them. Sources: {data.rules.epdsSource}; {data.rules.vteSource}.</p>
        </section>
      )}
      <section className="card" aria-labelledby="sc-list">
        <h2 id="sc-list">Her scores</h2>
        {data && !data.scores.length && <p className="muted">No scores yet.</p>}
        <ul className="plain-list stack">
          {(data?.scores ?? []).map((s) => (
            <li key={s.id} className={s.cancelled ? 'muted' : undefined}>
              <strong>{`${formatDate(s.on)} · ${s.kind === 'epds' ? 'EPDS' : 'VTE score'} ${s.total}`}</strong>
              {s.cancelled ? ` · entered in error (${s.cancelled.reason})` : ` · ${BAND_LOOK[s.band]?.word}${s.selfHarm ? ' · question 10 scored' : ''}`}
              <span className="hint">{` · ${s.byName}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
