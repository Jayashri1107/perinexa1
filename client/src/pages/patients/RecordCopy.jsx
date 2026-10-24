import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DocContent } from '../inpatient/DocumentPage.jsx';
import { StaffPlanTable } from './CarePlanPrint.jsx';
import {
  COPY_TITLE,
  appointmentRows,
  birthRows,
  consentRows,
  copyFileName,
  copyFooter,
  cutWarning,
  deathRows,
  deliveryRows,
  documentBlock,
  identityRows,
  labBlock,
  labFlagNote,
  lossRows,
  medicalRows,
  notInCopy,
  noteBlock,
  nursingRows,
  fertilityHistoryRows,
  fertilityPlanBlock,
  obstetricRows,
  planBlock,
  pregnancyRows,
  riskRows,
  stayBlock,
  visitBlock,
  workRows,
} from './recordCopyFormat.js';

// A copy of the patient's whole record (More → "Copy of the whole record"; her doctor or an RMO only): everything
// in the record, oldest first under clear headings, in the print preview – to print or to save as a PDF. For the
// patient herself (her right to a copy of her data) and for referrals. The server puts the copy together and
// decides what it holds (GET /api/patients/:id/record-copy, audited as "Full record copied"); printing and saving
// as a PDF are recorded like the other printouts. What a copy never holds is listed at its end.

// ---------- Small parts of the printed page ----------

