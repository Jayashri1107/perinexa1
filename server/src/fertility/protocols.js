// The fertility treatment protocol library (docs/FERTILITY_PLAN.md) – approved by the owner, a doctor, on 27 Oct 2026.
// Each protocol is a written summary of what the standard bodies recommend for one clinical situation, with its
// sources, so that a doctor can pick one or more for a patient and edit the plan that is built from them
// (fertility/suggest.js chooses which to offer from her record; routes/fertilityPlans.js builds and keeps the plan).
//
// Sources read for the library (24 Oct 2026; approved as written by the owner on 27 Oct 2026):
//   WHO. Guideline for the prevention, diagnosis and treatment of infertility (28 Nov 2025) – 40 recommendations,
//     the summary table in the WHO policy brief. Nearly all are conditional on low or very low certainty evidence.
//   NICE NG257. Fertility problems: assessment and treatment (31 Mar 2026; replaces CG156). Recommendation numbers
//     are NG257's.
//   ESHRE. Unexplained infertility (2023, 52 recommendations); Endometriosis (2022); Recurrent pregnancy loss
//     (update 2022, published Jan 2023); Premature ovarian insufficiency with ASRM, IMS and CRE-WHiRL (2024);
//     Ovarian stimulation for IVF/ICSI (2019, update 2025) – referred to by NICE for stimulation.
//   International evidence-based guideline for the assessment and management of PCOS (Teede et al., 2023; endorsed
//     by ESHRE and ASRM) – chapter 5, infertility.
//   FOGSI. Focus – PCOS practice points: PCOS and infertility (Nov 2024); Focus on ovulation induction and IUI (2014)
//     and on IUI (2010). ICMR national guidelines for ART clinics (2005) as far as the ART Act did not replace them.
//   WHO laboratory manual for the examination and processing of human semen, 6th edition (2021) – lower reference
//     limits as NICE NG257 1.17.1 quotes them.
//   ASRM / AUA practice documents (male infertility 2020–2021; uterine myomas 2017; embryo numbers 2021).
//     EAU guidelines on sexual and reproductive health – male infertility (2025).
//   India: Assisted Reproductive Technology (Regulation) Act 2021, ART Rules 2022, ART Regulations 2023 (embryo and
//     oocyte limits), Surrogacy (Regulation) Act 2021, PC-PNDT Act 1994.
// Regimens (doses, days, numbers of cycles) that the guideline texts do not spell out are marked "doctor to confirm":
// they describe common practice, not a recommendation of the body cited.
//
// Words: doctor to doctor, as in docs/BRAND.md. Nothing here names the sex of a child, and no protocol is for sex
// selection (PC-PNDT Act). The protocols are not care-plan templates: they produce one editable text plan per patient.

// Plans built before the approval keep their stamp 'draft-2026-10-24'
export const FERTILITY_LIBRARY_VERSION = '2026-10-27';
export const LIBRARY_NOTE =
  'Protocol library approved by the hospital’s doctor on 27 Oct 2026 – drawn from published guidance (WHO 2025, NICE 2026, ESHRE, the 2023 PCOS guideline, FOGSI, the ART Act). Doses and days marked “doctor to confirm” are common practice, not a recommendation of the body cited. Every regimen and every step is the treating doctor’s decision.';

// The sections of a plan, in the order they are shown. `general` is the shared preconception advice, added to every plan.
export const SECTION_ORDER = [
  { key: 'aim', title: 'Aim and basis' },
  { key: 'investigations', title: 'Investigations' },
  { key: 'treatment', title: 'Treatment steps' },
  { key: 'medicines', title: 'Medicines and doses' },
  { key: 'monitoring', title: 'Monitoring and safety' },
  { key: 'review', title: 'Review and next step' },
  { key: 'counselling', title: 'What to explain to the couple' },
  { key: 'general', title: 'General advice for the couple' },
];
export const SECTION_KEYS = SECTION_ORDER.map((s) => s.key);

// The bodies and documents cited, by short key. `label` is the tag shown on screen.
export const BODIES = {
  who2025: { label: 'WHO 2025', title: 'WHO guideline for the prevention, diagnosis and treatment of infertility (Nov 2025)' },
  nice2026: { label: 'NICE NG257 2026', title: 'NICE guideline NG257 Fertility problems: assessment and treatment (Mar 2026)' },
  eshreUi2023: { label: 'ESHRE 2023', title: 'ESHRE evidence-based guideline: unexplained infertility (2023)' },
  eshreEndo2022: { label: 'ESHRE endometriosis 2022', title: 'ESHRE guideline: endometriosis (2022)' },
  eshreRpl2022: { label: 'ESHRE RPL 2022', title: 'ESHRE guideline: recurrent pregnancy loss (update 2022)' },
  eshrePoi2024: { label: 'ESHRE/ASRM/IMS POI 2024', title: 'Evidence-based guideline: premature ovarian insufficiency (ESHRE, ASRM, IMS, CRE-WHiRL, 2024)' },
  eshreOs2025: { label: 'ESHRE stimulation 2025', title: 'ESHRE guideline: ovarian stimulation for IVF/ICSI (2019, update 2025)' },
  pcos2023: { label: 'PCOS guideline 2023', title: 'International evidence-based guideline for the assessment and management of PCOS (2023), chapter 5' },
  fogsi2024: { label: 'FOGSI 2024', title: 'FOGSI Focus – PCOS practice points: PCOS and infertility (2024)' },
  fogsiIui: { label: 'FOGSI IUI', title: 'FOGSI Focus on ovulation induction and IUI (2014) and on intrauterine insemination (2010)' },
  whoSemen2021: { label: 'WHO semen manual 2021', title: 'WHO laboratory manual for the examination and processing of human semen, 6th edition (2021)' },
  asrm: { label: 'ASRM', title: 'ASRM practice committee documents (female evaluation 2021; AUA/ASRM male infertility 2020–2021; myomas 2017; embryo numbers 2021)' },
  eau2025: { label: 'EAU 2025', title: 'EAU guidelines on sexual and reproductive health: male infertility (2025 update)' },
  artAct: { label: 'ART Act 2021', title: 'Assisted Reproductive Technology (Regulation) Act 2021, ART Rules 2022 and ART Regulations 2023 (India)' },
};

export const GROUPS = {
  evaluation: 'Evaluation and preconception care',
  ovulation: 'Ovulation problems',
  factor: 'Tubal, uterine and endometriosis',
  male: 'Male factor',
  unexplained: 'Unexplained infertility',
  art: 'IUI, IVF and ICSI',
  other: 'Pregnancy loss, preservation and donors',
};

const FOLIC = 'Folic acid 400 micrograms daily from now; 5 mg daily with a BMI over 30, diabetes, epilepsy medicines or a previous neural-tube defect (NICE antenatal guidance; PCOS 2023 5.1.2 – doctor to confirm).';

// The shared "general advice" section, added once to every plan (and the whole of the preconception protocol).
export const GENERAL_ADVICE = [
  'Intercourse every 2–3 days through the cycle; ovulation kits and strict timing are not needed (NICE NG257 1.5.1).',
  'Weight: a BMI of 30 or more lengthens the time to conceive and lowers treatment success – a weight programme before or alongside treatment; a BMI under 18.5 can stop ovulation (NICE 1.9–1.10; PCOS 2023 5.1; WHO 2025 lifestyle advice).',
  'Stop smoking, both partners – brief advice at every visit (WHO 2025, strong); alcohol none or very little for her, within low-risk limits for him (NICE 1.6–1.7).',
  FOLIC,
  'Rubella immunity checked and the susceptible vaccinated (no pregnancy for 1 month after); cervical screening up to date; thyroid disease and diabetes controlled before conception (NICE 1.20–1.21; ESHRE 2023 GPP 27).',
  'Avoid testicular heat (tight underwear, long hot baths), anabolic steroids and recreational drugs; ask about occupational exposures and medicines of both partners (NICE 1.11–1.13).',
  'No evidence for complementary therapies, antioxidant supplements, inositol or acupuncture to improve conception (NICE 1.14; ESHRE 2023 rec. 46–49).',
  'Psychological support is offered to both partners before, during and after treatment (WHO 2025 good practice; NICE 1.2).',
];

