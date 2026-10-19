import { useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, FileSignature, Inbox, Printer, TriangleAlert, Undo2 } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, KpiCard, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { PromisePill } from './ReferralsDeskPage.jsx';
import { formatLocalDay, localIso, promiseLabel, promiseLook, quarterOf, quarterWords, shiftQuarter } from './referralFormat.js';

// One referring doctor's quarterly summary (docs/REFERRALS_PLAN.md), printable on one page for the partner
// programme: how many patients the doctor sent, how many were seen, the notes sent, what returned to the doctor and
// any missed promise. The counts cover every referral; each row shows only what the server sends (it leaves the rest
// out, so nothing here depends on the screen hiding it):
//  - with her Yes: her name and age, the reasons, the outcome, what returns to the doctor and every promise;
//  - without it: the number, the day, the reasons and the reply and first-visit promises only – never her answer
//    (the print says "Details not shared" without the reason), the note or the discharge summary (they would show a
//    stay she did not agree to share);
//  - a referral this person may not open (hidden): its number and day only.
// Opening it is in the audit log.

const COUNTS = [
  { key: 'received', label: 'Referred', icon: Inbox, sub: 'Patients the doctor sent' },
  { key: 'seen', label: 'Seen', icon: CalendarCheck, sub: 'Seen at the hospital' },
  { key: 'notesSent', label: 'Notes sent', icon: FileSignature, sub: 'Consultant notes sent to the doctor' },
  { key: 'returned', label: 'Returned to you', icon: Undo2, sub: 'Sent back to the doctor for follow-up' },
  { key: 'missed', label: 'Promises missed', icon: TriangleAlert, sub: 'Each one reviewed within the week' },
];

/** "Reply: Done · Seen: Done late" – words only, so it reads the same on paper in black and white. */
const promisesWords = (promises = []) => promises.map((p) => `${promiseLabel(p)}: ${promiseLook(p).word}`).join(' · ');
const NOT_SHARED = 'Details not shared';
/**
 * The patient column. On paper (the referring doctor reads it) a referral this person may not open reads like any
 * other without her Yes – "Details not shared", never why; on screen it says so.
 */
const patientWords = (x, { print = false } = {}) => {
  if (x.patient) return `${x.patient.fullName}${x.patient.ageYears != null ? `, ${x.patient.ageYears} yrs` : ''}`;
  if (x.hidden && !print) return 'Not shown – you may not open this referral';
  return NOT_SHARED;
};

