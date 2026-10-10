// Calendar → Check-ups due (owner, 10 Oct 2026): pregnant patients who agreed to messages and have a scan or vaccination
// of the antenatal care plan due in the chosen week, each with a NEUTRAL ready message (no scan name, no word about
// pregnancy) in Marathi or English. "Send on WhatsApp" opens WhatsApp at her number with the message written in; staff
// press Send there and then "Mark sent" here (each check-up is reminded once). Reception sees names, phones, dates and
// the message; doctors and RMOs also see what is due. Patients who did not agree are counted, never listed.
import { Check, CircleCheck, Copy, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { pregnancyApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { WhatsAppButton } from '../../components/WhatsAppButton.jsx';
import { CALENDAR_TABS } from '../../config/navigation.js';
import { formatDate, formatDateTime, todayInput } from '../../utils/format.js';

const SENT = { tone: 'active', icon: CircleCheck, word: 'Sent' };
const TO_SEND = { tone: 'pending', icon: Send, word: 'To send' };
const LANGUAGES = [
  ['mr', 'मराठी'],
  ['en', 'English'],
];
const LANG_KEY = 'p1:checkup-language';

// The Monday of the week of a day (YYYY-MM-DD).
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function CheckupsPage() {
  const [from, setFrom] = useState(() => mondayOf(todayInput()));
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'mr';
    } catch {
      return 'mr';
    }
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    pregnancyApi.reminders(from).then(setData).catch((err) => setError(err.message));
  }, [from]);
  useEffect(load, [load]);

  const chooseLang = (value) => {
    setLang(value);
    try {
      localStorage.setItem(LANG_KEY, value);
    } catch {
      /* the choice is kept for this visit only */
    }
  };
  const markSent = async (row) => {
    try {
      await pregnancyApi.reminderSent(row.patient.id, row.keys);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = [
    { key: 'dates', label: 'Due between', className: 'nowrap', render: (r) => `${formatDate(r.from)} – ${formatDate(r.to)}` },
    { key: 'who', label: 'Patient', render: (r) => (<><strong>{r.patient.name}</strong><span className="muted block small">{r.patient.patientNumber}{r.what && ` · ${r.what.join(', ')}`}</span></>) },
    { key: 'phone', label: 'Phone', className: 'nowrap', render: (r) => (r.patient.phone ? <a href={`tel:${r.patient.phone}`}>{r.patient.phone}</a> : '—') },
    { key: 'message', label: 'Message', render: (r) => <span className="small">{r.message[lang]}</span> },
    { key: 'state', label: 'Reminder', render: (r) => (<><StateBadge look={r.sentAt ? SENT : TO_SEND} small />{r.sentAt && <span className="muted block small">{formatDateTime(r.sentAt)}</span>}</>) },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div className="row-actions">
          <WhatsAppButton phone={r.patient.phone} agreed text={r.message[lang]} small label="WhatsApp" />
          <CopyButton text={r.message[lang]} />
          {!r.sentAt && <button type="button" className="btn btn-ghost btn-sm" onClick={() => markSent(r)}>Mark sent</button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Calendar" subtitle="Pregnancy check-ups due (scans and vaccinations). Only patients who agreed to messages are listed; the message names no test." />
      <SectionTabs tabs={CALENDAR_TABS} label="Calendar" />
      <section className="card day-toolbar">
        <label className="filter">
          <span>Week from</span>
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(mondayOf(e.target.value))} />
        </label>
        <div className="filter" role="group" aria-label="Message language">
          <span>Message in</span>
          {LANGUAGES.map(([value, word]) => (
            <button key={value} type="button" className={`btn btn-sm ${lang === value ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={lang === value} onClick={() => chooseLang(value)}>{word}</button>
          ))}
        </div>
        {data && <h2 className="day-title">{formatDate(data.from)} – {formatDate(data.to)}</h2>}
      </section>
      <Alert type="error">{error}</Alert>
      {data?.noTemplate && <Alert type="info">There is no antenatal care plan in the Clinic library, so no check-ups can be worked out.</Alert>}
      {data?.draft && !data.noTemplate && <Alert type="info">The dates come from the DRAFT antenatal care plan (not approved by a doctor yet).</Alert>}
      {data?.notAgreed > 0 && <Alert type="info">{data.notAgreed} other pregnant patient{data.notAgreed === 1 ? ' has' : 's have'} not agreed to messages.</Alert>}
      <section className="card list-panel">
        <DataTable columns={columns} rows={(data?.items ?? []).map((r) => ({ ...r, id: r.patient.id }))} loading={!data && !error} emptyText="No check-ups due this week." />
      </section>
    </>
  );
}
