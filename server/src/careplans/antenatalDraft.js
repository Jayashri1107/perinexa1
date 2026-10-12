// DRAFT antenatal care-plan template, prepared by the software developer (Claude) from publicly
// available guidance – NOT reviewed by a doctor.
//
// ⚠️ Not for clinical use until a qualified obstetrician has reviewed, corrected and approved it in the app.
//
// Sources this draft was built from (to be verified against the latest versions by the reviewing doctor):
//   - WHO recommendations on antenatal care for a positive pregnancy experience (2016): 8 contacts
//     (first by 12 weeks, then 20, 26, 30, 34, 36, 38, 40 weeks).
//   - Government of India / MoHFW antenatal care guidance (e.g. "Maternal and Newborn Health Toolkit",
//     GDM diagnosis & management guidelines, Anemia Mukt Bharat): minimum 4 ANC visits, universal
//     GDM screening (75 g OGTT) at first visit and at 24–28 weeks, iron-folic acid and calcium from the
//     second trimester, deworming in the second trimester, Td immunisation.
//   - FOGSI good clinical practice recommendations (antenatal care, thyroid in pregnancy, Tdap and
//     influenza vaccination in pregnancy).
// Where the sources differ, this draft takes the more frequent schedule and marks the choice in the
// "source" text so the reviewing doctor can decide.
//
// Item fields:
//   key          – short unique id within the template
//   kind         – visit | investigation | scan | vaccination | medication | advice
//   name         – what staff see
//   patientText  – plain-language text for the patient's printout
//   atBooking    – due at the first (booking) visit, whatever the week
//   fromWeek, toWeek – window in completed weeks of pregnancy (inclusive)
//   after        – { key, weeks }: due this many weeks after another item (e.g. second Td dose)
//   appliesWhen  – always | high_risk | rh_negative | previous_caesarean | diabetes | hypertension (the
//                  pre-existing conditions) | gdm | pregnancy_hypertension | multiple_pregnancy | placenta_praevia |
//                  bleeding (findings a doctor or RMO ticked for this pregnancy) | diabetes_any | hypertension_any
//   source       – which guideline the item comes from (for the reviewing doctor)

// Increase when the built-in draft risk rules change. Only copies that no doctor has ever approved or edited are
// refreshed by themselves; for every other hospital, list the new rules in BUILT_IN_ADDITIONS
// (careplans/templatesService.js) so the template's page offers them to a doctor.
// 5 = rules on findings in this pregnancy and on measured readings (lowest haemoglobin, latest blood pressure).
export const RISK_RULES_VERSION = 5;

// Built-in items and rules added for findings in this pregnancy (4 Oct 2026), by key. A hospital whose template is
// still the untouched built-in draft gets them by itself; a template a doctor has approved (at any time) or edited
// is never changed by an upgrade – the template page offers them and a doctor adds them, and only them
// (careplans/templatesService.js).
export const FINDING_ITEM_KEYS = ['scan_twins_24', 'scan_twins_28', 'scan_growth_gdm', 'scan_twins_32', 'scan_placenta_32', 'adv_twins_placentas'];
export const FINDING_RULE_KEYS = [
  'preg_gdm',
  'preg_hypertension',
  'preg_multiple',
  'preg_placenta_praevia',
  'preg_bleeding',
  'hb_under_7',
  'hb_under_11',
  'bp_systolic_140',
  'bp_diastolic_90',
];

