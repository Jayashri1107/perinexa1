// Words used by obstetricians and gynaecologists in India – full terms, short forms, Indian usage and common
// medicine names (Indian brands too) – and what each means in the patient form. Voice entry (dictation.js)
// uses them to fill the form, and gives them to the browser's speech recognition so it hears them better.
// To add a word: put it in `says` of the right entry (or add an entry). Each doctor can also teach their own.
//
// `to` – what the term means:
//   condition:<key>  tick box under "Existing conditions"
//   past:<key>       tick box under "Problems in previous pregnancies"
//   other:<label>    written in "Other conditions" (there is no tick box for it)
//   note:<label>     written in the notes (mostly about this pregnancy or delivery)
// `says` – the ways it is said or written (spaces and hyphens optional, capitals don't matter).
// `now` – a previous-pregnancy problem that can also happen in this pregnancy / delivery: what it means then
//   (written in the notes). `nowIn`: the types of care where "this pregnancy" is possible (otherwise: previous).
// `only` – the types of care it applies to (default: all except newborn).
// `result` – a test: ticked only when "positive" / "reactive" is said with it.
// `delivery` – about this delivery: not used when said with "previous".
// `couple` – still recorded when said about the husband (male-factor infertility).

import { mentionsFetalSex } from '../../pcpndtWords.js';

const PREGNANT = ['antenatal'];
const PREGNANCY = ['antenatal', 'postnatal'];
// Pregnancy loss (Abortion type of care): only the few words below that fit it – never breech, EDD, scans and the like.
const LOSS = ['abortion'];

