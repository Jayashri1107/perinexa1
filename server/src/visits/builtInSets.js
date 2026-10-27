// The built-in ready-made prescription sets (Feature 8b): DRAFTS for common OBGY situations. Each hospital gets
// its own copy (prescriptionSets.js) and they stay drafts until a doctor has checked every medicine and dose and
// approves them. Written by the software developer from published guidance (the source is in each set's notes
// for doctors) – NOT reviewed by a doctor. docs/PRESCRIPTIONS.md lists them for review.
//
// Raise BUILT_IN_SETS_VERSION when the content changes: unedited drafts in every hospital are then refreshed.
// Free text must not mention the baby's sex (PCPNDT Act) – a test checks it.

export const BUILT_IN_SETS_VERSION = 1;

/** One medicine as the Prescription tab writes it. */
const rx = (drug, form, strength, dose, frequency, timing, duration, more = {}) => ({
  drug,
  form,
  strength,
  dose,
  frequency,
  frequencyText: '',
  timing,
  route: '',
  durationValue: duration?.[0] ?? null,
  durationUnit: duration?.[1] ?? '',
  instructions: '',
  ...more,
});

const IFA = (dose, frequency, duration, more) => rx('Iron + folic acid (IFA)', 'tab', '60 mg + 500 mcg', dose, frequency, 'after_food', duration, more);
const CALCIUM = (duration) => rx('Calcium carbonate + vitamin D3', 'tab', '500 mg + 250 IU', '1', '1-0-1', 'after_food', duration);
const TILL_DELIVERY = [null, 'till_delivery'];
const IRON_AND_CALCIUM_APART = 'Take the iron and the calcium at least 2 hours apart. Do not take them with tea, coffee or milk.';

// ---------- Pregnancy-loss care (the Abortion type of care), added 5 Oct 2026 ----------
// Only care of a loss that has already happened or been diagnosed: after a complete miscarriage, medical management
// of a missed or an incomplete miscarriage, and after surgical evacuation. Never for ending a continuing pregnancy
// (Perinexa records no MTP). Left out on purpose: a threatened miscarriage (a continuing pregnancy – antenatal care,
// owner's decision of 3 Oct 2026) and methotrexate for an ectopic pregnancy (a specialist protocol with strict
// criteria, RCOG Green-top Guideline 21 – the website says so where the sets are chosen). Misoprostol is "avoid" in
// the medicine-safety list for a continuing pregnancy; pregnancy-loss care gets no pregnancy warnings (owner, 3 Oct
// 2026), so these sets raise none there – and would on an antenatal record. The words a patient reads (printed
// instructions, tests and advice) never name the loss and never mention the baby.
export const LOSS_SET_KEYS = ['loss_complete', 'loss_missed_medical', 'loss_incomplete_medical', 'loss_after_evacuation'];
/** The first words of the notes for doctors of the two misoprostol sets. */
export const DIAGNOSED_ONLY = 'FOR A MISCARRIAGE ALREADY DIAGNOSED – NOT FOR ENDING A CONTINUING PREGNANCY.';
const NO_METHOTREXATE =
  'Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist protocol with strict criteria (RCOG Green-top Guideline 21).';
const DOSES_TO_CHECK = 'Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).';

const MISOPROSTOL = (dose, frequencyText, more) => rx('Misoprostol', 'tab', '200 mcg', dose, 'custom', '', null, { frequencyText, ...more });
const PAIN = rx('Paracetamol', 'tab', '500 mg', '2', 'sos', 'after_food', [3, 'days'], { instructions: 'For pain – at least 6 hours apart, at most 4 times a day' });
const CRAMPS = rx('Ibuprofen', 'tab', '400 mg', '1', 'sos', 'after_food', [3, 'days'], { instructions: 'For cramps – after food, at most 3 times a day' });
const IRON_AFTER_LOSS = IFA('1', '0-1-0', [3, 'months'], { instructions: 'Not with tea, coffee or milk' });
const WARNING_SIGNS =
  'Come at once for heavy bleeding (soaking 2 pads an hour for 2 hours), large clots, fever, a smelly discharge, severe pain in the abdomen, or feeling faint or dizzy.';