/** Label and value rows (values may have several lines). */
function Rows({ rows }) {
  if (!rows.length) return null;
  return (
    <dl className="pdoc-details">
      {rows.map(([label, value], i) => (
        <div key={`${label}-${i}`}>
          <dt>{label}</dt>
          <dd className="pre-line">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A part of the record under its heading; "None recorded." when it is empty, so nothing looks forgotten. */
function Part({ title, empty = false, children }) {
  return (
    <>
      <h2 className="rc-heading">{title}</h2>
      {empty ? <p className="rc-none">None recorded.</p> : children}
    </>
  );
}

/** One entry (a visit, a lab order, a stay, a document): its heading, its status in words, and its rows. */
function Entry({ title, status, error, children }) {
  return (
    <section className="rc-entry">
      <h3>
        {title}
        {status && <span className="rc-status"> · {status}</span>}
      </h3>
      {error && <p className="pdoc-note">{error}</p>}
      {children}
    </section>
  );
}

/**
 * A table of short rows. The first column (a day or a time) stays on one line, and so do the columns in `oneLine`
 * (a kind, a name): a long "what was recorded" wraps instead of squeezing "Nurse Sample" onto two lines.
 */
function Table({ head, rows, oneLine = [] }) {
  const cellClass = (i) => [i === 0 && 'pdoc-tabular', oneLine.includes(i) && 'nowrap'].filter(Boolean).join(' ') || undefined;
  return (
    <table className="ptable pdoc-table rc-table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            {r.cells.map((cell, i) => (
              <td key={head[i]} className={cellClass(i)}>
                {cell || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Additions({ items }) {
  if (!items.length) return null;
  return (
    <>
      <p className="rc-sub">Corrections and additions</p>
      {items.map((x) => (
        <p key={x.key} className="pre-line">
          {x.text} <span className="pdoc-small">({x.by})</span>
        </p>
      ))}
    </>
  );
}

// ---------- The document ----------

/**
 * The copy on paper. copy: the server's answer; letterhead: the hospital's; printedAt, printedByName: for the footer
 * of every page (the hospital, the patient number – never her name – when and by whom, and "confidential").
 */
export function RecordCopyDocument({ copy, letterhead, printedAt, printedByName }) {
  const p = copy.patient;
  const baby = p.careType === 'newborn';
  const hospital = letterhead?.name || 'Hospital';
  const [footLeft, footRight] = copyFooter({ hospital, mrn: p.mrn, printedAt, printedByName });
  const pregnancy = pregnancyRows(copy);
  const risk = riskRows(copy);
  const loss = lossRows(copy);
  const delivery = deliveryRows(copy);
  const death = deathRows(copy);
  const work = workRows(copy.workDone);
  const consents = consentRows(copy.consents);
  const appointments = appointmentRows(copy.appointments);
  const labNote = labFlagNote(copy);
  const fertility = fertilityHistoryRows(copy);
  const fertilityPlans = copy.fertilityPlans ?? [];
  return (
    <PrintDocument
      className="rc-doc"
      draft={cutWarning(copy)}
      footer={
        <>
          <span>{footLeft}</span>
          <span>{footRight}</span>
        </>
      }
    >
      <Letterhead letterhead={letterhead} />
      <h1 className="pdoc-title">{COPY_TITLE}</h1>
      <PrintFacts
        items={[
          ['Name', p.fullName],
          ['Patient no.', <span key="mrn" className="pdoc-tabular">{p.mrn}</span>],
          ['Copy made', formatDateTime(copy.madeAt)],
        ]}
      />
      <p className="pdoc-note">
        Everything recorded for this patient at {hospital} up to {formatDateTime(copy.madeAt)}, oldest first. Made for the patient{baby ? ' (the parents of a baby)' : ''}, or for a doctor the
        patient is referred to. What a copy never holds is listed at the end.
      </p>

      <Part title="Identity and contact">
        <Rows rows={identityRows(copy)} />
      </Part>
      {baby && (
        <Part title="Birth details">
          <Rows rows={birthRows(copy)} />
        </Part>
      )}
      <Part title="Medical background">
        <Rows rows={medicalRows(copy)} />
      </Part>
      {!baby && (
        <Part title="Obstetric history">
          <Rows rows={obstetricRows(copy)} />
        </Part>
      )}
      {fertility.length > 0 && (
        <Part title="Fertility history">
          <Rows rows={fertility} />
        </Part>
      )}
      {(pregnancy.length > 0 || risk.length > 0 || p.careType === 'antenatal') && (
        <Part title={p.careType === 'antenatal' ? 'Pregnancy' : 'Pregnancy dates kept on the record'}>
          {pregnancy.length > 0 ? <Rows rows={pregnancy} /> : <p className="rc-none">The pregnancy dates are not entered yet.</p>}
          {risk.length > 0 && (
            <>
              <h3>Risk level and its reasons</h3>
              <Rows rows={risk} />
            </>
          )}
        </Part>
      )}
      {loss.length > 0 && (
        <Part title="Pregnancy loss">
          <Rows rows={loss} />
        </Part>
      )}
      {delivery.length > 0 && (
        <Part title={p.careType === 'postnatal' ? 'After delivery' : 'Last delivery on the record'}>
          <Rows rows={delivery} />
        </Part>
      )}
      {death.length > 0 && (
        <Part title={p.death ? 'Death' : 'Recorded in error'}>
          <Rows rows={death} />
        </Part>
      )}
      {copy.emergencyNotes.length > 0 && (
        <Part title="Emergency treatment notes">
          {copy.emergencyNotes.map(noteBlock).map((n) => (
            <Entry key={n.key} title={n.title}>
              <Rows rows={n.rows} />
            </Entry>
          ))}
        </Part>
      )}

      <Part title="Visits" empty={!copy.visits.length}>
        {copy.visits.map(visitBlock).map((v) => (
          <Entry key={v.key} title={v.title} status={v.status} error={v.error}>
            {!v.error && !v.rows.length && <p className="rc-none">Nothing was written at this visit.</p>}
            <Rows rows={v.rows} />
            <Additions items={v.additions} />
          </Entry>
        ))}
      </Part>

      <Part title="Care plans" empty={!copy.carePlans.length}>
        {copy.carePlans.map((plan) => {
          const b = planBlock(plan);
          return (
            <section key={b.key} className="rc-plan">
              <h3>
                {b.title}
                <span className="rc-status"> · {b.status}</span>
              </h3>
              {b.draft && <p className="pdoc-note">{b.draft}</p>}
              <Rows rows={b.rows} />
              <p className="pdoc-note">A suggested schedule – the treating doctor decides.</p>
              <StaffPlanTable plan={plan} patient={p} />
            </section>
          );
        })}
      </Part>

      {/* (only an infertility record has treatment plans: the part is left out of the others unless one is there) */}
      {(p.careType === 'infertility' || fertilityPlans.length > 0) && (
        <Part title="Fertility treatment plans" empty={!fertilityPlans.length}>
          {fertilityPlans.map(fertilityPlanBlock).map((b) => (
            <Entry key={b.key} title={b.title} status={b.status}>
              <Rows rows={b.rows} />
            </Entry>
          ))}
        </Part>
      )}

      <Part title="Lab orders and results" empty={!copy.labOrders.length}>
        {labNote && <p className="pdoc-note">{labNote}</p>}
        {copy.labOrders
          .map((o) => labBlock(o, copy.catalogue))
          .map((o) => (
            <Entry key={o.key} title={o.title} status={o.status} error={o.error}>
              <Rows rows={o.rows} />
            </Entry>
          ))}
      </Part>

      <Part title="Scans and procedures done" empty={!work.length}>
        <Table head={['Day', 'Kind', 'What was done', 'Recorded by']} rows={work} oneLine={[1, 3]} />
      </Part>

      <Part title="Stays in hospital" empty={!copy.stays.length}>
        {copy.stays.map((s) => {
          const stay = stayBlock(s);
          const chart = nursingRows(s.nursing);
          return (
            <section key={stay.key} className="rc-stay">
              <h3>{stay.title}</h3>
              <Rows rows={stay.rows} />
              {s.documents.map((d) => {
                const doc = documentBlock(d);
                return (
                  <Entry key={doc.key} title={doc.title} status={doc.status} error={doc.error}>
                    {doc.signedContent && (
                      <>
                        <DocContent kind={d.kind} content={d.content} className="pdoc-details" />
                        <Additions items={d.additions.map((x) => ({ key: x.id, text: x.text, by: `${x.byName}, ${formatDateTime(x.at)}` }))} />
                      </>
                    )}
                  </Entry>
                );
              })}
              <p className="rc-sub">Nursing chart</p>
              {chart.length ? <Table head={['Time', 'Kind', 'What was recorded', 'By']} rows={chart} oneLine={[1, 3]} /> : <p className="rc-none">None recorded.</p>}
            </section>
          );
        })}
      </Part>

      <Part title="Consent forms and information given" empty={!consents.length}>
        <Table head={['Printed', 'Kind', 'Title', 'Signed copy']} rows={consents} oneLine={[1]} />
      </Part>

      <Part title="Appointments" empty={!appointments.length}>
        <Table head={['Day', 'Time', 'Visit', 'Doctor', 'Status']} rows={appointments} oneLine={[1, 3]} />
      </Part>

      <Part title="Not in this copy">
        <ul className="pdoc-list rc-left-out">
          {notInCopy(copy).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Part>
      <p className="pdoc-note rc-end">End of the copy of record {p.mrn}.</p>
    </PrintDocument>
  );
}

// ---------- Opened from the patient's page ----------

/** Shown while the server collects the record, and when it could not. */
function CopyWaiting({ error, onClose }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="rc-wait-title" aria-busy={!error}>
        <h2 id="rc-wait-title">Copy of the whole record</h2>
        {error ? <Alert type="error">The copy could not be made. {error}</Alert> : <p>Collecting everything in the record. This can take a moment.</p>}
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The request for this patient's copy: the one already made for her (`held`), or a new one. Every request is an
 * audit entry ("Full record copied"), so it is made once per opening; and it is kept with the patient it is for, so
 * a copy is never shown – or its printing recorded – under another patient's id.
 */
export const copyRequestFor = (held, patientId, ask) => (held && held.patientId === patientId ? held : { patientId, answer: ask(patientId) });

/** The copy, asked for once (React runs an effect twice while the app is being developed). */
function useCopyOnce(patientId) {
  const request = useRef(null); // { patientId, answer }
  const [state, setState] = useState({ patientId: null, copy: null, error: null });
  useEffect(() => {
    let alive = true;
    request.current = copyRequestFor(request.current, patientId, (id) => api(`/patients/${id}/record-copy`));
    request.current.answer.then(
      (data) => alive && setState({ patientId, copy: data.copy, error: null }),
      (err) => alive && setState({ patientId, copy: null, error: err.message }),
    );
    return () => {
      alive = false;
    };
  }, [patientId]);
  return state.patientId === patientId ? state : { copy: null, error: null };
}

/**
 * The copy of this patient's whole record in the print preview: Print and Download PDF. Opening it is recorded in
 * the audit log by the server; printing and saving the PDF are recorded here, before anything is printed or saved.
 */
export function RecordCopy({ patient, onClose }) {
  const { user, activeMembership } = useAuth();
  const { copy, error } = useCopyOnce(patient.id);
  const lh = useFetch('/tenant/settings/letterhead');
  const [printedAt] = useState(() => new Date());
  if (!copy || lh.loading) return <CopyWaiting error={copy ? null : error} onClose={onClose} />;

  const stored = lh.data?.letterhead ?? {};
  const letterhead = { ...stored, name: stored.name || activeMembership.tenantName };
  const baby = copy.patient.careType === 'newborn';
  const record = (as) => api(`/patients/${patient.id}/record-copy/printed`, { method: 'POST', body: { as } });
  // The file's name has the patient number, never the name. Download only: a whole record never goes to the
  // browser's share window or to WhatsApp.
  const pdf = { fileName: copyFileName(copy), title: `Record copy ${copy.patient.mrn}`, share: false, onSaved: () => record('pdf') };
  // Who may be given the copy: the same people in the hint and in the warning for a sensitive record
  const owner = baby ? 'the baby’s parents' : 'the patient herself';
  const referredTo = `a doctor ${baby ? 'the baby' : 'she'} is referred to`;
  const hint = (
    <>
      Everything in this record, oldest first. Check that it is the right patient, then print it on A4 paper or save it as a PDF (a long record takes a while to save). Give it only to {owner}, or
      to {referredTo}. Opening, printing and saving this copy are recorded in the audit log.
    </>
  );
  const controls = copy.patient.sensitive ? (
    <Alert type="warning">
      This record is marked sensitive. Hand the copy in person to {owner}, or give it only to {referredTo}.
    </Alert>
  ) : null;
  return (
    <PrintPreview title="Copy of the whole record – print preview" hint={hint} controls={controls} onPrint={() => record('paper')} pdf={pdf} docKey="copy" onClose={onClose}>
      <RecordCopyDocument copy={copy} letterhead={letterhead} printedAt={printedAt} printedByName={user.name} />
    </PrintPreview>
  );
}
