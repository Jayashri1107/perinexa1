// DRAFT care-plan templates for the other types of care (Version 2), prepared by the software developer (Claude)
// from publicly available guidance – NOT reviewed by a doctor.
//
// ⚠️ Not for clinical use until a qualified doctor has reviewed, corrected and approved each one in the app.
//
// Week 0 is not a pregnancy week here: it is the day of the delivery (postnatal), the day of birth (newborn), or
// the day the plan starts (gynaecology, infertility). fromWeek / toWeek are completed weeks after that day.
// Item fields as in antenatalDraft.js.
//
// Sources (to be checked against the latest versions by the reviewing doctor):
//   - WHO recommendations on maternal and newborn care for a positive postnatal experience (2022): contacts within
//     24 hours, on day 3, between days 7–14 and at 6 weeks; Government of India Home-Based Postnatal Care and
//     Anemia Mukt Bharat (IFA and calcium for 6 months after delivery).
//   - Government of India Universal Immunization Programme (UIP) national immunisation schedule; Indian Academy of
//     Pediatrics guidance for optional vaccines (not included – the doctor adds them).
//   - WHO / Government of India operational guidelines for screening of common cancers (cervical: VIA / HPV
//     testing for women aged 30–65); FOGSI good clinical practice recommendations.
//   - FOGSI / ICMR national guidelines for the evaluation of infertility (2018) and NICE CG156 (fertility problems).
//   - Pregnancy loss: NICE NG126 Ectopic pregnancy and miscarriage (2019, updated 2023); RCOG Green-top Guideline 38
//     Gestational trophoblastic disease (2020) and 21 Ectopic pregnancy (2016); FOGSI / FIGO 2021 (trophoblastic
//     disease); ESHRE Recurrent pregnancy loss (update 2022).

// Built-in postnatal items whose "for which patients" changed when findings in the pregnancy became tick boxes
// (4 Oct 2026): the BP check and the sugar test after delivery are meant for high blood pressure and diabetes
// found IN the pregnancy too (their sources say so), not only for the conditions she had before it. `from`: what
// the built-in item said before. A hospital whose postnatal template is still the untouched built-in draft gets
// the change by itself; a template a doctor has approved or edited is never changed by an upgrade – its page
// offers the change and a doctor accepts it as a new draft version (careplans/templatesService.js).
export const POSTNATAL_FINDING_CHANGES = [
  { key: 'pnc_bp', from: { appliesWhen: 'hypertension' } },
  { key: 'pnc_sugar', from: { appliesWhen: 'diabetes' } },
];

