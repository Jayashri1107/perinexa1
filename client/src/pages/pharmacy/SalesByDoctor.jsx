import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterSelect } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { analyticsTabs } from '../analytics/analyticsFormat.js';
import { money } from './pharmacyUi.jsx';
import { DateText } from '../../components/DateText.jsx';

// PH24 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 5): pharmacy sales by prescribing doctor – the pharmacist only
// (Reports → Sales by doctor) and the super admin (numbers only, per hospital, with a minimum number of invoices per
// line). Never the hospital admin or the doctors. Outside doctors appear by the name typed at the counter.

export function SalesByDoctorReport({ from, to }) {
  const res = useFetch('/pharmacy/reports/by-doctor', { from, to });
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <section className="card bill-section" aria-labelledby="rep-bydoc">
      <h2 id="rep-bydoc">Sales by doctor</h2>
      <p className="hint">
        Invoices from each doctor’s prescriptions, net of returns. For the pharmacist only. A doctor of this hospital is counted from the prescription; an outside doctor by the name typed (spellings grouped by registration number, or by
        the name without “Dr”, dots and spaces).{d.withoutDoctor ? ` ${d.withoutDoctor} invoice${d.withoutDoctor === 1 ? '' : 's'} had no doctor.` : ''}
      </p>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Doctor</th>
            <th scope="col" className="num">Invoices</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {d.doctors.map((x, i) => (
            <tr key={`${x.name}-${i}`}>
              <td>
                {x.name}
                {x.reg ? <span className="muted"> · Reg. {x.reg}</span> : ''}
                {!x.inHospital && <span className="muted"> (outside)</span>}
                {x.otherSpellings?.length > 0 && <span className="ph-line-note">Also written: {x.otherSpellings.join(', ')}</span>}
              </td>
              <td className="num">{x.invoices}</td>
              <td className="num">{money(x.amountPaise)}</td>
            </tr>
          ))}
          {!d.doctors.length && (
            <tr>
              <td colSpan={3} className="muted">
                No sales with a doctor in this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** The super admin's page: per hospital, per doctor – counts and amounts only. */
export function PlatformPharmacyDoctorsPage() {
  const [params, setParams] = useSearchParams();
  const hospital = params.get('hospital') ?? 'all';
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const hospitals = useFetch('/platform/analytics/hospitals');
  const res = useFetch('/platform/analytics/pharmacy-by-doctor', { hospital, from, to });
  const d = res.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: '/platform/analytics' }, { label: 'Pharmacy by doctor' }]}
        title="Pharmacy sales by doctor"
        documentTitle="Analytics – pharmacy by doctor"
        help="Per hospital and doctor: how many invoices and how much. Numbers only – no patient, invoice or medicine."
        tabs={analyticsTabs('/platform/analytics', '', { waiting: true, pharmacyDoctors: true })}
      />
      <div className="pf-content an-page">
        <div className="an-filters">
          <div className="an-filter">
            <FilterSelect
              label="Hospital"
              value={hospital}
              onChange={(v) => setParams({ hospital: v }, { replace: true })}
              options={[{ value: 'all', label: 'All hospitals' }, ...(hospitals.data?.hospitals ?? []).map((h) => ({ value: h.id, label: h.name }))]}
              allLabel={null}
            />
          </div>
          <Field label="From" id="pbd-from">
            <DateText id="pbd-from" value={from} onChange={(v) => setFrom(v)} />
          </Field>
          <Field label="To" id="pbd-to">
            <DateText id="pbd-to" value={to} onChange={(v) => setTo(v)} />
          </Field>
        </div>
        <Alert type="error">{res.error}</Alert>
        {d && (
          <>
            <p className="hint">A doctor is shown from {d.minInvoices} invoices; the rest are added up as “Other doctors”.</p>
            {!d.hospitals.length && <p className="muted">No pharmacy sales with a doctor in this period.</p>}
            {d.hospitals.map((h) => (
              <section key={h.id} className="panel an-card an-wide">
                <header className="an-card-head">
                  <h2>{h.name}</h2>
                </header>
                <div className="an-card-body an-table-wrap">
                  <table className="dt an-table">
                    <thead>
                      <tr>
                        <th scope="col">Doctor</th>
                        <th scope="col" className="num">Invoices</th>
                        <th scope="col" className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.doctors.map((x, i) => (
                        <tr key={`${x.name}-${i}`}>
                          <td>
                            {x.name}
                            {x.others ? ` (${x.others})` : x.inHospital === false ? ' (outside)' : ''}
                          </td>
                          <td className="num tabular">{x.invoices}</td>
                          <td className="num tabular">{money(x.amountPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}
