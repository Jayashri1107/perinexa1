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
  BedDouble,
  FileSearch,
  Footprints,
  Hourglass,
  IndianRupee,
  Undo2,
  Syringe,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hospitalOverviewApi, todayApi, wardsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { appointmentLook, whenText, whoText } from '../appointments/appointmentFormat.js';
import { BillingDesk } from '../billing/BillingDesk.jsx';
import { BookedBedsCard, bedCounts } from '../inpatient/BookedBeds.jsx';
import { InHospitalCard } from '../inpatient/InHospitalCard.jsx';
import { NursingTodayCard } from '../nursing/NursingTodayCard.jsx';
import { NurseToday } from '../nursing/NurseToday.jsx';
import { TodayBooking } from './TodayBooking.jsx';
import { PrescriptionOrdersCard } from '../dispensing/PrescriptionOrdersCard.jsx';

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
  // Money owed: overdue first (red), then part paid (amber), then the rest not paid yet
  const b = today.billing;
  if (b?.overdueBills) {
    items.push({ icon: AlertTriangle, tone: 'danger', text: `${plural(b.overdueBills, 'bill')} overdue`, hint: `${formatMoney(b.overdueOwed)} owed for more than ${b.overdueDays} days.`, to: '/hospital/billing?status=overdue', action: 'View overdue' });
  }
  if (b?.partialBills) {
    items.push({ icon: Hourglass, tone: 'warning', text: `${plural(b.partialBills, 'bill')} part paid`, hint: `${formatMoney(b.partialOwed)} still to collect.`, to: '/hospital/billing?status=partial', action: 'Collect' });
  }
  const otherUnpaid = (b?.unpaidBills ?? 0) - (b?.partialBills ?? 0);
  if (otherUnpaid > 0) {
    items.push({ icon: Receipt, text: `${plural(otherUnpaid, 'bill')} not paid yet`, hint: `${formatMoney(Math.max(0, b.owed - b.partialOwed))} owed in all.`, to: '/hospital/billing/unpaid', action: 'See unpaid' });
  }
  if (today.unsignedVisits) items.push({ icon: FileText, text: `${plural(today.unsignedVisits, 'visit')} of today not signed`, hint: 'Sign them once the findings and prescription are complete.', to: '/hospital/patients', action: 'Find the patient' });
  if (today.lab?.toReview) items.push({ icon: FlaskConical, text: `${plural(today.lab.toReview, 'lab result')} to review`, hint: 'Results of your patients and your orders.', to: '/hospital/lab', action: 'Review' });
  if (today.lab?.toReport) items.push({ icon: FlaskConical, text: `${plural(today.lab.toReport, 'lab order')} waiting for results`, hint: today.lab.toCollect ? `${plural(today.lab.toCollect, 'sample')} still to take.` : 'Samples taken.', to: '/hospital/lab', action: 'Open the lab' });
  if (today.pharmacy?.lowStock) items.push({ icon: PackageMinus, text: `${plural(today.pharmacy.lowStock, 'medicine')} running low`, hint: 'At or below the reorder level.', to: '/hospital/pharmacy/stock', action: 'See stock' });
  if (today.pharmacy?.expired) items.push({ icon: CalendarX, tone: 'danger', text: `${plural(today.pharmacy.expired, 'batch', 'batches')} expired but still in stock`, hint: 'Write them off or return them.', to: '/hospital/pharmacy/expiring', action: 'See them' });
  if (today.pharmacy?.expiringSoon) {
    const ph = today.pharmacy;
    const names = ph.expiringNames.join(', ') + (ph.expiringMedicines > ph.expiringNames.length ? ` and ${ph.expiringMedicines - ph.expiringNames.length} more` : '');
    items.push({ icon: AlertTriangle, tone: 'warning', text: `${plural(ph.expiringMedicines, 'medicine')} expire${ph.expiringMedicines === 1 ? 's' : ''} within ${ph.expiryAlertDays} days`, hint: `${names}. Sell first or return in time.`, to: '/hospital/pharmacy/expiring', action: 'See them' });
  }
  return items;
}

