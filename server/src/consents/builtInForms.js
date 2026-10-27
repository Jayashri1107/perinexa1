// The built-in DRAFT consent forms every hospital starts with: English (forms/en.js) with Marathi (forms/mr.js)
// and Hindi (forms/hi.js) clause by clause. Each hospital gets its own copy (consentFormsService.js), which its
// doctors edit and approve. ⚠️ Not legally reviewed – see the warning in forms/en.js.
//
// For each form: which types of care it is listed for (empty = all), when it is suggested for a patient
// (models/ConsentForm.js SUGGEST_RULES), and notes for the reviewing doctor (shown in the app, not printed).

import { EN } from './forms/en.js';
import { HI } from './forms/hi.js';
import { MR } from './forms/mr.js';
import { INFO_EN } from './forms/info_en.js';
import { INFO_HI } from './forms/info_hi.js';
import { INFO_MR } from './forms/info_mr.js';

// Increase when the built-in wording changes: unapproved copies that no one has edited are refreshed.
// 2 (2 Oct 2026): the Abortion type of care added to the HIV test, anaesthesia and early-pregnancy-loss forms.
// 3 (3 Oct 2026): the threatened-miscarriage sheet is no longer for the Abortion type of care (a threatened miscarriage
//   is a continuing pregnancy, under Antenatal – owner's decision); it stays for antenatal and gynaecology care.
export const BUILT_IN_FORMS_VERSION = 3;

const REVIEW = 'Draft wording prepared by the software developer – the hospital must check it, including the Marathi and Hindi translations, and have it legally reviewed before use.';

// In the order they are listed: pregnancy forms in the order of care, then forms for any patient, then newborns.
const META = [
  {
    key: 'hiv_test',
    careTypes: ['antenatal', 'gynaecology', 'infertility', 'abortion'],
    suggestWhen: 'hiv_test_due',
    description: `${REVIEW} HIV and AIDS (Prevention and Control) Act 2017 and NACO guidance: informed consent with pre-test counselling. Compare with the hospital's ICTC / NACO forms.`,
  },
  {
    key: 'high_risk_pregnancy',
    careTypes: ['antenatal'],
    suggestWhen: 'high_risk',
    description: `${REVIEW} For a pregnancy classified as high-risk: the reasons are filled in from the patient's risk level and can be changed before printing.`,
  },
  {
    key: 'labour_delivery',
    careTypes: ['antenatal'],
    suggestWhen: 'from_37_weeks',
    description: `${REVIEW} Taken at admission for delivery; covers labour care, episiotomy, assisted delivery and an emergency caesarean if needed.`,
  },
  {
    key: 'induction',
    careTypes: ['antenatal'],
    suggestWhen: 'from_40_weeks',
    description: `${REVIEW} Methods listed: prostaglandins (vaginal or oral), balloon catheter, amniotomy and oxytocin – adjust to the hospital's practice.`,
  },
  {
    key: 'vbac',
    careTypes: ['antenatal'],
    suggestWhen: 'previous_caesarean',
    description: `${REVIEW} Figures (about 3 in 4 successful, scar rupture about 1 in 200) follow RCOG Green-top Guideline 45 – doctor to confirm.`,
  },
  {
    key: 'caesarean',
    careTypes: ['antenatal'],
    suggestWhen: 'previous_caesarean',
    description: `${REVIEW} Planned or emergency caesarean section; includes consent for hysterectomy for uncontrollable bleeding.`,
  },
  {
    key: 'tubal_ligation',
    careTypes: ['antenatal', 'postnatal', 'gynaecology'],
    suggestWhen: 'none',
    description: `${REVIEW} The Government of India "Standards for Female and Male Sterilization Services" (2014) prescribe a standard consent form: compare, and use the Government form where it is required. Failure rate about 1 in 200 – doctor to confirm.`,
  },
  { key: 'admission', careTypes: [], suggestWhen: 'none', description: `${REVIEW} General consent at admission, for any type of care. Operations, anaesthesia and blood transfusion need their own forms.` },
  { key: 'procedure', careTypes: [], suggestWhen: 'none', description: `${REVIEW} For any operation or procedure: the doctor types the procedure and the reason when printing (or writes them in by hand).` },
  {
    key: 'anaesthesia',
    careTypes: ['antenatal', 'postnatal', 'gynaecology', 'infertility', 'abortion'],
    suggestWhen: 'none',
    description: `${REVIEW} Usually explained and signed with the anaesthetist.`,
  },
  { key: 'blood_transfusion', careTypes: [], suggestWhen: 'none', description: `${REVIEW} Blood and blood products; testing as required by the Drugs and Cosmetics Rules.` },
  { key: 'refusal', careTypes: [], suggestWhen: 'none', description: `${REVIEW} Refusal of advised treatment, or leaving against medical advice (LAMA / DAMA).` },
  { key: 'newborn_care', careTypes: ['newborn'], suggestWhen: 'always', description: `${REVIEW} Signed by a parent or guardian; birth doses as per the national immunisation schedule.` },
];

