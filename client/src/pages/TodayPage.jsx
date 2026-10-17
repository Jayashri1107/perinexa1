import { useEffect, useState } from 'react';
import { Tip } from '../components/Tip.jsx';
import { Archive, Baby, BadgeCheck, Banknote, BedDouble, CalendarPlus, DoorOpen, FlaskConical, PhoneCall, Receipt, TestTube, CalendarClock, CalendarX2, ClipboardList, Clock, Hash, PenLine, Phone, TriangleAlert, UserCheck, UserPlus, Users, Wallet } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatNumber } from '../components/DataTable.jsx';
import { MenuButton } from '../components/MenuButton.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Alert, KpiCard, StatusPill, formatDate, formatDateTime, formatTime } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { CARE_PLAN_ROLES, canBookAppointments, canRegisterPatients, canSeeAppointments, canSeeCalendar, hospitalModules } from '../platform/modules.js';
import { rupees } from './billing/billingFormat.js';
import { ScanShareSection } from './abdm/ScanShare.jsx';
import { SignupsNotice, SignupsSection } from './patients/SignupsPage.jsx';
import { ContinueVisits } from './visits/ContinueVisits.jsx';
import { MyDayCard } from './MyDayCard.jsx';
import { BillingToday } from './billing/BillingToday.jsx';
import { PharmacyToday } from './pharmacy/PharmacyToday.jsx';
import { HandoverList, VITALS_DUE_HOURS, WardToday, vitalsDue } from './inpatient/NurseToday.jsx';
import { timeLabel } from './appointments/appointmentFormat.js';
import { OpdCasePaper } from './beds/AdmissionDesk.jsx';
import { AppointmentChip, ArrivalDialog, NeedsTimeNotice, QuickBookingsSection, TokenButton, TokenSlip, WaitingLists } from './appointments/TodayAppointments.jsx';
import { AiBriefCard } from './ai/AiBriefCard.jsx';
import { useLibraryDrafts } from './library/ApprovalsPage.jsx';
import { KIND_LABELS } from './inpatient/inpatientFormat.js';
import { FLAG_LOOK, testNames } from './lab/labFormat.js';
import { NEW_PATIENT_LINKS } from './patients/patientFormat.js';
import { ReminderDialog } from './reminders/ReminderDialog.jsx';
import { DischargesSection, DoctorsToday, TomorrowCalls } from './appointments/DeskToday.jsx';
import { paymentsToCollect, receptionCounts } from './todayReception.js';
import { RedFlagItems, RedFlagRulesNote } from './redflags/RedFlagList.jsx';
import { notCheckedCareText } from './redflags/redFlagFormat.js';
import { CarePlanSection, FlagCountPill, PatientRow, RedFlagsSection, Section, VaccinationsOverdueSection, VisitProgress, VisitsTodaySection } from './worklist/WorklistSections.jsx';

// The start page: one place for the day (Dashboard, Worklist and today's Calendar together, plus Feature 10's
// daily lists). In this order, each part only for the roles it is for:
//  - red flags (doctors, RMOs, nurses – the worklist): from visits, lab results and, in hospital, the nursing chart;
//    the "In hospital" list repeats each admitted patient's flags beside her name;
//  - today's patients: booked for today, arrived (and when) or still expected, and those who came without a
//    booking; for clinicians with the visit's progress (doctors, RMOs, reception – GET /api/today; nurses see the
//    visits started today);
//  - reception's call lists: visits due now and overdue, with phone numbers; and babies due (a vaccination that
//    became overdue in the last six weeks, nothing booked) in general words – never what is due; a baby whose
//    schedule no doctor has approved yet is marked "Draft schedule" (ask the doctor before calling);
//  - care plan to act on, and babies' vaccinations overdue with the vaccines by name (doctors, RMOs, nurses);
//  - a few counts: high-risk pregnancies, overrides to review, active staff (admins).

const has = (roles, list) => roles.some((r) => list.includes(r));

// The hospital admin's dashboard: one tile per role (owner, 12 Oct 2026)
const STAFF_ROLE_TILES = [
  { role: 'doctor', label: 'Doctors' },
  { role: 'rmo', label: 'RMOs' },
  { role: 'nurse', label: 'Nurses' },
  { role: 'receptionist', label: 'Receptionists' },
  { role: 'lab', label: 'Lab' },
  { role: 'pharmacist', label: 'Pharmacy' },
  { role: 'billing', label: 'Accounts' },
];