export const ANTENATAL_DRAFT = {
  name: 'Standard antenatal care (FOGSI / WHO / Government of India) – DRAFT',
  description:
    'Combined antenatal schedule drafted from WHO 2016, Government of India (MoHFW) and FOGSI guidance. Must be reviewed and approved by a doctor before use.',
  sources: 'WHO ANC recommendations 2016; MoHFW (Government of India) ANC, GDM and Anemia Mukt Bharat guidance; FOGSI good clinical practice recommendations.',
  items: [
    // ── Visits ──────────────────────────────────────────────────────────────────────────────
    { key: 'visit_booking', kind: 'visit', name: 'Booking visit (registration, history, examination)', patientText: 'First pregnancy check-up', atBooking: true, source: 'WHO: first contact by 12 weeks; MoHFW: first visit as early as possible, before 12 weeks' },
    { key: 'visit_16', kind: 'visit', name: 'Antenatal visit (16 weeks)', patientText: 'Check-up at about 16 weeks', fromWeek: 15, toWeek: 17, source: 'FOGSI/Indian practice: 4-weekly visits in the second trimester' },
    { key: 'visit_20', kind: 'visit', name: 'Antenatal visit (20 weeks)', patientText: 'Check-up at about 20 weeks', fromWeek: 19, toWeek: 21, source: 'WHO contact 2 (20 weeks)' },
    { key: 'visit_24', kind: 'visit', name: 'Antenatal visit (24–26 weeks)', patientText: 'Check-up at about 24–26 weeks', fromWeek: 24, toWeek: 26, source: 'WHO contact 3 (26 weeks); MoHFW visit 2 (14–26 weeks)' },
    { key: 'visit_28', kind: 'visit', name: 'Antenatal visit (28–30 weeks)', patientText: 'Check-up at about 28–30 weeks', fromWeek: 28, toWeek: 30, source: 'WHO contact 4 (30 weeks); MoHFW visit 3 (28–34 weeks)' },
    { key: 'visit_32', kind: 'visit', name: 'Antenatal visit (32 weeks)', patientText: 'Check-up at about 32 weeks', fromWeek: 31, toWeek: 33, source: 'FOGSI/Indian practice: 2-weekly visits from 28 to 36 weeks' },
    { key: 'visit_34', kind: 'visit', name: 'Antenatal visit (34 weeks)', patientText: 'Check-up at about 34 weeks', fromWeek: 34, toWeek: 35, source: 'WHO contact 5 (34 weeks)' },
    { key: 'visit_36', kind: 'visit', name: 'Antenatal visit (36 weeks)', patientText: 'Check-up at 36 weeks', fromWeek: 36, toWeek: 36, source: 'WHO contact 6 (36 weeks); MoHFW visit 4 (36 weeks–term)' },
    { key: 'visit_37', kind: 'visit', name: 'Antenatal visit (37 weeks)', patientText: 'Check-up at 37 weeks', fromWeek: 37, toWeek: 37, source: 'FOGSI/Indian practice: weekly visits from 36 weeks' },
    { key: 'visit_38', kind: 'visit', name: 'Antenatal visit (38 weeks)', patientText: 'Check-up at 38 weeks', fromWeek: 38, toWeek: 38, source: 'WHO contact 7 (38 weeks)' },
    { key: 'visit_39', kind: 'visit', name: 'Antenatal visit (39 weeks)', patientText: 'Check-up at 39 weeks', fromWeek: 39, toWeek: 39, source: 'FOGSI/Indian practice: weekly visits from 36 weeks' },
    { key: 'visit_40', kind: 'visit', name: 'Antenatal visit (40 weeks) – plan for delivery', patientText: 'Check-up at 40 weeks (due date)', fromWeek: 40, toWeek: 40, source: 'WHO contact 8 (40 weeks)' },
    { key: 'visit_41', kind: 'visit', name: 'Post-dates assessment (41 weeks) if not delivered', patientText: 'Check-up at 41 weeks if baby not yet born', fromWeek: 41, toWeek: 41, source: 'Common practice: review for induction at 41 weeks – doctor to confirm' },

    // ── Investigations ─────────────────────────────────────────────────────────────────────
    { key: 'lab_cbc', kind: 'investigation', name: 'Complete blood count (Hb)', patientText: 'Blood test (haemoglobin)', atBooking: true, source: 'MoHFW / Anemia Mukt Bharat: Hb at first visit' },
    { key: 'lab_group', kind: 'investigation', name: 'Blood group and Rh typing', patientText: 'Blood group test', atBooking: true, source: 'WHO, MoHFW, FOGSI' },
    { key: 'lab_urine', kind: 'investigation', name: 'Urine routine and microscopy (protein, sugar)', patientText: 'Urine test', atBooking: true, source: 'MoHFW; urine protein at every visit' },
    { key: 'lab_ogtt1', kind: 'investigation', name: 'GDM screening: 75 g OGTT (2-hour plasma glucose)', patientText: 'Sugar test (glucose drink test)', atBooking: true, source: 'MoHFW GDM guidelines: universal screening at first visit' },
    { key: 'lab_hiv', kind: 'investigation', name: 'HIV test (with counselling)', patientText: 'HIV test', atBooking: true, source: 'MoHFW / NACO: universal antenatal HIV testing' },
    { key: 'lab_vdrl', kind: 'investigation', name: 'Syphilis test (VDRL / RPR)', patientText: 'Syphilis blood test', atBooking: true, source: 'WHO, MoHFW' },
    { key: 'lab_hbsag', kind: 'investigation', name: 'Hepatitis B (HBsAg)', patientText: 'Hepatitis B blood test', atBooking: true, source: 'FOGSI / MoHFW' },
    { key: 'lab_tsh', kind: 'investigation', name: 'Thyroid test (TSH)', patientText: 'Thyroid blood test', atBooking: true, source: 'FOGSI: universal thyroid screening in pregnancy recommended in India – doctor to confirm' },
    { key: 'lab_ict1', kind: 'investigation', name: 'Indirect Coombs test (ICT)', patientText: 'Antibody blood test (Rh negative)', atBooking: true, appliesWhen: 'rh_negative', source: 'FOGSI: ICT for Rh-negative mothers at booking' },
    { key: 'lab_ogtt2', kind: 'investigation', name: 'GDM screening: repeat 75 g OGTT', patientText: 'Repeat sugar test', fromWeek: 24, toWeek: 28, source: 'MoHFW GDM guidelines: repeat at 24–28 weeks if first test normal' },
    { key: 'lab_hb28', kind: 'investigation', name: 'Repeat haemoglobin', patientText: 'Repeat blood test (haemoglobin)', fromWeek: 28, toWeek: 30, source: 'MoHFW: Hb in each trimester' },
    { key: 'lab_ict28', kind: 'investigation', name: 'Repeat indirect Coombs test (ICT)', patientText: 'Repeat antibody blood test', fromWeek: 28, toWeek: 28, appliesWhen: 'rh_negative', source: 'FOGSI: repeat ICT at 28 weeks before anti-D' },
    { key: 'lab_hb36', kind: 'investigation', name: 'Haemoglobin and urine before delivery', patientText: 'Blood and urine tests before delivery', fromWeek: 36, toWeek: 37, source: 'Common practice before delivery – doctor to confirm' },

    // ── Scans (ultrasound) ─────────────────────────────────────────────────────────────────
    // PCPNDT: fetal sex must never be recorded or disclosed.
    { key: 'scan_dating', kind: 'scan', name: 'Dating / viability scan', patientText: 'First ultrasound (to confirm dates)', fromWeek: 6, toWeek: 10, source: 'FOGSI / common practice: first-trimester dating scan' },
    { key: 'scan_nt', kind: 'scan', name: 'NT scan with first-trimester combined screening (double marker)', patientText: 'Ultrasound and blood test for baby’s health (11–13 weeks)', fromWeek: 11, toWeek: 13, source: 'FOGSI: combined first-trimester screening at 11–13+6 weeks' },
    { key: 'scan_anomaly', kind: 'scan', name: 'Anomaly scan (level II / TIFFA)', patientText: 'Detailed ultrasound of baby (18–20 weeks)', fromWeek: 18, toWeek: 20, source: 'FOGSI / WHO: one ultrasound before 24 weeks; 18–20 weeks usual in India' },
    { key: 'scan_growth32', kind: 'scan', name: 'Growth scan', patientText: 'Ultrasound to check baby’s growth', fromWeek: 30, toWeek: 32, source: 'Common Indian practice – doctor to decide if routine or only when indicated' },
    { key: 'scan_doppler', kind: 'scan', name: 'Growth scan with Doppler', patientText: 'Ultrasound with blood-flow check', fromWeek: 34, toWeek: 36, appliesWhen: 'high_risk', source: 'For high-risk pregnancies – doctor to confirm indications and timing' },
    // DRAFT items for findings in this pregnancy: they apply by themselves once a doctor or RMO ticks the finding
    // on the record. (High blood pressure and bleeding have no fixed-week item here: they make the pregnancy high
    // risk, which switches on the high-risk items, and the doctor adds what is needed.)
    // The patient's wording (printout, patient portal, reminder messages – often read on a shared phone) says
    // which scan and when, never the finding itself.
    // The twin scans are the schedule for twins with separate placentas (dichorionic) only, and their names say so:
    // the "Twins or more" tick does not record the number of placentas (see adv_twins_placentas below).
    { key: 'scan_twins_24', kind: 'scan', name: 'Growth scan (twins, separate placentas) – 24 weeks', patientText: 'Ultrasound to check growth (24 weeks)', fromWeek: 24, toWeek: 25, appliesWhen: 'multiple_pregnancy', source: 'NICE NG137 (2019) / ISUOG twin guideline: dichorionic twins – growth scan at least every 4 weeks from 24 weeks; monochorionic twins need a scan every 2 weeks from 16 weeks (add them for her) – doctor to confirm' },
    { key: 'scan_twins_28', kind: 'scan', name: 'Growth scan (twins, separate placentas) – 28 weeks', patientText: 'Ultrasound to check growth (28 weeks)', fromWeek: 28, toWeek: 29, appliesWhen: 'multiple_pregnancy', source: 'NICE NG137 (2019) / ISUOG twin guideline: dichorionic twins – growth scan at least every 4 weeks – doctor to confirm' },
    { key: 'scan_growth_gdm', kind: 'scan', name: 'Growth scan with amniotic fluid (gestational diabetes)', patientText: 'Ultrasound to check baby’s growth (28–30 weeks)', fromWeek: 28, toWeek: 30, appliesWhen: 'gdm', source: 'MoHFW GDM guidelines (2018): growth scan at 28–30 weeks for GDM, repeated at 34–36 weeks – doctor to confirm' },
    { key: 'scan_twins_32', kind: 'scan', name: 'Growth scan (twins, separate placentas) – 32 weeks', patientText: 'Ultrasound to check growth (32 weeks)', fromWeek: 32, toWeek: 33, appliesWhen: 'multiple_pregnancy', source: 'NICE NG137 (2019) / ISUOG twin guideline: dichorionic twins – growth scan at least every 4 weeks. It takes the place of the routine growth scan at 30–32 weeks (mark that one not needed); the 36-week scan is the high-risk growth scan – doctor to confirm' },
    { key: 'scan_placenta_32', kind: 'scan', name: 'Repeat scan for the position of the placenta', patientText: 'Follow-up ultrasound (32 weeks)', fromWeek: 32, toWeek: 33, appliesWhen: 'placenta_praevia', source: 'RCOG Green-top 27a (2018): follow-up scan at 32 weeks for a low-lying placenta or praevia; if it is still low, again at 36 weeks – doctor to confirm' },

    // ── Vaccinations ────────────────────────────────────────────────────────────────────────
    { key: 'vacc_td1', kind: 'vaccination', name: 'Td (tetanus-diphtheria) – dose 1 (or booster)', patientText: 'Tetanus (Td) injection – dose 1', atBooking: true, source: 'MoHFW UIP: Td-1 early in pregnancy; single booster if vaccinated in last 3 years' },
    { key: 'vacc_td2', kind: 'vaccination', name: 'Td – dose 2', patientText: 'Tetanus (Td) injection – dose 2', after: { key: 'vacc_td1', weeks: 4 }, source: 'MoHFW UIP: Td-2 four weeks after Td-1 (not needed if booster given)' },
    { key: 'vacc_tdap', kind: 'vaccination', name: 'Tdap (whooping cough protection)', patientText: 'Tdap injection (protects baby from whooping cough)', fromWeek: 27, toWeek: 36, source: 'FOGSI: Tdap at 27–36 weeks – may replace Td-2 in private practice; doctor to decide' },
    { key: 'vacc_flu', kind: 'vaccination', name: 'Inactivated influenza vaccine (in flu season)', patientText: 'Flu injection (if in flu season)', fromWeek: 14, toWeek: 36, source: 'FOGSI / WHO: influenza vaccine in any trimester during flu season – doctor to decide' },
    { key: 'anti_d', kind: 'vaccination', name: 'Anti-D immunoglobulin (if ICT negative)', patientText: 'Anti-D injection (Rh negative)', fromWeek: 28, toWeek: 28, appliesWhen: 'rh_negative', source: 'FOGSI: antenatal anti-D prophylaxis at 28 weeks for Rh-negative, ICT-negative mothers' },

    // ── Medicines (supplements) ─────────────────────────────────────────────────────────────
    { key: 'med_folic', kind: 'medication', name: 'Folic acid 400 mcg daily (until 12 weeks)', patientText: 'Folic acid tablet every day until 3 months', atBooking: true, source: 'WHO / MoHFW' },
    { key: 'med_ifa', kind: 'medication', name: 'Iron-folic acid daily from 14 weeks (at least 180 days)', patientText: 'Iron tablet every day from 4th month', fromWeek: 14, toWeek: 16, source: 'MoHFW / Anemia Mukt Bharat' },
    { key: 'med_calcium', kind: 'medication', name: 'Calcium 500 mg twice daily from 14 weeks', patientText: 'Calcium tablets from 4th month', fromWeek: 14, toWeek: 16, source: 'MoHFW calcium supplementation guidance' },
    { key: 'med_deworm', kind: 'medication', name: 'Albendazole 400 mg single dose (second trimester)', patientText: 'Deworming tablet (one dose)', fromWeek: 14, toWeek: 26, source: 'MoHFW: deworming in the second trimester' },

    // ── Advice ──────────────────────────────────────────────────────────────────────────────
    { key: 'adv_diet', kind: 'advice', name: 'Nutrition, rest and hygiene counselling', patientText: 'Eat a balanced diet, rest well, and keep taking your tablets', atBooking: true, source: 'WHO / MoHFW' },
    { key: 'adv_danger', kind: 'advice', name: 'Danger signs counselling', patientText: 'Come to hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking water or reduced baby movements', atBooking: true, source: 'WHO / MoHFW' },
    { key: 'adv_fmc', kind: 'advice', name: 'Fetal movement counting', patientText: 'Count your baby’s movements every day', fromWeek: 28, toWeek: 28, source: 'Common practice from 28 weeks' },
    { key: 'adv_birthplan', kind: 'advice', name: 'Birth preparedness and breastfeeding counselling', patientText: 'Plan for delivery; learn about breastfeeding', fromWeek: 32, toWeek: 36, source: 'WHO / MoHFW birth preparedness' },
    // DRAFT, for "Twins or more": the built-in twin scans above are the schedule for separate placentas only.
    { key: 'adv_twins_placentas', kind: 'advice', name: 'Twins or more: check the number of placentas – a shared placenta (monochorionic) or triplets need more scans (add them for her)', patientText: 'Ask your doctor how often you need an ultrasound scan', fromWeek: 12, toWeek: 16, appliesWhen: 'multiple_pregnancy', source: 'NICE NG137 (2019) / ISUOG twin guideline: chorionicity is decided at the 11–14 week scan. Monochorionic twins: a scan every 2 weeks from 16 weeks; triplets: every 2 weeks (from 16 weeks when a placenta is shared). The built-in twin scans at 24, 28 and 32 weeks are for dichorionic twins only – doctor to confirm' },
  ],

  // ── Risk rules (automatic risk level) ───────────────────────────────────────────────────────
  // DRAFT v2 – checked by automated research against MoHFW PMSMA (2016 list and 2024 update of 25 HRP
  // categories), MoHFW SBA/ANC guidelines, MCP Card guidebook 2018, FOGSI-ICOG and international guidance
  // (NICE, RCOG, ACOG). Still to be reviewed and approved by the hospital's doctor. Where sources disagree,
  // the Government of India criterion is used and the disagreement is written in the source text.
  // Used: what is recorded at registration; findings a doctor or RMO ticked for this pregnancy; the lowest
  // haemoglobin of this pregnancy (visits, and lab results a doctor has reviewed) and the latest blood pressure
  // (docs/RISK_RULES_RESEARCH.md, "Published high-risk factors the app cannot check automatically yet").
  // Other lab values and scan findings are not used.
  riskRules: [
    // Age and body size
    { key: 'age_under_20', label: 'Age under 20 (teenage pregnancy / young primi)', factor: 'age', op: 'lt', value: 20, level: 'high', source: 'MoHFW PMSMA: "young primi (less than 20 years)"; 2024 HRP list: teenage pregnancy. MoHFW SBA 2010 uses under 18 – doctor to confirm whether for all pregnancies or first only' },
    { key: 'age_over_35', label: 'Age over 35', factor: 'age', op: 'gt', value: 35, level: 'high', source: 'MoHFW PMSMA: "elderly gravida (more than 35 years)". ACOG / FOGSI-ICOG use 35 or older – doctor to confirm whether exactly 35 should be flagged' },
    { key: 'height_under_145', label: 'Height under 145 cm (short stature)', factor: 'heightCm', op: 'lt', value: 145, level: 'high', source: 'MoHFW/MWCD MCP Card guidebook 2018: under 145 cm is an obstetric risk; 2024 HRP list: short stature' },
    { key: 'bmi_35_plus', label: 'BMI 35 or more (severe obesity)', factor: 'bmi', op: 'gte', value: 35, level: 'high', source: 'FOGSI-ICOG ANC GCPR: BMI ≥ 35 at first contact is high risk' },
    { key: 'bmi_30_plus', label: 'BMI 30 or more (obesity)', factor: 'bmi', op: 'gte', value: 30, level: 'moderate', source: 'WHO / RCOG GTG 72: obesity BMI ≥ 30. Not a named GoI HRP category; MoHFW GDM guideline uses Asian cut-offs (obese > 25) – doctor to decide on a lower tier' },
    { key: 'bmi_under_18_5', label: 'BMI under 18.5 (underweight)', factor: 'bmi', op: 'lt', value: 18.5, level: 'moderate', source: 'WHO / MoHFW GDM guideline BMI table: underweight < 18.5. FOGSI-ICOG treats BMI < 18 as high – doctor to confirm level' },
    { key: 'weight_under_45', label: 'Weight under 45 kg', factor: 'weightKg', op: 'lt', value: 45, level: 'moderate', source: 'MoHFW SBA/ANM guideline: women under 45 kg need extra nutrition and follow-up' },
    // Obstetric history
    { key: 'previous_caesarean', label: 'Previous caesarean section', factor: 'previousCaesareans', op: 'gte', value: 1, level: 'high', source: 'MoHFW PMSMA HRP list: previous LSCS (deliver at a CEmOC facility)' },
    { key: 'grand_multipara', label: 'Grand multipara (4 or more previous births)', factor: 'para', op: 'gte', value: 4, level: 'high', source: 'MoHFW SBA 2010: grand multipara = 4 or more; PMSMA HRP list: grand multipara; NICE: parity ≥ 4. Classic definition is ≥ 5 – doctor to confirm' },
    { key: 'abortions_3_plus', label: 'Three or more previous miscarriages / abortions', factor: 'abortions', op: 'gte', value: 3, level: 'high', source: 'MoHFW SBA 2010: ≥ 3 spontaneous abortions – refer (bad obstetric history). The A count may include losses that were not spontaneous – doctor to confirm' },
    { key: 'abortions_2', label: 'Two previous miscarriages / abortions', factor: 'abortions', op: 'eq', value: 2, level: 'moderate', source: 'ESHRE / ASRM: recurrent pregnancy loss from 2 losses (RCOG: 3). The A count may include losses that were not spontaneous – doctor to confirm' },
    { key: 'hist_stillbirth', label: 'Previous stillbirth or newborn death', factor: 'pastComplication', complication: 'stillbirth_or_neonatal_death', level: 'high', source: 'MoHFW SBA/ANC guidelines: previous stillbirth / neonatal loss; PMSMA: bad obstetric history' },
    { key: 'hist_preterm', label: 'Previous preterm birth', factor: 'pastComplication', complication: 'preterm_birth', level: 'high', source: 'PMSMA: bad obstetric history (previous preterm)' },
    { key: 'hist_pre_eclampsia', label: 'Pre-eclampsia / eclampsia in a previous pregnancy', factor: 'pastComplication', complication: 'pre_eclampsia', level: 'high', source: 'MoHFW SBA/ANC guidelines; FOGSI-GESTOSIS-ICOG HDP score' },
    { key: 'hist_anomaly', label: 'Previous baby with a congenital anomaly', factor: 'pastComplication', complication: 'congenital_anomaly', level: 'high', source: 'PMSMA HRP list: congenital malformation / bad obstetric history' },
    { key: 'hist_obstructed', label: 'Previous obstructed labour', factor: 'pastComplication', complication: 'obstructed_labour', level: 'high', source: 'MoHFW SBA/ANC guidelines: previous obstructed labour' },
    { key: 'hist_pph', label: 'Previous bleeding after delivery (PPH)', factor: 'pastComplication', complication: 'pph', level: 'high', source: 'MoHFW SBA/ANC guidelines: previous PPH / APH' },

    { key: 'hist_rh_iso', label: 'Rh sensitisation in a previous pregnancy', factor: 'pastComplication', complication: 'rh_isoimmunisation', level: 'high', source: 'MoHFW SBA/ANC guidelines: iso-immunisation (Rh −ve) in the previous pregnancy' },
    { key: 'hist_lbw', label: 'Previous baby under 2.5 kg', factor: 'pastComplication', complication: 'low_birth_weight_baby', level: 'moderate', source: 'MoHFW SBA/ANC guidelines: previous low-birth-weight baby – refer to MO' },
    { key: 'hist_big_baby', label: 'Previous baby over 4 kg', factor: 'pastComplication', complication: 'big_baby', level: 'moderate', source: 'MoHFW SBA/ANC guidelines: previous baby > 4–4.5 kg – screen for diabetes; doctor to confirm cut-off' },
    // Blood group and conditions
    { key: 'rh_negative', label: 'Rh-negative blood group', factor: 'rhNegative', level: 'high', source: 'MoHFW PMSMA HRP list: Rh negative. NICE/ACOG treat unsensitised Rh-negative as routine care with anti-D – doctor to confirm level' },
    { key: 'cond_diabetes', label: 'Diabetes (known before pregnancy)', factor: 'condition', condition: 'diabetes', level: 'high', source: 'PMSMA: GDM and any current systemic illness; MoHFW SBA: diabetes' },
    { key: 'cond_hypertension', label: 'Chronic high blood pressure', factor: 'condition', condition: 'hypertension', level: 'high', source: 'PMSMA: chronic hypertension antedating pregnancy or before 20 weeks' },
    { key: 'cond_heart', label: 'Heart disease', factor: 'condition', condition: 'heart_disease', level: 'high', source: 'PMSMA: current systemic illness; MoHFW SBA / MCP card: heart disease (specialist at FRU)' },
    { key: 'cond_renal', label: 'Kidney disease', factor: 'condition', condition: 'renal_disease', level: 'high', source: 'MoHFW SBA systemic illness list; FOGSI-GESTOSIS-ICOG HDP score (3 points)' },
    { key: 'cond_autoimmune', label: 'Autoimmune disease (e.g. SLE, antiphospholipid syndrome)', factor: 'condition', condition: 'autoimmune', level: 'high', source: 'FOGSI-GESTOSIS-ICOG HDP score (3 points)' },
    { key: 'cond_thrombophilia', label: 'Thrombophilia (clotting disorder)', factor: 'condition', condition: 'thrombophilia', level: 'high', source: 'FOGSI-GESTOSIS-ICOG HDP score (3 points)' },
    { key: 'cond_thyroid', label: 'Thyroid disease', factor: 'condition', condition: 'thyroid', level: 'high', source: 'PMSMA HRP list: hypothyroidism. ATA: well-treated hypothyroidism adds little risk – doctor may choose moderate' },
    { key: 'cond_epilepsy', label: 'Epilepsy', factor: 'condition', condition: 'epilepsy', level: 'high', source: 'MoHFW SBA: convulsions (epilepsy); RCOG GTG 68' },
    { key: 'cond_mental_health', label: 'Mental health condition', factor: 'condition', condition: 'mental_health', level: 'high', source: 'FOGSI-GESTOSIS-ICOG HDP score (3 points) – doctor to confirm level' },
    { key: 'cond_tb', label: 'Tuberculosis', factor: 'condition', condition: 'tuberculosis', level: 'high', source: 'MoHFW SBA / MCP card: tuberculosis; GoI TB-maternal health framework' },
    { key: 'cond_hiv', label: 'HIV', factor: 'condition', condition: 'hiv', level: 'high', source: 'MoHFW PMSMA HRP list: syphilis/HIV positive' },
    { key: 'cond_syphilis', label: 'Syphilis', factor: 'condition', condition: 'syphilis', level: 'high', source: 'MoHFW PMSMA HRP list: syphilis/HIV positive' },
    { key: 'cond_hepatitis_b', label: 'Hepatitis B', factor: 'condition', condition: 'hepatitis_b', level: 'high', source: 'NVHCP: track HBsAg-positive mothers for institutional delivery and newborn HBIG; not a named PMSMA category – doctor may choose moderate' },
    { key: 'cond_uterine_surgery', label: 'Previous surgery on the uterus (e.g. myomectomy)', factor: 'condition', condition: 'uterine_surgery', level: 'high', source: 'MoHFW SBA/ANC guidelines: previous surgery on the reproductive tract; WHO FANC classifying form' },
    { key: 'cond_liver', label: 'Other liver disease / jaundice', factor: 'condition', condition: 'liver_disease', level: 'moderate', source: 'MoHFW SBA systemic illness list: jaundice' },
    { key: 'cond_anaemia', label: 'Anaemia (severity not recorded)', factor: 'condition', condition: 'anaemia', level: 'moderate', source: 'PMSMA: only severe anaemia (Hb < 7 g/dL) is high risk – the measured Hb of this pregnancy is checked by its own rules below' },
    { key: 'cond_asthma', label: 'Asthma', factor: 'condition', condition: 'asthma', level: 'moderate', source: 'ACOG / NICE: severe or poorly controlled asthma is higher risk; GoI treats systemic illness as high – doctor to confirm level' },
    // Findings in this pregnancy (ticked on the record by a doctor or RMO – never by the software)
    { key: 'preg_gdm', label: 'Gestational diabetes (GDM) in this pregnancy', factor: 'finding', finding: 'gdm', level: 'high', source: 'MoHFW PMSMA HRP list: gestational diabetes mellitus; FOGSI-GESTOSIS-ICOG HDP GCPR 2019 – doctor to confirm' },
    { key: 'preg_hypertension', label: 'High blood pressure in this pregnancy (gestational hypertension / pre-eclampsia)', factor: 'finding', finding: 'hypertension', level: 'high', source: 'MoHFW PMSMA HRP list: pregnancy-induced hypertension; Extended PMSMA Guidance Note section F; FOGSI-GESTOSIS-ICOG HDP GCPR 2019 – doctor to confirm' },
    { key: 'preg_multiple', label: 'Twins or more', factor: 'finding', finding: 'multiple', level: 'high', source: 'MoHFW PMSMA HRP list: twins / multiple pregnancy; MoHFW SBA/ANC guidelines; FOGSI-GESTOSIS-ICOG HDP GCPR 2019 – doctor to confirm' },
    { key: 'preg_placenta_praevia', label: 'Low-lying placenta / placenta praevia', factor: 'finding', finding: 'placenta_praevia', level: 'high', source: 'PMSMA criteria as used in PMSMA-based studies: low-lying placenta or placenta praevia. A placenta that is low before 32 weeks often moves up: untick it after a normal follow-up scan – doctor to confirm' },
    { key: 'preg_bleeding', label: 'Bleeding in this pregnancy', factor: 'finding', finding: 'bleeding', level: 'high', source: 'MoHFW SBA/ANC guidelines: antepartum haemorrhage; WHO antenatal classifying form: vaginal bleeding. Light early bleeding that has settled may be lower risk – doctor to confirm level' },
    // Readings of this pregnancy (worked out from the visits and the lab results a doctor has reviewed)
    { key: 'hb_under_7', label: 'Severe anaemia: lowest Hb in this pregnancy under 7 g/dL', factor: 'lowestHb', op: 'lt', value: 7, level: 'high', source: 'MoHFW PMSMA HRP list: severe anaemia (Hb < 7 g/dL); Anemia Mukt Bharat (2018). Uses the lowest Hb of this pregnancy, so it stays after treatment – doctor to confirm (the doctor can override the level)' },
    { key: 'hb_under_11', label: 'Anaemia: lowest Hb in this pregnancy under 11 g/dL', factor: 'lowestHb', op: 'lt', value: 11, level: 'moderate', source: 'MoHFW / Anemia Mukt Bharat: anaemia in pregnancy is Hb < 11 g/dL (mild 10–10.9, moderate 7–9.9); WHO 2024: < 11 in the first and third trimesters, < 10.5 in the second; Extended PMSMA tracks anaemia. Mild anaemia is very common: the doctor may lower the cut-off to 10 – doctor to confirm' },
    { key: 'bp_systolic_140', label: 'Latest blood pressure: upper number 140 or more', factor: 'bpSystolic', op: 'gte', value: 140, level: 'high', source: 'MoHFW PMSMA HRP list: pregnancy-induced hypertension (BP 140/90 or higher); MoHFW SBA guidelines ask for two readings. This uses one reading (the latest): recheck, and when confirmed tick “High blood pressure in this pregnancy” – doctor to confirm level' },
    { key: 'bp_diastolic_90', label: 'Latest blood pressure: lower number 90 or more', factor: 'bpDiastolic', op: 'gte', value: 90, level: 'high', source: 'MoHFW PMSMA HRP list: pregnancy-induced hypertension (BP 140/90 or higher); MoHFW SBA guidelines: diastolic 90 or more. This uses one reading (the latest): recheck, and when confirmed tick “High blood pressure in this pregnancy” – doctor to confirm level' },
  ],
};
