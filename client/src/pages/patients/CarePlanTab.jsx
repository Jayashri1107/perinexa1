import { useEffect, useState } from 'react';
import {
  Ban,
  CalendarClock,
  CalendarDays,
  Check,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  Eye,
  Info,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  StickyNote,
} from 'lucide-react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { api } from '../../api.js';
import { Alert, Avatar, StatusPill, formatDate, formatDateTime, hasRole, useConfirm } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { ITEM_KIND_ICONS, ITEM_KIND_LABELS, ITEM_KINDS } from '../careplans/templateFormat.js';
import { NextVisitLine, PlanApproval } from './CarePlanCard.jsx';
import { CarePlanPrintPreview, PrintPlanDialog } from './CarePlanPrint.jsx';
import { hasContent, patientCopy } from './carePlanPrintFormat.js';
import {
  AddItemDialog,
  BookingDateDialog,
  ChangeProtocolDialog,
  ClosePlanDialog,
  EddDecisionDialog,
  EditItemDialog,
  IncludeDialog,
  ItemDetailsDialog,
  MarkDoneDialog,
  MoveDateDialog,
  NoteDialog,
  NotNeededDialog,
  ReopenPlanDialog,
  changeItem,
} from './carePlanDialogs.jsx';
import {
  CLOSE_REASONS,
  MISSING_FACT_TEXT,
  NO_LOSS_DETAILS,
  PLAN_VIEWS,
  STATUS_FILTERS,
  SUMMARY_COUNTS,
  answerIsForOtherPlan,
  approvalText,
  canInclude,
  canKeep,
  findingsWithoutItemsText,
  foldedItems,
  basisText,
  gaText,
  isAntenatalPlan,
  itemMarkers,
  itemState,
  logText,
  pausedOn,
  planCounts,
  planRows,
  statusLook,
  statusNote,
  PLAN_TITLES,
  RECORDED_ON_RECORD,
  planTitle,
  sinceText,
  windowText,
  SOON_DAYS,
  splitSoon,
} from './carePlanFormat.js';
import { canEditItem } from './customItemFormat.js';
import { CARE_TYPE_SHORT } from './patientFormat.js';

// The Care plan tab on the patient record: the patient's antenatal care plan (GET /care-plan), or with
// ?planId= one of her earlier plans (read-only). Outlet context from PatientDetailPage: patient, and
// onPlanChanged(summary), which every change calls with the answer's `summary` so the Overview card stays
// current without reading the whole record again.
//
// The server works out every item's status from the hospital's today; this page only groups, filters and
// shows them. Each change answers with the new plan, which replaces the one on screen. If someone else (or an
// automatic update) changed the plan meanwhile, the server answers 409: the dialog closes, the message is shown
// and the latest plan is loaded.

const LIST_DEFAULTS = { view: 'todo', kind: '', status: '' };
// Statuses whose "Move date" is offered as "Plan now", prefilled from today (spec §7.2).
const PLAN_NOW_STATUSES = ['decide', 'lapsed', 'missed', 'waiting', 'check_needed'];
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- The items table ----------