const NEXT_STEPS =
  'You can become pregnant again even before your next period: use contraception if you do not want a pregnancy now. Feeling sad or low afterwards is common – please talk to us about it.';
const MEDICAL_NOTES =
  'Bleeding and cramps usually start within a few hours of the tablets, and the bleeding can be heavier than a period. Nausea, loose motions, shivering or a mild fever on that day are common.';
const MEDICAL_ADVICE = `Have someone with you on the day you take the tablets. Use pads, not tampons, until the bleeding stops. Call us if no bleeding has started within 48 hours. ${WARNING_SIGNS} ${NEXT_STEPS}`;
const PREGNANCY_TEST_3_WEEKS = 'Urine pregnancy test 3 weeks after the tablets – come back if it is still positive.';

// ---------- Fertility (fertility idea F6, the owner's go-ahead of 27 Oct 2026) ----------
// Ovulation induction and IUI cycles, from the approved fertility protocol library (fertility/protocols.js): the
// starting doses of its "usual regimen" lines. Drafts like every built-in set – a doctor checks each medicine and dose
// and approves the set, and the medicine safety list checks it on her record. Chosen in the visit's Prescription (Ready-made sets).
export const FERTILITY_SET_KEYS = ['inf_oi_letrozole', 'inf_oi_clomiphene', 'inf_trigger', 'inf_luteal'];
const FOLIC = rx('Folic acid', 'tab', '400 mcg', '1', '1-0-0', 'after_food', [3, 'months']);
const SCAN_FROM_DAY_9 = 'Follicular study (transvaginal scan) from day 9–10 of the cycle, as advised.';
const OI_ADVICE =
  'Take the tablet at the same time each day. Come for the scan on the day you are given. Hot flushes, headache or tiredness can happen and pass. Call us at once for severe pain or swelling of the abdomen, vomiting or breathlessness.';

const FERTILITY_SETS = [
  {
    key: 'inf_oi_letrozole',
    name: 'Ovulation induction – letrozole (one cycle)',
    careTypes: ['infertility'],
    order: 300,
    items: [rx('Letrozole', 'tab', '2.5 mg', '1', '1-0-0', 'after_food', [5, 'days'], { instructions: 'From day 2 of the period, for 5 days' }), FOLIC],
    notes: '',
    investigations: SCAN_FROM_DAY_9,
    advice: OI_ADVICE,
    about:
      'Fertility protocol library (oi_letrozole; PCOS 2023, NICE NG257, FOGSI): letrozole 2.5 mg daily for 5 days from day 2–5; if no ovulation, 5 mg and then 7.5 mg in the following cycles (usual regimen – doctor to confirm). Off-label in India: check the current CDSCO position and take written consent.',
  },
  {
    key: 'inf_oi_clomiphene',
    name: 'Ovulation induction – clomiphene (one cycle)',
    careTypes: ['infertility'],
    order: 310,
    items: [rx('Clomiphene citrate', 'tab', '50 mg', '1', '1-0-0', 'after_food', [5, 'days'], { instructions: 'From day 2 of the period, for 5 days' }), FOLIC],
    notes: '',
    investigations: SCAN_FROM_DAY_9,
    advice: `${OI_ADVICE} Tell us at once about blurred vision or spots before the eyes.`,
    about:
      'Fertility protocol library (oi_clomiphene; NICE 2013 practice, FOGSI): clomiphene citrate 50 mg daily for 5 days from day 2–5; if no ovulation, 100 mg then 150 mg; not beyond six ovulatory cycles in total (doctor to confirm). Stop it for visual symptoms.',
  },
  {
    key: 'inf_trigger',
    name: 'Ovulation trigger (hCG)',
    careTypes: ['infertility'],
    order: 320,
    items: [rx('hCG (human chorionic gonadotrophin)', 'inj', '5,000 IU', '1', 'stat', '', null, { route: 'im', instructions: 'Once, at the time written by the doctor' })],
    notes: 'Intercourse or IUI as advised by the doctor after the injection.',
    investigations: 'Urine pregnancy test 14 days after the injection if the period has not come.',
    advice: 'Take the injection exactly at the time written. Call us at once for severe pain or swelling of the abdomen, vomiting, breathlessness or passing very little urine.',
    about:
      'Fertility protocol library (natural and stimulated cycles, IUI): hCG 5,000–10,000 IU (or 250 micrograms recombinant) when the lead follicle is 18 mm or more; withhold it and cancel when more than 2 follicles reach 14 mm (doctor to confirm).',
  },
  {
    key: 'inf_luteal',
    name: 'Luteal support – vaginal progesterone',
    careTypes: ['infertility'],
    order: 330,
    items: [rx('Progesterone (micronised)', 'cap', '200 mg', '1', '1-0-1', '', [14, 'days'], { route: 'vaginal', instructions: 'Into the vagina, from the day after the trigger or IUI' })],
    notes: '',
    investigations: 'Urine pregnancy test 14 days after the trigger or IUI.',
    advice: 'Continue until the pregnancy test unless told otherwise. A little discharge from the capsules is expected. Call us for bleeding or pain.',
    about:
      'Fertility protocol library: progesterone 200–400 mg vaginally daily for luteal support where chosen; optional in OI and IUI cycles (doctor to confirm). Continue to the test; after a positive test, as the doctor decides.',
  },
];

