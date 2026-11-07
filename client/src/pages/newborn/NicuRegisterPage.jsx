import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Baby, CircleCheck, Download, Hospital, Thermometer, TriangleAlert } from 'lucide-react';
import { apiFile } from '../../api.js';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { isReportMonth, monthWords, thisMonth } from '../analytics/analyticsFormat.js';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { useNewbornTabs } from './newbornFormat.js';
import { NICU_REASONS } from './newbornCareRules.js';

// The NICU admission and outcome register of a month (NEO-L-05, Build 13): every admission in register order – the
// number per unit and year, given once and never changed (one entered in error keeps its number, so there are no
// gaps) – with the register's columns, the month's totals and survival to discharge by weight (n/N), and the CSV
// export for NNF / NABH. Doctors, RMOs and nurses.

const yesNo = (v) => v || '–';
export function NicuRegisterPage() {
  const tabs = useNewbornTabs();
  const [params, setParams] = useSearchParams();
  const month = isReportMonth(params.get('month')) ? params.get('month') : thisMonth();
  const unit = params.get('unit') || '';
  const { data, error, loading } = useFetch('/newborn-care/register', { month, unit: unit || undefined });
  const [exportError, setExportError] = useState(null);
  const ready = data?.month === month && (data?.unit ?? '') === unit;
  const t = ready ? data.totals : null;
  const rules = data?.rules;
  const set = (changes) => setParams({ month, ...(unit ? { unit } : {}), ...changes }, { replace: true });
  const gaps = ready ? data.gaps.filter((g) => g.missing.length) : [];
  const save = async () => {
    try {
      const { blob, name } = await apiFile('/newborn-care/register.csv', { query: { month, unit: unit || undefined } });
      downloadFile(blob, name);
    } catch (err) {
      setExportError(err);
    }
  };
  const reason = (r) => rules?.f03?.reasons?.[r.reasonPrimary] ?? r.reasons.map((k) => NICU_REASONS[k] ?? k).join(', ');
  return (
    <>
      <PageHeader tabs={tabs} title="NICU register (NEO-L-05)" documentTitle="NICU register" subtitle="Every admission of the month in register order, with how it ended." />
      <div className="pf-content stack">
        <Alert type="error">{error ?? exportError?.message}</Alert>
        <div className="row reg-toolbar">
          <Field label="Month" id="nr-month">
            <input id="nr-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && set({ month: e.target.value })} />
          </Field>
          <Field label="Unit" id="nr-unit">
            <select id="nr-unit" value={unit} onChange={(e) => setParams({ month, ...(e.target.value ? { unit: e.target.value } : {}) }, { replace: true })}>
              <option value="">All units</option>
              {(data?.units ?? []).map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="btn btn-secondary" onClick={save} disabled={!ready}>
            <Download aria-hidden="true" /> Export CSV
          </button>
        </div>
        {ready &&
          (gaps.length ? (
            <Alert type="error" icon={TriangleAlert}>
              {`Numbers missing from the register: ${gaps.map((g) => `${g.unit.toUpperCase()} ${g.year}: ${g.missing.join(', ')}`).join('; ')}. Tell the hospital admin.`}
            </Alert>
          ) : (
            data.gaps.length > 0 && (
              <p className="hint">
                <CircleCheck aria-hidden="true" /> {`No gaps: every number of the year up to ${data.gaps.map((g) => `${g.unit.toUpperCase()}-${g.year}-${String(g.last).padStart(4, '0')}`).join(', ')} is in the register.`}
              </p>
            )
          ))}
        <div className="kpi-grid">
          <KpiCard icon={Hospital} label="Admissions" value={t ? formatNumber(t.admissions) : '–'} sub={t ? `${t.inborn} inborn · ${t.outborn} outborn` : monthWords(month)} />
          <KpiCard icon={Baby} label="Still admitted" value={t ? formatNumber(t.stillAdmitted) : '–'} sub={t && rules ? Object.entries(t.outcomes).filter(([, n]) => n).map(([k, n]) => `${rules.outcomes[k] ?? k}: ${n}`).join(' · ') : undefined} />
          <KpiCard icon={Thermometer} tone={t?.cold ? 'watch' : 'neutral'} label="Temperature 36.5–37.5 °C" value={t ? `${t.tempInRange} of ${t.admissions}` : '–'} sub={t ? `${t.cold} under 36.5 °C` : undefined} />
          <KpiCard icon={Baby} label="Survival under 1500 g" value={t ? `${t.survivalUnder1500.n}/${t.survivalUnder1500.N}` : '–'} sub={t ? data.weightBands.map((b) => `${b.label}: ${t.survivalByWeight[b.key].n}/${t.survivalByWeight[b.key].N}`).join(' · ') : 'Discharged home of those whose stay ended'} textValue />
        </div>
        <section className="card nbf-register">
          <SimpleTable
            loading={loading && !data}
            rows={ready ? data.rows : []}
            emptyText={`No admissions in ${monthWords(month)}.`}
            columns={[
              { key: 'serial', header: 'Serial', render: (r) => <span className="ca-nowrap">{r.register.serial}</span> },
              {
                key: 'baby',
                header: 'Baby',
                main: true,
                wide: true,
                render: (r) => (
                  <span className="nbf-baby">
                    <Link to={`/patients/${r.baby.id}/newborn-care`}>{r.baby.fullName}</Link>
                    <span className="hint">{`${r.register.babyUhid}${r.register.motherUhid ? ` · mother ${r.register.motherUhid}` : ''}`}</span>
                  </span>
                ),
              },
              {
                key: 'admitted',
                header: 'Admitted',
                render: (r) => (
                  <span className="nbf-baby">
                    <span className="ca-nowrap">{formatDateTime(r.admittedAt)}</span>
                    <span className="hint">{`${r.unitName} · ${r.register.inbornOutborn}`}</span>
                  </span>
                ),
              },
              { key: 'ga', header: 'GA, weight', render: (r) => `${r.register.ga || '–'} · ${r.register.weightG ?? '–'} g` },
              { key: 'why', header: 'Main reason', render: reason },
              { key: 'support', header: 'Ventilated, surfactant, TPN', render: (r) => `${yesNo(r.register.ventilated)} · ${yesNo(r.register.surfactant)} · ${yesNo(r.register.tpn)}` },
              { key: 'morb', header: 'Morbidities', render: (r) => (r.register.morbidities ? r.register.morbidities.split(';').map((k) => rules?.f03?.morbidities?.[k] ?? k).join(', ') : '–') },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (r) =>
                  r.cancelled ? (
                    `Entered in error: ${r.cancelled.reason}`
                  ) : (
                    <StatusPill tone={r.outcome ? (r.outcome.result === 'died' ? 'inactive' : 'stable') : 'due'}>
                      {r.outcome ? `${rules?.outcomes?.[r.outcome.result] ?? r.outcome.result} · ${r.register.losDays} days${r.register.weightAtDischarge ? ` · ${r.register.weightAtDischarge} g` : ''}${r.register.mmRef ? ` · ${r.register.mmRef}` : ''}` : 'Admitted now'}
                    </StatusPill>
                  ),
              },
            ]}
          />
        </section>
        <p className="muted small">The register follows NEO-L-05 v1.0; the numbers are given once and never changed.</p>
      </div>
    </>
  );
}
