import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Clock, ScanLine, Send, UserRound } from 'lucide-react';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { ChangePassword } from './PortalAccount.jsx';
import { RecordsTab } from './PortalRecords.jsx';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import { portalError } from './portalWords.js';
import { asName } from '../../personName.js';

// My profile (owner, 19 Oct 2026): her details – the contact details she changes herself, and a request to reception
// for her name, age, mobile or email (reception checks who she is) – and, in tabs, her visits, care plan, sonography
// reports, lab reports and prescriptions (the same rules as their own pages: signed or reviewed only, as on paper),
// and her password.

export const PROFILE_TABS = ['details', 'visits', 'plan', 'scans', 'lab', 'prescriptions', 'password'];

function useProfile() {
  const [state, setState] = useState({ data: null, error: null });
  const load = () =>
    portal('/records/profile')
      .then((data) => setState({ data, error: null }))
      .catch((error) => setState({ data: null, error }));
  useEffect(() => {
    load();
  }, []);
  return [state, (data) => setState({ data, error: null })];
}

const fieldErrors = (err) => err?.fields ?? {};

/** Her details: what the hospital has, the contact details she changes, and a request for the rest. */
function Details({ lang }) {
  const w = accountWords(lang);
  const h = w.home;
  const t = w.myProfile;
  const [{ data, error }, setData] = useProfile();
  const [contact, setContact] = useState(null);
  const [ask, setAsk] = useState({ fullName: '', ageYears: '', phone: '', email: '', note: '' });
  const [busy, setBusy] = useState(null); // 'contact' | 'request'
  const [problem, setProblem] = useState(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (data && !contact) setContact(data.contact);
  }, [data, contact]);
  if (error) return <Alert type="error">{portalError(error, lang)}</Alert>;
  if (!data || !contact) return <p className="muted" aria-busy="true">…</p>;
  const errs = fieldErrors(problem);
  const setC = (k) => (e) => setContact({ ...contact, [k]: e.target.value });
  const setE = (k) => (e) => setContact({ ...contact, emergencyContact: { ...contact.emergencyContact, [k]: e.target.value } });
  const saveContact = async (e) => {
    e.preventDefault();
    setBusy('contact');
    setProblem(null);
    setNotice(null);
    try {
      const next = await portal('/records/profile/contact', { method: 'PUT', body: contact });
      setData(next);
      setContact(next.contact);
      setNotice(t.contactSaved);
    } catch (err) {
      setProblem(err);
    } finally {
      setBusy(null);
    }
  };
  const sendRequest = async (e) => {
    e.preventDefault();
    setBusy('request');
    setProblem(null);
    setNotice(null);
    const body = Object.fromEntries(Object.entries(ask).filter(([k, v]) => k === 'note' || String(v).trim()));
    try {
      setData(await portal('/records/profile/request', { method: 'POST', body }));
      setAsk({ fullName: '', ageYears: '', phone: '', email: '', note: '' });
      setNotice(t.requestSent);
    } catch (err) {
      setProblem(err);
    } finally {
      setBusy(null);
    }
  };
  const rows = [
    ['fullName', data.fullName],
    ['mrn', data.mrn],
    ['age', data.age != null ? String(data.age) : ''],
    ['phone', data.phone],
    ['email', data.email ?? ''],
    ['address', data.address],
    ['hospital', data.hospital],
  ].filter(([, v]) => v);
  const changeWords = (c) => Object.entries(c ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${t.changeNames[k] ?? k}: ${v}`).join(' · ');
  return (
    <div className="portal-stack">
      <Alert type="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      <Alert type="error">{problem && !Object.keys(errs).length ? portalError(problem, lang) : null}</Alert>
      <section className="card portal-card" aria-labelledby="pp-details">
        <h2 id="pp-details">
          <UserRound aria-hidden="true" /> {t.yourDetails}
        </h2>
        <dl className="portal-profile">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{h.profile[k]}</dt>
              <dd className={k === 'mrn' || k === 'phone' ? 'tabular' : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {data.canEdit && (
        <form className="card portal-card" onSubmit={saveContact} noValidate aria-labelledby="pp-contact">
          <h2 id="pp-contact">{t.contactTitle}</h2>
          <p className="hint">{t.contactHint}</p>
          <Field label={h.profile.address} id="pp-address" error={errs.address}>
            <textarea id="pp-address" rows={2} maxLength={300} value={contact.address} onChange={setC('address')} />
          </Field>
          <div className="form-grid">
            <Field label={t.city} id="pp-city" error={errs.city}>
              <input id="pp-city" maxLength={60} value={contact.city} onChange={setC('city')} />
            </Field>
            <Field label={t.state} id="pp-state" error={errs.state}>
              <input id="pp-state" maxLength={60} value={contact.state} onChange={setC('state')} />
            </Field>
            <Field label={t.pinCode} id="pp-pin" error={errs.pinCode}>
              <input id="pp-pin" inputMode="numeric" maxLength={6} value={contact.pinCode} onChange={(e) => setContact({ ...contact, pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </Field>
          </div>
          <h3>{t.emergencyTitle}</h3>
          <div className="form-grid">
            <Field label={t.ecName} id="pp-ec-name">
              <input id="pp-ec-name" maxLength={100} value={contact.emergencyContact.name} onChange={asName(setE('name'))} />
            </Field>
            <Field label={t.ecRelation} id="pp-ec-rel">
              <input id="pp-ec-rel" maxLength={50} value={contact.emergencyContact.relation} onChange={setE('relation')} />
            </Field>
            <Field label={t.ecPhone} id="pp-ec-phone">
              <input id="pp-ec-phone" type="tel" maxLength={30} value={contact.emergencyContact.phone} onChange={setE('phone')} />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy === 'contact'}>
              {busy === 'contact' ? w.saving : t.saveContact}
            </button>
          </div>
        </form>
      )}

      <section className="card portal-card" aria-labelledby="pp-request">
        <h2 id="pp-request">{t.requestTitle}</h2>
        <p className="hint">{t.requestHint}</p>
        {data.request && (
          <p>
            <StatusPill tone="due" icon={Clock}>
              {t.waiting}
            </StatusPill>{' '}
            {t.requestedOn(formatDate(data.request.at))} {changeWords(data.request.changes)}
          </p>
        )}
        {!data.request && data.lastRequest && (
          <p>
            {data.lastRequest.status === 'approved' ? (
              <StatusPill tone="stable" icon={CircleCheck}>
                {t.approved}
              </StatusPill>
            ) : (
              <StatusPill tone="inactive" icon={CircleX}>
                {t.rejected}
              </StatusPill>
            )}{' '}
            {changeWords(data.lastRequest.changes)}
            {data.lastRequest.reason ? ` – ${data.lastRequest.reason}` : ''}
          </p>
        )}
        {data.canEdit && (
          <form onSubmit={sendRequest} noValidate>
            <div className="form-grid">
              <Field label={t.newName} id="pp-new-name" error={errs.fullName}>
                <input id="pp-new-name" maxLength={150} value={ask.fullName} onChange={asName((e) => setAsk({ ...ask, fullName: e.target.value }))} />
              </Field>
              <Field label={t.newAge} id="pp-new-age" error={errs.ageYears}>
                <input id="pp-new-age" inputMode="numeric" maxLength={3} value={ask.ageYears} onChange={(e) => setAsk({ ...ask, ageYears: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label={t.newMobile} id="pp-new-mobile" error={errs.phone}>
                <input id="pp-new-mobile" type="tel" maxLength={20} value={ask.phone} onChange={(e) => setAsk({ ...ask, phone: e.target.value })} />
              </Field>
              {data.email !== null && (
                <Field label={t.newEmail} id="pp-new-email" error={errs.email}>
                  <input id="pp-new-email" type="email" maxLength={254} value={ask.email} onChange={(e) => setAsk({ ...ask, email: e.target.value })} />
                </Field>
              )}
            </div>
            <Field label={t.why} id="pp-why">
              <input id="pp-why" maxLength={300} value={ask.note} onChange={(e) => setAsk({ ...ask, note: e.target.value })} />
            </Field>
            <div className="row">
              <button type="submit" className="btn btn-secondary" disabled={busy === 'request'}>
                <Send aria-hidden="true" /> {busy === 'request' ? w.saving : t.sendRequest}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

/** Her signed sonography (and other scan) reports, as printed. */
function Scans({ lang }) {
  const t = accountWords(lang).myProfile;
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    portal('/records/scans')
      .then((data) => setState({ data, error: null }))
      .catch((error) => setState({ data: null, error }));
  }, []);
  const { data, error } = state;
  return (
    <section className="card portal-card" aria-labelledby="pp-scans">
      <h2 id="pp-scans">
        <ScanLine aria-hidden="true" /> {t.tabs.scans}
      </h2>
      <p className="hint">{t.scansRule}</p>
      <Alert type="error">{error ? portalError(error, lang) : null}</Alert>
      {!data && !error && <p className="muted" aria-busy="true">…</p>}
      {data && !data.scans.length && <p className="muted">{t.noScans}</p>}
      {data?.scans.length > 0 && (
        <ul className="portal-records">
          {data.scans.map((s) => (
            <li key={s.id} className="portal-record">
              <h3>
                {s.study} <span className="muted">· {formatDate(s.on)}</span>
              </h3>
              {s.readings.length > 0 && (
                <dl className="portal-profile">
                  {s.readings.map((r) => (
                    <div key={r.name}>
                      <dt>{r.name}</dt>
                      <dd className="tabular">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {s.findings && (
                <p className="pre-line">
                  <strong>{t.findings}:</strong> {s.findings}
                </p>
              )}
              {s.impression && (
                <p>
                  <strong>{t.impression}:</strong> {s.impression}
                </p>
              )}
              <p className="muted">{t.signedBy(s.signedBy, formatDate(s.signedAt))}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * My profile, with its tabs. plan: her care plan as the Home page shows it (rendered by the caller).
 * canChangePassword: her own account with an email.
 */
export function ProfilePage({ lang, plan, canChangePassword, onPasswordDone }) {
  const t = accountWords(lang).myProfile;
  const tabs = PROFILE_TABS.filter((k) => k !== 'password' || canChangePassword);
  const [tab, setTab] = useState('details');
  return (
    <div className="portal-stack">
      <div className="segmented portal-profile-tabs" role="tablist" aria-label={t.title}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {t.tabs[k]}
          </button>
        ))}
      </div>
      {tab === 'details' && <Details lang={lang} />}
      {tab === 'visits' && <RecordsTab tab="visits" lang={lang} />}
      {tab === 'plan' && (plan ?? <p className="muted">{t.noPlan}</p>)}
      {tab === 'scans' && <Scans lang={lang} />}
      {tab === 'lab' && <RecordsTab tab="lab" lang={lang} />}
      {tab === 'prescriptions' && <RecordsTab tab="prescriptions" lang={lang} />}
      {tab === 'password' && (
        <section className="card portal-card">
          <ChangePassword lang={lang} onClose={() => (onPasswordDone ? onPasswordDone() : setTab('details'))} />
        </section>
      )}
    </div>
  );
}