// The common jobs, for the roles this person has.
const QUICK_ACTIONS = [
  { access: 'registerPatients', icon: UserPlus, label: 'Register a patient', to: '/hospital/patients/new' },
  { access: 'patients', icon: HeartPulse, label: 'Find a patient', to: '/hospital/patients' },
  { access: 'registrationMenu', icon: BedDouble, label: 'Admit a patient', to: '/hospital/admissions' },
  { access: 'registrationMenu', icon: DoorOpen, label: 'Discharges', to: '/hospital/discharges' },
  { access: 'appointments', icon: CalendarClock, label: 'Appointments', to: '/hospital/appointments' },
  { access: 'calendar', icon: CalendarDays, label: 'Calendar', to: '/hospital/calendar' },
  { access: 'lab', icon: FlaskConical, label: 'Lab', to: '/hospital/lab' },
  { access: 'library', icon: Library, label: 'Clinic library', to: '/hospital/library' },
  { access: 'billing', icon: Receipt, label: 'Make a bill', to: '/hospital/billing/new' },
  { access: 'billing', icon: IndianRupee, label: 'Collect a payment', to: '/hospital/billing/unpaid' },
  { access: 'billing', icon: FileSearch, label: 'Find a bill', to: '/hospital/billing' },
  { access: 'billing', icon: Banknote, label: "Today's cash summary", to: '/hospital/billing/daily' },
  { access: 'pharmacyCounter', icon: Pill, label: 'Sell medicines', to: '/hospital/pharmacy' },
  { access: 'pharmacyCounter', icon: PackagePlus, label: 'Record a purchase', to: '/hospital/pharmacy/purchases/new' },
  { access: 'admin', icon: Users, label: 'Add or manage staff', to: '/hospital/staff' },
  { access: 'billingAdmin', icon: FileText, label: 'Price list', to: '/hospital/billing/price-list' },
  { access: 'pharmacy', icon: ClipboardList, label: 'Pharmacy stock', to: '/hospital/pharmacy/stock' },
  { access: 'analytics', icon: ChartColumn, label: 'Analytics', to: '/hospital/analytics' },
  { access: 'admin', icon: Settings, label: 'Hospital settings', to: '/hospital/settings/letterhead' },
];

