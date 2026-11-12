import { useState } from 'react';
import { CircleCheck, Clock } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Sonography stage 2 (docs/USG_APPS_REVIEW.md U1, U3, U5): the reference tables – for each measurement or Doppler
// index, the published chart the doctors chose, copied in week by week (5th, 50th, 95th centile) with its source, and
// approved by a doctor (server/src/routes/usgReferences.js). Nothing is built in: no reference value is typed from
// memory. Doctors write and approve; RMOs and sonographers read.

/** "20, 45.2, 48.9, 52.6" per line → rows; the line numbers that could not be read. PURE. */
export function parseRows(text) {
  const rows = [];
  const bad = [];
  text
    .split('\n')
    .map((l) => l.trim())
    .forEach((l, i) => {
      if (!l) return;
      const n = l.split(/[\s,;\t]+/).filter(Boolean).map(Number);
      if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return bad.push(i + 1);
      rows.push({ week: n[0], p5: n[1], p50: n[2], p95: n[3] });
    });
  return { rows, bad };
}
const rowsText = (rows) => rows.map((r) => `${r.week}, ${r.p5}, ${r.p50}, ${r.p95}`).join('\n');

function TableCard({ r, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(r.source);
  const [text, setText] = useState(rowsText(r.rows));
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const parsed = parseRows(text);
  const send = async (path, body) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api(path, { method: path.endsWith('/approve') ? 'POST' : 'PUT', body });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    }
    setBusy(false);
  };
  return (
    <section className="card" aria-labelledby={`ref-${r.key}`}>
      <h2 id={`ref-${r.key}`}>
        {r.name}{' '}
        {r.version === 0 ? (
          <StatusPill tone="inactive">No table</StatusPill>
        ) : r.status === 'approved' ? (
          <StatusPill tone="stable" icon={CircleCheck}>
            Approved
          </StatusPill>
        ) : (
          <StatusPill tone="watch" icon={Clock}>
            DRAFT
          </StatusPill>
        )}
      </h2>
      <p className="hint">
        {r.version ? `${r.source} · ${r.rows.length} weeks (${r.rows[0]?.week}–${r.rows[r.rows.length - 1]?.week}) · version ${r.version}, written by ${r.updatedByName}` : 'None yet – nothing is judged against this until a table is approved.'}
        {r.approved ? ` · approved by ${r.approved.byName}, ${formatDateTime(r.approved.at)}` : ''}
        {r.inUse && r.status !== 'approved' ? ` · version ${r.inUse.version} stays in use until this one is approved` : ''}
      </p>
      <Alert type="error">{error}</Alert>
      {editing ? (
        <>
          <Field label="Source (authors, year, title of the published chart)" id={`ref-${r.key}-src`} error={fields.source}>
            <input id={`ref-${r.key}-src`} value={source} maxLength={300} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <Field label={`One week per line: week, 5th, 50th, 95th centile${r.unit ? ` (${r.unit})` : ''}`} id={`ref-${r.key}-rows`} error={fields.rows} keepHint hint="Copy from the published table, or paste the four columns from a spreadsheet.">
            <textarea id={`ref-${r.key}-rows`} rows={10} className="tabular" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {parsed.bad.length > 0 && <Alert type="warning">Lines that could not be read: {parsed.bad.join(', ')}.</Alert>}
          {Object.entries(fields)
            .filter(([k]) => k.startsWith('rows.'))
            .map(([k, m]) => (
              <p key={k} className="field-error">
                {m}
              </p>
            ))}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || parsed.bad.length > 0} onClick={() => send(`/usg-references/${r.key}`, { source, rows: parsed.rows, version: r.version })}>
              Save as DRAFT
            </button>
            <button type="button" className="btn btn-link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        canEdit && (
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              {r.version ? 'Change' : 'Copy a table in'}
            </button>
            {r.version > 0 && r.status !== 'approved' && (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => send(`/usg-references/${r.key}/approve`, { version: r.version })}>
                <CircleCheck aria-hidden="true" /> Approve
              </button>
            )}
          </div>
        )
      )}
    </section>
  );
}

export function ReferenceTablesPage() {
  const res = useFetch('/usg-references');
  const d = res.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Scans', to: '/scans' }, { label: 'Reference tables' }]}
        title="Scan reference tables"
        documentTitle="Scan reference tables"
        help="The published charts the hospital's doctors chose for centile bands, a second weight chart and Doppler – copied in and approved by a doctor."
      />
      <div className="pf-content lab-stack">
        <Alert type="error">{res.error}</Alert>
        <p className="hint">
          Perinexa has none built in: each table is copied in by a doctor from the published chart named with it, and used only once a doctor approves it. Hadlock 1991 stays the weight curve; an approved
          second weight chart is drawn beside it.
        </p>
        {(d?.references ?? []).map((r) => (
          <TableCard key={r.key} r={r} canEdit={d.canEdit} onSaved={res.reload} />
        ))}
      </div>
    </>
  );
}
