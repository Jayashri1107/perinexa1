// The calendar (as in Perinexa): booked appointments, due dates (EDD) and last periods (LMP) by day, week and month.
// Reception sees bookings only; doctors and RMOs also see pregnancy dates of the records they may read. Doctors choose
// My patients or All patients. The view, day and choices are kept in the address, so a reload stays on them.
import { Baby, CalendarClock, ChevronLeft, ChevronRight, Droplet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { calendarApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { CALENDAR_TABS } from '../../config/navigation.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { addDaysIso, appointmentLook, dayText } from '../appointments/appointmentFormat.js';

export const TYPE_LOOKS = {
  booked: { tone: 'info', icon: CalendarClock, word: 'Booked' },
  edd: { tone: 'pending', icon: Baby, word: 'Due date' },
  lmp: { tone: 'inactive', icon: Droplet, word: 'LMP' },
};
const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const weekStart = (iso, startsOn) => addDaysIso(iso, -((dow(iso) - startsOn + 7) % 7));
const monthOf = (iso) => iso.slice(0, 7);
const firstOfMonth = (iso) => `${monthOf(iso)}-01`;
const lastOfMonth = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const todayLocalIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The days shown for a view (a month as whole weeks).
function rangeOf(view, date, startsOn) {
  if (view === 'day') return [date, date];
  if (view === 'week') {
    const from = weekStart(date, startsOn);
    return [from, addDaysIso(from, 6)];
  }
  const from = weekStart(firstOfMonth(date), startsOn);
  const lastWeek = weekStart(lastOfMonth(date), startsOn);
  return [from, addDaysIso(lastWeek, 6)];
}
const daysBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
};
const stepOf = (view, date, n) => {
  if (view === 'day') return addDaysIso(date, n);
  if (view === 'week') return addDaysIso(date, 7 * n);
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const titleOf = (view, from, to, date) => {
  if (view === 'day') return dayText(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'week') return `${dayText(from, { day: 'numeric', month: 'short' })} – ${dayText(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return dayText(date, { month: 'long', year: 'numeric' });
};

function EventLine({ e, compact }) {
  const look = e.type === 'booked' ? appointmentLook({ status: e.status }) : TYPE_LOOKS[e.type];
  const Icon = TYPE_LOOKS[e.type].icon;
  const name = e.patient.id ? <Link to={`/hospital/patients/${e.patient.id}`}>{e.patient.name}</Link> : e.patient.name;
  return (
    <div className={`cal-event cal-${e.type}`}>
      <Icon size={13} aria-hidden />
      <span className="cal-event-text">
        {e.type === 'booked' && <strong>{e.start ?? (e.token ? `Token ${e.token}` : 'No time')} </strong>}
        {e.type !== 'booked' && <strong>{TYPE_LOOKS[e.type].word} </strong>}
        {name}
        {!compact && e.type === 'booked' && <span className="muted"> · {e.doctor}</span>}
        {!compact && e.type === 'lmp' && e.ga && <span className="muted"> · now {e.ga.weeks} weeks {e.ga.days} days</span>}
      </span>
      {!compact && e.type === 'booked' && <StateBadge look={look} small />}
    </div>
  );
}

export function CalendarPage() {
  const { calendar: settings } = useAppConfig();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const view = params.get('view') || 'month';
  const date = params.get('date') || todayLocalIso();
  const scope = params.get('scope') || 'mine';
  const types = params.get('types') || '';
  const set = (next) => setParams({ view, date, scope, ...(types && { types }), ...next }, { replace: true });
  const [from, to] = useMemo(() => rangeOf(view, date, settings.weekStartsOn), [view, date, settings.weekStartsOn]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    calendarApi
      .events({ from, to, scope, types })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, scope, types]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of data?.events ?? []) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [data]);

  const shown = data?.types ?? [];
  const toggleType = (t) => {
    const on = shown.includes(t);
    if (on && shown.length === 1) return; // at least one kind stays shown
    const next = data.allowed.filter((x) => (x === t ? !on : shown.includes(x)));
    set({ types: next.join(',') });
  };
  const today = data?.today ?? todayLocalIso();
  const days = daysBetween(from, to);
  const weekdays = days.slice(0, 7).map((d) => dayText(d, { weekday: 'short' }));

  return (
    <>
      <PageHeader title="Calendar" subtitle="Booked visits, due dates and last periods, by day, week and month." />
      <SectionTabs tabs={CALENDAR_TABS} label="Calendar" />

      <section className="card cal-toolbar" aria-label="Calendar controls">
        <div className="cal-row">
          <div className="day-nav">
            <button type="button" className="icon-btn" aria-label={`Previous ${view}`} onClick={() => set({ date: stepOf(view, date, -1) })}><ChevronLeft size={18} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ date: today })}>Today</button>
            <button type="button" className="icon-btn" aria-label={`Next ${view}`} onClick={() => set({ date: stepOf(view, date, 1) })}><ChevronRight size={18} /></button>
          </div>
          <h2 className="day-title" aria-live="polite">
            {titleOf(view, from, to, date)}
            {loading && <span className="muted small"> Loading…</span>}
          </h2>
          <div className="segmented" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" className={view === v.value ? 'on' : ''} aria-pressed={view === v.value} onClick={() => set({ view: v.value })}>{v.label}</button>
            ))}
          </div>
        </div>
        {data && (
          <div className="cal-row">
            {data.canChooseScope && (
              <div className="segmented" role="group" aria-label="Whose patients">
                <button type="button" className={data.scope === 'mine' ? 'on' : ''} aria-pressed={data.scope === 'mine'} onClick={() => set({ scope: 'mine' })}>My patients</button>
                <button type="button" className={data.scope === 'all' ? 'on' : ''} aria-pressed={data.scope === 'all'} onClick={() => set({ scope: 'all' })}>All patients</button>
              </div>
            )}
            <div className="chips" role="group" aria-label="Show">
              {data.allowed.map((t) => {
                const Icon = TYPE_LOOKS[t].icon;
                const on = shown.includes(t);
                return (
                  <button key={t} type="button" className={`chip-toggle cal-${t}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleType(t)}>
                    <Icon size={13} aria-hidden /> {TYPE_LOOKS[t].word}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <Alert type="error">{error}</Alert>
      {data?.incomplete && <Alert type="info">There are more entries than can be shown at once. Choose a shorter view.</Alert>}

      {view === 'month' && (
        <section className="card cal-month" aria-label="Month">
          {weekdays.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={`cal-cell${monthOf(d) !== monthOf(date) ? ' other-month' : ''}${d === today ? ' today' : ''}`}>
                <button type="button" className="cal-daynum" onClick={() => set({ view: 'day', date: d })} aria-label={`Open ${dayText(d)}`}>{Number(d.slice(8))}</button>
                {list.slice(0, 3).map((e) => <EventLine key={e.id} e={e} compact />)}
                {list.length > 3 && (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => set({ view: 'day', date: d })}>+{list.length - 3} more</button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {view === 'week' && (
        <section className="cal-week">
          {days.map((d) => (
            <div key={d} className={`card cal-weekday-col${d === today ? ' today' : ''}`}>
              <button type="button" className="cal-daynum wide" onClick={() => set({ view: 'day', date: d })}>{dayText(d, { weekday: 'short', day: 'numeric', month: 'short' })}</button>
              {(byDay.get(d) ?? []).length === 0 && <p className="muted small">Nothing</p>}
              {(byDay.get(d) ?? []).map((e) => <EventLine key={e.id} e={e} compact />)}
            </div>
          ))}
        </section>
      )}

      {view === 'day' && (
        <section className="card">
          {(byDay.get(date) ?? []).length === 0 && <p className="muted">Nothing on this day.</p>}
          {(byDay.get(date) ?? []).map((e) => <EventLine key={e.id} e={e} />)}
        </section>
      )}
    </>
  );
}
