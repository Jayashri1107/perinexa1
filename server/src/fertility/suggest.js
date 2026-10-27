// Which protocols fit this patient (docs/FERTILITY_PLAN.md – approved 27 Oct 2026): read from her record – age, BMI, the
// medical background, the obstetric counts and the fertility history – and written as plain reasons the doctor can
// check. Nothing here decides: the doctor picks the protocols, and the plan built from them is edited by hand.
// Rules follow the bodies the library cites (fertility/protocols.js). A record with little recorded gets the
// Evaluation protocol and a list of what is missing, not a treatment.

import { currentAge } from '../models/Patient.js';
import { fertilityEmpty } from './fertilityFields.js';
import { FERTILITY_LIBRARY_VERSION, PROTOCOLS } from './protocols.js';

export const FITS = ['recommended', 'consider', 'other'];
const RANK = { recommended: 3, consider: 2, other: 1 };
const round1 = (n) => Math.round(n * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** What the rules know about her, in one place, with the facts still missing for a confident suggestion. */
export function fertilityFacts(patient, now = new Date()) {
  const f = patient.fertility?.toObject?.() ?? patient.fertility ?? null;
  const m = patient.medical?.toObject?.() ?? patient.medical ?? {};
  const age = currentAge(patient, now);
  const bmi = isNum(m.heightCm) && isNum(m.weightKg) && m.heightCm > 0 ? round1(m.weightKg / (m.heightCm / 100) ** 2) : null;
  const pick = (k) => f?.[k] ?? '';
  const n = (k) => (isNum(f?.[k]) ? f[k] : null);
  const facts = {
    recorded: !fertilityEmpty(f),
    age,
    partnerAge: n('partnerAgeYears'),
    bmi,
    durationMonths: n('durationMonths'),
    type: pick('type'),
    cycle: pick('cycle'),
    ovulation: pick('ovulation'),
    tubes: pick('tubes'),
    uterus: pick('uterus'),
    endometriosis: pick('endometriosis'),
    semen: pick('semen'),
    diagnoses: f?.diagnoses ?? [],
    amh: n('amh'),
    afc: n('afc'),
    fsh: n('fsh'),
    prolactin: n('prolactin'),
    tsh: n('tsh'),
    oiCycles: n('oiCycles') ?? 0,
    iuiCycles: n('iuiCycles') ?? 0,
    ivfCycles: n('ivfCycles') ?? 0,
    conditions: m.conditions ?? [],
    abortions: isNum(patient.obstetric?.abortions) ? patient.obstetric.abortions : null,
    missing: [],
  };
  const miss = (key, label) => facts.missing.push({ key, label });
  if (age == null) miss('age', 'her age');
  if (facts.durationMonths == null) miss('duration', 'how long the couple has been trying');
  // No periods, or a diagnosis that means anovulation, answers the ovulation question without a progesterone test
  const anovulationKnown = facts.cycle === 'amenorrhoea' || facts.diagnoses.some((d) => ['pcos', 'hypogonadotropic', 'poi', 'hyperprolactinaemia'].includes(d));
  if ((!facts.ovulation || facts.ovulation === 'not_tested') && !anovulationKnown) miss('ovulation', 'ovulation (mid-luteal progesterone or scan)');
  if (!facts.tubes || facts.tubes === 'not_tested') miss('tubes', 'tubal patency (HSG, HyCoSy or laparoscopy)');
  if (!facts.semen || facts.semen === 'not_tested') miss('semen', "the partner's semen analysis");
  if (bmi == null) miss('bmi', 'her height and weight (BMI)');
  return facts;
}

const has = (facts, d) => facts.diagnoses.includes(d);

/**
 * The protocols for this patient, best fit first: { key, fit, reasons, cautions }, one entry per protocol in the
 * library (the rest as 'other'), with the facts they were read from.
 */
export function suggestProtocols(patient, now = new Date()) {
  const x = fertilityFacts(patient, now);
  const picked = new Map();
  const entry = (key) => {
    if (!picked.has(key)) picked.set(key, { fit: 'other', reasons: [], cautions: [] });
    return picked.get(key);
  };
  const add = (key, fit, reason) => {
    const e = entry(key);
    if (RANK[fit] > RANK[e.fit]) e.fit = fit;
    if (reason && !e.reasons.includes(reason)) e.reasons.push(reason);
  };
  const caution = (key, text) => {
    const e = entry(key);
    if (!e.cautions.includes(text)) e.cautions.push(text);
  };

  const age = x.age;
  const anovulatory = x.ovulation === 'anovulation' || x.cycle === 'irregular' || x.cycle === 'amenorrhoea' || has(x, 'pcos') || has(x, 'hypogonadotropic') || has(x, 'poi') || has(x, 'hyperprolactinaemia');
  const tubesBlocked = x.tubes === 'both_blocked' || x.tubes === 'hydrosalpinx';
  const tubesOpen = x.tubes === 'patent_both' || x.tubes === 'one_blocked';
  const semenSevere = x.semen === 'severe_abnormal' || x.semen === 'azoospermia';
  const semenOk = x.semen === 'normal' || x.semen === 'mild_abnormal';
  const lowReserve = has(x, 'diminished_reserve') || (x.amh != null && x.amh < 1) || (x.afc != null && x.afc <= 5) || (x.fsh != null && x.fsh >= 10 && x.fsh < 25);
  const older = age != null && age >= 38;
  const months = x.durationMonths;

  // 0. Nothing or little recorded: evaluate first
  if (!x.recorded) {
    add('evaluation', 'recommended', 'Her fertility history is not entered yet – the plan can only be the evaluation of the couple until ovulation, tubes and semen are known.');
  } else if (x.missing.some((m) => ['ovulation', 'tubes', 'semen'].includes(m.key))) {
    const what = x.missing.filter((m) => ['ovulation', 'tubes', 'semen'].includes(m.key)).map((m) => m.label);
    add('evaluation', 'recommended', `Still to be tested: ${what.join('; ')} (WHO 2025, NICE 2026 – the diagnosis needs all three).`);
  }
  if (months != null && months < 12 && (age == null || age < 36) && !anovulatory && !tubesBlocked && !semenSevere && x.endometriosis !== 'moderate_severe') {
    add('preconception', 'recommended', `Trying for ${months} months: WHO 2025 and NICE 2026 investigate after 12 months unless she is 36 or older or a cause is known.`);
    if (x.recorded) add('evaluation', 'consider', 'Can start now if the couple wish, or at 12 months.');
  }
  if (x.tsh != null && x.tsh > 4) caution('evaluation', `TSH ${x.tsh} mIU/L: thyroid review and treatment before ovulation induction or ART (ESHRE 2023 GPP 27; doctor to confirm the target).`);
  if (x.conditions.includes('tuberculosis')) {
    add('tubal', 'consider', 'Tuberculosis in the medical background: genital TB is a common cause of tubal and endometrial damage in India – exclude it before ART (FOGSI practice).');
    caution('evaluation', 'Tuberculosis in the medical background – consider endometrial sampling for genital TB (doctor to confirm).');
  }
  if (has(x, 'genital_tb')) add('tubal', 'consider', 'Genital tuberculosis diagnosed: complete treatment before ART and assess the tubes and endometrium (doctor to confirm).');

  // 1. Ovulation problems
  if (has(x, 'hyperprolactinaemia') || (x.prolactin != null && x.prolactin > 25)) {
    add('hyperprolactinaemia', 'recommended', has(x, 'hyperprolactinaemia') ? 'Hyperprolactinaemia recorded: cabergoline rather than bromocriptine (WHO 2025; NICE 2026).' : `Prolactin ${x.prolactin} ng/mL is above about 25 ng/mL (check the lab’s range): cabergoline rather than bromocriptine (WHO 2025; NICE 2026).`);
  }
  const poi = has(x, 'poi') || (age != null && age < 40 && x.cycle === 'amenorrhoea' && x.fsh != null && x.fsh >= 25);
  if (poi) {
    add('poi', 'recommended', has(x, 'poi') ? 'Premature ovarian insufficiency recorded (ESHRE/ASRM/IMS 2024).' : `Amenorrhoea with FSH ${x.fsh} IU/L before 40 suggests premature ovarian insufficiency – confirm as the 2024 guideline advises.`);
    add('donor', 'consider', 'Oocyte donation is the established route to pregnancy in premature ovarian insufficiency (NICE 1.52.1; ART Act).');
  }
  if (has(x, 'hypogonadotropic')) {
    add('oi_group1', 'recommended', 'Hypogonadotropic hypogonadism (WHO group I): pulsatile GnRH or gonadotrophins with LH activity; letrozole and clomiphene do not work (NICE 2026 1.30).');
  }
  if (anovulatory && !has(x, 'hypogonadotropic') && !poi) {
    const why = has(x, 'pcos') ? 'PCOS with anovulation' : x.ovulation === 'anovulation' ? 'Anovulation recorded' : `${x.cycle === 'amenorrhoea' ? 'Amenorrhoea' : 'Irregular cycles'} recorded`;
    if (tubesBlocked) {
      add('ivf', 'recommended', `${why}, but both tubes are blocked or damaged: ovulation induction alone cannot work – IVF (WHO 2025).`);
    } else if (semenSevere) {
      add('ivf', 'recommended', `${why} with a severe male factor: ovulation induction alone cannot work – ICSI (NICE 2026 1.50).`);
      add('oi_letrozole', 'consider', 'Oral induction may still be used to regulate cycles or alongside ICSI planning.');
    } else if (x.oiCycles >= 6) {
      add('oi_gonadotrophins', 'recommended', `${why} and ${x.oiCycles} induction cycles already done: oral induction is not continued beyond six ovulatory cycles – gonadotrophins (WHO 2025 prefers them over drilling; PCOS 2023 second line).`);
      add('los', 'consider', 'Laparoscopic ovarian surgery is the other second-line option in resistant PCOS (PCOS 2023).');
      add('ivf', 'consider', 'IVF is the third line after failed induction (PCOS 2023; WHO 2025).');
    } else {
      const done = x.oiCycles > 0 ? ` ${x.oiCycles} induction cycle${x.oiCycles === 1 ? '' : 's'} done – up to six ovulatory cycles in all.` : '';
      add('oi_letrozole', 'recommended', `${why}: letrozole first line (PCOS 2023; WHO 2025; FOGSI 2024), clomiphene with metformin where letrozole is not permitted.${done}`);
      if (x.oiCycles >= 3) add('oi_gonadotrophins', 'consider', 'Review the response after three cycles; gonadotrophins are the next step (PCOS 2023).');
      if (x.tubes === 'not_tested' || !x.tubes) caution('oi_letrozole', 'Tubal patency is not yet known: decide case by case whether to test the tubes before induction (PCOS 2023 5.2.1).');
      if (x.semen === 'not_tested' || !x.semen) caution('oi_letrozole', 'The partner’s semen analysis is not yet recorded: needed before induction cycles are spent.');
    }
    if (x.bmi != null && x.bmi >= 30) caution('oi_letrozole', `BMI ${x.bmi}: lifestyle and weight management first and alongside – a 5–10 % loss can restore ovulation (PCOS 2023; WHO 2025).`);
  }

  // 2. Tubal factor
  if (x.tubes === 'hydrosalpinx') {
    add('tubal', 'recommended', 'Hydrosalpinx: salpingectomy or tubal occlusion before IVF, not aspiration (WHO 2025; NICE 2026 1.34.3).');
    add('ivf', 'recommended', 'IVF after the hydrosalpinx is dealt with (WHO 2025).');
  } else if (x.tubes === 'both_blocked') {
    if (age != null && age < 35) {
      add('tubal', 'recommended', `Both tubes blocked at ${age}: tubal surgery for mild–moderate disease where the expertise exists, IVF for severe disease (WHO 2025).`);
      add('ivf', 'consider', 'IVF when the disease is severe, after failed surgery, or after 1 year without pregnancy (WHO 2025).');
    } else {
      add('ivf', 'recommended', `Both tubes blocked${age != null ? ` at ${age}` : ''}: IVF rather than surgery from 35 (WHO 2025).`);
      add('tubal', 'consider', 'Tubal surgery only in a selected case (mild disease, strong preference); a proximal block can be catheterised (NICE 2026 1.34.2).');
    }
  } else if (x.tubes === 'one_blocked') {
    add('tubal', 'consider', 'One tube blocked: ovulation induction or IUI can be tried for a limited time with the patent tube; a proximal block can be catheterised (NICE 2026 1.34.2).');
  }

  // 3. Male factor
  if (x.semen === 'azoospermia') {
    add('male_severe', 'recommended', 'Azoospermia: hormonal and genetic work-up, obstructive versus non-obstructive, surgical sperm retrieval with ICSI (NICE 2026 1.25).');
    add('donor', 'consider', 'Donor sperm through a registered ART bank if retrieval is unsuitable or fails (NICE 1.51; ART Act).');
    add('ivf', 'consider', 'ICSI with retrieved sperm – her side is prepared in parallel.');
  } else if (x.semen === 'severe_abnormal') {
    add('male_severe', 'recommended', 'Severe semen abnormality: andrology work-up and ICSI (NICE 2026 1.50.2).');
    add('ivf', 'recommended', 'ICSI is indicated by the severity of the semen findings (NICE 2026 1.50).');
  } else if (x.semen === 'mild_abnormal') {
    add('male_mild', 'recommended', 'Semen below the WHO 2021 limits: repeat after 3 months, examine, treat a varicocele when trying naturally, no empirical drugs or supplements (WHO 2025; NICE 2026).');
    if (tubesOpen && !anovulatory) add('iui', 'consider', 'Mild male factor with patent tubes: IUI with ovarian stimulation for 3–4 cycles before ICSI (NICE 2026).');
  }
  if (has(x, 'varicocele') && (x.semen === 'mild_abnormal' || x.semen === 'severe_abnormal')) {
    add('male_mild', 'recommended', 'Clinical varicocele with abnormal semen: repair rather than waiting, in a couple not going straight to ART (WHO 2025; NICE 2026 1.28).');
  }
  if (has(x, 'sexual_difficulty')) add('iui', 'recommended', 'Vaginal intercourse not possible or very difficult: up to 12 cycles of unstimulated IUI before IVF (NICE 2026 1.37.1).');

  // 4. Endometriosis
  if (x.endometriosis === 'minimal_mild') {
    add('endometriosis', 'recommended', 'Minimal–mild endometriosis: surgery or expectant management, then IUI with stimulation before IVF (ESHRE 2022; NICE 2026 1.36).');
  } else if (x.endometriosis === 'moderate_severe') {
    add('endometriosis', 'recommended', 'Moderate–severe endometriosis: ART, especially with compromised tubes, male factor or a low EFI; no routine endometrioma surgery before ART (ESHRE 2022).');
    add('ivf', 'recommended', 'IVF for moderate–severe endometriosis (ESHRE 2022; NICE 2026 1.36.2).');
  } else if (x.endometriosis === 'suspected') {
    add('endometriosis', 'consider', 'Endometriosis suspected: laparoscopy and dye assesses tubes and pelvis together (NICE 2026 1.18.15).');
  }

  // 5. Uterine factor
  if (['septum', 'submucous_fibroid', 'polyp', 'adhesions', 'other'].includes(x.uterus)) {
    const words = { septum: 'Uterine septum: no resection for infertility alone (WHO 2025).', submucous_fibroid: 'Submucous fibroid: hysteroscopic removal may improve conception (ASRM 2017).', polyp: 'Endometrial polyp: hysteroscopic removal (ASRM 2017).', adhesions: 'Intrauterine adhesions: hysteroscopic adhesiolysis (NICE 2026 1.35.1).', other: 'Uterine finding recorded: define the cavity with SIS or 3D ultrasound (WHO 2025).' };
    add('uterine', 'recommended', words[x.uterus]);
  }

  // 6. Unexplained infertility
  const unexplained = x.ovulation === 'confirmed' && x.tubes === 'patent_both' && x.semen === 'normal' && ['', 'none'].includes(x.endometriosis) && ['', 'normal', 'not_assessed'].includes(x.uterus) && !anovulatory;
  if (unexplained && (months == null || months >= 12)) {
    add('unexplained', 'recommended', 'Ovulation confirmed, both tubes patent, normal semen: unexplained infertility – expectant management, then stimulated IUI, then IVF (WHO 2025; ESHRE 2023; NICE 2026).');
    const poorPrognosis = (age != null && age >= 35) || (months != null && months >= 36) || x.iuiCycles > 0 || x.type === 'primary' && months != null && months >= 24;
    if (x.iuiCycles >= 3) {
      add('ivf', 'recommended', `${x.iuiCycles} IUI cycles done without pregnancy: IVF rather than more expectant management, without ICSI (WHO 2025; ESHRE 2023).`);
    } else if (poorPrognosis) {
      add('iui', 'recommended', `Prognosis for natural conception is lower${age != null && age >= 35 ? ` at ${age}` : ''}${months != null && months >= 36 ? ` after ${months} months` : ''}: stimulated IUI with letrozole or clomiphene for 3–6 cycles rather than more waiting (WHO 2025; ESHRE 2023 GPP 37).`);
    } else {
      add('iui', 'consider', 'After 3–6 months of expectant management: stimulated IUI for 3–6 cycles (WHO 2025).');
    }
    if (age != null && age >= 40) add('ivf', 'recommended', `At ${age} the stepped pathway is shortened: IVF without ICSI is the effective step (WHO 2025; NICE 2026).`);
  }

  // 6b. Enough IUI cycles, whatever the cause: IVF rather than more IUI (WHO 2025 after failed stimulated IUI; NICE 2026 up to 4 cycles)
  if (x.iuiCycles >= 3 && !tubesBlocked) add('ivf', 'recommended', `${x.iuiCycles} IUI cycles done without pregnancy: IVF rather than more IUI (WHO 2025; NICE 2026 – up to 4 cycles).`);

  // 7. Age and reserve
  if (older || lowReserve) {
    const parts = [];
    if (older) parts.push(`she is ${age}`);
    if (x.amh != null && x.amh < 1) parts.push(`AMH ${x.amh} ng/mL`);
    if (x.afc != null && x.afc <= 5) parts.push(`AFC ${x.afc}`);
    if (x.fsh != null && x.fsh >= 10 && x.fsh < 25) parts.push(`FSH ${x.fsh} IU/L`);
    if (has(x, 'diminished_reserve')) parts.push('low reserve recorded');
    add('dor', age != null && age >= 40 || (x.amh != null && x.amh < 1) ? 'recommended' : 'consider', `Time matters – ${parts.join(', ')}: shorten every step, counsel on realistic chances and the donor route (WHO 2025; NICE 2026).`);
    if (age != null && age >= 40 && !poi) add('ivf', 'consider', 'IVF is usually the effective step from 40; NICE funds one cycle at 40–41 and none from 42 (NICE 2026 1.39.9).');
  } else if (age != null && age >= 35 && months != null && months >= 12) {
    add('dor', 'consider', `At ${age} the waiting periods are shortened and ovarian reserve (AMH or AFC) guides counselling (NICE 2026 1.18.4).`);
  }
  if (age != null && age > 50) for (const k of ['ivf', 'donor', 'dor', 'iui']) caution(k, `At ${age} she is above the ART Act’s upper age of 50 for a woman receiving ART – treatment under the Act is not possible (doctor to confirm the legal position).`);
  if (x.partnerAge != null && x.partnerAge > 55) for (const k of ['ivf', 'donor']) caution(k, `The partner is ${x.partnerAge}, above the ART Act’s upper age of 55 for a man – doctor to confirm the legal position.`);
  if (age != null && age < 21) for (const k of ['ivf', 'iui']) caution(k, 'Under 21: the ART Act allows ART only from 21 for a woman.');

  // 8. Recurrent pregnancy loss
  if (x.abortions != null && x.abortions >= 2) {
    add('rpl', x.abortions >= 3 ? 'recommended' : 'consider', `${x.abortions} pregnancy losses recorded: the recurrent-loss work-up (ESHRE 2022) – antiphospholipid antibodies, thyroid, 3D scan of the uterus.`);
  }

  // 9. Previous IVF
  if (x.ivfCycles > 0) add('ivf', 'consider', `${x.ivfCycles} IVF or ICSI cycle${x.ivfCycles === 1 ? '' : 's'} done: review the response and embryo quality before the next; NICE counts 3 full cycles as a course.`);
  if (x.ivfCycles >= 3) add('donor', 'consider', 'Repeated IVF failure with her own oocytes is an indication to discuss donor oocytes (NICE 2026 1.52.1).');

  const options = PROTOCOLS.map((p) => {
    const e = picked.get(p.key);
    return { key: p.key, fit: e?.fit ?? 'other', reasons: e?.reasons ?? [], cautions: e?.cautions ?? [] };
  }).sort((a, b) => RANK[b.fit] - RANK[a.fit]);
  return { facts: x, options, libraryVersion: FERTILITY_LIBRARY_VERSION };
}
