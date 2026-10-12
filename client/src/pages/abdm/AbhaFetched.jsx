import { useState } from 'react';
import { Download, EyeOff, FileText, FlaskConical, Inbox, Paperclip, RefreshCw, Smartphone } from 'lucide-react';
import { api, apiFile, newRequestId } from '../../api.js';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal } from '../pharmacy/pharmacyUi.jsx';
import {
  DAY_CHOICES,
  FETCH_HI_TYPES,
  FETCH_TYPE_WORDS,
  PRACTICE_LABEL,
  PRACTICE_NOTE,
  dayOf,
  documentDate,
  documentStatusNote,
  documentType,
  fetchDefaults,
  fileLine,
  hospitalStatus,
  leftOutLine,
  requestLine,
  requestStatus,
  withheldNote,
  withheldSummary,
} from './abhaFetchedFormat.js';

// Her records from other hospitals (ABDM milestone M3), on her ABHA tab – for those who may see her medical details.
// Her doctor or an RMO asks through ABDM; she agrees in her ABHA app; each hospital's records arrive and are shown
// read-only, until her consent ends (then the server deletes them). Never added to her records here, never sent on.
// In practice mode, buttons stand in for her ABHA app. The server decides everything; this only shows it.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The documents received, newest first: date (or that it gives none), type, hospital, title; what was withheld or attached; practice ones marked. */
export function FetchedTable({ documents, onOpen = () => {} }) {
  if (!documents.length) return <p className="hint">No records from other hospitals yet.</p>;
  return (
    <div className="bill-wide">
      <table className="abha-records abha-fetched">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Hospital</th>
            <th scope="col">Document</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td className="tabular">{documentDate(d)}</td>
              <td>{documentType(d)}</td>
              <td>{d.hospital}</td>
              <td>
                {d.title}
                {d.practice && (
                  <div>
                    <StatusPill tone="watch" icon={FlaskConical}>
                      {PRACTICE_LABEL}
                    </StatusPill>
                  </div>
                )}
                {d.withheld > 0 && (
                  <div>
                    <StatusPill tone="watch" icon={EyeOff}>
                      Part withheld
                    </StatusPill>
                  </div>
                )}
                {d.files > 0 && (
                  <p className="hint">
                    <Paperclip aria-hidden="true" className="abha-inline-icon" /> {plural(d.files, 'file')} to download
                  </p>
                )}
              </td>
              <td>
                <button type="button" className="btn btn-link btn-sm" aria-label={`Read ${documentType(d)} ${d.date ? `of ${dayOf(d.date)}` : '(date not given)'} from ${d.hospital}`} onClick={() => onOpen(d.id)}>
                  <FileText aria-hidden="true" /> Read
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each request: what was asked, her answer, and each hospital's answer – with the practice buttons in practice mode. */
export function RequestsList({ requests, canAsk = false, practice = false, busy = false, onAnswer = () => {}, onEnd = () => {}, onAgain = () => {} }) {
  if (!requests.length) return <p className="hint">Nothing asked for yet.</p>;
  return (
    <ul className="abha-consents">
      {requests.map((r) => {
        const s = requestStatus(r);
        return (
          <li key={r.id}>
            <div className="row-between">
              <div>
                <strong>{r.purpose}</strong>
                {r.practice ? ' · practice' : ''}
                <p className="hint">
                  {requestLine(r)} · asked by {r.byName || 'staff'}, {formatDateTime(r.at)}
                </p>
              </div>
              <StatusPill tone={s.tone} icon={s.icon}>
                {s.label}
              </StatusPill>
            </div>
            {s.hint && <p className="hint">{s.hint}</p>}
            {r.hospitals.length > 0 && (
              <ul className="abha-transfers">
                {r.hospitals.map((h) => {
                  const hs = hospitalStatus(h);
                  return (
                    <li key={h.consentId}>
                      <span className="abha-hospital">{h.hipName}</span>{' '}
                      <StatusPill tone={hs.tone} icon={hs.icon}>
                        {hs.label}
                      </StatusPill>
                      {hs.hint && <span className="hint"> {hs.hint}</span>}
                      {canAsk && h.canFetchAgain && (
                        <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => onAgain(r, h)}>
                          <RefreshCw aria-hidden="true" /> Fetch again
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {practice && canAsk && r.practice && r.status === 'waiting' && (
              <div className="row abha-practice-row">
                <span className="hint">
                  <Smartphone aria-hidden="true" className="abha-inline-icon" /> Practice – as her ABHA app:
                </span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAnswer(r, true)}>
                  Practice: she approves
                </button>
                <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => onAnswer(r, false)}>
                  Practice: she refuses
                </button>
              </div>
            )}
            {practice && canAsk && r.practice && r.status === 'granted' && (
              <div className="row abha-practice-row">
                <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => onEnd(r, 'REVOKED')}>
                  Practice: she withdraws her consent
                </button>
                <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => onEnd(r, 'EXPIRED')}>
                  Practice: her consent ends now
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Ask for her records from other hospitals": the kinds, the dates, how long the consent lasts. */
function AskDialog({ patientId, onClose, onDone }) {
  const [form, setForm] = useState(() => fetchDefaults());
  const [clientRequestId] = useState(() => newRequestId());
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const toggle = (t, on) => setForm({ ...form, hiTypes: on ? FETCH_HI_TYPES.filter((x) => x === t || form.hiTypes.includes(x)) : form.hiTypes.filter((x) => x !== t) });
  const send = async () => {
    setError(null);
    setFields({});
    setBusy(true);
    try {
      await api(`/abdm/patients/${patientId}/fetch`, { method: 'POST', body: { clientRequestId, hiTypes: form.hiTypes, from: form.from, to: form.to, days: Number(form.days) } });
      onDone('The request was sent to her ABHA app. Her records come once she agrees there.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  const today = fetchDefaults().to;
  return (
    <Modal id="abha-fetch-ask" title="Ask for her records from other hospitals" onClose={onClose} wide>
      <p className="hint">The request goes to her ABHA app through ABDM. She chooses there which hospitals may send them, and nothing comes until she agrees.</p>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <dl className="abha-facts">
        <dt>Purpose</dt>
        <dd>Care management – for her care at this hospital</dd>
      </dl>
      <fieldset className="appt-reasons">
        <legend>Kinds of record</legend>
        {FETCH_HI_TYPES.map((t) => (
          <label key={t} className="appt-reason">
            <input type="checkbox" checked={form.hiTypes.includes(t)} onChange={(e) => toggle(t, e.target.checked)} /> {FETCH_TYPE_WORDS[t]}
          </label>
        ))}
      </fieldset>
      <div className="form-grid">
        <Field label="Records from" id="abha-fetch-from" error={fields.from}>
          <input id="abha-fetch-from" type="date" max={form.to || today} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </Field>
        <Field label="Records to" id="abha-fetch-to" error={fields.to} hint="Today at the latest.">
          <input id="abha-fetch-to" type="date" max={today} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </Field>
        <Field label="Consent lasts" id="abha-fetch-days" error={fields.days} hint="Her records are kept here only until then, and deleted then. She can withdraw sooner in her ABHA app.">
          <select id="abha-fetch-days" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
            {DAY_CHOICES.map((c) => (
              <option key={c.days} value={c.days}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || !form.hiTypes.length || !form.from || !form.to} onClick={send}>
          <Download aria-hidden="true" /> Send the request to her ABHA app
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** One document received, read-only: its facts, its sections, what was withheld, and its files. */
export function DocumentView({ document: d, isBaby = false, onDownload = () => {}, downloading = null }) {
  const differentName = d.documentHospital && d.documentHospital !== d.hospital;
  const statusNote = documentStatusNote(d.documentStatus);
  return (
    <>
      {d.practice && (
        <Alert type="warning" icon={FlaskConical}>
          {PRACTICE_NOTE}
        </Alert>
      )}
      {statusNote && <Alert type={statusNote.type}>{statusNote.text}</Alert>}
      <Alert type="info">Read-only – as the other hospital sent it. Not part of her records at this hospital, and never sent on. Deleted on {dayOf(d.expiresAt)}, when her consent ends.</Alert>
      {d.withheld > 0 && (
        <Alert type="warning" icon={EyeOff}>
          {withheldSummary(d.withheld)}
        </Alert>
      )}
      {d.checksumOk === false && <Alert type="warning">The other hospital's check of this document did not match what arrived. Read it with care, and ask that hospital if something looks wrong.</Alert>}
      <dl className="abha-facts">
        <dt>Type</dt>
        <dd>{documentType(d)}</dd>
        <dt>Date</dt>
        <dd>{dayOf(d.date) || 'Not given'}</dd>
        <dt>Hospital</dt>
        <dd>
          {d.hospital}
          {differentName ? ` (the document says: ${d.documentHospital})` : ''}
        </dd>
        {d.authors?.length > 0 && (
          <>
            <dt>Written by</dt>
            <dd>{d.authors.join(', ')}</dd>
          </>
        )}
        <dt>Name in the document</dt>
        <dd>{d.nameInDocument || 'Not given'}</dd>
        <dt>Received</dt>
        <dd>{formatDateTime(d.receivedAt)}</dd>
      </dl>
      <p className="hint">Check that the name in the document is hers before acting on it.</p>
      {d.sections.length === 0 && <p className="hint">This document has no readable text.</p>}
      {d.sections.map((s, i) => (
        <section key={`${s.title}-${i}`} className="abha-doc-section">
          <h3>{s.title}</h3>
          <ul className="abha-doc-lines">
            {s.lines.map((l, j) => (
              <li key={j} className={l.sub ? 'abha-doc-sub' : undefined}>
                {l.text}
                {l.withheld > 0 && (
                  <span className="abha-withheld">
                    <EyeOff aria-hidden="true" className="abha-inline-icon" /> {withheldNote(l.withheld)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {d.truncated && <Alert type="info">This document is long: only its first part is shown.</Alert>}
      {(d.files.length > 0 || d.filesLeftOut.length > 0) && (
        <section className="abha-doc-section">
          <h3>Attached files</h3>
          {d.files.map((f) => (
            <div key={f.id} className="row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={downloading === f.id} onClick={() => onDownload(f)}>
                <Download aria-hidden="true" /> Download {f.title}
              </button>
              <span className="hint">{fileLine(f)}</span>
            </div>
          ))}
          {d.files.length > 0 && !isBaby && <p className="hint">Perinexa cannot look inside a file for words about a baby's sex. If a file states it during a pregnancy, it must not be told to her or her family (PC-PNDT Act).</p>}
          {d.filesLeftOut.map((f, i) => (
            <p key={`${f.title}-${i}`} className="hint">
              {leftOutLine(f)}
            </p>
          ))}
        </section>
      )}
    </>
  );
}

function DocumentDialog({ patientId, recordId, isBaby, onClose }) {
  const res = useFetch(`/abdm/patients/${patientId}/fetched/${recordId}`);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);
  const d = res.data?.document;
  const download = async (f) => {
    setError(null);
    setDownloading(f.id);
    try {
      const { blob, name } = await apiFile(`/abdm/patients/${patientId}/fetched/${recordId}/files/${f.id}`);
      downloadFile(blob, name);
    } catch (err) {
      setError(err.message);
    }
    setDownloading(null);
  };
  return (
    <Modal id="abha-fetched-doc" title={d ? `${d.title} – ${d.hospital}` : 'Record from another hospital'} onClose={onClose} wide>
      {res.error && <Alert type="error">{res.error}</Alert>}
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      {d && <DocumentView document={d} isBaby={isBaby} onDownload={download} downloading={downloading} />}
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ---------- The section on her ABHA tab ----------

export function AbhaFetched({ patientId, hasAbha, isBaby = false }) {
  const res = useFetch(`/abdm/patients/${patientId}/fetch`);
  const [dialog, setDialog] = useState(null); // 'ask' | { doc: id }
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return null;
  const practice = d.mode === 'practice';
  const act = async (fn) => {
    setError(null);
    setFlash(null);
    setBusy(true);
    try {
      setFlash(await fn());
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
    res.reload();
  };
  const answer = (r, approve) =>
    act(async () => {
      await api(`/abdm/fetch/${r.id}/practice/answer`, { method: 'POST', body: { approve } });
      return approve ? 'She approved (practice). The made-up hospitals sent her records – they are listed below.' : 'She refused (practice). Nothing was received.';
    });
  const end = (r, status) =>
    act(async () => {
      await api(`/abdm/fetch/${r.id}/practice/end`, { method: 'POST', body: { status } });
      return status === 'REVOKED' ? 'She withdrew her consent (practice). Every record received with it was deleted.' : 'Her consent ended (practice). Every record received with it was deleted.';
    });
  const again = (r, h) =>
    act(async () => {
      await api(`/abdm/fetch/${r.id}/hospitals/${encodeURIComponent(h.consentId)}/again`, { method: 'POST', body: {} });
      return `Her records were asked for again from ${h.hipName}.`;
    });

  return (
    <section className="card bill-section">
      <div className="row-between">
        <h2>
          <Inbox aria-hidden="true" /> Her records from other hospitals
        </h2>
        {d.canAsk && hasAbha && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialog('ask')}>
            <Download aria-hidden="true" /> Ask for her records from other hospitals
          </button>
        )}
      </div>
      <p className="hint">With her consent in her ABHA app, other hospitals send her records here. They are read-only, never added to her records at this hospital and never sent on, and they are deleted when her consent ends or she withdraws it.</p>
      {!hasAbha && <p className="hint">Link her ABHA (above) to ask for her records from other hospitals.</p>}
      {hasAbha && !d.canAsk && <p className="hint">Only her doctor or an RMO asks for them.</p>}
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <h3>Records received</h3>
      <FetchedTable documents={d.documents} onOpen={(id) => setDialog({ doc: id })} />
      <h3>Requests</h3>
      {practice && d.canAsk && d.requests.some((r) => r.practice && ['waiting', 'granted'].includes(r.status)) && <p className="hint">Practice mode: the practice buttons stand in for her ABHA app, and two made-up hospitals answer. Nothing leaves this computer.</p>}
      <RequestsList requests={d.requests} canAsk={d.canAsk} practice={practice} busy={busy} onAnswer={answer} onEnd={end} onAgain={again} />
      {dialog === 'ask' && (
        <AskDialog
          patientId={patientId}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setFlash(message);
            res.reload();
          }}
        />
      )}
      {dialog?.doc && <DocumentDialog patientId={patientId} recordId={dialog.doc} isBaby={isBaby} onClose={() => setDialog(null)} />}
    </section>
  );
}
