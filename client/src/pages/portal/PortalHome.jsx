import { useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, Check, ChevronRight, CircleCheck, CircleSlash, Clock, FlaskConical, HeartPulse, Phone, Pill, Receipt, TriangleAlert } from 'lucide-react';
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

/** Good morning / afternoon / evening, by the hour on her phone. */
export const greetingFor = (hour) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * "Your next appointment" with the doctor, or the one clear next step: Book an appointment (the screen's primary).
 * welcome: Home's top card – a greeting by the time of day with her first name and the hospital (owner, 20 Oct 2026:
 * friendlier, so patients like coming back), then the appointment.
 */
export function NextAppointment({ data, summary, bookingOn, lang, onBook, welcome = false, now = new Date() }) {
  const w = portalWords(lang);
  const h = accountWords(lang).home;
  const date = summary?.appointment?.date ?? data.appointment;
  const start = summary?.appointment?.start ?? data.appointmentTime;
  const doctor = summary?.appointment?.doctorName ?? null;
  return (
    <section className={`card portal-card portal-next${welcome ? ' portal-welcome' : ''}`} aria-labelledby="portal-next">
      {welcome && (
        <div className="portal-welcome-head">
          <span className="portal-welcome-icon" aria-hidden="true">
            <HeartPulse />
          </span>
          <div>
            <h1 className="portal-welcome-title">
              {h.greet[greetingFor(now.getHours())]}, {firstName(data.patient?.fullName)}
            </h1>
            <p className="portal-welcome-line">{h.heroLine(data.hospital?.name ?? '')}</p>
          </div>
        </div>
      )}
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

/**
 * "Your next steps": what needs her attention, each with Open – the first thing coming up in her care plan, lab
 * reports ready to see, and money still to pay. With nothing waiting: a calm line.
 */
export function NextSteps({ summary, planLine, lang, onOpen }) {
  const h = accountWords(lang).home;
  if (!summary) return null;
  // (her appointment is in the welcome card just above, with its button)
  const steps = [
    planLine && { key: 'plan', Icon: HeartPulse, tone: 'is-plan', text: <><strong>{h.stepPlan}:</strong> {planLine}</> },
    summary.lab > 0 && { key: 'lab', Icon: FlaskConical, tone: 'is-lab', text: h.stepReports(summary.lab) },
    summary.toPayPaise > 0 && { key: 'bills', Icon: Receipt, tone: 'is-bills', text: h.stepPay(rupees(summary.toPayPaise)) },
  ].filter(Boolean);

  return (
    <section className="card portal-card portal-steps" aria-labelledby="portal-steps">
      <h2 id="portal-steps">
        <CircleCheck aria-hidden="true" /> {h.nextSteps}
      </h2>
      {!steps.length && <p className="muted portal-steps-calm">{h.stepAllDone}</p>}
      <ul className="portal-step-list">
        {steps.map(({ key, Icon, tone, text }) => (
          <li key={key} className={tone}>
            <span className="portal-step-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="portal-step-text">{text}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(key)}>
              {h.open} <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
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
            <button type="button" className={`card portal-glance-card is-${key}`} onClick={() => onOpen(key)}>
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

export { useLoad };