export const TERMS = [
  // ---------- Existing conditions ----------
  {
    to: 'condition:diabetes',
    says: ['diabetes', 'diabetes mellitus', 'diabetic', 'known diabetic', 'DM', 'T1DM', 'T2DM', 'type 1 diabetes', 'type 2 diabetes', 'type 1 DM', 'type 2 DM', 'IDDM', 'NIDDM', 'pregestational diabetes', 'overt diabetes'],
  },
  { to: 'condition:hypertension', says: ['hypertension', 'hypertensive', 'HTN', 'chronic hypertension', 'CHTN', 'essential hypertension'] },
  {
    to: 'condition:thyroid',
    says: [
      'hypothyroidism', 'hypothyroid', 'hyperthyroidism', 'hyperthyroid', 'thyroid', 'thyroid disease', 'thyroid disorder', 'thyroid problem', 'thyrotoxicosis',
      "Hashimoto's", 'Hashimoto', "Graves'", 'Graves disease', 'thyroxine', 'levothyroxine', 'Eltroxin', 'Thyronorm', 'Thyrox', 'Lethyrox', 'carbimazole',
      'Neomercazole', 'methimazole', 'propylthiouracil', 'PTU',
    ],
  },
  {
    to: 'condition:heart_disease',
    says: [
      'heart disease', 'cardiac disease', 'heart problem', 'cardiac problem', 'RHD', 'rheumatic heart disease', 'rheumatic heart', 'mitral stenosis',
      'mitral regurgitation', 'aortic stenosis', 'MVR', 'valve replacement', 'prosthetic valve', 'valvular heart disease', 'congenital heart disease', 'ASD',
      'VSD', 'PDA', 'TOF', 'tetralogy of Fallot', 'cardiomyopathy', 'peripartum cardiomyopathy', 'PPCM', 'hole in the heart',
    ],
  },
  { to: 'condition:asthma', says: ['asthma', 'asthmatic', 'asthama', 'bronchial asthma', 'inhaler', 'inhalers'] },
  {
    to: 'condition:epilepsy',
    says: [
      'epilepsy', 'epileptic', 'seizure disorder', 'seizures', 'fits', 'convulsions', 'antiepileptic', 'antiepileptics', 'levetiracetam', 'Levipil', 'Keppra',
      'phenytoin', 'Eptoin', 'Dilantin', 'carbamazepine', 'Tegretol', 'lamotrigine', 'Lamictal', 'valproate', 'sodium valproate', 'Valparin', 'oxcarbazepine',
    ],
  },
  {
    to: 'condition:anaemia',
    says: [
      'anaemia', 'anemia', 'anaemic', 'anemic', 'low haemoglobin', 'low hemoglobin', 'low Hb', 'iron deficiency anaemia', 'iron deficiency anemia', 'IDA',
      'IV iron', 'iron sucrose', 'FCM', 'ferric carboxymaltose',
    ],
  },
  {
    to: 'condition:tuberculosis',
    says: [
      'tuberculosis', 'TB', "Koch's", 'Kochs', 'Koch', 'pulmonary TB', 'genital TB', 'abdominal TB', 'ATT', 'AKT', 'anti-tubercular treatment',
      'antitubercular treatment', 'anti TB treatment',
    ],
  },
  { to: 'condition:hiv', result: true, says: ['HIV', 'RVD', 'retroviral disease', 'PLHIV', 'PLWHA'] },
  { to: 'condition:hepatitis_b', result: true, says: ['HBsAg', 'hepatitis B', 'hep B', 'HBV', 'Australia antigen'] },
  { to: 'condition:syphilis', result: true, says: ['VDRL', 'RPR', 'TPHA'] },
  { to: 'condition:syphilis', says: ['syphilis'] },
  {
    to: 'condition:uterine_surgery',
    says: [
      'myomectomy', 'hysterotomy', 'uterine surgery', 'surgery on the uterus', 'cornual resection', 'septal resection', 'septum resection', 'uterine perforation',
      'uterine rupture', 'rupture uterus', 'ruptured uterus', 'scar rupture',
    ],
  },
  {
    to: 'condition:renal_disease',
    says: [
      'kidney disease', 'renal disease', 'CKD', 'chronic kidney disease', 'nephrotic syndrome', 'nephritis', 'glomerulonephritis', 'dialysis', 'renal transplant',
      'kidney transplant', 'renal failure',
    ],
  },
  {
    to: 'condition:autoimmune',
    says: [
      'SLE', 'lupus', 'APS', 'APLA', 'APLA syndrome', 'antiphospholipid syndrome', 'antiphospholipid antibody syndrome', 'autoimmune disease', 'autoimmune',
      'rheumatoid arthritis', "Sjogren's", 'Sjogren', 'scleroderma', 'systemic sclerosis', 'HCQ', 'hydroxychloroquine',
    ],
  },
  {
    to: 'condition:thrombophilia',
    says: ['thrombophilia', 'clotting disorder', 'protein C deficiency', 'protein S deficiency', 'factor V Leiden', 'antithrombin deficiency'],
  },
  {
    to: 'condition:mental_health',
    says: [
      'depression', 'depressive disorder', 'anxiety disorder', 'bipolar', 'bipolar disorder', 'schizophrenia', 'psychosis', 'psychiatric illness',
      'mental illness', 'mental health condition', 'OCD', 'postpartum depression', 'postnatal depression', 'puerperal psychosis', 'antidepressant',
      'antidepressants', 'sertraline', 'fluoxetine', 'escitalopram',
    ],
  },
  { to: 'condition:liver_disease', says: ['liver disease', 'chronic liver disease', 'CLD', 'cirrhosis', 'jaundice', 'hepatitis E', 'fatty liver'] },
  { to: 'condition:liver_disease', result: true, says: ['HCV', 'anti HCV', 'hepatitis C', 'hep C'] },

  // ---------- Problems in previous pregnancies ----------
  {
    to: 'past:stillbirth_or_neonatal_death',
    now: 'note:Intrauterine fetal death (this pregnancy)',
    nowIn: PREGNANCY,
    says: [
      'stillbirth', 'stillbirths', 'still birth', 'stillborn', 'IUFD', 'intrauterine fetal death', 'intrauterine death', 'fetal demise', 'MSB',
      'macerated stillbirth', 'FSB', 'fresh stillbirth',
    ],
  },
  {
    to: 'past:stillbirth_or_neonatal_death',
    now: 'note:Neonatal death (this delivery)',
    nowIn: ['postnatal'],
    says: ['NND', 'neonatal death', 'early neonatal death', 'baby died', 'baby expired', 'newborn death'],
  },
  {
    to: 'past:preterm_birth',
    now: 'note:Preterm labour (this pregnancy)',
    nowIn: PREGNANCY,
    says: ['preterm birth', 'preterm births', 'preterm delivery', 'preterm deliveries', 'preterm labour', 'preterm labor', 'premature delivery', 'premature birth', 'premature baby', 'preterm baby', 'PTB', 'PTL', 'preterm', 'pre term'],
  },
  {
    to: 'past:pre_eclampsia',
    now: 'note:Pre-eclampsia (this pregnancy)',
    nowIn: PREGNANCY,
    says: ['pre-eclampsia', 'preeclampsia', 'eclampsia', 'eclamptic', 'eclamptic fits', 'HELLP', 'HELLP syndrome', 'imminent eclampsia', 'severe pre-eclampsia', 'toxaemia', 'toxemia'],
  },
  {
    to: 'past:congenital_anomaly',
    now: 'note:Fetal anomaly (this pregnancy)',
    nowIn: PREGNANT,
    says: [
      'congenital anomaly', 'congenital anomalies', 'congenital malformation', 'congenital malformations', 'birth defect', 'birth defects', 'anomalous baby',
      'baby with anomaly', 'anomaly baby', 'NTD', 'neural tube defect', 'anencephaly', 'spina bifida', 'meningomyelocele', 'hydrocephalus', "Down's syndrome",
      'Down syndrome', 'trisomy 21', 'cleft lip', 'cleft palate', 'club foot',
    ],
  },
  {
    to: 'past:low_birth_weight_baby',
    now: 'note:Fetal growth restriction (this pregnancy)',
    nowIn: PREGNANT,
    says: ['low birth weight', 'LBW', 'small baby', 'SGA', 'small for gestational age', 'IUGR', 'FGR', 'fetal growth restriction', 'growth restriction', 'growth restricted'],
  },
  {
    to: 'past:big_baby',
    now: 'note:Large baby / macrosomia (this pregnancy)',
    nowIn: PREGNANT,
    says: ['big baby', 'large baby', 'macrosomia', 'macrosomic', 'macrosomic baby', 'LGA', 'large for gestational age'],
  },
  {
    to: 'past:obstructed_labour',
    now: 'note:Obstructed labour (this delivery)',
    nowIn: ['postnatal'],
    says: ['obstructed labour', 'obstructed labor', 'deep transverse arrest', 'DTA'],
  },
  {
    to: 'past:pph',
    now: 'note:PPH (this delivery)',
    nowIn: ['postnatal'],
    says: [
      'PPH', 'postpartum haemorrhage', 'postpartum hemorrhage', 'post partum haemorrhage', 'post partum hemorrhage', 'atonic PPH', 'traumatic PPH',
      'heavy bleeding after delivery', 'retained placenta', 'MRP', 'manual removal of placenta',
    ],
  },
  {
    to: 'past:rh_isoimmunisation',
    now: 'note:Rh sensitisation – ICT positive (this pregnancy)',
    nowIn: [...PREGNANT, ...LOSS],
    says: [
      'Rh isoimmunisation', 'Rh isoimmunization', 'isoimmunisation', 'isoimmunization', 'alloimmunisation', 'alloimmunization', 'Rh sensitisation',
      'Rh sensitization', 'ICT positive', 'indirect Coombs positive',
    ],
  },
  { to: 'past:rh_isoimmunisation', now: 'note:Fetal hydrops (this pregnancy)', nowIn: PREGNANT, says: ['hydrops', 'hydrops fetalis'] },

  // ---------- Other conditions (no tick box) ----------
  { to: 'other:PCOS', says: ['PCOS', 'PCOD', 'PCO', 'polycystic ovary syndrome', 'polycystic ovarian syndrome', 'polycystic ovarian disease', 'polycystic ovaries'] },
  { to: 'other:Fibroid uterus', says: ['fibroid', 'fibroids', 'fibroid uterus', 'myoma', 'myomas', 'leiomyoma', 'uterine fibroid', 'uterine fibroids'] },
  { to: 'other:Adenomyosis', says: ['adenomyosis'] },
  { to: 'other:Endometriosis', says: ['endometriosis', 'endometrioma', 'chocolate cyst'] },
  {
    to: 'other:Thalassaemia trait',
    says: ['thalassaemia trait', 'thalassemia trait', 'thalassaemia minor', 'thalassemia minor', 'beta thalassaemia trait', 'beta thalassemia trait', 'thal trait'],
  },
  { to: 'other:Thalassaemia major', says: ['thalassaemia major', 'thalassemia major'] },
  { to: 'other:Sickle cell disease', says: ['sickle cell disease', 'sickle cell anaemia', 'sickle cell anemia', 'SCD'] },
  { to: 'other:Sickle cell trait', says: ['sickle cell trait', 'sickle trait', 'sickling positive'] },
  { to: 'other:Previous DVT / pulmonary embolism', says: ['DVT', 'deep vein thrombosis', 'pulmonary embolism', 'thromboembolism', 'VTE'] },
  {
    to: 'other:Uterine anomaly',
    says: ['bicornuate uterus', 'septate uterus', 'unicornuate uterus', 'uterus didelphys', 'didelphys', 'arcuate uterus', 'mullerian anomaly', 'uterine anomaly', 'uterine septum'],
  },
  { to: 'other:Previous ectopic pregnancy', says: ['ectopic', 'ectopic pregnancy', 'tubal pregnancy', 'ruptured ectopic'] },
  { to: 'other:Previous molar pregnancy', says: ['molar pregnancy', 'hydatidiform mole', 'vesicular mole', 'H mole', 'GTD', 'GTN'] },
  {
    to: 'other:Recurrent pregnancy loss',
    says: ['recurrent pregnancy loss', 'RPL', 'recurrent miscarriage', 'recurrent miscarriages', 'recurrent abortion', 'recurrent abortions', 'habitual abortion', 'BOH', 'bad obstetric history'],
  },
  { to: 'other:Obesity', says: ['obesity', 'obese', 'morbid obesity'] },
  { to: 'other:Migraine', says: ['migraine'] },
  { to: 'other:Previous cervical surgery (cone biopsy / LEEP)', says: ['cone biopsy', 'conisation', 'conization', 'LEEP', 'LLETZ'] },
  { to: 'other:Tubal block', says: ['tubal block', 'tubal blockage', 'blocked tubes', 'bilateral tubal block', 'hydrosalpinx'] },
  { to: 'other:Low ovarian reserve', says: ['low AMH', 'AMH low', 'poor ovarian reserve', 'low ovarian reserve', 'diminished ovarian reserve', 'DOR'] },
  { to: 'other:Male factor infertility', couple: true, says: ['male factor', 'oligospermia', 'oligozoospermia', 'azoospermia', 'asthenospermia', 'asthenozoospermia'] },
  { to: 'other:Genital prolapse', says: ['prolapse', 'uterine prolapse', 'uterovaginal prolapse', 'cystocele', 'rectocele'] },
  { to: 'other:Ovarian cyst', says: ['ovarian cyst', 'dermoid cyst', 'dermoid'] },
  { to: 'other:Abnormal Pap smear / CIN', says: ['CIN', 'abnormal Pap smear', 'abnormal Pap', 'HPV positive', 'HSIL', 'LSIL'] },
  { to: 'other:Previous sterilisation', says: ['tubectomy', 'tubal ligation', 'laparoscopic tubal ligation', 'sterilisation', 'sterilization'] },
  { to: 'other:Previous hysterectomy', says: ['hysterectomy', 'TAH', 'TLH', 'NDVH'] },

  // ---------- This pregnancy / delivery (written in the notes) ----------
  {
    to: 'note:Gestational diabetes (this pregnancy)',
    only: PREGNANCY,
    says: ['GDM', 'gestational diabetes', 'gestational diabetes mellitus', 'gestational diabetic', 'gestational DM', 'GDMA1', 'GDMA2', 'GDM A1', 'GDM A2', 'diabetes in pregnancy', 'sugar in pregnancy'],
  },
  {
    to: 'note:Placenta praevia / low-lying placenta',
    only: PREGNANT,
    says: ['placenta praevia', 'placenta previa', 'low lying placenta', 'low placenta', 'major praevia', 'minor praevia'],
  },
  {
    to: 'note:Placenta accreta spectrum (suspected)',
    only: PREGNANT,
    says: ['placenta accreta', 'accreta', 'increta', 'percreta', 'placenta accreta spectrum', 'morbidly adherent placenta'],
  },
  {
    to: 'note:Antepartum haemorrhage / abruption',
    only: PREGNANCY,
    says: ['APH', 'antepartum haemorrhage', 'antepartum hemorrhage', 'abruption', 'abruptio placentae', 'placental abruption', 'accidental haemorrhage'],
  },
  {
    to: 'note:Oligohydramnios',
    only: PREGNANT,
    says: ['oligohydramnios', 'oligo hydramnios', 'oligo', 'oligoamnios', 'reduced liquor', 'less liquor', 'low liquor', 'decreased liquor', 'low AFI'],
  },
  { to: 'note:Polyhydramnios', only: PREGNANT, says: ['polyhydramnios', 'poly hydramnios', 'hydramnios', 'excess liquor', 'increased liquor', 'high AFI'] },
  {
    to: 'note:Twin pregnancy',
    only: PREGNANCY,
    says: ['twins', 'twin pregnancy', 'twin gestation', 'DCDA', 'MCDA', 'MCMA', 'DCDA twins', 'MCDA twins', 'dichorionic', 'monochorionic'],
  },
  { to: 'note:Triplet pregnancy', only: PREGNANCY, says: ['triplets', 'triplet pregnancy'] },
  { to: 'note:Breech presentation', only: PREGNANT, says: ['breech', 'breech presentation'] },
  { to: 'note:Transverse / oblique lie', only: PREGNANT, says: ['transverse lie', 'oblique lie', 'unstable lie'] },
  {
    to: 'note:Conceived by IVF / ICSI',
    only: PREGNANCY,
    says: ['IVF', 'ICSI', 'IVF conception', 'IVF pregnancy', 'IVF conceived', 'test tube baby', 'ART conception', 'ART pregnancy', 'donor egg', 'donor oocyte', 'oocyte donation', 'frozen embryo transfer', 'FET'],
  },
  { to: 'note:Conceived by IUI', only: PREGNANCY, says: ['IUI', 'IUI conception', 'IUI pregnancy'] },
  { to: 'note:Conceived after ovulation induction', only: PREGNANT, says: ['ovulation induction', 'OI conception', 'letrozole conception', 'clomiphene conception'] },
  { to: 'note:Precious pregnancy', only: PREGNANT, says: ['precious pregnancy', 'precious baby'] },
  {
    to: 'note:Cervical cerclage',
    only: PREGNANT,
    says: ['cerclage', 'encerclage', 'encirclage', 'McDonald stitch', 'McDonald suture', "McDonald's stitch", 'Shirodkar', 'Shirodkar stitch', 'cervical stitch'],
  },
  {
    to: 'note:Short cervix / cervical insufficiency',
    only: PREGNANT,
    says: ['short cervix', 'cervical incompetence', 'incompetent cervix', 'cervical insufficiency', 'funnelling', 'funneling'],
  },
  { to: 'note:Threatened miscarriage', only: PREGNANT, says: ['threatened abortion', 'threatened miscarriage'] },
  { to: 'note:Hyperemesis gravidarum', only: [...PREGNANT, ...LOSS], says: ['hyperemesis', 'hyperemesis gravidarum'] },
  {
    to: 'note:Intrahepatic cholestasis of pregnancy',
    only: PREGNANCY,
    says: ['ICP', 'cholestasis', 'obstetric cholestasis', 'intrahepatic cholestasis', 'cholestasis of pregnancy'],
  },
  { to: 'note:Urinary tract infection', only: [...PREGNANCY, ...LOSS], says: ['UTI', 'urinary tract infection', 'pyelonephritis'] },
  { to: 'note:Reduced fetal movements', only: PREGNANT, says: ['reduced fetal movements', 'decreased fetal movements', 'reduced FM', 'decreased FM', 'RFM', 'DFM'] },
  {
    to: 'note:Rupture of membranes (PROM / PPROM)',
    only: PREGNANT,
    says: ['PROM', 'PPROM', 'leaking PV', 'leaking per vaginum', 'rupture of membranes', 'ruptured membranes', 'draining liquor'],
  },
  { to: 'note:Plan: VBAC / trial of labour after caesarean', only: PREGNANT, says: ['VBAC', 'TOLAC', 'trial of labour', 'trial of labor'] },
  { to: 'note:Anti-D given', only: [...PREGNANCY, ...LOSS], says: ['anti-D given', 'anti D given', 'anti-D immunoglobulin'] },
  { to: 'note:ICT negative', only: [...PREGNANT, ...LOSS], says: ['ICT negative', 'indirect Coombs negative'] },
  { to: 'note:CPD (cephalopelvic disproportion)', only: ['antenatal', 'postnatal', 'gynaecology'], says: ['CPD', 'cephalopelvic disproportion'] },
  {
    to: 'note:Delivered by caesarean section',
    only: ['postnatal'],
    delivery: true,
    says: ['delivered by LSCS', 'delivered by caesarean', 'delivered by cesarean', 'delivered by C-section', 'emergency LSCS', 'elective LSCS', 'LSCS done', 'caesarean done'],
  },
  {
    to: 'note:Normal vaginal delivery',
    only: ['postnatal'],
    delivery: true,
    says: ['FTND', 'NVD', 'normal delivery', 'normal vaginal delivery', 'vaginal delivery', 'delivered normally', 'full term normal delivery'],
  },
  {
    to: 'note:Instrumental delivery',
    only: ['postnatal'],
    delivery: true,
    says: ['forceps', 'forceps delivery', 'ventouse', 'vacuum delivery', 'vacuum extraction', 'instrumental delivery'],
  },
  { to: 'note:Episiotomy', only: ['postnatal'], delivery: true, says: ['episiotomy', 'RMLE'] },
  { to: 'note:Perineal tear', only: ['postnatal'], delivery: true, says: ['perineal tear', 'third degree tear', 'fourth degree tear', 'OASIS'] },
];