const LOSS_SETS = [
  {
    key: 'loss_complete',
    name: 'Complete miscarriage – after the loss',
    careTypes: ['abortion'],
    order: 130,
    items: [PAIN, IRON_AFTER_LOSS],
    notes: '',
    investigations: 'Haemoglobin, if the bleeding was heavy. Urine pregnancy test after 3 weeks, if the doctor advises it.',
    advice: `Some bleeding, like a period, and mild cramps can go on for up to 2 weeks. Use pads, not tampons, until the bleeding stops. ${WARNING_SIGNS} ${NEXT_STEPS}`,
    about: `For a miscarriage that is already complete – nothing in this set ends a pregnancy. NICE NG126 (2019, updated 2023): a complete miscarriage needs no medicine to empty the uterus; anti-D is not needed after a complete miscarriage (record the answer under Pregnancy loss). When it was not confirmed on a scan, a urine pregnancy test after 3 weeks checks that it is complete (doctor to decide). Iron for 3 months after blood loss is common practice, not a NICE recommendation: check the haemoglobin and treat anaemia by the hospital's protocol (Anemia Mukt Bharat). ${NO_METHOTREXATE} ${DOSES_TO_CHECK}`,
  },
  {
    key: 'loss_missed_medical',
    name: 'Missed miscarriage (diagnosed) – medical management with misoprostol',
    careTypes: ['abortion'],
    order: 140,
    items: [
      MISOPROSTOL('4', 'One dose; a second after 3 hours only if told', { route: 'vaginal', instructions: 'Place all 4 tablets high in the vagina, then lie down for 30 minutes' }),
      CRAMPS,
      PAIN,
    ],
    notes: MEDICAL_NOTES,
    investigations: PREGNANCY_TEST_3_WEEKS,
    advice: MEDICAL_ADVICE,
    about: `${DIAGNOSED_ONLY} Only when a scan has confirmed a missed miscarriage under 13 weeks (NICE NG126 criteria). Misoprostol 800 mcg: NICE NG126 (2019, updated 2023) gives 800 mcg vaginally, by mouth or under the tongue 48 hours after mifepristone 200 mg by mouth – add the mifepristone if the hospital uses it; FIGO 2017 (misoprostol alone, under 13 weeks): 800 mcg vaginally or 600 mcg under the tongue every 3 hours, 2 doses. From 13 weeks the doses differ. NICE: offer pain relief and anti-emetics as needed, and a urine pregnancy test after 3 weeks; no anti-D after medical management alone. ${NO_METHOTREXATE} ${DOSES_TO_CHECK}`,
  },
  {
    key: 'loss_incomplete_medical',
    name: 'Incomplete miscarriage (diagnosed) – medical management with misoprostol',
    careTypes: ['abortion'],
    order: 150,
    items: [MISOPROSTOL('3', 'Once only', { route: 'oral', instructions: 'Swallow all 3 tablets together' }), CRAMPS, PAIN],
    notes: MEDICAL_NOTES,
    investigations: PREGNANCY_TEST_3_WEEKS,
    advice: MEDICAL_ADVICE,
    about: `${DIAGNOSED_ONLY} For an incomplete miscarriage under 13 weeks without heavy bleeding or signs of infection – those need surgical evacuation or the hospital's protocol at once. Misoprostol 600 mcg once: NICE NG126 (2019, updated 2023) – vaginally, by mouth or under the tongue, without mifepristone; FIGO 2017 – 600 mcg by mouth or 400 mcg under the tongue once, or 400–800 mcg vaginally once. NICE: offer pain relief and anti-emetics as needed, and a urine pregnancy test after 3 weeks; no anti-D after medical management alone. ${NO_METHOTREXATE} ${DOSES_TO_CHECK}`,
  },
  {
    key: 'loss_after_evacuation',
    name: 'After surgical evacuation for a miscarriage (at discharge)',
    careTypes: ['abortion'],
    order: 160,
    items: [PAIN, IRON_AFTER_LOSS],
    notes: '',
    investigations: 'Report of the tissue sent to the laboratory (histopathology) – to be seen at the follow-up visit.',
    advice: `Light bleeding or spotting for up to 2 weeks is normal. Use pads, not tampons, and avoid intercourse until the bleeding stops. ${WARNING_SIGNS} ${NEXT_STEPS} Come for your follow-up visit in 1–2 weeks.`,
    about: `After vacuum aspiration (manual or electric) or evacuation under anaesthesia for a miscarriage – nothing in this set ends a pregnancy. No antibiotic: NICE NG126 has no recommendation for antibiotics after surgical management of a miscarriage, and the AIMS trial (Lancet 2019) found that routine prophylaxis before miscarriage surgery did not clearly reduce pelvic infection. Where the hospital gives prophylaxis, it is one dose before the procedure, not a course at discharge; treat an infection by the hospital's protocol. Anti-D: NICE NG126 gives it to a Rh-negative woman after a surgical procedure (record it under Pregnancy loss). Iron after blood loss is common practice, not a NICE recommendation – check the haemoglobin. After a molar pregnancy the hCG follow-up is in the care plan. ${DOSES_TO_CHECK}`,
  },
];

