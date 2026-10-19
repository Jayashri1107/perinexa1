// The lab tests a doctor can order (Version 2, lab module), with the values the lab enters for each.
// DRAFT reference values (common adult values, from standard Indian lab practice): the lab's own report and the
// treating doctor decide – the flag only draws attention. No test here reveals the sex of a fetus (PCPNDT).
//
// A field is either a number (unit, low, high – below low is Low, above high is High) or a choice (options; the
// ones in `abnormal` are flagged Abnormal) or words (long: a paragraph – histopathology). Report templates
// (docs/LAB_TEMPLATES_PLAN.md): a field may carry its `section` on the report ("Red cell indices"), `calc` (worked out
// when left empty – lab/labCalcs.js) and `bands` (ranges for a group: men, an age, pregnant – lab/labSetup.js
// fieldFor). A test may carry `report` ({ template: table | serology | culture | narrative, method, notes, ownPage })
// and `antibiotics` (the culture template's sensitivity panel). All DRAFT for the owner (a doctor) to approve. planKeys: the care-plan items the test completes once a doctor has
// reviewed the result (only items due now or overdue – a 36-week Hb is not ticked by a booking test).
// planSeries: the items are one test repeated on a schedule (beta hCG after a pregnancy loss): one result completes
// only the earliest of them that is due or overdue.

const num = (key, name, unit, low, high, range = '', extra = {}) => ({ key, name, type: 'number', unit, low, high, range: range || rangeText(low, high, unit), ...extra });
const choice = (key, name, options, abnormal, extra = {}) => ({ key, name, type: 'choice', options, abnormal, ...extra });
const text = (key, name, extra = {}) => ({ key, name, type: 'text', ...extra });
const para = (key, name, section = '') => text(key, name, { long: true, ...(section ? { section } : {}) });
// A range for men (a walk-in registered by the lab may be a man; every other adult in Perinexa is a woman)
const men = (low, high) => ({ sex: 'male', pregnant: '', ageUnit: 'years', fromAge: null, toAge: null, low, high, range: '' });
const inSection = (section, fields) => fields.map((f) => ({ ...f, section }));

function rangeText(low, high, unit) {
  if (low != null && high != null) return `${low}–${high} ${unit}`.trim();
  if (high != null) return `up to ${high} ${unit}`.trim();
  if (low != null) return `${low} ${unit} or more`.trim();
  return '';
}

import { NEWBORN_GROUPS, NEWBORN_TESTS } from './newbornTests.js';

const REACTIVE = ['Non-reactive', 'Reactive'];
const GRADES = ['Nil', 'Trace', '1+', '2+', '3+', '4+'];

const ADULT_GROUPS = { blood: 'Blood counts', screening: 'Pregnancy screening', sugar: 'Blood sugar', chemistry: 'Biochemistry', hormones: 'Hormones', antibodies: 'Antibodies', urine: 'Urine', other: 'Other' };
// The antibody tests of the recurrent-pregnancy-loss work-up (5 Oct 2026; the package is in builtInPackages.js).
// Their cut-offs depend on the lab's kit, so most have no range here: the lab flags a result from its own report.
const APS = 'over 40 counts for antiphospholipid syndrome (Sydney criteria 2006)';

// The beta hCG follow-up tests of the pregnancy-loss care plan (careplans/otherDrafts.js ABORTION_DRAFT) that a
// reviewed result ticks: after a molar pregnancy, and the weekly tests after an ectopic managed by waiting or with
// methotrexate. NOT the ectopic tests of days 2, 4 and 7: they share week 0 or 1 with the first hCG, which is usually
// taken on the day she is seen – that result would be counted as "day 2", and each later one as the test before it.
// The doctor ticks those three (the plan shows them due until then).
const LOSS_HCG_ITEMS = [
  ...['2w', '4w', '6w', '8w', '3m', '4m', '5m', '6m'].map((k) => `loss_molar_hcg_${k}`),
  ...['w2', 'w3', 'w4', 'w5', 'w6'].map((k) => `loss_ect_hcg_${k}`),
];