function SummaryPrint({ data, onClose }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const d = data.doctor;
  const footer = (
    <>
      <span>
        Referral summary · {d.name} · {quarterWords(data.quarter.key)}
      </span>
      <span>
        Printed {formatDateTime(new Date())} by {user.name}
      </span>
    </>
  );
  return (
    <PrintPreview title="Quarterly referral summary" hint="Check the page, then print it on A4 paper or save it as a PDF." onClose={onClose} fit docKey={`${d.id}-${data.quarter.key}`}>
      <PrintDocument footer={footer}>
        <Letterhead letterhead={letterhead} />
        <h1 className="pdoc-title">Referral summary – {quarterWords(data.quarter.key)}</h1>
        <PrintFacts
          items={[
            ['To', [d.name, d.qualification].filter(Boolean).join(', ')],
            ['Clinic', [d.clinic, d.area].filter(Boolean).join(', ')],
            ['Period', quarterWords(data.quarter.key)],
          ]}
        />
        <table className="ptable pdoc-table">
          <thead>
            <tr>
              {COUNTS.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {COUNTS.map((c) => (
                <td key={c.key} className="pdoc-tabular">
                  {formatNumber(data.counts?.[c.key])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {data.referrals.length > 0 && (
          <table className="ptable pdoc-table">
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Patient</th>
                <th scope="col">Reason</th>
                <th scope="col">Outcome</th>
                <th scope="col">Returns to you for</th>
                <th scope="col">Our promises</th>
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((x) => (
                <tr key={x.number}>
                  <td className="pdoc-tabular pdoc-nowrap">
                    {x.number}
                    <span className="pdoc-sub">{formatLocalDay(x.receivedAt)}</span>
                  </td>
                  <td>{patientWords(x, { print: true })}</td>
                  <td>{(x.reasonLabels ?? []).join(', ') || '—'}</td>
                  <td>{x.outcome || '—'}</td>
                  <td>{x.returnsToYouFor || '—'}</td>
                  <td className="pdoc-note">{promisesWords(x.promises) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pdoc-note">Names, outcomes, the consultant note and the discharge summary are given only for patients who agreed to share them with you. Every missed promise is reviewed within the week.</p>
        <LetterheadFooter letterhead={letterhead} />
      </PrintDocument>
    </PrintPreview>
  );
}

export function ReferringDoctorSummaryPage() {
  const { doctorId } = useParams();
  const [params, setParams] = useSearchParams();
  const thisQuarter = quarterOf(localIso());
  const asked = params.get('quarter');
  const quarter = /^\d{4}-Q[1-4]$/.test(asked ?? '') ? asked : thisQuarter;
  const { data, error, loading } = useFetch(`/referring-doctors/${doctorId}/summary`, { quarter });
  const [printing, setPrinting] = useState(false);
  const go = (key) => setParams(key === thisQuarter ? {} : { quarter: key }, { replace: true });
  const name = data?.doctor?.name ?? 'Referring doctor';
  const columns = [
    {
      key: 'number',
      header: 'Referral',
      render: (x) => (
        <span className="name-cell-text">
          <strong className="tabular">{x.number}</strong>
          <span className="muted tabular">{formatLocalDay(x.receivedAt)}</span>
        </span>
      ),
    },
    { key: 'patient', header: 'Patient', className: 'wrap', render: (x) => (x.patient ? patientWords(x) : <span className="muted">{patientWords(x)}</span>) },
    { key: 'reason', header: 'Reason', className: 'wrap', render: (x) => (x.reasonLabels ?? []).join(', ') || '—' },
    { key: 'outcome', header: 'Outcome', className: 'wrap', render: (x) => x.outcome || <span className="muted">—</span> },
    { key: 'returns', header: 'Returns to the doctor for', className: 'wrap', render: (x) => x.returnsToYouFor || <span className="muted">—</span> },
    {
      key: 'promises',
      header: 'Promises',
      className: 'wrap',
      // (only the promises the server sends: none for a referral this person may not open)
      render: (x) =>
        x.promises?.length ? (
          <span className="wl-counts">
            {x.promises.map((p) => (
              <PromisePill key={p.key} promise={p} withLabel />
            ))}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Referrals', to: '/referrals' },
          { label: 'Referring doctors', to: '/referrals/doctors' },
          { label: name },
        ]}
        title={`${name} – quarterly summary`}
        documentTitle="Referral summary"
        tabs={moduleByKey('referrals')?.tabs}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)} disabled={!data}>
            <Printer aria-hidden="true" /> Print the summary
          </button>
        }
      />
      <div className="pf-content appt-page">
        <div className="card appt-toolbar">
          <div className="appt-daynav" role="group" aria-label="Quarter">
            <button type="button" className="icon-btn" onClick={() => go(shiftQuarter(quarter, -1))} aria-label="Quarter before">
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong className="tabular">{quarterWords(quarter)}</strong>
            <button type="button" className="icon-btn" onClick={() => go(shiftQuarter(quarter, 1))} aria-label="Quarter after" disabled={quarter >= thisQuarter}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(thisQuarter)} disabled={quarter === thisQuarter}>
            This quarter
          </button>
          {data?.doctor && (
            <span className="muted">
              {[data.doctor.qualification, data.doctor.clinic, data.doctor.area].filter(Boolean).join(' · ')} · <Link to={`/referrals?doctor=${data.doctor.id}&list=all`}>All referrals</Link>
            </span>
          )}
        </div>
        <Alert type="error">{error}</Alert>
        {data && (
          <div className="kpi-grid">
            {COUNTS.map((c) => (
              <KpiCard key={c.key} tone={c.key === 'missed' && data.counts?.missed ? 'watch' : 'neutral'} icon={c.icon} label={c.label} value={formatNumber(data.counts?.[c.key])} sub={c.sub} />
            ))}
          </div>
        )}
        <DataTable caption={`Referrals in ${quarterWords(quarter)}`} rowKey="number" columns={columns} rows={data?.referrals} loading={loading} emptyText="No referrals from this doctor in this quarter." />
        <p className="hint">A patient’s name, the outcome and the note and discharge promises are shown only when she agreed to share them with her doctor. A referral you may not open shows its number and day only; the counts include it.</p>
      </div>
      {printing && data && <SummaryPrint data={data} onClose={() => setPrinting(false)} />}
    </>
  );
}
