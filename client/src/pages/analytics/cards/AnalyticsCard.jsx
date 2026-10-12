// One Analytics card: a white panel with its title, whether it is "As of today" or covers the period, the
// chart, and its notes. Each card is drawn from what the server sends (analytics/publicCards.js): the numbers,
// their labels, which ones open a list (doctors only), and – for a hospital admin – which are shown in words.
// Nothing here works a number out again, and a hospital admin's rows are never re-sorted by value.
import { Building2, CalendarRange, Clock, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BarList } from '../../../components/charts/BarList.jsx';
import { ColumnChart, columnSummary } from '../../../components/charts/ColumnChart.jsx';
import { Meter } from '../../../components/charts/Meter.jsx';
import { formatNumber } from '../../../components/DataTable.jsx';
import { StatusPill } from '../../../components/ui.jsx';
import { TOO_FEW_TEXT, cardNotes, formatCount, isExact, isLeftOutCard, perHospitalText, ratioText, shareText } from '../analyticsFormat.js';
import { FactLine, TotalLine, barRow, cellOf, hrefOf, valueOf } from './cardParts.jsx';
import { StatTiles } from './StatTiles.jsx';

// Cards that take the full width of the page (tables, trends, groups of tiles).
export const WIDE_CARDS = new Set(['A1', 'A4', 'V1', 'DQ', 'A3', 'C4', 'E4', 'G1', 'G2', 'H1']);
const ALL_MASKED_TEXT = 'Fewer than 5 patients – numbers are not shown to hospital admins.';
export { TOO_FEW_TEXT };
const PLATFORM_REASON_ROWS = 10; // the super admin's risk reasons: the first 10, then "n more reasons not shown"

const C4_GROUPS = [
  { group: 'age', title: 'Age now' },
  { group: 'pregnancies', title: 'Pregnancy number' },
  { group: 'caesarean', title: 'Previous caesarean' },
  { group: 'blood', title: 'Blood group' },
];

/** Nothing to draw: the card's total is 0 (or, without a total, every number shown is 0). */
function isEmptyCard(card) {
  if (card.allMasked) return false;
  if (card.total) return card.total.value === 0;
  const shown = card.cells.filter((c) => !c.den);
  return shown.length > 0 && shown.every((c) => c.value === 0);
}

const sharesOf = (card, ctx, keys) =>
  card.shares
    .filter((s) => !keys || keys.includes(s.key))
    .map((s) => <Meter key={s.key} label={s.label} num={valueOf(card, s.num)} den={valueOf(card, s.den)} href={hrefOf(card, cellOf(card, s.num), ctx)} />);

function Trend({ card, ctx, title }) {
  if (!card.trend) return null;
  const columns = card.trend.cells.map((key) => {
    const c = cellOf(card, key);
    return { key, label: c?.label ?? key, value: c?.value ?? null, href: hrefOf(card, c, ctx) };
  });
  return (
    <ColumnChart
      columns={columns}
      color={card.trend.color}
      summary={columnSummary(title ?? card.title, columns, card.total?.value)}
      labelHeader={card.id === 'A3' ? 'Week starting' : 'Period'}
      valueHeader={{ A4: 'Visits', G1: 'Babies', H1: 'Deliveries' }[card.id] ?? 'Patients'}
    />
  );
}

function Bars({ card, ctx, cells, scale, ofValue, caption }) {
  if (!cells.length) return null;
  return <BarList rows={cells.map((c) => barRow(card, c, ctx, { ofValue }))} scale={isExact(scale) ? scale : undefined} caption={caption ?? card.title} />;
}

const plain = (card) => card.cells.filter((c) => !c.den && !c.group);

// ---------- One body per kind of card ----------

function RegistrationsBody({ card, ctx }) {
  return (
    <>
      <Bars card={card} ctx={ctx} cells={plain(card)} />
      <TotalLine card={card} ctx={ctx} />
      <Trend card={card} ctx={ctx} title="New registrations per period" />
    </>
  );
}

