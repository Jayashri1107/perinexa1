import { useState } from 'react';
import { CalendarDays, Eye } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { BiLabel, PrintLanguageChoice, Translation } from '../../components/print/Bilingual.jsx';
import { DoctorSignature, Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { DRAFT_TRANSLATION_HINT, ageWords, defaultPrintLanguage, secondLanguage } from '../../components/print/printLanguage.js';
import { Field, FieldError, formatDate, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { ITEM_KIND_LABELS } from '../careplans/templateFormat.js';
import { approvalText, basisText, gaText, isAntenatalPlan, planTitle, sinceText, statusLook, statusNote, windowText } from './carePlanFormat.js';
import {
  DRAFT_PLAN_WORDS,
  PATIENT_COPY_LABELS as L,
  PATIENT_KIND_LABELS,
  PRINT_KINDS,
  PRINT_KIND_LABELS,
  choosableItems,
  hasContent,
  nextCheckUp,
  patientCopy,
  patientCopyTitle,
  patientDone,
  patientNote,
  patientWhat,
  patientWhatIn,
  patientWhen,
  plainWeeks,
  staffCopyGroups,
  staffDetails,
  staffWhen,
  startDayLabel,
  untranslatedCount,
} from './carePlanPrintFormat.js';
import { ageText, formatGestation } from './patientFormat.js';
import { RISK_LABELS } from './riskFormat.js';

// Printing a patient's care plan (Feature 9), from the Care plan tab: the Print dialog, then the print preview.
// - Patient copy: plain words, what is still to come – the complete plan, only some types (e.g. the visit or
//   the sonography schedule) or hand-picked items – optionally what is done, the plan's advice and the
//   doctor's own advice. The doctor's advice is printed only, never saved. Since 5 Oct 2026 in English only, or with
//   Marathi or Hindi next to the English (chosen in the preview; it opens in the language recorded for her
//   messages): the page's own words and the built-in items whose wording nobody changed are translated (DRAFT
//   wording); what staff typed – the doctor's advice, an item a doctor added or reworded – prints as typed.
// - Staff copy: the full plan with statuses, guideline sources, results and notes, for the file. English only.
// Everyone who can see the plan can print it. Pressing Print records "care plan printed" (which copy, and the second
// language) in the audit log. While the plan's template is not approved, every printed page carries the Draft label.

// ---------- The Print dialog ----------

/**
 * Choose what to print. onPreview({ copy, scope, kinds, ids, includeDone, advice, language }) opens the print
 * preview (language: the one chosen in the preview before "Change what is printed", kept as it was).
 * A patient copy needs an active plan (a paused, on-hold or closed plan has nothing to give the patient).
 */
export function PrintPlanDialog({ plan, initial, onPreview, onCancel }) {
  const canPatientCopy = plan.status === 'active' && !plan.eddReview;
  const [copy, setCopy] = useState(initial?.copy ?? (canPatientCopy ? 'patient' : 'staff'));
  const [scope, setScope] = useState(initial?.scope ?? 'all');
  const [kinds, setKinds] = useState(initial?.kinds ?? ['visit', 'scan']);
  const [ids, setIds] = useState(initial?.ids ?? []);
  const [includeDone, setIncludeDone] = useState(initial?.includeDone ?? false);
  const [advice, setAdvice] = useState(initial?.advice ?? '');
  const [errors, setErrors] = useState({});
  const ref = useDialogFocus(onCancel);
  const choosable = choosableItems(plan);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const preview = (e) => {
    e.preventDefault();
    const options = { copy, scope, kinds, ids, includeDone, advice: advice.trim(), ...(initial?.language ? { language: initial.language } : {}) };
    const found = {};
    if (copy === 'patient') {
      if (scope === 'kinds' && kinds.length === 0) found.kinds = 'Tick at least one type.';
      if (scope === 'items' && ids.length === 0) found.ids = 'Tick at least one item.';
      if (!found.kinds && !found.ids && !hasContent(patientCopy(plan, options)) && !options.advice) {
        found.scope = 'Nothing still to come matches this choice. Choose other types or items, or add advice.';
      }
      if (mentionsFetalSex(options.advice)) found.advice = PCPNDT_MESSAGE;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onPreview(options);
  };

  const itemLabel = (it) => {
    const dates = it.done ? patientDone(it) : it.due ? windowText(it.due.from, it.due.to) : it.estimateFrom ? `about ${formatDate(it.estimateFrom)}` : '';
    return (
      <span>
        {it.name}
        <span className="muted">
          {' '}
          · {ITEM_KIND_LABELS[it.kind] ?? it.kind}
          {dates ? ` · ${dates}` : ''}
          {it.status === 'overdue' ? ' · overdue' : ''}
        </span>
      </span>
    );
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide plan-dialog" role="dialog" aria-modal="true" aria-labelledby="print-plan-title" onSubmit={preview} noValidate>
        <h2 id="print-plan-title">Print the care plan</h2>
        <fieldset className="fieldset">
          <legend>Copy</legend>
          <label className={`role-option ${copy === 'patient' ? 'checked' : ''} print-option`} htmlFor="print-copy-patient">
            <input id="print-copy-patient" type="radio" name="print-copy" checked={copy === 'patient'} disabled={!canPatientCopy} onChange={() => setCopy('patient')} />
            <span>
              <strong>Patient copy</strong>
              <small>{canPatientCopy ? 'Plain words and dates, to give to the patient.' : 'Only for an active plan – this plan is not active.'}</small>
            </span>
          </label>
          <label className={`role-option ${copy === 'staff' ? 'checked' : ''} print-option`} htmlFor="print-copy-staff">
            <input id="print-copy-staff" type="radio" name="print-copy" checked={copy === 'staff'} onChange={() => setCopy('staff')} />
            <span>
              <strong>Staff copy</strong>
              <small>The full plan with statuses, guideline sources, results and notes, for the file.</small>
            </span>
          </label>
        </fieldset>

        {copy === 'patient' && (
          <>
            <fieldset className="fieldset" aria-describedby={errors.scope ? 'print-scope-error' : undefined}>
              <legend>What to print</legend>
              <label className="check" htmlFor="print-scope-all">
                <input id="print-scope-all" type="radio" name="print-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                <span>The complete plan – everything still to come</span>
              </label>
              <label className="check" htmlFor="print-scope-kinds">
                <input id="print-scope-kinds" type="radio" name="print-scope" checked={scope === 'kinds'} onChange={() => setScope('kinds')} />
                <span>Only some types, e.g. the visit schedule or the sonography schedule</span>
              </label>
              {scope === 'kinds' && (
                <div className="print-sub" role="group" aria-label="Types to print" aria-describedby={errors.kinds ? 'print-kinds-error' : undefined}>
                  <div className="check-grid">
                    {PRINT_KINDS.map((k) => (
                      <label key={k} className="check" htmlFor={`print-kind-${k}`}>
                        <input id={`print-kind-${k}`} type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(kinds, setKinds, k)} />
                        <span>{PRINT_KIND_LABELS[k]}</span>
                      </label>
                    ))}
                  </div>
                  <FieldError id="print-kinds-error">{errors.kinds}</FieldError>
                </div>
              )}
              <label className="check" htmlFor="print-scope-items">
                <input id="print-scope-items" type="radio" name="print-scope" checked={scope === 'items'} onChange={() => setScope('items')} />
                <span>Choose items, e.g. only the next scan</span>
              </label>
              {scope === 'items' && (
                <div className="print-sub print-choose" role="group" aria-label="Items to print" aria-describedby={errors.ids ? 'print-ids-error' : undefined}>
                  {choosable.toCome.length === 0 && choosable.done.length === 0 && <p className="muted">Nothing is still to come or done.</p>}
                  {[
                    ['Still to come', choosable.toCome],
                    ['Already done', choosable.done],
                  ].map(
                    ([title, list]) =>
                      list.length > 0 && (
                        <div key={title}>
                          <p className="print-choose-head">{title}</p>
                          {list.map((it) => (
                            <label key={it.id} className="check" htmlFor={`print-item-${it.id}`}>
                              <input id={`print-item-${it.id}`} type="checkbox" checked={ids.includes(it.id)} onChange={() => toggle(ids, setIds, it.id)} />
                              {itemLabel(it)}
                            </label>
                          ))}
                        </div>
                      ),
                  )}
                  <FieldError id="print-ids-error">{errors.ids}</FieldError>
                </div>
              )}
              <FieldError id="print-scope-error">{errors.scope}</FieldError>
            </fieldset>
            {scope !== 'items' && (
              <label className="checkbox" htmlFor="print-done">
                <input id="print-done" type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
                <span>Also list what is already done, with the dates</span>
              </label>
            )}
            <Field label="Advice from the doctor (optional)" id="print-advice" error={errors.advice} hint="Printed on this copy only – it is not saved in the record." keepHint>
              <textarea id="print-advice" rows={3} maxLength={1000} value={advice} onChange={(e) => setAdvice(e.target.value)} />
            </Field>
          </>
        )}

        <div className="row">
          <button type="submit" className="btn btn-primary">
            <Eye aria-hidden="true" /> Preview
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- The print preview ----------

/**
 * The chosen copy in the print preview. Print records the printout (audit), then opens the browser's print
 * window. onBack({ language }) goes back to the dialog with the same choices (and the language chosen here).
 * The patient copy has a language choice: English only, or English with Marathi or Hindi.
 */
export function CarePlanPrintPreview({ patient, plan, options, onBack, onClose }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const staff = options.copy === 'staff';
  const [language, setLanguage] = useState(() => options.language ?? defaultPrintLanguage(patient));
  const lang = staff ? 'en' : language;
  const second = secondLanguage(lang);
  const printedAt = new Date();
  const draftLabel = plan.template && !plan.template.approved ? approvalText(plan.template).label : null;
  // The Draft band in her language too: she must be able to read that the plan is not approved yet
  const draft =
    draftLabel && second ? (
      <>
        {draftLabel} / <span lang={second}>{DRAFT_PLAN_WORDS[second]}</span>
      </>
    ) : (
      draftLabel
    );
  const signs = hasRole(activeMembership, 'doctor', 'rmo');
  const englishOnly = untranslatedCount(patientCopy(plan, options), lang);

  const record = () =>
    api(`/patients/${patient.id}/care-plan/printed`, { method: 'POST', body: { copy: options.copy, planId: plan.id, ...(staff ? {} : { language: lang }) } });

  const controls = staff ? null : (
    <PrintLanguageChoice
      value={language}
      onChange={setLanguage}
      hints={
        second
          ? [
              `${second === 'mr' ? 'Marathi' : 'Hindi'} prints under the English. Text typed by staff – the doctor's advice, an item a doctor added or reworded – prints as typed.${
                englishOnly ? ` ${englishOnly} ${englishOnly === 1 ? 'item prints' : 'items print'} in English only for that reason.` : ''
              }`,
              DRAFT_TRANSLATION_HINT,
            ]
          : []
      }
    />
  );

  const footer = (
    <>
      <span>
        {patient.fullName} · {patient.mrn}
      </span>
      <span>
        {staff ? 'Staff copy – for hospital use · ' : ''}Printed {formatDateTime(printedAt)} by {user.name}
      </span>
    </>
  );

  return (
    <PrintPreview
      title={staff ? 'Care plan – staff copy' : 'Care plan – patient copy'}
      hint={
        <>
          {lh.error && !lh.data ? "The letterhead couldn't be loaded, so only the hospital's name is printed. " : ''}
          Check the page, then print it on A4 paper.{' '}
          {!staff && (
            <button type="button" className="btn btn-link plan-inline-link" onClick={() => onBack({ language })}>
              Change what is printed
            </button>
          )}
        </>
      }
      controls={controls}
      onPrint={record}
      onClose={onClose}
    >
      <PrintDocument draft={draft} footer={footer}>
        <Letterhead letterhead={letterhead} />
        {staff ? (
          <StaffCopy patient={patient} plan={plan} />
        ) : (
          <PatientCopy patient={patient} plan={plan} options={options} lang={lang} />
        )}
        {signs && <DoctorSignature user={user} />}
        <LetterheadFooter letterhead={letterhead} />
      </PrintDocument>
    </PrintPreview>
  );
}

// ---------- Patient copy ----------

/** A value in English with its translation after it ("28 yrs / 28 वर्षे"); just the English when they read the same. */
function BiValue({ en, other, lang }) {
  const second = secondLanguage(lang);
  if (!second || !other || other === en) return en;
  return (
    <>
      {en} / <span lang={second}>{other}</span>
    </>
  );
}

/**
 * The patient copy (in the print preview, and in tests). lang: 'en' (English only), 'mr' or 'hi' – that language
 * under or after the English. Items print in her language only when they have a translation (planItemText); the
 * doctor's advice always prints as typed.
 */
export function PatientCopy({ patient, plan, options, lang = 'en' }) {
  const second = secondLanguage(lang);
  const copy = patientCopy(plan, options);
  const withVisits = options.scope === 'all' || (options.scope === 'kinds' && options.kinds.includes('visit'));
  const next = withVisits ? nextCheckUp(plan) : '';
  const title = patientCopyTitle(options, plan.careType);
  const label = (key) => <BiLabel key={key} words={L[key]} lang={lang} />;
  const kindLabel = (it) => (PATIENT_KIND_LABELS[it.kind] ? <BiLabel words={PATIENT_KIND_LABELS[it.kind]} lang={lang} /> : it.kind);
  // (with the type of care: an item of pregnancy-loss care with no words for her never shows its staff name)
  const what = (it) => (
    <>
      {patientWhat(it, plan.careType)}
      <Translation text={patientWhatIn(it, lang)} english={patientWhat(it, plan.careType)} lang={lang} />
    </>
  );
  const start = startDayLabel(plan);
  return (
    <>
      <h1 className="pdoc-title">{title}</h1>
      {second && (
        <p className="pdoc-title pdoc-title-2" lang={second}>
          {patientCopyTitle(options, plan.careType, second)}
        </p>
      )}
      <PrintFacts
        items={[
          [label('name'), patient.fullName],
          [label('age'), <BiValue key="age" en={ageText(patient)} other={second ? ageWords(patient, second) : ''} lang={lang} />],
          [label('patientNo'), <span key="mrn" className="pdoc-tabular">{patient.mrn}</span>],
          ...(isAntenatalPlan(plan)
            ? [
                [label('edd'), formatDate(plan.edd)],
                // ('' when the weeks are not known – e.g. today is before the day the weeks count from: printed as "—")
                [label('weeksToday'), plan.gestationToday ? <BiValue key="weeks" en={plainWeeks(plan.gestationToday)} other={second ? plainWeeks(plan.gestationToday, second) : ''} lang={lang} /> : ''],
              ]
            : [[<BiLabel key="start" words={start} lang={lang} />, formatDate(plan.startOn ?? plan.dayZero)]]),
          [label('doctor'), patient.assignedDoctorName ?? undefined],
        ]}
      />
      {next && (
        <p className="pdoc-next">
          <CalendarDays aria-hidden="true" />
          <span>
            <strong>{next}</strong>
            <Translation as="strong" text={second ? nextCheckUp(plan, second) : ''} english={next} lang={lang} />
          </span>
        </p>
      )}
      {copy.schedule.length > 0 && (
        <>
          <h2>{label('planned')}</h2>
          <table className="ptable pdoc-table">
            <thead>
              <tr>
                <th scope="col" className="pdoc-col-when">
                  {label('when')}
                </th>
                <th scope="col">{label('what')}</th>
              </tr>
            </thead>
            <tbody>
              {copy.schedule.map((it) => {
                const w = patientWhen(it);
                const t = second ? patientWhen(it, second) : null;
                return (
                  <tr key={it.id}>
                    <td className="pdoc-tabular">
                      <strong>{w.when}</strong>
                      <Translation as="strong" text={t?.when} english={w.when} lang={lang} />
                      {w.weeks && <span className="pdoc-sub">{w.weeks}</span>}
                      <Translation text={t?.weeks} english={w.weeks} lang={lang} className="pdoc-sub" />
                    </td>
                    <td>
                      <span className="pdoc-kind">{kindLabel(it)}</span>
                      {what(it)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {copy.done.length > 0 && (
        <>
          <h2>{label('alreadyDone')}</h2>
          <table className="ptable pdoc-table">
            <thead>
              <tr>
                <th scope="col" className="pdoc-col-when">
                  {label('done')}
                </th>
                <th scope="col">{label('what')}</th>
              </tr>
            </thead>
            <tbody>
              {copy.done.map((it) => (
                <tr key={it.id}>
                  <td className="pdoc-tabular">
                    {patientDone(it)}
                    <Translation text={second ? patientDone(it, second) : ''} english={patientDone(it)} lang={lang} />
                  </td>
                  <td>
                    <span className="pdoc-kind">{kindLabel(it)}</span>
                    {what(it)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {(copy.advice.length > 0 || options.advice) && (
        <section className="pdoc-box">
          <h2>{label('advice')}</h2>
          {copy.advice.length > 0 && (
            <ul className="pdoc-list">
              {copy.advice.map((it) => (
                <li key={it.id}>{what(it)}</li>
              ))}
            </ul>
          )}
          {options.advice && (
            <p className="pre-line">
              <strong>
                <BiLabel words={L.fromDoctor} lang={lang} />:{' '}
              </strong>
              {options.advice}
            </p>
          )}
        </section>
      )}
      <p className="pdoc-note">{patientNote(plan)}</p>
      <Translation as="p" className="pdoc-note" text={second ? patientNote(plan, second) : ''} english={patientNote(plan)} lang={lang} />
    </>
  );
}

// ---------- Staff copy ----------

/**
 * Every item of the plan in a table – when, what, its status and the details (result, notes, who moved or added
 * it, the guideline source). The staff copy, and the care plans in the copy of the whole record (RecordCopy.jsx).
 * patient: for the blood group in "Only for Rh-negative mothers" (may be left out).
 */
export function StaffPlanTable({ plan, patient }) {
  const groups = staffCopyGroups(plan);
  return (
    <table className="ptable pdoc-table">
      <thead>
        <tr>
          <th scope="col" className="pdoc-col-when">
            When
          </th>
          <th scope="col">Item</th>
          <th scope="col" className="pdoc-col-status">
            Status
          </th>
          <th scope="col" className="pdoc-col-details">
            Details
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => [
          <tr key={`g-${g.key}`} className="pdoc-group">
            <td colSpan={4}>{g.label}</td>
          </tr>,
          ...g.items.map((it) => {
            const look = statusLook(it, plan);
            const note = statusNote(it, plan, patient);
            return (
              <tr key={it.id}>
                <td className="pdoc-tabular">
                  {staffWhen(it).map((line, i) => (
                    <span key={line} className={i ? 'pdoc-sub' : undefined}>
                      {line}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="pdoc-kind">{ITEM_KIND_LABELS[it.kind] ?? it.kind}</span>
                  {it.name}
                </td>
                <td>
                  {look.word}
                  {note && <span className="pdoc-sub">{note}</span>}
                </td>
                <td>
                  {staffDetails(it).map((line) => (
                    <span key={line} className="pdoc-sub">
                      {line}
                    </span>
                  ))}
                </td>
              </tr>
            );
          }),
        ])}
      </tbody>
    </table>
  );
}

function StaffCopy({ patient, plan }) {
  const t = plan.template ?? {};
  const approval = approvalText(t);
  const risk = patient.risk;
  const riskText = risk?.level
    ? [RISK_LABELS[risk.level] ?? risk.level, (risk.reasons ?? []).map((r) => r.label).join('; ')].filter(Boolean).join(' – ')
    : undefined;
  return (
    <>
      <h1 className="pdoc-title">{planTitle(plan)} – staff copy</h1>
      <PrintFacts
        items={[
          ['Name', patient.fullName],
          ['Age', ageText(patient)],
          ['Patient no.', <span key="mrn" className="pdoc-tabular">{patient.mrn}</span>],
          ...(isAntenatalPlan(plan)
            ? [
                ['EDD', `${formatDate(plan.edd)} (${plan.eddSource === 'scan' ? 'from scan' : 'from LMP'})`],
                ['Today', formatGestation(plan.gestationToday)],
                ['Booked', `${formatDate(plan.bookedOn)}${plan.bookedAt ? ` at ${gaText(plan.bookedAt)}` : ''}`],
              ]
            : [
                [basisText(plan).split(' ')[0], formatDate(plan.startOn ?? plan.dayZero)],
                ['Today', sinceText(plan, plan.gestationToday)],
              ]),
          ['Doctor', patient.assignedDoctorName ?? undefined],
          ['Protocol', `${t.name} – v${t.version} · ${approval?.word ?? ''}`, true],
          ...(riskText ? [['Risk level', riskText, true]] : []),
        ]}
      />
      <p className="pdoc-note">Suggested schedule – the treating doctor decides. Statuses as of {formatDate(plan.today)}.</p>
      <StaffPlanTable plan={plan} patient={patient} />
    </>
  );
}
