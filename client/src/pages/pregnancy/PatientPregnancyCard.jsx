// Her pregnancy on her record (owner, 10 Oct 2026): EDD and weeks today, and the scans and vaccinations of the
// hospital's antenatal care plan with their dates and status. Her doctor, an RMO or a nurse ticks what is done (with
// the date) or undoes a tick made by mistake (with the reason). "Print pregnancy card" opens the A4 card. The schedule
// is marked DRAFT until a doctor approves the antenatal care plan in the Clinic library.
import { Baby, Printer, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pregnancyApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDate, todayInput } from '../../utils/format.js';
import { onlyWhenText, statusLook, weeksText, whenText } from './pregnancyFormat.js';

const KINDS = [
  ['scan', 'Scans'],
  ['vaccination', 'Vaccinations'],
];

export function PatientPregnancyCard({ patient }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { mode: 'done' | 'undo', item }
  const [form, setForm] = useState({ on: '', note: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    pregnancyApi.card(patient.id).then(setData).catch((err) => setError(err.message));
  }, [patient.id]);

  const open = (mode, item) => {
    setForm({ on: todayInput(), note: '', reason: '' });
    setFormError('');
    setDialog({ mode, item });
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const { mode, item } = dialog;
      setData(mode === 'done' ? await pregnancyApi.done(patient.id, item.key, { on: form.on, note: form.note }) : await pregnancyApi.undo(patient.id, item.key, form.reason));
      setDialog(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Baby size={18} aria-hidden /> Pregnancy</h2>
        {data && <Link to={`/hospital/print/pregnancy-card/${patient.id}`} target="_blank" className="btn btn-ghost btn-sm"><Printer size={14} aria-hidden /> Print pregnancy card</Link>}
      </div>
      <Alert type="error">{error}</Alert>
      {data && (
        <>
          <dl className="details">
            <dt>EDD</dt><dd>{data.patient.edd ? formatDate(data.patient.edd) : 'Not recorded – add the LMP or EDD to her record'}</dd>
            <dt>Today</dt><dd>{weeksText(data.weeksToday)}</dd>
          </dl>
          {data.draft && (
            <Alert type="info">
              DRAFT schedule: the antenatal care plan in the Clinic library is not approved by a doctor yet. Check each date before relying on it.
            </Alert>
          )}
          {KINDS.map(([kind, title]) => {
            const rows = data.items.filter((i) => i.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind} className="top-gap">
                <h3>{title}</h3>
                <div className="table-wrap top-gap-sm">
                <table className="table">
                  <thead>
                    <tr><th>{kind === 'scan' ? 'Scan' : 'Vaccine'}</th><th>When</th><th>Dates</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.key}>
                        <td>{i.name}{onlyWhenText(i) && <span className="muted block small">Only {onlyWhenText(i)}</span>}</td>
                        <td className="nowrap">{whenText(i, data.items)}</td>
                        <td className="nowrap small">{i.done ? <>Done {formatDate(i.done.on)}<span className="muted block">{i.done.byName}</span></> : i.window ? `${formatDate(i.window.from)} – ${formatDate(i.window.to)}` : '—'}</td>
                        <td><StateBadge look={statusLook(i.status)} small /></td>
                        <td className="nowrap">
                          {data.can.mark && i.status !== 'done' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('done', i)}>Mark done</button>}
                          {data.can.mark && i.status === 'done' && <button type="button" className="btn btn-link btn-sm" onClick={() => open('undo', i)}><Undo2 size={14} aria-hidden /> Undo</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}
        </>
      )}

      {dialog && (
        <Modal title={dialog.mode === 'done' ? `Done: ${dialog.item.name}` : `Undo: ${dialog.item.name}`} onClose={() => setDialog(null)} size="sm">
          <form onSubmit={save} noValidate>
            <Alert type="error">{formError}</Alert>
            {dialog.mode === 'done' ? (
              <>
                <div className="form-field">
                  <label htmlFor="preg-on">Date done<span className="required" aria-hidden> *</span></label>
                  <input id="preg-on" type="date" value={form.on} max={todayInput()} onChange={(e) => setForm({ ...form, on: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="preg-note">Note (optional)</label>
                  <input id="preg-note" value={form.note} maxLength={500} placeholder="e.g. Done at another centre; batch number" onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="form-field">
                <label htmlFor="preg-reason">Why it is undone<span className="required" aria-hidden> *</span></label>
                <input id="preg-reason" value={form.reason} maxLength={300} placeholder="e.g. Ticked for the wrong patient" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            )}
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || (dialog.mode === 'done' ? !form.on : form.reason.trim().length < 3)}>
                {busy ? 'Saving…' : dialog.mode === 'done' ? 'Save' : 'Undo'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