// Short forms the app knows but has no field for (tests, scans, visits, units…): not asked about.
export const KNOWN_SHORT_FORMS = [
  'LMP', 'EDD', 'CEDD', 'POG', 'GA', 'USG', 'NT', 'NTS', 'TIFFA', 'NIPT', 'CRL', 'BPD', 'HC', 'AC', 'FL', 'EFW', 'AFI', 'SDP', 'NST', 'CTG', 'FHR', 'FHS', 'BP',
  'HB', 'TSH', 'CBC', 'RBS', 'FBS', 'PPBS', 'OGTT', 'GTT', 'DIPSI', 'HBA1C', 'ICT', 'DCT', 'ABO', 'RH', 'HCV', 'ANC', 'PNC', 'OPD', 'IPD', 'MRN', 'UHID', 'DOB',
  'TOB', 'BW', 'NICU', 'SNCU', 'APGAR', 'BCG', 'OPV', 'TT', 'TD', 'TDAP', 'IFA', 'LSCS', 'NVD', 'FTND', 'VBAC', 'CS', 'MR', 'MRS', 'MS', 'DR', 'SMT', 'KUM', 'AM',
  'PM', 'OK', 'NA', 'NIL', 'ID', 'KG', 'KGS', 'CM', 'CMS', 'MG', 'ML', 'IU', 'IV', 'IM', 'SC', 'PO', 'OD', 'BD', 'TDS', 'HS', 'SOS', 'STAT', 'PV', 'PA', 'PS',
  'OE', 'GPE', 'CVS', 'RS', 'CNS', 'MTP', 'MVA', 'D&C', 'DNC', 'MMR', 'IUCD', 'CUT', 'OCP', 'OCPS', 'ECP', 'PAP', 'VIA', 'VILI', 'CA', 'CT', 'MRI', 'ECG', 'ECHO',
  'LFT', 'RFT', 'KFT', 'ESR', 'CRP', 'HIV', 'VDRL', 'HBSAG', 'IUGR', 'FGR', 'PIH', 'GDM', 'PE', 'RA', 'SB', 'IUD', 'ART', 'MNT', 'HSG', 'SSG',
  'TVS', 'TAS', 'FSH', 'LH', 'AMH', 'PRL', 'SA', 'TFT', 'ANA', 'APTT', 'PT', 'INR', 'HPV', 'GBS', 'HDU', 'ICU', 'BMI', 'ET', 'OPU', 'HCG', 'BHCG',
  'UPT', 'BPP', 'DFMC', 'XT', 'SR', 'CR', 'ER', 'XR', 'XL', 'DS', 'LA', 'MF', 'TV', 'FH', 'BMV', 'PTMC', 'MCH', 'MCV', 'RBC', 'WBC', 'PLT', 'TLC', 'DLC', 'MCG', 'IFA', 'FHR', 'NBM', 'IVF', 'ICSI', 'IUI', 'NR',
];

