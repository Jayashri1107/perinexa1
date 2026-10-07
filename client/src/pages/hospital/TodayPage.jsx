// Today: the start page in a hospital, friendly and role-aware –
//  1. a greeting with the hospital and the date,
//  2. today at a glance (only the numbers this person's work needs; each opens its page),
//  3. what needs attention (each item says what to do and links there; "All clear" when nothing does),
//  4. quick actions for the common jobs, and – for doctors – today's appointments and their pregnancies due soon.
import {
  AlertTriangle,
  ArrowRight,
  Baby,
  Banknote,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CircleCheck,
  ClipboardList,
  DoorOpen,
  FileText,
  FlaskConical,
  HeartPulse,
  KeyRound,
  Library,
  PackageMinus,
  PackagePlus,
  Pill,
  Receipt,
  Settings,
  ChartColumn,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hospitalOverviewApi, todayApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { appointmentLook, whenText, whoText } from '../appointments/appointmentFormat.js';
import { InHospitalCard } from '../inpatient/InHospitalCard.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What needs attention, from today's numbers and (for the admin) the hospital overview.
function attentionItems(today, overview) {
  const items = [];
  if (overview) {
    const { staff, opd, setup } = overview;
    if (staff.pendingFirstLogin) items.push({ icon: KeyRound, text: `${plural(staff.pendingFirstLogin, 'staff member has', 'staff members have')} not logged in yet`, hint: 'They are still on a temporary password.', to: '/hospital/staff', action: 'See staff' });
    if (opd.withoutTimings) items.push({ icon: CalendarClock, text: `${plural(opd.withoutTimings, 'doctor has', 'doctors have')} no OPD timings`, hint: 'Patients cannot be booked with them.', to: '/hospital/opd-timings', action: 'Set timings' });
    const SETUP = {
      letterhead: { to: '/hospital/settings/letterhead', hint: 'Printed at the top of bills, prescriptions and reports.' },
      registration: { to: '/hospital/settings/letterhead', hint: 'Printed on bills, prescriptions and reports.' },
      abdm: { to: '/hospital/settings/abdm', hint: "Needed to link patients' ABHA health IDs." },
    };
    for (const s of setup.filter((x) => !x.done && SETUP[x.key])) {
      items.push({ icon: Settings, text: `${s.label} is not filled in`, hint: SETUP[s.key].hint, to: SETUP[s.key].to, action: 'Fill in' });
    }
  }
  if (today.billing?.unpaidBills) {
    items.push({ icon: Receipt, text: `${plural(today.billing.unpaidBills, 'bill')} not fully paid`, hint: `${formatMoney(today.billing.owed)} still owed.`, to: '/hospital/billing/unpaid', action: 'See unpaid' });
  }
  if (today.unsignedVisits) items.push({ icon: FileText, text: `${plural(today.unsignedVisits, 'visit')} of today not signed`, hint: 'Sign them once the findings and prescription are complete.', to: '/hospital/patients', action: 'Find the patient' });
  if (today.lab?.toReview) items.push({ icon: FlaskConical, text: `${plural(today.lab.toReview, 'lab result')} to review`, hint: 'Results of your patients and your orders.', to: '/hospital/lab', action: 'Review' });
  if (today.lab?.toReport) items.push({ icon: FlaskConical, text: `${plural(today.lab.toReport, 'lab order')} waiting for results`, hint: today.lab.toCollect ? `${plural(today.lab.toCollect, 'sample')} still to take.` : 'Samples taken.', to: '/hospital/lab', action: 'Open the lab' });
  if (today.pharmacy?.lowStock) items.push({ icon: PackageMinus, text: `${plural(today.pharmacy.lowStock, 'medicine')} running low`, hint: 'At or below the reorder level.', to: '/hospital/pharmacy/stock', action: 'See stock' });
  if (today.pharmacy?.expired) items.push({ icon: CalendarX, text: `${plural(today.pharmacy.expired, 'batch', 'batches')} expired but still in stock`, hint: 'Write them off or return them.', to: '/hospital/pharmacy/reports', action: 'See expiry' });
  if (today.pharmacy?.expiringSoon) items.push({ icon: AlertTriangle, text: `${plural(today.pharmacy.expiringSoon, 'batch', 'batches')} expiring soon`, hint: 'Sell or return them in time.', to: '/hospital/pharmacy/reports', action: 'See expiry' });
  return items;
}

// The common jobs, for the roles this person has.
const QUICK_ACTIONS = [
  { access: 'registerPatients', icon: UserPlus, label: 'Register a patient', to: '/hospital/patients/new' },
  { access: 'patients', icon: HeartPulse, label: 'Find a patient', to: '/hospital/patients' },
  { access: 'appointments', icon: CalendarClock, label: 'Appointments', to: '/hospital/appointments' },
  { access: 'calendar', icon: CalendarDays, label: 'Calendar', to: '/hospital/calendar' },
  { access: 'lab', icon: FlaskConical, label: 'Lab', to: '/hospital/lab' },
  { access: 'library', icon: Library, label: 'Clinic library', to: '/hospital/library' },
  { access: 'billing', icon: Receipt, label: 'Make a bill', to: '/hospital/billing/new' },
  { access: 'billing', icon: Banknote, label: "Today's cash summary", to: '/hospital/billing/daily' },
  { access: 'pharmacyCounter', icon: Pill, label: 'Sell medicines', to: '/hospital/pharmacy' },
  { access: 'pharmacyCounter', icon: PackagePlus, label: 'Record a purchase', to: '/hospital/pharmacy/purchases/new' },
  { access: 'admin', icon: Users, label: 'Add or manage staff', to: '/hospital/staff' },
  { access: 'billingAdmin', icon: FileText, label: 'Price list', to: '/hospital/billing/price-list' },
  { access: 'pharmacy', icon: ClipboardList, label: 'Pharmacy stock', to: '/hospital/pharmacy/stock' },
  { access: 'analytics', icon: ChartColumn, label: 'Analytics', to: '/hospital/analytics' },
  { access: 'admin', icon: Settings, label: 'Hospital settings', to: '/hospital/settings/letterhead' },
];

export function TodayPage() {
  const { user, activeMembership, roles, canAccess, isHospitalAdmin } = useAuth();
  const { roleLabel } = useAppConfig();
  const [today, setToday] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    todayApi.get().then(setToday).catch((err) => setError(err.message));
    if (isHospitalAdmin) hospitalOverviewApi.get().then(setOverview).catch(() => setOverview(null));
  }, [isHospitalAdmin]);

  const firstName = user.name.split(' ')[0];
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const actions = QUICK_ACTIONS.filter((a) => canAccess(a.access)).slice(0, 8);
  const attention = today ? attentionItems(today, overview) : [];

  return (
    <>
      <header className="today-hero">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">{activeMembership?.hospital.name} · {dateText}</p>
        </div>
        <div className="today-roles">
          {roles.slice(0, 3).map((r) => <span key={r} className="pill pill-strong">{roleLabel(r)}</span>)}
          {roles.length > 3 && <span className="pill">+{roles.length - 3}</span>}
        </div>
      </header>

      <Alert type="error">{error}</Alert>
      {!today && !error && <Loader />}

      {today && (
        <>
          <h2 className="today-title">Today at a glance</h2>
          <div className="stat-grid">
            {today.patients && <StatCard icon={UserPlus} to={canAccess('patients') ? '/hospital/patients' : undefined} label="Registered today" value={today.patients.registeredToday} hint={`${plural(today.patients.active, 'patient')} under care`} />}
            {today.billing && <StatCard icon={Receipt} to="/hospital/billing" label="Bills today" value={today.billing.billsToday} hint={`${formatMoney(today.billing.billedToday)} billed`} tone="info" />}
            {today.billing && <StatCard icon={Banknote} to="/hospital/billing/daily" label="Received today" value={formatMoney(today.billing.collectedToday)} hint="After refunds" tone="neutral" />}
            {today.pharmacy && <StatCard icon={Pill} to="/hospital/pharmacy/sales" label="Pharmacy sales today" value={today.pharmacy.salesToday} hint={formatMoney(today.pharmacy.soldToday)} tone="warning" />}
            {today.appointments && <StatCard icon={CalendarClock} to="/hospital/appointments" label="My appointments today" value={today.appointments.total} hint={`${today.appointments.seen} seen · ${today.appointments.arrived} waiting`} tone="info" />}
            {today.doctor && <StatCard icon={HeartPulse} to="/hospital/patients" label="My patients" value={today.doctor.mine} hint="Under my care" />}
          </div>

          <div className="grid-2 today-grid">
            <section className="card">
              <h2>Needs your attention</h2>
              {attention.length === 0 ? (
                <p className="all-clear"><CircleCheck size={18} aria-hidden /> All clear – nothing needs you right now.</p>
              ) : (
                <ul className="attention">
                  {attention.map((a) => (
                    <li key={a.text}>
                      <span className="attention-icon" aria-hidden><a.icon size={18} /></span>
                      <span className="attention-text">
                        <strong className="block">{a.text}</strong>
                        <span className="muted small">{a.hint}</span>
                      </span>
                      <Link to={a.to} className="btn btn-ghost btn-sm">{a.action} <ArrowRight size={14} aria-hidden /></Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Quick actions</h2>
              <div className="quick-actions">
                {actions.map((a) => (
                  <Link key={a.label} to={a.to} className="quick-action">
                    <span className="sb-tile" aria-hidden><a.icon size={18} /></span>
                    <span>{a.label}</span>
                  </Link>
                ))}
              </div>
            </section>

            {today.appointments && (
              <section className="card">
                <div className="card-head">
                  <h2><DoorOpen size={18} aria-hidden /> Waiting for me</h2>
                  <Link to="/hospital/appointments" className="small">My day <ArrowRight size={12} aria-hidden /></Link>
                </div>
                {today.appointments.waiting.length === 0 && <p className="muted">Nobody is waiting.</p>}
                <ol className="plain-list rows">
                  {today.appointments.waiting.map((a) => (
                    <li key={a.id}>
                      {a.patient ? <Link to={`/hospital/patients/${a.patient.id}`}>{whoText(a)}</Link> : whoText(a)}
                      <span className="muted small">{whenText(a)}</span>
                    </li>
                  ))}
                </ol>
                {today.appointments.next.length > 0 && (
                  <>
                    <h3 className="top-gap-sm">Coming next</h3>
                    <ul className="plain-list rows">
                      {today.appointments.next.map((a) => (
                        <li key={a.id}>
                          <span><strong>{a.start}</strong> {whoText(a)}</span>
                          <StateBadge look={appointmentLook(a)} small />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {canAccess('patientsClinical') && <InHospitalCard />}

            {today.doctor && (
              <section className="card">
                <h2><Baby size={18} aria-hidden /> Due in the next {today.doctor.dueSoonDays} days</h2>
                {today.doctor.dueSoon.length === 0 && <p className="muted">None of my patients is due soon.</p>}
                <ul className="plain-list rows">
                  {today.doctor.dueSoon.map((p) => (
                    <li key={p.id}>
                      <Link to={`/hospital/patients/${p.id}`}>{p.name}</Link>
                      <span className="muted small">{p.patientNumber} · EDD {formatDate(p.edd)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isHospitalAdmin && overview && (
              <section className="card">
                <div className="card-head">
                  <h2>Your hospital</h2>
                  <Link to="/hospital/admin" className="small">Overview <ArrowRight size={12} aria-hidden /></Link>
                </div>
                <dl className="details">
                  <dt>Staff</dt><dd>{overview.staff.active} active · {overview.staff.admins} admin{overview.staff.admins === 1 ? '' : 's'}</dd>
                  <dt>Doctors</dt><dd>{overview.opd.doctors}</dd>
                  <dt>Setup</dt><dd>{overview.setup.filter((s) => s.done).length} of {overview.setup.length} done</dd>
                  <dt>Messages</dt><dd>Reminders {overview.messaging.remindersEnabled ? 'on' : 'off'} · Portal {overview.messaging.portalEnabled ? 'on' : 'off'}</dd>
                </dl>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