// The sensitivity panels of the culture template (the lab can mark each Sensitive, Intermediate or Resistant)
const URINE_ANTIBIOTICS = ['Amoxicillin-clavulanate', 'Nitrofurantoin', 'Fosfomycin', 'Cefuroxime', 'Cefixime', 'Ceftriaxone', 'Ciprofloxacin', 'Norfloxacin', 'Cotrimoxazole', 'Gentamicin', 'Amikacin', 'Piperacillin-tazobactam', 'Meropenem'];
const SWAB_ANTIBIOTICS = ['Penicillin', 'Ampicillin', 'Amoxicillin-clavulanate', 'Cefuroxime', 'Ceftriaxone', 'Clindamycin', 'Erythromycin', 'Azithromycin', 'Gentamicin', 'Ciprofloxacin', 'Cotrimoxazole', 'Vancomycin'];

const ADULT_TESTS = [
  // The full count (report templates, 19 Oct 2026): adult reference intervals as commonly used in Indian labs (Dacie and
  // Lewis, Practical Haematology). The first three values were the whole CBC before; their keys stay.
  { key: 'cbc', name: 'Complete blood count (CBC)', group: 'blood', sample: 'Blood (EDTA)', planKeys: ['lab_cbc', 'lab_hb28', 'lab_hb36', 'pnc_hb', 'gyn_hb', 'loss_hb'],
    report: { template: 'table', method: 'Automated cell counter; differential count by microscopy when flagged', notes: 'Haemoglobin below 11 g/dL in pregnancy is anaemia (WHO). An automated count with abnormal flags is checked on a stained smear.' },
    fields: [
      ...inSection('Haemoglobin and red cells', [
        num('hb', 'Haemoglobin', 'g/dL', 11, 16, '11–16 g/dL (below 11 in pregnancy is anaemia)', { bands: [men(13, 17)] }),
        num('rbc', 'Total RBC count', 'million/µL', 3.8, 4.8, '', { bands: [men(4.5, 5.5)] }),
        num('pcv', 'Packed cell volume (PCV)', '%', 36, 46, '', { bands: [men(40, 50)] }),
      ]),
      ...inSection('Red cell indices', [
        num('mcv', 'MCV', 'fL', 83, 101, '', { calc: 'mcv' }),
        num('mch', 'MCH', 'pg', 27, 32, '', { calc: 'mch' }),
        num('mchc', 'MCHC', 'g/dL', 31.5, 34.5, '', { calc: 'mchc' }),
        num('rdw', 'RDW-CV', '%', 11.6, 14),
      ]),
      ...inSection('White cells', [
        num('tlc', 'Total WBC count', '/µL', 4000, 11000),
        num('neutrophils', 'Neutrophils', '%', 40, 80),
        num('lymphocytes', 'Lymphocytes', '%', 20, 40),
        num('monocytes', 'Monocytes', '%', 2, 10),
        num('eosinophils', 'Eosinophils', '%', 1, 6),
        num('basophils', 'Basophils', '%', 0, 2),
      ]),
      ...inSection('Platelets', [num('platelets', 'Platelets', 'lakh/µL', 1.5, 4.5)]),
      para('smear', 'Peripheral smear', 'Peripheral smear'),
    ] },
  { key: 'hb', name: 'Haemoglobin (Hb)', group: 'blood', sample: 'Blood (EDTA)', planKeys: ['lab_hb28', 'lab_hb36', 'pnc_hb', 'gyn_hb', 'loss_hb'], fields: [num('hb', 'Haemoglobin', 'g/dL', 11, 16, '11–16 g/dL (below 11 in pregnancy is anaemia)', { bands: [men(13, 17)] })] },
  { key: 'group', name: 'Blood group and Rh', group: 'blood', sample: 'Blood (EDTA)', planKeys: ['lab_group'], fields: [choice('group', 'Blood group', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], [])] },
  { key: 'ict', name: 'Indirect Coombs test (ICT)', group: 'screening', sample: 'Blood (plain)', report: { template: 'serology', method: '', notes: 'If positive, the antibody titre is done and followed in pregnancy.' }, planKeys: ['lab_ict1', 'lab_ict28'], fields: [choice('ict', 'ICT', ['Negative', 'Positive'], ['Positive'])] },
  { key: 'hiv', name: 'HIV 1 and 2', group: 'screening', sample: 'Blood (plain)', report: { template: 'serology', method: '', notes: 'A reactive screening result is confirmed as per NACO guidelines before it is given to the patient.' }, planKeys: ['lab_hiv'], fields: [choice('hiv', 'HIV', REACTIVE, ['Reactive'])] },
  { key: 'vdrl', name: 'VDRL (syphilis)', group: 'screening', sample: 'Blood (plain)', report: { template: 'serology', method: '', notes: 'A reactive VDRL is confirmed with a treponemal test (TPHA) and reported with its titre.' }, planKeys: ['lab_vdrl'], fields: [choice('vdrl', 'VDRL', REACTIVE, ['Reactive'])] },
  { key: 'hbsag', name: 'HBsAg (hepatitis B)', group: 'screening', sample: 'Blood (plain)', report: { template: 'serology', method: '', notes: '' }, planKeys: ['lab_hbsag'], fields: [choice('hbsag', 'HBsAg', REACTIVE, ['Reactive'])] },
  { key: 'hcv', name: 'Anti-HCV (hepatitis C)', group: 'screening', sample: 'Blood (plain)', report: { template: 'serology', method: '', notes: '' }, planKeys: [], fields: [choice('hcv', 'Anti-HCV', REACTIVE, ['Reactive'])] },
  { key: 'tsh', name: 'TSH (thyroid)', group: 'hormones', sample: 'Blood (plain)', planKeys: ['lab_tsh'], fields: [num('tsh', 'TSH', 'µIU/mL', 0.4, 4.0, '0.4–4.0 µIU/mL (lower limits in pregnancy – doctor to judge)')] },
  { key: 'antiTpo', name: 'Anti-TPO antibodies (thyroid)', group: 'antibodies', sample: 'Blood (plain)', planKeys: [],
    fields: [num('antiTpo', 'Anti-TPO antibodies', 'IU/mL', null, null, "the lab's own cut-off (kits differ)")] },
  { key: 'lupusAnticoagulant', name: 'Lupus anticoagulant (LA)', group: 'antibodies', sample: 'Blood (citrate) – before any heparin is started', planKeys: [],
    fields: [choice('la', 'Lupus anticoagulant', ['Negative', 'Positive', 'Indeterminate'], ['Positive', 'Indeterminate'])] },
  { key: 'acl', name: 'Anticardiolipin antibodies (IgG and IgM)', group: 'antibodies', sample: 'Blood (plain)', planKeys: [],
    fields: [num('aclIgg', 'Anticardiolipin IgG', 'GPL U/mL', null, null, `the lab's own cut-off; ${APS}`), num('aclIgm', 'Anticardiolipin IgM', 'MPL U/mL', null, null, `the lab's own cut-off; ${APS}`)] },
  { key: 'b2gpi', name: 'Anti-beta-2-glycoprotein I antibodies (IgG and IgM)', group: 'antibodies', sample: 'Blood (plain)', planKeys: [],
    fields: [
      num('b2gpiIgg', 'Anti-beta-2-glycoprotein I IgG', 'U/mL', null, null, "the lab's own cut-off (above its 99th percentile counts for antiphospholipid syndrome)"),
      num('b2gpiIgm', 'Anti-beta-2-glycoprotein I IgM', 'U/mL', null, null, "the lab's own cut-off (above its 99th percentile counts for antiphospholipid syndrome)"),
    ] },
  { key: 'ogtt', name: 'OGTT 75 g, 2-hour (DIPSI)', group: 'sugar', sample: 'Blood (fluoride), 2 hours after 75 g glucose', report: { template: 'table', method: 'Glucose oxidase–peroxidase (GOD-POD)', notes: 'DIPSI (Government of India, 2018): 75 g glucose whether fasting or not; a 2-hour value of 140 mg/dL or more is gestational diabetes.' }, planKeys: ['lab_ogtt1', 'lab_ogtt2', 'pnc_sugar'], fields: [num('glucose2h', '2-hour glucose', 'mg/dL', null, 139, 'below 140 mg/dL')] },
  { key: 'fbs', name: 'Fasting blood sugar', group: 'sugar', sample: 'Blood (fluoride), fasting', planKeys: ['pnc_sugar'], fields: [num('fbs', 'Fasting glucose', 'mg/dL', 70, 99)] },
  { key: 'ppbs', name: 'Post-meal blood sugar (2 hours)', group: 'sugar', sample: 'Blood (fluoride)', planKeys: [], fields: [num('ppbs', 'Post-meal glucose', 'mg/dL', null, 139, 'below 140 mg/dL')] },
  { key: 'rbs', name: 'Random blood sugar', group: 'sugar', sample: 'Blood (fluoride)', planKeys: [], fields: [num('rbs', 'Random glucose', 'mg/dL', null, 139, 'below 140 mg/dL')] },
  { key: 'hba1c', name: 'HbA1c', group: 'sugar', sample: 'Blood (EDTA)', report: { template: 'table', method: 'HPLC (NGSP certified)', notes: 'ADA: below 5.7 % normal; 5.7–6.4 % prediabetes; 6.5 % or more diabetes. Less reliable in pregnancy, anaemia and haemoglobin variants.' }, planKeys: [], fields: [num('hba1c', 'HbA1c', '%', null, 5.6, 'below 5.7 %')] },
  { key: 'lft', name: 'Liver function tests (LFT)', group: 'chemistry', sample: 'Blood (plain)', planKeys: [],
    report: { template: 'table', method: 'Automated chemistry analyser', notes: 'Alkaline phosphatase rises normally in the third trimester (from the placenta); albumin is a little lower in pregnancy.' },
    fields: [
      ...inSection('Bilirubin', [num('bilirubin', 'Total bilirubin', 'mg/dL', 0.2, 1.2), num('directBilirubin', 'Direct bilirubin', 'mg/dL', null, 0.3), num('indirectBilirubin', 'Indirect bilirubin', 'mg/dL', 0.1, 1.0, '', { calc: 'indirectBilirubin' })]),
      ...inSection('Enzymes', [num('sgot', 'SGOT (AST)', 'U/L', null, 40), num('sgpt', 'SGPT (ALT)', 'U/L', null, 40), num('alp', 'Alkaline phosphatase (ALP)', 'U/L', 35, 104, '', { bands: [men(40, 129)] }), num('ggt', 'Gamma GT (GGT)', 'U/L', null, 32, '', { bands: [men(null, 55)] })]),
      ...inSection('Proteins', [num('totalProtein', 'Total protein', 'g/dL', 6.4, 8.3), num('albumin', 'Albumin', 'g/dL', 3.5, 5.2), num('globulin', 'Globulin', 'g/dL', 2.0, 3.5, '', { calc: 'globulin' }), num('agRatio', 'A/G ratio', '', 1.0, 2.1, '', { calc: 'agRatio' })]),
    ] },
  { key: 'rft', name: 'Kidney function tests (RFT)', group: 'chemistry', sample: 'Blood (plain)', planKeys: [],
    report: { template: 'table', method: 'Automated chemistry analyser; electrolytes by ion-selective electrode', notes: 'Creatinine and urea are normally lower in pregnancy: a creatinine of 0.9 mg/dL or more in pregnancy needs attention.' },
    fields: [
      ...inSection('Kidney', [num('urea', 'Blood urea', 'mg/dL', 15, 40), num('creatinine', 'Serum creatinine', 'mg/dL', 0.5, 1.1, '', { bands: [men(0.7, 1.3)] }), num('uricAcid', 'Uric acid', 'mg/dL', 2.4, 6.0, '', { bands: [men(3.4, 7.0)] })]),
      ...inSection('Electrolytes', [num('sodium', 'Sodium', 'mmol/L', 136, 145), num('potassium', 'Potassium', 'mmol/L', 3.5, 5.1), num('chloride', 'Chloride', 'mmol/L', 98, 107)]),
    ] },
  // Thyroid profile and lipid profile (report templates, 19 Oct 2026). TSH in pregnancy: ATA 2017 – use the lab's own
  // trimester range; without one, an upper limit of about 4.0 µIU/mL.
  { key: 'thyroid', name: 'Thyroid profile (T3, T4, TSH)', group: 'hormones', sample: 'Blood (plain)', planKeys: ['lab_tsh'],
    report: { template: 'table', method: 'Chemiluminescence immunoassay (CLIA)', notes: 'In pregnancy TSH is judged by trimester-specific ranges (ATA 2017); free T4 is preferred to total T4.' },
    fields: [num('t3', 'Total T3', 'ng/dL', 80, 200), num('t4', 'Total T4', 'µg/dL', 5.1, 14.1), num('ft4', 'Free T4', 'ng/dL', 0.9, 1.7), num('tsh', 'TSH', 'µIU/mL', 0.4, 4.0, '0.4–4.0 µIU/mL (lower limits in pregnancy – doctor to judge)')] },
  { key: 'lipid', name: 'Lipid profile', group: 'chemistry', sample: 'Blood (plain), fasting 9–12 hours', planKeys: [],
    report: { template: 'table', method: 'Enzymatic (CHOD-PAP, GPO-PAP); direct HDL', notes: 'NCEP ATP III targets. LDL is worked out by the Friedewald formula when not measured, and not with triglycerides of 400 mg/dL or more. Lipids rise normally in pregnancy.' },
    fields: [
      num('totalChol', 'Total cholesterol', 'mg/dL', null, 199, 'below 200 mg/dL'),
      num('tg', 'Triglycerides', 'mg/dL', null, 149, 'below 150 mg/dL'),
      num('hdl', 'HDL cholesterol', 'mg/dL', 50, null, '50 mg/dL or more', { bands: [men(40, null)] }),
      num('ldl', 'LDL cholesterol', 'mg/dL', null, 99, 'below 100 mg/dL', { calc: 'ldl' }),
      num('vldl', 'VLDL cholesterol', 'mg/dL', null, 30, 'up to 30 mg/dL', { calc: 'vldl' }),
      num('cholHdlRatio', 'Total cholesterol / HDL', '', null, 4.5, 'up to 4.5', { calc: 'cholHdlRatio' }),
    ] },
  { key: 'ferritin', name: 'Serum ferritin', group: 'chemistry', sample: 'Blood (plain)', planKeys: [], report: { template: 'table', method: 'Chemiluminescence immunoassay (CLIA)', notes: 'In pregnancy a ferritin below 30 ng/mL suggests iron deficiency. Ferritin rises with infection or inflammation.' }, fields: [num('ferritin', 'Ferritin', 'ng/mL', 15, 150, '', { bands: [men(30, 400)] })] },
  // Itching in pregnancy (obstetric cholestasis). RCOG Green-top Guideline 43 (2022): a total bile acid of 19 µmol/L or
  // more with itching. Added 5 Oct 2026 (the information sheet on cholestasis noted it was missing).
  { key: 'bileAcids', name: 'Serum bile acids (total)', group: 'chemistry', sample: 'Blood (plain) – fasting not needed', planKeys: [],
    fields: [num('bileAcids', 'Total bile acids', 'µmol/L', null, 18.9, 'below 19 µmol/L in pregnancy (19 or more with itching: obstetric cholestasis – RCOG Green-top Guideline 43, 2022)')] },
  // A number: the lab types it as the report gives it ("1,23,456" or "85000" – labNumber below). No usual range, so no
  // automatic flag: the doctor judges it by the weeks and the earlier values.
  { key: 'bhcg', name: 'Beta hCG (quantitative)', group: 'hormones', sample: 'Blood (plain)', planKeys: LOSS_HCG_ITEMS, planSeries: true,
    fields: [num('bhcg', 'Beta hCG', 'mIU/mL', null, null, 'doctor to judge by the weeks (1 mIU/mL is the same as 1 IU/L)')] },
  { key: 'hormones', name: 'Day 2–3 hormones (FSH, LH, AMH, prolactin)', group: 'hormones', sample: 'Blood (plain), day 2–3 of the period', planKeys: ['inf_hormones'],
    fields: [num('fsh', 'FSH', 'mIU/mL', null, 10, 'below 10 mIU/mL'), num('lh', 'LH', 'mIU/mL', null, null, 'doctor to judge'), num('amh', 'AMH', 'ng/mL', 1.0, null, '1.0 ng/mL or more'), num('prolactin', 'Prolactin', 'ng/mL', null, 25, 'below 25 ng/mL')] },
  { key: 'urine', name: 'Urine routine and microscopy', group: 'urine', sample: 'Urine (midstream)', planKeys: ['lab_urine'],
    report: { template: 'table', method: 'Dipstick (reagent strip) and microscopy of the centrifuged deposit', notes: '' },
    fields: [
      ...inSection('Physical', [
        choice('colour', 'Colour', ['Pale yellow', 'Yellow', 'Dark yellow', 'Red', 'Brown', 'Other'], ['Red', 'Brown']),
        choice('appearance', 'Appearance', ['Clear', 'Slightly turbid', 'Turbid'], ['Turbid']),
        num('specificGravity', 'Specific gravity', '', 1.005, 1.030),
        num('ph', 'pH', '', 4.5, 8.0),
      ]),
      ...inSection('Chemical', [
        choice('albumin', 'Albumin', GRADES, ['1+', '2+', '3+', '4+']),
        choice('sugar', 'Sugar', GRADES, ['1+', '2+', '3+', '4+']),
        choice('ketones', 'Ketones', GRADES, ['1+', '2+', '3+', '4+']),
        choice('bileSalts', 'Bile salts', ['Absent', 'Present'], ['Present']),
        choice('bilePigments', 'Bile pigments', ['Absent', 'Present'], ['Present']),
        choice('blood', 'Blood', GRADES, ['1+', '2+', '3+', '4+']),
        choice('nitrite', 'Nitrite', ['Negative', 'Positive'], ['Positive']),
      ]),
      ...inSection('Microscopy', [
        num('pusCells', 'Pus cells', '/hpf', null, 5, '0–5 /hpf'),
        num('rbcUrine', 'Red cells', '/hpf', null, 2, '0–2 /hpf'),
        num('epithelial', 'Epithelial cells', '/hpf', null, 5, '0–5 /hpf'),
        text('casts', 'Casts'),
        text('crystals', 'Crystals'),
        choice('bacteria', 'Bacteria', ['Nil', 'Few', 'Many'], ['Many']),
        text('others', 'Others'),
      ]),
    ] },
  { key: 'urineCulture', name: 'Urine culture and sensitivity', group: 'urine', sample: 'Urine (sterile container)', planKeys: [],
    report: { template: 'culture', method: 'Semi-quantitative culture; sensitivity by disc diffusion (CLSI)', notes: 'More than 1,00,000 CFU/mL of one organism is significant bacteriuria. The treating doctor chooses the antibiotic, taking pregnancy into account.', ownPage: true },
    antibiotics: URINE_ANTIBIOTICS,
    fields: [choice('growth', 'Growth', ['No growth', 'Growth'], ['Growth']), text('organism', 'Organism isolated'), text('colonyCount', 'Colony count')] },
  { key: 'hvsCulture', name: 'High vaginal swab culture and sensitivity', group: 'other', sample: 'High vaginal swab (sterile swab in transport medium)', planKeys: [],
    report: { template: 'culture', method: 'Gram stain; culture; sensitivity by disc diffusion (CLSI)', notes: 'The treating doctor chooses the antibiotic, taking pregnancy into account.', ownPage: true },
    antibiotics: SWAB_ANTIBIOTICS,
    fields: [text('gramStain', 'Gram stain'), choice('growth', 'Growth', ['No growth', 'Normal flora', 'Growth'], ['Growth']), text('organism', 'Organism isolated')] },
  { key: 'semen', name: 'Semen analysis (partner)', group: 'other', sample: 'Semen', planKeys: ['inf_semen'],
    report: { template: 'table', method: 'Manual, WHO laboratory manual (6th edition, 2021)', notes: 'The ranges are the WHO 2021 lower reference limits; one analysis is repeated before a conclusion.' },
    fields: [num('count', 'Sperm concentration', 'million/mL', 16, null, '16 million/mL or more (WHO 2021)'), num('motility', 'Total motility', '%', 42, null, '42 % or more'), num('morphology', 'Normal forms', '%', 4, null, '4 % or more')] },
  // Reported in the Bethesda System 2014 layout (report templates, 19 Oct 2026). `result` and `details` keep their keys.
  { key: 'pap', name: 'Pap smear / cervical screening', group: 'other', sample: 'Cervical smear', planKeys: ['gyn_cervix', 'gyn_cervix_repeat'],
    report: { template: 'narrative', method: 'Conventional or liquid-based cytology, Papanicolaou stain; The Bethesda System 2014', notes: '', ownPage: true },
    fields: [
      choice('specimenType', 'Specimen type', ['Conventional smear', 'Liquid-based'], []),
      choice('adequacy', 'Specimen adequacy', ['Satisfactory for evaluation', 'Unsatisfactory for evaluation'], ['Unsatisfactory for evaluation']),
      choice('result', 'Result', ['Negative (NILM)', 'Abnormal'], ['Abnormal']),
      choice('bethesda', 'Interpretation (Bethesda)', ['NILM – negative for intraepithelial lesion or malignancy', 'ASC-US', 'ASC-H', 'LSIL', 'HSIL', 'Squamous cell carcinoma', 'AGC – atypical glandular cells', 'AIS – adenocarcinoma in situ', 'Adenocarcinoma'], ['ASC-US', 'ASC-H', 'LSIL', 'HSIL', 'Squamous cell carcinoma', 'AGC – atypical glandular cells', 'AIS – adenocarcinoma in situ', 'Adenocarcinoma']),
      text('organisms', 'Organisms'),
      para('details', 'Details'),
    ] },
  { key: 'histopath', name: 'Histopathology (tissue biopsy)', group: 'other', sample: 'Tissue in 10 % formalin', planKeys: [],
    report: { template: 'narrative', method: 'Formalin-fixed, paraffin-embedded sections, haematoxylin and eosin stain', notes: '', ownPage: true },
    fields: [para('specimen', 'Specimen'), para('clinical', 'Clinical details'), para('gross', 'Gross examination'), para('microscopy', 'Microscopy'), para('diagnosis', 'Diagnosis'), para('comment', 'Comment')] },
];

