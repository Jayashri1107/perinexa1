import { useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, Check, ChevronRight, CircleSlash, Clock, FlaskConical, Phone, Pill, Receipt, TriangleAlert, UserRound } from 'lucide-react';
import { Alert, StatusPill, formatDate } from '../../components/ui.jsx';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { rupees } from '../billing/billingFormat.js';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import { portalError, portalWords } from './portalWords.js';

// Her Home page, her appointments and her profile (owner, 17 Oct 2026: "make the next action obvious"): the next
// appointment or a clear "Book an appointment", her records at a glance (counts from the server, the same rules as
// their pages), the hospital's phone to call, her appointments with their states, and her details to read.

function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!path) return undefined;
    let current = true;
    portal(path)
      .then((data) => current && setState({ data, error: null }))
      .catch((error) => current && setState({ data: null, error }));
    return () => {
      current = false;
    };
  }, [path]);
  return state;
}

const when = (date, start) => `${formatDate(date)}${start ? `, ${timeLabel(start)}` : ''}`;

/** "Your next appointment" with the doctor, or the one clear next step: Book an appointment (the screen's primary). */
export function NextAppointment({ data, summary, bookingOn, lang, onBook }) {
  const w = portalWords(lang);
  const h = accountWords(lang).home;
  const date = summary?.appointment?.date ?? data.appointment;
  const start = summary?.appointment?.start ?? data.appointmentTime;
  const doctor = summary?.appointment?.doctorName ?? null;
  return (
    <section className="card portal-card portal-next" aria-labelledby="portal-next">
      <h2 id="portal-next">
        <CalendarCheck aria-hidden="true" /> {w.nextAppointment}
      </h2>
      {date ? (
        <>
          <p className="portal-big">{when(date, start)}</p>
          {doctor && <p className="muted">{h.withDoctor(doctor)}</p>}
        </>
      ) : (
        <p>
          {w.noAppointment}
          {bookingOn ? '' : ` ${w.callToBook}`}
        </p>
      )}
      {bookingOn && !date && (
        <button type="button" className="btn btn-primary" onClick={onBook}>
          <CalendarPlus aria-hidden="true" /> {h.book}
        </button>
      )}
      {date && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBook}>
          <CalendarDays aria-hidden="true" /> {h.viewAppointments}
        </button>
      )}
    </section>
  );
}

