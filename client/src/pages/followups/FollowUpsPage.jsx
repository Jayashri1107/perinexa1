import { useState } from 'react';
import { Baby, CalendarClock, CalendarPlus, CalendarX2, Check, ClipboardList, Phone, PhoneCall, Search, TriangleAlert, UserCheck } from 'lucide-react';
import { api } from '../../api.js';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_FOLLOW_UPS } from '../../platform/modules.js';
import { PURPOSE_LABELS, dayLabel, timeLabel } from '../appointments/appointmentFormat.js';
import { BookAndBillDialog } from './BookAndBillDialog.jsx';
import { AddFollowUpDialog } from './FollowUpDialogs.jsx';
import { SETTING_CHOICES, SETTING_LABELS, bookingTime, callRows, comingUpGroups, filterFollowUps, followUpCounts, visitTypeLabel } from './followUpsFormat.js';

// Reception's Follow-ups (26 Oct 2026, docs/IDEAS_FOR_LATER.md ideas 24, 25 and 27), from GET /api/follow-ups:
//  - Follow-ups: the patients to call (a visit due or overdue, nothing booked) and everyone booked for the next 7 days,
//    by day – the time, the doctor, New or Follow-up, arrived;
//  - Vaccinations: babies whose vaccination is overdue, or due in the next 7 days, with nothing booked – in general
//    words only ("a check-up or test"), never the vaccine; "Draft schedule": ask the doctor before calling.
// Names, phone numbers and dates only: never the reason for a visit.
// The filter (both tabs, kept in the address bar as ?q= and ?type=): part of her name, patient number, phone or
// doctor, and OPD / IPD / Day care (IPD and day care: a stay still going or ended in the last 90 days).

const phoneLink = (phone) =>
  phone ? (
    <a className="btn btn-link btn-sm" href={`tel:${phone.replace(/\s+/g, '')}`}>
      <Phone aria-hidden="true" /> {phone}
    </a>
  ) : (
    <span className="muted">No phone</span>
  );

const patientCell = (r) => (
  <span className="fu-patient">
    <Link to={`/patients/${r.patient.id}`}>{r.patient.fullName}</Link>
    <span className="muted tabular">
      {r.patient.mrn}
      {r.patient.setting && r.patient.setting !== 'opd' ? ` · ${SETTING_LABELS[r.patient.setting]}` : ''}
    </span>
  </span>
);

// Book: the popup that books her visit, adds the charges and makes the bill (owner, 26 Oct 2026)
const bookButton = (onBook) => (r) => (
  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onBook(r)} aria-label={`Book a follow-up for ${r.patient.fullName}`}>
    Book
  </button>
);

const NO_MATCH = 'No patient matches the filter.';

/** The filter in the address bar: { text, setting, set(key, value) } – the same on both tabs. */
function useFilter() {
  const [params, setParams] = useSearchParams();
  const setting = SETTING_CHOICES.some(([k]) => k && k === params.get('type')) ? params.get('type') : '';
  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const text = params.get('q') ?? '';
  return { text, setting, set, active: Boolean(text.trim() || setting) };
}

