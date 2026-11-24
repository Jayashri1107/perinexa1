import { useState } from 'react';
import { CircleCheck, FilePen, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, FieldError, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_PAYROLL } from '../../platform/modules.js';
import { RATE_GROUPS, RATE_WORDS, SLAB_KEYS, earlierLine, rateBody, rateDraft, rateForm, rateLines } from './payFormat.js';

// Payroll → Rates (Stage C, docs/PAYROLL_BUILD_NOTE.md section 8): the hospital's rate table – PF, ESI, professional
// tax. LEGAL CONTENT: the figures a hospital starts with are the DRAFT table of the note, from general knowledge.
// The hospital admin types what the accountant says and writes the accountant's name and the date; until then a
// group is marked DRAFT, and a month that uses it can't be locked. The accounts login reads this page.

const MAX_ROWS = 8;
const SLAB_TITLES = { men: 'Men', women: 'Women' };

function Status({ group }) {
  if (rateDraft(group)) {
    return (
      <StatusPill tone="watch" icon={FilePen}>
        DRAFT – not confirmed by the accountant
      </StatusPill>
    );
  }
  return <StatusPill tone="stable" icon={CircleCheck}>{`Confirmed by ${group.confirmedBy}, ${formatDate(group.confirmedOn)} – applies from ${formatDate(group.from)}`}</StatusPill>;
}

