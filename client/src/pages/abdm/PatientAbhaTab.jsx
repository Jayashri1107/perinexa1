import { useState } from 'react';
import { BadgeCheck, IdCard, KeyRound, Printer, ShieldCheck, Unlink, UserPlus } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal, useSend } from '../pharmacy/pharmacyUi.jsx';
import { AbhaFetched } from './AbhaFetched.jsx';
import { AbhaRecords } from './AbhaRecords.jsx';

// The patient record's ABHA tab (ABDM linking, M1 – docs/ABDM_PLAN.md), for reception, doctors and RMOs: her linked
// ABHA, or the two ways to link one – verify the ABHA she already has (OTP to her mobile), or create a new one with
// her Aadhaar number and OTP. The Aadhaar number is typed into a hidden box, sent once, never shown again or kept.
// M2: under her linked ABHA, her doctor and RMOs see her records in ABHA (AbhaRecords.jsx).
// M3: those who may see her medical details see her records from other hospitals; her doctor or an RMO asks for them
// (AbhaFetched.jsx). Shown even after her ABHA is unlinked, while records received are still kept.

const METHOD_LABELS = { verified: 'Verified by OTP', created: 'Created at the desk', scan_share: 'Scan & Share' };
const HINTS = [
  { key: 'abha-number', label: 'ABHA number', placeholder: '91-1234-5678-9012' },
  { key: 'abha-address', label: 'ABHA address', placeholder: 'name@abdm' },
  { key: 'mobile', label: 'Mobile number', placeholder: '98765 43210' },
];
export const MODE_NOTE = { practice: 'Practice mode – not connected to ABDM. Made-up ABHAs; the OTP is 123456.', sandbox: 'ABDM sandbox (test system) – not for real patients.', production: '' };

export function ModeBanner({ mode }) {
  if (!mode || mode === 'production') return null;
  return <Alert type="warning">{MODE_NOTE[mode]}</Alert>;
}