// The quick buttons on a row and its More menu. onAction(action, item, options) opens a dialog or makes the change.
function RowActions({ item, plan, decision, onAction }) {
  const open = itemState(item) === 'open';
  const name = item.name;
  // Answered on her record, not here (the anti-D of pregnancy-loss care): no "Mark done" – the server refuses it
  const canDone = !RECORDED_ON_RECORD[item.key];
  const quick = [];
  if (open && decision) {
    // Its time passed before booking: plan it from today, or record that it was done elsewhere. (Not for a
    // "Check needed" item still months away, such as a 34-week scan at 12 weeks.)
    if (item.status === 'decide') {
      quick.push({ key: 'plan-now', label: 'Plan now', aria: `Plan ${name} now`, icon: CalendarClock, run: () => onAction('move', item, { planNow: true }) });
      if (canDone) quick.push({ key: 'elsewhere', label: 'Done elsewhere', aria: `Mark ${name} done elsewhere`, icon: Check, run: () => onAction('done', item, { elsewhere: true }) });
    }
    if (canKeep(item)) quick.push({ key: 'keep', label: 'Keep as planned', aria: `Keep ${name} as planned`, icon: CircleCheck, run: () => onAction('keep', item) });
    else if (item.status === 'check_needed' && canInclude(item)) {
      quick.push({ key: 'include', label: 'Include anyway', aria: `Include ${name} anyway`, icon: CirclePlus, run: () => onAction('include', item) });
    }
    // An added item that may repeat another: keep both (Keep as planned), or this one is not needed
    if (item.status === 'decide' || item.status === 'check_needed' || (item.flags ?? []).includes('possible_duplicate')) {
      quick.push({ key: 'not-needed', label: 'Not needed', aria: `Mark ${name} not needed`, icon: Ban, run: () => onAction('not_needed', item) });
    }
  } else if (open && item.status === 'not_applicable' && canInclude(item)) {
    quick.push({ key: 'include', label: 'Include anyway', aria: `Include ${name} anyway`, icon: CirclePlus, run: () => onAction('include', item) });
  } else if (open && canDone) {
    quick.push({ key: 'done', label: 'Mark done', aria: `Mark ${name} done`, icon: Check, run: () => onAction('done', item) });
  }

  // One main button on the row; the other quick ones lead its More
  const extra = quick.splice(1);
  const inQuick = new Set([...quick, ...extra].map((q) => q.key)); // (those in More already are not added twice)
  const more = extra.map((q) => ({ label: q.label, icon: q.icon, onSelect: q.run }));
  // An item added for this patient can be corrected (name, wording, due window, note) instead of marked not needed and
  // added again – while it is open, on an active plan
  if (canEditItem(item, plan)) more.push({ label: 'Edit item', icon: Pencil, onSelect: () => onAction('edit', item) });
  if (open) {
    if (!inQuick.has('done') && canDone) more.push({ label: 'Mark done', icon: Check, onSelect: () => onAction('done', item) });
    // "Plan now" (from today) for items whose own dates have passed or are not known yet.
    const planNow = PLAN_NOW_STATUSES.includes(item.status);
    // An item that does not apply to this patient has no date to move and is not "needed" anyway: Include
    // anyway (the quick button) is the way to plan it.
    const applies = item.status !== 'not_applicable';
    if (applies && !inQuick.has('plan-now')) {
      more.push({ label: planNow ? 'Plan now' : 'Move date', icon: CalendarClock, onSelect: () => onAction('move', item, { planNow }) });
    }
    if (item.manualDate) more.push({ label: 'Reset date', icon: RotateCcw, onSelect: () => onAction('reset_date', item) });
    if (applies && !inQuick.has('not-needed')) more.push({ label: 'Not needed', icon: Ban, onSelect: () => onAction('not_needed', item) });
    if (canInclude(item) && !inQuick.has('include')) more.push({ label: 'Include anyway', icon: CirclePlus, onSelect: () => onAction('include', item) });
    if (item.forceInclude) more.push({ label: 'Remove inclusion', icon: CircleMinus, onSelect: () => onAction('remove_include', item) });
    if (canKeep(item) && !inQuick.has('keep')) more.push({ label: 'Keep as planned', icon: CircleCheck, onSelect: () => onAction('keep', item) });
  } else {
    more.push({ label: 'Reopen', icon: RotateCcw, onSelect: () => onAction('reopen', item) });
  }
  more.push({ label: item.note ? 'Edit note' : 'Add note', icon: StickyNote, onSelect: () => onAction('note', item) });
  more.push({ label: 'Details', icon: Info, onSelect: () => onAction('details', item) });

  return (
    <div className="plan-actions">
      {quick.map((q) => (
        <button key={q.key} type="button" className="btn btn-secondary btn-sm" aria-label={q.aria} onClick={q.run}>
          <q.icon aria-hidden="true" /> {q.label}
        </button>
      ))}
      <MenuButton label="More" ariaLabel={`More actions for ${name}`} className="btn btn-secondary btn-sm" align="end" items={more} />
    </div>
  );
}

// "When": the timing in weeks (or dates) and the due dates – Deep Teal with CalendarDays when due or upcoming.
function WhenCell({ item }) {
  const scheduled = item.status === 'due' || item.status === 'upcoming';
  const dates = item.due ? windowText(item.due.from, item.due.to) : item.estimateFrom ? `about ${formatDate(item.estimateFrom)}` : '';
  return (
    <>
      <span>{item.timingText}</span>
      {dates && (
        <span className={`plan-when-dates tabular ${scheduled ? 'plan-scheduled' : ''}`.trim()}>
          {scheduled && <CalendarDays aria-hidden="true" />}
          {dates}
        </span>
      )}
    </>
  );
}