/** One table of professional tax slabs: "up to" and the tax a row; the last row is everything above. */
function Slabs({ id, title, rows, error, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="pr-slabs">
      <h3 className="pr-sub">{title}</h3>
      <FieldError role="alert">{error}</FieldError>
      <div className="an-table-wrap">
        <table className="ca-table pr-slab-table">
          <thead>
            <tr>
              <th scope="col">Monthly pay up to (₹)</th>
              <th scope="col">Tax a month (₹)</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              return (
                <tr key={i}>
                  <td data-label="Monthly pay up to (₹)">{last ? <span className="muted">Everything above</span> : <input inputMode="decimal" aria-label={`${title}, row ${i + 1}: pay up to`} value={r.upTo} onChange={(e) => set(i, { upTo: e.target.value })} />}</td>
                  <td data-label="Tax a month (₹)">
                    <input inputMode="decimal" aria-label={`${title}, row ${i + 1}: tax`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                  </td>
                  <td>
                    {!last && rows.length > 1 && (
                      <button type="button" className="icon-btn" aria-label={`Remove row ${i + 1} of ${title}`} title="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length < MAX_ROWS && (
        <button type="button" className="btn btn-secondary btn-sm" id={`${id}-add`} onClick={() => onChange([...rows.slice(0, -1), { upTo: '', amount: '' }, rows[rows.length - 1]])}>
          <Plus aria-hidden="true" /> Add a slab
        </button>
      )}
    </div>
  );
}

function RateCard({ name, group, canChange, onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const v = form ?? rateForm(name, group);
  const fe = (k) => error?.fields?.[k];
  const id = `pr-rate-${name}`;
  // A changed figure is not what the accountant confirmed: the tick is taken off and must be set again
  const figure = (patch) => setForm({ ...v, ...patch, confirmed: false });
  const who = (patch) => setForm({ ...v, ...patch });
  const save = async () => {
    const { body, errors } = rateBody(name, v);
    if (Object.keys(errors).length) {
      setError({ message: 'Please check the highlighted boxes.', fields: errors });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await api(`/payroll/rates/${name}`, { method: 'PUT', body });
      setForm(null);
      onSaved(answer, answer.changed ? `${RATE_WORDS[name]}: saved.` : `${RATE_WORDS[name]}: nothing was changed.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{RATE_WORDS[name]}</h2>
      <p className="pr-rate-status">
        <Status group={group} />
      </p>
      {group.earlier?.length > 0 && (
        <>
          <h3 className="pr-sub">Confirmed before – still used for their months</h3>
          {rateDraft(group) && <p className="hint">The figures in the boxes are DRAFT and are used by no month yet: every month from the dates below is worked out with these confirmed figures.</p>}
          <ul className="pr-rate-lines">
            {group.earlier.map((set) => (
              <li key={set.from}>{earlierLine(name, set, formatDate)}</li>
            ))}
          </ul>
        </>
      )}
      {!canChange && (
        <ul className="pr-rate-lines">
          {rateLines(name, group).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {canChange && (
        <>
          <Alert type="error">{error?.message}</Alert>
          {name === 'pt' ? (
            <>
              <p className="hint">Professional tax differs by state. Each table: the monthly pay up to a figure pays the tax beside it; the last row is everything above.</p>
              <div className="pr-slab-pair">
                {SLAB_KEYS.map((k) => (
                  <Slabs key={k} id={`${id}-${k}`} title={SLAB_TITLES[k]} rows={v.slabs[k]} error={fe(`slabs.${k}`)} onChange={(rows) => figure({ slabs: { ...v.slabs, [k]: rows } })} />
                ))}
              </div>
              <div className="form-grid">
                <Field label="Top slab in February (₹)" id={`${id}-feb`} error={fe('februaryPaise')} hint="The month in which the top slab pays a different amount.">
                  <input id={`${id}-feb`} inputMode="decimal" value={v.february} onChange={(e) => figure({ february: e.target.value })} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <Field label="Staff share (%)" id={`${id}-staff`} error={fe('staffPercent')}>
                  <input id={`${id}-staff`} inputMode="decimal" value={v.staffPercent} onChange={(e) => figure({ staffPercent: e.target.value })} />
                </Field>
                <Field label="Hospital’s share (%)" id={`${id}-emp`} error={fe('employerPercent')} hint="Shown on the register and the lists – never taken from the take-home.">
                  <input id={`${id}-emp`} inputMode="decimal" value={v.employerPercent} onChange={(e) => figure({ employerPercent: e.target.value })} />
                </Field>
                <Field label="Pay limit a month (₹)" id={`${id}-limit`} error={fe('limitPaise')}>
                  <input id={`${id}-limit`} inputMode="decimal" value={v.limit} onChange={(e) => figure({ limit: e.target.value })} />
                </Field>
              </div>
              {name === 'pf' && (
                <label className="check">
                  <input type="checkbox" checked={v.capAtLimit} onChange={(e) => figure({ capAtLimit: e.target.checked })} /> Work PF out on no more than the pay limit
                </label>
              )}
              {name === 'esi' && <p className="hint">A person whose monthly pay is above the limit is only marked on the sheet: whether ESI applies to a person is ticked on their pay (Payroll → Staff).</p>}
            </>
          )}

          <h3 className="pr-sub">The accountant’s confirmation</h3>
          <label className="check">
            <input type="checkbox" checked={v.confirmed} onChange={(e) => who({ confirmed: e.target.checked })} /> The accountant has confirmed exactly these figures
          </label>
          {v.confirmed && (
            <div className="form-grid">
              <Field label="Accountant’s name" id={`${id}-by`} error={fe('confirmedBy')}>
                <input id={`${id}-by`} value={v.confirmedBy} maxLength={120} onChange={(e) => who({ confirmedBy: e.target.value })} />
              </Field>
              <Field label="Confirmed on" id={`${id}-on`} error={fe('confirmedOn')}>
                <input id={`${id}-on`} type="date" value={v.confirmedOn} onChange={(e) => who({ confirmedOn: e.target.value })} />
              </Field>
              <Field label="The figures apply from" id={`${id}-from`} error={fe('from')} hint="A month before this date uses them as DRAFT.">
                <input id={`${id}-from`} type="date" value={v.from} onChange={(e) => who({ from: e.target.value })} />
              </Field>
            </div>
          )}
          {!v.confirmed && <p className="hint">Not ticked: these figures are saved as DRAFT. A month that uses them can be looked at and printed as “DRAFT – not for payment”, and can’t be locked.</p>}
          {group.updatedByName && <p className="hint">{`Last changed by ${group.updatedByName}, ${formatDateTime(group.updatedAt)}.`}</p>}
          <button type="button" className="btn btn-primary" disabled={!form || busy} onClick={save}>
            <Save aria-hidden="true" /> {busy ? 'Saving…' : `Save ${RATE_WORDS[name]}`}
          </button>
        </>
      )}
    </section>
  );
}

export function PayrollRatesPage() {
  const res = useFetch('/payroll/rates');
  const [saved, setSaved] = useState(null); // the table as the last save answered it
  const [notice, setNotice] = useState(null);
  const data = saved ?? res.data;
  const rates = data?.rates;
  const drafts = rates ? RATE_GROUPS.filter((g) => rateDraft(rates[g])) : [];
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        title="Rates"
        documentTitle="Payroll rates"
        help="PF, ESI and professional tax, as the hospital’s accountant gives them. The hospital admin changes them; the accounts login reads them."
        badges={
          rates &&
          (drafts.length ? (
            <StatusPill tone="watch" icon={FilePen}>{`DRAFT: ${drafts.map((g) => RATE_WORDS[g]).join(', ')}`}</StatusPill>
          ) : (
            <StatusPill tone="stable" icon={CircleCheck}>
              All rates confirmed
            </StatusPill>
          ))
        }
      />
      <div className="pf-content pr-page">
        <Alert type="error">{res.error}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {rates && drafts.length > 0 && (
          <Alert type="warning">
            <strong>DRAFT figures – not checked.</strong> The figures marked DRAFT are from general knowledge, not from the current government notifications. They are here so the accountant has something to correct. A month that uses a DRAFT rate can be looked at and printed as “DRAFT – not for payment”; it can’t be locked.
          </Alert>
        )}
        {rates && !data.canChange && <Alert type="info">Only the hospital admin changes the rates. Tell the admin what the accountant said if a figure here is not right.</Alert>}
        {rates &&
          RATE_GROUPS.map((g) => (
            <RateCard
              key={g}
              name={g}
              group={rates[g]}
              canChange={data.canChange === true}
              onSaved={(answer, text) => {
                setSaved(answer);
                setNotice(text);
              }}
            />
          ))}
        {!rates && !res.error && <p className="muted">Loading…</p>}
      </div>
    </>
  );
}