function TodaysPatients({ rows, progress, showDoctor, canMark, onMark, onUndo, onSlip, busy }) {
  return (
    <Section id="td-patients" icon={Users} title="Today's patients" count={rows.length} empty="Nobody is booked for today, and no visit has been started yet.">
      <ul className="wl-list">
        {rows.map((r) => {
          const visit = r.visitId ? progress.get(r.visitId) : null;
          return (
            <PatientRow
              key={r.patient.id}
              patient={{ ...r.patient, assignedDoctorName: showDoctor ? r.patient.doctorName : null }}
              to={r.visitId ? `/patients/${r.patient.id}/visits/${r.visitId}` : undefined}
              openLabel={r.visitId ? 'Open the visit' : 'Open the record'}
              marker={<AppointmentChip appointment={r.appointment} />}
            >
              <div className="wl-row-head">
                <span className="wl-counts">
                  {r.arrivedAt ? (
                    <StatusPill tone="stable" icon={UserCheck}>
                      Arrived · {formatTime(r.arrivedAt)}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="due" icon={Clock}>
                      Expected
                    </StatusPill>
                  )}
                  {canMark && !r.arrivedAt && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMark(r.patient)} disabled={busy === r.patient.id}>
                      <UserCheck aria-hidden="true" /> Mark arrived
                    </button>
                  )}
                  {canMark && r.arrivalMarked && !r.visitStarted && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => onUndo(r.patient)} disabled={busy === r.patient.id} aria-label={`Undo arrival of ${r.patient.fullName}`}>
                      Undo
                    </button>
                  )}
                  {r.appointment?.kind === 'token' && <TokenButton appointment={{ ...r.appointment, doctor: { name: r.appointment.doctorName } }} onPrint={onSlip} />}
                  {visit && <VisitProgress visit={visit} />}
                </span>
              </div>
              <p className="hint">
                {r.appointment?.kind === 'token' ? `Walk-in, token ${r.appointment.token}` : r.booked || r.appointment ? 'Booked for today' : 'Came without a booking'}
                {r.patient.phone ? ` · ${r.patient.phone}` : ''}
              </p>
            </PatientRow>
          );
        })}
      </ul>
    </Section>
  );
}

/** What a row of a call list shows: the line, a "Draft schedule" mark when its date comes from an unapproved schedule, and the phone. */
export function CallRow({ row, line }) {
  return (
    <>
      {row.draft && (
        <div className="wl-row-head">
          <StatusPill tone="watch" icon={TriangleAlert}>
            Draft schedule
          </StatusPill>
        </div>
      )}
      <p className="hint">{line(row)}</p>
      {row.patient.phone && (
        <a className="btn btn-link btn-sm" href={`tel:${row.patient.phone.replace(/\s+/g, '')}`}>
          <Phone aria-hidden="true" /> {row.patient.phone}
        </a>
      )}
    </>
  );
}

function CallList({ id, icon, title, rows, empty, line, note = null }) {
  return (
    <Section id={id} icon={icon} title={title} count={rows.length} empty={empty}>
      <ul className="wl-list">
        {rows.map((r) => (
          <PatientRow key={r.patient.id} patient={{ ...r.patient, assignedDoctorName: r.patient.doctorName }}>
            <CallRow row={r} line={line} />
          </PatientRow>
        ))}
      </ul>
      {note && <p className="hint rf-note">{note}</p>}
    </Section>
  );
}

export const overdueLine = (r) =>
  [r.bookedFor ? `Booked for ${formatDate(r.bookedFor)} – no visit recorded` : '', r.dueFrom ? `Visit was due from ${formatDate(r.dueFrom)}` : ''].filter(Boolean).join(' · ');

/** Reception's line for a baby to call: general words and the first day only – never what is due. */
export const babyDueLine = (r) => `A check-up or test was due from ${formatDate(r.dueFrom)}`;

/** The hint under reception's "Babies due" list: which babies are on it, and what "Draft schedule" means. */
export const babiesDueNote = (rows = []) =>
  `Babies for whom a check-up or test became overdue in the last 6 weeks and nothing is booked. A baby in hospital is not listed.${
    rows.some((r) => r.draft) ? ' "Draft schedule": the date comes from a schedule no doctor has approved yet – ask the doctor before calling.' : ''
  }`;

// Someone with many roles here (a super admin working in a hospital has every role): the day as a short Overview,
// or one role's full Today at a time (owner, 14 Oct 2026: "too much is displayed"). Others see their own Today.
const LENSES = [
  { key: 'overview', label: 'Overview', roles: null },
  { key: 'reception', label: 'Reception', roles: ['receptionist'] },
  { key: 'doctor', label: 'Doctor', roles: ['doctor'] },
  { key: 'ward', label: 'Ward (RMO and nurses)', roles: ['rmo', 'nurse'] },
  { key: 'lab', label: 'Lab', roles: ['lab'] },
  { key: 'pharmacy', label: 'Pharmacy', roles: ['pharmacist'] },
  { key: 'billing', label: 'Billing', roles: ['billing'] },
  { key: 'admin', label: 'Admin', roles: ['admin'] },
];
/** The views this person may choose (a role view only for roles they have), or [] when they have few roles. */
export function lensesFor(roles = []) {
  const views = LENSES.filter((l) => !l.roles || l.roles.some((r) => roles.includes(r)));
  return views.length > 3 ? views : [];
}

