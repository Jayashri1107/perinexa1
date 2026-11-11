import { useState } from 'react';
import { BadgeCheck, CircleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_FORMULARY } from '../../platform/modules.js';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';

// The formulary (Clinical Requirements Group A, item 7 – one formulary, verified once). Doctors and the pharmacist write
// rows; a doctor and the pharmacist each confirm a version, and only then is a dose worked out from it. Any change
// makes it unverified again. Starts empty: the department leads and the pharmacist fill it in.

export const POPULATION_LABELS = { adult: 'Adult', obstetric: 'Pregnancy and after delivery', paediatric: 'Child', neonatal: 'Newborn' };
const EMPTY = { name: '', form: '', strength: '', route: '', population: '', indication: '', doseBasis: 'per_kg', doseMg: '', frequency: '', maxSingleMg: '', maxDailyMg: '', highAlert: false, notes: '', source: '' };
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export function verifiedLook(item) {
  if (item.verified) return { tone: 'stable', icon: BadgeCheck, word: 'Verified' };
  const has = item.confirmations.map((c) => (c.role === 'doctor' ? 'doctor' : 'pharmacist'));
  return { tone: 'watch', icon: CircleAlert, word: has.length ? `Needs the ${has.includes('doctor') ? 'pharmacist' : 'doctor'}` : 'Not verified' };
}

function RowDialog({ item, onDone, onCancel }) {
  const [f, setF] = useState(() => (item ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, item[k] ?? EMPTY[k]])) : EMPTY));
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const fe = (k) => error?.fields?.[k];
  const submit = async () => {
    const body = { ...f, doseMg: Number(f.doseMg), maxSingleMg: numOrNull(f.maxSingleMg), maxDailyMg: numOrNull(f.maxDailyMg) };
    try {
      await api(item ? `/formulary/${item.id}` : '/formulary', { method: item ? 'PUT' : 'POST', body: item ? { ...body, version: item.version, isActive: true } : body });
      onDone(item ? 'Row changed – it needs both confirmations again.' : 'Row added – it needs a doctor and the pharmacist to confirm it.');
    } catch (err) {
      setError(err);
    }
  };
  const text = (k, label, max = 120) => (
    <Field label={label} id={`fm-${k}`} error={fe(k)}>
      <input id={`fm-${k}`} maxLength={max} value={f[k]} onChange={set(k)} />
    </Field>
  );
  return (
    <FormDialog id="fm-row" title={item ? `Change ${item.name}` : 'Add a formulary row'} submitLabel="Save" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <div className="form-grid">
        {text('name', 'Medicine (generic name)')}
        {text('form', 'Form (optional)', 60)}
        {text('strength', 'Strength (optional)', 80)}
        {text('route', 'Route (optional)', 40)}
        <Field label="For whom" id="fm-population" error={fe('population')}>
          <select id="fm-population" value={f.population} onChange={set('population')}>
            <option value="">Choose…</option>
            {Object.entries(POPULATION_LABELS).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        {text('indication', 'Indication (optional)', 200)}
        <Field label="Dose" id="fm-basis" error={fe('doseBasis')}>
          <select id="fm-basis" value={f.doseBasis} onChange={set('doseBasis')}>
            <option value="per_kg">mg per kg of weight</option>
            <option value="fixed">mg, fixed</option>
          </select>
        </Field>
        <Field label={f.doseBasis === 'per_kg' ? 'mg per kg per dose' : 'mg per dose'} id="fm-dose" error={fe('doseMg')}>
          <input id="fm-dose" inputMode="decimal" value={f.doseMg} onChange={set('doseMg')} />
        </Field>
        {text('frequency', 'How often (optional)', 80)}
        <Field label="Maximum single dose, mg (optional)" id="fm-maxs" error={fe('maxSingleMg')}>
          <input id="fm-maxs" inputMode="decimal" value={f.maxSingleMg ?? ''} onChange={set('maxSingleMg')} />
        </Field>
        <Field label="Maximum per day, mg (optional)" id="fm-maxd" error={fe('maxDailyMg')}>
          <input id="fm-maxd" inputMode="decimal" value={f.maxDailyMg ?? ''} onChange={set('maxDailyMg')} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.highAlert} onChange={set('highAlert')} /> High-alert medicine
        </label>
        {text('source', 'Source (manual page or reference)', 300)}
      </div>
    </FormDialog>
  );
}

