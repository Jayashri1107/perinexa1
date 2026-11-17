import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Hospital admin → Support access (health check H3; owner's decision of 17 Nov 2026). Perinexa's own staff (super
// admins, platform admins) open this hospital's patient records only while its admin allows it: for a stated reason and
// a few hours, ended early at any time. Both are in the audit log, and so is every record they open meanwhile.
export function SupportAccessPage() {
  const res = useFetch('/tenant/settings/support-access');
  const [hours, setHours] = useState(2);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const d = data ?? res.data;
  const access = d?.access;

  const send = async (method, body) => {
    setError(null);
    setFields({});
    setBusy(true);
    try {
      setData(await api('/tenant/settings/support-access', { method, ...(body ? { body } : {}) }));
      setReason('');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Hospital admin' }, { label: 'Support access' }]}
        title="Support access"
        help="Whether Perinexa's own staff may open this hospital's patient records, to help with a problem."
      />
      <div className="pf-content">
        <section className="card narrow" aria-labelledby="support-now">
          <h2 id="support-now">Perinexa staff and your patients' records</h2>
          {res.error && <Alert type="error">{res.error}</Alert>}
          <p className="hint">
            Perinexa staff manage hospitals and accounts. They open your patients' records only while you allow it here, for a reason you give and a few hours.
            Every record they open is in your audit log.
          </p>
          {access && (
            <p>
              {access.open ? (
                <StatusPill tone="watch" icon={ShieldCheck}>
                  Allowed until {formatDateTime(access.until)}
                </StatusPill>
              ) : (
                <StatusPill tone="inactive" icon={ShieldOff}>
                  Not allowed
                </StatusPill>
              )}
            </p>
          )}
          {access?.open && (
            <p className="hint">
              Allowed by {access.grantedByName || 'an admin'} on {formatDateTime(access.grantedAt)}: {access.reason}
            </p>
          )}
          <Alert type="error">{error}</Alert>

          {d?.canChange && access?.open && (
            <button type="button" className="btn btn-danger" onClick={() => send('DELETE')} disabled={busy}>
              End support access now
            </button>
          )}
          {d?.canChange && access && !access.open && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send('PUT', { hours, reason });
              }}
              noValidate
            >
              <Field label="For how long" id="support-hours" error={fields.hours}>
                <select id="support-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {d.hours.map((h) => (
                    <option key={h} value={h}>
                      {h} hours
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Why Perinexa staff need the records" id="support-reason" error={fields.reason} hint="For example the problem you reported. Kept in the audit log." keepHint>
                <input id="support-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Wrong bill total for one patient, reported today" />
              </Field>
              <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 5}>
                Allow support access
              </button>
            </form>
          )}
          {d && !d.canChange && <p className="hint">Only this hospital's own admin can allow or end support access.</p>}
        </section>
      </div>
    </>
  );
}
