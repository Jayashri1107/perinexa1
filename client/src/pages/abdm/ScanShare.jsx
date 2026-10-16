import { useState } from 'react';
import { BadgeCheck, Globe, PencilLine, QrCode, Save, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { Modal } from '../pharmacy/pharmacyUi.jsx';
import { Section } from '../worklist/WorklistSections.jsx';
import { ModeBanner } from './PatientAbhaTab.jsx';

// Scan & Share on the Today page (ABDM linking, M1): patients who scanned the hospital's QR code in their ABHA app,
// each with a token number. Reception links each to her record (found, or registered with the details filled in), or
// puts it aside. And Hospital admin → ABDM: the HFR / HIP ID, the counter code and how to get the QR – and for M2
// (sharing her records) the addresses ABDM calls and what to check against ABDM's sandbox.
// Since 16 Oct 2026 the list also has patients who signed up online in the patient portal with their ABHA
// (docs/PATIENT_SIGNUP_PLAN.md): marked "Signed up online", waiting up to 7 days. She is not a patient until reception
// registers her or finds her record here.

function FindDialog({ share, onClose, onDone }) {
  const [error, setError] = useState(null);
  const link = async (p) => {
    setError(null);
    try {
      await api(`/abdm/scan-share/${share.id}/link`, { method: 'POST', body: { patientId: p.id } });
      onDone(`Token ${share.token}: ABHA linked to ${p.fullName}.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal id="ss-find" title={`Token ${share.token}: find her record`} onClose={onClose}>
      <p>
        ABHA: {share.profile.name}, born {share.profile.yearOfBirth ?? '–'}, mobile {share.profile.mobile || '–'}.
      </p>
      <Alert type="error">{error}</Alert>
      <PatientFinder onPick={link} />
      <div className="row">
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function ScanShareSection() {
  const res = useFetch('/abdm/scan-share');
  const [finding, setFinding] = useState(null);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const shares = res.data?.shares ?? [];
  const waiting = shares.filter((s) => s.status === 'waiting');
  const act = async (fn, message) => {
    setError(null);
    try {
      await fn();
      setFlash(message);
      res.reload();
    } catch (err) {
      setError(err.message);
    }
  };
  if (!res.data) return null;
  const practiceButton = (
    <button type="button" className="btn btn-link btn-sm" onClick={() => act(() => api('/abdm/scan-share/practice', { method: 'POST' }), 'A practice scan arrived.')}>
      <QrCode aria-hidden="true" /> Try a practice scan (practice mode)
    </button>
  );
  return (
    <Section
      id="td-scan-share"
      icon={QrCode}
      title="Scan & Share (ABHA)"
      count={waiting.length}
      empty={
        <>
          Nobody is waiting from the desk QR code or an online sign-up.
          {flash ? ` ${flash}` : ''}
          {res.data.mode === 'practice' && practiceButton}
        </>
      }
    >
      <ModeBanner mode={res.data.mode} />
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <ul className="wl-list">
        {waiting.map((s) => (
          <li key={s.id} className="wl-row appt-guest-row">
            <div>
              <strong>
                Token {s.token} · {s.profile.name}
              </strong>{' '}
              {s.source === 'portal' && (
                <StatusPill tone="due" icon={Globe}>
                  Signed up online
                </StatusPill>
              )}
              <p className="hint">
                {s.profile.yearOfBirth ? `born ${s.profile.yearOfBirth} · ` : ''}
                {s.profile.abhaAddress || s.profile.abhaNumber} · {s.source === 'portal' ? 'signed up' : 'arrived'}{' '}
                {formatDate(s.receivedAt) !== formatDate(new Date()) ? `${formatDate(s.receivedAt)}, ` : ''}
                {formatTime(s.receivedAt)}
                {s.knownPatient && !s.knownPatient.abhaOn ? ` · already linked to ${s.knownPatient.fullName} (${s.knownPatient.mrn})` : ''}
                {/* Her ABHA is on a record marked as a duplicate: the desk is pointed to her main record */}
                {s.knownPatient?.abhaOn
                  ? ` · she is ${s.knownPatient.fullName} (${s.knownPatient.mrn}); her ABHA is still linked on her earlier record ${s.knownPatient.abhaOn.mrn} – unlink it there (ABHA tab), then find her record here`
                  : ''}
              </p>
            </div>
            <span className="row">
              {s.knownPatient?.abhaOn ? (
                <>
                  <Link className="btn btn-secondary btn-sm" to={`/patients/${s.knownPatient.abhaOn.id}/abha`}>
                    Open {s.knownPatient.abhaOn.mrn}
                  </Link>
                  <Link className="btn btn-link btn-sm" to={`/patients/${s.knownPatient.id}`}>
                    Open {s.knownPatient.mrn}
                  </Link>
                </>
              ) : s.knownPatient ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(() => api(`/abdm/scan-share/${s.id}/link`, { method: 'POST', body: { patientId: s.knownPatient.id } }), `Token ${s.token}: ${s.knownPatient.fullName} – done.`)}>
                  <BadgeCheck aria-hidden="true" /> Confirm {s.knownPatient.fullName}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFinding(s)}>
                    Find her record
                  </button>
                  <Link
                    className="btn btn-link btn-sm"
                    to="/patients/new"
                    state={{ fromScanShare: { id: s.id, name: s.profile.name, phone: s.profile.phone, age: s.profile.yearOfBirth ? new Date().getFullYear() - s.profile.yearOfBirth : null } }}
                  >
                    <UserPlus aria-hidden="true" /> Register
                  </Link>
                </>
              )}
              <button type="button" className="btn btn-link btn-sm" onClick={() => act(() => api(`/abdm/scan-share/${s.id}/dismiss`, { method: 'POST' }), `Token ${s.token} put aside.`)}>
                Put aside
              </button>
            </span>
          </li>
        ))}
      </ul>
      {shares.length > waiting.length && (
        <p className="hint">
          Done today:{' '}
          {shares
            .filter((s) => s.status !== 'waiting')
            .map((s) => `token ${s.token} (${s.status === 'linked' ? 'linked' : 'put aside'})`)
            .join(', ')}
        </p>
      )}
      {res.data.mode === 'practice' && practiceButton}
      {finding && (
        <FindDialog
          share={finding}
          onClose={() => setFinding(null)}
          onDone={(m) => {
            setFinding(null);
            setFlash(m);
            res.reload();
          }}
        />
      )}
    </Section>
  );
}

// ---------- Hospital admin → ABDM ----------

/** The DRAFT words that mark a record as about HIV (never shared through ABHA) – for the hospital's doctor to check. */
export function ConfidentialWords({ list }) {
  return (
    <div className="abha-never">
      <h3>
        Words that mark a record as about HIV{' '}
        <StatusPill tone="watch" icon={PencilLine}>
          Draft
        </StatusPill>
      </h3>
      <p className="hint">A record whose shared text has one of these words is never shared through ABHA. This list is a draft, to be checked by the hospital's doctor before use. Source: {list.source}.</p>
      <ul>
        {list.words.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export function AbdmSettingsPage() {
  const res = useFetch('/abdm/status');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const v = form ?? res.data?.settings;
  const f = (k) => (e) => {
    setSaved(false);
    setForm({ ...v, [k]: e.target.value });
  };
  const save = async () => {
    setError(null);
    setFields({});
    try {
      await api('/abdm/settings', { method: 'PUT', body: { hfrId: v.hfrId.trim(), hipId: v.hipId.trim(), counterCode: v.counterCode.trim() } });
      setSaved(true);
      setForm(null);
      res.reload();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    }
  };
  const mode = res.data?.mode;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Hospital admin', to: '/admin/staff' }, { label: 'ABDM' }]} title="ABDM (ABHA)" />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="error">{error}</Alert>
        {saved && <Alert type="success">Saved.</Alert>}
        {res.data && (
          <section className="card bill-section">
            <h2>Connection</h2>
            <p>
              Mode:{' '}
              <StatusPill tone={mode === 'production' ? 'stable' : 'watch'}>{mode === 'practice' ? 'Practice (not connected)' : mode === 'sandbox' ? 'ABDM sandbox (test)' : 'ABDM production'}</StatusPill>
            </p>
            <p className="hint">
              The mode and ABDM's client ID and secret are set in the server's private settings file (server/.env: ABDM_MODE, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET) – never here and never in chat. Production only after ABDM's
              certification.
            </p>
          </section>
        )}
        {v && (
          <section className="card bill-section">
            <h2>The hospital in ABDM</h2>
            <div className="form-grid">
              <Field label="HFR facility ID" id="abdm-hfr" hint="From the Health Facility Registry (facility.abdm.gov.in)">
                <input id="abdm-hfr" value={v.hfrId} maxLength={60} onChange={f('hfrId')} />
              </Field>
              <Field label="HIP ID" id="abdm-hip" hint="Usually the same as the HFR ID. One HIP ID belongs to one hospital." error={fields.hipId}>
                <input id="abdm-hip" value={v.hipId} maxLength={60} onChange={f('hipId')} />
              </Field>
              <Field label="Scan & Share counter code" id="abdm-counter" hint="The counter of the QR at the reception desk">
                <input id="abdm-counter" value={v.counterCode} maxLength={40} onChange={f('counterCode')} />
              </Field>
            </div>
            <button type="button" className="btn btn-primary" disabled={!form} onClick={save}>
              <Save aria-hidden="true" /> Save
            </button>
          </section>
        )}
        <section className="card bill-section">
          <h2>The Scan & Share QR code</h2>
          <p>
            Download the hospital's Scan & Share QR code from the Health Facility Registry (facility.abdm.gov.in → your facility → Scan & Share), print it and put it at the reception desk. Patients scan it in their ABHA app; they
            then appear on reception's Today page with a token number.
          </p>
        </section>
        {res.data?.callbacks && (
          <section className="card bill-section">
            <h2>Sharing her records through ABHA</h2>
            <p>
              Her doctor or an RMO links her signed visits, reviewed lab reports and confirmed discharge summaries to her ABHA (the ABHA tab of her record), or she links them herself from her ABHA app. She then decides in her
              ABHA app which hospital or app may see them. Perinexa sends them, encrypted, only while her consent is valid.
            </p>
            <p className="hint">
              Never shared: records marked sensitive, HIV tests and records that mention HIV (and no visit or discharge summary of a patient with HIV among her known conditions), the doctor's private note, anything not
              signed or reviewed, and anything entered in error.
            </p>
            {res.data.confidentialWords && <ConfidentialWords list={res.data.confidentialWords} />}
            {!res.data.settings.hipId && mode !== 'practice' && <Alert type="warning">Sharing her records needs the HIP ID (above). Until it is saved, records cannot be linked to an ABHA.</Alert>}
            <h3>The address ABDM calls</h3>
            {res.data.bridgeUrl ? (
              <p>
                Bridge URL to register with ABDM: <span className="tabular abha-address">{res.data.bridgeUrl}</span>
              </p>
            ) : (
              <Alert type="info">
                Not set yet: Perinexa is not on the internet. Once it is, the person who runs the server puts its public https address in server/.env as ABDM_PUBLIC_URL. This page then shows the bridge URL to register with ABDM.
              </Alert>
            )}
            <p className="hint">ABDM calls these addresses after the bridge URL. Each call is accepted only with ABDM's signature.</p>
            <ul>
              {res.data.callbacks.map((x) => (
                <li key={x} className="tabular abha-address">
                  {x}
                </li>
              ))}
            </ul>
          </section>
        )}
        {res.data?.callbacksM3 && (
          <section className="card bill-section">
            <h2>Her records from other hospitals</h2>
            <p>
              Her doctor or an RMO asks for her records from other hospitals on the ABHA tab of her record. She agrees in her ABHA app; the records then arrive encrypted, are shown read-only to those who may see her medical
              details, and are deleted when her consent ends or she withdraws it. They are never added to her records here and never sent on.
            </p>
            <p className="hint">The hospital asks with its HIP ID (above) as its HIU ID, and needs the public address (ABDM_PUBLIC_URL) for the records to arrive.</p>
            <h3>The addresses ABDM and other hospitals call</h3>
            <p className="hint">After the bridge URL. ABDM's calls are accepted only with ABDM's signature; the records themselves only for a request this hospital is waiting for, and only those in her consent.</p>
            <ul>
              {res.data.callbacksM3.map((x) => (
                <li key={x} className="tabular abha-address">
                  {x}
                </li>
              ))}
            </ul>
          </section>
        )}
        {res.data?.checklist && (
          <section className="card bill-section">
            <h2>To check with ABDM's sandbox documentation</h2>
            <p className="hint">For the developer who connects Perinexa to the sandbox: these requests were written from ABDM's public material and have not been tried against ABDM. Each must be checked once credentials arrive.</p>
            <h3>ABHA and Scan & Share</h3>
            <ul>
              {res.data.checklist.map((x) => (
                <li key={x} className="tabular abha-address">
                  {x}
                </li>
              ))}
            </ul>
            {res.data.checklistM2 && (
              <>
                <h3>Sharing her records</h3>
                <ul>
                  {res.data.checklistM2.map((x) => (
                    <li key={x} className="tabular abha-address">
                      {x}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {res.data.checklistM3 && (
              <>
                <h3>Her records from other hospitals</h3>
                <ul>
                  {res.data.checklistM3.map((x) => (
                    <li key={x} className="tabular abha-address">
                      {x}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