// Family members in Hindi and Indian English (with mother, father, husband …): their illnesses are not the patient's.
export const FAMILY_WORDS = ['mummy', 'mom', 'papa', 'dad', 'maa', 'mata', 'pita', 'saas', 'sasur', 'nani', 'dadi', 'mausi', 'bua', 'chachi', 'bhabhi', 'didi'];

// Everyday words in dictation: never "corrected" into a medical term.
export const COMMON_WORDS = new Set(
  (
    'patient pregnancy pregnant history previous delivery deliveries delivered normal present weeks months years children child blood group weight height ' +
    'phone mobile address married living abortion abortions known taking tablets tablet medicine medicines doctor hospital admitted today yesterday morning ' +
    'evening night since before after second third fourth fifth female male sister mother father husband family spontaneous conceived complains complaint ' +
    'bleeding swelling fever cough vomiting nausea headache giddiness burning urine discharge itching hours about around approximately planned advised started ' +
    'stopped regular irregular cycles periods menses report reports value level result results positive negative reactive tests check given taken operation ' +
    'surgery section uterus cervix ovary ovaries placenta babies twins other allergic allergy allergies penicillin sulpha drugs issue issues living alive ' +
    'booking registered registration visit visits review follow scans scanned dating early anomaly growth liquor presentation cephalic vertex breech ' +
    'fetal foetal movements heart sounds rate normal adequate single live intrauterine gestation gestational previous previously there their these those ' +
    'which where while would could should shall might other others three seven eight eleven twelve thirty forty fifty sixty seventy eighty ninety hundred'
  ).split(/\s+/),
);