function DoseDialog({ item, onCancel }) {
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      setResult((await api(`/formulary/${item.id}/dose`, { method: 'POST', body: { weightKg: Number(weight) } })).dose);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="fm-dose" title={`Dose of ${item.name}`} submitLabel="Work it out" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Weight – kg" id="fm-weight" error={error?.fields?.weightKg}>
        <input id="fm-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      {result && (
        <p aria-live="polite">
          <strong>{`${result.mg} mg per dose`}</strong>
          {result.frequency ? `, ${result.frequency}` : ''}
          {result.capped ? ' – the maximum single dose' : ''}
          {result.maxDailyMg != null ? ` · at most ${result.maxDailyMg} mg a day` : ''}
        </p>
      )}
      <p className="hint">{`From the verified row (version ${item.version}, ${item.source}). Check it against the patient before giving it.`}</p>
    </FormDialog>
  );
}

export function FormularyPage() {
  const { data, error, loading, reload } = useFetch('/formulary');
  const [open, setOpen] = useState(null); // { kind: 'row' | 'dose', item }
  const [notice, setNotice] = useState(null);
  const done = (text) => {
    setOpen(null);
    setNotice({ type: 'success', text });
    reload();
  };
  const confirm = async (item) => {
    try {
      const res = await api(`/formulary/${item.id}/confirm`, { method: 'POST', body: { version: item.version } });
      done(res.item.verified ? `${item.name} is verified.` : `Your confirmation of ${item.name} is saved.`);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
  };
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_FORMULARY.tabs}
        title="Formulary"
        documentTitle="Formulary"
        help="The hospital's formulary. A dose is worked out only from a row a doctor and the pharmacist have both confirmed; any change needs both again."
        actions={
          data?.editor && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen({ kind: 'row', item: null })}>
              Add a row
            </button>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {notice && (
          <Alert type={notice.type} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}
        <section className="card">
          <SimpleTable
            loading={loading && !data}
            rows={data?.items ?? []}
            emptyText="No rows yet. The department leads and the pharmacist fill in the formulary; until a row is verified, no dose is worked out from it."
            columns={[
              { key: 'name', header: 'Medicine', render: (i) => `${i.name}${i.strength ? ` ${i.strength}` : ''}${i.form ? ` (${i.form})` : ''}${i.highAlert ? ' · high-alert' : ''}` },
              { key: 'population', header: 'For', render: (i) => `${POPULATION_LABELS[i.population]}${i.indication ? ` · ${i.indication}` : ''}` },
              { key: 'dose', header: 'Dose', render: (i) => `${i.doseMg} mg${i.doseBasis === 'per_kg' ? '/kg' : ''}${i.frequency ? `, ${i.frequency}` : ''}` },
              {
                key: 'verified',
                header: 'Verified',
                render: (i) => {
                  const look = verifiedLook(i);
                  return (
                    <StatusPill tone={look.tone} icon={look.icon} title={i.confirmations.map((c) => `${c.byName} (${c.role})`).join(', ')}>
                      {look.word}
                    </StatusPill>
                  );
                },
              },
              {
                key: 'actions',
                header: '',
                render: (i) => (
                  <span className="row">
                    {i.verified && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen({ kind: 'dose', item: i })}>
                        Work out a dose
                      </button>
                    )}
                    {data.editor && !i.verified && !i.confirmations.some((c) => c.mine) && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => confirm(i)}>
                        Confirm
                      </button>
                    )}
                    {data.editor && (
                      <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen({ kind: 'row', item: i })}>
                        Change
                      </button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </section>
      </div>
      {open?.kind === 'row' && <RowDialog item={open.item} onDone={done} onCancel={() => setOpen(null)} />}
      {open?.kind === 'dose' && <DoseDialog item={open.item} onCancel={() => setOpen(null)} />}
    </>
  );
}
