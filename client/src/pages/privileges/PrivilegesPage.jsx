import { useState } from 'react';
import { BadgeCheck, CircleSlash, Clock } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';

// Clinical privileges (Clinical Requirements Group C – PX-X-07, DRAFT list): each doctor, RMO and nurse with the
// procedures the hospital allows them to do. The hospital admin and the quality lead grant and end them; doctors, RMOs
// and nurses read the register. No patient data.

export { PRIVILEGE_ROLES } from './privilegeRoles.js';
export const PRIVILEGE_LOOK = {
  in_force: { tone: 'stable', icon: BadgeCheck, word: 'In force' },
  lapsed: { tone: 'watch', icon: Clock, word: 'Lapsed' },
  ended: { tone: 'inactive', icon: CircleSlash, word: 'Ended' },
};
const ROLE_WORDS = { doctor: 'Doctor', rmo: 'RMO', nurse: 'Nurse' };

function GrantDialog({ staff, rules, onDone, onCancel }) {
  const [f, setF] = useState({ userId: '', key: '', validUntil: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const law = rules.privileges[f.key]?.law;
  const submit = async () => {
    setBusy(true);
    try {
      await api('/privileges', { method: 'POST', body: f });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pv-grant" title="Grant a privilege" submitLabel="Grant the privilege" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields ? null : error?.message}</Alert>
      <div className="form-grid">
        <Field label="Member of staff" id="pv-user" error={error?.fields?.userId}>
          <select id="pv-user" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            <option value="">Choose…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.name} (${s.roles.map((r) => ROLE_WORDS[r]).join(', ')})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Privilege" id="pv-key" error={error?.fields?.key} hint={law} keepHint>
          <select id="pv-key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(rules.privileges).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Until (last day, optional)" id="pv-until" error={error?.fields?.validUntil}>
          <input id="pv-until" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
        </Field>
        <Field label="Note" id="pv-note" error={error?.fields?.note}>
          <input id="pv-note" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </FormDialog>
  );
}

function EndDialog({ privilege, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/privileges/${privilege.id}/end`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="pv-end" title={`End the privilege – ${privilege.label}`} submitLabel="End the privilege" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields ? null : error?.message}</Alert>
      <Field label="Why it ends" id="pv-reason" error={error?.fields?.reason}>
        <input id="pv-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function PrivilegesPage() {
  const { data, error, reload } = useFetch('/privileges');
  const [granting, setGranting] = useState(false);
  const [ending, setEnding] = useState(null);
  const [showEnded, setShowEnded] = useState(false);
  const keep = data?.access?.keep;
  const done = () => {
    setGranting(false);
    setEnding(null);
    reload();
  };
  return (
    <>
      <PageHeader
        title="Clinical privileges"
        documentTitle="Clinical privileges"
        subtitle="Which procedures the hospital allows each doctor, RMO and nurse to do. The theatre case shows whether the surgeon and the anaesthetist hold the privilege."
        actions={
          keep && (
            <button type="button" className="btn btn-primary" onClick={() => setGranting(true)}>
              Grant a privilege
            </button>
          )
        }
      />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        {data && <p className="hint">{`${data.rules.source}. The legal registrations (MTP Act, PC-PNDT, ART Act) remain the hospital's own duty.`}</p>}
        {data && (
          <label className="check">
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended and lapsed privileges
          </label>
        )}
        {data?.staff.map((s) => {
          const list = s.privileges.filter((p) => showEnded || p.state === 'in_force');
          return (
            <section key={s.id} className="card">
              <h2>{`${s.name} · ${s.roles.map((r) => ROLE_WORDS[r]).join(', ')}`}</h2>
              {list.length === 0 && <p className="muted">No privileges recorded.</p>}
              <ul className="pa-list">
                {list.map((p) => {
                  const look = PRIVILEGE_LOOK[p.state];
                  return (
                    <li key={p.id}>
                      <StatusPill tone={look.tone} icon={look.icon}>
                        {look.word}
                      </StatusPill>
                      <strong>{p.label}</strong>
                      <span>
                        {[p.validUntil ? `until ${formatDate(p.validUntil)}` : 'no end date', p.note, `granted by ${p.byName}, ${formatDateTime(p.at)}`, p.ended && `ended by ${p.ended.byName}, ${formatDateTime(p.ended.at)}: ${p.ended.reason}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {keep && p.state !== 'ended' && (
                        <button type="button" className="btn btn-link" onClick={() => setEnding(p)}>
                          End
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {granting && <GrantDialog staff={data.staff} rules={data.rules} onDone={done} onCancel={() => setGranting(false)} />}
      {ending && <EndDialog privilege={ending} onDone={done} onCancel={() => setEnding(null)} />}
    </>
  );
}
