import { useEffect, useState } from 'react';
import { FileText, FlaskConical, Pill, Printer, Receipt } from 'lucide-react';
import { PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { rupees } from '../billing/billingFormat.js';
import { ageText, allergyPrintLine } from '../patients/patientFormat.js';
import { RxDocument, rxPage } from '../visits/RxDocument.jsx';
import { accountWords } from './portalAccountWords.js';
import { portal } from './portalApi.js';
import { portalError } from './portalWords.js';

// Her own records in the patient portal (docs/PATIENT_SIGNUP_PLAN.md): prescriptions, lab reports, visits and bills.
// The server sends only what may be shown (signed visits as printed, reviewed lab reports, open bills – never notes,
// risk or anything about HIV); this page only lays it out. A prescription opens as the same printed page the
// hospital gives her (her doctor's design), to print or save as a PDF on her phone.

export const RECORD_TABS = ['prescriptions', 'lab', 'visits', 'bills'];
const ICONS = { prescriptions: Pill, lab: FlaskConical, visits: FileText, bills: Receipt };
export const recordIcon = (tab) => ICONS[tab];

function useRecords(kind) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let current = true;
    portal(`/records/${kind}`)
      .then((data) => current && setState({ data, error: null }))
      .catch((error) => current && setState({ data: null, error }));
    return () => {
      current = false;
    };
  }, [kind]);
  return state;
}

/** Her prescription as printed by the hospital (her doctor's design), with Print and Save as PDF. */
function RxPrint({ visit, data, copy, lang, onClose }) {
  const w = accountWords(lang);
  const p = data.patient;
  const design = visit.design;
  return (
    <PrintPreview
      title={formatDate(visit.visitOn)}
      page={rxPage(design)}
      pdf={{ fileName: `prescription-${visit.visitOn.slice(0, 10)}.pdf`, title: formatDate(visit.visitOn) }}
      fit
      docKey={copy}
      onClose={onClose}
    >
      <RxDocument
        copy={copy}
        design={design}
        letterhead={data.letterhead}
        doctor={visit.doctor}
        patient={{ fullName: p.fullName, ageText: ageText(p), mrn: p.mrn, careType: p.careType, allergies: allergyPrintLine(p) }}
        visit={{ visitOn: visit.visitOn, ga: null, vitals: visit.vitals, details: visit.details, items: visit.items, notes: visit.notes }}
        printedAt={new Date()}
        printedByName={w.printedOnline}
      />
    </PrintPreview>
  );
}

