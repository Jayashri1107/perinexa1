import { useEffect, useState } from 'react';
import { Building2, FileText, Link2, ShieldOff, Smartphone } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal } from '../pharmacy/pharmacyUi.jsx';
import {
  CONFIDENTIAL_DRAFT_NOTE,
  HI_TYPES,
  HI_TYPE_WORDS,
  NEVER_SHARED,
  canChoose,
  consentLine,
  consentStatus,
  practiceConsentDefaults,
  recordCounts,
  recordStatus,
  transferLine,
  transferStatus,
  typesLine,
} from './abhaRecordsFormat.js';

// Her records in ABHA (ABDM milestone M2), on her ABHA tab – for her doctor and RMOs only (they are her medical
// records): which visits, lab reports and discharge summaries are linked to her ABHA, "Link to ABHA" with her
// agreement, what is never shared, the consents she gave in her ABHA app and what was sent. In practice mode, two
// buttons stand in for her ABHA app and for another hospital. The server decides what may be shared.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The list of her records with their status (and a tick box for those that can be linked). */
export function RecordsTable({ items, canLink, chosen = [], onToggle = () => {} }) {
  if (!items.length) return <p className="hint">No visits, lab reports or discharge summaries on her record yet.</p>;
  return (
    <div className="bill-wide">
      <table className="abha-records">
        <thead>
          <tr>
            {canLink && (
              <th scope="col">
                <span className="sr-only">Choose</span>
              </th>
            )}
            <th scope="col">Record</th>
            <th scope="col">Shared as</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const s = recordStatus(item);
            return (
              <tr key={item.reference}>
                {canLink && <td>{canChoose(item) && <input type="checkbox" aria-label={`Choose ${item.display}`} checked={chosen.includes(item.reference)} onChange={(e) => onToggle(item.reference, e.target.checked)} />}</td>}
                <td>{item.display}</td>
                <td>{typesLine(item.hiTypes)}</td>
                <td>
                  <StatusPill tone={s.tone} icon={s.icon}>
                    {s.label}
                  </StatusPill>
                  {s.hint && <p className="hint">{s.hint}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What is never shared through ABHA (always on the screen). */
export function NeverShared() {
  return (
    <div className="abha-never">
      <h3>
        <ShieldOff aria-hidden="true" /> Never shared through ABHA
      </h3>
      <ul>
        {NEVER_SHARED.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="hint">{CONFIDENTIAL_DRAFT_NOTE}</p>
    </div>
  );
}

/** The consents she gave in her ABHA app, each with what was sent. */
export function ConsentsList({ consents, practiceButtons = false, onAgain = () => {}, onRevoke = () => {}, onView = () => {} }) {
  if (!consents.length) {
    return <p className="hint">No consent yet. When she agrees in her ABHA app that another hospital or app may see her linked records, it shows here with what was sent.</p>;
  }
  return (
    <ul className="abha-consents">
      {consents.map((c) => {
        const s = consentStatus(c);
        return (
          <li key={c.id}>
            <div className="row-between">
              <div>
                <strong>{c.hiu || 'Another hospital or app'}</strong>
                {c.purpose ? ` · ${c.purpose}` : ''}
                {c.practice ? ' · practice' : ''}
                <p className="hint">
                  {consentLine(c)} · {plural(c.records, 'record')} · received {formatDateTime(c.receivedAt)}
                </p>
              </div>
              <StatusPill tone={s.tone}>{s.label}</StatusPill>
            </div>
            {c.transfers.length > 0 && (
              <ul className="abha-transfers">
                {c.transfers.map((t) => {
                  const ts = transferStatus(t);
                  return (
                    <li key={t.id}>
                      {formatDateTime(t.at)}{' '}
                      <StatusPill tone={ts.tone} icon={ts.icon}>
                        {ts.label}
                      </StatusPill>
                      {ts.hint && <span className="hint"> {ts.hint}</span>}{' '}
                      {practiceButtons && t.practice && t.documents > 0 && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => onView(t)}>
                          <FileText aria-hidden="true" /> See what was received
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {practiceButtons && c.practice && (
              <div className="row">
                <button type="button" className="btn btn-link btn-sm" onClick={() => onAgain(c)}>
                  The other hospital asks again (practice)
                </button>
                {c.status === 'GRANTED' && (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => onRevoke(c)}>
                    She withdraws the consent (practice)
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Practice mode: her ABHA app, another hospital ----------

function PracticeAppDialog({ patientId, onClose, onDone }) {
  const [found, setFound] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    let gone = false;
    api(`/abdm/patients/${patientId}/practice/discover`, { method: 'POST', body: {} })
      .then((out) => {
        if (gone) return;
        setFound(out);
        if (out.offered.length && out.error) setError(out.error);
      })
      .catch((err) => !gone && setError(err.message));
    return () => {
      gone = true;
    };
  }, [patientId]);
  const confirm = async () => {
    setError(null);
    try {
      const out = await api(`/abdm/patients/${patientId}/practice/confirm`, { method: 'POST', body: { transactionId: found.transactionId, otp } });
      if (out.error) setError(out.error);
      else onDone(`${plural(out.linked, 'record')} linked from her ABHA app (practice).`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal id="abha-practice-app" title="Her ABHA app (practice)" onClose={onClose} wide>
      <p className="hint">As if she looked for her records at this hospital in her ABHA app. Her app finds her only through the ABHA linked to her record here.</p>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      {found && !found.offered.length && <Alert type="info">{found.error ?? 'No new records to link at this hospital.'}</Alert>}
      {found?.offered.length > 0 && (
        <>
          <p>Her app shows these records, and she asks to link them all:</p>
          <ul>
            {found.offered.map((r) => (
              <li key={r.reference}>
                {r.display} – {typesLine(r.hiTypes)}
              </li>
            ))}
          </ul>
          <p>
            The hospital sends an OTP to the mobile number on her record. (Practice OTP: {found.practiceOtp})
          </p>
          <Field label="OTP she types in her app" id="abha-practice-otp">
            <input id="abha-practice-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={otp.length !== 6} onClick={confirm}>
              Confirm in her app
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {found && !found.offered.length && (
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      )}
    </Modal>
  );
}

function PracticeConsentDialog({ patientId, onClose, onDone }) {
  const [form, setForm] = useState(() => practiceConsentDefaults());
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const toggle = (t, on) => setForm({ ...form, hiTypes: on ? [...form.hiTypes, t] : form.hiTypes.filter((x) => x !== t) });
  const send = async () => {
    setError(null);
    setFields({});
    setBusy(true);
    try {
      const out = await api(`/abdm/patients/${patientId}/practice/consent`, { method: 'POST', body: { ...form, days: Number(form.days) } });
      onDone(`Consent given (practice). ${transferLine(out.transfer)}`, out.transfer);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="abha-practice-consent" title="She gives a consent (practice)" onClose={onClose} wide>
      <p className="hint">As if she agreed in her ABHA app that “Sample Clinic (practice)” may see her linked records, and the clinic then asked for them. Nothing leaves this computer.</p>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <div className="form-grid">
        <Field label="Records from" id="abha-pc-from" error={fields.from}>
          <input id="abha-pc-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </Field>
        <Field label="Records to" id="abha-pc-to" error={fields.to}>
          <input id="abha-pc-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </Field>
        <Field label="Consent valid for (days)" id="abha-pc-days" error={fields.days} hint="Type a negative number to try an expired consent." keepHint>
          <input id="abha-pc-days" type="number" min={-30} max={365} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
        </Field>
      </div>
      <fieldset className="appt-reasons">
        <legend>Kinds of records she agrees to share</legend>
        {HI_TYPES.map((t) => (
          <label key={t} className="appt-reason">
            <input type="checkbox" checked={form.hiTypes.includes(t)} onChange={(e) => toggle(t, e.target.checked)} /> {HI_TYPE_WORDS[t]}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || !form.hiTypes.length || !form.from || !form.to || form.days === ''} onClick={send}>
          Give the consent
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function ReceivedDialog({ transfer, onClose }) {
  const res = useFetch(`/abdm/transfers/${transfer.id}/practice-received`);
  const docs = res.data?.documents;
  return (
    <Modal id="abha-received" title="What Sample Clinic received (practice)" onClose={onClose} wide>
      <p className="hint">What the practice clinic received, in the standard format hospitals exchange records in (FHIR), after unlocking it with its own key – shown for checking only.</p>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {res.data && docs === null && <Alert type="info">Not kept any more: the server was restarted since. Give a new consent to try again.</Alert>}
      {docs?.map((d, i) => (
        <details key={`${d.reference}-${i}`} className="abha-fhir">
          <summary>
            {d.title} · {d.reference}
          </summary>
          <pre>{JSON.stringify(d.document, null, 2)}</pre>
        </details>
      ))}
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ---------- The section on her ABHA tab ----------

export function AbhaRecords({ patientId }) {
  const res = useFetch(`/abdm/patients/${patientId}/records`);
  const [chosen, setChosen] = useState([]);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'app' | 'consent' | { received: transfer }
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return null;

  const counts = recordCounts(d.items);
  const linkable = d.canLink && !d.block;
  const practice = d.mode === 'practice' && linkable;
  const done = (message) => {
    setDialog(null);
    setFlash(message);
    res.reload();
  };
  const act = async (fn) => {
    setError(null);
    setFlash(null);
    setBusy(true);
    try {
      setFlash(await fn());
      res.reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const link = () =>
    act(async () => {
      const out = await api(`/abdm/patients/${patientId}/records/link`, { method: 'POST', body: { references: chosen, consent: true } });
      setChosen([]);
      setAgreed(false);
      return out.status === 'waiting' ? `${plural(out.linked, 'record')} sent to ABDM to link – waiting for its answer.` : `${plural(out.linked, 'record')} linked to her ABHA.`;
    });

  return (
    <>
      <section className="card bill-section">
        <div className="row-between">
          <h2>
            <Link2 aria-hidden="true" /> Her records in ABHA
          </h2>
          <span className="hint">
            {counts.linked} linked · {counts.ready} can be linked
          </span>
        </div>
        <p className="hint">Linked records go to another hospital or app only when she agrees in her ABHA app (a consent), and only those she chooses there. Each one is checked again just before it is sent.</p>
        {d.block === 'sensitive_record' && <Alert type="warning">Her record is marked sensitive: nothing from it is linked to her ABHA or shared through ABDM.</Alert>}
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setError(null)}>
          {error}
        </Alert>
        <RecordsTable items={d.items} canLink={linkable} chosen={chosen} onToggle={(ref, on) => setChosen(on ? [...chosen, ref] : chosen.filter((x) => x !== ref))} />
        {linkable && counts.ready > 0 && (
          <>
            <button type="button" className="btn btn-link btn-sm" onClick={() => setChosen(d.items.filter(canChoose).map((i) => i.reference))}>
              Choose all that can be linked
            </button>
            <label className="appt-reason abha-consent">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> She agrees to link the chosen records to her ABHA. She can then share them from her ABHA app, with her consent each time.
            </label>
            <div>
              <button type="button" className="btn btn-primary" disabled={!chosen.length || !agreed || busy} onClick={link}>
                <Link2 aria-hidden="true" /> Link to ABHA
              </button>
            </div>
          </>
        )}
        {!d.canLink && <p className="hint">Only her doctor or an RMO links her records to her ABHA.</p>}
        <NeverShared />
      </section>

      <section className="card bill-section">
        <h2>Consents and what was sent</h2>
        <ConsentsList
          consents={d.consents}
          practiceButtons={practice}
          onAgain={(c) => act(async () => `The other hospital asked again (practice). ${transferLine((await api(`/abdm/consents/${c.id}/practice/request`, { method: 'POST', body: {} })).transfer)}`)}
          onRevoke={(c) =>
            act(async () => {
              await api(`/abdm/consents/${c.id}/practice/revoke`, { method: 'POST', body: {} });
              return 'She withdrew the consent (practice). Nothing more is sent with it.';
            })
          }
          onView={(t) => setDialog({ received: t })}
        />
      </section>

      {practice && (
        <section className="card bill-section">
          <h2>Try it in practice mode</h2>
          <p className="hint">These buttons stand in for her ABHA app and for another hospital. Nothing leaves this computer.</p>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('app')}>
              <Smartphone aria-hidden="true" /> As her ABHA app: find and link her records
            </button>
            <button type="button" className="btn btn-secondary" disabled={!counts.linked} onClick={() => setDialog('consent')}>
              <Building2 aria-hidden="true" /> As another hospital: she gives a consent
            </button>
          </div>
          {!counts.linked && <p className="hint">Link some of her records first to try a consent.</p>}
        </section>
      )}

      {dialog === 'app' && <PracticeAppDialog patientId={patientId} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'consent' && <PracticeConsentDialog patientId={patientId} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog?.received && <ReceivedDialog transfer={dialog.received} onClose={() => setDialog(null)} />}
    </>
  );
}