/** Her ABDM profile beside her Perinexa record, to check it is the same person. */
function Compare({ profile, patient }) {
  const age = profile.yearOfBirth ? new Date().getFullYear() - profile.yearOfBirth : null;
  return (
    <table className="bill-report abha-compare">
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">ABHA (from ABDM)</th>
          <th scope="col">Perinexa record</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Name</th>
          <td>{profile.name}</td>
          <td>{patient.fullName}</td>
        </tr>
        <tr>
          <th scope="row">Age</th>
          <td>{age != null ? `about ${age} (born ${profile.yearOfBirth})` : '–'}</td>
          <td>{patient.currentAge ?? '–'}</td>
        </tr>
        <tr>
          <th scope="row">Mobile</th>
          <td>{profile.mobile || '–'}</td>
          <td>{patient.phone || '–'}</td>
        </tr>
        <tr>
          <th scope="row">ABHA</th>
          <td colSpan={2}>
            {profile.abhaNumber}
            {profile.abhaAddress ? ` · ${profile.abhaAddress}` : ''}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function ConsentBox({ checked, onChange, text }) {
  return (
    <label className="appt-reason abha-consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {text}
    </label>
  );
}

function VerifyDialog({ patient, onClose, onLinked }) {
  const [hint, setHint] = useState('abha-number');
  const [value, setValue] = useState('');
  const [step, setStep] = useState(null); // { id, sentTo, practiceOtp } then { accounts }
  const [otp, setOtp] = useState('');
  const [accounts, setAccounts] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [consent, setConsent] = useState(false);
  const s = useSend(() => {});
  const run = async (fn) => {
    s.setError(null);
    try {
      await fn();
    } catch (err) {
      s.setError(err.message);
    }
  };
  return (
    <Modal id="abha-verify" title="Verify her ABHA" onClose={onClose} wide>
      <Alert type="error" onClose={() => s.setError(null)}>
        {s.error}
      </Alert>
      {!step && (
        <>
          <div className="segmented" role="group" aria-label="Find her ABHA by">
            {HINTS.map((h) => (
              <button key={h.key} type="button" aria-pressed={hint === h.key} onClick={() => setHint(h.key)}>
                {h.label}
              </button>
            ))}
          </div>
          <Field label={HINTS.find((h) => h.key === hint).label} id="abha-v-value">
            <input id="abha-v-value" value={value} placeholder={HINTS.find((h) => h.key === hint).placeholder} maxLength={100} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={value.trim().length < 3} onClick={() => run(async () => setStep(await api('/abdm/verify/request', { method: 'POST', body: { patientId: patient.id, hint, value } })))}>
              <KeyRound aria-hidden="true" /> Send the OTP to her mobile
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {step && !accounts && (
        <>
          <p>
            ABDM sent an OTP to {step.sentTo || 'her mobile'}. Ask her to read it out.
            {step.practiceOtp ? ` (Practice OTP: ${step.practiceOtp})` : ''}
          </p>
          <Field label="OTP" id="abha-v-otp">
            <input id="abha-v-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <button
            type="button"
            className="btn btn-primary"
            disabled={otp.length !== 6}
            onClick={() =>
              run(async () => {
                const out = await api('/abdm/verify/confirm', { method: 'POST', body: { id: step.id, otp } });
                setAccounts(out.accounts);
                setChosen(out.accounts[0] ?? null);
              })
            }
          >
            Verify
          </button>
        </>
      )}
      {accounts && (
        <>
          {accounts.length > 1 && (
            <Field label="Which ABHA is hers" id="abha-v-choose">
              <select id="abha-v-choose" value={chosen?.abhaNumber ?? ''} onChange={(e) => setChosen(accounts.find((a) => a.abhaNumber === e.target.value))}>
                {accounts.map((a) => (
                  <option key={a.abhaNumber} value={a.abhaNumber}>
                    {a.name} · {a.abhaNumber}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {chosen && <Compare profile={chosen} patient={patient} />}
          <ConsentBox checked={consent} onChange={setConsent} text="She agrees to link her ABHA to her record at this hospital (it is the same person)." />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={!chosen || !consent} onClick={() => run(async () => onLinked(await api('/abdm/verify/link', { method: 'POST', body: { id: step.id, abhaNumber: chosen.abhaNumber, consent: true } })))}>
              <BadgeCheck aria-hidden="true" /> Link to her record
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

const ABDM_CONSENT =
  'I, the patient, agree to create my ABHA (Ayushman Bharat Health Account) using my Aadhaar number and OTP, with my details sent to the National Health Authority. My Aadhaar number is not stored by the hospital.';

function CreateDialog({ patient, onClose, onLinked }) {
  const [consent, setConsent] = useState(false);
  const [aadhaar, setAadhaar] = useState('');
  const [step, setStep] = useState(null); // { id, sentTo, practiceOtp }
  const [otp, setOtp] = useState('');
  const [mobile, setMobile] = useState(patient.phone ?? '');
  const [created, setCreated] = useState(null); // { profile, suggestions }
  const [address, setAddress] = useState('');
  const s = useSend(() => {});
  const run = async (fn) => {
    s.setError(null);
    try {
      await fn();
    } catch (err) {
      s.setError(err.message);
    }
  };
  const digits = aadhaar.replace(/\s/g, '');
  return (
    <Modal id="abha-create" title="Create her ABHA" onClose={onClose} wide>
      <Alert type="error" onClose={() => s.setError(null)}>
        {s.error}
      </Alert>
      {!step && (
        <>
          <p className="hint">Read this to her and tick only if she agrees:</p>
          <ConsentBox checked={consent} onChange={setConsent} text={ABDM_CONSENT} />
          <Field label="Her Aadhaar number (12 digits)" id="abha-c-aadhaar" hint="Hidden as it is typed. Sent to ABDM once; never saved or shown again.">
            <input id="abha-c-aadhaar" type="password" inputMode="numeric" autoComplete="off" maxLength={14} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/[^\d ]/g, ''))} />
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!consent || digits.length !== 12}
              onClick={() =>
                run(async () => {
                  const out = await api('/abdm/create/request', { method: 'POST', body: { patientId: patient.id, aadhaar: digits, consent: true } });
                  setAadhaar(''); // forgotten in the page too
                  setStep(out);
                })
              }
            >
              <KeyRound aria-hidden="true" /> Send the OTP
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {step && !created && (
        <>
          <p>
            UIDAI sent an OTP to her Aadhaar-linked mobile {step.sentTo}. Ask her to read it out.
            {step.practiceOtp ? ` (Practice OTP: ${step.practiceOtp})` : ''}
          </p>
          <div className="form-grid">
            <Field label="OTP" id="abha-c-otp">
              <input id="abha-c-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <Field label="Mobile number for her ABHA" id="abha-c-mobile" error={s.fields.mobile}>
              <input id="abha-c-mobile" type="tel" value={mobile} maxLength={20} onChange={(e) => setMobile(e.target.value)} />
            </Field>
          </div>
          <button type="button" className="btn btn-primary" disabled={otp.length !== 6} onClick={() => run(async () => setCreated(await api('/abdm/create/confirm', { method: 'POST', body: { id: step.id, otp, mobile } })))}>
            Create her ABHA
          </button>
        </>
      )}
      {created && (
        <>
          <Alert type="success">{created.isNew ? 'Her ABHA was created.' : 'She already had an ABHA with this Aadhaar – it is shown below.'}</Alert>
          <Compare profile={created.profile} patient={patient} />
          {!created.profile.abhaAddress && (
            <>
              <Field label="Her ABHA address" id="abha-c-address" hint="Choose a suggestion or type one (letters, numbers, dots).">
                <input id="abha-c-address" value={address} maxLength={60} onChange={(e) => setAddress(e.target.value)} list="abha-suggestions" />
              </Field>
              <datalist id="abha-suggestions">
                {(created.suggestions ?? []).map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
              <div className="row">
                {(created.suggestions ?? []).slice(0, 3).map((x) => (
                  <button key={x} type="button" className="btn btn-link btn-sm" onClick={() => setAddress(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-secondary" disabled={address.trim().length < 4} onClick={() => run(async () => setCreated({ ...created, ...(await api('/abdm/create/address', { method: 'POST', body: { id: step.id, address: address.trim() } })) }))}>
                Save the ABHA address
              </button>
            </>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => run(async () => onLinked(await api('/abdm/create/link', { method: 'POST', body: { id: step.id } })))}>
              <BadgeCheck aria-hidden="true" /> Link to her record
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function CardPrint({ cardId, onClose }) {
  const res = useFetch(`/abdm/card/${cardId}`);
  return (
    <PrintPreview title="ABHA card – print preview" hint="Give the card to the patient." onClose={onClose}>
      <PrintDocument>
        {res.error && <p>{res.error}</p>}
        {res.data && <img className="abha-card" alt="Her ABHA card" src={`data:${res.data.contentType};base64,${res.data.base64}`} />}
      </PrintDocument>
    </PrintPreview>
  );
}

export function PatientAbhaTab() {
  const { patient, reload } = useOutletContext();
  const res = useFetch(`/abdm/patients/${patient.id}`);
  const [dialog, setDialog] = useState(null); // verify | create | unlink
  const [cardId, setCardId] = useState(null); // a verification or creation whose card can be printed
  const [printing, setPrinting] = useState(false);
  const [flash, setFlash] = useState(null);
  const d = res.data;
  const linked = (out) => {
    setDialog(null);
    setCardId(out.cardId ?? null);
    setFlash('Her ABHA is linked to her record.');
    res.reload();
    reload();
  };
  return (
    <div className="bill-page">
      <ModeBanner mode={d?.mode} />
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {d?.abha && (
        <section className="card bill-section">
          <div className="row-between">
            <h2>
              <ShieldCheck aria-hidden="true" /> ABHA linked
            </h2>
            <span className="row">
              {cardId && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print her ABHA card
                </button>
              )}
              <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('unlink')}>
                <Unlink aria-hidden="true" /> Unlink
              </button>
            </span>
          </div>
          <dl className="abha-facts">
            <dt>ABHA number</dt>
            <dd className="tabular">{d.abha.number}</dd>
            <dt>ABHA address</dt>
            <dd>{d.abha.address || '–'}</dd>
            <dt>Name on ABHA</dt>
            <dd>{d.abha.nameOnAbha || '–'}</dd>
            <dt>Linked</dt>
            <dd>
              <StatusPill tone="stable" icon={BadgeCheck}>
                {METHOD_LABELS[d.abha.method]}
              </StatusPill>{' '}
              by {d.abha.byName}, {formatDateTime(d.abha.at)}
            </dd>
          </dl>
          {!cardId && <p className="hint">To print her ABHA card, verify her ABHA again (an OTP to her mobile): Unlink is not needed – use “Verify her ABHA” below.</p>}
          {!cardId && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog('verify')}>
              <IdCard aria-hidden="true" /> Verify her ABHA again (for the card)
            </button>
          )}
        </section>
      )}
      {/* M2: her records linked to her ABHA – her doctor and RMOs only */}
      {d?.abha && d.canSeeRecords && <AbhaRecords key={`records-${d.abha.number}`} patientId={patient.id} />}
      {d && !d.abha && (
        <div className="card-columns">
          <section className="card bill-section">
            <h2>
              <BadgeCheck aria-hidden="true" /> She has an ABHA
            </h2>
            <p>Find it by ABHA number, ABHA address or mobile number; she reads out the OTP ABDM sends to her mobile.</p>
            <button type="button" className="btn btn-primary" onClick={() => setDialog('verify')}>
              Verify her ABHA
            </button>
          </section>
          <section className="card bill-section">
            <h2>
              <UserPlus aria-hidden="true" /> She has no ABHA
            </h2>
            <p>Create one with her agreement, her Aadhaar number and the OTP on her Aadhaar-linked mobile. The Aadhaar number is never kept.</p>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('create')}>
              Create her ABHA
            </button>
          </section>
        </div>
      )}
      {/* M3: her records from other hospitals – those who may see her medical details. Below the ways to link her ABHA
          (when none is linked), as its "Link her ABHA (above)" says. */}
      {d?.canSeeRecords && <AbhaFetched key={`fetched-${d.abha?.number ?? 'none'}`} patientId={patient.id} hasAbha={Boolean(d.abha)} isBaby={patient.careType === 'newborn'} />}
      {dialog === 'verify' && d && <VerifyDialog patient={d.patient} onClose={() => setDialog(null)} onLinked={linked} />}
      {dialog === 'create' && d && <CreateDialog patient={d.patient} onClose={() => setDialog(null)} onLinked={linked} />}
      {dialog === 'unlink' && (
        <UnlinkDialog
          patientId={patient.id}
          onClose={() => setDialog(null)}
          onDone={() => {
            linked({ cardId: null });
            setFlash('Her ABHA was unlinked.');
          }}
        />
      )}
      {printing && cardId && <CardPrint cardId={cardId} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function UnlinkDialog({ patientId, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const s = useSend(onDone);
  return (
    <Modal id="abha-unlink" title="Unlink her ABHA" onClose={onClose}>
      <p>Her record will no longer show this ABHA. Her ABHA itself stays with ABDM.</p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Why" id="abha-unlink-reason">
        <input id="abha-unlink-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || s.busy} onClick={() => s.send(`/abdm/patients/${patientId}/unlink`, { reason: reason.trim() })}>
          Unlink
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}