function Lines({ rows }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="portal-dl">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function VisitList({ data, lang, prescriptions }) {
  const w = accountWords(lang);
  const [printing, setPrinting] = useState(null);
  if (!data.visits.length) return <p className="muted">{prescriptions ? w.noPrescriptions : w.noVisits}</p>;
  return (
    <ul className="portal-records">
      {data.visits.map((v) => (
        <li key={v.id} className="portal-record">
          <div className="plan-card-head">
            <h3>
              {formatDate(v.visitOn)}
              {v.doctor.name ? <span className="muted"> · {v.doctor.name}</span> : null}
            </h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrinting(v)}>
              <Printer aria-hidden="true" /> {w.viewPrint}
            </button>
          </div>
          {prescriptions ? (
            <>
              <p className="muted">{w.medicines(v.items.length)}</p>
              <ul className="portal-list">
                {v.items.map((it) => (
                  <li key={it.id}>
                    <strong>{it.drug}</strong>
                    {it.strength ? ` ${it.strength}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Lines
              rows={[
                [w.complaints, v.details.complaints],
                [w.diagnosis, v.details.diagnosis],
                [w.advice, v.details.advice],
                [w.testsAdvised, v.details.investigations],
                [w.nextVisit, v.details.nextVisitOn ? `${formatDate(v.details.nextVisitOn)}${v.details.nextVisitNote ? ` – ${v.details.nextVisitNote}` : ''}` : ''],
              ]}
            />
          )}
        </li>
      ))}
      {printing && <RxPrint visit={printing} data={data} copy={prescriptions ? 'prescription' : 'summary'} lang={lang} onClose={() => setPrinting(null)} />}
    </ul>
  );
}

const FLAG_TONES = { low: 'watch', high: 'watch', abnormal: 'high', normal: 'stable' };

function LabList({ data, lang }) {
  const w = accountWords(lang);
  if (!data.reports.length) return <p className="muted">{w.noLab}</p>;
  return (
    <ul className="portal-records">
      {data.reports.map((r) => (
        <li key={r.id} className="portal-record">
          <h3>{r.reportedAt ? w.reported(formatDateTime(r.reportedAt)) : ''}</h3>
          {r.tests.map((t) => (
            <div key={t.name} className="portal-lab-test">
              <h4>{t.name}</h4>
              {t.values.length > 0 && (
                <div className="table-wrap">
                  <table className="table portal-lab-table">
                    <thead>
                      <tr>
                        <th scope="col">{t.name}</th>
                        <th scope="col">{w.result}</th>
                        <th scope="col">{w.normalRange}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.values.map((v) => (
                        <tr key={v.name}>
                          <th scope="row">{v.name}</th>
                          <td className="tabular">
                            {v.value} {v.unit}{' '}
                            {v.flag && v.flag !== 'normal' && (
                              <StatusPill tone={FLAG_TONES[v.flag] ?? 'neutral'}>{w.flags[v.flag] ?? v.flag}</StatusPill>
                            )}
                          </td>
                          <td className="muted">{v.range}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {t.text && <p>{t.text}</p>}
            </div>
          ))}
          {r.labNote && <Lines rows={[[w.labRemark, r.labNote]]} />}
        </li>
      ))}
    </ul>
  );
}

const BILL_TONES = { paid: 'stable', no_charges: 'neutral', part_paid: 'watch', unpaid: 'watch', refund_due: 'due' };

function BillList({ data, lang }) {
  const w = accountWords(lang);
  if (!data.bills.length) return <p className="muted">{w.noBills}</p>;
  return (
    <ul className="portal-records">
      {data.bills.map((b) => (
        <li key={b.id} className="portal-record">
          <div className="plan-card-head">
            <h3>
              {w.bill(b.number)} <span className="muted">· {formatDate(b.date)}</span>
            </h3>
            <StatusPill tone={BILL_TONES[b.totals.status] ?? 'neutral'}>{w.billStatus[b.totals.status] ?? b.totals.status}</StatusPill>
          </div>
          <div className="table-wrap">
            <table className="table portal-bill-table">
              <tbody>
                {b.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.name}
                      {l.qty > 1 ? <span className="muted"> × {l.qty}</span> : null}
                    </td>
                    <td className="tabular num">{rupees(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {b.totals.discount > 0 && (
                  <tr>
                    <th scope="row">{w.discount}</th>
                    <td className="tabular num">− {rupees(b.totals.discount)}</td>
                  </tr>
                )}
                <tr>
                  <th scope="row">{w.total}</th>
                  <td className="tabular num">{rupees(b.totals.total)}</td>
                </tr>
                <tr>
                  <th scope="row">{w.paid}</th>
                  <td className="tabular num">{rupees(b.totals.paid)}</td>
                </tr>
                {b.totals.balance !== 0 && (
                  <tr>
                    <th scope="row">{b.totals.balance > 0 ? w.toPay : w.refundDue}</th>
                    <td className="tabular num">
                      <strong>{rupees(Math.abs(b.totals.balance))}</strong>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          {b.payments.length > 0 && (
            <>
              <h4>{w.receipts}</h4>
              <ul className="portal-list">
                {b.payments.map((p) => (
                  <li key={p.receipt}>
                    <span className="tabular">{p.receipt}</span> · {formatDate(p.at)} · {w.payKinds[p.kind] ?? p.kind} · {w.payModes[p.mode] ?? p.mode} · <span className="tabular">{rupees(p.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One tab of her records: loads it (each opening is in the hospital's audit log) and lays it out. */
export function RecordsTab({ tab, lang }) {
  const w = accountWords(lang);
  const { data, error } = useRecords(tab);
  const Icon = ICONS[tab];
  return (
    <section className="card portal-card" aria-labelledby="portal-records-title">
      <h2 id="portal-records-title">
        <Icon aria-hidden="true" /> {w.tabs[tab]}
      </h2>
      {tab !== 'bills' && <p className="hint">{w.recordsRule}</p>}
      <Alert type="error">{error ? portalError(error, lang) : null}</Alert>
      {!data && !error && <p className="muted" aria-busy="true">…</p>}
      {data && tab === 'prescriptions' && <VisitList data={data} lang={lang} prescriptions />}
      {data && tab === 'visits' && <VisitList data={data} lang={lang} prescriptions={false} />}
      {data && tab === 'lab' && <LabList data={data} lang={lang} />}
      {data && tab === 'bills' && <BillList data={data} lang={lang} />}
    </section>
  );
}