// The area tab last chosen (kept in this browser; storage may be blocked – then the first area).
const AREA_KEY = 'perinexa1:todayArea';
function readArea() {
  try {
    return localStorage.getItem(AREA_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveArea(key) {
  try {
    localStorage.setItem(AREA_KEY, key);
  } catch {
    /* not remembered – fine */
  }
}

// A nurse (and only a nurse) gets her own Today: what is due on her ward (owner, 9 Oct 2026).
export function TodayPage() {
  const { roles } = useAuth();
  if (roles.length > 0 && roles.every((r) => r === 'nurse')) return <NurseToday />;
  return <GeneralToday />;
}

function GeneralToday() {
  const { user, activeMembership, roles, canAccess, isHospitalAdmin } = useAuth();
  const { roleLabel } = useAppConfig();
  const [today, setToday] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  // the front desk: the beds, each booked one with the patient in it
  const frontDesk = canAccess('registrationMenu');
  const [beds, setBeds] = useState(null);
  useEffect(() => {
    todayApi.get().then(setToday).catch((err) => setError(err.message));
    if (isHospitalAdmin) hospitalOverviewApi.get().then(setOverview).catch(() => setOverview(null));
    if (frontDesk) wardsApi.availability().then(setBeds).catch(() => setBeds(null));
  }, [isHospitalAdmin, frontDesk]);
  const bedTotals = bedCounts(beds);

  const firstName = user.name.split(' ')[0];
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const actions = QUICK_ACTIONS.filter((a) => canAccess(a.access)).slice(0, 8);
  const attention = today ? attentionItems(today, overview) : [];
  const [allAttention, setAllAttention] = useState(false);
  const [area, setArea] = useState(readArea);
  const choose = (key) => {
    setArea(key);
    saveArea(key);
  };

  // The areas of this person's work (owner, 8 Oct 2026): each holds its numbers and its cards, shown one at a time
  // under tabs – so someone with many roles (the super admin) gets a clean page; one area: no tabs.
  const areas = today
    ? [
        {
          key: 'desk',
          label: 'Front desk',
          icon: CalendarClock,
          stats: [
            today.frontDesk && <StatCard key="appts" icon={CalendarClock} to="/hospital/appointments" label="Appointments today" value={today.frontDesk.appointments} hint={`${today.frontDesk.seen} seen · ${today.frontDesk.notArrived} not arrived yet`} tone="info" />,
            today.frontDesk && <StatCard key="waiting" icon={Hourglass} to="/hospital/appointments" label="Waiting now" value={today.frontDesk.waiting} hint="Arrived, not seen yet" tone="warning" />,
            today.frontDesk && <StatCard key="walkins" icon={Footprints} to="/hospital/appointments" label="Walk-ins today" value={today.frontDesk.walkIns} hint="Came without an appointment" />,
            today.frontDesk && <StatCard key="inhospital" icon={BedDouble} to="/hospital/admissions" label="In hospital now" value={today.frontDesk.inHospital} hint={`${today.frontDesk.admittedToday} admitted · ${today.frontDesk.dischargedToday} discharged today`} tone="neutral" />,
            beds && bedTotals.total > 0 && <StatCard key="beds" icon={BedDouble} to="/hospital/admissions" label="Beds booked" value={`${bedTotals.booked} of ${bedTotals.total}`} hint={`${bedTotals.free} free`} tone={bedTotals.free === 0 ? 'danger' : 'primary'} />,
            today.servicesToBill != null && <StatCard key="services" icon={Syringe} to="/hospital/billing/services" label="Nursing services to bill" value={today.servicesToBill} hint="Injections, dressings … from nurses" tone={today.servicesToBill ? 'warning' : 'neutral'} />,
            today.patients && <StatCard key="registered" icon={UserPlus} to={canAccess('patients') ? '/hospital/patients' : undefined} label="Registered today" value={today.patients.registeredToday} hint={`${plural(today.patients.active, 'patient')} under care`} />,
          ],
          cards: [
            canAccess('dispense') && !canAccess('pharmacyCounter') && <PrescriptionOrdersCard key="rx" />,
            beds && bedTotals.total > 0 && <BookedBedsCard key="beds" beds={beds} />,
          ],
        },
        {
          key: 'clinical',
          label: 'My patients',
          icon: HeartPulse,
          stats: [
            today.appointments && <StatCard key="myappts" icon={CalendarClock} to="/hospital/appointments" label="My appointments today" value={today.appointments.total} hint={`${today.appointments.seen} seen · ${today.appointments.arrived} waiting`} tone="info" />,
            today.doctor && <StatCard key="mine" icon={HeartPulse} to="/hospital/patients" label="My patients" value={today.doctor.mine} hint="Under my care" />,
          ],
          cards: [
            today.appointments && (
              <section key="waiting" className="card">
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
            ),
            roles.includes('nurse') && <NursingTodayCard key="nursing" />,
            canAccess('patientsClinical') && <InHospitalCard key="inhospital" />,
            today.doctor && (
              <section key="due" className="card">
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
            ),
          ],
        },
        {
          key: 'billing',
          label: 'Billing',
          icon: Receipt,
          stats: [
            today.billing && <StatCard key="bills" icon={Receipt} to="/hospital/billing" label="Bills today" value={today.billing.billsToday} hint={`${formatMoney(today.billing.billedToday)} billed`} tone="info" />,
            today.billing && <StatCard key="received" icon={Banknote} to="/hospital/billing/daily" label="Received today" value={formatMoney(today.billing.receivedToday)} hint={plural(today.billing.paymentsToday, 'payment')} tone="success" />,
            today.billing && <StatCard key="owed" icon={Hourglass} to="/hospital/billing/unpaid" label="Outstanding" value={formatMoney(today.billing.owed)} hint={plural(today.billing.unpaidBills, 'unpaid bill')} tone={today.billing.overdueBills ? 'danger' : 'warning'} />,
            today.billing && <StatCard key="refunds" icon={Undo2} to="/hospital/billing/daily" label="Refunds today" value={formatMoney(today.billing.refundedToday)} hint={plural(today.billing.refundsToday, 'refund')} tone="neutral" />,
          ],
          // the billing desk: for the billing department and the hospital admin (reception keeps the numbers)
          cards: [today.billing && (roles.includes('billing') || isHospitalAdmin) && <BillingDesk key="desk" billing={today.billing} />],
        },
        {
          key: 'pharmacy',
          label: 'Pharmacy',
          icon: Pill,
          stats: [
            today.pharmacy && <StatCard key="sales" icon={Pill} to="/hospital/pharmacy/sales" label="Pharmacy sales today" value={today.pharmacy.salesToday} hint={formatMoney(today.pharmacy.soldToday)} tone="info" />,
            today.pharmacy && <StatCard key="low" icon={PackageMinus} to="/hospital/pharmacy/stock" label="Low stock" value={today.pharmacy.lowStock} hint="At or below the reorder level" tone={today.pharmacy.lowStock ? 'warning' : 'neutral'} />,
            today.pharmacy && (
              <StatCard
                key="expiring"
                icon={AlertTriangle}
                to="/hospital/pharmacy/expiring"
                label={`Expiring in ${today.pharmacy.expiryAlertDays} days`}
                value={today.pharmacy.expiringMedicines}
                hint={today.pharmacy.expiringNames.length ? today.pharmacy.expiringNames.join(', ') : 'No medicine expires soon'}
                tone={today.pharmacy.expiringMedicines ? 'danger' : 'neutral'}
              />
            ),
          ],
          cards: [canAccess('pharmacyCounter') && <PrescriptionOrdersCard key="rx" />],
        },
        {
          key: 'hospital',
          label: 'Hospital',
          icon: Settings,
          stats: [],
          cards: [
            isHospitalAdmin && overview && (
              <section key="hospital" className="card">
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
            ),
          ],
        },
      ]
        .map((a) => ({ ...a, stats: a.stats.filter(Boolean), cards: a.cards.filter(Boolean) }))
        .filter((a) => a.stats.length || a.cards.length)
    : [];
  const current = areas.find((a) => a.key === area) ?? areas[0];
  const shownAttention = allAttention ? attention : attention.slice(0, 4);

  return (
    <>
      <header className="today-hero">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">{activeMembership?.hospital.name} · {dateText}</p>
        </div>
        <div className="today-roles">
          {user.isSuperAdmin ? (
            <span className="pill pill-strong">Super admin · every role</span>
          ) : (
            <>
              {roles.slice(0, 3).map((r) => <span key={r} className="pill pill-strong">{roleLabel(r)}</span>)}
              {roles.length > 3 && <span className="pill">+{roles.length - 3}</span>}
            </>
          )}
        </div>
      </header>

      {frontDesk && <TodayBooking />}

      <Alert type="error">{error}</Alert>
      {!today && !error && <Loader />}

      {today && (
        <>
          <div className="grid-2 today-grid today-top">
            <section className="card">
              <div className="card-head">
                <h2>Needs your attention {attention.length > 0 && <span className="rxq-count">{attention.length}</span>}</h2>
              </div>
              {attention.length === 0 ? (
                <p className="all-clear"><CircleCheck size={18} aria-hidden /> All clear – nothing needs you right now.</p>
              ) : (
                <>
                  <ul className="attention">
                    {shownAttention.map((a) => (
                      <li key={a.text} className={a.tone ? `attention-${a.tone}` : undefined}>
                        <span className="attention-icon" aria-hidden><a.icon size={18} /></span>
                        <span className="attention-text">
                          <strong className="block">{a.text}</strong>
                          <span className="muted small">{a.hint}</span>
                        </span>
                        <Link to={a.to} className="btn btn-ghost btn-sm">{a.action} <ArrowRight size={14} aria-hidden /></Link>
                      </li>
                    ))}
                  </ul>
                  {attention.length > 4 && (
                    <button type="button" className="btn btn-link btn-sm top-gap-sm" onClick={() => setAllAttention((v) => !v)}>
                      {allAttention ? 'Show fewer' : `Show all ${attention.length}`}
                    </button>
                  )}
                </>
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
          </div>

          {current && (
            <section className="today-area">
              <div className="today-area-head">
                <h2 className="today-title">Today at a glance{areas.length === 1 ? '' : ` – ${current.label}`}</h2>
                {areas.length > 1 && (
                  <div className="today-tabs" role="tablist" aria-label="Areas of work">
                    {areas.map((a) => (
                      <button key={a.key} type="button" role="tab" aria-selected={a.key === current.key} className={a.key === current.key ? 'on' : ''} onClick={() => choose(a.key)}>
                        <a.icon size={15} aria-hidden /> {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {current.stats.length > 0 && <div className="stat-grid today-stats">{current.stats}</div>}
              {current.cards.length > 0 && <div className="grid-2 today-grid">{current.cards}</div>}
            </section>
          )}
        </>
      )}
    </>
  );
}