// Information forms (kind 'information'): the doctor explains a condition or complication to the patient and her
// relatives, and they sign that they were informed. Not a consent. Suggested when the record shows the condition.
const INFO_REVIEW = 'Draft wording prepared by the software developer – the hospital\'s doctor must check the medical content and the Marathi and Hindi translations before use.';
const INFO_META = [
  { key: 'info_hypertension', careTypes: ['antenatal'], suggestWhen: 'blood_pressure', description: `${INFO_REVIEW} Suggested when hypertension is ticked as a condition, or the latest visit has a raised-BP or possible pre-eclampsia red flag. FOGSI GCPR Hypertensive disorders in pregnancy (2019).` },
  { key: 'info_gdm', careTypes: ['antenatal'], suggestWhen: 'diabetes', description: `${INFO_REVIEW} Suggested when diabetes is ticked as a condition, or an OGTT result in this pregnancy is flagged high. MoHFW India GDM guidelines; FOGSI GCPR GDM (2018).` },
  { key: 'info_hypothyroid', careTypes: ['antenatal'], suggestWhen: 'thyroid', description: `${INFO_REVIEW} Suggested when thyroid disease is ticked as a condition, or a TSH result in this pregnancy is flagged high.` },
  { key: 'info_oligohydramnios', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Scan findings are not stored as structured data, so this sheet is not suggested automatically – the doctor chooses it.` },
  { key: 'info_anaemia', careTypes: ['antenatal'], suggestWhen: 'anaemia', description: `${INFO_REVIEW} Suggested when anaemia is ticked, the latest visit has an anaemia red flag, or a haemoglobin result in this pregnancy is below 11 g/dL. Anemia Mukt Bharat (MoHFW 2018).` },
  { key: 'info_cholestasis', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically: there is no bile-acid test in the lab list, and raised liver tests alone can also mean pre-eclampsia – the doctor chooses it. Delivery timing follows RCOG Green-top 43 (2022) – check against the hospital's protocol.` },
  { key: 'info_fgr', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically (scan findings are not structured) – the doctor chooses it.` },
  { key: 'info_placenta_praevia', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically (scan findings are not structured) – the doctor chooses it.` },
  { key: 'info_rh_negative', careTypes: ['antenatal'], suggestWhen: 'rh_negative', description: `${INFO_REVIEW} Suggested when the recorded blood group is Rh negative. Check the anti-D schedule against the hospital's protocol.` },
  { key: 'info_twins', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically – the doctor chooses it.` },
  { key: 'info_breech', careTypes: ['antenatal'], suggestWhen: 'not_head_down', description: `${INFO_REVIEW} Suggested when the latest visit has the "not head-down at term" red flag (36 weeks or more).` },
  { key: 'info_preterm', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically – usually given at admission.` },
  { key: 'info_bad_obstetric_history', careTypes: ['antenatal'], suggestWhen: 'bad_obstetric_history', description: `${INFO_REVIEW} Suggested when problems in earlier pregnancies are ticked, or 2 or more miscarriages / abortions are recorded; those problems are filled in (can be changed before printing).` },
  { key: 'info_hyperemesis', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically – the doctor chooses it.` },
  { key: 'info_threatened_miscarriage', careTypes: ['antenatal', 'gynaecology'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically – the doctor chooses it.` },
  { key: 'info_miscarriage', careTypes: ['antenatal', 'gynaecology', 'abortion'], suggestWhen: 'none', description: `${INFO_REVIEW} The treatment itself (medicines or a procedure) needs a consent form. Not suggested automatically.` },
  { key: 'info_ectopic', careTypes: ['antenatal', 'gynaecology', 'abortion'], suggestWhen: 'none', description: `${INFO_REVIEW} Methotrexate or an operation needs its own consent. Not suggested automatically.` },
  { key: 'info_molar', careTypes: ['antenatal', 'gynaecology', 'abortion'], suggestWhen: 'none', description: `${INFO_REVIEW} Evacuation needs its own consent; check the hCG follow-up schedule against the hospital's protocol. Not suggested automatically.` },
  { key: 'info_polyhydramnios', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically (scan findings are not structured).` },
  { key: 'info_antepartum_haemorrhage', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically – usually given at admission.` },
  { key: 'info_short_cervix', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} A cervical stitch needs its own consent. Not suggested automatically.` },
  { key: 'info_reduced_movements', careTypes: ['antenatal'], suggestWhen: 'reduced_movements', description: `${INFO_REVIEW} Suggested when the latest visit has the reduced or absent fetal movements red flag (28 weeks or more).` },
  { key: 'info_postdates', careTypes: ['antenatal'], suggestWhen: 'from_40_weeks', description: `${INFO_REVIEW} Suggested from 40 weeks. Induction needs its own consent (Induction of labour form).` },
  { key: 'info_iufd', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Written gently on purpose; check it reads kindly in Marathi and Hindi. Not suggested automatically.` },
  { key: 'info_fetal_anomaly', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} The doctor types the finding when printing. Must never mention the sex of the baby (PC&PNDT) – what is typed is checked. Not suggested automatically.` },
  { key: 'info_macrosomia', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Not suggested automatically (estimated weight is not structured).` },
  { key: 'info_heart_disease', careTypes: ['antenatal'], suggestWhen: 'heart_disease', description: `${INFO_REVIEW} Suggested when heart disease is ticked as a condition.` },
  { key: 'info_epilepsy', careTypes: ['antenatal'], suggestWhen: 'epilepsy', description: `${INFO_REVIEW} Suggested when epilepsy is ticked as a condition.` },
  { key: 'info_hepatitis_b', careTypes: ['antenatal'], suggestWhen: 'hepatitis_b', description: `${INFO_REVIEW} Suggested when hepatitis B is ticked as a condition, or an HBsAg result is Reactive. Says that relatives are informed only with her agreement – confirm before they sign.` },
  { key: 'info_obesity', careTypes: ['antenatal'], suggestWhen: 'obesity', description: `${INFO_REVIEW} Suggested when the recorded height and weight give a BMI of 30 or more. Explain with care.` },
  { key: 'info_older_mother', careTypes: ['antenatal'], suggestWhen: 'age_35_plus', description: `${INFO_REVIEW} Suggested when the patient is 35 or older.` },
  { key: 'info_fetal_distress', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} For labour – often explained after an emergency. Not suggested automatically.` },
  { key: 'info_prolonged_labour', careTypes: ['antenatal'], suggestWhen: 'none', description: `${INFO_REVIEW} For labour. Not suggested automatically.` },
  { key: 'info_pph', careTypes: ['antenatal', 'postnatal'], suggestWhen: 'none', description: `${INFO_REVIEW} After delivery. Not suggested automatically.` },
  { key: 'info_puerperal_sepsis', careTypes: ['antenatal', 'postnatal'], suggestWhen: 'none', description: `${INFO_REVIEW} After delivery. Not suggested automatically.` },
  { key: 'info_perineal_tear', careTypes: ['antenatal', 'postnatal'], suggestWhen: 'none', description: `${INFO_REVIEW} After delivery; the repair needs its own consent. Not suggested automatically.` },
  { key: 'info_postnatal_depression', careTypes: ['postnatal'], suggestWhen: 'none', description: `${INFO_REVIEW} Mental health information is confidential (Mental Healthcare Act 2017): relatives are informed only with her agreement. Not suggested automatically.` },
  // Fertility information sheets (idea F4, the owner's go-ahead of 27 Oct 2026): signed as informed, like the pregnancy
  // sheets; the ART Act points as the Act 2021 states them. Never a word about choosing a child's sex.
  { key: 'info_ovulation_induction', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} Ovulation induction with letrozole or clomiphene and follicular monitoring; the cancel rule (more than 2 follicles of 14 mm) and the letrozole off-label note follow the approved fertility protocol library.` },
  { key: 'info_iui', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} IUI with the husband's washed sample; donor sperm needs the ART Act consent separately.` },
  { key: 'info_ivf_icsi', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} Says the hospital refers IVF to a registered ART clinic – change it if the hospital is one. ART (Regulation) Act 2021.` },
  { key: 'info_donor_gametes', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} ART (Regulation) Act 2021: anonymity, screening, the child's legal status. Legal review needed.` },
  { key: 'info_ohss', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} Warning signs and care of OHSS (NICE NG257) – check against the hospital's protocol.` },
  { key: 'info_two_week_wait', careTypes: ['infertility'], suggestWhen: 'none', description: `${INFO_REVIEW} After IUI, the trigger or an embryo transfer, until the pregnancy test.` },
  { key: 'info_condition', careTypes: [], suggestWhen: 'none', description: `${INFO_REVIEW} For any other condition or complication: the doctor types the condition when printing (or writes it in by hand).` },
];