export const POSTNATAL_DRAFT = {
  name: 'Standard postnatal care (WHO / Government of India) – DRAFT',
  description: 'Postnatal schedule for the mother, counted from the day of delivery. Must be reviewed and approved by a doctor before use.',
  sources: 'WHO postnatal care recommendations 2022; MoHFW Home-Based Postnatal Care; Anemia Mukt Bharat.',
  items: [
    { key: 'pnc_day1', kind: 'visit', name: 'Postnatal check within 24 hours (bleeding, BP, breastfeeding)', patientText: 'Check-up on the day after delivery', fromWeek: 0, toWeek: 0, source: 'WHO 2022: first contact within 24 hours' },
    { key: 'pnc_day3', kind: 'visit', name: 'Postnatal check (day 3)', patientText: 'Check-up about 3 days after delivery', fromWeek: 0, toWeek: 0, source: 'WHO 2022 / MoHFW HBPNC: day 3' },
    { key: 'pnc_wk1', kind: 'visit', name: 'Postnatal check (days 7–14): wound or perineum, breastfeeding, mood', patientText: 'Check-up 1–2 weeks after delivery', fromWeek: 1, toWeek: 2, source: 'WHO 2022: between day 7 and 14' },
    { key: 'pnc_cs_wound', kind: 'visit', name: 'Caesarean wound check and stitch removal if needed (7–10 days)', patientText: 'Wound check about a week after the operation', fromWeek: 1, toWeek: 1, appliesWhen: 'previous_caesarean', source: 'Indian practice; doctor to confirm' },
    { key: 'pnc_wk6', kind: 'visit', name: 'Postnatal check (6 weeks): recovery, BP, contraception', patientText: 'Check-up 6 weeks after delivery', fromWeek: 6, toWeek: 7, source: 'WHO 2022 / MoHFW: 6 weeks' },
    { key: 'pnc_hb', kind: 'investigation', name: 'Haemoglobin (anaemia check)', patientText: 'Blood test for haemoglobin at 6 weeks', fromWeek: 6, toWeek: 7, source: 'Anemia Mukt Bharat' },
    { key: 'pnc_bp', kind: 'visit', name: 'BP check within the first week (hypertension)', patientText: 'Blood pressure check in the first week', fromWeek: 0, toWeek: 1, appliesWhen: 'hypertension_any', source: 'WHO 2022; doctor to confirm for hypertensive disorders of pregnancy' },
    { key: 'pnc_sugar', kind: 'investigation', name: 'Blood sugar review (diabetes)', patientText: 'Blood sugar test after delivery', fromWeek: 6, toWeek: 12, appliesWhen: 'diabetes_any', source: 'MoHFW GDM guidance: 75 g OGTT 6–12 weeks after delivery after GDM; doctor to confirm' },
    { key: 'pnc_antid', kind: 'vaccination', name: 'Anti-D within 72 hours (Rh-negative mother, Rh-positive baby)', patientText: 'Anti-D injection soon after delivery', fromWeek: 0, toWeek: 0, appliesWhen: 'rh_negative', source: 'Standard practice; doctor to confirm the baby’s blood group' },
    { key: 'pnc_ifa', kind: 'medication', name: 'Iron and folic acid daily for 6 months', patientText: 'Iron tablets every day for 6 months', fromWeek: 0, toWeek: 1, source: 'Anemia Mukt Bharat' },
    { key: 'pnc_calcium', kind: 'medication', name: 'Calcium daily for 6 months', patientText: 'Calcium tablets every day for 6 months', fromWeek: 0, toWeek: 1, source: 'MoHFW' },
    { key: 'pnc_adv_bf', kind: 'advice', name: 'Exclusive breastfeeding for 6 months', patientText: 'Give only breast milk for the first 6 months', fromWeek: 0, toWeek: 0, source: 'WHO / MoHFW' },
    { key: 'pnc_adv_danger', kind: 'advice', name: 'Danger signs (heavy bleeding, fever, foul discharge, severe headache, breathlessness)', patientText: 'Come at once for heavy bleeding, fever, bad-smelling discharge, severe headache or breathlessness', fromWeek: 0, toWeek: 0, source: 'WHO 2022' },
    { key: 'pnc_adv_contra', kind: 'advice', name: 'Family planning counselling (PPIUCD, other methods)', patientText: 'Talk about family planning', fromWeek: 6, toWeek: 7, source: 'MoHFW postpartum family planning' },
  ],
};