function ItemCell({ item, plan, onOpen }) {
  const markers = itemMarkers(item, plan);
  const sub = [item.done?.result && `Result: ${item.done.result}`, item.done?.note && `Note: ${item.done.note}`, item.note?.text && `Note: ${item.note.text}`].filter(Boolean);
  return (
    <>
      <span className="plan-item-head">
        <StatusPill tone="neutral" icon={ITEM_KIND_ICONS[item.kind] ?? null}>
          {ITEM_KIND_LABELS[item.kind] ?? item.kind}
        </StatusPill>
        <button type="button" className="plan-item-name" data-item-id={item.id} onClick={() => onOpen(item)}>
          {item.name}
        </button>
      </span>
      {markers.length > 0 && (
        <span className="plan-markers">
          {markers.map((m) => (
            <StatusPill key={m.key} tone={m.tone} icon={m.icon}>
              {m.label}
            </StatusPill>
          ))}
        </span>
      )}
      {sub.length > 0 && (
        <span className="cell-sub">
          {sub.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </span>
      )}
    </>
  );
}

function StatusCell({ item, plan, patient }) {
  const look = statusLook(item, plan);
  const note = statusNote(item, plan, patient);
  // Answered on her record, not on the plan (the anti-D of pregnancy-loss care): where to record it
  const onRecord = itemState(item) === 'open' && item.status !== 'not_applicable' ? RECORDED_ON_RECORD[item.key] : null;
  return (
    <>
      <StatusPill tone={look.tone} icon={look.icon}>
        {look.word}
      </StatusPill>
      {note && <span className="plan-status-note t-caption muted">{note}</span>}
      {onRecord && <span className="plan-status-note t-caption muted">{onRecord}</span>}
    </>
  );
}

/**
 * The items table (also used inside the folded sections). rows: from planRows(). Editors get the Actions
 * column; for everyone else a click on a row opens the item's details.
 */
function ItemsTable({ plan, patient, rows, caption, emptyText, onAction }) {
  const editable = plan.canEdit;
  const cols = editable ? 4 : 3;
  const openDetails = (item) => onAction('details', item);
  return (
    <table className="dt plan-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="plan-col-when">
            When
          </th>
          <th scope="col">Item</th>
          <th scope="col" className="plan-col-status">
            Status
          </th>
          {editable && (
            <th scope="col" className="plan-col-actions">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          if (r.type === 'group') {
            return (
              <tr key={r.key} className="plan-group-row">
                <td colSpan={cols}>{r.label}</td>
              </tr>
            );
          }
          if (r.type === 'today') {
            return (
              <tr key={r.key} className="plan-today-row">
                <td colSpan={cols}>
                  <span className="plan-today-label">
                    <CalendarDays aria-hidden="true" /> Today · {sinceText(plan, plan.gestationToday) || formatDate(plan.today)}
                  </span>
                </td>
              </tr>
            );
          }
          const it = r.item;
          return (
            <tr
              key={r.key}
              className={`plan-item-row ${editable ? '' : 'dt-clickable'}`.trim()}
              onClick={editable ? undefined : (e) => !e.target.closest('a,button') && openDetails(it)}
            >
              <td data-label="When" className="plan-cell-when">
                <WhenCell item={it} />
              </td>
              <td data-label="Item" className="plan-cell-item">
                <ItemCell item={it} plan={plan} onOpen={openDetails} />
              </td>
              <td data-label="Status" className="plan-cell-status">
                <StatusCell item={it} plan={plan} patient={patient} />
              </td>
              {editable && (
                <td className="actions plan-cell-actions">
                  <RowActions item={it} plan={plan} decision={r.decision} onAction={onAction} />
                </td>
              )}
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={cols} className="dt-empty">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// A folded section under the table ("Missed visits (2)").
function Folded({ title, n, children }) {
  if (!n) return null;
  return (
    <details className="plan-folded card">
      <summary>
        {title} <span className="tabular">({n})</span>
      </summary>
      <div className="plan-folded-body">{children}</div>
    </details>
  );
}

// ---------- The top of the tab ----------

/** The alerts above the summary card, in the order of the specification. None can be dismissed. (Exported for its tests.) */
export function PlanAlerts({ plan, patient, viewingEarlier, canSeeTemplates, onOpen }) {
  const approval = approvalText(plan.template);
  const t = plan.template;
  const editor = plan.canChangePlan;
  const canEditDetails = Boolean(patient.access?.canEditClinical);
  const paused = plan.status === 'paused' ? pausedOn(plan) : null;
  const closed = plan.status === 'closed';
  // Ticked findings this plan has no items for (it was built before the template had them): offer the update
  const behind = viewingEarlier ? null : findingsWithoutItemsText(plan);
  return (
    <>
      {!t.approved && (
        <Alert type="warning">
          <strong>{approval.label}.</strong> {t.draftReason === 'risk_rules' ? approval.reason : `Based on “${t.name}” version ${t.version}, which no doctor has approved yet. Use it only as a reminder; the treating doctor decides.`}
          {canSeeTemplates && (
            <>
              {' '}
              <Link to={`/care-plans/templates/${t.id}`}>Review the template</Link>
            </>
          )}
        </Alert>
      )}
      {plan.eddReview && !closed && (
        <Alert type="warning">
          {editor ? (
            <>
              <p>
                The EDD changed from {formatDate(plan.eddReview.fromEdd)} to {formatDate(plan.eddReview.toEdd)}. The plan is on hold. Is this the same pregnancy?
              </p>
              <div className="row plan-alert-actions">
                <button type="button" className="btn btn-secondary" onClick={() => onOpen('edd', null, { decision: 'same_pregnancy' })}>
                  Same pregnancy – move the dates
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => onOpen('edd', null, { decision: 'new_pregnancy' })}>
                  New pregnancy – start a new plan
                </button>
              </div>
            </>
          ) : plan.canEdit ? (
            // The treating doctor or an RMO, but the plan is paused: nobody can decide until it is active again.
            <>
              The EDD changed from {formatDate(plan.eddReview.fromEdd)} to {formatDate(plan.eddReview.toEdd)}. The plan is paused, so the new dates can be confirmed once
              it is active again. You can still close the plan.
            </>
          ) : (
            <>
              The EDD changed from {formatDate(plan.eddReview.fromEdd)} to {formatDate(plan.eddReview.toEdd)}. Waiting for the treating doctor or an RMO to confirm the
              new dates.
            </>
          )}
        </Alert>
      )}
      {plan.status === 'paused' && (
        <Alert type="info">
          {paused ? `Paused on ${formatDate(paused)}` : 'Paused'} –{' '}
          {plan.pausedReason === 'no_edd'
            ? `${isAntenatalPlan(plan) ? 'the pregnancy dates were removed' : 'the day the plan counts from (delivery, birth or the date a pregnancy loss was seen) is no longer recorded'}. Items can still be marked done; no reminders.`
            : `the type of care is ${CARE_TYPE_SHORT[patient.careType] ?? patient.careType}. Items can still be marked done; no reminders.`}
          {plan.pausedReason !== 'no_edd' && patient.careType === 'abortion' && " If this pregnancy has ended, close the plan with 'Pregnancy ended'."}
        </Alert>
      )}
      {closed && (
        <Alert type="info" icon={viewingEarlier ? Eye : undefined}>
          <p>
            {viewingEarlier && <strong>Earlier care plan, read-only. </strong>}
            Closed on {formatDate(plan.closed?.at)} ({CLOSE_REASONS[plan.closed?.reason] ?? 'closed'}){plan.closed?.byName ? ` by ${plan.closed.byName}` : ''}.
            {plan.closed?.note && ` ${plan.closed.note}`}
          </p>
          <div className="row plan-alert-actions">
            {plan.canReopen && (
              <button type="button" className="btn btn-secondary" onClick={() => onOpen('reopen')}>
                <RotateCcw aria-hidden="true" /> Reopen
              </button>
            )}
            {viewingEarlier && (
              <Link to={`/patients/${patient.id}/care-plan`} className="btn btn-link">
                Back to the current plan
              </Link>
            )}
          </div>
        </Alert>
      )}
      {editor && t.updateAvailable && t.updateApproved && (
        <Alert type="info">
          An approved version of “{t.name}” is available (v{t.newerApprovedVersion}
          {t.newerApprovedByName ? `, approved by ${t.newerApprovedByName} on ${formatDate(t.newerApprovedAt)}` : ''}).{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={() => onOpen('protocol', null, { templateId: t.id })}>
            Review changes
          </button>
        </Alert>
      )}
      {plan.missingFacts?.length > 0 && !closed && (
        <Alert type="warning">
          {plan.missingFacts.map((f) => MISSING_FACT_TEXT[f] ?? `Some items can't be decided: ${f} not recorded.`).join(' ')}
          {canEditDetails && (
            <>
              {' '}
              <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add in Edit details</Link>
            </>
          )}
        </Alert>
      )}
      {behind && !closed && (
        <Alert type="warning">
          <strong>{behind.found}</strong> {behind.why}
          {behind.draft ? ` ${behind.draft}` : ''}{' '}
          {editor ? (
            <button type="button" className="btn btn-link plan-inline-link" onClick={() => onOpen('protocol', null, { templateId: t.id })}>
              Review the update
            </button>
          ) : (
            'The treating doctor or an RMO updates the plan.'
          )}
        </Alert>
      )}
      {plan.postDates && !closed && (
        <Alert type="warning">Past 43 weeks. If she has delivered, change the type of care to Postnatal – the plan pauses.</Alert>
      )}
      <PlanNotes plan={plan} patient={patient} closed={closed} editor={editor} canEditDetails={canEditDetails} />
    </>
  );
}

// Plans whose items can depend on findings ticked for the pregnancy (the note about them is shown there only).
const FINDING_NOTE_CARE = ['antenatal', 'postnatal'];

/** Notes that need no action now, folded into one box: a newer draft, recent automatic changes, how items for
 * findings in this pregnancy switch on, and view-only. (Warnings that need a decision stay above, unfolded.) */
function PlanNotes({ plan, patient, closed, editor, canEditDetails }) {
  const t = plan.template;
  const notes = [
    // (Not when the alert above already offers this update, for a ticked finding the plan has no items for.)
    editor && t.updateAvailable && !t.updateApproved && !(plan.findingsWithoutItems?.length > 0) && (
      <li key="draft">A newer draft of “{t.name}” (v{t.currentVersion}) is waiting for a doctor's approval. The plan can be updated once it is approved.</li>
    ),
    plan.recentChanges?.length > 0 && !closed && (
      <li key="changes">
        Recent automatic changes:
        <ul className="plan-error-list">
          {plan.recentChanges.map((c, i) => (
            <li key={`${c.at}-${i}`}>
              <span className="tabular">{formatDate(c.at)}</span> – {c.text}
            </li>
          ))}
        </ul>
      </li>
    ),
    plan.canEdit && !closed && FINDING_NOTE_CARE.includes(plan.careType ?? 'antenatal') && (
      <li key="findings">
        Items for a finding in this pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding) apply once the finding is ticked on her record
        {canEditDetails ? (
          <>
            {' '}
            – <Link to={`/patients/${patient.id}/edit`}>tick it in Edit details</Link>
          </>
        ) : (
          ' (Edit details)'
        )}
        . Use Include anyway or Add item only for what the template has no item for.
      </li>
    ),
    plan.readOnly && !closed && <li key="view">View only – the treating doctor or an RMO updates the plan.</li>,
  ].filter(Boolean);
  if (!notes.length) return null;
  return (
    <details className="plan-folded card plan-notes">
      <summary>
        <Info aria-hidden="true" /> Notes about this plan <span className="tabular">({notes.length})</span>
      </summary>
      <ul className="plan-notes-list">{notes}</ul>
    </details>
  );
}

/** The summary card: approval, dates, where the plan comes from, plan-level links, next visit and the count chips. */
function PlanSummary({ plan, filter, onFilter, onOpen }) {
  const counts = planCounts(plan);
  const chips = SUMMARY_COUNTS.filter((c) => counts[c.key] > 0);
  const t = plan.template;
  return (
    <section className="card plan-summary" aria-labelledby="plan-summary-title">
      <div className="plan-card-head plan-summary-head">
        <h2 id="plan-summary-title" tabIndex={-1}>
          <ListChecks aria-hidden="true" /> {planTitle(plan)}
        </h2>
        <div className="plan-summary-actions">
          <PlanApproval template={t} />
      {(plan.canChangePlan || plan.canClose) && (
        <div className="plan-summary-links">
          {/* Used rarely: one menu */}
          <MenuButton
            className="btn btn-secondary btn-sm"
            icon={MoreHorizontal}
            label="Plan"
            ariaLabel="Change the plan: booking date, protocol, close"
            items={[
              ...(plan.canChangePlan
                ? [
                    { label: 'Change booking date', icon: CalendarDays, onSelect: () => onOpen('booking') },
                    { label: 'Change protocol', icon: ListChecks, onSelect: () => onOpen('protocol') },
                  ]
                : []),
              ...(plan.canClose ? [{ label: 'Close plan', icon: CircleMinus, danger: true, onSelect: () => onOpen('close') }] : []),
            ]}
            align="end"
          />
        </div>
      )}
        </div>
      </div>
      <dl className="plan-summary-facts">
        <div>
          <dt>Today</dt>
          <dd>{sinceText(plan, plan.gestationToday) || '—'}</dd>
        </div>
        <div>
          <dt>Dates</dt>
          <dd>{basisText(plan)}</dd>
        </div>
        {isAntenatalPlan(plan) && (
          <div>
            <dt>Booked</dt>
            <dd>
              {formatDate(plan.bookedOn)}
              {plan.bookedAt ? ` at ${gaText(plan.bookedAt)}` : ''}
            </dd>
          </div>
        )}
        <div className="plan-summary-from">
          <dt>Protocol</dt>
          <dd>
            {t.name} – v{t.version}
          </dd>
        </div>
      </dl>
      <div className="plan-summary-next">
        <NextVisitLine next={plan.next} />
      </div>
      <div className="plan-chips" role="group" aria-label="Show only">
        {chips.map((c) => (
          <button key={c.key} type="button" className="plan-chip" aria-pressed={filter === c.key} onClick={() => onFilter(filter === c.key ? '' : c.key)}>
            <StatusPill tone={c.tone} icon={c.icon}>
              {c.word} <span className="tabular">{counts[c.key]}</span>
            </StatusPill>
          </button>
        ))}
        <button type="button" className="plan-chip" aria-pressed={filter === 'done'} onClick={() => onFilter(filter === 'done' ? '' : 'done')}>
          <StatusPill tone="neutral" icon={Check}>
            Done <span className="tabular">{counts.done}</span> of <span className="tabular">{counts.total}</span>
          </StatusPill>
        </button>
        <span className="hint plan-summary-note">Suggested schedule – the treating doctor decides. Statuses as of {formatDate(plan.today)}.</span>
      </div>
    </section>
  );
}

function PlanHistory({ log }) {
  return (
    <ul className="plain-list plan-log">
      {log.map((l, i) => (
        <li key={`${l.at}-${i}`}>
          <Avatar name={l.byName} />
          <div>
            <span>{logText(l)}</span>
            <div className="t-caption muted">
              {l.byName} · {formatDateTime(l.at)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EarlierPlans({ patient, plans, currentId }) {
  return (
    <ul className="plain-list plan-earlier">
      {plans.map((p) => (
        <li key={p.id}>
          <Link to={`/patients/${patient.id}/care-plan?planId=${p.id}`} aria-current={p.id === currentId ? 'page' : undefined}>
            {PLAN_TITLES[p.careType] ?? 'Care plan'}
            {p.careType === 'antenatal' || !p.careType ? ` – EDD ${formatDate(p.edd)}` : ''}
          </Link>
          <span className="muted">
            {' '}
            · {p.closedAt ? `closed ${formatDate(p.closedAt)}` : 'paused'}
            {p.closedReason ? ` (${CLOSE_REASONS[p.closedReason] ?? p.closedReason})` : ''} · {p.templateName}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- The tab ----------

export function PatientCarePlanTab() {
  const { patient, onPlanChanged } = useOutletContext();
  const { activeMembership } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const planId = searchParams.get('planId') || undefined;
  const [list, setList] = useListParams(LIST_DEFAULTS);
  const canView = Boolean(patient.access?.canViewCarePlan);
  const { data, error, loading, reload } = useFetch(canView ? `/patients/${patient.id}/care-plan` : null, { planId });
  // The plan from the latest change on this screen, until the plan is loaded again.
  const [changed, setChanged] = useState(null);
  useEffect(() => setChanged(null), [data]);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'warning' | 'error', text, undoItemId? }
  const [dialog, setDialog] = useState(null); // { type, item?, options? }
  const [starting, setStarting] = useState(false);
  const [showLater, setShowLater] = useState(false); // To do: the items after the next 6 weeks, folded
  const [printing, setPrinting] = useState(null); // { step: 'dialog' | 'preview', options } (Feature 9)
  const [confirm, confirmDialog] = useConfirm();
  const plan = changed ?? data?.plan ?? null;
  // useFetch keeps the last answer while a new one loads or if it fails. When ?planId= changed, that answer is
  // for another plan (or the "no current plan" screen): show the loading or error state instead.
  const otherPlan = answerIsForOtherPlan(data, plan, planId);
  const canSeeTemplates = hasRole(activeMembership, 'doctor', 'rmo', 'nurse');
  // After a change, focus goes back where the person was. For an item: its row, or the items table when the row
  // has moved out of view (e.g. marked done in the To do view). A plan-level change (close, EDD decision, reopen,
  // protocol update) can remove the button that opened the dialog: then focus goes to the plan's heading, or to
  // the "no current plan" card once the reload shows it. Nothing moves while focus is still somewhere on the page.
  const [focusTo, setFocusTo] = useState(null); // { itemId } or { plan: true }
  useEffect(() => {
    if (!focusTo) return undefined;
    const t = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const target = focusTo.itemId
        ? (document.querySelector(`[data-item-id="${focusTo.itemId}"]`) ?? document.getElementById('plan-items'))
        : (document.getElementById('plan-summary-title') ?? document.getElementById('plan-none'));
      target?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [focusTo, data]); // data: runs again when a reload lands (after Close plan, focus is lost only then)

  if (!canView) return <div className="card">Care plans are not part of your role.</div>;
  // Only while nothing is loading: useFetch keeps an old error during the next load (or a retry).
  if (error && !loading && (!data || otherPlan)) {
    return (
      <div className="card">
        <Alert type="error">{planId ? `This earlier care plan couldn't be opened: ${error}` : error}</Alert>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Try again
          </button>
          {planId && (
            <Link to={`/patients/${patient.id}/care-plan`} className="btn btn-link">
              Back to the current plan
            </Link>
          )}
        </div>
      </div>
    );
  }
  if (loading && (!data || otherPlan)) {
    return (
      <div className="card plan-loading" aria-busy="true">
        <span className="sr-only">Loading the care plan…</span>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="plan-skeleton" />
        ))}
      </div>
    );
  }

  const earlierPlans = data?.earlierPlans ?? [];
  const viewingEarlier = Boolean(planId && plan && plan.status === 'closed');

  // ----- Answers from the server -----

  // A change was saved: show the new plan, keep the Overview card current, and say what happened.
  // Only the dialog that sent the change closes (`dialog` here is the one open when it was sent): a slow answer
  // that arrives after Cancel must not close a dialog opened since then and lose what was typed in it. A new,
  // closed or reopened plan closes any dialog, since its item belongs to the old plan.
  const saved = (res, message, extra = {}) => {
    const itemId = extra.itemId ?? dialog?.item?.id;
    setDialog((d) => (d === dialog || extra.reload || extra.reopened ? null : d));
    setFocusTo(itemId ? { itemId } : { plan: true });
    if (res?.summary !== undefined) onPlanChanged(res.summary);
    if (res?.plan) setChanged(res.plan);
    setNotice({ type: 'success', text: message, undoItemId: extra.undoItemId ?? null });
    if (extra.reopened && planId) {
      // The reopened plan is the current plan now: show it without ?planId (which loads it again).
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('planId');
          return next;
        },
        { replace: true },
      );
    } else if (extra.reload || extra.reopened) reload();
  };
  // Someone else (or an automatic update) changed the plan: show why and load the latest plan. The plan on
  // screen stays until the latest one arrives (the plan from the first load may be several changes older).
  const conflict = (message) => {
    setDialog((d) => (d === dialog ? null : d));
    setFocusTo({ plan: true });
    setNotice({ type: 'warning', text: message });
    reload();
  };

  const quickChange = async (item, body, message) => {
    try {
      saved(await changeItem(patient.id, item, body), message, { itemId: item.id });
    } catch (err) {
      if (err.status === 409) conflict(err.message);
      else setNotice({ type: 'error', text: err.message });
    }
  };

  const undo = (itemId) => {
    const item = plan?.items.find((i) => i.id === itemId);
    if (item) quickChange(item, { action: 'reopen', reason: 'Undo' }, `Undone – ${item.name} is open again.`);
  };

  // Row actions and the tab's links: a dialog, or (for changes with nothing to fill in) the change itself.
  const onAction = async (type, item = null, options = {}) => {
    setNotice(null);
    setFocusTo(null);
    if (type === 'keep') return quickChange(item, { action: 'keep' }, `${item.name} kept as planned.`);
    if (type === 'reopen' && item) {
      const ok = await confirm({ title: `Reopen ${item.name}?`, text: 'It goes back to the open items. What was recorded stays in its history.', confirmLabel: 'Reopen' });
      if (ok) quickChange(item, { action: 'reopen', reason: '' }, `${item.name} reopened.`);
      return undefined;
    }
    if (type === 'reset_date') {
      const ok = await confirm({ title: `Reset the date of ${item.name}?`, text: 'The item goes back to the date worked out from the plan. The moved date stays in its history.', confirmLabel: 'Reset date' });
      if (ok) quickChange(item, { action: 'reset_date' }, `${item.name}: date reset to the plan.`);
      return undefined;
    }
    if (type === 'remove_include') {
      const ok = await confirm({ title: `Remove the inclusion of ${item.name}?`, text: 'The item then follows the patient\'s recorded details again.', confirmLabel: 'Remove inclusion' });
      if (ok) quickChange(item, { action: 'remove_include' }, `Inclusion removed from ${item.name}.`);
      return undefined;
    }
    setDialog({ type, item, options });
    return undefined;
  };

  // ----- No current plan -----

  // Gynaecology and fertility plans start only when a doctor or RMO asks (the others start by themselves).
  const startPlan = async () => {
    setStarting(true);
    try {
      saved(await api(`/patients/${patient.id}/care-plan/start`, { method: 'POST' }), 'Care plan started.', { reload: true });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setStarting(false);
    }
  };

  if (!plan) {
    return (
      <div className="plan-tab">
        <Alert type={notice?.type ?? 'success'} onClose={() => setNotice(null)}>
          {notice?.text}
        </Alert>
        <section className="card" id="plan-none" tabIndex={-1}>
          {data?.reason === 'no_dates' ? (
            <p>
              Pregnancy dates not entered yet. The care plan is built automatically when a doctor or RMO adds the LMP or scan EDD.
              {patient.access?.canEditClinical && (
                <>
                  {' '}
                  <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add pregnancy dates</Link>
                </>
              )}
            </p>
          ) : data?.reason === 'no_delivery' ? (
            <p>
              No delivery recorded yet. The postnatal care plan is built automatically from the day of delivery: when the treating doctor confirms the
              delivery note (Stays tab), or, for a delivery at another hospital, when the date is added to the patient's details.
              {patient.access?.canEditClinical && (
                <>
                  {' '}
                  <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add the delivery date</Link>
                </>
              )}
            </p>
          ) : data?.reason === 'no_birth' ? (
            <p>
              Date of birth not entered yet. The newborn care and vaccination plan is built automatically when the date and time of birth are added.
              {patient.access?.canEditClinical && (
                <>
                  {' '}
                  <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add the date of birth</Link>
                </>
              )}
            </p>
          ) : data?.reason === 'no_loss_details' ? (
            <p>
              {NO_LOSS_DETAILS}
              {patient.access?.canEditClinical && (
                <>
                  {' '}
                  <Link className="plan-inline-hit" to={`/patients/${patient.id}/edit`}>Add the type of loss</Link>
                </>
              )}
            </p>
          ) : data?.reason === 'not_started' ? (
            <>
              <p>
                No {(CARE_TYPE_SHORT[patient.careType] ?? patient.careType).toLowerCase()} care plan yet. A doctor or RMO can start one: the suggested schedule is
                counted from today, and every item can be changed afterwards.
              </p>
              {patient.access?.canEditClinical && (
                <div className="row">
                  <button type="button" className="btn btn-secondary" disabled={starting} onClick={startPlan}>
                    {starting ? 'Starting…' : 'Start a care plan'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>No current care plan. {earlierPlans.length > 0 && 'Earlier plans are listed below – open one to see it or to reopen it.'}</p>
          )}
        </section>
        {earlierPlans.length > 0 && (
          <section className="card plan-section">
            <h2>Earlier care plans ({earlierPlans.length})</h2>
            <EarlierPlans patient={patient} plans={earlierPlans} />
          </section>
        )}
      </div>
    );
  }

  // ----- The plan -----

  const filter = STATUS_FILTERS[list.status] ? list.status : '';
  const view = PLAN_VIEWS.some((v) => v.key === list.view) ? list.view : 'todo';
  // Print: with a type chosen in "Type" (e.g. Visits), the patient copy of that type opens straight away – no
  // questions. Otherwise (or when nothing of that type is still to come) the print dialog asks what to print.
  const startPrint = () => {
    const options = { copy: 'patient', scope: 'kinds', kinds: [list.kind], ids: [], includeDone: false, advice: '' };
    const direct = list.kind && plan.status === 'active' && !plan.eddReview && hasContent(patientCopy(plan, options));
    setPrinting(direct ? { step: 'preview', options } : { step: 'dialog', options: list.kind ? options : null });
  };
  const allRows = planRows(plan, { view, kind: list.kind, status: filter });
  // To do shows the next 6 weeks; what comes later is one click away (a list of the whole pregnancy was too long)
  const soon = view === 'todo' && !filter && !showLater ? splitSoon(allRows, plan) : { shown: allRows, later: [] };
  const rows = soon.shown;
  const folded = view === 'todo' && !filter ? foldedItems(plan, { kind: list.kind }) : null;
  const setFilter = (status) => setList(status ? { status, view: STATUS_FILTERS[status].view } : { status: '' });
  const viewLabel = PLAN_VIEWS.find((v) => v.key === view).label;
  const dialogProps = { patient, plan, item: dialog?.item, onSaved: saved, onConflict: conflict, onCancel: () => setDialog(null) };
  const emptyText =
    plan.items.length === 0
      ? 'The template has no items – choose a protocol or add items.'
      : filter || list.kind
        ? 'No items match – show all items to see the others.'
        : view === 'todo'
          ? 'Nothing to do now.'
          : view === 'done'
            ? 'Nothing is marked done or not needed yet.'
            : 'No items.';

  return (
    <div className="plan-tab">
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
          {notice.undoItemId && plan.canEdit && (
            <>
              {' '}
              <button type="button" className="btn btn-link plan-inline-link" onClick={() => undo(notice.undoItemId)}>
                Undo
              </button>
            </>
          )}
        </Alert>
      )}
      {error && (
        <Alert type="error">
          The latest plan couldn't be loaded: {error}{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      <PlanAlerts plan={plan} patient={patient} viewingEarlier={viewingEarlier} canSeeTemplates={canSeeTemplates} onOpen={onAction} />
      <PlanSummary plan={plan} filter={filter} onFilter={setFilter} onOpen={onAction} />

      <section id="plan-items" tabIndex={-1} className="dt-card plan-items" aria-label="Care plan items">
        <div className="dt-toolbar plan-toolbar">
          <div className="segmented" role="group" aria-label="Show">
            {PLAN_VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setList({ view: v.key, status: '' })}>
                {v.label}
              </button>
            ))}
          </div>
          <label className="dt-filter">
            <span className="dt-filter-label">Type</span>
            <select value={list.kind} onChange={(e) => setList({ kind: e.target.value })}>
              <option value="">All types</option>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ITEM_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="plan-toolbar-actions">
            <button type="button" className="btn btn-secondary" onClick={startPrint}>
              <Printer aria-hidden="true" /> Print
            </button>
            {plan.canChangePlan && (
              <button type="button" className="btn btn-secondary" onClick={() => onAction('add')}>
                <Plus aria-hidden="true" /> Add item
              </button>
            )}
          </div>
        </div>
        {filter && (
          <p className="plan-filter-line">
            Showing only: <strong>{STATUS_FILTERS[filter].word}</strong>{' '}
            <button type="button" className="btn btn-link" onClick={() => setFilter('')}>
              Show all items
            </button>
          </p>
        )}
        <div className="plan-table-wrap" aria-busy={loading}>
          <ItemsTable plan={plan} patient={patient} rows={rows} caption={`Care plan items: ${viewLabel}`} emptyText={emptyText} onAction={onAction} />
          {soon.later.length > 0 && (
            <p className="plan-later">
              {soon.later.length} more {soon.later.length === 1 ? 'item comes' : 'items come'} after the next {SOON_DAYS / 7} weeks.{' '}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLater(true)}>
                Show {soon.later.length} later {soon.later.length === 1 ? 'item' : 'items'}
              </button>
            </p>
          )}
          {showLater && view === 'todo' && !filter && (
            <p className="plan-later">
              <button type="button" className="btn btn-link btn-sm" onClick={() => setShowLater(false)}>
                Show only the next {SOON_DAYS / 7} weeks
              </button>
            </p>
          )}
        </div>
      </section>

      {folded && (
        <>
          <Folded title="Missed visits" n={folded.missed.length}>
            <ItemsTable plan={plan} patient={patient} rows={folded.missed.map((it) => ({ type: 'item', key: it.id, item: it }))} caption="Missed visits" emptyText="" onAction={onAction} />
          </Folded>
          <Folded title="Does not apply" n={folded.notApplicable.length}>
            <ItemsTable plan={plan} patient={patient} rows={folded.notApplicable.map((it) => ({ type: 'item', key: it.id, item: it }))} caption="Does not apply" emptyText="" onAction={onAction} />
          </Folded>
          <Folded title="Before booking or covered" n={folded.lapsed.length}>
            <ItemsTable plan={plan} patient={patient} rows={folded.lapsed.map((it) => ({ type: 'item', key: it.id, item: it }))} caption="Before booking or covered" emptyText="" onAction={onAction} />
          </Folded>
        </>
      )}
      <Folded title="Plan history" n={plan.log?.length ?? 0}>
        <PlanHistory log={plan.log} />
      </Folded>
      <Folded title="Earlier care plans" n={earlierPlans.length}>
        <EarlierPlans patient={patient} plans={earlierPlans} currentId={plan.id} />
      </Folded>

      {dialog?.type === 'done' && <MarkDoneDialog {...dialogProps} elsewhere={dialog.options?.elsewhere} />}
      {dialog?.type === 'move' && <MoveDateDialog {...dialogProps} planNow={dialog.options?.planNow} />}
      {dialog?.type === 'not_needed' && <NotNeededDialog {...dialogProps} />}
      {dialog?.type === 'include' && <IncludeDialog {...dialogProps} />}
      {dialog?.type === 'note' && <NoteDialog {...dialogProps} />}
      {dialog?.type === 'details' && <ItemDetailsDialog {...dialogProps} />}
      {dialog?.type === 'add' && <AddItemDialog {...dialogProps} />}
      {dialog?.type === 'edit' && <EditItemDialog {...dialogProps} />}
      {dialog?.type === 'protocol' && <ChangeProtocolDialog {...dialogProps} templateId={dialog.options?.templateId} />}
      {dialog?.type === 'booking' && <BookingDateDialog {...dialogProps} />}
      {dialog?.type === 'edd' && <EddDecisionDialog {...dialogProps} decision={dialog.options.decision} />}
      {dialog?.type === 'close' && <ClosePlanDialog {...dialogProps} />}
      {dialog?.type === 'reopen' && <ReopenPlanDialog {...dialogProps} />}
      {printing?.step === 'dialog' && (
        <PrintPlanDialog plan={plan} initial={printing.options} onPreview={(options) => setPrinting({ step: 'preview', options })} onCancel={() => setPrinting(null)} />
      )}
      {printing?.step === 'preview' && (
        <CarePlanPrintPreview
          patient={patient}
          plan={plan}
          options={printing.options}
          onBack={(kept) => setPrinting({ step: 'dialog', options: { ...printing.options, ...kept } })}
          onClose={() => setPrinting(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