// ---------- Words that are matched by sound (indianEnglish.js, plan 2.5) ----------
// Voice entry corrects a word heard with an Indian accent ("pibroid", "diabitis") into a word the app knows: every
// way of saying a term above, these words, and number and month words. A word from this list only fixes the spelling:
// it ticks nothing by itself ("haemoglobin", "abortion" …) – a term above still has to be said in full. Never a result
// word (positive, negative, reactive: "none reactive" is asked, never corrected) or a word about the baby's sex.
// After changing TERMS says/to, EXTRA_VOCAB, SAME_SPELLING or COMMON_WORDS, run `node client/scripts/make-word-guard.mjs`
// (a test says so).
export const EXTRA_VOCAB = [
  // Obstetric words
  'gravida', 'primigravida', 'multigravida', 'caesarean', 'cesarean', 'abortion', 'miscarriage', 'placenta', 'praevia', 'previa', 'haemoglobin',
  'hemoglobin', 'hepatitis', 'thalassaemia', 'thalassemia', 'sickle', 'tetralogy', 'menorrhagia', 'dysmenorrhoea', 'amenorrhoea', 'oedema', 'edema',
  // Medicines (generic names and Indian brands) said with a dose
  'labetalol', 'Labebet', 'nifedipine', 'Nicardia', 'methyldopa', 'Aldomet', 'metformin', 'Glycomet', 'Glyciphage', 'insulin', 'aspirin', 'Ecosprin',
  'heparin', 'enoxaparin', 'Clexane', 'progesterone', 'Susten', 'Duphaston', 'folic acid', 'calcium',
];

