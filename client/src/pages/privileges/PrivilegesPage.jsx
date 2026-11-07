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
      <div className="pf-content pv-page">
        <Alert type="error">{error}</Alert>
        {data && (
          <div className="pv-toolbar">
            <h2>{`Staff · ${data.staff.length}`}</h2>
            <label className="check">
              <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended and lapsed privileges
            </label>
          </div>
        )}
        {data && data.staff.length === 0 && <p className="muted">No doctors, RMOs or nurses in this hospital yet.</p>}
        <div className="pv-grid">
          {data?.staff.map((s) => {
            const list = s.privileges.filter((p) => showEnded || p.state === 'in_force');
            const inForce = s.privileges.filter((p) => p.state === 'in_force').length;
            return (
              <section key={s.id} className="card pv-card" aria-label={s.name}>
                <div className="pv-card-head">
                  <span className="pv-person">
                    <strong>{s.name}</strong>
                    <span className="hint">{s.roles.map((r) => ROLE_WORDS[r]).join(', ')}</span>
                  </span>
                  <StatusPill tone={inForce ? 'stable' : 'neutral'} icon={inForce ? BadgeCheck : CircleSlash}>
                    {inForce ? `${inForce} in force` : 'None in force'}
                  </StatusPill>
                </div>
                {list.length === 0 ? (
                  <p className="muted pv-empty">No privileges recorded.</p>
                ) : (
                  <ul className="plain-list pv-rows">
                    {list.map((p) => {
                      const look = PRIVILEGE_LOOK[p.state];
                      return (
                        <li key={p.id} className="pv-row">
                          <span className="pv-row-text">
                            <strong>{p.label}</strong>
                            <span className="hint">{[p.validUntil ? `Until ${formatDate(p.validUntil)}` : 'No end date', p.note].filter(Boolean).join(' · ')}</span>
                            <span className="hint">{`Granted by ${p.byName}, ${formatDateTime(p.at)}`}</span>
                            {p.ended && <span className="hint">{`Ended by ${p.ended.byName}, ${formatDateTime(p.ended.at)}: ${p.ended.reason}`}</span>}
                          </span>
                          <span className="pv-row-side">
                            <StatusPill tone={look.tone} icon={look.icon}>
                              {look.word}
                            </StatusPill>
                            {keep && p.state !== 'ended' && (
                              <button type="button" className="btn btn-link btn-sm" onClick={() => setEnding(p)}>
                                End
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        {data && <p className="muted small">{`${data.rules.source}. The legal registrations (MTP Act, PC-PNDT, ART Act) remain the hospital's own duty.`}</p>}
      </div>
      {granting && <GrantDialog staff={data.staff} rules={data.rules} onDone={done} onCancel={() => setGranting(false)} />}
      {ending && <EndDialog privilege={ending} onDone={done} onCancel={() => setEnding(null)} />}
    </>
  );
}
