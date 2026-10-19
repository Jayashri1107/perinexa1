import { useState } from 'react';
import { CircleCheck, CircleSlash, Pencil, Plus } from 'lucide-react';
import { api } from '../../api.js';
import { DataTable, usePagedRows } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal } from '../billing/billingUi.jsx';

// Lab → Referrers (Lab version 2 – docs/LAB_V2_PLAN.md): the doctors and centres who refer walk-in patients, chosen on a
// walk-in order and printed on its report. No money is recorded for a referrer – commissions are not allowed.
// Laid out as a table with search and pages, adding and changing in a dialog (owner, 19 Oct 2026).

const EMPTY = { kind: 'doctor', name: '', qualification: '', registrationNumber: '', phone: '', address: '', active: true };

function ReferrerDialog({ referrer, onClose, onSaved }) {
  const [form, setForm] = useState(referrer ?? EMPTY);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { id, ...body } = form;
      await api(id ? `/lab-setup/referrers/${id}` : '/lab-setup/referrers', { method: id ? 'PUT' : 'POST', body });
      onSaved(id ? `${form.name} saved.` : `${form.name} added.`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="rf" title={referrer ? 'Change the referrer' : 'Add a referrer'} wide onClose={onClose}>
      <form onSubmit={save} noValidate>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Doctor or centre" id="rf-kind">
            <select id="rf-kind" value={form.kind} onChange={set('kind')}>
              <option value="doctor">Doctor</option>
              <option value="centre">Centre (clinic, hospital, collection centre)</option>
            </select>
          </Field>
          <Field label="Name" id="rf-name" error={fields.name}>
            <input id="rf-name" maxLength={120} value={form.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="Qualification" id="rf-q">
            <input id="rf-q" maxLength={80} value={form.qualification} onChange={set('qualification')} />
          </Field>
          <Field label="Registration number" id="rf-reg">
            <input id="rf-reg" maxLength={40} value={form.registrationNumber} onChange={set('registrationNumber')} />
          </Field>
          <Field label="Phone" id="rf-ph" error={fields.phone}>
            <input id="rf-ph" maxLength={20} value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Address" id="rf-addr">
            <input id="rf-addr" maxLength={200} value={form.address} onChange={set('address')} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={set('active')} /> In use (offered on new orders)
        </label>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || form.name.trim().length < 2}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LabReferrersPage() {
  const { data, error, loading, reload } = useFetch('/lab-setup/referrers');
  const [editing, setEditing] = useState(null); // 'new' | a referrer
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase();
  const rows = data?.referrers.filter((r) => !words || [r.name, r.qualification, r.phone, r.address].join(' ').toLowerCase().includes(words));
  const { shown, pager } = usePagedRows(rows, { label: 'referrers' });
  const columns = [
    { key: 'name', header: 'Name', render: (r) => <strong>{r.name}</strong> },
    { key: 'kind', header: 'Type', render: (r) => (r.kind === 'centre' ? 'Centre' : 'Doctor') },
    { key: 'qualification', header: 'Qualification', render: (r) => r.qualification || '–' },
    { key: 'reg', header: 'Registration no.', render: (r) => r.registrationNumber || '–' },
    { key: 'phone', header: 'Phone', render: (r) => <span className="tabular">{r.phone || '–'}</span> },
    { key: 'address', header: 'Address', render: (r) => r.address || '–' },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.active ? (
          <StatusPill tone="stable" icon={CircleCheck}>
            In use
          </StatusPill>
        ) : (
          <StatusPill tone="inactive" icon={CircleSlash}>
            Not in use
          </StatusPill>
        ),
    },
    ...(data?.canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (r) => (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(r)} aria-label={`Change ${r.name}`}>
                <Pencil aria-hidden="true" /> Change
              </button>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Referrers"
        documentTitle="Lab referrers"
        help="Doctors and centres who send patients to the lab. Chosen on a walk-in order and printed on its report. No commissions are recorded."
        actions={
          data?.canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" /> Add a referrer
            </button>
          )
        }
      />
      <div className="pf-content lab-tables">
        <Alert type="error">{error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <DataTable
          caption="Referrers"
          columns={columns}
          rows={shown}
          loading={loading}
          emptyText={words ? 'No referrer matches.' : 'No referrers yet. Add the doctors and centres who send patients.'}
          toolbar={
            <label className="lab-filter" htmlFor="rf-find">
              <span>Find</span>
              <input id="rf-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or place" />
            </label>
          }
          footer={pager}
        />
      </div>
      {editing && (
        <ReferrerDialog
          referrer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            reload();
          }}
        />
      )}
    </>
  );
}