const consentForm = (m, i) => ({
  ...m,
  kind: 'consent',
  order: (i + 1) * 10,
  title: { en: EN[m.key].title, mr: MR[m.key].title, hi: HI[m.key].title },
  clauses: EN[m.key].clauses.map((en, j) => ({ en, mr: MR[m.key].clauses[j] ?? '', hi: HI[m.key].clauses[j] ?? '' })),
});
const informationForm = (m, i) => ({
  ...m,
  kind: 'information',
  order: (i + 1) * 10,
  title: { en: INFO_EN[m.key].title, mr: INFO_MR[m.key].title, hi: INFO_HI[m.key].title },
  clauses: INFO_EN[m.key].clauses.map((en, j) => ({ en, mr: INFO_MR[m.key].clauses[j] ?? '', hi: INFO_HI[m.key].clauses[j] ?? '' })),
});

/** The built-in forms with their words in all three languages, ready to copy into a hospital's library. */
// Information forms are listed in the order of care: early pregnancy, pregnancy, labour, after delivery.
const INFO_ORDER = [
  'info_hyperemesis', 'info_threatened_miscarriage', 'info_miscarriage', 'info_ectopic', 'info_molar',
  'info_hypertension', 'info_gdm', 'info_hypothyroid', 'info_anaemia', 'info_cholestasis', 'info_rh_negative',
  'info_heart_disease', 'info_epilepsy', 'info_hepatitis_b', 'info_obesity', 'info_older_mother',
  'info_bad_obstetric_history', 'info_twins', 'info_oligohydramnios', 'info_polyhydramnios', 'info_fgr',
  'info_macrosomia', 'info_fetal_anomaly', 'info_placenta_praevia', 'info_antepartum_haemorrhage', 'info_short_cervix',
  'info_preterm', 'info_reduced_movements', 'info_breech', 'info_postdates', 'info_iufd',
  'info_fetal_distress', 'info_prolonged_labour',
  'info_pph', 'info_puerperal_sepsis', 'info_perineal_tear', 'info_postnatal_depression',
  'info_ovulation_induction', 'info_iui', 'info_two_week_wait', 'info_ohss', 'info_ivf_icsi', 'info_donor_gametes',
  'info_condition',
];
const infoPlace = (m) => INFO_ORDER.indexOf(m.key);

export const BUILT_IN_FORMS = [...META.map(consentForm), ...[...INFO_META].sort((a, b) => infoPlace(a) - infoPlace(b)).map(informationForm)];
