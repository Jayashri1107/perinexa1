import { Baby, CircleHelp, Scissors, Timer } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { isReportMonth, monthWords, thisMonth } from '../analytics/analyticsFormat.js';
import { ROBSON_GROUPS } from '../inpatient/robson.js';
import { useQualityTabs } from './qualityFormat.js';

// Clinical audit → Deliveries (Clinical Requirements Group A, items 1 and 2): the month's Robson ten-group table and
// its caesareans with category and decision-to-delivery interval (server/src/routes/clinicalAudit.js). Doctors and
// RMOs see each caesarean; the quality lead and the hospital admin see the numbers only. DRAFT rules.

const pct = (v) => (v == null ? '–' : `${v}%`);
/** 40 → "40 min"; 1970 → "32 h 50 min". */
export const minutesWords = (m) => (m < 120 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const CATEGORY_WORDS = { 1: 'Category 1', 2: 'Category 2', 3: 'Category 3', 4: 'Category 4' };

function RobsonTable({ data }) {
  const rows = [...data.rows, { group: null, ...data.unclassified }].filter((r) => r.group || r.women);
  return (
    <div className="an-table-wrap">
      <table className="ca-table">
        <thead>
          <tr>
            <th scope="col">Robson group</th>
            <th scope="col" className="num">Women</th>
            <th scope="col" className="num">Caesareans</th>
            <th scope="col" className="num">Share of all women</th>
            <th scope="col" className="num">Caesarean rate in the group</th>
            <th scope="col" className="num">Adds to the overall rate</th>
            <th scope="col" className="num">Share of all caesareans</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.group ?? 'none'} className={r.women ? undefined : 'ca-empty'}>
              <th scope="row">
                <span className="ca-group">{r.group ?? '–'}</span>
                <span className="ca-group-words">{r.group ? ROBSON_GROUPS[r.group] : 'Not classified (details missing, or confirmed before the Robson details were asked for)'}</span>
              </th>
              <td data-label="Women" className="num">{formatNumber(r.women)}</td>
              <td data-label="Caesareans" className="num">{formatNumber(r.caesareans)}</td>
              <td data-label="Share of all women" className="num">{r.group ? pct(r.groupSize) : '–'}</td>
              <td data-label="Caesarean rate in the group" className="num">{r.group ? pct(r.caesareanRate) : '–'}</td>
              <td data-label="Adds to the overall rate" className="num">{r.group ? pct(r.absoluteContribution) : '–'}</td>
              <td data-label="Share of all caesareans" className="num">{r.group ? pct(r.relativeContribution) : '–'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All women</th>
            <td data-label="Women" className="num">{formatNumber(data.women)}</td>
            <td data-label="Caesareans" className="num">{formatNumber(data.caesareans)}</td>
            <td data-label="Share of all women" className="num">100%</td>
            <td data-label="Caesarean rate in the group" className="num">{pct(data.caesareanRate)}</td>
            <td data-label="Adds to the overall rate" className="num">{pct(data.caesareanRate)}</td>
            <td data-label="Share of all caesareans" className="num">{data.caesareans ? '100%' : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CaesareanList({ list }) {
  return (
    <div className="an-table-wrap">
      <table className="ca-table">
        <thead>
          <tr>
            <th scope="col">Delivered</th>
            <th scope="col">Patient</th>
            <th scope="col">Category</th>
            <th scope="col">Decision</th>
            <th scope="col">Robson</th>
            <th scope="col">Decision to delivery</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.documentId}>
              <td data-label="Delivered">{formatDateTime(r.deliveredAt)}</td>
              <td data-label="Patient">
                <Link to={`/patients/${r.patientId}/stays/${r.admissionId}/docs/${r.documentId}`}>{r.fullName}</Link>
                <span className="ca-group-words">{r.mrn}</span>
              </td>
              <td data-label="Category">{r.category ? CATEGORY_WORDS[r.category] : 'Not recorded'}</td>
              <td data-label="Decision">{r.decisionAt ? formatDateTime(r.decisionAt) : '–'}</td>
              <td data-label="Robson">{r.robsonGroup ?? '–'}</td>
              <td data-label="Decision to delivery">
                {r.minutes == null ? (
                  'Not recorded'
                ) : (
                  <StatusPill tone={r.red ? 'high' : r.overTarget ? 'watch' : r.overTarget === false ? 'stable' : 'neutral'}>
                    {`${minutesWords(r.minutes)}${r.red ? ' – over 30' : r.overTarget ? ' – over target' : r.overTarget === false ? ' – within target' : ''}`}
                  </StatusPill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClinicalAuditPage() {
  const qualityTabs = useQualityTabs();
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const robson = useFetch('/clinical-audit/robson', { month });
  const cs = useFetch('/clinical-audit/caesareans', { month });
  const r = robson.data?.month === month ? robson.data : null;
  const c = cs.data?.month === month ? cs.data : null;
  const cat1 = c?.byCategory.find((x) => x.category === '1');
  const noCategory = c?.byCategory.find((x) => x.category === null);

  return (
    <>
      <PageHeader
        title="Clinical audit"
        documentTitle="Clinical audit"
        subtitle="Deliveries confirmed by a doctor: the Robson ten-group table and the caesarean decision-to-delivery times."
        tabs={qualityTabs}
      />
      <div className="pf-content stack">
        <Alert type="error">{robson.error ?? cs.error}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="ca-month">
            <input id="ca-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setParams({ month: e.target.value }, { replace: true })} />
          </Field>
        </div>
        {month === thisMonth() && <p className="hint">This month is not over yet: the numbers grow until its last day.</p>}

        <div className="kpi-grid">
          <KpiCard icon={Baby} label="Women delivered" value={r ? formatNumber(r.women) : '–'} sub={monthWords(month)} />
          <KpiCard icon={Scissors} label="Caesareans" value={r ? formatNumber(r.caesareans) : '–'} sub={r?.women ? `${pct(r.caesareanRate)} of deliveries` : 'No deliveries yet'} />
          <KpiCard
            icon={Timer}
            tone={cat1?.overTarget ? 'high' : 'neutral'}
            label="Category 1 over 30 minutes"
            value={c ? formatNumber(cat1?.overTarget ?? 0) : '–'}
            sub={c ? `of ${formatNumber(cat1?.count ?? 0)} category 1 caesareans` : undefined}
          />
          <KpiCard
            icon={CircleHelp}
            tone={r?.unclassified.women || noCategory?.count ? 'watch' : 'neutral'}
            label="Details missing"
            value={r ? formatNumber(r.unclassified.women + (noCategory?.count ?? 0)) : '–'}
            sub="No Robson group, or a caesarean without its category"
          />
        </div>

        <section className="card" aria-labelledby="ca-robson">
          <h2 id="ca-robson">Robson ten-group table</h2>
          {robson.loading && !r && <p className="muted">Loading…</p>}
          {r && !r.women && <p className="muted">{`No delivery note was confirmed in ${monthWords(month)}. A delivery note is counted here once a doctor confirms it.`}</p>}
          {r?.women > 0 && <RobsonTable data={r} />}
          {r && <p className="hint">{`DRAFT until the Lead Obstetrician confirms it. Source: ${r.source}.`}</p>}
        </section>

        <section className="card" aria-labelledby="ca-cs">
          <h2 id="ca-cs">Caesareans – decision to delivery</h2>
          {c && (
            <div className="ca-cats">
              {c.byCategory
                .filter((x) => x.category || x.count)
                .map((x) => (
                  <div key={String(x.category)} className="ca-cat">
                    <span className="ca-cat-label">{x.category ? CATEGORY_WORDS[x.category] : 'Category not recorded'}</span>
                    <span className="ca-cat-value">{formatNumber(x.count)}</span>
                    {c.targets[x.category] ? (
                      <span className="ca-group-words">{x.overTarget ? `${formatNumber(x.overTarget)} over ${c.targets[x.category]} minutes` : `target ${c.targets[x.category]} minutes`}</span>
                    ) : (
                      <span className="ca-group-words">no time target</span>
                    )}
                  </div>
                ))}
            </div>
          )}
          {c?.list && (c.list.length ? <CaesareanList list={c.list} /> : <p className="muted">{`No caesarean was confirmed in ${monthWords(month)}.`}</p>)}
          {c && !c.list && <p className="hint">Each caesarean is listed for doctors and RMOs only; you see the numbers.</p>}
          {c && <p className="hint">{`Category 1 over 30 minutes is shown in red and reported as an incident. DRAFT. Source: ${c.source}.`}</p>}
        </section>
      </div>
    </>
  );
}
