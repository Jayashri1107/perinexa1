import { useState } from 'react';
import { CircleCheck, Clock, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_FORMULARY } from '../../platform/modules.js';
import { Alert, StatusPill, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal, useSend } from './pharmacyUi.jsx';

// PH7 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 6): Medicine marks – "High alert" and "looks or sounds like" on
// the stock list, written by a doctor and the pharmacist together (server/src/routes/medicineMarks.js). A change is
// in force only once a doctor and a pharmacist – two different people – have both confirmed it; until then it is
// waiting and shows nowhere else. Perinexa ships none: each hospital writes its own.

/** "High alert" at the counter and on the stock list – only while in force (the server sends it only then). */
export function HighAlertPill({ medicine }) {
  if (!medicine?.highAlert) return null;
  return (
    <StatusPill tone="high" icon={TriangleAlert}>
      High alert
    </StatusPill>
  );
}

function MarksDialog({ medicine, onClose, onDone }) {
  const [highAlert, setHighAlert] = useState(Boolean(medicine.marks?.highAlert));
  const [look, setLook] = useState(medicine.marks?.lookAlike ?? []);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const found = useFetch(term.length >= 2 ? '/medicine-marks/search' : null, { q: term });
  const s = useSend(onDone);
  return (
    <Modal id="mm-edit" title={`Marks of ${medicine.name}`} onClose={onClose}>
      <p>Saving makes a new version. It is in force once a doctor and the pharmacist – two different people – have both confirmed it; your own role is confirmed as you save.</p>
      <Alert type="error">{s.error}</Alert>
      <label className="check">
        <input type="checkbox" checked={highAlert} onChange={(e) => setHighAlert(e.target.checked)} /> High alert – shown at the counter and on the stock list
      </label>
      <fieldset className="fieldset">
        <legend>Looks or sounds like</legend>
        {look.length === 0 && <p className="muted">None.</p>}
        <ul className="plain-list">
          {look.map((x) => (
            <li key={x.id}>
              {x.name}{' '}
              <button type="button" className="btn btn-link btn-sm" onClick={() => setLook(look.filter((y) => y.id !== x.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {look.length < 5 && (
          <>
            <label className="sr-only" htmlFor="mm-find">
              Find a medicine that looks or sounds like it
            </label>
            <input id="mm-find" placeholder="Find a medicine that looks or sounds like it" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="plain-list">
              {(found.data?.medicines ?? [])
                .filter((x) => x.id !== medicine.id && !look.some((y) => y.id === x.id))
                .slice(0, 6)
                .map((x) => (
                  <li key={x.id}>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setLook([...look, { id: x.id, name: x.name }])}>
                      <Plus aria-hidden="true" /> {x.name}
                      {x.strength ? ` ${x.strength}` : ''}
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </fieldset>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy} onClick={() => s.send(`/medicine-marks/${medicine.id}`, { highAlert, lookAlike: look.map((x) => x.id), version: medicine.marks?.version ?? 0 }, 'PUT')}>
          {s.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function MedicineMarksPage() {
  const res = useFetch('/medicine-marks');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState('');
  const term = useDebounced(adding.trim(), 250);
  const found = useFetch(term.length >= 2 ? '/medicine-marks/search' : null, { q: term });
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const done = (message) => {
    setEditing(null);
    setFlash(message);
    res.reload();
  };
  const confirm = async (m) => {
    setError(null);
    try {
      const out = await api(`/medicine-marks/${m.id}/confirm`, { method: 'POST', body: { version: m.marks.version } });
      done(out.medicine.marks.inForce ? `${m.name}: the marks are now in force.` : `${m.name}: confirmed.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <PageHeader tabs={HOSPITAL_FORMULARY.tabs} title="Medicine marks" documentTitle="Medicine marks" help="High-alert and look-alike marks for the counter, written by a doctor and the pharmacist together." />
      <div className="pf-content lab-stack">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setError(null)}>
          {error}
        </Alert>
        <section className="card">
          <h2>Add marks to a medicine</h2>
          <label className="sr-only" htmlFor="mm-add">
            Find a medicine
          </label>
          <input id="mm-add" placeholder="Find a medicine on the stock list" value={adding} onChange={(e) => setAdding(e.target.value)} />
          <ul className="plain-list">
            {(found.data?.medicines ?? []).slice(0, 8).map((m) => (
              <li key={m.id}>
                <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(m)}>
                  {m.name}
                  {m.strength ? ` ${m.strength}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Marked medicines</h2>
          {res.data && !res.data.medicines.length && <p className="muted">None yet. Perinexa ships none: the doctors and the pharmacist write this list.</p>}
          <ul className="plain-list">
            {(res.data?.medicines ?? []).map((m) => {
              const k = m.marks;
              const mine = res.data.canConfirmAs.filter((r) => !k.confirmations.some((c) => c.role === r));
              return (
                <li key={m.id} className="mm-row">
                  <strong>{m.name}</strong>{' '}
                  {k.inForce ? (
                    <StatusPill tone="stable" icon={CircleCheck}>
                      In force
                    </StatusPill>
                  ) : (
                    <StatusPill tone="watch" icon={Clock}>
                      Waiting for {['doctor', 'pharmacist'].filter((r) => !k.confirmations.some((c) => c.role === r)).join(' and ')}
                    </StatusPill>
                  )}
                  <p className="hint">
                    {[k.highAlert && 'High alert', k.lookAlike.length && `Looks or sounds like ${k.lookAlike.map((x) => x.name).join(', ')}`].filter(Boolean).join(' · ') || 'No marks (cleared)'} · version {k.version}
                    {k.confirmations.length ? ` · confirmed by ${k.confirmations.map((c) => `${c.byName} (${c.role}, ${formatDateTime(c.at)})`).join(', ')}` : ''}
                  </p>
                  <div className="row">
                    {!k.inForce && mine.length > 0 && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => confirm(m)}>
                        <CircleCheck aria-hidden="true" /> Confirm as {mine[0]}
                      </button>
                    )}
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(m)}>
                      Change
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {editing && <MarksDialog medicine={editing} onClose={() => setEditing(null)} onDone={() => done(`${editing.name}: saved. It is in force once the other role confirms it.`)} />}
    </>
  );
}
