import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Mic, Plus, Square, Trash2, Wand2 } from 'lucide-react';
import { Field } from '../../components/ui.jsx';
import { EMPTY_PREGNANCY, HISTORY_LABELS, readSentence } from './historyFormat.js';

// The history-taking sheet (docs/HISTORY_SHEET_LAYOUT.md, layout agreed by the owner on 27 Oct 2026): one page in the
// words of the owner's paper template – five lines with blanks, one more line for infertility (trying to conceive
// since) or postnatal care (delivered on … by …) – a Dictate button for the whole page with a strip showing what was
// heard, and three closed drop-downs with the rest of the history for reference. The record's existing obstetric and
// medical sections sit inside drop-downs 2 and 3 (`obstetric`, `medical`); the allergy answer opens drop-down 3 when
// it is missing at Save (`medicalOpen`).

const L = HISTORY_LABELS;
const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : null;

function Choice({ name, value, options, onChange, label }) {
  return (
    <span className="hs-choice" role="radiogroup" aria-label={label}>
      {Object.entries(options).map(([k, text]) => (
        <label key={k} className={value === k ? 'is-on' : ''}>
          <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} onClick={() => value === k && onChange('')} /> {text}
        </label>
      ))}
    </span>
  );
}

function Select({ id, value, options, onChange, empty = 'Not recorded' }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {Object.entries(options).map(([k, text]) => (
        <option key={k} value={k}>
          {text}
        </option>
      ))}
    </select>
  );
}

