import { useState } from 'react';
import { ArrowDown, ArrowUp, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { blobToBase64 } from '../visits/whatsapp.js';
import { Barcode } from '../../components/print/Barcode.jsx';
import { QrCode } from '../../components/print/QrCode.jsx';
import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { SENSITIVITY, bySection, departmentName, isAbnormal, isConfidential, sampleLabels, shownName, testDef, valueWords } from './labFormat.js';

// The lab's printouts (docs/LAB_LIMS_PLAN.md features 1 and 4), printed by the browser on A4:
//  - sample labels: one per container, with a Code 128 barcode of the sample number and the container's number,
//    the patient's name, number and age, the sample and its tests (a confidential test by its neutral name);
//  - the lab report: the letterhead, the patient and sample, the results by department with the range used and the
//    flag (icon + word), the lab remark, who entered and who checked it. A confidential test (HIV) is left out unless
//    the person printing includes it, and then prints under its neutral name. Ranges a doctor has not approved are
//    marked DRAFT. Each printout is recorded in the audit log (ids only).
//    Report templates (docs/LAB_TEMPLATES_PLAN.md): each test prints by its template – a table with sections (CBC,
//    LFT, urine), serology with method and cut-off, a culture with its sensitivity table, or paragraphs
//    (histopathology, Pap smear) – with its method and notes; the signer with qualification, registration number and
//    signature picture (only when that person checked it); "End of report"; page numbers.

const FLAG_PRINT = { low: { icon: ArrowDown, word: 'Low' }, high: { icon: ArrowUp, word: 'High' }, abnormal: { icon: TriangleAlert, word: 'Abnormal' } };

export function LabLabels({ order, catalogue, onPrinted, onClose }) {
  const labels = order.sampleNo ? sampleLabels(order, catalogue) : [];
  const p = order.patient;
  const record = async () => {
    const res = await api(`/lab/orders/${order.id}/labels-printed`, { method: 'POST' });
    onPrinted?.(res.order);
  };
  return (
    <PrintPreview title="Sample labels – print preview" hint="One label per container. Print on A4 label sheets (50 × 25 mm) or plain paper and cut." onPrint={record} onClose={onClose}>
      {!order.sampleNo ? (
        <Alert type="info">This order was made before sample numbers. Press Print to give it a number – the labels then show it.</Alert>
      ) : (
        <PrintDocument className="lab-labels">
          {labels.map((l) => (
            <div key={l.code} className="lab-label">
              <Barcode value={l.code} height={8} />
              <div className="lab-label-code">{l.code}</div>
              <div className="lab-label-name">{p.fullName}</div>
              <div className="lab-label-line">
                {p.mrn}
                {p.age != null ? ` · ${p.age} yrs` : ''} · {formatDate(order.ordered.at)}
                {order.urgent ? ' · URGENT' : ''}
              </div>
              <div className="lab-label-line">
                <strong>{l.sample}</strong>: {l.tests.join(', ')}
              </div>
            </div>
          ))}
        </PrintDocument>
      )}
    </PrintPreview>
  );
}

/** The tests of the report by department, in the order's order. */
function byDepartment(tests, catalogue) {
  const groups = new Map();
  for (const t of tests) {
    const dept = t.department || testDef(catalogue, t.key)?.department || 'other';
    if (!groups.has(dept)) groups.set(dept, []);
    groups.get(dept).push(t);
  }
  return [...groups.entries()];
}

/** A result with its flag as icon + word (and a big change from her last result). */
function Result({ v }) {
  const flag = FLAG_PRINT[v.flag];
  const Icon = flag?.icon;
  return (
    <>
      {isAbnormal(v.flag) ? <strong>{v.value}</strong> : v.value}
      {flag && (
        <span className="lab-report-flag">
          {' '}
          <Icon aria-hidden="true" /> {flag.word}
        </span>
      )}
      {v.bigChange && (
        <span className="lab-report-flag">
          {' '}
          · big change ({v.deltaPercent > 0 ? '+' : ''}
          {v.deltaPercent} %)
        </span>
      )}
      {v.calculated && <span className="pdoc-kind lab-report-calc">worked out</span>}
    </>
  );
}

/** Table template: the values under their sections (CBC: red cells, indices, white cells, platelets …). */
function TableTemplate({ t, def, draft }) {
  const values = t.values.filter((v) => v.value !== '');
  return (
    <table className="ptable pdoc-table lab-report-table">
      <thead>
        <tr>
          <th scope="col">Investigation</th>
          <th scope="col">Result</th>
          <th scope="col">Unit</th>
          <th scope="col">Usual range</th>
        </tr>
      </thead>
      <tbody>
        {bySection(values).flatMap(([section, list]) => [
          ...(section
            ? [
                <tr key={`s-${section}`} className="lab-report-section">
                  <td colSpan={4}>{section}</td>
                </tr>,
              ]
            : []),
          ...list.map((v) => {
            const w = valueWords(v, def);
            return (
              <tr key={v.key}>
                <td className={section ? 'lab-report-indent' : undefined}>{isConfidential(t) ? 'Result' : w.name}</td>
                <td className="pdoc-tabular">{def?.fields?.find((f) => f.key === v.key)?.long ? <span className="pre-line">{v.value}</span> : <Result v={v} />}</td>
                <td>{w.unit}</td>
                <td>
                  {w.range}
                  {w.range && draft ? ' (DRAFT)' : ''}
                </td>
              </tr>
            );
          }),
        ])}
      </tbody>
    </table>
  );
}

/** Serology template: the result, the method, the cut-off (usual range) – one line per value. */
function SerologyTemplate({ t, def, method }) {
  const values = t.values.filter((v) => v.value !== '');
  return (
    <table className="ptable pdoc-table lab-report-table">
      <thead>
        <tr>
          <th scope="col">Investigation</th>
          <th scope="col">Result</th>
          <th scope="col">Method</th>
        </tr>
      </thead>
      <tbody>
        {values.map((v) => {
          const w = valueWords(v, def);
          return (
            <tr key={v.key}>
              <td>{isConfidential(t) ? shownName(t) : w.name}</td>
              <td>
                <Result v={v} />
                {w.range && <span className="pdoc-kind">Cut-off: {w.range}</span>}
              </td>
              <td>{method || '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Culture template: growth, organism and count, then the sensitivity table (S, I, R) and its key. */
function CultureTemplate({ t, def }) {
  const values = t.values.filter((v) => v.value !== '');
  return (
    <>
      <dl className="pdoc-facts lab-report-culture">
        {values.map((v) => (
          <div key={v.key}>
            <dt>{valueWords(v, def).name}</dt>
            <dd>
              <Result v={v} />
            </dd>
          </div>
        ))}
      </dl>
      {t.antibiotics?.length > 0 && (
        <>
          <table className="ptable pdoc-table lab-report-table lab-report-abx">
            <thead>
              <tr>
                <th scope="col">Antibiotic</th>
                <th scope="col">Result</th>
                <th scope="col">Zone</th>
              </tr>
            </thead>
            <tbody>
              {t.antibiotics.map((a) => (
                <tr key={a.name}>
                  <td>{a.name}</td>
                  <td>{a.result === 'R' ? <strong>{SENSITIVITY[a.result]}</strong> : (SENSITIVITY[a.result] ?? a.result)}</td>
                  <td>{a.zone}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pdoc-small">S = Sensitive, I = Intermediate, R = Resistant.</p>
        </>
      )}
    </>
  );
}

/** Paragraphs template (histopathology, Pap smear): each value as a heading and its text. */
function NarrativeTemplate({ t, def }) {
  return (
    <div className="lab-report-narrative">
      {t.values
        .filter((v) => v.value !== '')
        .map((v) => (
          <div key={v.key} className="lab-report-para">
            <h3>{valueWords(v, def).name}</h3>
            <p className="pre-line">
              <Result v={v} />
            </p>
          </div>
        ))}
    </div>
  );
}

const TEMPLATE_PARTS = { table: TableTemplate, serology: SerologyTemplate, culture: CultureTemplate, narrative: NarrativeTemplate };

/** One test of the report, laid out by its template, with its method and notes. */
function ReportTest({ t, def, ownPage }) {
  const template = def?.report?.template ?? 'table';
  const Part = TEMPLATE_PARTS[template] ?? TableTemplate;
  const draft = def?.status === 'draft';
  // The method and notes as they were when the result was saved (else the test list's)
  const method = t.method ?? def?.report?.method ?? '';
  const notes = t.notes ?? def?.report?.notes ?? '';
  const values = t.values.filter((v) => v.value !== '');
  return (
    <section className={`lab-report-test${ownPage ? ' lab-report-own-page' : ''}`}>
      <h2 className="lab-report-test-name">
        {shownName(t)}
        {def?.sample && <span className="pdoc-kind">Sample: {def.sample}</span>}
        {t.outside && <span className="pdoc-kind">Done at {t.outside.labName}</span>}
      </h2>
      {values.length > 0 || t.antibiotics?.length ? <Part t={t} def={def} draft={draft} method={method} /> : null}
      {t.text && <p className="pre-line">{t.text}</p>}
      {!values.length && !t.text && !t.antibiotics?.length && <p className="pdoc-small">See the attached report.</p>}
      {method && template !== 'serology' && <p className="pdoc-small">Method: {method}</p>}
      {notes && (
        <p className="pdoc-small lab-report-notes">
          Note{draft ? ' (DRAFT)' : ''}: {notes}
        </p>
      )}
    </section>
  );
}

/** Who signs: the signer who checked it, with the signature picture; else the default signer, to sign by hand. */
function Signatures({ order, signer }) {
  const entered = order.entered?.byName ?? order.reported?.byName ?? '';
  return (
    <div className="pdoc-sigs lab-report-sigs">
      <div className="pdoc-sig">
        <h2 className="pdoc-sig-title">Entered by</h2>
        <p>{entered}</p>
        {order.verified && <p className="pdoc-small">Checked by {order.verified.byName}</p>}
      </div>
      <div className="pdoc-sig">
        {signer ? (
          <>
            {signer.signature ? <img className="lab-report-signature" src={signer.signature} alt={`Signature of ${signer.name}`} /> : <div className="pdoc-sig-line"><span className="pdoc-sig-fill" /></div>}
            <p className="lab-report-signer">
              <strong>{signer.name}</strong>
              {signer.qualification && <span className="pdoc-kind">{signer.qualification}</span>}
              {signer.title && <span className="pdoc-kind">{signer.title}</span>}
              {signer.regNo && <span className="pdoc-kind">Reg. No. {signer.regNo}</span>}
            </p>
          </>
        ) : (
          <>
            <h2 className="pdoc-sig-title">{order.verified ? 'Checked and reported by' : 'Signature'}</h2>
            {order.verified && <p>{order.verified.byName}</p>}
            <div className="pdoc-sig-line">
              <span className="pdoc-sig-label">Signature</span>
              <span className="pdoc-sig-fill" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LabReportDocument({ order, catalogue, letterhead, withConfidential, signer = null, eachOnOwnPage = false }) {
  const tests = order.tests.filter((t) => withConfidential || !isConfidential(t));
  const left = order.tests.length - tests.length;
  // DRAFT: a value printed with a range, or a note, of a test a doctor has not approved
  const draft = tests.some((t) => {
    const def = testDef(catalogue, t.key);
    return def?.status === 'draft' && (t.values.some((v) => v.value !== '' && valueWords(v, def).range) || Boolean(t.notes ?? def?.report?.notes));
  });
  const p = order.patient;
  let first = true;
  return (
    <PrintDocument
      className="lab-report"
      draft={draft ? 'Usual ranges and notes marked DRAFT are not yet approved by the hospital’s doctor. The flags only draw attention: the treating doctor decides.' : undefined}
      footer={
        <>
          {letterhead && <LetterheadFooter letterhead={letterhead} />}
          <span>Sample {order.sampleNo ?? '—'} · printed {formatDateTime(new Date())}</span>
        </>
      }
    >
      {letterhead && <Letterhead letterhead={letterhead} />}
      <h1 className="pdoc-title">Laboratory report</h1>
      <PrintFacts
        items={[
          ['Patient', p.fullName],
          ['Patient number', p.mrn],
          ['Age / sex', p.careType === 'newborn' ? 'Baby' : `${p.age != null ? `${p.age} years` : '—'} / ${p.sex === 'male' ? 'Male' : 'Female'}`],
          ['Sample number', order.sampleNo ?? ''],
          [order.source === 'walk_in' ? 'Referred by' : 'Ordered by', order.source === 'walk_in' ? (order.referrer?.name ?? 'Self') : order.ordered.byName],
          ['Ordered', formatDateTime(order.ordered.at)],
          ['Sample taken', order.collected ? formatDateTime(order.collected.at) : ''],
          ['Reported', order.reported ? formatDateTime(order.reported.at) : ''],
        ]}
      />
      {byDepartment(tests, catalogue).map(([dept, list]) => (
        <div key={dept} className="lab-report-dept">
          <h2 className="lab-report-dept-name">{departmentName(dept)}</h2>
          {list.map((t, ti) => {
            const def = testDef(catalogue, t.key);
            // A test on its own page (histopathology, cultures, Pap – or every test when chosen), never before the first
            const own = !first && (eachOnOwnPage || Boolean(def?.report?.ownPage));
            first = false;
            return <ReportTest key={`${t.key}-${ti}`} t={t} def={def} ownPage={own} />;
          })}
        </div>
      ))}
      {left > 0 && <p className="pdoc-small">{left === 1 ? 'One confidential test is' : `${left} confidential tests are`} not on this printout. The doctor has the result.</p>}
      {order.labNote && (
        <p>
          <strong>Lab remark: </strong>
          {order.labNote}
        </p>
      )}
      <Signatures order={order} signer={signer} />
      <p className="pdoc-small">
        {order.status === 'reviewed' ? `Reviewed by ${order.reviewed.byName}, ${formatDate(order.reviewed.at)}.` : order.source === 'walk_in' ? 'For the referring doctor.' : 'Not reviewed by a doctor yet.'}
      </p>
      {order.verifyToken && (
        <div className="lab-report-verify">
          <QrCode value={`${window.location.origin}/verify/${order.verifyToken}`} />
          <p className="pdoc-small">Scan to check that this report is genuine (no results are shown there).</p>
        </div>
      )}
      <p className="lab-report-end">End of report</p>
    </PrintDocument>
  );
}

// ---------- On the lab's own letterhead paper (22 Oct 2026) ----------
// The lab prints on paper that already carries its logo, name and address at the top and bottom. Then Perinexa prints
// the report only: no letterhead, no hospital name, no footer – the top and bottom margins are left blank for the
// printed header and footer. One test per sheet (one report per page), each sheet with the patient and sample details,
// the results as Test Name · Obtained Value · Unit · Bio. Ref. Interval, the sample's barcode and the signature, laid
// out tightly so a full CBC fits on one page. DRAFT ranges stay marked DRAFT; HIV prints under its neutral name.

/**
 * The patient and sample block – only at the top of the first page (22 Oct 2026, developer), with the reporting
 * doctor's name, qualification and registration number and the sample's barcode.
 */
function SheetHead({ order, sample, signer }) {
  const p = order.patient;
  const ageSex = p.careType === 'newborn' ? 'Baby' : `${p.age != null ? `${p.age} Years` : '—'} / ${p.sex === 'male' ? 'Male' : 'Female'}`;
  const refBy = order.source === 'walk_in' ? (order.referrer?.name ?? 'Self') : order.ordered.byName;
  const left = [
    ['Patient name', p.fullName],
    ['Age / Sex', ageSex],
    ['Patient ID', p.mrn],
    [order.source === 'walk_in' ? 'Referring Dr' : 'Ordered by', refBy],
  ];
  const right = [
    ['Registration date', formatDateTime(order.ordered.at)],
    ['Sample drawn date', order.collected ? formatDateTime(order.collected.at) : ''],
    ['Reporting date', order.reported ? formatDateTime(order.reported.at) : ''],
    ['Sample type', sample ?? ''],
    ['Sample no.', order.sampleNo ?? ''],
    ['Reported by', signer ? [signer.name, signer.qualification, signer.regNo && `Reg. No. ${signer.regNo}`].filter(Boolean).join(', ') : (order.verified?.byName ?? '')],
  ];
  const rows = (list) =>
    list.map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v || '—'}</dd>
      </div>
    ));
  return (
    <div className="lab-sheet-head">
      <div className="lab-sheet-head-left">
        <dl>{rows(left)}</dl>
        {order.sampleNo && <Barcode value={order.sampleNo} height={7} />}
      </div>
      <dl>{rows(right)}</dl>
    </div>
  );
}

/** A table test on a sheet: the four columns of a lab report, its sections as sub-headings. */
function SheetTable({ t, def, draft }) {
  const values = t.values.filter((v) => v.value !== '');
  return (
    <table className="ptable lab-sheet-table">
      <thead>
        <tr>
          <th scope="col">Test Name</th>
          <th scope="col">Obtained Value</th>
          <th scope="col">Unit</th>
          <th scope="col">Bio. Ref. Interval</th>
        </tr>
      </thead>
      <tbody>
        {bySection(values).flatMap(([section, list]) => [
          ...(section
            ? [
                <tr key={`s-${section}`} className="lab-sheet-section">
                  <td colSpan={4}>{section}</td>
                </tr>,
              ]
            : []),
          ...list.map((v) => {
            const w = valueWords(v, def);
            return (
              <tr key={v.key}>
                <td className={section ? 'lab-sheet-indent' : undefined}>{isConfidential(t) ? 'Result' : w.name}</td>
                <td>{def?.fields?.find((f) => f.key === v.key)?.long ? <span className="pre-line">{v.value}</span> : <Result v={v} />}</td>
                <td>{w.unit}</td>
                <td>
                  {w.range}
                  {w.range && draft ? ' (DRAFT)' : ''}
                </td>
              </tr>
            );
          }),
        ])}
      </tbody>
    </table>
  );
}

/** One test on a sheet: its name as the heading, then its results by its template. */
function SheetTest({ t, def }) {
  const template = def?.report?.template ?? 'table';
  const Part = template === 'table' ? SheetTable : (TEMPLATE_PARTS[template] ?? SheetTable);
  const draft = def?.status === 'draft';
  const method = t.method ?? def?.report?.method ?? '';
  const notes = t.notes ?? def?.report?.notes ?? '';
  const values = t.values.filter((v) => v.value !== '');
  return (
    <section className="lab-sheet-test">
      <h2 className="lab-sheet-test-name">{shownName(t)}</h2>
      {t.outside && <p className="lab-sheet-small">Done at {t.outside.labName}</p>}
      {values.length > 0 || t.antibiotics?.length ? <Part t={t} def={def} draft={draft} method={method} /> : null}
      {t.text && <p className="pre-line">{t.text}</p>}
      {!values.length && !t.text && !t.antibiotics?.length && <p className="lab-sheet-small">See the attached report.</p>}
      {method && template !== 'serology' && <p className="lab-sheet-small">Method: {method}</p>}
      {notes && (
        <p className="lab-sheet-small">
          Note{draft ? ' (DRAFT)' : ''}: {notes}
        </p>
      )}
    </section>
  );
}

/** The foot of a sheet: the signature only (the picture, or a line to sign on) – the doctor's name is at the top. */
function SheetFoot({ signer }) {
  return (
    <div className="lab-sheet-foot">
      <div className="lab-sheet-signer">
        {signer?.signature ? <img className="lab-report-signature" src={signer.signature} alt={`Signature of ${signer.name}`} /> : <span className="lab-sheet-sign-line" />}
        <span>Signature</span>
      </div>
    </div>
  );
}

/**
 * The report on the lab's letterhead paper: one sheet per test (or all tests on one sheet when `together`); the patient
 * block (with the doctor and the barcode) on the first page only, then each test with its signature. Nothing else: no
 * letterhead, no footer, no page numbers.
 */
export function LabReportSheets({ order, catalogue, withConfidential, signer = null, together = false }) {
  const tests = order.tests.filter((t) => withConfidential || !isConfidential(t));
  const left = order.tests.length - tests.length;
  const sheets = together ? [tests] : tests.map((t) => [t]);
  const samples = [...new Set(tests.map((t) => testDef(catalogue, t.key)?.sample).filter(Boolean))].join(', ');
  const draftOf = (list) =>
    list.some((t) => {
      const def = testDef(catalogue, t.key);
      return def?.status === 'draft' && (t.values.some((v) => v.value !== '' && valueWords(v, def).range) || Boolean(t.notes ?? def?.report?.notes));
    });
  return (
    <div className="pdoc lab-sheets">
      {sheets.map((list, i) => {
        const last = i === sheets.length - 1;
        return (
          <section key={list.map((t) => t.key).join('+') || i} className="lab-sheet">
            {i === 0 && <SheetHead order={order} sample={samples} signer={signer} />}
            {list.map((t, ti) => (
              <SheetTest key={`${t.key}-${ti}`} t={t} def={testDef(catalogue, t.key)} />
            ))}
            {last && left > 0 && <p className="lab-sheet-small">{left === 1 ? 'One confidential test is' : `${left} confidential tests are`} not on this printout. The doctor has the result.</p>}
            {last && order.labNote && (
              <p className="lab-sheet-small">
                <strong>Lab remark: </strong>
                {order.labNote}
              </p>
            )}
            {draftOf(list) && <p className="lab-sheet-small">Ranges and notes marked DRAFT are not yet approved by the hospital&rsquo;s doctor.</p>}
            <SheetFoot signer={signer} />
          </section>
        );
      })}
    </div>
  );
}

// The paper the lab prints on, remembered in this browser: 'letterhead' (the lab's own pre-printed paper – the
// report only, the top and bottom left blank) or 'plain' (plain A4 – Perinexa prints the hospital's letterhead).
const PAPER_KEY = 'perinexa:labPaper';
const DEFAULT_PAPER = { kind: 'letterhead', top: 45, bottom: 30 };
export function readLabPaper() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_KEY) ?? 'null');
    if (saved && (saved.kind === 'letterhead' || saved.kind === 'plain')) return { ...DEFAULT_PAPER, ...saved };
  } catch {
    /* the default paper */
  }
  return DEFAULT_PAPER;
}
const clampMm = (n, fallback) => (Number.isFinite(n) ? Math.min(120, Math.max(5, Math.round(n))) : fallback);

export function LabReportPrint({ order, catalogue, signer = null, onClose }) {
  // The paper (22 Oct 2026): the lab's own letterhead paper by default – the report only, one test per page
  const [paper, setPaperState] = useState(readLabPaper);
  const setPaper = (next) => {
    setPaperState(next);
    try {
      localStorage.setItem(PAPER_KEY, JSON.stringify(next));
    } catch {
      /* remembered for this print only */
    }
  };
  const onLetterhead = paper.kind === 'letterhead';
  const lh = useFetch(onLetterhead ? null : '/tenant/settings/letterhead');
  const hasConfidential = order.tests.some(isConfidential);
  const [withConfidential, setWithConfidential] = useState(false);
  const [eachOnOwnPage, setEachOnOwnPage] = useState(false);
  const [together, setTogether] = useState(false);
  const record = () => api(`/lab/orders/${order.id}/report-printed`, { method: 'POST', body: { confidential: hasConfidential && withConfidential } });
  // On WhatsApp in one click once a doctor reviewed it, with her agreement – never with the confidential test
  const offer = useFetch(order.status === 'reviewed' || (order.source === 'walk_in' && order.status === 'reported') ? `/lab/orders/${order.id}/whatsapp` : null);
  const pdf = {
    fileName: `Lab report ${order.sampleNo ?? order.patient.mrn}.pdf`,
    title: `Lab report ${order.sampleNo ?? ''}`.trim(),
    onSaved: () => record(),
    sendNow:
      offer.data?.available && !withConfidential
        ? { label: offer.data.label, practice: offer.data.practice, send: async (blob) => api(`/lab/orders/${order.id}/whatsapp`, { method: 'POST', body: { pdf: await blobToBase64(blob), confidential: false } }) }
        : null,
  };
  const ready = onLetterhead || Boolean(lh.data);
  const layout = onLetterhead ? `lh-${paper.top}-${paper.bottom}-${together}` : `plain-${eachOnOwnPage}`;
  const mm = (key) => (e) => setPaper({ ...paper, [key]: clampMm(Number(e.target.value), DEFAULT_PAPER[key]) });
  return (
    <PrintPreview
      pdf={pdf}
      docKey={ready ? `${order.id}-${withConfidential}-${layout}` : null}
      pageNumbers={!onLetterhead} // on the lab's letterhead paper: no page numbers (22 Oct 2026)
      page={onLetterhead ? { size: 'A4', margin: `${paper.top}mm 12mm ${paper.bottom}mm` } : undefined}
      title="Lab report – print preview"
      hint={onLetterhead ? 'Put the lab’s letterhead paper in the printer: only the report prints, in the space between its header and footer.' : 'Check it, then print on plain A4 paper.'}
      controls={
        <>
          <div className="lab-paper" role="radiogroup" aria-label="Paper">
            <label className="check">
              <input type="radio" name="lab-paper" checked={onLetterhead} onChange={() => setPaper({ ...paper, kind: 'letterhead' })} /> The lab&rsquo;s letterhead paper – print the report only
            </label>
            <label className="check">
              <input type="radio" name="lab-paper" checked={!onLetterhead} onChange={() => setPaper({ ...paper, kind: 'plain' })} /> Plain A4 – with the hospital&rsquo;s letterhead
            </label>
          </div>
          {onLetterhead && (
            <div className="lab-paper-space">
              <label>
                Space for the printed header (mm) <input type="number" min={5} max={120} value={paper.top} onChange={mm('top')} />
              </label>
              <label>
                Space for the printed footer (mm) <input type="number" min={5} max={120} value={paper.bottom} onChange={mm('bottom')} />
              </label>
            </div>
          )}
          {order.tests.length > 1 &&
            (onLetterhead ? (
              <label className="check">
                <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} /> All tests on one sheet (otherwise each test on its own page)
              </label>
            ) : (
              <label className="check">
                <input type="checkbox" checked={eachOnOwnPage} onChange={(e) => setEachOnOwnPage(e.target.checked)} /> Each test on its own page
              </label>
            ))}
          {hasConfidential && (
            <label className="check">
              <input type="checkbox" checked={withConfidential} onChange={(e) => setWithConfidential(e.target.checked)} /> Include the confidential test (printed as “Lab test
              (confidential)”)
            </label>
          )}
        </>
      }
      onPrint={record}
      onClose={onClose}
    >
      {!onLetterhead && lh.error && <Alert type="error">{lh.error}</Alert>}
      {onLetterhead ? (
        <LabReportSheets order={order} catalogue={catalogue} withConfidential={withConfidential} signer={signer} together={together} />
      ) : !lh.data && !lh.error ? (
        <p className="muted">Preparing the report…</p>
      ) : (
        <LabReportDocument order={order} catalogue={catalogue} letterhead={lh.data?.letterhead} withConfidential={withConfidential} signer={signer} eachOnOwnPage={eachOnOwnPage} />
      )}
    </PrintPreview>
  );
}
