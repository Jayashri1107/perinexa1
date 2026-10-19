import { useState } from 'react';
import { Ban, Check, FileText, Handshake, Pencil, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable, FilterSelect, SearchInput, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, Field, StatusPill, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { showWhatsappNumber, whatsappNumber } from '../visits/whatsapp.js';

// The doctors who refer patients to the hospital (docs/REFERRALS_PLAN.md): their clinic, WhatsApp number (the desk
// sends the replies and notes there by hand), registration number and which parts of the partner programme they
// joined. Never deleted – made inactive, so their old referrals keep their name. Each has a quarterly summary.

const PARTNER = [
  { key: 'joined', label: 'Clinical partner' },
  { key: 'quarterlySummary', label: 'Quarterly summary' },
  { key: 'caseOfMonth', label: 'Case of the Month' },
  { key: 'cme', label: 'CME invitations' },
];
const TEXT_FIELDS = [
  { key: 'name', label: 'Name', max: 150, hint: 'As she writes it, e.g. "Dr. A. Sample"' },
  { key: 'qualification', label: 'Qualification', max: 150 },
  { key: 'clinic', label: 'Clinic or hospital', max: 150 },
  { key: 'area', label: 'Area or town', max: 150 },
  { key: 'phone', label: 'WhatsApp number', max: 30, type: 'tel', hint: 'The replies and notes are sent to this number from the desk’s WhatsApp' },
  { key: 'email', label: 'Email (optional)', max: 150, type: 'email' },
  { key: 'registrationNumber', label: 'Registration number (optional)', max: 60 },
];

const blank = () => ({ name: '', qualification: '', clinic: '', area: '', phone: '', email: '', registrationNumber: '', notes: '', partner: { joined: false, caseOfMonth: false, cme: false, quarterlySummary: false }, isActive: true });
const formOf = (d) => ({ ...blank(), ...Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => k in blank())), partner: { ...blank().partner, ...(d?.partner ?? {}) } });

