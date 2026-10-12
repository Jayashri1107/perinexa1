// Small building blocks shared by the Analytics cards: reading a card's cells, the link to a cell's patients,
// and the "label: number" lines.
import { Ban, CalendarX2, Check, ChevronRight, CirclePause } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCount, isExact, listHref, sharePercent } from '../analyticsFormat.js';
import { RISK_STATUS } from '../../patients/riskFormat.js';

/** A cell of a card by key (its total too), or null. */
export const cellOf = (card, key) => (card.total && card.total.key === key ? card.total : (card.cells.find((c) => c.key === key) ?? null));
/** The value of a cell by key (null when the card has no such cell). */
export const valueOf = (card, key) => cellOf(card, key)?.value ?? null;

/** The link to the patients behind a cell: doctors only, only a cell the server marked as a list. */
export function hrefOf(card, cell, ctx) {
  if (ctx.audience !== 'doctor' || !cell?.list || !cell.code) return null;
  return listHref({ metric: card.id, cell: cell.code, section: ctx.section, params: ctx.params });
}

// Care-plan states on "Care plans now": colour + icon + word (the word is the row's label).
const E1_STATUS = {
  no_plan: { tone: 'inactive', icon: Ban },
  on_hold: { tone: 'inactive', icon: CirclePause },
  overdue: { tone: 'high', icon: CalendarX2 },
  on_track: { tone: 'stable', icon: Check },
};

/** The pill of a row that IS a status (risk level, care-plan state); null otherwise. */
export function statusOf(cell) {
  if (!cell.status) return null;
  const s = RISK_STATUS[cell.status] ?? E1_STATUS[cell.status];
  return s ? { tone: s.tone, icon: s.icon } : null;
}

/**
 * A cell as a BarList row. ofValue: the denominator each row is "x of" (multi-label rows), for a percentage
 * shown only from two exact numbers and 20 or more.
 */
export function barRow(card, cell, ctx, { ofValue } = {}) {
  const pct = ofValue !== undefined ? sharePercent(cell.value, ofValue) : null;
  return {
    key: cell.key,
    label: cell.label,
    sub: cell.sub,
    value: cell.value,
    unknown: cell.unknown,
    status: statusOf(cell),
    href: hrefOf(card, cell, ctx),
    share: pct === null ? null : `${pct}%`,
  };
}

/**
 * "Active pregnancies  9 ›" – one number on its own line, opening its list when there is one. sub: a short hint under
 * it; indent: a part of the line above (for example "In the first 7 days" under "Newborn deaths").
 */
export function FactLine({ label, value, href, sub = null, indent = false }) {
  const text = (
    <>
      <span className="an-fact-label">{label}</span>
      <strong className={`an-fact-value ${isExact(value) ? '' : 'an-fact-words'}`.trim()}>{formatCount(value)}</strong>
    </>
  );
  const hint = sub ? <span className="an-fact-sub">{sub}</span> : null;
  return (
    <li className={`an-fact ${indent ? 'an-fact-indent' : ''}`.trim()}>
      {href ? (
        // The hint is read with the number it explains, before ": open the list of patients" (it is shown on its
        // own line below, by CSS order)
        <Link to={href} className="an-fact-link">
          {text}
          {hint}
          <ChevronRight aria-hidden="true" />
          <span className="sr-only">: open the list of patients</span>
        </Link>
      ) : (
        <>
          {text}
          {hint}
        </>
      )}
    </li>
  );
}

/** The card's total as a fact line. */
export function TotalLine({ card, ctx }) {
  if (!card.total) return null;
  return (
    <ul className="an-facts">
      <FactLine label={card.total.label} value={card.total.value} href={hrefOf(card, card.total, ctx)} />
    </ul>
  );
}
