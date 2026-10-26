import { createContext, useContext, useState } from 'react';
import { CalendarX2, Check, ChevronDown, MessageCircle, Phone, Siren, Stethoscope, Syringe, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { NextVisitLine } from '../patients/CarePlanCard.jsx';
import { SUMMARY_COUNTS, statusLook } from '../patients/carePlanFormat.js';
import { RiskBadge } from '../patients/RiskCard.jsx';
import { RedFlagItems, RedFlagRulesNote } from '../redflags/RedFlagList.jsx';
import { LISTED_TEXT, checkedCareText, flagCountText } from '../redflags/redFlagFormat.js';
import { flagRowTarget } from '../redflags/redFlagSources.js';

// The worklist's sections (Smart features, step 1), shown on the Today page: red flags (from the latest visit, the
// lab results and, for a patient in hospital, the nursing chart), care-plan items overdue or due and missed visits,
// the visits started today, and the babies whose vaccinations are overdue (GET /api/worklist). Doctors see their own and unassigned patients by default and can switch to all;
// nurses and RMOs see all.

const gaShort = (ga) => (ga ? `${ga.weeks}w ${ga.days}d` : null);
// The type of care in the red-flag list, said only when it is not pregnancy care (whose rows show the weeks):
// "Postnatal", "Newborn" – the rules differ by type of care.
const careShort = (patient) => (patient.careType && patient.careType !== 'antenatal' ? (CARE_TYPE_SHORT[patient.careType] ?? null) : null);

/**
 * One patient in a Today list: only her name, in bold. A click on it shows the rest – record number, weeks,
 * doctor, risk, the list's details and buttons – and a link to open her record (to: where it leads).
 * marker: a short pill kept beside the name (e.g. "Urgent" on red flags), so urgency is never hidden.
 */
export function PatientRow({ patient, to, openLabel = 'Open the record', marker = null, children }) {
  const [open, setOpen] = useState(false);
  const bodyId = `row-${patient.id}-${openLabel.length}-${to ?? ''}`.replace(/[^\w-]/g, '');
  const bits = [patient.mrn, gaShort(patient.gestationalAge), patient.assignedDoctorName].filter(Boolean).join(' · ');
  return (
    <li className={`wl-row${open ? ' is-open' : ''}`}>
      <button type="button" className="wl-row-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="wl-row-name">{patient.fullName}</span>
        {marker}
        <ChevronDown aria-hidden="true" className="wl-row-chevron" />
      </button>
      <div id={bodyId} className="wl-row-body" hidden={!open}>
        {open && (
          <>
            <p className="wl-row-facts">
              <span className="muted tabular">{bits}</span>
              {patient.risk?.level && <RiskBadge level={patient.risk.level} />}
            </p>
            {children}
            <Link to={to ?? `/patients/${patient.id}`} className="btn btn-link btn-sm wl-row-open">
              {openLabel} →
            </Link>
          </>
        )}
      </div>
    </li>
  );
}

/** The patient: name (link to the record), number, weeks, risk. */
export function Who({ patient, to }) {
  const bits = [patient.mrn, gaShort(patient.gestationalAge), patient.assignedDoctorName].filter(Boolean).join(' · ');
  return (
    <span className="wl-who">
      <Link to={to ?? `/patients/${patient.id}`} className="strong-name">
        {patient.fullName}
      </Link>
      <span className="muted tabular">{bits}</span>
      {patient.risk?.level && <RiskBadge level={patient.risk.level} />}
    </span>
  );
}

// Which lists the person left open on Today (this browser only; closed when it can't be read).
const openKey = (id) => `perinexa.open.${id}`;
function readOpen(id, fallback = false) {
  try {
    const v = localStorage.getItem(openKey(id));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function saveOpen(id, open) {
  try {
    // '0' too: a list closed by hand stays closed where lists open at first (SectionOpenDefault)
    localStorage.setItem(openKey(id), open ? '1' : '0');
  } catch {
    // not remembered – nothing else changes
  }
}

/** true: lists with someone in them start open, unless closed by hand (reception's simpler Today, 26 Oct 2026). */
export const SectionOpenDefault = createContext(false);

/**
 * A list on Today: a box with the heading and how many, which opens and closes when clicked (closed at first;
 * the browser remembers which were left open). collapsible={false}: always open (e.g. the Lab worklist).
 * remember={false}: not remembered (e.g. the days of a week), defaultOpen then decides. badge: beside the title.
 */
export function Section({ id, icon: Icon, title, count, empty, collapsible = true, remember = true, defaultOpen = false, badge = null, children }) {
  const openAtFirst = useContext(SectionOpenDefault);
  const [open, setOpen] = useState(() => !collapsible || (remember ? readOpen(id, openAtFirst && count > 0) : defaultOpen));
  const toggle = () => {
    if (remember) saveOpen(id, !open);
    setOpen(!open);
  };
  const body = count === 0 ? <p className="panel-empty">{empty}</p> : children;
  if (!collapsible) {
    return (
      <section className="panel wl-section" aria-labelledby={id}>
        <header className="panel-header">
          <h2 id={id}>
            <Icon aria-hidden="true" /> {title} <span className="muted tabular">({count})</span>
          </h2>
        </header>
        {body}
      </section>
    );
  }
  return (
    <section className={`panel wl-section wl-fold${open ? ' is-open' : ''}${count > 0 ? ' has-items' : ''}`}>
      <h2 className="wl-fold-title">
        <button type="button" id={id} aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle}>
          <Icon aria-hidden="true" className="wl-fold-icon" />
          <span className="wl-fold-text">{title}</span>
          {badge}
          <span className="wl-fold-count tabular" aria-label={`${count} ${count === 1 ? 'item' : 'items'}`}>
            {count}
          </span>
          <ChevronDown aria-hidden="true" className="wl-fold-chevron" />
        </button>
      </h2>
      <div id={`${id}-body`} hidden={!open}>
        {open && body}
      </div>
    </section>
  );
}

/** A "Red flag" pill with how many, for a row that has flags (null without any). */
export function FlagCountPill({ flags }) {
  if (!flags?.length) return null;
  return (
    <StatusPill tone="high" icon={Siren} title={flagCountText(flags)}>
      Red flag{flags.length > 1 ? `s ${flags.length}` : ''}
    </StatusPill>
  );
}

// Which patients Today's red-flag list checks – only what is true: the types of care the hospital's rules cover
// (data.rules.careTypes) and those they do not, so an empty list is never read as "everyone was checked".
export const redFlagsEmptyText = (rules) => ['No red flags from the latest visits, lab results or nursing charts.', checkedCareText(rules?.careTypes)].filter(Boolean).join(' ');
/** Under the list: who is checked, who is not, and how long a flag is listed. */
export function RedFlagsScopeNote({ rules }) {
  return <p className="hint rf-note">{[checkedCareText(rules?.careTypes), LISTED_TEXT].filter(Boolean).join(' ')}</p>;
}

export function RedFlagsSection({ data }) {
  return (
    <Section id="wl-flags" icon={Siren} title="Red flags" count={data.redFlags.length} empty={redFlagsEmptyText(data.rules)}>
      <ul className="wl-list">
        {data.redFlags.map((r) => {
          const target = flagRowTarget(r.patient.id, r.flags);
          return (
            <PatientRow
              key={r.patient.id}
              patient={r.patient}
              to={target.to}
              openLabel={target.label}
              marker={
                r.flags.some((f) => f.level === 'urgent') ? (
                  <StatusPill tone="high" icon={Siren}>
                    Urgent
                  </StatusPill>
                ) : null
              }
            >
              <p className="muted tabular wl-when">{[careShort(r.patient), flagCountText(r.flags)].filter(Boolean).join(' · ')}</p>
              <RedFlagItems flags={r.flags} brief patientId={r.patient.id} />
            </PatientRow>
          );
        })}
      </ul>
      <RedFlagRulesNote rules={data.rules} />
      <RedFlagsScopeNote rules={data.rules} />
    </Section>
  );
}

export function CarePlanSection({ data, onRemind }) {
  return (
    <Section id="wl-plan" icon={CalendarX2} title="Care plan to act on" count={data.carePlan.length} empty="Nothing overdue, due now or waiting for a decision.">
      <ul className="wl-list">
        {data.carePlan.map((r) => (
          <PatientRow key={r.patient.id} patient={r.patient} to={`/patients/${r.patient.id}/care-plan`} openLabel="Open the care plan">
            {/* Pregnancy care, or another type of care with its own plan (pregnancy loss) – said when it is not pregnancy care */}
            {careShort(r.patient) && <p className="muted wl-when">{careShort(r.patient)}</p>}
            <div className="wl-row-head">
              <span className="wl-counts">
                {SUMMARY_COUNTS.filter((c) => r.counts[c.key] > 0).map((c) => (
                  <StatusPill key={c.key} tone={c.tone} icon={c.icon}>
                    {c.word} <span className="tabular">{r.counts[c.key]}</span>
                  </StatusPill>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRemind(r.patient.id)} aria-label={`Prepare a reminder for ${r.patient.fullName}`}>
                  <MessageCircle aria-hidden="true" /> Reminder
                </button>
              </span>
            </div>
            {r.top.length > 0 && (
              <ul className="wl-items">
                {r.top.map((it) => {
                  const look = statusLook(it);
                  return (
                    <li key={it.itemId}>
                      <span className="sr-only">{look.word}: </span>
                      {it.name} <span className="muted tabular">by {formatDate(it.dueBy)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <NextVisitLine next={r.next} />
          </PatientRow>
        ))}
      </ul>
    </Section>
  );
}

/** "Vaccinations overdue": whether the baby is booked from today on. */
export const vaccinationLine = (r) => (r.bookedFor ? `Booked for ${formatDate(r.bookedFor)}` : 'No appointment booked');

/** What a baby's row shows when opened: how many are overdue, each vaccine with its last day, booking and phone. */
export function VaccinationDetails({ row }) {
  return (
    <>
      <div className="wl-row-head">
        <span className="wl-counts">
          <StatusPill tone="high" icon={CalendarX2}>
            Overdue <span className="tabular">{row.items.length}</span>
          </StatusPill>
          {row.draft && (
            <StatusPill tone="watch" icon={TriangleAlert}>
              Draft plan
            </StatusPill>
          )}
        </span>
      </div>
      <ul className="wl-items">
        {row.items.map((it) => (
          <li key={it.itemId}>
            <span className="sr-only">Overdue: </span>
            {it.name} <span className="muted tabular">by {formatDate(it.dueBy)}</span>
          </li>
        ))}
      </ul>
      <p className="hint">{vaccinationLine(row)}</p>
      {row.phone && (
        <a className="btn btn-link btn-sm" href={`tel:${row.phone.replace(/\s+/g, '')}`}>
          <Phone aria-hidden="true" /> {row.phone}
        </a>
      )}
    </>
  );
}

/**
 * Babies with a vaccination that became overdue in the last six weeks (doctors, RMOs and nurses): all their overdue
 * vaccines by name, whether the baby is booked, and the phone number on the baby's record. Reception has the same
 * babies on its own call list in general words (TodayPage). A plan built from a schedule no doctor has approved is
 * marked as a draft.
 */
export function VaccinationsOverdueSection({ data }) {
  const rows = data.vaccinationsOverdue ?? [];
  return (
    <Section id="wl-vaccines" icon={Syringe} title="Vaccinations overdue" count={rows.length} empty="No baby has an overdue vaccination.">
      <ul className="wl-list">
        {rows.map((r) => (
          <PatientRow key={r.patient.id} patient={r.patient} to={`/patients/${r.patient.id}/care-plan`} openLabel="Open the care plan">
            <VaccinationDetails row={r} />
          </PatientRow>
        ))}
      </ul>
      <p className="hint rf-note">
        Babies with a vaccination that became overdue in the last 6 weeks; older ones stay on the baby's care plan. A vaccine given elsewhere stays here until a doctor or RMO marks it in the
        care plan.
        {rows.some((r) => r.draft) ? ' "Draft plan": the schedule has not been approved by a doctor yet (Clinic library → To approve).' : ''}
      </p>
    </Section>
  );
}

/** The progress of a visit started today: red flag, vitals, doctor. */
export function VisitProgress({ visit }) {
  const seen = visit.detailsSaved || visit.medicines > 0;
  return (
    <span className="wl-counts">
      {visit.flagged && (
        <StatusPill tone="high" icon={Siren}>
          Red flag
        </StatusPill>
      )}
      <StatusPill tone={visit.vitalsSaved ? 'stable' : 'neutral'} icon={visit.vitalsSaved ? Check : null}>
        {visit.vitalsSaved ? 'Vitals done' : 'Vitals not yet'}
      </StatusPill>
      <StatusPill tone={seen ? 'stable' : 'neutral'} icon={seen ? Check : null}>
        {seen ? 'Seen by doctor' : 'Waiting for doctor'}
      </StatusPill>
    </span>
  );
}

/** Visits started today (for nurses, who have no appointment list). */
export function VisitsTodaySection({ data }) {
  return (
    <Section id="wl-today" icon={Stethoscope} title="Today's patients" count={data.seenToday.length} empty="No visits started today yet.">
      <ul className="wl-list">
        {data.seenToday.map((v) => (
          <PatientRow key={v.visitId} patient={v.patient} to={`/patients/${v.patient.id}/visits/${v.visitId}`} openLabel="Open the visit">
            <VisitProgress visit={v} />
            <p className="hint">
              Started {formatDateTime(v.startedAt)} by {v.startedByName}
              {v.medicines ? ` · ${v.medicines} medicine${v.medicines > 1 ? 's' : ''}` : ''}
            </p>
          </PatientRow>
        ))}
      </ul>
    </Section>
  );
}