export const BUILT_IN_SETS = [
  {
    key: 'anc_first_trimester',
    name: 'First trimester – routine care',
    careTypes: ['antenatal'],
    order: 10,
    items: [rx('Folic acid', 'tab', '400 mcg', '1', '1-0-0', 'after_food', null, { instructions: 'Until 12 weeks of pregnancy' })],
    notes: '',
    investigations: '',
    advice:
      'Eat small, frequent meals and drink plenty of water. Rest well and avoid heavy lifting. Do not take any other medicine without asking us. Come at once for bleeding, severe pain in the abdomen, fever, or vomiting that does not stop.',
    about:
      'Folic acid 400 mcg a day until 12 weeks (MoHFW and WHO antenatal care guidance); 5 mg for women at higher risk of a neural tube defect (a previous affected pregnancy, diabetes, epilepsy on treatment, obesity). The booking tests and the dating scan come from the care plan and print under the next visit.',
  },
  {
    key: 'anc_second_third',
    name: 'Second and third trimester – routine care',
    careTypes: ['antenatal'],
    order: 20,
    items: [IFA('1', '0-1-0', TILL_DELIVERY), CALCIUM(TILL_DELIVERY)],
    notes: IRON_AND_CALCIUM_APART,
    investigations: '',
    advice:
      "Eat a balanced diet every day with green leafy vegetables, pulses, fruit and milk. From 28 weeks, notice your baby's movements every day. Come at once for bleeding, leaking of water, severe headache, blurred vision, swelling of the face or hands, or if the baby moves less than usual.",
    about:
      'MoHFW: one IFA tablet (60 mg elemental iron + 500 mcg folic acid) a day from 14–16 weeks for at least 180 days, and calcium 500 mg twice a day from 14 weeks. Albendazole 400 mg once in the second trimester is in the care plan – add it on the day it is given.',
  },
  {
    key: 'anc_nausea',
    name: 'Nausea and vomiting in pregnancy (mild)',
    careTypes: ['antenatal'],
    order: 30,
    items: [rx('Doxylamine + pyridoxine', 'tab', '10 mg + 10 mg', '2', '0-0-1', 'bedtime', [10, 'days'], { instructions: 'May cause drowsiness' })],
    notes: '',
    investigations: '',
    advice:
      'Eat small, dry meals every 2–3 hours (for example biscuits, toast or khakhra) and avoid oily and spicy food. Sip water, coconut water or ORS through the day. Come at once if you cannot keep fluids down, pass very little urine, or feel dizzy or faint.',
    about:
      'Doxylamine with pyridoxine is the usual first choice (ACOG). Labelled dose: 2 tablets at bedtime, up to 4 a day (1 in the morning, 1 in the afternoon, 2 at bedtime) if needed. Admit or refer if she is dehydrated or losing weight (hyperemesis).',
  },
  {
    key: 'anc_anaemia',
    name: 'Anaemia in pregnancy (mild to moderate)',
    careTypes: ['antenatal'],
    order: 40,
    items: [IFA('1', '1-0-1', [3, 'months'], { instructions: 'Not with tea, coffee or milk' })],
    notes: 'Take the iron with water or lemon juice. Black stools are normal with iron tablets.',
    investigations: 'CBC with peripheral smear. Repeat haemoglobin after 4 weeks.',
    advice:
      'Eat iron-rich food every day: green leafy vegetables, jaggery, dates, pulses, and meat, fish or eggs if you eat them. Have lemon, amla or orange with your meals. Come at once for breathlessness, a racing heart or extreme tiredness.',
    about:
      'MoHFW (Anemia Mukt Bharat): mild to moderate anaemia in pregnancy (Hb 7–10.9 g/dL) – 2 IFA tablets a day, and repeat the haemoglobin after a month. Severe anaemia (Hb below 7 g/dL) needs referral and treatment by protocol (IV iron or transfusion). Give albendazole if it was not given in the second trimester.',
  },
  {
    key: 'anc_preeclampsia_prevention',
    name: 'Pre-eclampsia prevention (high risk)',
    careTypes: ['antenatal'],
    order: 50,
    items: [
      rx('Aspirin (low dose)', 'tab', '150 mg', '1', '0-0-1', 'after_food', TILL_DELIVERY, { instructions: 'Stop at 36 weeks unless told otherwise' }),
      CALCIUM(TILL_DELIVERY),
    ],
    notes: '',
    investigations: '',
    advice:
      'Check your blood pressure every week, at home or at a clinic, and bring the readings. Come at once for severe headache, blurred vision, pain in the upper abdomen, swelling of the face or hands, or if the baby moves less than usual.',
    about:
      'For women at high risk of pre-eclampsia (previous pre-eclampsia, chronic hypertension, diabetes, kidney or autoimmune disease, twins – or several moderate risks): aspirin at night from 12–16 weeks, usually until 36 weeks (NICE continues until birth). Doses in guidance range from 75 to 150 mg (FOGSI, ISSHP, NICE); the ASPRE trial used 150 mg. Calcium 1 g a day (MoHFW).',
  },
  {
    key: 'anc_uti',
    name: 'Urinary infection in pregnancy (cystitis)',
    careTypes: ['antenatal'],
    order: 60,
    items: [rx('Cephalexin', 'cap', '500 mg', '1', '1-0-1', 'after_food', [7, 'days'], { instructions: 'Complete the full course' })],
    notes: 'Drink 2–3 litres of water a day.',
    investigations: 'Urine routine and culture – send before the first dose.',
    advice: 'Do not hold urine for long. Come at once for fever with chills, pain in the back or side, vomiting, or pains like contractions.',
    about:
      'NICE NG109 (urinary infection in pregnancy): nitrofurantoin 100 mg modified-release twice a day for 7 days (avoid near term) is the first choice; amoxicillin or cephalexin 500 mg twice a day for 7 days when the culture shows the germ is sensitive. Change to suit the culture report. Fever or loin pain means pyelonephritis – admit.',
  },
  {
    key: 'pn_normal_delivery',
    name: 'After normal delivery (at discharge)',
    careTypes: ['postnatal'],
    order: 70,
    items: [
      IFA('1', '0-1-0', [6, 'months']),
      CALCIUM([6, 'months']),
      rx('Paracetamol', 'tab', '500 mg', '1', 'sos', 'after_food', [5, 'days'], { instructions: 'For pain – at least 6 hours apart' }),
    ],
    notes: 'Take the iron and the calcium at least 2 hours apart.',
    investigations: '',
    advice:
      'Breastfeed your baby often, day and night – only breast milk for 6 months. Keep the stitches clean and dry, and wash after using the toilet. Eat well and drink plenty of fluids. Come at once for fever, heavy bleeding or clots, foul-smelling discharge, painful swollen breasts, severe headache, or pain or swelling in the legs. We will talk about family planning at your 6-week check-up.',
    about: 'MoHFW: IFA (one tablet a day) and calcium (500 mg twice a day) for 180 days after delivery. Paracetamol is compatible with breastfeeding.',
  },
  {
    key: 'pn_caesarean',
    name: 'After caesarean section (at discharge)',
    careTypes: ['postnatal'],
    order: 80,
    items: [
      IFA('1', '0-1-0', [6, 'months']),
      CALCIUM([6, 'months']),
      rx('Paracetamol', 'tab', '500 mg', '1', '1-1-1', 'after_food', [5, 'days'], { instructions: 'For pain' }),
      rx('Lactulose', 'syrup', '', '15', '0-0-1', 'bedtime', [7, 'days'], { instructions: 'For soft stools' }),
    ],
    notes: 'Take the iron and the calcium at least 2 hours apart.',
    investigations: '',
    advice:
      'Keep the wound clean and dry. Walk a little several times a day and drink plenty of fluids. Do not lift anything heavy for 6 weeks. Breastfeed your baby often. Come at once for fever, redness, pain or discharge from the wound, heavy bleeding, pain or swelling in the legs, or breathlessness.',
    about:
      "No antibiotics are included – add them only if the hospital's protocol gives them after discharge. Set the next visit for the wound check. MoHFW: IFA and calcium for 180 days after delivery.",
  },
  {
    key: 'gyn_pcos',
    name: 'PCOS – first visit (tests, lifestyle, metformin)',
    careTypes: ['gynaecology', 'infertility'],
    order: 90,
    items: [rx('Metformin', 'tab', '500 mg', '1', '0-0-1', 'with_food', [1, 'months'], { instructions: 'With dinner. Your doctor may increase the dose slowly.' })],
    notes: '',
    investigations: 'Ultrasound pelvis (transvaginal if suitable). TSH, prolactin. Fasting blood sugar and 2-hour 75 g OGTT. Lipid profile.',
    advice:
      'Aim for at least 150 minutes of exercise a week – for example a brisk 30-minute walk on 5 days. Eat regular meals with vegetables, pulses and whole grains; cut down sugar, sweets, fried food and sweet drinks. Losing even 5–10% of your weight can bring your periods back.',
    about:
      'International PCOS guideline (2023): lifestyle first; metformin with lifestyle for adults with a BMI of 25 or more (start with 500 mg with dinner and increase slowly); a combined pill is the first choice for irregular cycles or excess hair – add one if there is no contraindication. Consider 17-OH progesterone if congenital adrenal hyperplasia is possible.',
  },
  {
    key: 'gyn_thrush',
    name: 'Vaginal thrush (candidiasis)',
    careTypes: ['gynaecology', 'antenatal'],
    order: 100,
    items: [
      rx('Clotrimazole', 'pessary', '100 mg', '1', '0-0-1', 'bedtime', [7, 'days'], { route: 'vaginal', instructions: 'Insert high in the vagina at bedtime' }),
      rx('Clotrimazole', 'cream', '1%', '', '1-0-1', '', [7, 'days'], { route: 'local', instructions: 'On the outer skin for itching' }),
    ],
    notes: '',
    investigations: '',
    advice:
      'Wear loose cotton underwear and keep the area dry. Do not use soap, douches or vaginal washes inside. Avoid intercourse until the course is finished, or use a condom. Come back if it is not better in a week, or if it keeps coming back.',
    about:
      'Clotrimazole 100 mg pessary at night for 7 nights also suits pregnancy (no oral fluconazole in pregnancy). Outside pregnancy a single 500 mg pessary or fluconazole 150 mg once are alternatives. Check the blood sugar if thrush keeps coming back.',
  },
  {
    key: 'gyn_dysmenorrhoea',
    name: 'Painful periods (primary dysmenorrhoea)',
    careTypes: ['gynaecology'],
    order: 110,
    items: [rx('Mefenamic acid', 'tab', '500 mg', '1', '1-1-1', 'after_food', [3, 'days'], { instructions: 'Start when the pain or bleeding starts' })],
    notes: '',
    investigations: '',
    advice:
      'A hot water bag on the lower abdomen and regular exercise help. Come back if the pain is not relieved, gets worse each month, or comes with heavy bleeding, fever or pain at other times.',
    about:
      'Anti-inflammatory painkillers are the first choice for primary dysmenorrhoea; avoid them with a peptic ulcer, kidney disease or asthma made worse by such painkillers. Consider an ultrasound (endometriosis, adenomyosis, fibroids) if the pain is new, severe or not relieved.',
  },
  {
    key: 'gyn_heavy_periods',
    name: 'Heavy periods (while bleeding)',
    careTypes: ['gynaecology'],
    order: 120,
    items: [
      rx('Tranexamic acid', 'tab', '500 mg', '2', '1-1-1', 'after_food', [4, 'days'], { instructions: 'Only on the heavy days of the period' }),
      rx('Ferrous ascorbate + folic acid', 'tab', '100 mg + 1.5 mg', '1', '0-1-0', 'after_food', [3, 'months']),
    ],
    notes: '',
    investigations: 'CBC. TSH. Ultrasound pelvis.',
    advice:
      'Keep a note of how many pads you use each day. Come at once if you soak a pad every hour for more than 2 hours, pass large clots, or feel faint or breathless.',
    about:
      'NICE NG88: tranexamic acid 1 g three times a day for up to 4 days while bleeding is heavy; do not use it after a thrombosis. Rule out pregnancy; take an endometrial sample when indicated (for example at 45 or older when treatment fails, or with persistent bleeding between periods).',
  },
  ...LOSS_SETS,
  ...FERTILITY_SETS,
];