/** A drop-down: closed until clicked; opened by itself when something in it needs an answer (`force`). */
function More({ id, title, force = false, children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (force) setOpen(true);
  }, [force]);
  return (
    <section className={`hs-more ${open ? 'is-open' : ''}`}>
      <button type="button" className="hs-more-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronDown className="hs-more-chevron" aria-hidden="true" /> {title}
      </button>
      <div id={id} className="hs-more-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Dictate for the whole page: the browser's own speech recognition (Chrome, Edge), then the sentence is read by rules. */
function useDictation(onHeard) {
  const [on, setOn] = useState(false);
  const rec = useRef(null);
  useEffect(() => () => rec.current?.stop(), []);
  const start = () => {
    if (!SpeechRecognition) return;
    const r = new SpeechRecognition();
    r.lang = 'en-IN';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const text = [...e.results]
        .slice(e.resultIndex)
        .filter((x) => x.isFinal)
        .map((x) => x[0].transcript)
        .join(' ');
      if (text.trim()) onHeard(text.trim());
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  const stop = () => rec.current?.stop();
  return { available: Boolean(SpeechRecognition), on, start, stop };
}

export function HistorySheet({ values: h, set, setPregnancies, fe, careType, age, lmp, onLmp, extraLine, obstetric, medical, medicalOpen = false }) {
  const [heard, setHeard] = useState('');
  const [filled, setFilled] = useState(null); // which blanks the last reading filled
  const apply = (text) => {
    const got = readSentence(text);
    for (const [k, v] of Object.entries(got)) set(k, v);
    setFilled(Object.keys(got));
  };
  const dictation = useDictation((text) => setHeard((cur) => `${cur} ${text}`.trim()));
  const wasOn = useRef(false);
  useEffect(() => {
    // When dictation stops, what was heard fills the blanks
    if (wasOn.current && !dictation.on && heard.trim()) apply(heard);
    wasOn.current = dictation.on;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.on]);
  const row = (i, k) => (e) => setPregnancies(h.pregnancies.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const mark = (k) => (filled?.includes(k) ? ' hs-heard-mark' : '');
  // A drop-down opens by itself when something in it was refused (e.g. words about a baby's sex), so it is seen
  const anyError = (keys) => keys.some((k) => Boolean(fe(`history.${k}`)));

  return (
    <section className="card form-section hs" aria-labelledby="hs-title">
      <div className="hs-top">
        <h2 id="hs-title">History</h2>
        {dictation.available && (
          <button type="button" className={`btn ${dictation.on ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={dictation.on ? dictation.stop : dictation.start}>
            {dictation.on ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />} {dictation.on ? 'Stop' : 'Dictate'}
          </button>
        )}
      </div>

      <div className="hs-heard">
        <label htmlFor="hs-heard-text" className="sr-only">
          What was said
        </label>
        <textarea
          id="hs-heard-text"
          rows={2}
          value={heard}
          onChange={(e) => setHeard(e.target.value)}
          placeholder="Dictate, or type the history as written on the paper: “Patient is … with complaints of … Menstrual history LMP … cycle regular. Married since … Previous deliveries … Any other history …”"
        />
        <button type="button" className="btn btn-link btn-sm" disabled={!heard.trim()} onClick={() => apply(heard)}>
          <Wand2 aria-hidden="true" /> Fill the blanks
        </button>
        {filled && <span className="hs-filled">{filled.length ? `Filled: ${filled.length} blank${filled.length > 1 ? 's' : ''} – check them.` : 'No blank was recognised – fill them by hand.'}</span>}
      </div>

      <div className="hs-lines">
        <p className="hs-line">
          <span className="hs-words">Patient is {age ? `${age} years` : '…'} with complaints of</span>
          <input aria-label="Complaints" className={`hs-blank hs-wide${mark('complaint')}`} value={h.complaint} onChange={(e) => set('complaint', e.target.value)} maxLength={300} />
        </p>
        {fe('history.complaint') && <p className="field-error">{fe('history.complaint')}</p>}

        <p className="hs-line">
          <span className="hs-words">Menstrual history – LMP</span>
          {onLmp ? <input type="date" aria-label="LMP" className="hs-blank" value={lmp} onChange={(e) => onLmp(e.target.value)} /> : <span className="hs-muted">(with the visit)</span>}
          <span className="hs-words">Cycle</span>
          <span className={mark('cycle')}>
            <Choice name="hs-cycle" label="Cycle" value={h.cycle} options={L.CYCLE_KINDS} onChange={(x) => set('cycle', x)} />
          </span>
        </p>

        <p className="hs-line">
          <span className="hs-words">Obstetric history – Married since</span>
          <input aria-label="Married since (years)" inputMode="numeric" className={`hs-blank hs-num${mark('marriedSinceYears')}`} value={h.marriedSinceYears} onChange={(e) => set('marriedSinceYears', e.target.value.replace(/\D/g, '').slice(0, 2))} />
          <span className="hs-words">years. Consanguinity</span>
          <span className={mark('consanguinity')}>
            <Choice name="hs-consanguinity" label="Consanguinity" value={h.consanguinity} options={L.YES_NO} onChange={(x) => set('consanguinity', x)} />
          </span>
        </p>
        {fe('history.marriedSinceYears') && <p className="field-error">{fe('history.marriedSinceYears')}</p>}

        <div className="hs-line hs-line-block">
          <label className="hs-words" htmlFor="hs-deliveries">
            Previous deliveries
          </label>
          <textarea id="hs-deliveries" rows={2} className={`hs-blank hs-wide${mark('previousDeliveries')}`} value={h.previousDeliveries} onChange={(e) => set('previousDeliveries', e.target.value)} maxLength={500} />
        </div>
        {fe('history.previousDeliveries') && <p className="field-error">{fe('history.previousDeliveries')}</p>}

        <div className="hs-line hs-line-block">
          <label className="hs-words" htmlFor="hs-other">
            Any other personal, medical, operative or family history
          </label>
          <textarea id="hs-other" rows={2} className={`hs-blank hs-wide${mark('otherHistory')}`} value={h.otherHistory} onChange={(e) => set('otherHistory', e.target.value)} maxLength={500} />
        </div>
        {fe('history.otherHistory') && <p className="field-error">{fe('history.otherHistory')}</p>}

        {extraLine}
      </div>

      <More id="hs-more-periods" title="More about her periods" force={anyError(['periodsOther', 'menarcheAge', 'cycleLengthDays', 'bleedingDays', 'previousPeriod'])}>
        <div className="form-grid">
          <Field label="Age at first period" id="hs-menarche" error={fe('history.menarcheAge')}>
            <input id="hs-menarche" inputMode="numeric" value={h.menarcheAge} onChange={(e) => set('menarcheAge', e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </Field>
          <Field label="Period before the LMP" id="hs-prevperiod" error={fe('history.previousPeriod')}>
            <input id="hs-prevperiod" type="date" value={h.previousPeriod} onChange={(e) => set('previousPeriod', e.target.value)} />
          </Field>
          <Field label="Cycle length (days)" id="hs-cyclelen" error={fe('history.cycleLengthDays')}>
            <input id="hs-cyclelen" inputMode="numeric" value={h.cycleLengthDays} onChange={(e) => set('cycleLengthDays', e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          <Field label="Days of bleeding" id="hs-bleeding" error={fe('history.bleedingDays')}>
            <input id="hs-bleeding" inputMode="numeric" value={h.bleedingDays} onChange={(e) => set('bleedingDays', e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </Field>
          <Field label="Amount" id="hs-flow">
            <Select id="hs-flow" value={h.flow} options={L.FLOW} onChange={(x) => set('flow', x)} />
          </Field>
          <Field label="Pain" id="hs-pain">
            <Select id="hs-pain" value={h.pain} options={L.PERIOD_PAIN} onChange={(x) => set('pain', x)} />
          </Field>
          <Field label="LMP date certain" id="hs-lmpcertain">
            <Select id="hs-lmpcertain" value={h.lmpCertain} options={L.YES_NO} onChange={(x) => set('lmpCertain', x)} />
          </Field>
        </div>
        <Field label="Anything else about her periods" id="hs-periods-other" error={fe('history.periodsOther')}>
          <input id="hs-periods-other" value={h.periodsOther} onChange={(e) => set('periodsOther', e.target.value)} maxLength={200} />
        </Field>
      </More>

      <More id="hs-more-obstetric" title="More: G P L A, each pregnancy, problems, contraception" force={anyError(['contraception', 'pregnancies'])}>
        {obstetric}
        <fieldset className="fieldset">
          <legend>Each previous pregnancy</legend>
          {h.pregnancies.length > 0 && (
            <div className="table-scroll">
              <table className="hs-table">
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Weeks</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Place</th>
                    <th scope="col">Baby's weight (g)</th>
                    <th scope="col">Alive now</th>
                    <th scope="col">Problems</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {h.pregnancies.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input aria-label={`Year of pregnancy ${i + 1}`} inputMode="numeric" className="hs-num" value={r.year} onChange={row(i, 'year')} maxLength={4} />
                      </td>
                      <td>
                        <Select id={`hs-p${i}-outcome`} value={r.outcome} options={L.PREGNANCY_OUTCOMES} onChange={(x) => setPregnancies(h.pregnancies.map((y, j) => (j === i ? { ...y, outcome: x } : y)))} empty="–" />
                      </td>
                      <td>
                        <input aria-label={`Weeks of pregnancy ${i + 1}`} inputMode="numeric" className="hs-num" value={r.weeks} onChange={row(i, 'weeks')} maxLength={2} />
                      </td>
                      <td>
                        <Select id={`hs-p${i}-mode`} value={r.mode} options={L.BIRTH_MODES} onChange={(x) => setPregnancies(h.pregnancies.map((y, j) => (j === i ? { ...y, mode: x } : y)))} empty="–" />
                      </td>
                      <td>
                        <input aria-label={`Place of pregnancy ${i + 1}`} value={r.place} onChange={row(i, 'place')} maxLength={80} />
                      </td>
                      <td>
                        <input aria-label={`Baby's weight, pregnancy ${i + 1}`} inputMode="numeric" className="hs-num" value={r.weightGrams} onChange={row(i, 'weightGrams')} maxLength={4} />
                      </td>
                      <td>
                        <Select id={`hs-p${i}-alive`} value={r.aliveNow} options={L.YES_NO} onChange={(x) => setPregnancies(h.pregnancies.map((y, j) => (j === i ? { ...y, aliveNow: x } : y)))} empty="–" />
                      </td>
                      <td>
                        <input aria-label={`Problems in pregnancy ${i + 1}`} value={r.problems} onChange={row(i, 'problems')} maxLength={200} />
                      </td>
                      <td>
                        <button type="button" className="icon-btn" aria-label={`Remove pregnancy ${i + 1}`} onClick={() => setPregnancies(h.pregnancies.filter((_, j) => j !== i))}>
                          <Trash2 aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fe('history.pregnancies') && <p className="field-error">{fe('history.pregnancies')}</p>}
          {h.pregnancies.length < 15 && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setPregnancies([...h.pregnancies, { ...EMPTY_PREGNANCY }])}>
              <Plus aria-hidden="true" /> Add a previous pregnancy
            </button>
          )}
        </fieldset>
        <Field label="Contraception used before, and when stopped" id="hs-contraception" error={fe('history.contraception')}>
          <input id="hs-contraception" value={h.contraception} onChange={(e) => set('contraception', e.target.value)} maxLength={150} />
        </Field>
      </More>

      <More id="hs-more-medical" title="More: conditions, operations, medicines, allergies, immunisation, blood group, family, personal" force={medicalOpen || anyError(['operations', 'currentMedicines', 'familyWho', 'occupation', 'sleepAppetite', 'bowelBladder'])}>
        {medical}
        <div className="form-grid">
          <Field label="Operations, with the year" id="hs-operations" error={fe('history.operations')}>
            <input id="hs-operations" value={h.operations} onChange={(e) => set('operations', e.target.value)} maxLength={300} />
          </Field>
          <Field label="Blood transfusion before" id="hs-transfusion">
            <Select id="hs-transfusion" value={h.transfusion} options={L.YES_NO} onChange={(x) => set('transfusion', x)} />
          </Field>
          <Field label="Current medicines" id="hs-medicines" error={fe('history.currentMedicines')}>
            <input id="hs-medicines" value={h.currentMedicines} onChange={(e) => set('currentMedicines', e.target.value)} maxLength={300} />
          </Field>
        </div>
        <fieldset className="fieldset">
          <legend>Immunisation</legend>
          <div className="form-grid">
            {[
              ['td', 'Td (tetanus–diphtheria)'],
              ['rubella', 'Rubella'],
              ['hepB', 'Hepatitis B'],
            ].map(([k, label]) => (
              <Field key={k} label={label} id={`hs-${k}`}>
                <Select id={`hs-${k}`} value={h[k]} options={L.IMMUNISATION_STATUS} onChange={(x) => set(k, x)} />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>Family history</legend>
          <div className="check-grid">
            {Object.entries(L.FAMILY_HISTORY).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={h.family.includes(k)} onChange={() => set('family', h.family.includes(k) ? h.family.filter((x) => x !== k) : [...h.family, k])} /> {label}
              </label>
            ))}
          </div>
          <Field label="Who in the family" id="hs-family-who" error={fe('history.familyWho')}>
            <input id="hs-family-who" value={h.familyWho} onChange={(e) => set('familyWho', e.target.value)} maxLength={200} placeholder="e.g. mother – diabetes" />
          </Field>
        </fieldset>
        <fieldset className="fieldset">
          <legend>Personal</legend>
          <div className="form-grid">
            <Field label="Diet" id="hs-diet">
              <Select id="hs-diet" value={h.diet} options={L.DIETS} onChange={(x) => set('diet', x)} />
            </Field>
            <Field label="Tobacco" id="hs-tobacco">
              <Select id="hs-tobacco" value={h.tobacco} options={L.HABIT} onChange={(x) => set('tobacco', x)} />
            </Field>
            <Field label="Alcohol" id="hs-alcohol">
              <Select id="hs-alcohol" value={h.alcohol} options={L.HABIT} onChange={(x) => set('alcohol', x)} />
            </Field>
            <Field label="Occupation" id="hs-occupation" error={fe('history.occupation')}>
              <input id="hs-occupation" value={h.occupation} onChange={(e) => set('occupation', e.target.value)} maxLength={80} />
            </Field>
            <Field label="Sleep and appetite" id="hs-sleep" error={fe('history.sleepAppetite')}>
              <input id="hs-sleep" value={h.sleepAppetite} onChange={(e) => set('sleepAppetite', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Bowel and bladder" id="hs-bowel" error={fe('history.bowelBladder')}>
              <input id="hs-bowel" value={h.bowelBladder} onChange={(e) => set('bowelBladder', e.target.value)} maxLength={120} />
            </Field>
          </div>
        </fieldset>
      </More>
      {careType === 'antenatal' && <p className="hint hs-note">The details of this pregnancy (scan EDD, planned, conception, folic acid, medicines and symptoms so far) are recorded at the visit.</p>}
    </section>
  );
}
