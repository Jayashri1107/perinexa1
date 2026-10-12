import { useRef, useState } from 'react';
import { Ban, CalendarDays, ChevronDown, ListChecks, MessageCircle, Pill } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, StatusPill, formatDate, hasRole } from '../../components/ui.jsx';
import { ReminderDialog } from '../reminders/ReminderDialog.jsx';
import { NotNeededDialog } from './carePlanDialogs.jsx';
import { CLOSE_REASONS, NO_LOSS_DETAILS, PAUSED_TEXT, STATUS_FILTERS, SUMMARY_COUNTS, approvalText, eddShiftText, nextVisitText, planTitle, statusLook } from './carePlanFormat.js';

/** Does this patient get the Care plan tab and the Overview card? Every type of care has a plan (Version 2). */
export const showsCarePlan = (patient) => Boolean(patient.access?.canViewCarePlan);

/**
 * The plan's approval state: the pill, and for a draft the visible sentence too (never only a colour).
 * On the Care plan tab (PlanView.template) an approved plan also names who approved it and when.
 */
export function PlanApproval({ template }) {
  const a = approvalText(template);
  if (!a) return null;
  return (
    <span className="plan-approval">
      <StatusPill tone={a.tone} icon={a.icon}>
        {a.word}
      </StatusPill>
      {a.label && <strong className="plan-draft-label">{a.label}</strong>}
      {template.approved && template.approvedByName && (
        <span className="t-caption muted">
          Approved by {template.approvedByName}
          {template.approvedAt ? ` on ${formatDate(template.approvedAt)}` : ''}
        </span>
      )}
    </span>
  );
}

/** The teal "Next visit: …" line (scheduled items are marked in teal). Nothing when no visit is coming. */
export function NextVisitLine({ next }) {
  const text = nextVisitText(next);
  if (!text) return null;
  return (
    <p className="plan-next tabular">
      <CalendarDays aria-hidden="true" />
      {text}
    </p>
  );
}

// The counts that open a list on the Overview card (Missed visits stays a plain count).
const OPENABLE = ['overdue', 'due', 'needsDecision'];
const sameDay = (a, b) => Boolean(a && b) && String(a).slice(0, 10) === String(b).slice(0, 10);

/**
 * The count pills. On the Overview card, Overdue, Due now and Needs decision are buttons: `open` is the one whose
 * list is shown, `onToggle(key)` opens or closes it. Only counts above zero get a status colour; "Done 9 of 44" is
 * plain text.
 */
export function PlanCounts({ counts, open = null, onToggle = null }) {
  if (!counts) return null;
  const shown = SUMMARY_COUNTS.filter((c) => counts[c.key] > 0);
  return (
    <div className="plan-counts">
      {shown.map((c) => {
        const pill = (
          <StatusPill tone={c.tone} icon={c.icon}>
            {c.word} <span className="tabular">{counts[c.key]}</span>
            {onToggle && OPENABLE.includes(c.key) && <ChevronDown aria-hidden="true" className="plan-count-chevron" />}
          </StatusPill>
        );
        return onToggle && OPENABLE.includes(c.key) ? (
          <button
            key={c.key}
            type="button"
            className={`plan-count-btn ${open === c.key ? 'is-open' : ''}`.trim()}
            aria-expanded={open === c.key}
            aria-controls="plan-drop"
            onClick={() => onToggle(c.key)}
          >
            {pill}
          </button>
        ) : (
          <span key={c.key}>{pill}</span>
        );
      })}
      <span className="plan-done-count tabular">
        Done {counts.done} of {counts.total}
      </span>
    </div>
  );
}

/**
 * The items behind one count, with "Add to prescription" and "Remove" (= Not needed, with a reason, like on the
 * Care plan tab). Add to prescription opens today's visit (started if there is none) with the item added to
 * Tests advised, Advice or the medicines – the doctor checks it there and saves; nothing is saved from here.
 */