export const PROTOCOLS = [
  {
    key: 'evaluation',
    name: 'Evaluation of the couple before treatment',
    short: 'Evaluation',
    group: 'evaluation',
    summary: 'The first work-up of both partners – ovulation, tubes, uterus and semen – with the tests the guidelines advise and the ones they advise against.',
    whenToUse: 'Any couple not yet fully investigated: after 12 months of trying, or at once when she is 36 or older or a cause is known.',
    bodies: ['who2025', 'nice2026', 'eshreUi2023', 'whoSemen2021', 'pcos2023'],
    cautions: [],
    sections: {
      aim: [
        'Find the treatable cause – ovulation, tubes, uterus, semen – with the fewest tests that change management. The Care plan tab holds the dated evaluation checklist; this plan records the decisions.',
        'Investigate after 12 months of regular unprotected intercourse; sooner when she is 36 or older, when either partner has a known cause or risk factor, or when cycles are irregular (WHO 2025 definition; NICE NG257 1.16.5, 1.16.8). From 35, many bodies investigate after 6 months (ASRM).',
      ],
      investigations: [
        'Her – ovulation: mid-luteal serum progesterone (about 7 days before the expected period), even with regular cycles; a low value is repeated in another cycle before anovulation is diagnosed (WHO 2025; NICE 1.18.7). Basal temperature charts are not used (NICE 1.18.9).',
        'Her – irregular or absent periods: FSH and LH, with oestradiol and testosterone where the picture suggests it; TSH and prolactin only with an ovulatory disorder, galactorrhoea or thyroid symptoms (WHO 2025 good practice; NICE 1.18.10–1.18.12).',
        'Her – ovarian reserve: age is the main predictor; AMH or antral follicle count predicts the response to stimulation, not the chance of natural pregnancy; day 2–3 FSH is not used to predict IVF outcome (WHO 2025; NICE 1.18.2–1.18.5).',
        'Her – tubes: HSG or HyCoSy when there is no comorbidity; laparoscopy and dye when PID, ectopic pregnancy or endometriosis is suspected, so other pelvic disease is seen at the same time (WHO 2025; NICE 1.18.13–1.18.15). Chlamydia screening, or prophylactic antibiotics, before any uterine instrumentation (NICE 1.22).',
        'Her – uterus: pelvic ultrasound, 3D where available; saline infusion sonography when a cavity problem is suspected; hysteroscopy only for a suspected abnormality (WHO 2025; ESHRE 2023 rec. 10–12; NICE 1.18.16).',
        'Him – semen analysis by WHO 2021 methods; lower reference limits: volume 1.4 mL, concentration 16 million/mL, total 39 million, total motility 42 %, progressive motility 30 %, vitality 54 %, normal forms 4 % (NICE 1.17.1). An abnormal result is repeated after at least 11–12 weeks – at once for azoospermia or severe oligozoospermia; a normal result is not repeated (WHO 2025; NICE 1.17.3–1.17.4).',
        'Both – rubella immunity for her, cervical screening up to date, and screening for HIV, hepatitis B and C before IVF (ordered under the lab’s neutral panel name) (NICE 1.19–1.21).',
        'Not advised routinely: post-coital test, antisperm antibodies, sperm DNA fragmentation, endometrial biopsy, routine thrombophilia or thyroid-antibody screens, routine diagnostic laparoscopy, karyotype or genomic tests for unexplained infertility (ESHRE 2023 rec. 4, 13–14, 17–18, 24–26, 29, 32; NICE 1.17.6).',
        'India: genital tuberculosis is a common cause of tubal and endometrial damage – endometrial sampling for TB PCR, culture and histology when the history, HSG or laparoscopy suggests it, and treatment before ART (FOGSI practice, not covered by WHO or NICE – doctor to confirm).',
      ],
      treatment: ['No treatment starts from this protocol alone. Once ovulation, tubes, uterus and semen are known, press Suggest plans again for the treatment protocols that fit.'],
      medicines: [FOLIC],
      monitoring: ['Day 2–3 bloods and the baseline scan in one early-cycle visit; HSG or HyCoSy on days 6–10 after the period, with no unprotected intercourse that cycle until it is done; semen sample after 2–7 days of abstinence.'],
      review: [
        'Review with both partners and all reports in 4–8 weeks; classify as ovulatory, tubal, uterine, male, endometriosis-related, unexplained or combined, and choose the treatment protocol with the couple.',
        'Diagnose unexplained infertility only when all of these hold: 12 months of trying, normal history and examination in both, ovulation confirmed, patent tubes, semen within the WHO reference ranges (WHO 2025).',
      ],
      counselling: [
        'Over 80 % of couples conceive within a year of regular intercourse and about half of the rest within the second year; her age is the strongest single factor (NICE 1.4–1.5).',
        'Both partners attend; counselling and psychological support are part of care (WHO 2025 good practice; NICE 1.2).',
      ],
    },
  },
  {
    key: 'preconception',
    name: 'Lifestyle and preconception care while trying naturally',
    short: 'Preconception care',
    group: 'evaluation',
    summary: 'The advice every couple gets, and the whole plan for a couple with no cause found who are not yet due for treatment.',
    whenToUse: 'Less than 12 months of trying with a normal history and she is under 36; or alongside any other protocol.',
    bodies: ['who2025', 'nice2026', 'pcos2023', 'eshreUi2023'],
    cautions: [],
    sections: {
      aim: ['Improve the chance of natural conception and of a healthy pregnancy. Nothing in this protocol is a fertility medicine.'],
      treatment: GENERAL_ADVICE.slice(0, 3).concat(GENERAL_ADVICE.slice(5, 7)),
      medicines: [FOLIC, 'Treat overt thyroid disease before conception; glucose (OGTT with PCOS) and blood pressure checked when she has PCOS, diabetes or a BMI over 30 (PCOS 2023 1.9.11, 4.10.6).'],
      review: ['Review at 12 months of trying – or at 6 months from age 35, and at once from 36 or with a known cause – and move to the Evaluation protocol (NICE 1.16; ASRM).'],
      counselling: ['Explain the chance of conception by age, that stress is common but not a proven cause of infertility, and that help is available when the time comes (NICE 1.2, 1.4).'],
    },
  },
  {
    key: 'follicular_study',
    name: 'Follicular study with timed intercourse (natural or stimulated cycle)',
    short: 'Follicular study',
    group: 'ovulation',
    summary: 'Serial scans from day 9–10 to time intercourse to ovulation, in a natural cycle or with letrozole or clomiphene; a decided number of cycles before IUI.',
    whenToUse: 'The first step of the ladder: anovulation or oligo-ovulation on oral induction (the scan confirms the response and sets the dose), or a short, counted trial of timing in a couple whose tests are normal. At least one patent tube and semen that allows natural conception.',
    bodies: ['nice2026', 'who2025', 'pcos2023', 'fogsiIui'],
    cautions: [
      'For unexplained infertility WHO 2025 and NICE 2026 advise against ovarian stimulation with timed intercourse as a stand-alone treatment (NICE NG257 1.38.2): a follicular study is then the monitoring of a natural cycle for a few months, not a treatment, and the next step is stimulated IUI.',
      'Cancel the cycle and advise against unprotected intercourse when more than 2 follicles reach 14 mm (multiple pregnancy) (PCOS 2023 5.5.8).',
    ],
    sections: {
      aim: ['Show whether and when she ovulates, time intercourse to it, and set the induction dose from what the scans show; move to IUI after a counted number of cycles (FOGSI Focus on ovulation induction; NICE NG257 1.33.2 for monitored cycles).'],
      investigations: ['Baseline scan on day 2–3 (no cyst over 20–25 mm, antral follicle count); semen within the WHO ranges or mild changes only; tubal patency known, or decided case by case (PCOS 2023 5.2.1); TSH and prolactin when cycles are irregular.'],
      treatment: [
        'Natural cycle: scans from day 9–10 (earlier in short cycles) every 2–3 days until the dominant follicle is 18–20 mm; intercourse every 1–2 days from a 16 mm follicle, and 24–36 hours after the LH surge or the trigger.',
        'Stimulated cycle: letrozole or clomiphene as in the induction protocol, the scans from day 10–12 confirming one dominant follicle and setting the dose for the next cycle (PCOS 2023; WHO 2025).',
        'Trigger: hCG when the lead follicle is 18 mm or more, or the natural LH surge (urinary LH kit) – the doctor’s choice (doctor to confirm); luteal support with vaginal progesterone is optional in stimulated cycles.',
        'Ovulation confirmed at the next scan (follicle collapse, free fluid, a corpus luteum) or by mid-luteal progesterone; a pregnancy test when the period is 7 days late.',
        'Number of cycles: 3–6, then IUI with stimulation – sooner (after 3) from age 35, with a mild male factor, or when ovulation is confirmed but no pregnancy follows; IVF after IUI (WHO 2025; NICE 2026).',
      ],
      medicines: ['None in a natural cycle. Letrozole 2.5–7.5 mg or clomiphene 50–150 mg daily for 5 days from day 2–5 in a stimulated cycle; hCG 5,000–10,000 IU (250 micrograms recombinant) when triggered; progesterone 200–400 mg vaginally daily for luteal support where chosen (doctor to confirm).'],
      monitoring: [
        'Each scan records the day, every follicle over 10 mm with its size, the endometrial thickness and pattern, and the advice given; the cycle sheet ends with the trigger or surge day and the outcome.',
        'Cancel when more than 2 follicles reach 14 mm; note a thin endometrium (under 7 mm at trigger) or a luteinised unruptured follicle for the next cycle’s plan.',
      ],
      review: ['Review after each cycle; after 3 cycles review the plan with the couple; after 6 cycles (or sooner by age or a male factor) move to IUI – the cycles done are recorded on her record when the plan is switched.'],
      counselling: ['Per-cycle chance about 10–20 % when she ovulates and semen and tubes are normal; the scans add visits and cost; what the study shows (follicle growth, ovulation, endometrium) and what it does not (egg quality, tubal function).'],
    },
  },
  {
    key: 'oi_letrozole',
    name: 'Ovulation induction with letrozole – first line for PCOS and WHO group II',
    short: 'Letrozole induction',
    group: 'ovulation',
    summary: 'Letrozole first; clomiphene with metformin where letrozole is not permitted; oral induction for up to six ovulatory cycles, then the second line.',
    whenToUse: 'Anovulation or oligo-ovulation with normal FSH (PCOS and other WHO group II), at least one patent tube, and semen that allows natural conception.',
    bodies: ['pcos2023', 'who2025', 'fogsi2024', 'nice2026'],
    cautions: [
      'Letrozole is off-label for ovulation induction. In India the drug regulator restricted its infertility indication in 2011 – check the current CDSCO position before prescribing, document the discussion and take written consent (doctor to confirm). WHO 2025: where off-label letrozole is not permitted, clomiphene with metformin is the alternative.',
      'Never give letrozole or clomiphene when a pregnancy is possible: a negative pregnancy test or a withdrawal bleed before each cycle (PCOS 2023 5.3.3).',
    ],
    sections: {
      aim: ['Regular monofollicular ovulation with the lowest effective dose, a low multiple-pregnancy rate, and a decided move to the second line after six ovulatory cycles without conception (PCOS 2023 chapter 5; WHO 2025; FOGSI PCOS practice points 2024).'],
      investigations: [
        'Before the first cycle: semen within the WHO ranges (or mild changes only); tubal patency known, or decided case by case – test the tubes first when the history suggests PID, ectopic pregnancy, pelvic surgery or tuberculosis (PCOS 2023 5.2.1); TSH and prolactin; baseline scan to exclude a cyst over 20–25 mm; BMI, blood pressure and an OGTT in PCOS (PCOS 2023 1.9.11).',
      ],
      treatment: [
        'Lifestyle first and alongside: diet, physical activity and weight management for every woman with PCOS; a 5–10 % weight loss can restore ovulation (PCOS 2023; WHO 2025 good practice).',
        'First line: letrozole – preferred over clomiphene and over metformin, alone rather than with metformin (WHO 2025, conditional; PCOS 2023 EBR 5.3.1 and 5.4.5.1; FOGSI 2024).',
        'Where letrozole is not used: clomiphene citrate combined with metformin rather than either alone (WHO 2025); clomiphene can be preferred over metformin alone (PCOS 2023 5.4.2.1). Clomiphene alone or with metformin raises the multiple-pregnancy risk, so cycles are monitored (PCOS 2023 5.4.2.2).',
        'Metformin alone is an option when oral induction is declined, especially with insulin resistance or a higher BMI, accepting that it is less effective (PCOS 2023 5.4.1.1).',
        'Timing: natural LH surge with intercourse every 2 days from day 10, or an hCG trigger when the lead follicle is 18 mm or more with intercourse or IUI 24–36 hours later (common practice – doctor to confirm).',
        'After six ovulatory cycles without pregnancy, or no ovulation at the top dose (resistance): gonadotrophins – WHO 2025 prefers them over ovarian drilling – or laparoscopic ovarian surgery (PCOS 2023 second line); IVF is the third line (PCOS 2023; WHO 2025: IVF rather than expectant management after failed induction).',
      ],
      medicines: [
        'Letrozole 2.5 mg daily for 5 days from day 2–5 of the cycle; if no ovulation, 5 mg and then 7.5 mg daily in the following cycles (usual regimen – doctor to confirm).',
        'Clomiphene citrate 50 mg daily for 5 days from day 2–5; if no ovulation, 100 mg then 150 mg; not beyond six ovulatory cycles in total (NICE 2013 practice; FOGSI – doctor to confirm).',
        'Metformin 500 mg daily with food, increased over 2–3 weeks to 1,500–2,000 mg daily in divided doses as tolerated (PCOS 2023 practice points – doctor to confirm).',
        'hCG trigger, when used: 5,000–10,000 IU urinary, or 250 micrograms recombinant (doctor to confirm).',
      ],
      monitoring: [
        'Transvaginal follicle tracking from day 10–12 – at least in the first cycle of each dose – to confirm ovulation, set the dose and count follicles (PCOS 2023 5.4.2.2; FOGSI 2024).',
        'Cancel the cycle and advise against unprotected intercourse when more than 2 follicles reach 14 mm or more (PCOS 2023 practice point 5.5.8, applied to oral induction by FOGSI).',
        'Clomiphene: watch the endometrial thickness and cervical mucus; stop clomiphene for visual disturbance. Letrozole: shorter half-life, fewer endometrial effects (PCOS 2023).',
        'Ovulation confirmed by scan or mid-luteal progesterone; a pregnancy test when the period is 7 days late; an early scan at 6–7 weeks to count sacs.',
      ],
      review: ['Review after every cycle; after 3 cycles review the plan with the couple; after 6 ovulatory cycles (or resistance) choose the next step with the couple – oral induction is not continued beyond this.'],
      counselling: ['Chance per ovulatory cycle roughly 15–25 %; multiple pregnancy about 5–8 % with clomiphene and lower with letrozole; letrozole is off-label and why it is preferred; when the plan moves on (PCOS 2023; WHO 2025).'],
    },
  },
  {
    key: 'oi_gonadotrophins',
    name: 'Gonadotrophin ovulation induction, low-dose step-up – second line',
    short: 'Gonadotrophin induction',
    group: 'ovulation',
    summary: 'Low-dose FSH with scan monitoring after oral induction fails; strict cancel rules for multiple pregnancy and OHSS.',
    whenToUse: 'PCOS or WHO group II anovulation that did not ovulate or conceive with letrozole or clomiphene (with metformin); also an option in selected treatment-naive women (PCOS 2023 5.5.1).',
    bodies: ['pcos2023', 'who2025', 'nice2026', 'fogsi2024'],
    cautions: ['Needs scan monitoring and the means to cancel a cycle; without them, laparoscopic ovarian surgery or referral (PCOS 2023 5.5.10; NICE NG257 1.33.2).'],
    sections: {
      aim: ['Monofollicular ovulation with the lowest FSH dose that works; WHO 2025 prefers gonadotrophins over ovarian drilling after oral agents fail.'],
      investigations: ['Tubal patency confirmed and semen known; baseline scan on day 2–3 (no cyst over 20–25 mm); TSH and prolactin; BMI and glucose as for PCOS.'],
      treatment: [
        'Low-dose step-up: 37.5–75 IU FSH (or hMG) daily from day 2–3, kept for 7–14 days; if no follicle reaches 10 mm, increase by 25–37.5 IU every 7 days; once a follicle responds the dose is held until it reaches 17–18 mm (PCOS 2023 practice point 5.5.6; usual regimen – doctor to confirm).',
        'Trigger with hCG when one, at most two, follicles are 17–18 mm or more; timed intercourse or IUI 24–36 hours later; luteal progesterone is the doctor’s choice (doctor to confirm).',
        'Gonadotrophins alone rather than with clomiphene, or with clomiphene plus metformin (PCOS 2023 5.5.2–5.5.3).',
        'Up to 3–6 stimulated cycles; then IVF (WHO 2025: IVF rather than expectant management after failed induction).',
      ],
      medicines: ['Recombinant FSH or hMG 37.5–75 IU subcutaneously daily, increments of 25–37.5 IU; hCG 5,000–10,000 IU (or 250 micrograms recombinant) for the trigger; progesterone for luteal support where chosen (all doctor to confirm).'],
      monitoring: [
        'Scan every 2–4 days once follicles are 10 mm or more; cancel when more than 2 follicles are 14 mm or more and advise no unprotected intercourse that cycle (PCOS 2023 5.5.8; NICE 1.33.2).',
        'Withhold hCG and cancel at a high response; explain the OHSS warning signs – abdominal swelling, pain, vomiting, breathlessness, low urine output – and whom to call (NICE 1.33.1).',
      ],
      review: ['Review after each cycle; after 3 cycles reconsider the dose, adding IUI, or IVF; after 6 cycles without pregnancy, IVF.'],
      counselling: ['The multiple-pregnancy and OHSS risks and the cancel rules are explained before the first injection (NICE 1.33.1), with the cost of drugs and scans per cycle.'],
    },
  },
  {
    key: 'los',
    name: 'Laparoscopic ovarian surgery (drilling) for resistant PCOS',
    short: 'Ovarian drilling',
    group: 'ovulation',
    summary: 'A one-off operation that can restore ovulation in clomiphene- or letrozole-resistant PCOS; second line beside gonadotrophins.',
    whenToUse: 'No ovulation on the top dose of oral induction, especially when scan monitoring is hard to arrange, or when a diagnostic laparoscopy is needed anyway.',
    bodies: ['pcos2023', 'who2025'],
    cautions: ['WHO 2025 suggests gonadotrophins rather than drilling after oral agents fail; drilling risks adhesions and loss of ovarian reserve, and the surgical risks are higher above a healthy weight (PCOS 2023 5.6.2).'],
    sections: {
      aim: ['Ovulation without multiple-pregnancy risk in resistant PCOS, with the tubes and pelvis inspected at the same operation (PCOS 2023 EBR 5.6.1).'],
      investigations: ['Fitness for anaesthesia; semen and tubal status; the gonadotrophin alternative discussed (WHO 2025).'],
      treatment: [
        'Laparoscopic ovarian drilling with the minimum energy and number of punctures (commonly 4 per ovary – doctor to confirm); dye test at the same time.',
        'After surgery: expect ovulation within months; if none by 3 months, add letrozole or clomiphene (often effective now) or gonadotrophins; IVF if no pregnancy by 6–12 months.',
      ],
      monitoring: ['Cycle diary and mid-luteal progesterone or scan to confirm ovulation after surgery.'],
      review: ['Review at 3 and 6 months after surgery.'],
      counselling: ['One operation may give 6–12 months of ovulatory cycles; the surgical and reserve risks; it does not treat the metabolic side of PCOS.'],
    },
  },
  {
    key: 'oi_group1',
    name: 'Hypogonadotropic hypogonadism (WHO group I): pulsatile GnRH or gonadotrophins with LH activity',
    short: 'Group I induction',
    group: 'ovulation',
    summary: 'Low FSH and LH with amenorrhoea: oral induction does not work; weight restoration, then hMG or pulsatile GnRH with specialist monitoring.',
    whenToUse: 'Amenorrhoea with low or normal FSH and LH and low oestradiol – hypothalamic amenorrhoea, low body weight, over-exercise, pituitary disease.',
    bodies: ['nice2026', 'who2025'],
    cautions: [],
    sections: {
      aim: ['Restore ovulation by replacing the missing signal (NICE NG257 1.30.2).'],
      investigations: ['FSH, LH, oestradiol, prolactin, TSH; a progestogen challenge; pituitary MRI when prolactin is high or the picture suggests pituitary disease; BMI with an eating and exercise history; bone density if long-standing (doctor to confirm).'],
      treatment: [
        'First: reach a healthy weight if the BMI is under 18.5 and moderate high levels of exercise – ovulation often returns (NICE 1.30.1).',
        'Then: pulsatile GnRH by pump, or gonadotrophins with LH activity (hMG, or FSH with recombinant LH) – not FSH alone, and not letrozole or clomiphene, which need an intact axis (NICE 1.30.2).',
        'IVF if no pregnancy after 6 ovulatory cycles, or earlier with another factor.',
      ],
      medicines: ['hMG 75–150 IU daily from day 2–3 with a step-up as in the low-dose protocol; hCG trigger; luteal support with progesterone or hCG because the axis gives none (doctor to confirm). Oestrogen replacement when not trying to conceive, for the bones.'],
      monitoring: ['Scan monitoring as for gonadotrophin induction; cancel when more than 2 follicles reach 14 mm.'],
      review: ['Review after each cycle; refer to a reproductive endocrinologist for pulsatile GnRH where available.'],
      counselling: ['Why the usual tablets will not work, the role of weight and exercise, and bone health.'],
    },
  },
  {
    key: 'hyperprolactinaemia',
    name: 'Ovulatory disorder from hyperprolactinaemia: cabergoline',
    short: 'Hyperprolactinaemia',
    group: 'ovulation',
    summary: 'Cabergoline rather than bromocriptine; the cause found first (medicines, hypothyroidism, adenoma).',
    whenToUse: 'Raised prolactin with oligo- or amenorrhoea or galactorrhoea.',
    bodies: ['who2025', 'nice2026'],
    cautions: [],
    sections: {
      aim: ['Normalise prolactin and restore ovulation (WHO 2025; NICE NG257 1.32.1).'],
      investigations: ['Repeat prolactin unstressed (not after a breast examination); TSH (hypothyroidism raises prolactin); medicine review (antipsychotics, metoclopramide, domperidone, oestrogens); macroprolactin when the picture does not fit; pituitary MRI when prolactin is clearly raised or with headache or visual symptoms (doctor to confirm); exclude pregnancy.'],
      treatment: [
        'Cabergoline titrated until prolactin is normal and cycles return; treat hypothyroidism if present; stop an offending medicine with the prescriber’s agreement.',
        'If ovulation does not return once prolactin is normal, add letrozole or clomiphene as for WHO group II.',
        'Macroadenoma: endocrinology and ophthalmology review before conception, with the plan for the pregnancy made in advance.',
      ],
      medicines: ['Cabergoline 0.25 mg twice a week, increased by 0.25 mg twice weekly at monthly intervals to the lowest dose that keeps prolactin normal (usually not above 1 mg twice weekly); stopped once pregnancy is confirmed unless a macroadenoma needs it (doctor to confirm). Cabergoline is preferred to bromocriptine (WHO 2025, conditional; NICE 2026).'],
      monitoring: ['Prolactin every 4–6 weeks while titrating; cycle diary; pregnancy test before each dose increase.'],
      review: ['Review at 3 months: prolactin normal and ovulating? If not, adjust, or add ovulation induction.'],
      counselling: ['The cause, that the tablet is stopped in pregnancy, and the headache and visual warning signs.'],
    },
  },
  {
    key: 'unexplained',
    name: 'Unexplained infertility: expectant management, then stimulated IUI, then IVF',
    short: 'Unexplained infertility',
    group: 'unexplained',
    summary: 'Stepped care – 3–6 months of expectant management when the prognosis is good, then 3–6 cycles of IUI with letrozole or clomiphene, then IVF without ICSI.',
    whenToUse: '12 months of trying, normal history and examination in both, ovulation confirmed, patent tubes, semen within the WHO ranges (WHO 2025). Minimal–mild endometriosis found at laparoscopy is not unexplained infertility (ESHRE 2023).',
    bodies: ['who2025', 'eshreUi2023', 'nice2026'],
    cautions: ['No ovarian stimulation with timed intercourse as a stand-alone treatment (WHO 2025; NICE NG257 1.38.2), and no endometrial scratching, antioxidants, inositol or acupuncture (ESHRE 2023 rec. 45–49).'],
    sections: {
      aim: ['The least invasive effective step first, decided by prognosis – her age, duration of infertility, primary or secondary, previous pregnancies (ESHRE 2023 GPP 37; the Hunault prognosis model).'],
      investigations: ['Confirm the diagnosis is complete (Evaluation protocol); consider coeliac serology (NICE 1.23; ESHRE rec. 25); TSH within range (ESHRE GPP 27–28); no further tests – no laparoscopy, hysteroscopy, AMH for natural pregnancy, thrombophilia or immune tests (ESHRE 2023).'],
      treatment: [
        'Step 1 – expectant management 3–6 months with fertile-window and lifestyle advice, rather than unstimulated IUI or stimulation with timed intercourse (WHO 2025, conditional). NICE 2026 advises trying for 2 years in total before treatment (1.38.1); ESHRE 2023 starts active treatment when the prognosis is poor – for example a 12-month chance under about 30 %.',
        'Step 2 – stimulated IUI with letrozole or clomiphene rather than gonadotrophins, 3–6 cycles (WHO 2025). ESHRE 2023 makes IUI with ovarian stimulation the first active treatment (rec. 36, 38), with low-dose gonadotrophins only under careful monitoring (GPP 39). NICE 2026: up to 4 IUI cycles with gonadotrophin stimulation before IVF (1.38.3).',
        'Step 3 – IVF rather than continued expectant management when stimulated IUI has not worked (WHO 2025); conventional IVF, not ICSI (WHO strong; ESHRE rec. 42). ESHRE: IVF is probably not better than IUI-OS as the first active treatment (rec. 40); the move to IVF is individualised by age, duration and previous treatment (rec. 41).',
        'Tubal flushing: an HSG with oil-soluble contrast raises pregnancy rates modestly – discuss risks and benefits when an HSG is still to be done (ESHRE 2023 rec. 44).',
      ],
      medicines: ['Letrozole 2.5–5 mg daily or clomiphene 50–100 mg daily for 5 days from day 2–5 in the IUI cycles; hCG 5,000–10,000 IU trigger when the lead follicle is 18 mm or more; luteal progesterone optional (doctor to confirm).'],
      monitoring: ['Scan monitoring in the IUI cycles; cancel when more than 2 follicles reach 14 mm; the post-wash total motile count recorded for every IUI (doctor to confirm the clinic’s threshold).'],
      review: ['Review at the end of each step: after 3–6 months of expectant management; after 3 IUI cycles (most pregnancies come in the first 3–4) and at the latest after 6; then IVF.'],
      counselling: ['No cause found does not mean no chance – natural conception continues to accumulate; the per-cycle chance of IUI-OS (about 10–15 %) and of IVF by age; the multiple-pregnancy risk of stimulation; the cost of each step (NICE 1.4, 1.55).'],
    },
  },
  {
    key: 'tubal',
    name: 'Tubal factor: surgery or IVF, and the hydrosalpinx before IVF',
    short: 'Tubal factor',
    group: 'factor',
    summary: 'Surgery for mild–moderate disease under 35 where the expertise exists, IVF for severe disease or from 35; salpingectomy or occlusion of a hydrosalpinx before IVF.',
    whenToUse: 'Blocked or damaged tubes on HSG, HyCoSy or laparoscopy; past ectopic pregnancy, PID, pelvic surgery or genital tuberculosis.',
    bodies: ['who2025', 'nice2026'],
    cautions: [],
    sections: {
      aim: ['Repair or bypass, chosen by her age, the grade of disease (Hull and Rutherford), ovarian reserve and the partner’s semen (WHO 2025; NICE NG257 1.34).'],
      investigations: ['Grade the disease: laparoscopy and dye when the HSG is abnormal or comorbidity is suspected (NICE 1.18.15); semen analysis and ovarian reserve before any surgery; in India, exclude genital tuberculosis (endometrial TB PCR, culture, histology) when tubes are blocked, especially with a thin endometrium or adhesions (FOGSI practice – doctor to confirm); chlamydia screening before instrumentation (NICE 1.22).'],
      treatment: [
        'Under 35 with mild–moderate tubal disease (grade I–II): tubal surgery rather than IVF, in a centre with the expertise; then try for up to 1 year before IVF (WHO 2025; NICE 1.34.1).',
        'Under 35 with severe disease (grade III), or 35 and over with any tubal disease: IVF rather than surgery (WHO 2025).',
        'Proximal (cornual) block: hysteroscopic or radiological tubal catheterisation after discussing IVF (NICE 1.34.2).',
        'Hydrosalpinx: laparoscopic salpingectomy or proximal tubal occlusion before IVF – not aspiration, unless surgery is high-risk, when aspiration near oocyte retrieval is the alternative (WHO 2025; NICE 1.34.3–1.34.4).',
        'One patent tube with ovulation and normal semen: ovulation induction or IUI for a limited time (3–6 cycles) before IVF. Previous sterilisation is a separate question – reversal versus IVF by age and reserve (WHO 2025 remark).',
        'Genital tuberculosis: complete anti-tubercular treatment before any ART; advanced tubal and endometrial damage usually means IVF (doctor to confirm).',
      ],
      monitoring: ['After tubal surgery: an early scan at 6 weeks of any pregnancy to exclude an ectopic pregnancy, and the ectopic warning signs explained.'],
      review: ['Review 1 year after surgery (earlier from 35); IVF if no pregnancy.'],
      counselling: ['Success and ectopic risk after surgery versus IVF success by age; why a hydrosalpinx is dealt with before IVF (it halves implantation).'],
    },
  },
  {
    key: 'male_mild',
    name: 'Mild to moderate male factor',
    short: 'Mild male factor',
    group: 'male',
    summary: 'Repeat the test, examine, treat a varicocele when trying naturally, stop empirical drugs and supplements; IUI then ICSI by severity.',
    whenToUse: 'One or more semen parameters below the WHO 2021 limits on two tests, without azoospermia or severe oligozoospermia.',
    bodies: ['who2025', 'nice2026', 'eau2025', 'whoSemen2021'],
    cautions: ['No androgens for semen abnormalities (NICE NG257 1.24.3); gonadotrophins or anti-oestrogens only for hypogonadotropic hypogonadism or in a trial (NICE 1.24.1–1.24.2); antioxidants – no recommendation for or against (WHO 2025) and not offered to improve DNA fragmentation (NICE 1.24.6).'],
    sections: {
      aim: ['Confirm the finding, find a treatable cause, and give the couple the least invasive effective treatment while her age and reserve allow (WHO 2025; NICE NG257; EAU 2025).'],
      investigations: [
        'Repeat semen analysis after 3 months – at least 11 weeks, one spermatogenic cycle – by WHO 2021 methods (WHO 2025; NICE 1.17.4); with two abnormal results: scrotal examination, serum testosterone, FSH and LH (NICE 1.17.5); urology or andrology assessment of every infertile man (EAU 2025).',
        'Genetics: Y-chromosome microdeletion when the concentration is under 1 million/mL; consider a karyotype when it stays under 5 million/mL (NICE 1.17.7, 1.17.10; EAU and AUA use 5 million for both); genetic counselling when a defect is found (NICE 1.17.11).',
        'Not done: antisperm antibodies, DNA fragmentation, semen culture without symptoms of infection (NICE 1.17.2, 1.17.6, 1.24.5; ESHRE 2023).',
      ],
      treatment: [
        'Lifestyle: stop smoking, limit alcohol, healthy weight, avoid testicular heat and anabolic steroids; treat a genital infection only when one is identified (NICE 1.24.5).',
        'Clinical varicocele with abnormal semen in a couple trying naturally (not going straight to ART): surgical repair (microsurgical subinguinal preferred) or radiological treatment rather than waiting; semen re-tested at 3–6 months (WHO 2025, conditional; NICE 1.28.1).',
        'Hypogonadotropic hypogonadism (low testosterone with low FSH and LH): gonadotrophin therapy (NICE 1.24.1).',
        'Ejaculatory failure: find the cause and use the least invasive method – medicines, vibratory stimulation, electroejaculation or sperm retrieval (NICE 1.29.1).',
        'The couple: mild changes with a good post-wash total motile count – IUI with ovarian stimulation for 3–4 cycles (her tubes patent, ovulation confirmed); moderate changes or failed IUI – IVF with ICSI decided by severity (NICE 1.50.2).',
      ],
      medicines: ['None routinely for him – no empirical clomiphene, letrozole, hCG or antioxidants outside a trial (NICE 1.24.2, 1.24.6). Folic acid for her.'],
      monitoring: ['Semen analysis 3–6 months after any change (varicocele repair, lifestyle, infection treated); her age sets the pace – the male work-up should not delay her treatment beyond 6 months when she is 35 or over.'],
      review: ['Review with the repeat semen result; after 3–4 IUI cycles, or at once for moderate–severe changes, ICSI.'],
      counselling: ['The WHO ranges are reference limits of fertile men, not pass or fail; abnormal semen is linked to general health risks worth a check (EAU 2025); the options and costs of IUI versus ICSI.'],
    },
  },
  {
    key: 'male_severe',
    name: 'Severe male factor and azoospermia: the ICSI pathway',
    short: 'Severe male factor',
    group: 'male',
    summary: 'Hormonal and genetic work-up, obstructive versus non-obstructive azoospermia, sperm retrieval with ICSI, and donor sperm under the ART Act when needed.',
    whenToUse: 'Azoospermia, severe oligozoospermia (for example under 5 million/mL), or severe combined defects.',
    bodies: ['nice2026', 'who2025', 'eau2025', 'artAct'],
    cautions: ['No surgical sperm retrieval when a Y-chromosome AZFa or AZFb microdeletion is found (NICE NG257 1.26.1); genetic counselling before ICSI for any genetic finding (NICE 1.17.11).'],
    sections: {
      aim: ['Find retrievable sperm or decide on donor sperm, while her side is made ready for ICSI (NICE NG257 1.25, 1.50; EAU 2025).'],
      investigations: ['Repeat semen analysis at once with the centrifuged pellet examined (NICE 1.17.4); examination of testes, vas and epididymis; FSH, LH, testosterone (prolactin and oestradiol where indicated); karyotype for idiopathic azoospermia; Y-chromosome microdeletion for azoospermia or under 1 million/mL; CFTR testing for suspected obstructive azoospermia or an absent vas (NICE 1.17.7–1.17.10); scrotal ultrasound. Her: viral screening, rubella, tubal and uterine status, ovarian reserve (NICE 1.19.1).'],
      treatment: [
        'Obstructive azoospermia (normal FSH, normal testicular volume): surgical reconstruction or surgical sperm retrieval (PESA, MESA, TESA) with ICSI – chosen by her age and reserve, the obstructive interval, the risks and the couple’s preference (NICE 1.25.1).',
        'Non-obstructive azoospermia (raised FSH, small testes): surgical sperm retrieval, micro-TESE preferred, with ICSI; none with AZFa or AZFb deletions (NICE 1.25.2–1.25.3, 1.26.1).',
        'Severe oligozoospermia: ICSI with ejaculated sperm; a sample frozen before the cycle; varicocele repair before ART only when time allows (WHO 2025: its varicocele recommendation applies outside ART).',
        'Hypogonadotropic hypogonadism: gonadotrophins (hCG, then FSH) for 6–12 months can restore spermatogenesis (NICE 1.24.1).',
        'No sperm, or retrieval not suitable or declined: donor sperm from a registered ART bank – IUI (NICE 1.37.1: up to 12 unstimulated cycles before IVF) or ICSI as her side needs; under the ART Act the donor is 21–55, screened, and his gametes go to one commissioning couple only (NICE 1.51; ART Act 2021, Rules 2022).',
      ],
      medicines: ['None routinely; gonadotrophins only for hypogonadotropic hypogonadism (NICE 1.24.1); no androgens and no empirical antioxidants (NICE 1.24.3, 1.24.6).'],
      monitoring: ['Her stimulation and safety monitoring as in the IVF protocol; retrieved sperm frozen before her cycle where the laboratory allows.'],
      review: ['Review with the genetic results before ICSI; after a failed retrieval, the donor-sperm discussion.'],
      counselling: ['The genetic findings and what ICSI may pass on; retrieval success by cause; the ART Act’s counselling and consent steps; the donor route and the registry rules.'],
    },
  },
  {
    key: 'endometriosis',
    name: 'Endometriosis-associated infertility',
    short: 'Endometriosis',
    group: 'factor',
    summary: 'Surgery or expectant management by stage, no ovarian suppression for fertility, IUI with stimulation in early disease, ART when tubes, sperm, EFI or time say so; no routine endometrioma surgery before ART.',
    whenToUse: 'Endometriosis found at laparoscopy or strongly suspected on imaging (endometrioma, deep disease).',
    bodies: ['eshreEndo2022', 'nice2026'],
    cautions: ['No ovarian suppression (combined pill, progestogens, GnRH analogues) to improve fertility, and no prolonged GnRH-agonist pre-treatment before ART (ESHRE 2022, strong).'],
    sections: {
      aim: ['Improve the chance of pregnancy while protecting ovarian reserve; the decision weighs pain, age, previous surgery, other factors, reserve and the Endometriosis Fertility Index (ESHRE 2022 GPP).'],
      investigations: ['Transvaginal scan for endometrioma and deep disease; AMH or AFC before any ovarian surgery; semen analysis; tubal status – laparoscopy and dye is also the diagnostic test (NICE NG257 1.18.15); the EFI score once a laparoscopy has been done (ESHRE 2022).'],
      treatment: [
        'Stage I–II (rASRM): operative laparoscopy – excision or ablation of lesions, adhesiolysis – may be offered to improve ongoing pregnancy rates (ESHRE 2022, weak); NICE 2026 discusses expectant management for up to 2 years, including the time already spent trying, or surgery (1.36.1).',
        'Stage I–II after surgery, or with patent tubes: IUI with ovarian stimulation rather than expectant management or IUI alone (ESHRE 2022, weak); NICE 2026: up to 4 IUI cycles with gonadotrophin stimulation before IVF (1.36.2).',
        'Stage III–IV: ART, especially with compromised tubes, male factor, a low EFI or failed treatment (ESHRE 2022); IUI-OS is of uncertain value but can be considered when the tubes are patent (weak).',
        'Endometrioma: no routine surgery before ART to improve live birth – it does not help and can harm reserve; operate for pain, for access to follicles, or when malignancy is in doubt; cystectomy rather than drainage when surgery is done (ESHRE 2022, strong and GPP).',
        'Deep endometriosis: excision decided by pain and preference, not by expected fertility gain (ESHRE 2022).',
        'ART: GnRH agonist or antagonist protocols can both be used; ART does not increase recurrence; antibiotic prophylaxis at oocyte retrieval with an endometrioma is reasonable (ESHRE 2022).',
      ],
      medicines: ['Analgesia as needed; folic acid; no pentoxifylline, anti-inflammatory drugs or letrozole (outside ovulation induction) to improve natural conception (ESHRE 2022, strong); postoperative hormonal treatment only for a woman not trying to conceive at once (weak).'],
      monitoring: ['Pain and cyst size on scan; ovarian reserve after any ovarian surgery.'],
      review: ['Review 6 months after surgery or 6 months of trying (sooner from 35); then IUI-OS for up to 4–6 cycles, or IVF.'],
      counselling: ['Fertility preservation when ovarian disease is extensive or repeat surgery likely, with its uncertain benefit (ESHRE 2022, strong); pain treatment and fertility treatment pull in different directions – how the plan sequences them.'],
    },
  },
  {
    key: 'uterine',
    name: 'Uterine factor: septum, fibroids, polyps and adhesions',
    short: 'Uterine factor',
    group: 'factor',
    summary: 'Hysteroscopic adhesiolysis and removal of cavity-distorting lesions where they help; no septoplasty for infertility alone.',
    whenToUse: 'A cavity abnormality on ultrasound, saline infusion sonography, HSG or hysteroscopy.',
    bodies: ['who2025', 'nice2026', 'eshreUi2023', 'eshreRpl2022', 'asrm'],
    cautions: [],
    sections: {
      aim: ['Treat the lesions that reduce implantation and leave the rest alone (WHO 2025; NICE NG257; ESHRE 2022–2023).'],
      investigations: ['Saline infusion sonography or 3D ultrasound to define the cavity (WHO 2025 prefers SIS over 2D scan and HSG, 3D where available); hysteroscopy only when an abnormality is suspected, never as a routine screen before IVF (NICE 1.18.16, 1.40.2); renal tract imaging with a Müllerian anomaly (ESHRE RPL 2022).'],
      treatment: [
        'Intrauterine adhesions (Asherman): hysteroscopic adhesiolysis – it restores menstruation and improves the chance of pregnancy – with measures against re-adhesion (NICE 1.35.1; ESHRE RPL 2022).',
        'Submucous fibroid or endometrial polyp distorting the cavity: hysteroscopic removal may improve conception (ASRM 2017; evidence limited); intramural fibroids not distorting the cavity are not removed for fertility alone; subserous fibroids are left.',
        'Uterine septum without recurrent pregnancy loss: no resection for infertility (WHO 2025); with recurrent loss the only trial showed no benefit (ESHRE RPL 2022) – case by case.',
        'Bicorporeal or hemi-uterus: no reconstructive surgery for fertility (ESHRE RPL 2022, strong).',
        'Thin endometrium: no proven treatment; an embryo transfer with a lining under 5 mm is unlikely to succeed (NICE 1.49.3); genital tuberculosis to be excluded in India (doctor to confirm).',
      ],
      medicines: ['Oestrogen after adhesiolysis and antibiotic cover around hysteroscopic surgery are the surgeon’s choice (doctor to confirm).'],
      monitoring: ['Second-look hysteroscopy or SIS 4–8 weeks after adhesiolysis; the cycle pattern after surgery.'],
      review: ['Review 2–3 months after surgery, then try naturally or proceed to the planned treatment.'],
      counselling: ['What the lesion does and does not do to fertility; a myomectomy that opened the cavity brings a caesarean recommendation for the birth (doctor to confirm).'],
    },
  },
  {
    key: 'dor',
    name: 'Older age or diminished ovarian reserve: do not delay',
    short: 'Age and reserve',
    group: 'art',
    summary: 'Age is the strongest predictor; move quickly to the most effective treatment, counsel on realistic chances and the donor-oocyte route; no unproven add-ons.',
    whenToUse: 'She is 38 or older; or AMH under about 1 ng/mL, AFC 5 or fewer, day 2–3 FSH 10 IU/L or more, or a previous poor response.',
    bodies: ['who2025', 'nice2026', 'eshreOs2025', 'asrm', 'artAct'],
    cautions: ['Under the ART Act 2021 a woman can receive ART only up to 50 years and a man up to 55 (judged at the start of treatment); IVF success per transfer falls steeply after 40 (NICE NG257 figure 2); NICE does not offer NHS IVF from 42.'],
    sections: {
      aim: ['Shorten every step: investigate at once, treat the main factor without the usual waiting periods, and discuss IVF and donor oocytes early (WHO 2025 – age is the main predictor of reserve; NICE 1.16.8, 1.18.2).'],
      investigations: ['AMH and antral follicle count to predict the response to stimulation and to counsel – not to predict natural conception (NICE 1.18.3–1.18.4); the rest of the evaluation in one cycle; genetic counselling about aneuploidy risk by age.'],
      treatment: [
        'Expectant management and oral ovulation induction only briefly (no more than 3 months) at 38–40, and usually not at all from 40 or with a very low reserve; IUI 2–3 cycles at most.',
        'IVF with an individualised stimulation – dose set by AMH or AFC, antagonist protocol usual (ESHRE ovarian stimulation guideline 2025; the clinic’s protocol), the POSEIDON group documented; cumulative live birth counted over the fresh and frozen transfers of one stimulation (NICE 1.39.4).',
        'Poor response: no proven benefit from growth hormone, DHEA, testosterone, PRP or other add-ons outside research (ESHRE add-ons 2023; NICE 2026 add-ons not offered) – doctor to confirm what the clinic offers and why.',
        'Donor oocytes when the response is poor or after failed cycles, at once with POI, and usually from the mid-40s: recipient up to 50; donor 23–35, married with a living child, donates once, up to 7 oocytes, insured for 12 months by the commissioning couple, through a registered ART bank (NICE 1.52.1; ART Act 2021, Rules 2022).',
      ],
      medicines: ['As in the IVF protocol; no routine supplements (doctor to confirm).'],
      monitoring: ['The response of each cycle (oocytes, embryos) recorded to guide the next decision; cancelled cycles for low response count in the decision about further IVF (NICE 1.39.5).'],
      review: ['Review after each cycle; agree in advance how many own-oocyte cycles (commonly up to 3) before the donor discussion.'],
      counselling: ['Honest numbers for her age – live birth per transfer and per started cycle, miscarriage and aneuploidy risk – and the donor route with its legal frame; psychological support (WHO 2025 good practice).'],
    },
  },
  {
    key: 'poi',
    name: 'Premature ovarian insufficiency (WHO group III)',
    short: 'Ovarian insufficiency',
    group: 'ovulation',
    summary: 'Diagnosis, cause, hormone replacement until the usual menopause age, and the fertility options – mainly donor oocytes.',
    whenToUse: 'Oligo- or amenorrhoea for 4 months or more with raised FSH before the age of 40.',
    bodies: ['eshrePoi2024', 'nice2026', 'artAct'],
    cautions: ['No treatment reliably restores fertility: ovulation induction, IVF with her own oocytes, DHEA, PRP and stem-cell treatments are not recommended outside research (ESHRE 2024).'],
    sections: {
      aim: ['Confirm POI, find the cause and its health consequences, and give the couple the realistic fertility options (ESHRE, ASRM, IMS and CRE-WHiRL guideline 2024).'],
      investigations: ['FSH raised above 25 IU/L (repeated as the guideline advises) with oestradiol; AMH low; pregnancy test; karyotype (Turner mosaicism), FMR1 premutation, adrenal (21-hydroxylase) and thyroid antibodies; TSH; bone density (DEXA); cardiovascular risk factors; pelvic scan (ESHRE 2024).'],
      treatment: [
        'Hormone replacement – oestrogen with a progestogen – until at least the natural age of menopause, for bones, heart and symptoms; it does not prevent the roughly 5 % chance of a spontaneous pregnancy; contraception when pregnancy is not wanted (ESHRE 2024).',
        'Oocyte donation is the established route to pregnancy (NICE NG257 1.52.1), under the ART Act’s donor rules; embryo donation and adoption are the alternatives to discuss.',
        'Turner syndrome: cardiac assessment before any pregnancy (ESHRE 2024).',
      ],
      medicines: ['HRT: transdermal or oral oestradiol with cyclical or continuous progestogen, dose adjusted to symptoms and bone health, or the combined pill when she prefers it (ESHRE 2024 – doctor to confirm); calcium and vitamin D; folic acid when trying.'],
      monitoring: ['Annual review on HRT; DEXA every 2–5 years as indicated; blood pressure and metabolic checks.'],
      review: ['Fertility review when she is ready: donor-oocyte counselling, the clinic’s waiting time and the registry rules.'],
      counselling: ['The diagnosis is given in person, with time and written information; psychological support is offered; spontaneous conception is possible but uncommon and cannot be timed.'],
    },
  },
  {
    key: 'iui',
    name: 'Intrauterine insemination with ovarian stimulation',
    short: 'IUI',
    group: 'art',
    summary: 'Washed sperm placed in the uterus around ovulation, usually with letrozole, clomiphene or low-dose gonadotrophins; the right indications and strict cancel rules.',
    whenToUse: 'Unexplained infertility after expectant management, mild male factor, minimal–mild endometriosis, sexual difficulty (unstimulated cycles), donor insemination; at least one patent tube.',
    bodies: ['who2025', 'eshreUi2023', 'nice2026', 'fogsiIui'],
    cautions: ['Unstimulated IUI is not used for unexplained infertility (WHO 2025); it is the treatment for sexual difficulty and donor sperm, where NICE offers 12 (or 6) unstimulated cycles before IVF (NG257 1.37).'],
    sections: {
      aim: ['More motile sperm closer to one or two eggs at the right time, at low cost and risk; a decided number of cycles before IVF.'],
      investigations: ['Tubal patency (at least one patent tube); ovulation status; semen with a post-wash total motile count the clinic accepts (commonly 5 million or more – FOGSI Focus on IUI; doctor to confirm); chlamydia screening or prophylaxis before instrumentation (NICE 1.22); rubella; both partners’ viral screening per the clinic’s policy.'],
      treatment: [
        'Stimulation: letrozole or clomiphene rather than gonadotrophins for unexplained infertility (WHO 2025); low-dose gonadotrophins only with close monitoring (ESHRE 2023 GPP 39); NICE 2026 uses gonadotrophin stimulation for its 4 cycles (1.38.3).',
        'Trigger with hCG when the lead follicle is 17–18 mm or more; one insemination 24–36 hours after the trigger (or the morning after a detected LH surge); a second insemination adds little (doctor to confirm).',
        'Number of cycles: 3–6 stimulated cycles (WHO 2025); NICE 2026 up to 4; most pregnancies come in the first 3–4 cycles – then IVF.',
        'Luteal support with vaginal progesterone in stimulated cycles is the doctor’s choice (doctor to confirm).',
      ],
      medicines: ['Letrozole 2.5–5 mg or clomiphene 50–100 mg daily for 5 days from day 2–5; or FSH 37.5–75 IU daily step-up; hCG 5,000–10,000 IU (250 micrograms recombinant) trigger; progesterone 200–400 mg vaginally daily for luteal support where chosen (doctor to confirm).'],
      monitoring: ['Scan from day 9–10; cancel – or convert to IVF – when more than 2 follicles reach 14 mm, and advise against unprotected intercourse that cycle (ESHRE 2023; FOGSI); the post-wash count recorded each cycle; pregnancy test 14 days after IUI.'],
      review: ['Review after 3 cycles; stop at 4–6 and move to IVF (earlier from age 38).'],
      counselling: ['Per-cycle chance about 10–15 % when indicated; multiple pregnancy about 8–10 % with stimulation; the cancel rules; the plan after the agreed number of cycles.'],
    },
  },
  {
    key: 'ivf',
    name: 'IVF or ICSI: preparation, referral and the rules in India',
    short: 'IVF / ICSI',
    group: 'art',
    summary: 'Who needs IVF and who needs ICSI, the pre-IVF checks, stimulation and OHSS safety, how many embryos may be transferred, the add-ons not to use, and the ART Act requirements.',
    whenToUse: 'Tubal disease not for surgery, failed ovulation induction or IUI, moderate–severe endometriosis, severe male factor (ICSI), unexplained infertility after stimulated IUI, older age or low reserve.',
    bodies: ['nice2026', 'who2025', 'eshreOs2025', 'artAct'],
    cautions: ['ART only in a clinic and bank registered under the ART (Regulation) Act 2021; woman 21–50 and man 21–55 at the start; mandatory counselling and written consent; no sex selection of any kind (PC-PNDT Act and ART Act).'],
    sections: {
      aim: ['The most effective treatment, used when the simpler steps have been tried or do not apply, with safety first: one or two embryos, OHSS prevention, no unproven add-ons (NICE NG257 1.39–1.50; WHO 2025; ART Act).'],
      investigations: ['Both partners: viral screening (NICE 1.19.1) and the clinic’s panel. Her: rubella, cervical screening, TSH, haemoglobin, blood group, AMH or AFC for dosing (NICE 1.18.4), cavity assessment where suspected, hydrosalpinx dealt with (NICE 1.34.3). Him: semen analysis for the laboratory’s ICSI decision, genetics when indicated. The counselling session and the consent forms the Act requires.'],
      treatment: [
        'ICSI only for abnormal semen (by severity), surgically retrieved sperm, frozen oocytes or a previous failed fertilisation – not for non-male-factor infertility with normal semen (NICE 1.50.1–1.50.3; WHO 2025, strong, for unexplained infertility).',
        'Stimulation: GnRH antagonist protocol in most women, FSH dose individualised from AMH or AFC and body weight, GnRH-agonist trigger with freeze-all when the OHSS risk is high (ESHRE ovarian stimulation guideline 2019, update 2025 – the clinic’s protocol; doctor to confirm); the lowest effective dose and duration (NICE 1.54.3, 1.55.4).',
        'Oocyte retrieval under conscious sedation; no follicle flushing with 3 or more follicles (NICE 1.47); surplus embryos frozen (NICE 1.49.11; ART Rules 2022 – unused gametes and embryos kept for the same recipient).',
        'Embryo transfer: India – 1 or 2 embryos per cycle; 3 only in exceptional cases (older age, recurrent implantation failure or recurrent miscarriage) and never more (ART Regulations 2023). NICE 2026 – single embryo transfer under 37 in the first cycle, single whenever a top-quality blastocyst exists, never more than 2 (1.49.6–1.49.9); ultrasound-guided; no transfer with a lining under 5 mm (1.49.2–1.49.3).',
        'Not offered: endometrial scratch, routine hysteroscopy, endometrial receptivity or microbiome tests, immunological treatments (intralipid, IVIG, steroids), PGT-A to improve live birth, assisted hatching, IMSI, PICSI (NICE 2026 1.40–1.42, 1.48–1.50).',
        'The course: a full cycle is one stimulation with all its fresh and frozen transfers; NICE offers 3 full cycles under 40 (up to 3 more after discussion) and 1 at 40–41; frozen transfers in natural or hormone-supported cycles do equally well in ovulatory women (NICE 1.39, 1.49.12).',
      ],
      medicines: ['Gonadotrophins, antagonist, trigger and luteal progesterone per the clinic’s protocol; folic acid; antibiotic prophylaxis at retrieval with an endometrioma (ESHRE 2022) – all doctor to confirm.'],
      monitoring: ['Scan and oestradiol monitoring during stimulation; an OHSS prevention protocol in place (NICE 1.46.1); early pregnancy scan at 6–7 weeks; the outcome of every pregnancy documented (WHO 2025 good practice; the National ART Registry).'],
      review: ['Review after each full cycle – response, embryo quality, embryos frozen – and agree the next cycle or a change of route (donor gametes).'],
      counselling: ['Success per started cycle and cumulative by age (NICE figure 2); multiple pregnancy with two embryos; OHSS; the long-term safety data (NICE 1.54–1.55); costs; the Act’s counselling and consent steps; the psychological support available.'],
    },
  },
  {
    key: 'rpl',
    name: 'Recurrent pregnancy loss: work-up and the next pregnancy',
    short: 'Recurrent loss',
    group: 'other',
    summary: 'After two or more losses – antiphospholipid antibodies, thyroid, 3D scan of the uterus, lifestyle in both partners; treat what is found and avoid the treatments that do not help.',
    whenToUse: 'Two or more pregnancy losses (ESHRE 2022). Her losses are recorded under the Abortion type of care, which has the loss care plan.',
    bodies: ['eshreRpl2022'],
    cautions: ['Not recommended: lymphocyte immunisation, glucocorticoids, heparin or aspirin for unexplained loss, high-dose folic acid without an indication, PGT-A or PICSI for loss alone (ESHRE RPL 2022).'],
    sections: {
      aim: ['Find the few treatable causes, give an honest prognosis from her age and pregnancy history, and support the next pregnancy (ESHRE recurrent pregnancy loss guideline, 2022 update).'],
      investigations: [
        'Antiphospholipid antibodies – lupus anticoagulant, anticardiolipin IgG and IgM – after two losses, and anti-β2-glycoprotein I can be added; TSH and TPO antibodies, with T4 when TSH is abnormal; transvaginal 3D ultrasound of the uterus (SIS or MRI when 3D is not available) and a 2D scan for adenomyosis; parental karyotype after individual risk assessment; array-CGH of pregnancy tissue for explanation where available; the partner’s lifestyle, and sperm DNA fragmentation can be considered.',
        'Not done routinely: hereditary thrombophilia, HLA, NK cells, cytokines, ovarian reserve, luteal-phase tests, prolactin without symptoms, PCOS or insulin testing, homocysteine (ESHRE 2022).',
      ],
      treatment: [
        'Antiphospholipid syndrome: low-dose aspirin (75–100 mg) before conception and prophylactic-dose heparin (LMWH) from a positive pregnancy test (ESHRE 2022).',
        'Overt hypothyroidism: levothyroxine before and in pregnancy; subclinical hypothyroidism – treatment is weakly supported; euthyroid women with thyroid antibodies are not treated (ESHRE 2022).',
        'Vaginal progesterone may be considered with 3 or more losses and vaginal bleeding in the next pregnancy (ESHRE 2022, conditional); not for luteal-phase insufficiency without that.',
        'Uterine anomalies: septum resection showed no benefit in the only trial; no metroplasty for a bicorporeal or hemi-uterus; adhesions – hysteroscopic removal with anti-adhesion measures (ESHRE 2022).',
        'Second-trimester losses with suspected cervical weakness: serial cervical-length scans in the next pregnancy; a cerclage can be considered (ESHRE 2022).',
        'Unexplained loss: supportive care in an early pregnancy clinic; no empirical heparin, aspirin, steroids or immunotherapy; high-dose IVIG only in research for 4 or more losses (ESHRE 2022).',
      ],
      medicines: ['Aspirin 75–100 mg and prophylactic-dose LMWH only for antiphospholipid syndrome; levothyroxine for hypothyroidism; vaginal progesterone 400 mg twice daily when chosen (PRISM trial regimen – doctor to confirm); folic acid 400 micrograms – not high dose without an indication; vitamin D may be considered (ESHRE 2022).'],
      monitoring: ['Early pregnancy clinic from a positive test: a scan at 6–7 weeks and as reassurance; TSH checked at 7–9 weeks (ESHRE 2022).'],
      review: ['Review with all results together; the prognosis from her age and complete pregnancy history (most couples still have a good chance of a live birth).'],
      counselling: ['Grief and anxiety are addressed for both partners; stress is not a proven cause; smoking, obesity and alcohol are corrected (ESHRE 2022).'],
    },
  },
  {
    key: 'preservation',
    name: 'Fertility preservation before gonadotoxic treatment',
    short: 'Fertility preservation',
    group: 'other',
    summary: 'Urgent referral before chemotherapy, radiotherapy or surgery that may end fertility: sperm, oocyte or embryo freezing, ovarian tissue when there is no time.',
    whenToUse: 'Any patient facing treatment likely to impair fertility, or a condition that will (extensive endometriosis, Turner mosaicism).',
    bodies: ['nice2026', 'eshreEndo2022', 'eshreOs2025', 'artAct'],
    cautions: [],
    sections: {
      aim: ['Store gametes or embryos before fertility is lost, without delaying life-saving treatment (NICE NG257 1.53).'],
      investigations: ['The oncology plan and timeline; AMH or AFC; the viral screening storage requires; counselling on the likely need for, and success of, later treatment (NICE 1.53.2).'],
      treatment: [
        'Men and boys after puberty: sperm cryopreservation before treatment starts (NICE 1.53.5).',
        'Women and girls after puberty: oocyte or embryo cryopreservation – random-start stimulation, letrozole co-treatment in oestrogen-sensitive cancers (ESHRE ovarian stimulation guideline) (NICE 1.53.6); ovarian tissue cryopreservation when there is no time or before puberty (NICE 1.53.7).',
        'A GnRH agonist during chemotherapy is not a substitute for freezing (doctor to confirm the current ESHRE position).',
        'Storage, later use and donation follow the ART Act and Rules; a follow-up at least every 5 years decides on continued storage (NICE 1.53.8).',
      ],
      medicines: ['Stimulation per the clinic’s protocol; antagonist with an agonist trigger to shorten the cycle (doctor to confirm).'],
      monitoring: ['Coordination with oncology so that treatment is not delayed beyond the agreed window.'],
      review: ['Review after the cancer treatment about ovarian function and when a pregnancy would be safe.'],
      counselling: ['Success by age and number stored, the costs of storage, what happens to stored material, and that the discussion happens at the earliest opportunity (NICE 1.53.1).'],
    },
  },
  {
    key: 'donor',
    name: 'Donor gametes and third-party reproduction under the ART Act',
    short: 'Donor gametes',
    group: 'other',
    summary: 'When donor sperm or oocytes are the answer, and the legal frame in India: registered banks, donor age and limits, insurance, counselling, consent, no sex selection.',
    whenToUse: 'Azoospermia without retrievable sperm, a severe genetic risk, premature ovarian insufficiency, repeated IVF failure with own oocytes, or age beyond own-oocyte success.',
    bodies: ['nice2026', 'artAct'],
    cautions: ['Surrogacy only under the Surrogacy (Regulation) Act 2021 (altruistic, with eligibility certificates) – outside this plan.'],
    sections: {
      aim: ['A pregnancy with donor gametes, safely and lawfully (NICE NG257 1.51–1.52; ART (Regulation) Act 2021, Rules 2022, Regulations 2023).'],
      investigations: ['Her: ovulation confirmed, and a tubal assessment when the history suggests damage, before donor insemination (NICE 1.51.3); recipient screening; genetic counselling where the indication is genetic; the clinic’s counselling session with both partners (mandatory under the Act).'],
      treatment: [
        'Donor sperm: for obstructive or non-obstructive azoospermia, severe semen deficits when ICSI is declined, a high genetic or infectious risk, severe rhesus isoimmunisation (NICE 1.51.1–1.51.2); IUI rather than intracervical insemination (NICE 1.51.4); 6 or 12 unstimulated cycles before IVF by indication (NICE 1.37).',
        'Donor oocytes: premature ovarian insufficiency, gonadal dysgenesis including Turner syndrome, certain IVF failures, genetic risk (NICE 1.52.1–1.52.2); the embryo transfer strategy follows the donor’s age (NICE 1.49.7).',
        'The ART Act: gametes only from a registered ART bank; sperm donor 21–55; oocyte donor 23–35, married, with at least one living child of 3 years or more, donates once in her life, no more than 7 oocytes retrieved; one donor’s gametes to one commissioning couple; the couple insures the oocyte donor for 12 months; commissioning woman 21–50, man 21–55; counselling and written consent; donor identity confidential; no sex selection.',
      ],
      medicines: ['Recipient endometrial preparation (oestradiol and progesterone) per the clinic’s protocol (doctor to confirm).'],
      monitoring: ['As for IUI or IVF; outcomes reported to the National ART Registry by the clinic.'],
      review: ['Review after each cycle; the number of cycles agreed in advance.'],
      counselling: ['Implications counselling for both partners, the child’s rights under the Act, confidentiality, and the costs.'],
    },
  },
];

