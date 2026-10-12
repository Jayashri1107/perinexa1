import { Fragment } from 'react';
import { Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusPill } from '../../components/ui.jsx';
import { RED_FLAGS_NOT_CHECKED, RED_FLAG_STATUS } from './redFlagFormat.js';
import { sourceLink, sourceText } from './redFlagSources.js';

/** The level of a flag or rule as a status pill: colour + icon + word ("Urgent", "Watch"). */
export function RedFlagPill({ level }) {
  const s = RED_FLAG_STATUS[level] ?? RED_FLAG_STATUS.watch;
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {s.word}
    </StatusPill>
  );
}

/**
 * Where and when a flag's values were recorded: "from the lab result of 3 Oct 2026". With the patient's id each
 * place is a link to it (the visit, the lab result, the stay). Nothing for a flag from today's date only.
 */
export function RedFlagFrom({ flag, patientId = null }) {
  const sources = (flag.sources ?? []).filter((s) => sourceText(s));
  if (!sources.length) return null;
  return (
    <span className="rf-from muted tabular">
      {' · from '}
      {sources.map((s, i) => {
        const to = sourceLink(patientId, s);
        return (
          <Fragment key={i}>
            {i > 0 && ' and '}
            {to ? <Link to={to}>{sourceText(s)}</Link> : sourceText(s)}
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * Flags as a list. Each one always shows its level, what was found with the recorded values, where and when they
 * were recorded, and the rule that raised it; unless `brief`, also what to consider doing.
 * patientId: makes "from the visit on …" a link to that visit, lab result or stay.
 */
export function RedFlagItems({ flags, brief = false, patientId = null }) {
  return (
    <ul className="rf-list">
      {flags.map((f, i) => (
        // The same rule can be raised twice – by a visit's and by the nursing chart's reading – so the key has the place too
        <li key={`${f.key}-${i}`}>
          <RedFlagPill level={f.level} />
          <span className="rf-text">
            <strong>{f.label}</strong>
            {f.detail && <span className="muted tabular"> – {f.detail}</span>}
            <RedFlagFrom flag={f} patientId={patientId} />
            {!brief && f.message && <span className="rf-message">{f.message}</span>}
            {f.rule && <span className="rf-rule">Rule: {f.rule}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Draft rules" note (never only a colour) and a link to the rules. */
export function RedFlagRulesNote({ rules }) {
  if (!rules) return null;
  return (
    <p className="hint rf-note">
      {rules.status === 'approved' ? `Rules approved by ${rules.approvedByName}.` : 'Based on draft rules that no doctor has approved yet – use as a reminder only.'}{' '}
      <Link to="/care-plans/red-flags">See the rules</Link>
    </p>
  );
}

/**
 * The "Red flags" card (patient Overview, visit page, a stay in hospital). Nothing when there are no flags.
 * redFlags: { flags, rules }; patientId: links each flag to where its value was recorded.
 * about: one line beside the title saying which values were looked at (on the visit page: this visit's only).
 * title, titleId: for a second card on the same page (the visit page's "Other red flags on the record").
 */
export function RedFlagCard({ redFlags, patientId = null, about = null, title = 'Red flags', titleId = 'rf-card-title', className = '' }) {
  if (!redFlags?.flags?.length) return null;
  const urgent = redFlags.flags.some((f) => f.level === 'urgent');
  return (
    <section className={`card rf-card ${urgent ? 'rf-card-urgent' : 'rf-card-watch'} ${className}`.trim()} aria-labelledby={titleId}>
      <div className="rf-card-head">
        <h2 id={titleId}>
          <Siren aria-hidden="true" /> {title}
        </h2>
        {about && <span className="muted">{about}</span>}
      </div>
      <RedFlagItems flags={redFlags.flags} patientId={patientId} />
      <RedFlagRulesNote rules={redFlags.rules} />
      <details className="rf-more">
        <summary>What is not checked</summary>
        <p className="hint">{RED_FLAGS_NOT_CHECKED}</p>
      </details>
    </section>
  );
}
