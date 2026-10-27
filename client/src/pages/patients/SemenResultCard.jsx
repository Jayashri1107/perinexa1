import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, formatDate } from '../../components/ui.jsx';
import { SEMEN_LABELS } from './fertilityFormat.js';

// The latest semen analysis from the lab on the Treatment plan tab (fertility idea F2, the owner's go-ahead of
// 27 Oct 2026): the values with their WHO 2021 flags, and the fertility history's choice they suggest
// (server/src/fertility/semenResult.js). Her doctor or an RMO sets the history with one click, or chooses otherwise in
// Edit details – the lab result never changes it by itself.

const FLAG_WORDS = { low: 'Low', high: 'High', abnormal: 'Abnormal' };

export function SemenResultCard({ patient, semen, onSet }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!semen) return null;
  const suggested = semen.suggested?.status ?? '';
  const canSet = Boolean(patient.access?.canEditClinical) && suggested && suggested !== semen.recorded;
  const set = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}`, { method: 'PATCH', body: { fertility: { semen: suggested } } });
      onSet?.(`The fertility history now says: semen ${SEMEN_LABELS[suggested].toLowerCase()}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="fp-semen-title">
      <h2 id="fp-semen-title">
        <FlaskConical aria-hidden="true" /> Semen analysis, {formatDate(semen.at)}
      </h2>
      <Alert type="error">{error}</Alert>
      <dl className="details">
        {semen.values.map((v) => (
          <div key={v.key}>
            <dt>{v.name}</dt>
            <dd>
              {v.value} {v.unit}
              {FLAG_WORDS[v.flag] && <strong> · {FLAG_WORDS[v.flag]}</strong>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        In the fertility history: <strong>{SEMEN_LABELS[semen.recorded] ?? 'not recorded'}</strong>
        {suggested ? (
          <>
            {' '}
            · this result reads as <strong>{SEMEN_LABELS[suggested].toLowerCase()}</strong> (under 5 million/mL is read as severe – the doctor decides).
          </>
        ) : (
          ' · too few values to suggest a choice.'
        )}
      </p>
      {canSet && (
        <div className="fp-head-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={set}>
            {busy ? 'Saving…' : `Set the history to “${SEMEN_LABELS[suggested]}”`}
          </button>
          <Link to={`/patients/${patient.id}/edit`}>Choose otherwise in Edit details</Link>
        </div>
      )}
    </section>
  );
}
