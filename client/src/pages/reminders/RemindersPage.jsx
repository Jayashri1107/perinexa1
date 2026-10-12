import { useState } from 'react';
import { CircleCheck, CircleX, Clock, MessageCircle, Send, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { showWhatsappNumber, whatsappLink } from '../visits/whatsapp.js';
import { hasDraftWording, messageAbout, runNotice } from './outboxFormat.js';

// Calendar → Reminders (Version 2): the automatic appointment reminders – what goes out today (or on a chosen
// day), and the messages waiting to be sent by hand (no message provider set up, or sending failed). Staff send
// those from their own phone or WhatsApp and mark them sent. Only for patients who agreed to reminders.
// Since 4 Oct 2026 also the two general messages, each with a plain label: "Check-up or test due" (a care-plan item
// is overdue and nothing is booked) and "Missed appointment" (the day after a booked appointment nobody came to).
// Neither says what is due. The server shows a sensitive record's "Check-up or test due" row only to her doctor and
// RMOs; the hints say so, and what staff must do after a death (the app has no place to record one).

const STATUS = {
  queued: { tone: 'due', icon: Clock, word: 'Waiting to go out' },
  sent: { tone: 'stable', icon: CircleCheck, word: 'Sent' },
  sent_by_hand: { tone: 'stable', icon: CircleCheck, word: 'Sent by hand' },
  to_send: { tone: 'watch', icon: Send, word: 'To send by hand' },
  failed: { tone: 'high', icon: TriangleAlert, word: 'Not sent – failed' },
  cancelled: { tone: 'inactive', icon: CircleX, word: 'Cancelled' },
};
const CHANNEL = { sms: 'SMS', whatsapp: 'WhatsApp' };
const today = () => new Date().toISOString().slice(0, 10);
// The result of a button further down the page is shown at the top: bring it into view.
const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

function MessageRow({ m, onSent }) {
  const look = STATUS[m.status] ?? { tone: 'neutral', word: m.status };
  const open = ['to_send', 'failed'].includes(m.status);
  const [copied, setCopied] = useState(false);
  const number = m.to.replace(/^\+/, '');
  return (
    <li>
      <div className="wl-row-head">
        <span className="wl-who">
          <Link to={`/patients/${m.patient.id}`} className="strong-name">
            {m.patient.fullName}
          </Link>
          <span className="muted tabular">
            {m.patient.mrn} · {messageAbout(m)} · {CHANNEL[m.channel]} {showWhatsappNumber(number)}
          </span>
        </span>
        <StatusPill tone={look.tone} icon={look.icon}>
          {look.word}
        </StatusPill>
      </div>
      <p className="rem-text">{m.text}</p>
      {m.error && (open || m.status === 'cancelled') && <p className="hint">{m.error}</p>}
      {m.handled && (
        <p className="hint">
          Sent by {m.handled.byName}, {formatDateTime(m.handled.at)}
        </p>
      )}
      {open && (
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(m.text).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy the message'}
          </button>
          {m.channel === 'whatsapp' && (
            <a className="btn btn-secondary btn-sm" href={whatsappLink(number)} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden="true" /> Open WhatsApp chat
            </a>
          )}
          <button type="button" className="btn btn-link btn-sm" onClick={() => onSent(m)}>
            Mark as sent
          </button>
        </div>
      )}
    </li>
  );
}

export function RemindersPage() {
  const { activeMembership } = useAuth();
  const [day, setDay] = useState(today());
  const list = useFetch('/reminders', { day });
  const open = useFetch('/reminders', { list: 'open' });
  const settings = useFetch('/reminders/settings');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const canRun = hasRole(activeMembership, 'doctor', 'admin');
  const reload = () => {
    list.reload();
    open.reload();
  };
  const markSent = async (m) => {
    setError(null);
    try {
      await api(`/reminders/${m.id}/sent-by-hand`, { method: 'POST' });
      setNotice(`Marked as sent: ${m.patient.fullName}.`);
      reload();
    } catch (err) {
      // Refused, e.g. the message is no longer to be sent (she booked since, it is too old): show why, and the lists as they are now
      setError(err.message);
      reload();
    }
    toTop();
  };
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api('/reminders/run', { method: 'POST' });
      setNotice(runNotice(r));
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      toTop();
    }
  };
  const s = settings.data;
  const provider = s?.provider;

  return (
    <>
      <PageHeader
        title="Reminders"
        help="Automatic messages for patients who agreed: the day before an appointment, when a check-up or test from the care plan is overdue and nothing is booked, and the day after an appointment nobody came to. Messages that could not go out automatically wait here to be sent by hand."
        tabs={moduleByKey('calendar').tabs}
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{error ?? list.error}</Alert>
        {s && (
          <p className="hint">
            {s.settings.remindersEnabled ? 'Automatic reminders are on.' : 'Automatic reminders are off (Hospital admin → Patient messages).'}{' '}
            {provider ? `Sent by ${provider.name} (${provider.channels.map((c) => CHANNEL[c]).join(', ')}).` : 'No message provider is set up: reminders wait below to be sent by hand.'}
          </p>
        )}
        {s?.settings.remindersEnabled && (
          <>
            <p className="hint">
              "Check-up or test due" and "Missed appointment" never say what is due or why. Each patient – and each mobile number – gets at most one of them in 14 days, and none while she is in
              hospital, is already booked, or her record is closed. "Check-up or test due" goes out only from a care plan a doctor has approved, and not in the week after she came. These two are
              not sent in the evening or at night: they wait for the morning.
            </p>
            <p className="hint">
              "Missed appointment" follows "did not come": mark the patient as arrived on the Today page (or start her visit) when she comes. For a record marked sensitive, "Check-up or test
              due" is shown only to her doctor and RMOs, who send it by hand.
            </p>
            <p className="hint">
              If a patient or a baby has died, her doctor records it on the record (More → Record a death). The record is then closed: no reminder or message of any kind goes to it.
            </p>
          </>
        )}
        {hasDraftWording([...(open.data?.messages ?? []), ...(list.data?.messages ?? [])]) && (
          <p className="hint">The Marathi and Hindi wording is a draft – have it checked by a fluent speaker before using it with patients.</p>
        )}
        {open.data?.messages?.length > 0 && (
          <section className="panel wl-section" aria-labelledby="rem-open">
            <header className="panel-header">
              <h2 id="rem-open">
                <Send aria-hidden="true" /> To send by hand <span className="muted tabular">({open.data.messages.length})</span>
              </h2>
            </header>
            <ul className="wl-list">
              {open.data.messages.map((m) => (
                <MessageRow key={m.id} m={m} onSent={markSent} />
              ))}
            </ul>
          </section>
        )}
        <div className="row reg-toolbar">
          <Field label="Messages of the day" id="rem-day">
            <input id="rem-day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
          {canRun && s?.settings.remindersEnabled && (
            <button type="button" className="btn btn-secondary" disabled={running} onClick={run}>
              <Send aria-hidden="true" /> {running ? 'Sending…' : 'Send due reminders now'}
            </button>
          )}
        </div>
        <section className="panel wl-section" aria-labelledby="rem-day-title">
          <header className="panel-header">
            <h2 id="rem-day-title">
              <MessageCircle aria-hidden="true" /> {formatDate(`${day}T00:00:00Z`)} <span className="muted tabular">({list.data?.messages?.length ?? 0})</span>
            </h2>
          </header>
          {list.data?.messages?.length ? (
            <ul className="wl-list">
              {list.data.messages.map((m) => (
                <MessageRow key={m.id} m={m} onSent={markSent} />
              ))}
            </ul>
          ) : (
            <p className="panel-empty">No reminders on this day.</p>
          )}
        </section>
      </div>
    </>
  );
}