/** Four cards: Appointments, Prescriptions, Lab reports, Bills – each opens its page. */
export function AtAGlance({ summary, lang, onOpen }) {
  const aw = accountWords(lang);
  const h = aw.home;
  if (!summary) return null;
  const cards = [
    { key: 'appointments', Icon: CalendarDays, value: summary.appointment ? formatDate(summary.appointment.date) : h.noneBooked },
    { key: 'prescriptions', Icon: Pill, value: String(summary.prescriptions) },
    { key: 'lab', Icon: FlaskConical, value: String(summary.lab) },
    { key: 'bills', Icon: Receipt, value: summary.toPayPaise > 0 ? h.toPay(rupees(summary.toPayPaise)) : h.allPaid },
  ];
  return (
    <section aria-labelledby="portal-glance">
      <h2 id="portal-glance" className="portal-glance-title">
        {h.glance}
      </h2>
      <ul className="portal-glance">
        {cards.map(({ key, Icon, value }) => (
          <li key={key}>
            <button type="button" className="card portal-glance-card" onClick={() => onOpen(key)}>
              <span className="portal-glance-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="portal-glance-text">
                <strong>{aw.tabs[key]}</strong>
                <span className={`portal-glance-value tabular${/^\d+$/.test(value) ? '' : ' is-text'}`}>{value}</span>
                <span className="muted">{h.about[key]}</span>
              </span>
              <ChevronRight className="portal-glance-go" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Need help?": the hospital's number as a Call button, and the emergency line on its own. */
export function CallHospital({ hospital, lang }) {
  const w = portalWords(lang);
  const h = accountWords(lang).home;
  const tel = hospital.phone ? hospital.phone.replace(/[^\d+]/g, '') : '';
  return (
    <section className="card portal-card" aria-labelledby="portal-help">
      <h2 id="portal-help">
        <Phone aria-hidden="true" /> {h.help}
      </h2>
      <p>
        {w.questions} {w.call(hospital.name)}
        {hospital.phone ? (
          <>
            {w.callJoin}
            <span className="nowrap tabular">{hospital.phone}</span>
          </>
        ) : null}
        {w.stop}
      </p>
      {tel && (
        <a className="btn btn-secondary" href={`tel:${tel}`}>
          <Phone aria-hidden="true" /> {h.callHospital}
        </a>
      )}
      <Alert type="warning">{w.emergency}</Alert>
    </section>
  );
}

// Her appointment's state: colour, icon and word
const STATUS = {
  upcoming: { tone: 'due', Icon: Clock },
  seen: { tone: 'stable', Icon: Check },
  arrived: { tone: 'brand', Icon: Check },
  missed: { tone: 'watch', Icon: TriangleAlert },
  cancelled: { tone: 'inactive', Icon: CircleSlash },
};

/** Her appointments of the last year and to come, each with its state. */
export function AppointmentHistory({ lang }) {
  const h = accountWords(lang).home;
  const { data, error } = useLoad('/records/appointments');
  return (
    <section className="card portal-card" aria-labelledby="portal-appts">
      <h2 id="portal-appts">
        <CalendarDays aria-hidden="true" /> {h.appointmentsTitle}
      </h2>
      <Alert type="error">{error ? portalError(error, lang) : null}</Alert>
      {!data && !error && <p className="muted" aria-busy="true">…</p>}
      {data && !data.appointments.length && <p className="muted">{h.noAppointments}</p>}
      {data?.appointments.length > 0 && (
        <ul className="portal-appt-list">
          {data.appointments.map((a, i) => {
            const s = STATUS[a.status] ?? STATUS.upcoming;
            return (
              <li key={`${a.date}-${a.start}-${i}`}>
                <span>
                  <strong className="tabular">{when(a.date, a.start)}</strong>
                  {a.doctorName && <span className="muted"> · {a.doctorName}</span>}
                  {a.online && <span className="muted"> · {h.bookedOnline}</span>}
                </span>
                <StatusPill tone={s.tone} icon={s.Icon}>
                  {h.statuses[a.status] ?? a.status}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Total billed, paid and still to pay, over her open bills (above the bills themselves). */
export function BillsSummary({ bills, lang }) {
  const h = accountWords(lang).home;
  if (!bills?.length) return null;
  const sum = (k) => bills.reduce((s, b) => s + b.totals[k], 0);
  const due = bills.reduce((s, b) => s + Math.max(0, b.totals.balance), 0);
  const rows = [
    ['total', sum('total')],
    ['paid', sum('paid')],
    ['due', due],
  ];
  return (
    <dl className="portal-bill-summary">
      {rows.map(([k, v]) => (
        <div key={k} className={k === 'due' && v > 0 ? 'portal-bill-due' : undefined}>
          <dt>{h.billsSummary[k]}</dt>
          <dd className="tabular">{rupees(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Her details as the hospital has them – to read; changes are made at reception. */
export function ProfileCard({ lang }) {
  const h = accountWords(lang).home;
  const { data, error } = useLoad('/records/profile');
  const rows = data
    ? [
        ['fullName', data.fullName],
        ['mrn', data.mrn],
        ['age', data.age != null ? String(data.age) : ''],
        ['phone', data.phone],
        ['email', data.email ?? ''],
        ['address', data.address],
        ['hospital', data.hospital],
      ].filter(([, v]) => v)
    : [];
  return (
    <section className="card portal-card" aria-labelledby="portal-profile">
      <h2 id="portal-profile">
        <UserRound aria-hidden="true" /> {accountWords(lang).tabs.profile}
      </h2>
      <Alert type="error">{error ? portalError(error, lang) : null}</Alert>
      {!data && !error && <p className="muted" aria-busy="true">…</p>}
      {data && (
        <dl className="portal-profile">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{h.profile[k]}</dt>
              <dd className={k === 'mrn' || k === 'phone' ? 'tabular' : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="hint">{h.profileNote}</p>
    </section>
  );
}

export { useLoad };