export function TodayPage() {
  const { activeMembership } = useAuth();
  const [params, setParams] = useSearchParams();
  const all = activeMembership.roles;
  const lenses = lensesFor(all);
  // A hospital admin with no other role (no patient data): the Overview, in numbers only
  if (!lenses.length && all.includes('admin') && !all.some((r) => ['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing'].includes(r))) {
    return <OverviewToday roles={all} />;
  }
  if (!lenses.length) return <RoleToday roles={all} />;
  const lens = lenses.find((l) => l.key === params.get('view')) ?? lenses[0];
  const choose = (key) => setParams(key === 'overview' ? {} : { view: key }, { replace: true });
  const bar = (
    <div className="td-lens" role="group" aria-label="Show the day as">
      <span className="td-lens-label">Show the day as</span>
      <div className="segmented">
        {lenses.map((l) => (
          <button key={l.key} type="button" aria-pressed={l.key === lens.key} onClick={() => choose(l.key)}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
  if (!lens.roles) return <OverviewToday roles={all} lensBar={bar} />;
  return <RoleToday key={lens.key} roles={lens.roles.filter((r) => all.includes(r))} lensBar={bar} />;
}

/**
 * The Overview: the hospital's day in a few numbers, which doctors are in, the staff by role and the way to each area.
 * For a hospital admin (no patient data) every number comes without a name (the server sends counts only).
 */
function OverviewToday({ roles, lensBar = null }) {
  const { user } = useAuth();
  const front = canSeeCalendar(roles); // doctors, RMOs, reception: today's list itself
  const isAdmin = roles.includes('admin');
  const today = useFetch(front ? '/today' : null);
  const beds = useFetch('/beds', { summary: '1' });
  const stays = useFetch('/beds/desk');
  const collected = useFetch('/billing/reports/daily');
  const unpaid = useFetch('/billing/reports/unpaid');
  const staff = useFetch(isAdmin ? '/tenant/members' : null, { limit: 1, status: 'active' });
  const roleCounts = useFetch(isAdmin ? '/tenant/members/role-counts' : null);
  const desk = useFetch('/appointments/desk');
  // Today's patients: from today's list, or (hospital admin) added up from each doctor's counts
  const doctors = desk.data?.doctors ?? [];
  const counts = today.data
    ? receptionCounts(today.data)
    : desk.data
      ? (() => {
          const sum = (k) => doctors.reduce((n, d) => n + (d[k] ?? 0), 0);
          return { patients: sum('expected') + sum('waiting') + sum('seen'), arrived: sum('waiting') + sum('seen'), expected: sum('expected') };
        })()
      : null;
  const going = stays.data ? (stays.data.goingHomeCount ?? stays.data.goingHome.length) : 0;
  const gone = stays.data ? (stays.data.dischargedTodayCount ?? stays.data.dischargedToday.length) : 0;
  const day = today.data?.today ?? desk.data?.today;
  const areas = hospitalModules(roles).filter((m) => m.key !== 'today');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Today' }]} title="Today" subtitle={[day ? formatDate(day) : null, `Welcome, ${user.name}`].filter(Boolean).join(' · ')} />
      <div className="pf-content wl-page td-page">
        {lensBar}
        <section className="td-group" aria-labelledby="td-glance">
          <h2 className="td-group-title" id="td-glance">
            At a glance
          </h2>
          <div className="kpi-grid kpi-grid-5">
            <KpiCard
              to={front ? '/?view=reception' : '/appointments'}
              tone={counts?.expected ? 'due' : 'neutral'}
              icon={Users}
              label="Today's patients"
              value={counts ? formatNumber(counts.patients) : '—'}
              sub={counts ? `${counts.arrived} arrived · ${counts.expected} expected` : ''}
            />
            <KpiCard
              to={beds.data ? '/beds' : undefined}
              tone="neutral"
              icon={BedDouble}
              label="In hospital"
              value={stays.data ? formatNumber(stays.data.inHospital) : '—'}
              sub={beds.data ? (beds.data.counts.total ? `${beds.data.counts.free} of ${beds.data.counts.total} beds free · ${stays.data?.admittedToday ?? 0} admitted today` : 'No beds set up yet') : ''}
            />
            <KpiCard
              to={front ? '/?view=reception#td-discharges' : undefined}
              tone={going ? 'due' : 'neutral'}
              icon={DoorOpen}
              label="Discharges"
              value={stays.data ? formatNumber(going + gone) : '—'}
              sub={stays.data ? `${going} being discharged · ${gone} went home` : ''}
            />
            <KpiCard
              to="/billing/daily"
              tone={unpaid.data?.bills.length ? 'watch' : 'neutral'}
              icon={Banknote}
              label="Money today"
              value={collected.data ? rupees(collected.data.totals.net) : '—'}
              textValue
              sub={unpaid.data ? `collected · ${unpaid.data.owed ? `${rupees(unpaid.data.owed)} to collect` : 'nothing to collect'}` : ''}
            />
            {isAdmin && (
              <KpiCard to="/admin/staff" tone="neutral" icon={UserCheck} label="Active staff" value={staff.data ? formatNumber(staff.data.total) : '—'} sub="People who can work here" />
            )}
          </div>
        </section>
        {doctors.length > 0 && <DoctorsToday doctors={doctors} linkNames={canSeeAppointments(roles)} />}
        {isAdmin && roleCounts.data && (
          <section className="td-group" aria-labelledby="td-staff">
            <h2 className="td-group-title" id="td-staff">
              Staff by role
            </h2>
            <ul className="td-staff">
              {STAFF_ROLE_TILES.map((r) => {
                const n = roleCounts.data.counts[r.role] ?? 0;
                return (
                  <li key={r.role}>
                    <Link to={`/admin/staff?role=${r.role}`} className={`card td-staff-tile${n ? '' : ' is-none'}`}>
                      <strong className="tabular">{formatNumber(n)}</strong>
                      <span>{r.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section className="td-group" aria-labelledby="td-areas">
          <h2 className="td-group-title" id="td-areas">
            Go to
          </h2>
          <ul className="td-areas">
            {areas.map((m) => {
              const Icon = m.icon;
              return (
                <li key={m.key}>
                  <Link to={m.to} className="card td-area">
                    <span className="td-area-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span>{m.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        {lensBar ? (
          <p className="hint wl-footnote">
            <ClipboardList aria-hidden="true" /> For one role's full lists – waiting patients, calls, the ward, the lab – choose it above.
          </p>
        ) : (
          <p className="hint wl-footnote">
            <ClipboardList aria-hidden="true" /> Numbers only: patient records are seen by the staff who care for the patients.
          </p>
        )}
      </div>
    </>
  );
}

/** Today for the given roles (all of the person's roles, or the one view chosen above). */
function RoleToday({ roles, lensBar = null }) {
  const { user } = useAuth();
  const location = useLocation();
  // A number card opens its list further down the page (e.g. "/#td-overdue"): open the box and bring it into view.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return undefined;
    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.getAttribute('aria-expanded') === 'false') el.click();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [location.hash, location.key]);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [params, setParams] = useSearchParams();
  const [reminding, setReminding] = useState(null);
  const [marking, setMarking] = useState(null); // the patient being marked arrived (or undone)
  const [markError, setMarkError] = useState(null);
  // The queue time sent to her on WhatsApp when she arrived (docs/WHATSAPP_DESK_PLAN.md): said once to the desk
  const [queueNote, setQueueNote] = useState(null);
  // The OPD case paper of the patient just marked arrived (docs/ADMISSION_DESK_PLAN.md)
  const [arrivedNow, setArrivedNow] = useState(null); // { patientId, fullName, opdNo }
  const [casePaper, setCasePaper] = useState(null);
  const queueSent = (q) => setQueueNote(q?.sent ? `Queue time sent on WhatsApp: ${q.ahead === 0 ? 'she is next' : `${q.ahead} before her`}, about ${timeLabel(q.eta)}${q.practice ? ' (practice – nothing really sent)' : ''}.` : null);
  const [arriving, setArriving] = useState(null); // a patient with no appointment: which doctor (token)
  const [tokenGiven, setTokenGiven] = useState(null); // the walk-in token just given
  const [slip, setSlip] = useState(null); // the token slip being printed
  const asked = ['mine', 'all'].includes(params.get('scope')) ? params.get('scope') : undefined;
  const query = asked ? { scope: asked } : {};

  const isDoctor = roles.includes('doctor');
  const isAdmin = roles.includes('admin');
  const canBrief = has(roles, ['doctor', 'rmo']); // the AI brief: doctors and RMOs
  const clinicalWork = has(roles, CARE_PLAN_ROLES); // doctors, RMOs, nurses: the worklist
  const appointments = canSeeCalendar(roles); // doctors, RMOs, reception: today's patients
  const worklist = useFetch(clinicalWork ? '/worklist' : null, query);
  const inpatients = useFetch(clinicalWork ? '/inpatients' : null);
  // Lab (Version 2): results waiting for this doctor's review; the lab's own counts
  const labReview = useFetch(isDoctor ? '/lab/to-review' : null);
  const labWork = useFetch(roles.includes('lab') ? '/lab/worklist' : null);
  // The billing department: unpaid bills and the money owed
  // and reception (the "To collect" card and the payments to collect now)
  const isReception = roles.includes('receptionist');
  const isBillingDesk = roles.includes('billing');
  // An RMO who is not also a doctor or receptionist (owner, 13 Oct 2026): the ward round instead of the front desk's
  // jobs – no Scan & Share, walk-in tokens, babies' vaccination calls or calendar link
  const rmoOnly = roles.includes('rmo') && !has(roles, ['doctor', 'receptionist']); // the billing department's own cards and today's bills (BillingToday)
  const unpaid = useFetch(has(roles, ['billing', 'receptionist']) ? '/billing/reports/unpaid' : null);
  const collected = useFetch(isReception ? '/billing/reports/daily' : null);
  const beds = useFetch(isReception ? '/beds' : null, { summary: '1' });
  // The front desk's day: which doctors are in today, and tomorrow's bookings to confirm (owner, 14 Oct 2026)
  const desk = useFetch(isReception ? '/appointments/desk' : null);
  // …and the stays: in hospital, admitted today, going home, discharged today
  const stays = useFetch(isReception ? '/beds/desk' : null);
  const today = useFetch(appointments ? '/today' : null, query);

  const seesRisk = clinicalWork;
  const riskScope = isDoctor && !roles.includes('rmo') ? 'me' : 'all';
  const highRisk = useFetch(seesRisk ? '/patients' : null, { limit: 1, risk: 'high', doctor: riskScope });
  // Overrides to review: the patients whose risk this doctor may override – their own and unassigned ones.
  const toReview = useFetch(isDoctor ? '/patients' : null, { limit: 1, risk: 'review', doctor: 'mine_or_unassigned' });
  const staff = useFetch(isAdmin ? '/tenant/members' : null, { limit: 1, status: 'active' });
  // The hospital admin's dashboard: the staff by role
  const roleCounts = useFetch(isAdmin ? '/tenant/members/role-counts' : null);
  // Drafts in the clinic library waiting for a doctor's approval (doctors approve)
  const library = useLibraryDrafts(isDoctor);

  const scope = today.data?.scope ?? worklist.data?.scope ?? asked;
  const canChooseScope = Boolean(today.data?.canChooseScope ?? worklist.data?.canChooseScope);
  // (the view chosen above stays)
  const setScope = (s) => {
    const view = params.get('view');
    const next = s === (isDoctor && !roles.includes('rmo') ? 'mine' : 'all') ? {} : { scope: s };
    setParams(view ? { ...next, view } : next, { replace: true });
  };
  const day = today.data?.today ?? worklist.data?.today;
  const progress = new Map((worklist.data?.seenToday ?? []).map((v) => [v.visitId, v]));
  const loading = (clinicalWork && !worklist.data && !worklist.error) || (appointments && !today.data && !today.error);

  const queues = canSeeAppointments(roles); // each doctor's waiting list (appointment booking)
  const [queueKey, setQueueKey] = useState(0);
  const listsChanged = () => {
    today.reload();
    worklist.reload?.();
    setQueueKey((k) => k + 1);
  };
  // Mark arrived / Undo (reception, nurses, doctors, RMOs), then the lists again. A patient with no appointment
  // today is first asked which doctor she will see (a walk-in token).
  const arrival = async (method, p, row) => {
    if (method === 'POST' && !row?.appointment) {
      setArriving({ patient: p, doctorName: p.doctorName });
      return;
    }
    setMarking(p.id);
    setMarkError(null);
    try {
      const res = await (method === 'POST' ? api('/arrivals', { method, body: { patientId: p.id } }) : api(`/arrivals/${p.id}`, { method }));
      if (method === 'POST') {
        queueSent(res?.queueTime);
        if (res?.arrival?.opdNo) setArrivedNow({ patientId: p.id, fullName: p.fullName, opdNo: res.arrival.opdNo });
      }
      listsChanged();
    } catch (err) {
      setMarkError(`${p.fullName}: ${err.message}`);
    } finally {
      setMarking(null);
    }
  };

  const counts = receptionCounts(today.data);
  const collect = isReception && unpaid.data && today.data ? paymentsToCollect(unpaid.data.bills, today.data.patients) : [];
  const tiles = [
    isReception && today.data && (
      <KpiCard key="r-patients" to="/#td-patients" tone={counts.expected ? 'due' : 'neutral'} icon={Users} label="Today's patients" value={formatNumber(counts.patients)} sub={`${counts.arrived} arrived · ${counts.expected} expected`} />
    ),
    isReception && today.data && (
      <KpiCard key="r-calls" to={`/#${counts.callsList}`} tone={counts.calls ? 'watch' : 'neutral'} icon={PhoneCall} label="Calls to make" value={formatNumber(counts.calls)} sub="Due, overdue and babies – not booked" />
    ),
    // Money today: what came in and what is still owed, in one card (owner, 14 Oct 2026)
    isReception && !isBillingDesk && collected.data && unpaid.data && (
      <KpiCard
        key="r-money"
        to={unpaid.data.bills.length ? '/billing/unpaid' : '/billing/daily'}
        tone={unpaid.data.bills.length ? 'watch' : 'neutral'}
        icon={Banknote}
        label="Money today"
        value={rupees(collected.data.totals.net)}
        textValue
        sub={`collected · ${unpaid.data.owed ? `${rupees(unpaid.data.owed)} to collect (${unpaid.data.bills.length} bill${unpaid.data.bills.length === 1 ? '' : 's'})` : 'nothing to collect'}`}
      />
    ),
    isReception && beds.data && (
      <KpiCard key="r-beds" to="/beds" tone={beds.data.counts.total && !beds.data.counts.free ? 'watch' : 'neutral'} icon={BedDouble} label="Free beds" value={formatNumber(beds.data.counts.free)} sub={
          beds.data.counts.total
            ? `of ${beds.data.counts.total} beds${stays.data ? ` · ${stays.data.inHospital} in hospital, ${stays.data.admittedToday} admitted today` : ''}`
            : 'No beds set up yet'
        }
      />
    ),
    isReception && stays.data && (
      <KpiCard
        key="r-discharges"
        to="/#td-discharges"
        tone={stays.data.goingHome.length ? 'due' : 'neutral'}
        icon={DoorOpen}
        label="Discharges"
        value={formatNumber(stays.data.goingHome.length + stays.data.dischargedToday.length)}
        sub={`${stays.data.goingHome.length} being discharged · ${stays.data.dischargedToday.length} went home today`}
      />
    ),
    unpaid.data && !isBillingDesk && !isReception && <KpiCard key="unpaid" to="/billing/unpaid" tone={unpaid.data.bills.length ? 'watch' : 'neutral'} icon={Wallet} label="Unpaid bills" value={formatNumber(unpaid.data.bills.length)} sub={unpaid.data.owed ? `${rupees(unpaid.data.owed)} owed` : 'Nothing owed'} />,
    labWork.data && <KpiCard key="lab-collect" to="/lab" tone={labWork.data.counts.collect ? 'due' : 'neutral'} icon={TestTube} label="Samples to take" value={formatNumber(labWork.data.counts.collect)} sub="Lab orders waiting for a sample" />,
    labWork.data && <KpiCard key="lab-receive" to="/lab?list=receive" tone={labWork.data.counts.receive ? 'due' : 'neutral'} icon={TestTube} label="Samples to receive" value={formatNumber(labWork.data.counts.receive ?? 0)} sub="Taken on a ward or at home, not in the lab yet" />,
    labWork.data && <KpiCard key="lab-report" to="/lab?list=report" tone={labWork.data.counts.report ? 'due' : 'neutral'} icon={FlaskConical} label="Results to enter" value={formatNumber(labWork.data.counts.report)} sub="Samples taken, results not reported" />,
    // Lab version 2: results to check, home collections, tests at outside labs
    labWork.data && labWork.data.counts.verify > 0 && <KpiCard key="lab-verify" to="/lab?list=verify" tone="due" icon={FlaskConical} label="Results to check" value={formatNumber(labWork.data.counts.verify)} sub="Entered, waiting for a second person" />,
    labWork.data && <KpiCard key="lab-home" to="/lab?list=home" tone={labWork.data.counts.home ? 'due' : 'neutral'} icon={TestTube} label="Home collections" value={formatNumber(labWork.data.counts.home ?? 0)} sub="Samples to collect at home" />,
    labWork.data && <KpiCard key="lab-outside" to="/lab?list=outside" tone={labWork.data.counts.outside ? 'watch' : 'neutral'} icon={FlaskConical} label="At outside labs" value={formatNumber(labWork.data.counts.outside ?? 0)} sub="Sent out, results not back" />,
    seesRisk && (
      <KpiCard
        key="risk"
        tone="high"
        label={riskScope === 'me' ? 'My high-risk' : 'High-risk'}
        value={highRisk.data ? formatNumber(highRisk.data.total) : '—'}
        sub="Pregnancies flagged high risk"
        to={`/patients?risk=high${riskScope === 'me' ? '' : '&doctor=all'}`}
      />
    ),
    isDoctor && toReview.data?.total > 0 && (
      <KpiCard
        key="review"
        tone="watch"
        label="Overrides to review"
        value={formatNumber(toReview.data.total)}
        sub="Automatic risk changed since the override"
        to="/patients?risk=review&doctor=mine_or_unassigned"
      />
    ),
    isDoctor && library.drafts.length > 0 && (
      <KpiCard
        key="approve"
        tone="watch"
        label="To approve"
        value={formatNumber(library.drafts.length)}
        sub="Clinic library drafts – reminders only until a doctor approves them"
        to="/library/approvals"
      />
    ),
    isAdmin && <KpiCard key="staff" label="Active staff" value={staff.data ? formatNumber(staff.data.total) : '—'} sub="People who can work here" to="/admin/staff" />,
    ...(isAdmin && roleCounts.data
      ? STAFF_ROLE_TILES.map((r) => (
          <KpiCard key={`role-${r.role}`} label={r.label} value={formatNumber(roleCounts.data.counts[r.role] ?? 0)} sub={roleCounts.data.counts[r.role] ? 'Open the list' : 'Nobody yet'} to={`/admin/staff?role=${r.role}`} />
        ))
      : []),
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Today' }]}
        title="Today"
        subtitle={[day ? formatDate(day) : null, `Welcome, ${user.name}`, canChooseScope ? (scope === 'mine' ? 'Your patients and unassigned patients' : 'All patients') : null]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {canChooseScope && (
              <div className="segmented" role="group" aria-label="Whose patients">
                <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
                  My patients
                </button>
                <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                  All patients
                </button>
              </div>
            )}
            {today.data?.canMarkArrived && canSeeAppointments(roles) && !rmoOnly && (
              <button type="button" className="btn btn-secondary" onClick={() => setArriving({ patient: null })}>
                <Hash aria-hidden="true" /> Walk-in token
              </button>
            )}
            {canRegisterPatients(roles) && <MenuButton className="btn btn-primary" icon={UserPlus} label="New patient" items={NEW_PATIENT_LINKS} align="end" />}
          </>
        }
      />
      <div className="pf-content wl-page td-page">
        {lensBar}
        <SignupsNotice roles={roles} />
        <ContinueVisits enabled={has(roles, ['doctor', 'rmo', 'nurse'])} />
        <Tip ids={has(roles, ['doctor', 'rmo']) ? ['cmdk-2026-10', 'myday-2026-10'] : ['cmdk-2026-10']} />
        <MyDayCard enabled={has(roles, ['doctor', 'rmo'])} />
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {worklist.error && <Alert type="error">{worklist.error}</Alert>}
        {today.error && <Alert type="error">{today.error}</Alert>}
        <Alert type="error" onClose={() => setMarkError(null)}>
          {markError}
        </Alert>
        <Alert type="success" onClose={() => setQueueNote(null)}>
          {queueNote}
        </Alert>
        {arrivedNow && (
          <Alert type="success" onClose={() => setArrivedNow(null)}>
            {arrivedNow.fullName}: OPD number {arrivedNow.opdNo}.{' '}
            <button type="button" className="btn btn-link btn-sm" onClick={() => setCasePaper(arrivedNow.patientId)}>
              Print the OPD case paper
            </button>
          </Alert>
        )}
        {tokenGiven && (
          <Alert type="success" onClose={() => setTokenGiven(null)}>
            {tokenGiven.patient?.fullName}: token {tokenGiven.token} for {tokenGiven.doctor.name}.{' '}
            <button type="button" className="btn btn-link btn-sm" onClick={() => setSlip(tokenGiven)}>
              Print the token slip
            </button>
          </Alert>
        )}
        {canBookAppointments(roles) && <NeedsTimeNotice />}
        {canBrief && (
          <AiBriefCard
            endpoint="/ai/brief/today"
            body={asked ? { scope: asked } : {}}
            resetKey={`${asked ?? ''}:${day ?? ''}`}
            intro="What to look at first in today's lists."
          />
        )}
        {tiles.length > 0 && (
          <section className="td-group" aria-labelledby="td-glance">
            <h2 className="td-group-title" id="td-glance">
              At a glance
            </h2>
            <div className={`kpi-grid${tiles.length === 5 ? ' kpi-grid-5' : ''}`}>{tiles}</div>
          </section>
        )}
        {(roles.includes('nurse') || roles.includes('rmo')) && <WardToday inpatients={inpatients.data} rmo={roles.includes('rmo')} />}
        {clinicalWork && inpatients.data && <HandoverList inpatients={inpatients.data} />}
        {roles.includes('pharmacist') && <PharmacyToday />}
        {isBillingDesk && <BillingToday />}
        {isReception && (
          <nav className="td-quick" aria-label="Quick actions">
            <Link to="/appointments" className="btn btn-secondary btn-sm">
              <CalendarPlus aria-hidden="true" /> Book an appointment
            </Link>
            <Link to="/beds" className="btn btn-secondary btn-sm">
              <BedDouble aria-hidden="true" /> Admit to a bed
            </Link>
            <Link to="/#td-discharges" className="btn btn-secondary btn-sm">
              <DoorOpen aria-hidden="true" /> Discharges
            </Link>
            <Link to="/billing" className="btn btn-secondary btn-sm">
              <Receipt aria-hidden="true" /> Bills and payments
            </Link>
          </nav>
        )}
        {isReception && desk.data && <DoctorsToday doctors={desk.data.doctors} />}
        {loading && (
          <div className="card plan-loading" aria-busy="true">
            <span className="sr-only">Loading today's lists…</span>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="plan-skeleton" />
            ))}
          </div>
        )}
        {(worklist.data?.cut || today.data?.cut) && <Alert type="warning">Some lists are cut short: there are more patients than one page can show.</Alert>}

        {/* The lists: boxes with a heading and a count, opened with a click */}
        {(worklist.data || today.data || inpatients.data || labReview.data) && <h2 className="td-group-title">Today&apos;s lists</h2>}
        <div className="td-sections">
        {worklist.data && <RedFlagsSection data={worklist.data} />}
        {/* Inpatients (Version 2): documents waiting for this doctor's confirmation, and who is in hospital */}
        {inpatients.data?.toConfirm && (
          <Section id="td-confirm" icon={BadgeCheck} title="Waiting for your confirmation" count={inpatients.data.toConfirm.length} empty="No delivery, operation or discharge notes are waiting for you.">
            <ul className="wl-list">
              {inpatients.data.toConfirm.map((d) => (
                <PatientRow key={d.documentId} patient={d.patient} to={`/patients/${d.patient.id}/stays/${d.admissionId}/docs/${d.documentId}`} openLabel="Open the note">
                  <StatusPill tone="watch" icon={UserCheck}>
                    {KIND_LABELS[d.kind]}
                  </StatusPill>
                  <p className="hint">
                    Written by {d.writtenBy} · {formatDateTime(d.at)}
                  </p>
                </PatientRow>
              ))}
            </ul>
          </Section>
        )}
        {labReview.data?.orders && (
          <Section id="td-lab-review" icon={FlaskConical} title="Lab results to review" count={labReview.data.orders.length} empty="No lab results are waiting for your review.">
            <ul className="wl-list">
              {labReview.data.orders.map((o) => (
                <PatientRow
                  key={o.id}
                  patient={o.patient}
                  to={`/patients/${o.patient.id}/lab/${o.id}`}
                  openLabel="Open the results"
                  marker={
                    o.abnormal ? (
                      <StatusPill tone="high" icon={FLAG_LOOK.abnormal.icon}>
                        Outside range
                      </StatusPill>
                    ) : null
                  }
                >
                  <p className="hint">
                    {testNames(o)} · reported by {o.reported?.byName}, {formatDateTime(o.reported?.at)}
                  </p>
                </PatientRow>
              ))}
            </ul>
          </Section>
        )}
        {inpatients.data && inpatients.data.admitted.length > 0 && (
          <Section id="td-inpatients" icon={BedDouble} title="In hospital" count={inpatients.data.admitted.length} empty="">
            <ul className="wl-list">
              {inpatients.data.admitted.map((s) => (
                <PatientRow
                  key={s.admissionId}
                  patient={s.patient}
                  to={`/patients/${s.patient.id}/stays/${s.admissionId}`}
                  openLabel="Open the stay"
                  marker={
                    <>
                      <FlagCountPill flags={s.redFlags} />
                      {/* Seen without opening the row (owner, 13 Oct 2026) */}
                      {vitalsDue(s) && (
                        <StatusPill tone="watch" icon={Clock} title={`No vitals recorded in the last ${VITALS_DUE_HOURS} hours`}>
                          Vitals due
                        </StatusPill>
                      )}
                    </>
                  }
                >
                  <div className="wl-row-head">
                    <span className="wl-counts">
                      {(s.ward || s.bed) && <span className="muted">{[s.ward, s.bed && `Bed ${s.bed}`].filter(Boolean).join(' · ')}</span>}
                      {s.drafts > 0 && (
                        <StatusPill tone="watch" icon={PenLine}>
                          {s.drafts} draft{s.drafts > 1 ? 's' : ''}
                        </StatusPill>
                      )}
                      {/* Closed after a death: on the list until the discharge card ends the stay */}
                      {s.patient.closed && (
                        <StatusPill tone="inactive" icon={Archive}>
                          Record closed
                        </StatusPill>
                      )}
                    </span>
                  </div>
                  <p className="hint">
                    Admitted {formatDateTime(s.admittedAt)} ·{' '}
                    {s.lastVitalsAt ? `last vitals ${formatDateTime(s.lastVitalsAt)}` : 'no vitals recorded yet'}
                    {s.lastMedicineAt ? ` · last medicine given ${formatDateTime(s.lastMedicineAt)}` : ''}
                  </p>
                  {s.redFlags?.length > 0 && <RedFlagItems flags={s.redFlags} brief patientId={s.patient.id} />}
                  {/* No rule for her type of care: say that nothing was checked, never leave it looking like "no red flags" */}
                  {s.redFlagsChecked === false && <p className="hint">{notCheckedCareText(s.redFlagsCareType ?? s.patient.careType, s.redFlagsWorkupOnly)}</p>}
                </PatientRow>
              ))}
            </ul>
            {inpatients.data.admitted.some((s) => s.redFlags?.length > 0) && <RedFlagRulesNote rules={inpatients.data.rules} />}
          </Section>
        )}
        {queues && <WaitingLists key={queueKey} />}
        {today.data && (
          <TodaysPatients
            rows={today.data.patients}
            progress={progress}
            showDoctor={scope === 'all'}
            canMark={today.data.canMarkArrived}
            busy={marking}
            onMark={(p) => arrival('POST', p, today.data.patients.find((r) => r.patient.id === p.id))}
            onUndo={(p) => arrival('DELETE', p)}
            onSlip={setSlip}
          />
        )}
        {/* Reception: bills to settle now – a patient here today, or a stay that has ended (owner, 13 Oct 2026) */}
        {isReception && unpaid.data && today.data && (
          <Section id="td-collect" icon={Wallet} title="Payments to collect" count={collect.length} empty="Nothing to collect now: nobody here today or discharged owes money.">
            <ul className="wl-list">
              {collect.map(({ bill, why }) => (
                <PatientRow
                  key={bill.id}
                  patient={bill.patient}
                  to={`/billing/bills/${bill.id}`}
                  openLabel="Open the bill"
                  marker={
                    <StatusPill tone="watch" icon={Wallet}>
                      {rupees(bill.balance)} to pay
                    </StatusPill>
                  }
                >
                  <p className="hint">
                    Bill {bill.number} · {why === 'discharged' ? `Discharged${bill.stay?.dischargedAt ? ` ${formatDate(bill.stay.dischargedAt)}` : ''} – the bill is not settled` : 'Here today'}
                  </p>
                </PatientRow>
              ))}
            </ul>
          </Section>
        )}
        {isReception && stays.data && <DischargesSection desk={stays.data} bills={unpaid.data?.bills} />}
        {isReception && desk.data && <TomorrowCalls list={desk.data.tomorrowList} tomorrow={desk.data.tomorrow} />}
        {has(roles, ['receptionist', 'doctor']) && <ScanShareSection />}
        {has(roles, ['receptionist']) && <SignupsSection />}
        {today.data?.guests && <QuickBookingsSection guests={today.data.guests} canRegister={canRegisterPatients(roles)} />}
        {/* Nurses: who arrived and is waiting for her visit to be started, then the visits started today */}
        {!appointments && worklist.data?.waiting?.length > 0 && (
          <Section id="td-waiting" icon={UserCheck} title="Arrived – waiting" count={worklist.data.waiting.length} empty="">
            <ul className="wl-list">
              {worklist.data.waiting.map((w) => (
                <PatientRow key={w.patient.id} patient={w.patient}>
                  <StatusPill tone="stable" icon={UserCheck}>
                    Arrived · {formatTime(w.arrivedAt)}
                  </StatusPill>
                  <p className="hint">Open her record and press Start today's visit.</p>
                </PatientRow>
              ))}
            </ul>
          </Section>
        )}
        {!appointments && worklist.data && <VisitsTodaySection data={worklist.data} />}
        {today.data?.dueNow && (
          <CallList
            id="td-due"
            icon={CalendarClock}
            title="Visits due now – not booked"
            rows={today.data.dueNow}
            empty="Nobody to call: every patient with a visit due is booked or has come."
            line={(r) => `Visit due from ${formatDate(r.dueFrom)}`}
          />
        )}
        {today.data?.overdue && (
          <CallList id="td-overdue" icon={CalendarX2} title="Overdue – not booked" rows={today.data.overdue} empty="No overdue visits." line={overdueLine} />
        )}
        {/* Reception's general list of babies to call; clinical staff get the vaccines by name just below */}
        {today.data?.babiesDue && !clinicalWork && (
          <CallList id="td-babies" icon={Baby} title="Babies due – not booked" rows={today.data.babiesDue} empty="No babies to call." line={babyDueLine} note={babiesDueNote(today.data.babiesDue)} />
        )}
        {worklist.data && <CarePlanSection data={worklist.data} onRemind={setReminding} />}
        {worklist.data && !rmoOnly && <VaccinationsOverdueSection data={worklist.data} />}
        </div>

        {(worklist.data || today.data) && (
          <p className="hint wl-footnote">
            <ClipboardList aria-hidden="true" /> A reminder list: it shows only what was recorded in Perinexa.{' '}
            {appointments && !rmoOnly && (
              <Link to="/calendar" className="btn btn-link btn-sm">
                Open the calendar
              </Link>
            )}
          </p>
        )}
      </div>
      {reminding && <ReminderDialog patientId={reminding} onClose={() => setReminding(null)} />}
      {arriving && (
        <ArrivalDialog
          patient={arriving.patient}
          doctorName={arriving.doctorName}
          onClose={() => setArriving(null)}
          onDone={(appointment, queueTime, arrival) => {
            setArriving(null);
            queueSent(queueTime);
            if (arrival?.opdNo && arriving.patient) setArrivedNow({ patientId: arriving.patient.id, fullName: arriving.patient.fullName, opdNo: arrival.opdNo });
            if (appointment?.kind === 'token') setTokenGiven(appointment);
            listsChanged();
          }}
        />
      )}
      {casePaper && <OpdCasePaper patientId={casePaper} onClose={() => setCasePaper(null)} />}
      {slip && <TokenSlip appointment={{ ...slip, date: slip.date ?? today.data?.today }} onClose={() => setSlip(null)} />}
    </>
  );
}
