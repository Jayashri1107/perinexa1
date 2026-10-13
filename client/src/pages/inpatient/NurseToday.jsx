import { Activity, BedDouble, PenLine, Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { KpiCard } from '../../components/ui.jsx';

// Vitals count as due when none were recorded in the last 8 hours – one nursing shift (owner, 13 Oct 2026). A
// reminder from what is on the nursing chart, not a clinical rule: the doctor's orders say how often to check.
export const VITALS_DUE_HOURS = 8;

export const vitalsDue = (stay, now = Date.now()) => !stay.lastVitalsAt || now - new Date(stay.lastVitalsAt).getTime() > VITALS_DUE_HOURS * 3_600_000;

/**
 * The nurse's Today (owner, 13 Oct 2026): the ward at a glance from the nursing chart – patients in hospital, those with
 * red flags, vitals not recorded this shift, and notes left as drafts – each opening the In hospital list.
 */
export function NurseToday({ inpatients }) {
  const admitted = inpatients?.admitted ?? null;
  const flagged = admitted ? admitted.filter((s) => s.redFlags?.length > 0) : [];
  const due = admitted ? admitted.filter((s) => vitalsDue(s)) : [];
  const drafts = admitted ? admitted.reduce((n, s) => n + (s.drafts ?? 0), 0) : 0;
  const value = (n) => (admitted ? formatNumber(n) : '—');
  return (
    <>
      <section className="td-group" aria-labelledby="nt-glance">
        <h2 className="td-group-title" id="nt-glance">
          The ward at a glance
        </h2>
        <div className="kpi-grid">
          <KpiCard to="/#td-inpatients" tone={admitted?.length ? 'due' : 'neutral'} icon={BedDouble} label="In hospital" value={value(admitted?.length ?? 0)} sub="Admitted patients you can see" />
          <KpiCard
            to="/#td-inpatients"
            tone={flagged.length ? 'high' : 'neutral'}
            icon={Siren}
            label="Red flags in the ward"
            value={value(flagged.length)}
            sub={flagged.length ? 'Tell the doctor on duty' : 'No red flag in the ward'}
          />
          <KpiCard
            to="/#td-inpatients"
            tone={due.length ? 'watch' : 'neutral'}
            icon={Activity}
            label="Vitals due"
            value={value(due.length)}
            sub={`None recorded in the last ${VITALS_DUE_HOURS} hours`}
          />
          <KpiCard to="/#td-inpatients" tone={drafts ? 'watch' : 'neutral'} icon={PenLine} label="Notes to finish" value={value(drafts)} sub="Notes of the stays left as drafts" />
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