export const protocolByKey = new Map(PROTOCOLS.map((p) => [p.key, p]));
export const PROTOCOL_KEYS = PROTOCOLS.map((p) => p.key);

/** The bodies cited by a protocol, as labels for the screen. */
export const bodyLabels = (p) => p.bodies.map((b) => BODIES[b]?.label ?? b);

const bullet = (lines) => lines.map((l) => `• ${l}`).join('\n');

/**
 * Builds the editable plan text from one or more protocols: every section in SECTION_ORDER that any of them fills,
 * the shared general advice once at the end, and the sources. With several protocols each section names the
 * protocol each block comes from. Unknown keys are ignored (the route refuses them first).
 */
export function composePlan(keys) {
  const chosen = keys.map((k) => protocolByKey.get(k)).filter(Boolean);
  if (!chosen.length) return { title: '', sections: [], sources: [] };
  const several = chosen.length > 1;
  const sections = [];
  for (const { key, title } of SECTION_ORDER) {
    if (key === 'general') {
      if (!chosen.some((p) => p.key === 'preconception')) sections.push({ key, title, text: bullet(GENERAL_ADVICE) });
      continue;
    }
    const blocks = chosen.filter((p) => p.sections[key]?.length).map((p) => (several ? `${p.short}\n${bullet(p.sections[key])}` : bullet(p.sections[key])));
    if (blocks.length) sections.push({ key, title, text: blocks.join('\n\n') });
  }
  const cautions = chosen.flatMap((p) => p.cautions.map((c) => (several ? `${p.short}: ${c}` : c)));
  if (cautions.length) sections.splice(1, 0, { key: 'cautions', title: 'Cautions', text: bullet(cautions) });
  return {
    title: chosen.map((p) => p.name).join(' + ').slice(0, 200),
    sections,
    sources: chosen.map((p) => ({ key: p.key, label: p.name, bodies: bodyLabels(p).join(', ') })),
  };
}

/** The library as the website shows it (every protocol, with its text), for browsing all protocols. */
export const libraryView = () =>
  PROTOCOLS.map((p) => ({
    key: p.key,
    name: p.name,
    short: p.short,
    group: p.group,
    groupLabel: GROUPS[p.group],
    summary: p.summary,
    whenToUse: p.whenToUse,
    bodies: bodyLabels(p),
    sources: p.bodies.map((b) => BODIES[b]?.title ?? b),
    cautions: p.cautions,
    sections: SECTION_ORDER.filter((s) => s.key !== 'general' && p.sections[s.key]?.length).map((s) => ({ key: s.key, title: s.title, items: p.sections[s.key] })),
  }));