// who: 'adult' – the tests above (mostly the mother's); 'newborn' – a baby's tests (newbornTests.js). A patient
// registered for newborn care is offered only the baby's tests, everyone else only the adult tests.
export const LAB_GROUPS = { ...ADULT_GROUPS, ...NEWBORN_GROUPS };
export const LAB_TESTS = [...ADULT_TESTS.map((t) => ({ ...t, who: 'adult' })), ...NEWBORN_TESTS.map((t) => ({ planKeys: [], ...t, who: 'newborn' }))];
/** Which tests a patient may be given: 'newborn' for a baby, 'adult' for everyone else. */
export const testsFor = (patient) => (patient.careType === 'newborn' ? 'newborn' : 'adult');

export const LAB_TEST_KEYS = LAB_TESTS.map((t) => t.key);
export const OTHER_TEST = 'other'; // a test typed by the doctor: the lab writes the result as text
export const testByKey = new Map(LAB_TESTS.map((t) => [t.key, t]));

export const AMBIGUOUS_NUMBER = 'Write it without the comma (1500), or with a point if it is a decimal (1.5).';

/**
 * A number as the lab typed it: { value } as it is stored ('1500', '12.5'), or { error } in words. The website has
 * the same rule (client/src/pages/lab/labFormat.js; a test checks they agree).
 *  - A point is the decimal mark: "12.5".
 *  - Commas that group the digits are taken out – Indian "1,23,456", international "1,234,567", or any grouping
 *    with a decimal point after it ("1,500.5") – but only in a field that can hold such a number (field: the test's
 *    field; groupsDigits). Elsewhere a grouped number is a count in another unit: platelets typed "1,40,000" in a
 *    lakh/µL field are refused with the unit, never stored as 140000.
 *  - One comma with one or two digits after it is a decimal comma: "12,5" is 12.5.
 *  - One comma with three digits after it and no point ("1,500", "85,000") could mean either, so it is refused with
 *    a question: a beta hCG of 1,500 must never be stored as 1.5.
 */