function VisitsBody({ card, ctx }) {
  const kinds = ['new', 'followUp'].map((k) => cellOf(card, k)).filter(Boolean);
  const types = card.cells.filter((c) => c.group === 'type');
  return (
    <>
      <StatTiles
        className="an-kpis-inline"
        tiles={[card.total, ...kinds].map((c) => ({ key: c.key, label: c.label, value: c.value, sub: c.sub ?? undefined }))}
      />
      {types.length > 0 && (
        <>
          <h3 className="an-subhead">By type of care of the visit</h3>
          <Bars card={card} ctx={ctx} cells={types} caption="Visits by type of care" />
        </>
      )}
      <Trend card={card} ctx={ctx} title="Visits per period" />
    </>
  );
}

function TableBody({ card, ctx, rowHeader = 'Type of care' }) {
  const { rows, cols } = card.table;
  return (
    <div className="an-table-wrap">
      <table className="dt an-table">
        <caption className="sr-only">{card.title}</caption>
        <thead>
          <tr>
            <th scope="col">{rowHeader}</th>
            {cols.map((col) => (
              <th key={col.key} scope="col" className="num">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {cols.map((col) => {
                const cell = cellOf(card, `r:${row.key}|c:${col.key}`);
                const href = hrefOf(card, cell, ctx);
                return (
                  <td key={col.key} className="num" data-label={col.label}>
                    {href ? <Link to={href}>{formatCount(cell?.value)}</Link> : formatCount(cell?.value ?? null)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordsToTidyBody({ card, ctx }) {
  const denOf = new Map(card.shares.map((s) => [s.num, s.den]));
  const tiles = card.cells
    .filter((c) => !c.den)
    .map((c) => {
      const den = denOf.get(c.key);
      const when = c.window === 'now' ? 'As of today' : 'In the period';
      return {
        key: c.key,
        label: c.label,
        value: c.value,
        href: hrefOf(card, c, ctx),
        sub: (
          <>
            <span className="an-tile-line">{den ? `${shareText(c.value, valueOf(card, den))} · ${when}` : when}</span>
            {c.tip && <span className="an-tile-line">{c.tip}</span>}
          </>
        ),
      };
    });
  return <StatTiles className="an-kpis-inline" tiles={tiles} />;
}

function WeeksBody({ card, ctx }) {
  const next4 = cellOf(card, 'next4');
  return (
    <>
      <Trend card={card} ctx={ctx} title="Expected deliveries per week, next 12 weeks" />
      <ul className="an-facts">
        {next4 && <FactLine label={next4.label} value={next4.value} href={hrefOf(card, next4, ctx)} />}
        <FactLine label={card.total.label} value={card.total.value} href={hrefOf(card, card.total, ctx)} />
      </ul>
    </>
  );
}

function PastDueBody({ card, ctx }) {
  const foot = card.cells.filter((c) => c.group === 'footnote');
  return (
    <>
      <Bars card={card} ctx={ctx} cells={plain(card)} />
      <ul className="an-facts">
        <FactLine label={card.total.label} value={card.total.value} href={hrefOf(card, card.total, ctx)} />
        {foot.map((c) => (
          <FactLine key={c.key} label={c.label} value={c.value} href={hrefOf(card, c, ctx)} />
        ))}
      </ul>
    </>
  );
}

function BarsWithTotal({ card, ctx }) {
  return (
    <>
      {sharesOf(card, ctx)}
      <Bars card={card} ctx={ctx} cells={plain(card)} />
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

function ReasonsBody({ card, ctx }) {
  const total = card.total?.value;
  let cells = card.cells.filter((c) => !c.den);
  let more = 0;
  if (ctx.audience === 'platform' && card.id === 'C2' && cells.length > PLATFORM_REASON_ROWS) {
    more = cells.length - PLATFORM_REASON_ROWS;
    cells = cells.slice(0, PLATFORM_REASON_ROWS);
  }
  return (
    <>
      <Bars card={card} ctx={ctx} cells={cells} scale={total} ofValue={total} />
      {more > 0 && <p className="an-line">{`${formatNumber(more)} more ${more === 1 ? 'reason' : 'reasons'} not shown.`}</p>}
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

function ProfileBody({ card, ctx }) {
  const total = card.total?.value;
  return (
    <>
      <div className="an-groups">
        {C4_GROUPS.map((g) => {
          const cells = card.cells.filter((c) => c.group === g.group);
          if (!cells.length) return null;
          return (
            <div key={g.group} className="an-group">
              <h3 className="an-subhead">{g.title}</h3>
              <Bars card={card} ctx={ctx} cells={cells} scale={total} caption={`${card.title}: ${g.title}`} />
            </div>
          );
        })}
      </div>
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

function ConditionsBody({ card, ctx }) {
  const known = valueOf(card, 'known');
  const rows = card.cells.filter((c) => c.group === 'rows');
  // Doctors and the super admin get exact rows: largest first (the server sends them in a fixed order).
  const sorted = rows.every((c) => isExact(c.value)) ? [...rows].sort((a, b) => b.value - a.value) : rows;
  const shown = sorted.filter((c) => !(isExact(c.value) && c.value === 0));
  const zero = sorted.filter((c) => isExact(c.value) && c.value === 0);
  const unknown = cellOf(card, 'unknown');
  return (
    <>
      {sharesOf(card, ctx)}
      {unknown && (
        <ul className="an-facts">
          <FactLine label={unknown.label} value={unknown.value} href={hrefOf(card, unknown, ctx)} />
        </ul>
      )}
      {rows.length > 0 && (
        <>
          <h3 className="an-subhead">Condition by condition</h3>
          {shown.length ? <Bars card={card} ctx={ctx} cells={shown} scale={known} ofValue={known} /> : <p className="an-line">No condition is ticked for these women.</p>}
          {zero.length > 0 && shown.length > 0 && <p className="an-line">{`None recorded: ${zero.map((c) => c.label).join(', ')}.`}</p>}
        </>
      )}
    </>
  );
}

function BpBody({ card, ctx }) {
  const high = cellOf(card, 'high');
  const normal = cellOf(card, 'normal');
  const sub = card.cells.filter((c) => c.group === 'sub');
  return (
    <>
      {sharesOf(card, ctx)}
      {normal && (
        <ul className="an-facts">
          <FactLine label={normal.label} value={normal.value} href={hrefOf(card, normal, ctx)} />
        </ul>
      )}
      {sub.length > 0 && (
        <>
          <h3 className="an-subhead">Of the women with BP 140/90 or higher</h3>
          {sub.map((c) => (
            <Meter key={c.key} label={c.label} num={c.value} den={high?.value} href={hrefOf(card, c, ctx)} />
          ))}
        </>
      )}
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

function CarePlansBody({ card, ctx }) {
  const states = card.cells.filter((c) => c.status);
  const overdue = cellOf(card, 'overdue');
  const items = card.cells.filter((c) => c.group === 'overdueItems'); // in the order the server sends them
  return (
    <>
      <Bars card={card} ctx={ctx} cells={states} scale={card.total?.value} />
      <TotalLine card={card} ctx={ctx} />
      {sharesOf(card, ctx)}
      <h3 className="an-subhead">Most often overdue</h3>
      {items.length ? (
        <Bars card={card} ctx={ctx} cells={items} scale={overdue?.value} ofValue={overdue?.value} caption="Care-plan items most often overdue" />
      ) : (
        <p className="an-line">No care-plan item is overdue.</p>
      )}
    </>
  );
}

function DoneByDueBody({ card, ctx }) {
  const { rows, cols } = card.table;
  const cell = (row, col) => cellOf(card, `r:${row}|c:${col}`);
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.group === r.group) last.rows.push(r);
    else groups.push({ group: r.group, rows: [r] });
  }
  return (
    <div className="an-table-wrap">
      <table className="dt an-table an-e4">
        <caption className="sr-only">{card.title}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            {cols.map((col) => (
              <th key={col.key} scope="col" className="num">
                {col.label}
              </th>
            ))}
            <th scope="col">Done on time</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr className="an-group-row">
              <th scope="colgroup" colSpan={cols.length + 2}>
                {g.group}
              </th>
            </tr>
            {g.rows.map((r) => {
              const onTime = cell(r.key, 'onTime')?.value ?? null;
              const due = cell(r.key, 'total')?.value ?? null;
              const width = isExact(onTime) && isExact(due) && due > 0 ? (onTime / due) * 100 : 0;
              return (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {cols.map((col) => {
                    const c = cell(r.key, col.key);
                    const href = hrefOf(card, c, ctx);
                    return (
                      <td key={col.key} className="num" data-label={col.label}>
                        {href ? <Link to={href}>{formatCount(c?.value)}</Link> : formatCount(c?.value ?? null)}
                      </td>
                    );
                  })}
                  <td data-label="Done on time" className="an-meter-cell">
                    <span className="meter-track meter-inline" role="img" aria-label={`${r.label}, done on time: ${shareText(onTime, due)}`}>
                      {width > 0 && <span className="meter-fill" style={{ width: `${width}%` }} />}
                    </span>
                    <span className="meter-text">{shareText(onTime, due)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function VisitRecordBody({ card, ctx }) {
  const groups = [];
  for (const s of card.shares) {
    const group = cellOf(card, s.num)?.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.group === group) last.shares.push(s);
    else groups.push({ group, shares: [s] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.group} className="an-meter-group">
          {g.group && <h3 className="an-subhead">{g.group}</h3>}
          {g.shares.map((s) => (
            <Meter key={s.key} label={s.label} num={valueOf(card, s.num)} den={valueOf(card, s.den)} href={hrefOf(card, cellOf(card, s.num), ctx)} />
          ))}
        </div>
      ))}
    </>
  );
}

function BabiesBody({ card, ctx }) {
  const linked = cellOf(card, 'linked');
  const noMother = cellOf(card, 'noMother');
  return (
    <>
      <StatTiles
        className="an-kpis-inline"
        tiles={[{ key: 'total', label: card.total.label, value: card.total.value, sub: card.total.sub ?? undefined, href: hrefOf(card, card.total, ctx) ?? undefined }]}
      />
      <Trend card={card} ctx={ctx} title="Babies registered per month of birth" />
      {sharesOf(card, ctx)}
      <ul className="an-facts">
        {linked && <FactLine label={linked.label} value={linked.value} />}
        {noMother && <FactLine label={noMother.label} value={noMother.value} href={hrefOf(card, noMother, ctx)} />}
      </ul>
    </>
  );
}

function SexAtBirthBody({ card, ctx }) {
  const ratio = card.extras?.ratio;
  const tiles = card.cells.map((c) => ({ key: c.key, label: c.label, value: c.value }));
  let ratioWords = '—';
  if (isExact(ratio?.value)) ratioWords = formatNumber(ratio.value);
  else if (!ratio && ctx.audience === 'admin') ratioWords = 'Not shown';
  tiles.push({
    key: 'ratio',
    label: 'For information',
    icon: Info,
    text: ratioWords,
    textValue: !isExact(ratio?.value),
    sub: isExact(ratio?.value) ? 'girls per 1,000 boys' : 'Girls per 1,000 boys: needs exact counts of girls and boys, and at least one boy.',
  });
  return (
    <>
      <StatTiles className="an-kpis-inline an-kpis-five" tiles={tiles} />
      <p className="sr-only">{ratioText(ratio?.value)}</p>
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

function BirthWeightBody({ card, ctx }) {
  const median = card.extras?.median;
  const bars = card.cells.filter((c) => !c.den && c.key !== 'low');
  return (
    <>
      {sharesOf(card, ctx)}
      <Bars card={card} ctx={ctx} cells={bars} scale={card.total?.value} />
      <ul className="an-facts">
        <FactLine label={card.total.label} value={card.total.value} href={hrefOf(card, card.total, ctx)} />
        {median && isExact(median.value) && (
          <li className="an-fact">
            <span className="an-fact-label">Median birth weight</span>
            <strong className="an-fact-value">{`${formatNumber(median.value)} g`}</strong>
            <span className="an-fact-sub">{`from ${formatNumber(median.n)} ${median.n === 1 ? 'baby' : 'babies'} weighed${ctx.audience === 'platform' ? ', to the nearest 50 g' : ''}`}</span>
          </li>
        )}
      </ul>
    </>
  );
}

function GestationBody({ card, ctx }) {
  const bars = card.cells.filter((c) => !c.den && !['preterm', 'scan'].includes(c.key));
  return (
    <>
      {sharesOf(card, ctx)}
      <Bars card={card} ctx={ctx} cells={bars} scale={card.total?.value} />
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

// ---------- Deliveries tab ----------

function DeliveriesBody({ card, ctx }) {
  return (
    <>
      {sharesOf(card, ctx)}
      <Bars card={card} ctx={ctx} cells={plain(card)} scale={card.total?.value} caption="Deliveries by mode of delivery" />
      <TotalLine card={card} ctx={ctx} />
      <Trend card={card} ctx={ctx} title="Deliveries per period" />
    </>
  );
}

function BirthsBody({ card, ctx }) {
  const still = card.cells.filter((c) => c.group === 'still');
  return (
    <>
      {sharesOf(card, ctx)}
      <Bars card={card} ctx={ctx} cells={plain(card)} scale={card.total?.value} />
      {still.length > 0 && (
        <>
          <h3 className="an-subhead">Of the stillbirths</h3>
          <Bars card={card} ctx={ctx} cells={still} scale={valueOf(card, 'still')} caption="Stillbirths: fresh or macerated" />
        </>
      )}
      <TotalLine card={card} ctx={ctx} />
    </>
  );
}

/** Stillbirths, newborn deaths and maternal deaths: one line each, the parts of a line indented under it. */
function DeathsBody({ card, ctx }) {
  const line = (c, indent = false) => <FactLine key={c.key} label={c.label} value={c.value} href={hrefOf(card, c, ctx)} sub={c.sub} indent={indent} />;
  const lines = (key, group = null) => {
    const head = cellOf(card, key);
    const parts = group ? card.cells.filter((c) => c.group === group) : [];
    return head ? [line(head), ...parts.map((c) => line(c, true))] : [];
  };
  const ageUnknown = cellOf(card, 'ageUnknown');
  return (
    <>
      <ul className="an-facts">{lines('still')}</ul>
      <h3 className="an-subhead">Babies</h3>
      <ul className="an-facts">
        {lines('newborn', 'newborn')}
        {ageUnknown && line(ageUnknown)}
      </ul>
      <h3 className="an-subhead">Mothers</h3>
      <ul className="an-facts">{lines('maternal', 'maternal')}</ul>
    </>
  );
}

const BODIES = {
  A1: RegistrationsBody,
  A4: VisitsBody,
  V1: TableBody,
  DQ: RecordsToTidyBody,
  A3: WeeksBody,
  D9: PastDueBody,
  C2: ReasonsBody,
  C9: ReasonsBody,
  C4: ProfileBody,
  D1: ConditionsBody,
  D3: BpBody,
  E1: CarePlansBody,
  E4: DoneByDueBody,
  B4: VisitRecordBody,
  G1: BabiesBody,
  G2: SexAtBirthBody,
  G3: BirthWeightBody,
  G6: GestationBody,
  H1: DeliveriesBody,
  H3: BirthsBody,
  H7: DeathsBody,
};

// ---------- The super admin's numbers per hospital ----------

function ByHospital({ card, hospitals }) {
  const rows = [...(card.total ? [card.total] : []), ...card.cells].filter((c) => Array.isArray(c.values));
  const extra = [];
  if (Array.isArray(card.extras?.ratio?.values)) extra.push({ key: 'ratio', label: 'Girls per 1,000 boys', values: card.extras.ratio.values, fmt: (v) => (isExact(v) ? formatNumber(v) : '—') });
  if (Array.isArray(card.extras?.median?.values)) extra.push({ key: 'median', label: 'Median birth weight', values: card.extras.median.values, fmt: (v) => (isExact(v) ? `${formatNumber(v)} g` : '—') });
  if (!rows.length || !hospitals?.length) return null;
  return (
    <details className="an-by-hospital">
      <summary>By hospital</summary>
      <div className="an-table-wrap">
        <table className="dt an-table">
          <caption className="sr-only">{`${card.title}, by hospital`}</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              {hospitals.map((h) => (
                <th key={h.id} scope="col" className="num">
                  {h.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                {c.values.map((v, i) => (
                  <td key={hospitals[i]?.id ?? i} className="num" data-label={hospitals[i]?.name}>
                    {perHospitalText(v, i, card.tooFew)}
                  </td>
                ))}
              </tr>
            ))}
            {extra.map((x) => (
              <tr key={x.key}>
                <th scope="row">{x.label}</th>
                {x.values.map((v, i) => (
                  <td key={hospitals[i]?.id ?? i} className="num" data-label={hospitals[i]?.name}>
                    {perHospitalText(v, i, card.tooFew, x.fmt)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------- The card ----------

/** wide: full width at two columns (worked out per row by the page); without it, WIDE_CARDS decides. */
export function AnalyticsCard({ card, ctx, wide }) {
  const Body = BODIES[card.id] ?? BarsWithTotal;
  const empty = isEmptyCard(card);
  const notes = cardNotes(card);
  const windowPill =
    card.window === 'now' ? (
      <StatusPill tone="neutral" icon={Clock}>
        {card.subtitle ?? 'As of today'}
      </StatusPill>
    ) : card.window === 'period' ? (
      <StatusPill tone="neutral" icon={CalendarRange}>
        {card.subtitle}
      </StatusPill>
    ) : null;
  const titleId = `an-card-${card.id}`;
  const isWide = wide ?? WIDE_CARDS.has(card.id);
  return (
    <section className={`panel an-card ${isWide ? 'an-wide' : ''}`.trim()} aria-labelledby={titleId}>
      <header className="an-card-head">
        <h2 id={titleId}>{card.title}</h2>
        <div className="an-card-pills">
          {windowPill}
          {card.wholeHospital && ctx.audience !== 'platform' && (
            <StatusPill tone="neutral" icon={Building2}>
              Whole hospital
            </StatusPill>
          )}
        </div>
      </header>
      <div className="an-card-body">
        {card.allMasked ? (
          <p className="panel-empty an-empty">{ALL_MASKED_TEXT}</p>
        ) : isLeftOutCard(card) ? (
          <p className="panel-empty an-empty">{TOO_FEW_TEXT}</p>
        ) : empty ? (
          <p className="panel-empty an-empty">{card.emptyText}</p>
        ) : (
          <Body card={card} ctx={ctx} />
        )}
      </div>
      {notes.length > 0 && (
        <footer className="an-card-notes">
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </footer>
      )}
      {ctx.audience === 'platform' && ctx.hospitals?.length > 1 && <ByHospital card={card} hospitals={ctx.hospitals} />}
    </section>
  );
}