// British and American spellings of the same word: a sound match to either is the same word, never two different
// ones. ("ae" / "oe" and "-ise" / "-ize" spellings are matched without a list: anaemia = anemia, sterilisation =
// sterilization.)
export const SAME_SPELLING = [
  ['caesarean', 'cesarean'], ['praevia', 'previa'], ['labour', 'labor'], ['tumour', 'tumor'], ['funnelling', 'funneling'], ['foetus', 'fetus'],
];

// ---------- Words given to Chrome's speech recognition (on this computer) so it hears them better ----------
// hearingPhrases(careType, words) → [{ text, boost }], at most MAX_PHRASES, most useful first (so the cap drops the least
// useful: blood groups and results always get in; the long list from TERMS fills what is left). Boosts are kept low: a strong boost makes Chrome "hear" a word that was not said, and a wrongly heard
// finding in a medical form is dangerous.
// - Opposite results get the same boost (reactive / non-reactive, positive / negative, Rh positive / negative,
//   all 8 blood groups), so Chrome is never pushed towards one of them.
// - Never sent: 2-letter short forms (TB, BP, HB, DM: they cause false insertions such as "has TB checked" – the app
//   reads them from the letters instead), letters with spaces ("L S C S"), and in a pregnancy (antenatal or abortion
//   care) any word about the baby's sex (PCPNDT).
const ALL = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'abortion'];
const MOTHER = ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'abortion'];
// 200, plus room for the Hindi words below, so they never push out a medical word (Chrome sets no limit; 100–300 is
// the usual advice).
const MAX_PHRASES = 212;
const MAX_OWN_WORDS = 50;
// Learned-word keys that are settings, not words ("edd" → scan EDD or dates), and words that must never be learned
// (they change a result or a "no"), or any digit.
const PREFERENCE_KEYS = new Set(['edd', 'b rh', 'height n.n']);
const BLOCKED_LEARNED_WORDS = new Set(['no', 'not', 'non', 'none', 'nil', 'known', 'on', 'positive', 'negative', 'reactive', 'sorry']);
// Split on anything that is not a letter, so "no." or "non/reactive" is caught too
export const isBlockedLearned = (phrase) => /\d/.test(phrase) || phrase.toLowerCase().split(/[^a-z]+/).some((w) => BLOCKED_LEARNED_WORDS.has(w));
// Learned words that sound like a result or a "no" are still used, but not boosted: a boosted "nonreactive",
// "hiv neg" or "o+ve" would push Chrome towards one side of a result.
const RESULT_STEM = /react|reakt|posit|poset|pozit|negat|neget|nagat|naget|nahi|nonr/;
const RESULT_WORD = /(?:^|[\s-])(?:pos|neg|nr|nai|nil|none|absent)(?=$|[\s-])|\+|-\s*ve\b/;
const joinedKey = (text) => text.toLowerCase().replace(/[\s-]+/g, '');
const HINDI_SEX_WORDS = /\b(?:beta|beti|bete)\b/i; // (boy, girl, ladka, ladki… are in pcpndtWords.js)

