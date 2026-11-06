import { useState } from 'react';
import { BadgeCheck, CircleCheck, Minus, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { isReportMonth, monthWords, thisMonth } from '../analytics/analyticsFormat.js';
import { FormDialog } from './FormDialog.jsx';
import { ShowChoice } from './SimpleTable.jsx';
import { QUALITY_TABS } from './qualityFormat.js';

// Clinical audit → Monthly dashboards (Clinical Requirements Group B, item 17): each department's rows for a month,
// worked out from what Perinexa records (numbers only), with the hospital's targets and whether they were met; a doctor
// signs off a finished month and its rows are kept as they were. DRAFT definitions until the manual pages are given.

const DEPTS = [
  ['obstetrics', 'Obstetrics'],
  ['newborn', 'Newborn'],
  ['theatre', 'Theatre and anaesthesia'],
  ['safety', 'Safety'],
];
/** A row's value in words: a count, a percentage or a rate per 1000. */
export function valueWords(def, r) {
  if (r.value == null) return r.denominator === 0 ? 'None this month' : '–';
  if (def.unit === 'percent') return `${r.value}%`;
  if (def.unit === 'per1000') return `${r.value} per 1000`;
  return formatNumber(r.value);
}
const unitWord = (def) => (def.unit === 'percent' ? '%' : def.unit === 'per1000' ? ' per 1000' : '');
export const TARGET_LOOK = {
  met: { tone: 'stable', icon: CircleCheck, word: 'Target met' },
  missed: { tone: 'high', icon: TriangleAlert, word: 'Target missed' },
};

function TargetDialog({ def, row, onDone, onCancel }) {
  const [value, setValue] = useState(row.target == null ? '' : String(row.target));
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api('/dashboards/targets', { method: 'PUT', body: { key: def.key, target: value === '' ? null : Number(value) } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="db-target" title={`Target: ${def.label}`} submitLabel="Save the target" onSubmit={submit} onCancel={onCancel}>
      <p>{`${def.better === 'higher' ? 'At least' : 'At most'} this value is met. Leave it empty for no target.`}</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label={`Target${unitWord(def) ? ` (${unitWord(def).trim()})` : ''}`} id="db-tval" error={error?.fields?.target}>
        <input id="db-tval" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function SignoffDialog({ department, month, onDone, onCancel }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api('/dashboards/signoff', { method: 'POST', body: { department, month, comment } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="db-sign" title={`Sign off ${monthWords(month)}`} submitLabel="Sign off" onSubmit={submit} onCancel={onCancel}>
      <p>The numbers are kept as they are now. Records typed in later change the live numbers, not the signed-off ones.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Comment (optional)" id="db-comment" error={error?.fields?.comment}>
        <textarea id="db-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function DashboardsPage() {
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const department = DEPTS.some(([k]) => k === params.get('department')) ? params.get('department') : 'obstetrics';
  const { data, error, reload } = useFetch('/dashboards', { department, month });
  const [targeting, setTargeting] = useState(null);
  const [signing, setSigning] = useState(false);
  const [showSigned, setShowSigned] = useState(true);
  const set = (changes) => setParams({ month, department, ...changes }, { replace: true });
  const ready = data?.month === month && data?.department === department;
  const signed = ready && data.signoff;
  const rows = ready ? (signed && showSigned ? data.signoff.rows : data.rows) : [];
  const defs = new Map((data?.definitions ?? []).map((d) => [d.key, d]));

  return (
    <>
      <PageHeader title="Clinical audit" documentTitle="Monthly dashboards" subtitle="Each department's month in numbers, from what Perinexa records, with the hospital's targets and the lead's sign-off." tabs={QUALITY_TABS} />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="db-month">
            <input id="db-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && set({ month: e.target.value })} />
          </Field>
        </div>
        <ShowChoice label="Department" options={DEPTS} value={department} onChange={(k) => set({ department: k })} />
        {month === thisMonth() && <p className="hint">This month is not over yet: the numbers grow until its last day, and it can be signed off after.</p>}
        {signed && (
          <Alert type="info" icon={BadgeCheck}>
            {`Signed off by ${data.signoff.byName} on ${formatDateTime(data.signoff.at)}${data.signoff.comment ? ` – ${data.signoff.comment}` : ''}`}
          </Alert>
        )}
        {signed && <ShowChoice label="Which numbers" options={[['signed', 'As signed off'], ['live', 'Live numbers now']]} value={showSigned ? 'signed' : 'live'} onChange={(k) => setShowSigned(k === 'signed')} />}
        <section className="card" aria-labelledby="db-title">
          <h2 id="db-title">{`${data?.departments?.[department] ?? ''} – ${monthWords(month)}`}</h2>
          {!ready && <p className="muted">Loading…</p>}
          {ready && (
            <div className="an-table-wrap">
              <table className="ca-table">
                <thead>
                  <tr>
                    <th scope="col">Indicator</th>
                    <th scope="col" className="num">This month</th>
                    <th scope="col" className="num">Out of</th>
                    <th scope="col">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const def = defs.get(r.key);
                    if (!def) return null;
                    const look = TARGET_LOOK[r.status];
                    return (
                      <tr key={r.key}>
                        <th scope="row">
                          {def.label}
                          <span className="ca-group-words">{def.definition}</span>
                        </th>
                        <td data-label="This month" className="num">
                          {valueWords(def, r)}
                        </td>
                        <td data-label="Out of" className="num">
                          {r.denominator != null ? `${formatNumber(r.numerator)} of ${formatNumber(r.denominator)}` : '–'}
                        </td>
                        <td data-label="Target">
                          {!def.better ? (
                            <span className="muted">Counted, not judged</span>
                          ) : (
                            <span className="row">
                              {r.target == null ? (
                                <StatusPill tone="neutral" icon={Minus}>
                                  No target
                                </StatusPill>
                              ) : look ? (
                                <StatusPill tone={look.tone} icon={look.icon}>{`${look.word} (${def.better === 'higher' ? 'at least' : 'at most'} ${r.target}${unitWord(def)})`}</StatusPill>
                              ) : (
                                <span>{`${def.better === 'higher' ? 'At least' : 'At most'} ${r.target}${unitWord(def)}`}</span>
                              )}
                              {data.access.setTargets && !(signed && showSigned) && (
                                <button type="button" className="btn btn-link btn-sm" onClick={() => setTargeting({ def, row: r })}>
                                  {r.target == null ? 'Set' : 'Change'}
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {ready && data.access.signOff && (
            <div className="row">
              <button type="button" className="btn btn-positive" onClick={() => setSigning(true)}>
                <BadgeCheck aria-hidden="true" /> {`Sign off ${monthWords(month)}`}
              </button>
            </div>
          )}
          {ready && <p className="muted small">{`DRAFT definitions until the manual pages (OBG-A-05, NEO-A-05, ANA-A-06) are given and the leads confirm them. Sources: ${data.source}.`}</p>}
        </section>
      </div>
      {targeting && (
        <TargetDialog
          def={targeting.def}
          row={targeting.row}
          onCancel={() => setTargeting(null)}
          onDone={() => {
            setTargeting(null);
            reload();
          }}
        />
      )}
      {signing && (
        <SignoffDialog
          department={department}
          month={month}
          onCancel={() => setSigning(false)}
          onDone={() => {
            setSigning(false);
            reload();
          }}
        />
      )}
    </>
  );
}
