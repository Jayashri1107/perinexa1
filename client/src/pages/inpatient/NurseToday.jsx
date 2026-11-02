import { Activity, Archive, ArrowRightLeft, BedDouble, Check, ChevronRight, ClipboardPen, Clock, LogIn, LogOut, Megaphone, NotebookPen, PenLine, Siren, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber, LIST_PAGES, Paged } from '../../components/DataTable.jsx';
import { KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { FlagCountPill } from '../worklist/WorklistSections.jsx';

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

const stayLength = (admittedAt, now = Date.now()) => {
  const days = Math.floor((now - new Date(admittedAt).getTime()) / 86_400_000);
  return days < 1 ? 'Less than a day' : `${days} day${days > 1 ? 's' : ''}`;
};

const ROUND_CHIPS = [
  { key: 'all', label: 'In hospital', test: () => true },
  { key: 'flags', label: 'Red flags', test: (s) => s.redFlags?.length > 0 },
  { key: 'admission', label: 'Admission notes', test: (s) => !s.hasAdmissionNote },
  { key: 'round', label: 'Round notes due', test: (s) => !s.roundNoteToday },
  { key: 'vitals', label: 'Vitals due', test: (s) => vitalsDue(s) },
];

/**
 * Phones, a nurse or an RMO: the top of Today as in the app design (2 Nov 2026), from the same list as the cards above.
 * Nurse: a red flag first, three numbers, In hospital, the handover. RMO: the ward round's chips and In hospital.
 * `details` is what the In hospital list says under a patient (her red flags, or that nothing was checked).
 */
export function WardHome({ inpatients, rmo = false, details, after }) {
  const [chip, setChip] = useState('all');
  const admitted = inpatients?.admitted ?? null;
  const count = (test) => (admitted ? admitted.filter(test).length : 0);
  const flagged = count((s) => s.redFlags?.length > 0);
  const due = count((s) => vitalsDue(s));
  const drafts = admitted ? admitted.reduce((n, s) => n + (s.drafts ?? 0), 0) : 0;
  const shown = admitted ? admitted.filter(ROUND_CHIPS.find((c) => c.key === chip).test) : [];
  return (
    <div className={rmo ? 'wd-home wd-rmo' : 'wd-home'}>
      {!rmo && flagged > 0 && (
        <a className="wd-alert" href="#td-inpatients">
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>
              {formatNumber(flagged)} red flag{flagged > 1 ? 's' : ''} in the ward
            </strong>
            Tell the doctor on duty
          </span>
          <ChevronRight aria-hidden="true" />
        </a>
      )}
      {rmo ? (
        <>
          <div className="wd-chips" role="group" aria-label="Show">
            {ROUND_CHIPS.map((c) => (
              <button key={c.key} type="button" aria-pressed={chip === c.key} onClick={() => setChip(c.key)}>
                {c.label} ({admitted ? formatNumber(count(c.test)) : '–'})
              </button>
            ))}
          </div>
          {admitted && (
            <p className="wd-line">
              {formatNumber(count((s) => s.admittedToday))} admitted today · {formatNumber(inpatients.dischargedToday ?? 0)} discharged today
            </p>
          )}
        </>
      ) : (
        <section aria-labelledby="ward-glance">
          <h2 id="ward-glance">The ward at a glance</h2>
          <div className="wd-counts">
            <div>
              <strong className="tabular">{admitted ? formatNumber(admitted.length) : '–'}</strong>
              <span>In hospital</span>
            </div>
            <div className={due ? 'is-due' : undefined}>
              <strong className="tabular">{admitted ? formatNumber(due) : '–'}</strong>
              <span>Vitals due</span>
            </div>
            <div className={drafts ? 'is-due' : undefined}>
              <strong className="tabular">{admitted ? formatNumber(drafts) : '–'}</strong>
              <span>Notes to finish</span>
            </div>
          </div>
        </section>
      )}
      <section id="td-inpatients" aria-label="In hospital" aria-labelledby={rmo ? undefined : 'wd-in-title'}>
        {!rmo && <h2 id="wd-in-title">In hospital</h2>}
        {admitted && shown.length === 0 ? (
          <p className="wd-none">Nothing waiting here.</p>
        ) : (
          <Paged rows={shown} label="patients" {...LIST_PAGES}>
            {(page) => (
              <ul className="wd-list">
                {page.map((s) => (
                  <li key={s.admissionId}>
                    <Link className="wd-row" to={`/patients/${s.patient.id}/stays/${s.admissionId}`}>
                      <span className="wd-bed">{s.bed || <BedDouble aria-hidden="true" />}</span>
                      <span className="wd-who">
                        <strong>{s.patient.fullName}</strong>
                        {[s.ward, stayLength(s.admittedAt)].filter(Boolean).join(' · ')}
                      </span>
                      <ChevronRight className="wd-go" aria-hidden="true" />
                      <span className="wd-tags">
                        <FlagCountPill flags={s.redFlags} />
                        {rmo && !s.hasAdmissionNote && (
                          <StatusPill tone="watch" icon={ClipboardPen}>
                            Admission note to write
                          </StatusPill>
                        )}
                        {rmo && !s.roundNoteToday && (
                          <StatusPill tone="watch" icon={NotebookPen}>
                            Round note due
                          </StatusPill>
                        )}
                        {vitalsDue(s) && (
                          <StatusPill tone="watch" icon={Clock} title={`No vitals recorded in the last ${VITALS_DUE_HOURS} hours`}>
                            Vitals due
                          </StatusPill>
                        )}
                        {rmo && s.roundNoteToday && (
                          <StatusPill tone="stable" icon={Check}>
                            Round note written
                          </StatusPill>
                        )}
                        {s.drafts > 0 && (
                          <StatusPill tone="watch" icon={PenLine}>
                            {s.drafts} draft{s.drafts > 1 ? 's' : ''}
                          </StatusPill>
                        )}
                        {s.patient.closed && (
                          <StatusPill tone="inactive" icon={Archive}>
                            Record closed
                          </StatusPill>
                        )}
                      </span>
                    </Link>
                    {details?.(s)}
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        )}
      </section>
      {after}
      {!rmo && <HandoverList inpatients={inpatients} />}
    </div>
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
