import { formatDate, formatDateTime } from '../../components/ui.jsx';
import { ASSESSMENT_FIELDS, FOLLOW_ON_FIELDS, MATERNAL_FIELDS, OUTCOME_FIELDS, PLAN_FIELDS, bannerText, labelOf, valueAt, valueWords } from './nicuFields.js';

// The NICU admission printed as NEO-F-03 v1.0 (A4 portrait): the header, the allergy band, §1 maternal and perinatal
// history in two columns, §2 admission assessment in three, §3 problem list and plan in two, then the sign-offs. The
// letterhead, the form's box and the footer "NEO-F-03 · v1.0" come from ManualPrint (components/print/ManualPage.jsx).
// The HIV test is printed under its neutral name. Every field of the form is printed, '–' when empty.

function Pairs({ fields, values, rules, unknown = [], top }) {
  return (
    <dl>
      {fields.map((f) => (
        <div key={f.key} className="nicu-pf">
          <dt>{labelOf(f, rules)}</dt>
          <dd>{valueWords(f, f.top ? top?.[f.key] : valueAt(values ?? {}, f.key), rules, unknown.includes(f.key))}</dd>
        </div>
      ))}
    </dl>
  );
}
/** The fields split into n columns, in order (down the first column, then the next). */
function Columns({ n, fields, ...rest }) {
  const per = Math.ceil(fields.length / n);
  return (
    <div className={`nicu-cols-${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <Pairs key={i} fields={fields.slice(i * per, (i + 1) * per)} {...rest} />
      ))}
    </div>
  );
}

export function NicuF03Print({ admission: n, baby, rules }) {
  const a = n.assessment ?? {};
  const exam = Object.entries(rules.examSystems).map(([k, label]) => ({ k, label, e: a.exam?.[k] }));
  const c = n.computed ?? {};
  return (
    <div className="nicu-print">
      <h1 className="pdoc-title">NICU admission</h1>
      <dl className="pdoc-facts">
        {[
          ['Baby', baby.fullName],
          ['Baby UHID', baby.mrn],
          ['Mother UHID', n.motherMrn ?? '–'],
          ['Register no.', n.registerLabel],
          ['Admitted', formatDateTime(n.admittedAt)],
          ['From', n.sourceWords + (n.transferFromName ? ` – ${n.transferFromName}` : '')],
          ['Unit', `${n.unitName} (${rules.levels[n.unitLevel] ?? n.unitLevel})`],
          ['Bed', n.bed ? `${n.bed.name} · ${rules.bedKinds[n.bed.type] ?? n.bed.type}` : '–'],
          ['Born', baby.birthAt ? formatDateTime(baby.birthAt) : '–'],
          ['Admitted by', n.byName],
          ['Consultant', n.consultant?.name ?? '–'],
          ['Admitting doctor', n.admittingDoctor?.name ?? '–'],
        ].map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </div>
        ))}
      </dl>
      <p className="nicu-allergy">{`Allergy alert: ${n.allergyAlert || 'none recorded'}`}</p>
      {(n.banners ?? []).filter((b) => b.key !== 'late').length > 0 && <p className="pdoc-kind">{`At admission: ${n.banners.filter((b) => b.key !== 'late').map(bannerText).join(' ')}`}</p>}

      <h2>§1 Maternal and perinatal history</h2>
      <Columns n={2} fields={MATERNAL_FIELDS} values={n.maternal} unknown={n.maternal?.unknown ?? []} rules={rules} />

      <h2>§2 Admission assessment</h2>
      <Columns n={3} fields={ASSESSMENT_FIELDS} values={a} top={n} rules={rules} />
      <div className="nicu-cols-3">
        <dl>
          {[
            ['Maturity', rules.maturity[c.maturityClass] ?? '–'],
            ['Size for gestation', c.sizeClass ? rules.size[c.sizeClass] : 'Centile not typed'],
            ['ROP screening', c.ropEligible ? `First examination due ${formatDate(c.ropFirstExamDue)}` : 'Not eligible'],
          ].map(([dt, dd]) => (
            <div key={dt} className="nicu-pf">
              <dt>{dt}</dt>
              <dd>{dd}</dd>
            </div>
          ))}
        </dl>
        <dl>
          {[
            ['Cranial ultrasound', c.cranialUsg?.length ? c.cranialUsg.map((x) => `${x.label} (${formatDate(x.on)})`).join(', ') : 'Not needed'],
            ['Hearing (AABR) before discharge', c.hearingAabrBeforeDischarge ? 'Yes – stay over 5 days' : 'Not yet'],
            ['Length of stay (days)', c.lengthOfStayDays ?? '–'],
          ].map(([dt, dd]) => (
            <div key={dt} className="nicu-pf">
              <dt>{dt}</dt>
              <dd>{dd}</dd>
            </div>
          ))}
        </dl>
      </div>
      <table className="ptable pdoc-table">
        <thead>
          <tr>
            <th scope="col">Examination</th>
            <th scope="col">Finding</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {exam.map(({ k, label, e }) => (
            <tr key={k}>
              <td>{label}</td>
              <td>{e?.status === 'normal' ? 'Normal' : e?.status === 'abnormal' ? 'Not normal' : '–'}</td>
              <td>{e?.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>§3 Problem list and plan</h2>
      {(n.plan?.problems ?? []).length ? (
        <ol className="pdoc-kind">
          {n.plan.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      ) : (
        <p className="pdoc-kind">No problems listed</p>
      )}
      <Columns n={2} fields={[...PLAN_FIELDS, ...FOLLOW_ON_FIELDS]} values={{ ...(n.plan ?? {}), ...(n.followOn ?? {}) }} top={n} rules={rules} />

      {n.outcome && (
        <>
          <h2>Outcome (NEO-L-05)</h2>
          <Columns
            n={2}
            fields={[{ key: 'result', label: 'Outcome', type: 'enum', options: 'outcomes' }, { key: 'at', label: 'When', type: 'at' }, ...OUTCOME_FIELDS.filter((f) => !f.when || f.when === n.outcome.result)]}
            values={{ ...(n.outcome.details ?? {}), result: n.outcome.result, at: n.outcome.at }}
            rules={rules}
          />
        </>
      )}

      <div className="nicu-signs">
        <div>
          <strong>Admitting doctor</strong>
          <br />
          {n.signed ? `${n.signed.byName} · ${formatDateTime(n.signed.at)}` : 'Not signed'}
        </div>
        <div>
          <strong>Parents counselled by</strong>
          <br />
          {n.followOn?.counselledAt ? `${n.followOn.counselledByName ?? ''} · ${formatDateTime(n.followOn.counselledAt)}` : 'Not yet'}
        </div>
        <div>
          <strong>Consultant review</strong>
          <br />
          {n.followOn?.consultantReviewAt ? `${n.consultant?.name ?? n.followOn.consultantReviewByName ?? ''} · ${formatDateTime(n.followOn.consultantReviewAt)}` : 'Not yet'}
        </div>
      </div>
    </div>
  );
}