export const NEWBORN_DRAFT = {
  name: 'Newborn care and immunisation (Government of India UIP) – DRAFT',
  description: 'Newborn checks and the national immunisation schedule, counted from the day of birth. Must be reviewed and approved by a doctor before use.',
  sources: 'Government of India Universal Immunization Programme schedule; WHO newborn care; MoHFW Home-Based Newborn Care.',
  items: [
    { key: 'nb_exam', kind: 'visit', name: 'Newborn examination within 24 hours', patientText: 'Baby’s first check-up', fromWeek: 0, toWeek: 0, source: 'WHO / MoHFW' },
    { key: 'nb_check', kind: 'visit', name: 'Newborn check (days 3–7): weight, jaundice, feeding, cord', patientText: 'Baby check-up in the first week', fromWeek: 0, toWeek: 1, source: 'MoHFW HBNC' },
    // Newborn tests (owner, 2 Oct 2026): done by the lab or the nursery; a reviewed result ticks the item off.
    { key: 'nb_lab_screening', kind: 'investigation', name: 'Newborn screening (heel prick) after 48 hours: hypothyroidism, G6PD, CAH, galactosaemia, PKU, biotinidase', patientText: 'Heel-prick blood test for the baby (after 2 days of age)', fromWeek: 0, toWeek: 0, source: 'MoHFW RBSK newborn screening' },
    { key: 'nb_cchd', kind: 'investigation', name: 'Pulse-oximetry heart screen (CCHD) after 24 hours, before going home', patientText: "Oxygen check on the baby's hand and foot", fromWeek: 0, toWeek: 0, source: 'AAP / AHA critical congenital heart disease screening' },
    { key: 'nb_hearing', kind: 'investigation', name: 'Hearing screen (OAE) before going home, or by 1 month', patientText: "Baby's hearing test", fromWeek: 0, toWeek: 4, source: 'MoHFW RBSK; JCIH 1-3-6 (screen by 1 month)' },
    { key: 'nb_vacc_birth', kind: 'vaccination', name: 'Birth doses: BCG, OPV-0, Hepatitis B (birth dose)', patientText: 'Vaccines at birth: BCG, polio drops, Hepatitis B', fromWeek: 0, toWeek: 0, source: 'UIP: at birth (Hep B within 24 hours)' },
    { key: 'nb_vacc_6w', kind: 'vaccination', name: '6 weeks: OPV-1, Pentavalent-1, Rotavirus-1, fIPV-1, PCV-1', patientText: 'Vaccines at 6 weeks', fromWeek: 6, toWeek: 7, source: 'UIP' },
    { key: 'nb_vacc_10w', kind: 'vaccination', name: '10 weeks: OPV-2, Pentavalent-2, Rotavirus-2', patientText: 'Vaccines at 10 weeks', fromWeek: 10, toWeek: 11, source: 'UIP' },
    { key: 'nb_vacc_14w', kind: 'vaccination', name: '14 weeks: OPV-3, Pentavalent-3, Rotavirus-3, fIPV-2, PCV-2', patientText: 'Vaccines at 14 weeks', fromWeek: 14, toWeek: 15, source: 'UIP' },
    { key: 'nb_vacc_9m', kind: 'vaccination', name: '9 months: MR-1, PCV booster, fIPV-3, JE-1 (where endemic)', patientText: 'Vaccines at 9 months (measles–rubella)', fromWeek: 39, toWeek: 52, source: 'UIP (9–12 months)' },
    { key: 'nb_vita_1', kind: 'medication', name: 'Vitamin A, first dose (9 months)', patientText: 'Vitamin A at 9 months', fromWeek: 39, toWeek: 52, source: 'UIP' },
    { key: 'nb_vacc_16m', kind: 'vaccination', name: '16–24 months: MR-2, DPT booster-1, OPV booster, JE-2 (where endemic)', patientText: 'Vaccines at 16–24 months', fromWeek: 69, toWeek: 104, source: 'UIP' },
    { key: 'nb_vita_2', kind: 'medication', name: 'Vitamin A, second dose (16 months), then every 6 months till 5 years', patientText: 'Vitamin A every 6 months till 5 years', fromWeek: 69, toWeek: 78, source: 'UIP' },
    { key: 'nb_vacc_5y', kind: 'vaccination', name: '5–6 years: DPT booster-2', patientText: 'Vaccine at 5–6 years', fromWeek: 260, toWeek: 312, source: 'UIP' },
    { key: 'nb_vacc_10y', kind: 'vaccination', name: '10 years: Td', patientText: 'Vaccine at 10 years', fromWeek: 520, toWeek: 572, source: 'UIP' },
    { key: 'nb_vacc_16y', kind: 'vaccination', name: '16 years: Td', patientText: 'Vaccine at 16 years', fromWeek: 832, toWeek: 884, source: 'UIP' },
    { key: 'nb_adv_bf', kind: 'advice', name: 'Exclusive breastfeeding for 6 months; keep warm; cord care', patientText: 'Only breast milk for 6 months, keep the baby warm, keep the cord dry', fromWeek: 0, toWeek: 0, source: 'WHO / MoHFW' },
    { key: 'nb_adv_danger', kind: 'advice', name: 'Danger signs (poor feeding, fast breathing, fever or cold, yellow skin, convulsions)', patientText: 'Come at once if the baby feeds poorly, breathes fast, is hot or cold, turns yellow or has fits', fromWeek: 0, toWeek: 0, source: 'WHO IMNCI' },
  ],
};