// [phrase, types of care]
const COMMON_HEARING = [
  ['primigravida', MOTHER], ['gravida', MOTHER], ['LMP', MOTHER], ['EDD', PREGNANT], ['POG', PREGNANT], ['USG', MOTHER], ['caesarean', MOTHER],
  ['LSCS', MOTHER], ['blood group', ALL], ['GDM', PREGNANCY], ['PCOD', MOTHER], ['PPH', MOTHER], ['twins', PREGNANCY], ['breech', PREGNANT],
  ['asthma', MOTHER], ['anaemia', MOTHER], ['fibroid', MOTHER], ['epilepsy', MOTHER], ['hypothyroid', MOTHER], ['Thyronorm', MOTHER],
  ['Eltroxin', MOTHER], ['Nicardia', MOTHER], ['Labebet', MOTHER], ['Glycomet', MOTHER],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NUMBER_HEARING = [
  ['double', ALL], ['triple', ALL], ...MONTHS.map((m) => [m, ALL]), ['kilo', ALL], ['baby of', ['newborn']], ['time of birth', ['newborn']],
  ['birth weight', ['newborn']], ['grams', ['newborn']],
];
// Hindi words said in dictation that Chrome's English speech recognition often leaves out: a low boost, so they are
// heard when said without pushing Chrome towards them. Never a word about the baby's sex.
const HINGLISH_HEARING = ['naam', 'saal', 'pehli', 'doosri', 'teesri', 'bees', 'pachees', 'tees', 'mahine', 'hafte', 'bacche', 'haan'];
const BLOOD_GROUP_HEARING = ['A', 'B', 'AB', 'O'].flatMap((g) => [`${g} positive`, `${g} negative`]);
// Results and findings that matter most if wrongly added: low, equal boosts
const RESULT_HEARING = [
  ['positive', ALL], ['negative', ALL], ['Rh positive', ALL], ['Rh negative', ALL], ['reactive', MOTHER], ['non-reactive', MOTHER], ['eclampsia', MOTHER],
  ...TERMS.filter((t) => t.result).flatMap((t) => t.says.filter((say) => /^[A-Z][A-Za-z]{2,4}$/.test(say)).map((say) => [say, t.only ?? MOTHER])),
];
// Other useful words that are not in TERMS
const MORE_HEARING = [
  ['multigravida', MOTHER], ['NT scan', PREGNANT], ['anomaly scan', PREGNANT], ['dating scan', PREGNANT], ['previous LSCS', MOTHER],
  ['C-section', MOTHER], ['TSH', MOTHER], ['OGTT', PREGNANCY], ['DIPSI', PREGNANCY], ['ICT', PREGNANCY], ['haemoglobin', MOTHER], ['allergic to', MOTHER],
  ['NKDA', MOTHER], ['known case of', MOTHER], ['history of', MOTHER], ['labetalol', MOTHER], ['nifedipine', MOTHER], ['methyldopa', MOTHER],
  ['Aldomet', MOTHER], ['metformin', MOTHER], ['insulin', MOTHER], ['enoxaparin', MOTHER], ['Clexane', MOTHER], ['aspirin', MOTHER], ['Ecosprin', MOTHER],
  ['gestational hypertension', PREGNANCY], ['pre-eclampsia', MOTHER], ['placenta praevia', PREGNANT], ['oligohydramnios', PREGNANT],
  ['tuberculosis', MOTHER],
];

const termFor = (careType) => (t) => (t.only ?? MOTHER).includes(careType);
const key = (text) => text.toLowerCase().replace(/[\s-]+/g, ' ').trim();
const neverSent = (text, careType) =>
  text.replace(/[\s.-]/g, '').length <= 2 || /^(?:[a-z]\.?\s+)+[a-z]\.?$/i.test(text.trim()) || ((careType === 'antenatal' || careType === 'abortion') && (HINDI_SEX_WORDS.test(text) || mentionsFetalSex(text)));

export function hearingPhrases(careType, words = []) {
  const forCare = (list) => list.filter(([, types]) => types.includes(careType)).map(([text]) => text);
  const results = forCare(RESULT_HEARING);
  const resultKeys = new Set([...BLOOD_GROUP_HEARING, ...results].map(joinedKey)); // also "hbs ag", "rhnegative"
  const own = (words ?? [])
    .filter((w) => w?.phrase && w.meaning !== 'ignore' && !PREFERENCE_KEYS.has(w.phrase.toLowerCase()) && !isBlockedLearned(w.phrase))
    .map((w) => w.phrase)
    .filter((p) => !RESULT_STEM.test(joinedKey(p)) && !RESULT_WORD.test(p.toLowerCase()) && !resultKeys.has(joinedKey(p)))
    .slice(0, MAX_OWN_WORDS);
  const fill = TERMS.filter(termFor(careType)).filter((t) => !t.result);
  // In order of use (the cap drops from the end). Blood groups and results come straight after the doctor's own words,
  // so "all of a pair or none" never leaves them out.
  const groups = [
    { boost: 2.5, texts: own },
    { boost: 1.2, texts: BLOOD_GROUP_HEARING, whole: true },
    { boost: 1.2, texts: results, whole: true },
    { boost: 2, texts: forCare(COMMON_HEARING) },
    { boost: 1.5, texts: forCare(MORE_HEARING) }, // (not 2: "previous LSCS" is a finding)
    { boost: 1.5, texts: ['para', 'living'].filter(() => careType !== 'newborn') },
    { boost: 1.5, texts: forCare(NUMBER_HEARING) },
    { boost: 1, texts: HINGLISH_HEARING },
    { boost: 1.5, texts: [...(careType === 'newborn' ? [] : ['PIH']), ...fill.flatMap((t) => t.says.filter((say) => /^[A-Z][A-Z0-9]{2,3}$/.test(say)))] },
    // Everything else from TERMS: each term's main word first, then the other ways of saying it
    { boost: 1.5, texts: [...fill.map((t) => t.says[0]), ...fill.flatMap((t) => t.says)] },
  ];
  // Blood groups and results keep their own (low, equal) boost even when also in another group.
  const reserved = new Set(groups.filter((g) => g.whole).flatMap((g) => g.texts.map(key)));
  const seen = new Set();
  const phrases = [];
  for (const { boost, texts, whole } of groups) {
    const add = texts.filter((text) => !neverSent(text, careType) && (whole || !reserved.has(key(text))) && !seen.has(key(text)));
    const unique = add.filter((text, i) => add.findIndex((x) => key(x) === key(text)) === i);
    if (whole && phrases.length + unique.length > MAX_PHRASES) continue; // all of a pair or none
    for (const text of unique) {
      if (phrases.length >= MAX_PHRASES) break;
      seen.add(key(text));
      phrases.push({ text, boost });
    }
  }
  return phrases;
}