function FilterBar({ filter }) {
  return (
    <div className="fu-filter" role="search">
      <label className="bill-search fu-search">
        <Search aria-hidden="true" />
        <span className="sr-only">Filter</span>
        <input type="search" placeholder="Patient name, number, phone or doctor" value={filter.text} onChange={(e) => filter.set('q', e.target.value)} />
      </label>
      <div className="segmented" role="group" aria-label="OPD, IPD or day care">
        {SETTING_CHOICES.map(([key, label]) => (
          <button key={label} type="button" aria-pressed={filter.setting === key} onClick={() => filter.set('type', key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Header({ data, actions = null }) {
  const { search } = useLocation();
  return (
    <PageHeader
      actions={actions}
      breadcrumbs={[{ label: 'Follow-ups' }]}
      title="Follow-ups"
      subtitle="Who to call and who is coming. Names, phone numbers and dates only."
      tabs={HOSPITAL_FOLLOW_UPS.tabs.map((t) => ({ ...t, to: t.to + search }))}
      documentTitle="Follow-ups"
      badges={data?.cut ? <StatusPill tone="watch">List cut short</StatusPill> : null}
    />
  );
}

function Counts({ data }) {
  const n = followUpCounts(data);
  return (
    <div className="kpi-grid">
      <KpiCard to="/follow-ups#fu-call" tone={n.toCall ? 'watch' : 'stable'} icon={PhoneCall} label="To call – not booked" value={n.toCall} />
      <KpiCard to="/follow-ups/vaccinations" tone={n.babies ? 'watch' : 'stable'} icon={Baby} label="Babies to call" value={n.babies} />
      <KpiCard to="/follow-ups#fu-coming" tone="due" icon={CalendarClock} label="Booked today" value={n.today} />
      <KpiCard to="/follow-ups#fu-coming" tone="neutral" icon={CalendarClock} label={`Booked, next ${data?.days ?? 7} days`} value={n.comingUp} />
    </div>
  );
}

function Panel({ id, icon: Icon, title, count, hint, children }) {
  return (
    <section className="fu-panel" aria-labelledby={id}>
      <h2 id={id} className="fu-title">
        <Icon aria-hidden="true" /> {title} <span className="muted tabular">({count})</span>
      </h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Follow-ups tab: the patients to call, then the coming week's bookings by day. */
/**
 * Follow-ups added by hand (26 Oct 2026): she will come back to a doctor, for something (a fixed purpose and a short
 * note) from a day. Open until she checks in (then they leave this list) or reception cancels one.
 */
function AddedFollowUps({ added, filterText, onCancelled, onBook }) {
  const [error, setError] = useState(null);
  const t = filterText.trim().toLowerCase();
  const rows = (added?.followUps ?? []).filter((f) => !t || [f.patient.fullName, f.patient.mrn, f.patient.phone, f.doctor.name].some((w) => (w ?? '').toLowerCase().includes(t)));
  const cancel = async (f) => {
    setError(null);
    try {
      await api(`/added-follow-ups/${f.id}/cancel`, { method: 'POST' });
      onCancelled(f);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Panel id="fu-added" icon={ClipboardList} title="Follow-ups" count={rows.length} hint="Patients asked to come back – with which doctor, what for and, once booked, the day and time. Her doctor sees them on Today. When she checks in, it is marked.">
      <Alert type="error">{error ?? added?.error}</Alert>
      <DataTable
        caption="Follow-ups added"
        loading={!added}
        rows={added ? rows : null}
        emptyText="No follow-ups added. Use Add follow-up when a doctor asks a patient to come back."
        columns={[
          { key: 'patient', header: 'Patient', render: patientCell },
          { key: 'phone', header: 'Phone', render: (f) => phoneLink(f.patient.phone) },
          { key: 'doctor', header: 'Doctor', render: (f) => f.doctor.name },
          {
            key: 'for',
            header: 'For',
            render: (f) => (
              <span className="fu-why">
                <StatusPill tone="due">{PURPOSE_LABELS[f.purpose]}</StatusPill>
                {f.note && <span className="muted">{f.note}</span>}
              </span>
            ),
          },
          // The day she comes from, as a date (owner, 27 Oct 2026); older follow-ups saved without a day show Today
          { key: 'from', header: 'From', render: (f) => (f.from ? dayLabel(f.from) : 'Today') },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            render: (f) => (
              <span className="fu-why">
                {/* Booked: her day and time (owner, 26 Oct 2026); not yet: Book */}
                {f.booked ? (
                  <StatusPill tone="stable" icon={Check}>
                    Booked · {dayLabel(f.booked.date)}
                    {f.booked.start ? `, ${timeLabel(f.booked.start)}` : ''}
                  </StatusPill>
                ) : (
                  bookButton(onBook)(f)
                )}
                <button type="button" className="btn btn-link btn-sm" onClick={() => cancel(f)} aria-label={`Cancel the follow-up of ${f.patient.fullName}`}>
                  Cancel
                </button>
              </span>
            ),
          },
        ]}
      />
    </Panel>
  );
}

export function FollowUpsPage() {
  const res = useFetch('/follow-ups');
  const added = useFetch('/added-follow-ups');
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState(null); // { patient, doctorId?, purpose?, note?, from? }
  const [note, setNote] = useState(null);
  const filter = useFilter();
  const data = filterFollowUps(res.data, filter);
  const calls = data ? callRows(data, formatDate) : null;
  const groups = data ? comingUpGroups(data.comingUp, data.today) : [];
  return (
    <>
      <Header
        data={data}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <CalendarPlus aria-hidden="true" /> Add follow-up
          </button>
        }
      />
      <div className="pf-content fu-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="success" onClose={() => setNote(null)}>
          {note}
        </Alert>
        <FilterBar filter={filter} />
        {data && <Counts data={data} />}
        <AddedFollowUps
          added={added.data ?? (added.error ? { error: added.error } : null)}
          filterText={filter.text}
          onBook={(f) => setBooking({ patient: f.patient, followUpId: f.id, doctorId: f.doctor.id, purpose: f.purpose, note: f.note, from: f.from })}
          onCancelled={(f) => {
            setNote(`Cancelled: the follow-up of ${f.patient.fullName}.`);
            added.reload();
          }}
        />
        {booking && (
          <BookAndBillDialog
            who={booking}
            today={data?.today ?? new Date().toISOString().slice(0, 10)}
            onClose={() => setBooking(null)}
            onDone={({ appointment, bill }) => {
              setBooking(null);
              setNote(`${booking.patient.fullName}: follow-up booked for ${dayLabel(appointment.date)}${appointment.start ? `, ${timeLabel(appointment.start)}` : ''}${bill ? `, bill ${bill.number} made` : ''}.`);
              res.reload();
              added.reload();
            }}
          />
        )}
        {adding && (
          <AddFollowUpDialog
            today={data?.today}
            onClose={() => setAdding(false)}
            onAdded={(f) => {
              setAdding(false);
              setNote(`Follow-up added for ${f.patient.fullName}: ${PURPOSE_LABELS[f.purpose]} with ${f.doctor.name}.`);
              added.reload();
            }}
          />
        )}
        <Panel id="fu-call" icon={CalendarX2} title="To call – not booked" count={calls?.length ?? 0} hint="A visit is due or overdue and nothing is booked. Overdue first. Call, then book.">
          <DataTable
            caption="Patients to call"
            loading={res.loading}
            rows={calls}
            emptyText={filter.active ? NO_MATCH : 'Nobody to call: every patient with a visit due is booked or has come.'}
            columns={[
              { key: 'patient', header: 'Patient', render: patientCell },
              { key: 'phone', header: 'Phone', render: (r) => phoneLink(r.patient.phone) },
              { key: 'doctor', header: 'Doctor', render: (r) => r.patient.doctorName ?? <span className="muted">Not assigned</span> },
              {
                key: 'why',
                header: 'Why',
                render: (r) => (
                  <span className="fu-why">
                    {r.late ? (
                      <StatusPill tone="high" icon={TriangleAlert}>
                        Overdue
                      </StatusPill>
                    ) : (
                      <StatusPill tone="due">Due now</StatusPill>
                    )}
                    <span>{r.why}</span>
                  </span>
                ),
              },
              { key: 'book', header: <span className="sr-only">Book</span>, render: bookButton((r) => setBooking({ patient: r.patient })) },
            ]}
          />
        </Panel>
        <Panel id="fu-coming" icon={CalendarClock} title={`Coming up – next ${data?.days ?? 7} days`} count={data?.comingUp?.length ?? 0} hint="Booked appointments and next visits the doctor wrote. Confirm or remind them by phone.">
          {data && groups.length === 0 && <p className="panel-empty">{filter.active ? NO_MATCH : 'Nobody is booked for the coming days.'}</p>}
          {groups.map((g) => (
            <div key={g.date} className="fu-day">
              <h3 className="fu-day-title">
                {g.label} <span className="muted tabular">({g.rows.length})</span>
              </h3>
              <DataTable
                caption={`Booked for ${g.label}`}
                rows={g.rows.map((r, i) => ({ ...r, id: `${r.patient.id}-${i}` }))}
                columns={[
                  { key: 'time', header: 'Time', render: (r) => (r.needsTime ? <Link to="/appointments/needs-time">Needs a time</Link> : bookingTime(r)) },
                  { key: 'patient', header: 'Patient', render: patientCell },
                  { key: 'phone', header: 'Phone', render: (r) => phoneLink(r.patient.phone) },
                  { key: 'doctor', header: 'Doctor', render: (r) => r.doctorName ?? r.patient.doctorName ?? <span className="muted">Not assigned</span> },
                  { key: 'type', header: 'Visit', render: (r) => <StatusPill tone={r.visitType === 'new' ? 'brand' : 'neutral'} icon={null}>{visitTypeLabel(r)}</StatusPill> },
                  {
                    key: 'state',
                    header: 'Status',
                    render: (r) =>
                      r.arrived ? (
                        <StatusPill tone="stable" icon={UserCheck}>
                          Arrived
                        </StatusPill>
                      ) : (
                        <StatusPill tone="due" icon={Check}>
                          Booked
                        </StatusPill>
                      ),
                  },
                ]}
              />
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}

const babyColumns = (soon, onBook) => [
  { key: 'patient', header: 'Baby', render: patientCell },
  { key: 'phone', header: 'Phone', render: (r) => phoneLink(r.patient.phone) },
  { key: 'doctor', header: 'Doctor', render: (r) => r.patient.doctorName ?? <span className="muted">Not assigned</span> },
  {
    key: 'due',
    header: 'Due',
    render: (r) => (
      <span className="fu-why">
        {soon ? (
          <StatusPill tone="due">Due soon</StatusPill>
        ) : (
          <StatusPill tone="high" icon={TriangleAlert}>
            Overdue
          </StatusPill>
        )}
        <span>{soon ? `A check-up or test is due from ${formatDate(r.dueFrom)}` : `A check-up or test was due from ${formatDate(r.dueFrom)}`}</span>
        {r.draft && (
          <StatusPill tone="watch" icon={TriangleAlert} title="The date comes from a schedule no doctor has approved yet – ask the doctor before calling">
            Draft schedule
          </StatusPill>
        )}
      </span>
    ),
  },
  { key: 'book', header: <span className="sr-only">Book</span>, render: bookButton(onBook) },
];

/** Vaccinations tab: babies overdue, then babies due in the next 7 days – nothing booked. */
export function VaccinationFollowUpsPage() {
  const res = useFetch('/follow-ups');
  const filter = useFilter();
  const data = filterFollowUps(res.data, filter);
  const withId = (rows) => rows?.map((r) => ({ ...r, id: r.patient.id }));
  const draft = [...(data?.babiesDue ?? []), ...(data?.babiesSoon ?? [])].some((r) => r.draft);
  const [booking, setBooking] = useState(null);
  const [note, setNote] = useState(null);
  const book = (r) => setBooking({ patient: r.patient });
  return (
    <>
      <Header data={data} />
      <div className="pf-content fu-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="success" onClose={() => setNote(null)}>
          {note}
        </Alert>
        {booking && (
          <BookAndBillDialog
            who={booking}
            today={data?.today ?? new Date().toISOString().slice(0, 10)}
            onClose={() => setBooking(null)}
            onDone={({ appointment, bill }) => {
              setBooking(null);
              setNote(`${booking.patient.fullName}: follow-up booked for ${dayLabel(appointment.date)}${appointment.start ? `, ${timeLabel(appointment.start)}` : ''}${bill ? `, bill ${bill.number} made` : ''}.`);
              res.reload();
            }}
          />
        )}
        <FilterBar filter={filter} />
        {data && <Counts data={data} />}
        <Panel id="fu-babies-due" icon={Baby} title="Overdue – not booked" count={data?.babiesDue?.length ?? 0} hint="Babies for whom a check-up or test became overdue in the last 6 weeks and nothing is booked. A baby in hospital is not listed.">
          <DataTable caption="Babies overdue" loading={res.loading} rows={withId(data?.babiesDue)} emptyText={filter.active ? NO_MATCH : 'No baby is overdue.'} columns={babyColumns(false, book)} />
        </Panel>
        <Panel id="fu-babies-soon" icon={Baby} title="Due in the next 7 days – not booked" count={data?.babiesSoon?.length ?? 0} hint="Book these before they are late.">
          <DataTable caption="Babies due soon" loading={res.loading} rows={withId(data?.babiesSoon)} emptyText={filter.active ? NO_MATCH : 'No baby is due in the next 7 days without a booking.'} columns={babyColumns(true, book)} />
        </Panel>
        {draft && <p className="hint">"Draft schedule": the date comes from a schedule no doctor has approved yet – ask the doctor before calling.</p>}
      </div>
    </>
  );
}