export const GYNAECOLOGY_DRAFT = {
  name: 'Routine gynaecology care (WHO / Government of India / FOGSI) – DRAFT',
  description: 'Well-woman checks counted from the first gynaecology visit. Must be reviewed and approved by a doctor before use.',
  sources: 'WHO and MoHFW operational guidelines for screening of common cancers; FOGSI good clinical practice recommendations.',
  items: [
    { key: 'gyn_first', kind: 'visit', name: 'Gynaecology consultation (history, examination)', patientText: 'First check-up', atBooking: true, source: 'Standard practice' },
    { key: 'gyn_hb', kind: 'investigation', name: 'Haemoglobin (anaemia screening)', patientText: 'Blood test for haemoglobin', atBooking: true, source: 'Anemia Mukt Bharat' },
    { key: 'gyn_breast', kind: 'visit', name: 'Clinical breast examination', patientText: 'Breast examination', atBooking: true, source: 'MoHFW screening of common cancers' },
    { key: 'gyn_cervix', kind: 'investigation', name: 'Cervical cancer screening if due (VIA / Pap / HPV test; women 30–65)', patientText: 'Test for cervical cancer (if due)', atBooking: true, source: 'WHO / MoHFW: women 30–65; doctor decides by age and earlier results' },
    { key: 'gyn_review', kind: 'visit', name: 'Follow-up with reports', patientText: 'Come back with the reports', fromWeek: 2, toWeek: 6, source: 'Standard practice' },
    { key: 'gyn_annual', kind: 'visit', name: 'Annual gynaecology review', patientText: 'Yearly check-up', fromWeek: 52, toWeek: 56, source: 'FOGSI' },
    { key: 'gyn_cervix_repeat', kind: 'investigation', name: 'Repeat cervical screening (if the last result was normal)', patientText: 'Repeat cervical cancer test', fromWeek: 156, toWeek: 164, source: 'Pap every 3 years / HPV every 5 years; doctor decides' },
  ],
};

export const INFERTILITY_DRAFT = {
  name: 'Infertility evaluation (FOGSI / ICMR / NICE) – DRAFT',
  description: 'First evaluation of the couple, counted from the first fertility visit. Must be reviewed and approved by a doctor before use.',
  sources: 'ICMR national guidelines for infertility evaluation (2018); FOGSI; NICE CG156 Fertility problems.',
  items: [
    { key: 'inf_first', kind: 'visit', name: 'Fertility consultation (history of both partners, examination)', patientText: 'First fertility check-up (please come with your partner)', atBooking: true, source: 'ICMR / NICE' },
    { key: 'inf_folic', kind: 'medication', name: 'Folic acid daily while trying to conceive', patientText: 'Folic acid tablet every day', atBooking: true, source: 'NICE CG156 / WHO' },
    { key: 'inf_hormones', kind: 'investigation', name: 'Day 2–3 hormones: FSH, LH, AMH, TSH, prolactin', patientText: 'Blood tests on day 2–3 of the period', fromWeek: 0, toWeek: 5, source: 'ICMR / FOGSI' },
    { key: 'inf_tvs', kind: 'scan', name: 'Baseline transvaginal scan (antral follicle count, uterus, ovaries)', patientText: 'Scan early in the cycle', fromWeek: 0, toWeek: 5, source: 'ICMR / FOGSI' },
    { key: 'inf_semen', kind: 'investigation', name: 'Semen analysis (partner)', patientText: 'Semen test for your partner', atBooking: true, source: 'WHO 2021 laboratory manual; ICMR' },
    { key: 'inf_infections', kind: 'investigation', name: 'Rubella immunity; HIV, HBsAg, HCV, VDRL (both partners)', patientText: 'Blood tests for both partners', atBooking: true, source: 'NICE CG156 / ICMR' },
    { key: 'inf_tubal', kind: 'investigation', name: 'Tubal patency test (HSG / sono-HSG), days 6–10 of the cycle', patientText: 'Test to check the tubes', fromWeek: 1, toWeek: 8, source: 'ICMR / NICE' },
    { key: 'inf_review', kind: 'visit', name: 'Review with all reports and treatment plan', patientText: 'Come back with all the reports', fromWeek: 4, toWeek: 8, source: 'Standard practice' },
    { key: 'inf_review_3m', kind: 'visit', name: 'Treatment review (3 months)', patientText: 'Check-up after 3 months', fromWeek: 12, toWeek: 14, source: 'Standard practice; doctor decides' },
    { key: 'inf_adv', kind: 'advice', name: 'Lifestyle: weight, no smoking or alcohol, timed intercourse', patientText: 'Healthy weight, no smoking or alcohol; your doctor explains the fertile days', atBooking: true, source: 'NICE CG156' },
  ],
};

