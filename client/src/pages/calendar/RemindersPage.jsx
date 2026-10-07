// Calendar → Reminders: the booked appointments of a day for patients who agreed to reminders, each with a ready
// message that names no medical detail. No SMS service is connected: staff send it from the hospital phone and mark
// it sent. Patients who did not agree are counted, never listed.
import { Check, CircleCheck, Copy, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { appointmentsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { CALENDAR_TABS } from '../../config/navigation.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDateTime, todayInput } from '../../utils/format.js';
import { addDaysIso, dayText, phoneOf, whoText } from '../appointments/appointmentFormat.js';

const SENT = { tone: 'active', icon: CircleCheck, word: 'Sent' };
const TO_SEND = { tone: 'pending', icon: Send, word: 'To send' };

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
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy message'}
    </button>
  );
}

export function RemindersPage() {
  const { appointments: settings } = useAppConfig();
  const [date, setDate] = useState(() => addDaysIso(todayInput(), settings.reminderDaysAhead));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    appointmentsApi.reminders(date).then(setData).catch((err) => setError(err.message));
  }, [date]);
  useEffect(load, [load]);

  const markSent = async (a) => {
    try {
      await appointmentsApi.reminderSent(a.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = [
    { key: 'start', label: 'Time', className: 'nowrap', render: (a) => a.start ?? 'No time yet' },
    { key: 'who', label: 'Patient', render: (a) => (<><strong>{whoText(a)}</strong><span className="muted block small">{a.doctor.name}</span></>) },
    { key: 'phone', label: 'Phone', className: 'nowrap', render: (a) => (phoneOf(a) ? <a href={`tel:${phoneOf(a)}`}>{phoneOf(a)}</a> : '—') },
    { key: 'message', label: 'Message', render: (a) => <span className="small">{a.message}</span> },
    { key: 'state', label: 'Reminder', render: (a) => (<><StateBadge look={a.reminderSentAt ? SENT : TO_SEND} small />{a.reminderSentAt && <span className="muted block small">{formatDateTime(a.reminderSentAt)}</span>}</>) },
    {
      key: 'actions',
      label: '',
      render: (a) => (
        <div className="row-actions">
          <CopyButton text={a.message} />
          {data.canSend && !a.reminderSentAt && <button type="button" className="btn btn-ghost btn-sm" onClick={() => markSent(a)}>Mark sent</button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Calendar" subtitle="Appointment reminders to send. Only patients who agreed to reminders are listed." />
      <SectionTabs tabs={CALENDAR_TABS} label="Calendar" />
      <section className="card day-toolbar">
        <label className="filter">
          <span>Appointments on</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <h2 className="day-title">{dayText(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      </section>
      <Alert type="error">{error}</Alert>
      {data?.notAgreed > 0 && (
        <Alert type="info">{data.notAgreed} other booking{data.notAgreed === 1 ? ' is' : 's are'} for patients who did not agree to reminders.</Alert>
      )}
      <section className="card list-panel">
        <DataTable columns={columns} rows={data?.items ?? []} loading={!data && !error} emptyText="No reminders for this day." />
      </section>
    </>
  );
}