export function labNumber(text, field = null) {
  const t = String(text ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return { value: t };
  if (/^-?\d+,\d{1,2}$/.test(t)) return { value: t.replace(',', '.') };
  if (/^-?\d{1,3},\d{3}$/.test(t)) return { error: AMBIGUOUS_NUMBER };
  const indian = /^-?\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/;
  const international = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  if (indian.test(t) || international.test(t)) return groupsDigits(field) ? { value: t.replace(/,/g, '') } : { error: tooLarge(field) };
  return { error: 'Enter a number.' };
}

/**
 * Can this number field hold a number written with grouping commas (1,000 or more)? Yes when it has no usual range
 * (beta hCG, LH, the antibody tests) or its range reaches 1,000 (a white cell count per µL); no for the others
 * (haemoglobin, platelets in lakh/µL …). Without a field: yes.
 */
export const groupsDigits = (field) => !field || (field.low == null && field.high == null) || (field.high ?? Infinity) >= 1000 || (field.low ?? 0) >= 1000;
const tooLarge = (field) => `This is far too large for ${field.unit ? `${field.unit} – check the unit` : 'this test – check the number'}${field.range ? ` (${field.range})` : ''}.`;

/**
 * High, Low, Abnormal or '' for one value (the lab can change it). A number with no usual range (beta hCG, LH, most
 * antibody tests) gets no flag: '' ("Not flagged") – never "Normal", which would only mean "no range was set".
 */
export function flagFor(field, value) {
  if (value === '' || value == null || !field) return '';
  if (field.type === 'number') {
    if (field.low == null && field.high == null) return '';
    const parsed = labNumber(value, field);
    const n = parsed.error ? NaN : Number(parsed.value);
    if (!Number.isFinite(n)) return '';
    if (field.low != null && n < field.low) return 'low';
    if (field.high != null && n > field.high) return 'high';
    return 'normal';
  }
  if (field.type === 'choice') return field.abnormal.includes(value) ? 'abnormal' : 'normal';
  return '';
}

export const FLAGS = ['', 'normal', 'low', 'high', 'abnormal'];
export const isAbnormal = (flag) => ['low', 'high', 'abnormal'].includes(flag);

/** The catalogue for the browser (the order form and the result form). */
export const catalogueView = () => ({
  groups: LAB_GROUPS,
  tests: LAB_TESTS.map(({ key, name, group, sample, fields, who }) => ({ key, name, group, sample, fields, who })),
});