// Care after a pregnancy loss (the Abortion type of care; 5 Oct 2026): a miscarriage, an ectopic or a molar pregnancy,
// and the work-up for recurrent loss – nothing else is recorded in this type of care. Week 0 is the day the loss was
// diagnosed (the "date seen" on the record), so "2 weeks" is 2 weeks after that day; days 2, 4 and 7 fall in weeks 0
// and 1 (the item's name gives the day). Which items apply follows the record's Pregnancy loss section: the type of
// loss, its management, the anti-D answer, and the Abortions (A) count (planEngine.js lossFacts).
// A follow-up that runs "until normal" cannot be one item: it is a row of dated tests, and the doctor marks the rest
// "not needed" once the result is normal (or adds one when it is not).
// The words for the patient never name the loss: they are printed on her copy and shown in the patient portal.
// The beta hCG schedules chosen for this draft, with their sources (5 Oct 2026). Molar: every 2 weeks to 8 weeks,
// then monthly to 6 months. Ectopic managed by waiting: days 2, 4 and 7, then weekly (NICE NG126 – its own
// recommendation for expectant management). Ectopic treated with methotrexate: days 4 and 7 after the injection, then
// weekly until negative – NICE NG126's follow-up after methotrexate, the same days as the single-dose protocol of RCOG
// Green-top Guideline 21, so the items name both (the doctor confirms against the current documents). After an
// operation the items do not apply by themselves: after a salpingotomy (the tube kept) NICE NG126 advises hCG again –
// the source says so, and the doctor includes the items (Include on the plan).
// Each source fits the template's 400 characters.
const MOLAR_HCG_SOURCE =
  'RCOG Green-top Guideline 38 (2020): complete mole – follow up for 6 months from the evacuation if hCG is normal within 56 days, otherwise 6 months from the first normal value; partial mole – ends when hCG is normal on two samples at least 4 weeks apart. Every 2 weeks until normal: UK centres. FOGSI / FIGO 2021: every 1–2 weeks until normal, then monthly – how long varies. Doctor to confirm.';
const ECTOPIC_HCG_SOURCE =
  'Waiting – NICE NG126 (2019, updated 2023): hCG days 2, 4, 7, then weekly until negative (under 20 IU/L) if it falls 15% or more each time. Methotrexate – NICE NG126 and RCOG GTG 21 (2016): days 4 and 7, then weekly until negative. After a salpingotomy (tube kept) NICE NG126 also advises hCG follow-up: include these items yourself. Move an item if day 0 was another day. Doctor to confirm.';
const HCG_PATIENT = 'Blood test (beta hCG)';
const molarHcg = (key, when, fromWeek, toWeek, schedule = 'every 2 weeks until normal') => ({
  key, kind: 'investigation', name: `Beta hCG after molar pregnancy – ${schedule} (RCOG GTG 38): ${when}`, patientText: HCG_PATIENT, fromWeek, toWeek, appliesWhen: 'loss_molar', source: MOLAR_HCG_SOURCE,
});
const ectopicHcg = (key, name, week, appliesWhen = 'loss_ectopic_hcg') => ({ key, kind: 'investigation', name, patientText: HCG_PATIENT, fromWeek: week, toWeek: week, appliesWhen, source: ECTOPIC_HCG_SOURCE });
const ectopicWeekly = (week, more = '') => ectopicHcg(`loss_ect_hcg_w${week}`, `Beta hCG, ectopic follow-up – weekly until negative (NICE NG126; RCOG GTG 21): week ${week}${more}`, week);