/** Add or edit a referring doctor (also opened from a new referral). onSaved(doctor). */
export function ReferringDoctorDialog({ doctor = null, onSaved, onCancel }) {
  const [form, setForm] = useState(() => formOf(doctor));
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const number = whatsappNumber(form.phone);
  const save = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setFields({ name: 'Write the doctor’s name.' });
    setSaving(true);
    setError(null);
    setFields({});
    const body = { ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) };
    if (!doctor) delete body.isActive; // a new doctor is active
    try {
      const res = await api(doctor ? `/referring-doctors/${doctor.id}` : '/referring-doctors', { method: doctor ? 'PUT' : 'POST', body });
      onSaved(res.doctor);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rd-dialog-title" onSubmit={save} noValidate>
        <h2 id="rd-dialog-title">{doctor ? `Edit ${doctor.name}` : 'Add a referring doctor'}</h2>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} id={`rd-${f.key}`} error={fields[f.key]} hint={f.key === 'phone' && form.phone.trim() && !number ? 'This is not a mobile number WhatsApp can open – check it.' : f.hint} keepHint={f.key === 'phone' && Boolean(form.phone.trim()) && !number}>
              <input id={`rd-${f.key}`} type={f.type ?? 'text'} maxLength={f.max} value={form[f.key]} onChange={set(f.key)} autoFocus={f.key === 'name'} />
            </Field>
          ))}
        </div>
        <Field label="Notes (optional)" id="rd-notes" error={fields.notes} hint="For the desk, e.g. the best time to call. Nothing about a patient.">
          <textarea id="rd-notes" rows={2} maxLength={500} value={form.notes} onChange={set('notes')} />
        </Field>
        <fieldset className="fieldset">
          <legend>Partner programme</legend>
          <div className="check-grid">
            {PARTNER.map((p) => (
              <label key={p.key} className="checkbox" htmlFor={`rd-partner-${p.key}`}>
                <input id={`rd-partner-${p.key}`} type="checkbox" checked={Boolean(form.partner[p.key])} onChange={(e) => setForm((f) => ({ ...f, partner: { ...f.partner, [p.key]: e.target.checked } }))} /> {p.label}
              </label>
            ))}
          </div>
          <p className="hint help">Case of the Month and CME invitations are only recorded for now; the app does not send them.</p>
        </fieldset>
        {doctor && (
          <label className="checkbox" htmlFor="rd-active">
            <input id="rd-active" type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active (new referrals can name this doctor)
          </label>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : doctor ? 'Save' : 'Add the doctor'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReferringDoctorsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const active = params.get('active') ?? 'true';
  const { data, error, loading, reload } = useFetch('/referring-doctors', { search, active: active === 'all' ? '' : active });
  const [dialog, setDialog] = useState(null); // { doctor } | 'new'
  const [notice, setNotice] = useState(null);
  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const columns = [
    {
      key: 'name',
      header: 'Doctor',
      render: (d) => (
        <span className="name-cell">
          <Avatar name={d.name} seed={d.id} />
          <span className="name-cell-text">
            <strong>{d.name}</strong>
            {d.qualification && <span className="muted">{d.qualification}</span>}
          </span>
        </span>
      ),
    },
    {
      key: 'clinic',
      header: 'Clinic',
      render: (d) => (
        <span className="name-cell-text">
          <span>{d.clinic || '—'}</span>
          {d.area && <span className="muted">{d.area}</span>}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'WhatsApp',
      render: (d) => {
        const n = whatsappNumber(d.phone);
        return n ? <span className="tabular nowrap">{showWhatsappNumber(n)}</span> : <span className="muted">{d.phone ? `${d.phone} (not a mobile number)` : 'Not given'}</span>;
      },
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (d) =>
        d.partner?.joined ? (
          <span className="wl-counts">
            <StatusPill tone="brand" icon={Handshake}>
              Clinical partner
            </StatusPill>

          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'referrals',
      header: 'Referrals',
      align: 'right',
      render: (d) => (d.referrals ? <Link to={`/referrals?doctor=${d.id}&list=all`} className="tabular">{formatNumber(d.referrals)}</Link> : <span className="tabular muted">0</span>),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) =>
        d.isActive ? (
          <StatusPill tone="stable" icon={Check}>
            Active
          </StatusPill>
        ) : (
          <StatusPill tone="inactive" icon={Ban}>
            Inactive
          </StatusPill>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (d) => (
        <span className="row-actions">
          <Link to={`/referrals/doctors/${d.id}/summary`} className="btn btn-link btn-sm" aria-label={`Quarterly summary for ${d.name}`}>
            <FileText aria-hidden="true" /> Summary
          </Link>
          <button type="button" className="icon-btn" onClick={() => setDialog({ doctor: d })} aria-label={`Edit ${d.name}`} title="Edit">
            <Pencil aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Referring doctors"
        help="The doctors who send patients to the hospital. Their WhatsApp number is where the desk sends the replies and, with the patient’s Yes, the consultant notes and discharge summaries."
        tabs={moduleByKey('referrals')?.tabs}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDialog('new')}>
            <UserPlus aria-hidden="true" /> Add a referring doctor
          </button>
        }
      />
      <div className="pf-content appt-page">
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{error}</Alert>
        <DataTable
          caption="Referring doctors"
          columns={columns}
          rows={data?.doctors}
          loading={loading}
          emptyText={search ? 'No referring doctor matches the search.' : 'No referring doctors yet. Add the first with “Add a referring doctor”.'}
          rowClassName={(d) => (d.isActive ? '' : 'row-inactive')}
          toolbar={
            <>
              <SearchInput value={search} onChange={(v) => setParam('search', v, '')} placeholder="Name, clinic, area or phone" label="Search referring doctors" />
              <FilterSelect
                label="Show"
                value={active}
                onChange={(v) => setParam('active', v, 'true')}
                allLabel={null}
                options={[
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Inactive' },
                  { value: 'all', label: 'All' },
                ]}
              />
            </>
          }
        />
      </div>
      {dialog && (
        <ReferringDoctorDialog
          doctor={dialog === 'new' ? null : dialog.doctor}
          onCancel={() => setDialog(null)}
          onSaved={(d) => {
            setNotice(dialog === 'new' ? `${d.name} was added.` : `${d.name} was saved.`);
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}
