import { Activity, ArrowRightLeft, BedDouble, ClipboardPen, LogIn, LogOut, Megaphone, NotebookPen, PenLine, Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';

// Vitals count as due when none were recorded in the last 8 hours – one nursing shift (owner, 13 Oct 2026). A
// reminder from what is on the nursing chart, not a clinical rule: the doctor's orders say how often to check.
export const VITALS_DUE_HOURS = 8;

export const vitalsDue = (stay, now = Date.now()) => !stay.lastVitalsAt || now - new Date(stay.lastVitalsAt).getTime() > VITALS_DUE_HOURS * 3_600_000;

/**
 * The ward at a glance on Today (owner, 13 Oct 2026), from the stays, their notes and the nursing chart – each card
 * opens the In hospital list. Nurses: patients in hospital, red flags, vitals due, notes to finish. RMOs (the ward
 * round): also admission notes to write, round notes due today, and who came in and went home today.
 */
export function WardToday({ inpatients, rmo = false }) {
  const admitted = inpatients?.admitted ?? null;
  const count = (test) => (admitted ? admitted.filter(test).length : 0);
  const value = (n) => (admitted ? formatNumber(n) : '—');
  const flagged = count((s) => s.redFlags?.length > 0);
  const due = count((s) => vitalsDue(s));
  const drafts = admitted ? admitted.reduce((n, s) => n + (s.drafts ?? 0), 0) : 0;
  const noAdmissionNote = count((s) => !s.hasAdmissionNote);
  const noRound = count((s) => !s.roundNoteToday);
  const inToday = count((s) => s.admittedToday);
  const list = '/#td-inpatients';
  return (
    <>
      <section className="td-group" aria-labelledby="ward-glance">
        <h2 className="td-group-title" id="ward-glance">
          {rmo ? 'Ward round' : 'The ward at a glance'}
        </h2>
        <div className="kpi-grid">
          <KpiCard to={list} tone={admitted?.length ? 'due' : 'neutral'} icon={BedDouble} label="In hospital" value={value(admitted?.length ?? 0)} sub="Admitted patients you can see" />
          <KpiCard to={list} tone={flagged ? 'high' : 'neutral'} icon={Siren} label="Red flags in the ward" value={value(flagged)} sub={flagged ? (rmo ? 'See them first' : 'Tell the doctor on duty') : 'No red flag in the ward'} />
          {rmo && (
            <KpiCard to={list} tone={noAdmissionNote ? 'watch' : 'neutral'} icon={ClipboardPen} label="Admission notes to write" value={value(noAdmissionNote)} sub="Admitted with no admission note yet" />
          )}
          {rmo && <KpiCard to={list} tone={noRound ? 'watch' : 'neutral'} icon={NotebookPen} label="Round notes due today" value={value(noRound)} sub="No round note written today" />}
          <KpiCard to={list} tone={due ? 'watch' : 'neutral'} icon={Activity} label="Vitals due" value={value(due)} sub={`None recorded in the last ${VITALS_DUE_HOURS} hours`} />
          {!rmo && <KpiCard to={list} tone={drafts ? 'watch' : 'neutral'} icon={PenLine} label="Notes to finish" value={value(drafts)} sub="Notes of the stays left as drafts" />}
          {rmo && (
            <KpiCard
              to={list}
              icon={ArrowRightLeft}
              label="Admitted / discharged today"
              value={admitted ? `${formatNumber(inToday)} / ${formatNumber(inpatients.dischargedToday ?? 0)}` : '—'}
              textValue
              sub="Came in today / went home today"
            />
          )}
        </div>
      </section>
      <nav className="td-quick" aria-label="Ward quick actions">
        <Link to="/beds" className="btn btn-secondary btn-sm">
          <BedDouble aria-hidden="true" /> Beds
        </Link>
      </nav>
    </>
  );
}

// Kept for the nurse's Today (the cards without the ward round)
export const NurseToday = ({ inpatients }) => <WardToday inpatients={inpatients} />;

/**
 * Handover and escalations of the last 24 hours (owner, 13 Oct 2026): the handover notes written for the next shift and
 * every time the consultant was told, newest first, each opening the stay. Written on the stay's nursing chart.
 */
export function HandoverList({ inpatients }) {
  const items = inpatients?.handovers ?? [];
  return (
    <section className="card ward-handover" aria-labelledby="ward-handover-title">
      <div className="ward-handover-head">
        <h2 id="ward-handover-title">Handover and escalations – last 24 hours</h2>
        <span className="muted">Write them on a patient's stay: Nursing chart → Handover note or Told the consultant</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">No handover note or escalation in the last 24 hours.</p>
      ) : (
        <ul className="ward-handover-list">
          {items.map((h) => (
            <li key={h.id}>
              <span className="ward-handover-when tabular">{formatDateTime(h.at)}</span>
              {h.kind === 'escalation' ? (
                <StatusPill tone="high" icon={Megaphone}>
                  Told {h.escalatedTo || 'the consultant'}
                </StatusPill>
              ) : (
                <StatusPill tone="due" icon={h.kind === 'handover' ? LogOut : LogIn}>
                  Handover
                </StatusPill>
              )}
              <span className="ward-handover-text">
                <Link to={`/patients/${h.patient.id}/stays/${h.admissionId}`}>{h.patient.fullName}</Link>
                {(h.ward || h.bed) && <span className="muted"> · {[h.ward, h.bed && `Bed ${h.bed}`].filter(Boolean).join(' · ')}</span>}
                <span className="ward-handover-note">{h.note}</span>
              </span>
              <span className="muted">{h.byName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