export const ABORTION_DRAFT = {
  name: 'Care after pregnancy loss (NICE / RCOG / FOGSI / ESHRE) – DRAFT',
  description:
    'Follow-up after a miscarriage, an ectopic or a molar pregnancy, and the work-up for recurrent loss, counted from the day the loss was diagnosed (the date seen on the record). Which items apply follows the type of loss, its management, the anti-D answer and the Abortions (A) count on the record. Must be reviewed and approved by a doctor before use.',
  sources:
    'NICE NG126 Ectopic pregnancy and miscarriage (2019, updated 2023); RCOG Green-top Guideline 38 Gestational trophoblastic disease (2020) and 21 Ectopic pregnancy (2016); FOGSI / FIGO 2021 (trophoblastic disease); ESHRE Recurrent pregnancy loss (update 2022); WHO Medical eligibility criteria for contraceptive use (2015); Anemia Mukt Bharat.',
  items: [
    // For every loss cared for now (loss_now) – not for a record that is only for the recurrent-loss work-up, where
    // she is not pregnant now and there is no recent bleeding to follow up.
    { key: 'loss_followup', kind: 'visit', name: 'Follow-up visit 1–2 weeks after the loss: bleeding, pain, fever, how she is coping; the report of any tissue sent', patientText: 'Follow-up check-up in 1–2 weeks', fromWeek: 1, toWeek: 2, appliesWhen: 'loss_now', source: 'Standard practice; doctor to confirm the interval' },
    { key: 'loss_hb', kind: 'investigation', name: 'Haemoglobin (anaemia after blood loss)', patientText: 'Blood test for haemoglobin', fromWeek: 0, toWeek: 2, appliesWhen: 'loss_now', source: 'Anemia Mukt Bharat; standard practice after blood loss' },
    // The anti-D reminder the app already has (the record's Anti-D answer, the "Rh negative – anti-D" line of the
    // safety strip): the item applies exactly while that line shows, and stops once the answer is recorded.
    { key: 'loss_antid', kind: 'vaccination', name: 'Anti-D for an Rh-negative woman, within 72 hours – record it under Pregnancy loss (Edit details)', patientText: 'Anti-D injection (Rh negative)', fromWeek: 0, toWeek: 0, appliesWhen: 'loss_anti_d_due',
      source: 'NICE NG126: offer after surgical management of a miscarriage or an ectopic pregnancy; not after medical or expectant management alone, or a complete miscarriage. Many Indian units give it to every Rh-negative woman – doctor decides. The item stops applying once anti-D is recorded as given or not needed.' },
    { key: 'loss_adv_contraception', kind: 'advice', name: 'Contraception: ask what she wishes – fertility can return before the next period', patientText: 'Talk about family planning', fromWeek: 0, toWeek: 2, appliesWhen: 'loss_now',
      source: 'WHO Medical eligibility criteria for contraceptive use (2015): most methods can be started straight after a loss in the first 12 weeks; after a molar pregnancy see its own item. Doctor to confirm.' },
    { key: 'loss_adv_next', kind: 'advice', name: 'Next pregnancy: folic acid before trying, early booking; when to try again is for her and the doctor to decide (after methotrexate: wait at least 3 months)', patientText: 'Advice for planning your next pregnancy', fromWeek: 1, toWeek: 2,
      source: 'WHO technical consultation on birth spacing (2005): 6 months after a miscarriage – later studies find no harm in conceiving sooner. RCOG Green-top Guideline 21 (2016): wait at least 3 months after methotrexate. Doctor to advise.' },
    // Molar pregnancy: beta hCG every 2 weeks until normal, then monthly to 6 months (the schedule chosen for this draft)
    molarHcg('loss_molar_hcg_2w', '2 weeks', 2, 2),
    molarHcg('loss_molar_hcg_4w', '4 weeks', 4, 4),
    molarHcg('loss_molar_hcg_6w', '6 weeks', 6, 6),
    molarHcg('loss_molar_hcg_8w', '8 weeks (56 days). Not normal yet: keep testing every 2 weeks', 8, 8),
    molarHcg('loss_molar_hcg_3m', '3 months', 13, 14, 'monthly once normal, to 6 months'),
    molarHcg('loss_molar_hcg_4m', '4 months', 17, 18, 'monthly once normal, to 6 months'),
    molarHcg('loss_molar_hcg_5m', '5 months', 21, 22, 'monthly once normal, to 6 months'),
    molarHcg('loss_molar_hcg_6m', '6 months – the last test for a complete mole whose hCG was normal within 56 days', 26, 27, 'monthly once normal, to 6 months'),
    { key: 'loss_molar_adv', kind: 'advice', name: 'Molar pregnancy: no new pregnancy until hCG follow-up is complete; contraception – no intrauterine device until hCG is normal', patientText: 'Please avoid a new pregnancy until your doctor says the follow-up is complete', fromWeek: 0, toWeek: 2, appliesWhen: 'loss_molar',
      source: 'RCOG Green-top Guideline 38 (2020): no pregnancy until follow-up ends; RCOG has advised barrier methods until hCG is normal. WHO Medical eligibility criteria (2015): with hCG falling or undetectable, pills, injections and implants are category 1 and an intrauterine device category 3. The two differ – the doctor confirms the current advice.' },
    // Ectopic pregnancy managed by waiting or with methotrexate (NICE NG126; RCOG GTG 21). The day 2, 4 and 7 tests are
    // ticked by the doctor – a reviewed lab result does not tick them (lab/labTests.js: the first test on the date
    // seen would otherwise count as "day 2").
    ectopicHcg('loss_ect_hcg_d2', 'Beta hCG, ectopic managed by waiting (NICE NG126): day 2', 0, 'loss_ectopic_expectant'),
    ectopicHcg('loss_ect_hcg_d4', 'Beta hCG, ectopic managed by waiting or with methotrexate (NICE NG126; RCOG GTG 21): day 4', 0),
    ectopicHcg('loss_ect_hcg_d7', 'Beta hCG, ectopic managed by waiting or with methotrexate (NICE NG126; RCOG GTG 21): day 7, then weekly until negative', 1),
    ectopicWeekly(2),
    ectopicWeekly(3),
    ectopicWeekly(4),
    ectopicWeekly(5),
    ectopicWeekly(6, '. Still positive: keep testing weekly'),
    // The recurrent-loss work-up: from the loss numbered RECURRENT_WORKUP_FROM_LOSSES (patients/abortionRules.js). The
    // number is NOT written into the item's words: they are stored in each hospital's template once, and would go
    // on saying the old number if the setting changed. The screens give it from the setting ("Only from the third
    // loss …", the template's "applies when").
    { key: 'loss_rpl_workup', kind: 'investigation', name: 'Recurrent-loss work-up (the doctor decides when; ESHRE 2022 advises it after two losses): antiphospholipid antibodies, TSH and TPO antibodies, uterine anatomy', patientText: 'Tests your doctor will explain', fromWeek: 0, toWeek: 8, appliesWhen: 'loss_recurrent',
      source: 'ESHRE Recurrent pregnancy loss (2022): antiphospholipid antibodies, thyroid tests and the uterus after two losses; parental karyotype and thrombophilia tests only after assessment. Applies from the number of losses set in the app, counted from Abortions (A) – which may include losses that were not spontaneous: the doctor confirms, and decides for each woman.' },
  ],
};

/** Which day is week 0 for each type of care (antenatal: the pregnancy, from the EDD). loss: the date the loss was diagnosed. */
export const START_WORDS = { postnatal: 'delivery', newborn: 'birth', gynaecology: 'start', infertility: 'start', abortion: 'loss' };