function PlanDrop({ patient, statusKey, plan, error, onRemove }) {
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
  const [busyId, setBusyId] = useState(null);
  const [addError, setAddError] = useState(null);
  const requestId = useRef(null);
  const canPrescribe = hasRole(activeMembership, 'doctor', 'rmo') && Boolean(patient.access?.canViewVisits);

  const addToPrescription = async (item) => {
    setBusyId(item.id);
    setAddError(null);
    try {
      const list = await api(`/patients/${patient.id}/visits`);
      let visit = list.visits.find((v) => v.status === 'active' && sameDay(v.visitOn, list.today));
      if (!visit) {
        requestId.current ??= newRequestId();
        visit = (await api(`/patients/${patient.id}/visits`, { method: 'POST', body: { clientRequestId: requestId.current } })).visit;
        requestId.current = null;
      }
      const tab = item.kind === 'medication' ? '?tab=prescription' : '';
      navigate(`/patients/${patient.id}/visits/${visit.id}${tab}`, { state: { fromPlan: { kind: item.kind, name: item.name } } });
    } catch (err) {
      setAddError(`Couldn't open today's visit: ${err.message}`);
      setBusyId(null);
    }
  };

  let body;
  if (error) body = <Alert type="error">{error}</Alert>;
  else if (!plan) body = <p className="muted" aria-busy="true">Loading…</p>;
  else {
    const items = plan.items.filter(STATUS_FILTERS[statusKey].match);
    body =
      items.length === 0 ? (
        <p className="muted">Nothing here now.</p>
      ) : (
        <ul className="plan-top">
          {items.map((item) => {
            const look = statusLook(item);
            return (
              <li key={item.id}>
                <StatusPill tone={look.tone} icon={look.icon}>
                  {look.word}
                </StatusPill>
                <span className="plan-top-name">{item.name}</span>
                {item.due?.to && <span className="plan-top-date tabular muted">by {formatDate(item.due.to)}</span>}
                {plan.canChangePlan && (
                  <span className="plan-drop-actions">
                    {canPrescribe && item.kind !== 'visit' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => addToPrescription(item)} disabled={busyId !== null} aria-label={`Add ${item.name} to the prescription`}>
                        <Pill aria-hidden="true" /> {busyId === item.id ? 'Opening…' : 'Add to prescription'}
                      </button>
                    )}
                    <button type="button" className="btn btn-link btn-sm" onClick={() => onRemove(item)} aria-label={`Remove ${item.name} (not needed)`}>
                      <Ban aria-hidden="true" /> Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      );
  }
  return (
    <div id="plan-drop" className="plan-drop" role="region" aria-label={STATUS_FILTERS[statusKey].word}>
      <Alert type="error" onClose={() => setAddError(null)}>
        {addError}
      </Alert>
      {body}
    </div>
  );
}

/**
 * The "Care plan" card, first on the patient's Overview. It shows the plan's approval state, the counts and the
 * next visit; clicking Overdue, Due now or Needs decision opens the list of those items (loaded then, from
 * GET /care-plan), each with Add to prescription and Remove.
 * summary: carePlanSummary (from the patient record, or the latest answer to a plan change);
 * null when the server could not work it out. onPlanChanged(summary): after a Remove, keeps the page current.
 */
export function CarePlanCard({ patient, summary, onPlanChanged }) {
  const planTo = `/patients/${patient.id}/care-plan`;
  const canAddDates = Boolean(patient.access?.canEditClinical);
  const [open, setOpen] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reminding, setReminding] = useState(false);
  const { activeMembership } = useAuth();
  const canRemind = hasRole(activeMembership, 'doctor', 'rmo', 'nurse') && summary?.exists && summary.status === 'active';

  const loadPlan = async () => {
    setPlanError(null);
    try {
      const res = await api(`/patients/${patient.id}/care-plan`);
      setPlan(res.plan ?? null);
      if (!res.plan) setPlanError('The care plan could not be opened. Open the care plan to try again.');
    } catch (err) {
      setPlanError(err.message);
    }
  };
  const toggle = (key) => {
    setNotice(null);
    setOpen((o) => (o === key ? null : key));
    if (!plan) loadPlan();
  };
  const removed = (res, message) => {
    setRemoving(null);
    if (res?.plan) setPlan(res.plan);
    if (res?.summary !== undefined) onPlanChanged?.(res.summary);
    setNotice({ type: 'success', text: message });
  };
  const conflict = (message) => {
    setRemoving(null);
    setNotice({ type: 'warning', text: message });
    loadPlan();
  };

  const openLink = (
    <div className="plan-card-links">
      <Link to={planTo} className="btn btn-link plan-open">
        Open care plan
      </Link>
      {canRemind && (
        <button type="button" className="btn btn-link" onClick={() => setReminding(true)}>
          <MessageCircle aria-hidden="true" /> Send a reminder
        </button>
      )}
    </div>
  );

  let body;
  if (summary === null || summary === undefined) {
    body = <p className="muted">The care plan couldn't be loaded just now. Open the care plan to try again.</p>;
  } else if (!summary.exists) {
    body =
      summary.reason === 'no_dates' ? (
        <p>
          No care plan yet – it is built automatically once the LMP or scan EDD is entered.
          {canAddDates && (
            <>
              {' '}
              <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add pregnancy dates</Link>
            </>
          )}
        </p>
      ) : summary.reason === 'no_delivery' ? (
        <p>No care plan yet – the postnatal plan is built automatically when the doctor confirms the delivery note.</p>
      ) : summary.reason === 'no_birth' ? (
        <p>No care plan yet – the newborn care and vaccination plan is built automatically once the date of birth is entered.</p>
      ) : summary.reason === 'no_loss_details' ? (
        <p>
          {NO_LOSS_DETAILS}
          {canAddDates && (
            <>
              {' '}
              <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add the type of loss</Link>
            </>
          )}
        </p>
      ) : summary.reason === 'not_started' && summary.earlierCount === 0 ? (
        <p>
          No care plan yet. <Link className="plan-inline-hit" to={`/patients/${patient.id}/care-plan`}>Open the care plan</Link> to start one.
        </p>
      ) : summary.earlierCount > 0 ? (
        <p>
          No current care plan.{' '}
          {summary.lastClosed && (
            <>
              The last plan was closed on {formatDate(summary.lastClosed.at)} ({CLOSE_REASONS[summary.lastClosed.reason] ?? 'closed'}).{' '}
            </>
          )}
          {summary.earlierCount === 1 ? (summary.lastClosed ? 'It is' : 'An earlier plan is') : `${summary.earlierCount} earlier plans are`} kept in the record.
        </p>
      ) : (
        <p className="muted">No care plan yet.</p>
      );
  } else {
    const c = summary.counts;
    const nothingDue = c && c.overdue === 0 && c.due === 0 && c.needsDecision === 0;
    const shownOpen = open && c?.[open] > 0 ? open : null;
    body = (
      <>
        {summary.eddReview && (
          <p className="plan-state-line">
            The EDD changed{summary.eddChange ? ` by ${eddShiftText(summary.eddChange.fromEdd, summary.eddChange.toEdd)}` : ''} – the plan waits for the doctor's
            decision.
          </p>
        )}
        {summary.status === 'paused' && (
          <p className="plan-state-line">
            {summary.pausedAt ? `Paused on ${formatDate(summary.pausedAt)}` : 'Paused'} – {PAUSED_TEXT[summary.pausedReason] ?? 'the plan is not active.'}
          </p>
        )}
        {summary.postDates && <p className="plan-state-line">Past 43 weeks. If she has delivered, change the type of care to Postnatal – the plan pauses.</p>}
        <PlanCounts counts={c} open={shownOpen} onToggle={toggle} />
        <Alert type={notice?.type ?? 'success'} onClose={() => setNotice(null)}>
          {notice?.text}
        </Alert>
        {shownOpen && <PlanDrop patient={patient} statusKey={shownOpen} plan={plan} error={planError} onRemove={setRemoving} />}
        <NextVisitLine next={summary.next} />
        {nothingDue && <p className="muted">Nothing overdue or due now.</p>}
      </>
    );
  }

  return (
    <section className="card card-wide plan-card" aria-labelledby="plan-card-title">
      <div className="plan-card-head">
        <h2 id="plan-card-title">
          <ListChecks aria-hidden="true" /> {summary?.exists ? planTitle(summary) : 'Care plan'}
        </h2>
        {summary?.exists && <PlanApproval template={summary.template} />}
      </div>
      {body}
      {openLink}
      {reminding && <ReminderDialog patientId={patient.id} onClose={() => setReminding(false)} />}
      {removing && plan && (
        <NotNeededDialog patient={patient} plan={plan} item={removing} onSaved={removed} onConflict={conflict} onCancel={() => setRemoving(null)} />
      )}
    </section>
  );
}
