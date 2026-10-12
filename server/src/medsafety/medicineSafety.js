// Medicine safety (Smart features, step 2; extended 4 Oct 2026): the hospital's list of
//  - medicines to avoid or use with caution during pregnancy (by weeks), and combinations to space out or watch;
//  - medicines to avoid or use with caution while breastfeeding (postnatal patients);
//  - medicines to avoid or use with caution in a newborn baby (by age in days where that matters);
//  - the usual maximum dose of common medicines (one dose, and a whole day; for babies per kg of body weight, by age
//    in days where the first week of life has a lower dose).
// The prescription page warns the doctor while writing; it never blocks saving – the doctor decides.
//
// The built-in list below is a DRAFT prepared from published references (BNF and BNF for Children, FDA / TGA
// pregnancy categories, LactMed, WHO, FOGSI and MoHFW guidance, manufacturers' labels). It is not a clinical review
// and not complete: a doctor checks, edits and approves it in the app (Clinic library → Clinical rules → Medicine
// safety).

export const MED_SAFETY_LEVELS = ['avoid', 'caution'];
// medicine / combination: in pregnancy. breastfeeding, newborn: who the entry applies to. dose: a usual maximum dose.
export const MED_SAFETY_KINDS = ['medicine', 'combination', 'breastfeeding', 'newborn', 'dose'];
/** The units a dose limit can be written in (the prescription's strength and dose are converted to it). */
export const DOSE_UNITS = ['mg', 'mcg', 'g', 'IU'];
/** At most this many entries in a hospital's list. */
export const MAX_MED_SAFETY_ENTRIES = 300;
// Bump when the built-in list changes: hospitals whose list no doctor has edited or approved get the new one. A list
// a doctor approved or changed is never changed by itself: the doctor is offered the new entries (BUILT_IN_SINCE).
export const BUILT_IN_MED_SAFETY_VERSION = 3;

const BNF = 'BNF (pregnancy); FDA / TGA pregnancy categories';
// Every entry has every field, so a list saved back unchanged stays the same.
const BASE = { otherTerms: [], level: 'caution', fromWeek: null, toWeek: null, maxAgeDays: null, doseUnit: '', maxSingle: null, maxDaily: null, perKg: false };
const med = (key, label, terms, level, message, source = BNF, fromWeek = null, toWeek = null) => ({ ...BASE, key, kind: 'medicine', label, terms, level, fromWeek, toWeek, message, source });
const combo = (key, label, terms, otherTerms, message, source = BNF) => ({ ...BASE, key, kind: 'combination', label, terms, otherTerms, message, source });

// terms: names that identify the medicine in what the doctor typed (generic names and common Indian brand
// names, lower case; a term matches at the start of a word, e.g. "losartan" matches "Tab. Losartan 50 mg").
const PREGNANCY = [
  med('warfarin', 'Warfarin', ['warfarin', 'acitrom', 'acenocoumarol', 'nicoumalone'], 'avoid',
    'Coumarin anticoagulants cause embryopathy (especially 6–12 weeks) and fetal bleeding. Switch to low-molecular-weight heparin under specialist advice.'),
  med('ace_inhibitors', 'ACE inhibitors', ['enalapril', 'ramipril', 'lisinopril', 'captopril', 'perindopril', 'cardace', 'envas'], 'avoid',
    'Fetal kidney damage and too little amniotic fluid, especially after the first trimester. Stop and change to labetalol, nifedipine or methyldopa.', 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); BNF'),
  med('arbs', 'Angiotensin receptor blockers', ['losartan', 'telmisartan', 'olmesartan', 'valsartan', 'irbesartan', 'candesartan', 'telma', 'losar'], 'avoid',
    'Same fetal risks as ACE inhibitors. Stop and change to labetalol, nifedipine or methyldopa.', 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); BNF'),
  med('statins', 'Statins', ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin', 'atorva', 'rosuvas'], 'avoid',
    'Not recommended in pregnancy; stop until after breastfeeding unless a specialist advises otherwise.'),
  med('isotretinoin', 'Retinoids (isotretinoin, acitretin)', ['isotretinoin', 'acitretin', 'tretinoin', 'isotroin'], 'avoid',
    'Highly teratogenic. Must not be used in pregnancy.'),
  med('methotrexate', 'Methotrexate', ['methotrexate', 'folitrax'], 'avoid', 'Teratogenic and abortifacient. Must not be used in an ongoing pregnancy.'),
  med('mycophenolate', 'Mycophenolate / leflunomide', ['mycophenolate', 'leflunomide', 'cellcept'], 'avoid', 'Teratogenic. Specialist advice needed.'),
  med('valproate', 'Valproate', ['valproate', 'valproic', 'divalproex', 'valparin', 'encorate', 'epilex'], 'avoid',
    'Major malformations and developmental problems. Only if no alternative, under a neurologist, with high-dose folic acid.', 'MHRA / EMA valproate safety measures; BNF'),
  med('antiepileptics', 'Phenytoin / carbamazepine / phenobarbitone', ['phenytoin', 'carbamazepine', 'phenobarbitone', 'phenobarbital', 'eptoin', 'tegretol'], 'caution',
    'Risk of malformations. Do not stop suddenly; neurologist review and folic acid 5 mg.'),
  med('lithium', 'Lithium', ['lithium', 'licab'], 'caution', 'Cardiac malformation risk and neonatal toxicity. Psychiatrist review; monitor levels.'),
  med('tetracyclines', 'Tetracyclines', ['doxycycline', 'tetracycline', 'minocycline', 'doxy'], 'avoid',
    'Stain teeth and affect bone growth, especially after 15 weeks. Choose another antibiotic.'),
  med('quinolones', 'Fluoroquinolones', ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin', 'ciplox', 'oflox', 'norflox', 'levoflox'], 'caution',
    'Usually avoided in pregnancy; use only if no safer alternative (e.g. cephalexin, nitrofurantoin before term).'),
  med('aminoglycosides', 'Aminoglycosides', ['gentamicin', 'amikacin', 'streptomycin', 'tobramycin', 'kanamycin'], 'caution',
    'Risk of fetal hearing damage (streptomycin especially). Use only when clearly needed, with level monitoring.'),
  med('cotrimoxazole', 'Co-trimoxazole', ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'septran', 'bactrim'], 'caution',
    'Folate antagonist in the first trimester; risk of neonatal jaundice near term. Use only if needed, with folic acid.'),
  med('nitrofurantoin_term', 'Nitrofurantoin near term', ['nitrofurantoin', 'niftran', 'furadantin'], 'caution',
    'Avoid at term (from 36 weeks): risk of neonatal haemolysis.', BNF, 36, null),
  med('chloramphenicol', 'Chloramphenicol', ['chloramphenicol'], 'caution', 'Avoid near term: "grey baby" syndrome. (Eye drops are acceptable.)', BNF, 28, null),
  med('nsaids_late', 'NSAIDs from 20 weeks', ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aceclofenac', 'ketorolac', 'nimesulide', 'indomethacin', 'piroxicam', 'etoricoxib', 'celecoxib', 'brufen', 'combiflam', 'meftal', 'voveran', 'zerodol'], 'avoid',
    'From 20 weeks NSAIDs can reduce amniotic fluid and close the ductus arteriosus. Use paracetamol. (Low-dose aspirin for pre-eclampsia prevention is different and is not included here.)', 'US FDA NSAID pregnancy warning (2020); BNF', 20, null),
  med('nsaids_early', 'NSAIDs before 20 weeks', ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aceclofenac', 'ketorolac', 'nimesulide', 'indomethacin', 'piroxicam', 'etoricoxib', 'celecoxib', 'brufen', 'combiflam', 'meftal', 'voveran', 'zerodol'], 'caution',
    'Paracetamol is preferred. If an NSAID is needed, use the lowest dose for the shortest time.', 'US FDA NSAID pregnancy warning (2020); BNF', null, 19),
  med('antithyroid_t1', 'Carbimazole / methimazole in the first trimester', ['carbimazole', 'methimazole', 'thiamazole', 'neo-mercazole', 'thyrocab'], 'caution',
    'Linked with malformations in early pregnancy: propylthiouracil (PTU) is preferred up to 16 weeks, then switch back.', 'American Thyroid Association pregnancy guideline (2017); BNF', null, 15),
  med('misoprostol', 'Misoprostol / mifepristone', ['misoprostol', 'mifepristone', 'cytolog', 'misoprost', 'mifeprin'], 'avoid',
    'Causes uterine contractions. Only under protocol – management of miscarriage, induction of labour or bleeding after delivery.'),
  med('ergometrine', 'Ergometrine / methylergometrine before delivery', ['ergometrine', 'methylergometrine', 'methergine', 'methylergonovine'], 'avoid',
    'Causes sustained uterine contraction: only after the delivery of the baby (third stage / PPH).'),
  med('amiodarone', 'Amiodarone', ['amiodarone', 'cordarone'], 'avoid', 'Fetal thyroid problems and growth restriction. Cardiologist advice needed.'),
  med('atenolol', 'Atenolol', ['atenolol', 'aten', 'tenormin'], 'caution', 'Linked with fetal growth restriction. Labetalol or nifedipine are usually preferred.', 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); NICE NG133'),
  med('benzodiazepines', 'Benzodiazepines', ['alprazolam', 'diazepam', 'clonazepam', 'lorazepam', 'nitrazepam', 'chlordiazepoxide'], 'caution',
    'Near term: floppy baby and withdrawal. Use the lowest dose for the shortest time.'),
  med('opioids', 'Codeine / tramadol', ['codeine', 'tramadol', 'ultracet', 'tramazac'], 'caution', 'Regular use near term causes neonatal withdrawal and breathing problems.'),
  med('ovulation', 'Clomiphene / letrozole', ['clomiphene', 'clomifene', 'letrozole', 'fertomid', 'letroz'], 'avoid', 'Not for use once pregnant: stop the fertility treatment.'),
  med('androgens', 'Danazol / testosterone', ['danazol', 'testosterone'], 'avoid', 'Virilisation of a female fetus.'),
  med('finasteride', 'Finasteride / dutasteride', ['finasteride', 'dutasteride'], 'avoid', 'Affects male fetal development.'),
  med('thalidomide', 'Thalidomide', ['thalidomide'], 'avoid', 'Severe limb and organ malformations. Must not be used in pregnancy.'),
  med('live_vaccines', 'Live vaccines (MMR, varicella, yellow fever)', ['mmr', 'measles', 'rubella', 'varicella', 'chickenpox', 'yellow fever'], 'avoid',
    'Live vaccines are not given in pregnancy. Tetanus-diphtheria (Td), influenza and Tdap are safe.', 'WHO / MoHFW India immunization guidance'),
  med('vitamin_a', 'High-dose vitamin A', ['vitamin a', 'retinol'], 'caution', 'Doses above 10,000 IU a day are teratogenic. Check the dose.'),
  combo('iron_calcium', 'Iron and calcium together', ['iron', 'ferrous', 'ferric', 'livogen', 'autrin', 'orofer', 'fefol', 'dexorange'], ['calcium', 'shelcal', 'calcimax', 'cipcal', 'gemcal'],
    'Calcium reduces iron absorption. Advise taking them at least 2 hours apart (e.g. iron in the morning, calcium at night).', 'MoHFW India Anemia Mukt Bharat / IFA and calcium supplementation guidelines (2018)'),
  combo('thyroxine_iron', 'Thyroxine with iron or calcium', ['thyroxine', 'levothyroxine', 'thyronorm', 'eltroxin', 'thyrox'], ['iron', 'ferrous', 'ferric', 'calcium', 'shelcal', 'calcimax', 'fefol'],
    'Iron and calcium reduce thyroxine absorption. Thyroxine on an empty stomach, at least 4 hours apart from iron and calcium.', 'American Thyroid Association pregnancy guideline (2017); BNF'),
  combo('nifedipine_mgso4', 'Nifedipine with magnesium sulphate', ['nifedipine', 'depin', 'calcigard'], ['magnesium sulphate', 'magnesium sulfate', 'mgso4'],
    'Watch for low blood pressure and muscle weakness; monitor BP, reflexes and breathing.', 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); BNF'),
  combo('aspirin_nsaid', 'Low-dose aspirin with an NSAID', ['aspirin', 'ecosprin', 'loprin'], ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aceclofenac', 'ketorolac', 'brufen', 'combiflam', 'meftal', 'voveran'],
    'Higher bleeding risk, and ibuprofen can reduce aspirin\'s effect. Prefer paracetamol for pain.'),
];

// ---------- While breastfeeding (postnatal patients) ----------

const LACT = 'LactMed (US National Library of Medicine); BNF (breast-feeding)';
const bf = (key, label, terms, level, message, source = LACT) => ({ ...BASE, key, kind: 'breastfeeding', label, terms, level, message, source });

const BREASTFEEDING = [
  bf('bf_codeine', 'Codeine', ['codeine'], 'avoid',
    'Some mothers turn codeine into morphine very quickly: the baby can become drowsy and stop breathing. Use paracetamol or ibuprofen.', 'MHRA / EMA codeine safety advice (2013); BNF; LactMed'),
  bf('bf_tramadol', 'Tramadol', ['tramadol', 'ultracet', 'tramazac', 'contramal'], 'caution',
    'Lowest dose for the shortest time. Watch the baby for drowsiness, poor feeding and slow breathing. (The US FDA advises against it while breastfeeding.)', 'US FDA drug safety communication (2017); LactMed; BNF'),
  bf('bf_lactation_suppressants', 'Bromocriptine / cabergoline', ['bromocriptine', 'cabergoline', 'cabgolin', 'caberlin'], 'avoid',
    'Stops milk production. Only when stopping lactation is intended.'),
  bf('bf_ergometrine', 'Ergometrine / methylergometrine (repeated doses)', ['ergometrine', 'methylergometrine', 'methergine', 'methylergonovine'], 'caution',
    'A single dose after delivery is acceptable. Repeated doses can reduce the milk supply and may affect the baby.'),
  bf('bf_combined_pill', 'Combined contraceptive pill (with oestrogen)', ['ethinylestradiol', 'ethinyl estradiol', 'ethinyloestradiol', 'mala-d', 'mala d', 'ovral', 'novelon', 'femilon', 'loette', 'yasmin'], 'avoid',
    'Oestrogen reduces the milk supply: not in the first 6 weeks after delivery, and preferably not until 6 months while she is mainly breastfeeding. Progestogen-only methods, a copper IUCD or condoms are preferred.',
    'WHO Medical eligibility criteria for contraceptive use (5th edition, 2015); BNF'),
  bf('bf_amiodarone', 'Amiodarone', ['amiodarone', 'cordarone'], 'avoid', 'Passes into milk in large amounts; the iodine can cause hypothyroidism in the baby.'),
  bf('bf_lithium', 'Lithium', ['lithium', 'licab'], 'avoid', 'Passes into milk; risk of toxicity in the baby. Only with psychiatrist advice and monitoring of the baby.'),
  bf('bf_cytotoxics', 'Methotrexate / cyclophosphamide', ['methotrexate', 'folitrax', 'cyclophosphamide', 'endoxan'], 'avoid', 'Cytotoxic: breastfeeding should stop during treatment. Specialist advice needed.'),
  bf('bf_retinoids', 'Retinoids (isotretinoin, acitretin)', ['isotretinoin', 'acitretin', 'isotroin'], 'avoid', 'Not to be used while breastfeeding.'),
  bf('bf_statins', 'Statins', ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin', 'atorva', 'rosuvas'], 'avoid', 'Manufacturers advise against use while breastfeeding; treatment can usually wait.', 'BNF (breast-feeding); manufacturer’s label'),
  bf('bf_tetracyclines', 'Tetracyclines', ['doxycycline', 'tetracycline', 'minocycline', 'doxy'], 'caution',
    'A short course (up to 3 weeks) is acceptable. Avoid long or repeated courses: possible staining of the baby’s teeth.'),
  bf('bf_quinolones', 'Fluoroquinolones', ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin', 'ciplox', 'oflox', 'norflox', 'levoflox'], 'caution',
    'Use only if there is no safer alternative. Watch the baby for diarrhoea and thrush.'),
  bf('bf_chloramphenicol', 'Chloramphenicol', ['chloramphenicol'], 'caution', 'Avoid by mouth or injection: possible bone-marrow effects in the baby. (Eye drops are acceptable.)'),
  bf('bf_metronidazole', 'Metronidazole / tinidazole', ['metronidazole', 'flagyl', 'metrogyl', 'tinidazole'], 'caution',
    'Ordinary doses are acceptable (the milk may taste bitter). After a single 2 g dose, express and discard the milk for 12 to 24 hours (tinidazole: 3 days).'),
  bf('bf_nitrofurantoin', 'Nitrofurantoin', ['nitrofurantoin', 'niftran', 'furadantin'], 'caution',
    'Avoid if the baby is under 1 month old, jaundiced or has G6PD deficiency: risk of haemolysis.'),
  bf('bf_cotrimoxazole', 'Co-trimoxazole / sulfonamides', ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'septran', 'bactrim'], 'caution',
    'Avoid if the baby is under 1 month old, preterm, jaundiced or has G6PD deficiency: risk of kernicterus and haemolysis.'),
  bf('bf_aspirin', 'Aspirin', ['aspirin', 'ecosprin', 'loprin', 'disprin'], 'caution',
    'Low-dose aspirin (75–150 mg a day) is acceptable. Avoid pain-relief doses: possible risk of Reye’s syndrome in the baby. Use paracetamol or ibuprofen.'),
  bf('bf_benzodiazepines', 'Benzodiazepines', ['alprazolam', 'diazepam', 'clonazepam', 'lorazepam', 'nitrazepam', 'chlordiazepoxide'], 'caution',
    'Can make the baby drowsy and feed poorly, especially with repeated doses. Lowest dose for the shortest time.'),
  bf('bf_phenobarbitone', 'Phenobarbitone / primidone', ['phenobarbitone', 'phenobarbital', 'primidone', 'gardenal'], 'caution', 'Can make the baby drowsy. Do not stop suddenly; neurologist review.'),
  bf('bf_atenolol', 'Atenolol', ['atenolol', 'aten', 'tenormin'], 'caution', 'Builds up in milk: slow heart rate and low blood sugar in the baby have been reported, more so in a preterm baby or one under 3 months. Labetalol, nifedipine or enalapril are preferred.', 'LactMed; BNF (breast-feeding)'),
  bf('bf_antithyroid', 'Carbimazole / methimazole', ['carbimazole', 'methimazole', 'thiamazole', 'neo-mercazole', 'thyrocab'], 'caution',
    'Passes into milk: use the lowest effective dose and check the baby’s thyroid function.', 'BNF (breast-feeding); American Thyroid Association pregnancy and postpartum guideline (2017)'),
  bf('bf_pseudoephedrine', 'Pseudoephedrine (decongestants)', ['pseudoephedrine'], 'caution', 'Can reduce the milk supply, even after a single dose.'),
  bf('bf_povidone_iodine', 'Povidone-iodine (repeated use)', ['povidone', 'betadine'], 'caution', 'Iodine is absorbed and concentrated in milk: repeated use (for example vaginal pessaries) can affect the baby’s thyroid.'),
];

// ---------- Newborn-care patients (the baby is the patient) ----------

const BNFC = 'BNF for Children; manufacturer’s label';
const nb = (key, label, terms, level, message, maxAgeDays = null, source = BNFC) => ({ ...BASE, key, kind: 'newborn', label, terms, level, maxAgeDays, message, source });

const NEWBORN = [
  nb('nb_ceftriaxone', 'Ceftriaxone in the first 28 days', ['ceftriaxone', 'monocef', 'rocephin'], 'caution',
    'Do not use in a jaundiced, preterm or acidotic baby (it displaces bilirubin), and never with calcium-containing infusions. Cefotaxime is preferred.', 28,
    'BNF for Children; WHO Pocket book of hospital care for children (2013)'),
  nb('nb_sulfonamides', 'Co-trimoxazole / sulfonamides under 6 weeks', ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'septran', 'bactrim', 'sulfadiazine'], 'avoid',
    'Risk of kernicterus, more so in a jaundiced baby. Not under 6 weeks of age (except for pneumocystis, under specialist advice).', 42),
  nb('nb_chloramphenicol', 'Chloramphenicol in the first 28 days', ['chloramphenicol'], 'caution',
    'By mouth or injection: “grey baby” syndrome. Only if there is no alternative, with blood-level monitoring. (Eye drops and ointment are acceptable.)', 28),
  nb('nb_nitrofurantoin', 'Nitrofurantoin under 3 months', ['nitrofurantoin', 'niftran', 'furadantin'], 'avoid', 'Risk of haemolysis. Not under 3 months of age.', 90),
  nb('nb_menadione', 'Vitamin K3 (menadione)', ['menadione', 'menaphthone', 'vitamin k3'], 'avoid',
    'Causes haemolysis and jaundice in newborns. Use vitamin K1 (phytomenadione).', null, 'WHO Pocket book of hospital care for children (2013); BNF for Children'),
  nb('nb_aspirin', 'Aspirin', ['aspirin', 'ecosprin', 'disprin'], 'avoid', 'Risk of Reye’s syndrome in children under 16. Only under specialist advice (for example Kawasaki disease).'),
  nb('nb_opioids', 'Codeine / tramadol', ['codeine', 'tramadol', 'ultracet', 'tramazac'], 'avoid',
    'Not for children under 12: risk of slow or stopped breathing.', null, 'MHRA / EMA codeine safety advice (2013); US FDA drug safety communication (2017)'),
  nb('nb_tetracyclines', 'Tetracyclines', ['doxycycline', 'tetracycline', 'minocycline', 'doxy'], 'avoid', 'Stain the teeth and affect bone growth. Not for young children.'),
  nb('nb_quinolones', 'Fluoroquinolones', ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin', 'ciplox', 'oflox', 'norflox'], 'caution',
    'Usually avoided in children (joint and tendon effects). Only if there is no safer alternative.'),
  nb('nb_ibuprofen', 'Ibuprofen under 3 months', ['ibuprofen', 'brufen', 'ibugesic'], 'caution', 'Not recommended under 3 months of age or under 5 kg. Paracetamol is preferred.', 90),
  nb('nb_mefenamic', 'Mefenamic acid under 6 months', ['mefenamic', 'meftal', 'ponstan'], 'caution', 'Not recommended under 6 months of age. Paracetamol is preferred.', 180, 'Manufacturer’s label; BNF for Children'),
  nb('nb_promethazine', 'Promethazine', ['promethazine', 'phenergan', 'avomine'], 'avoid', 'Not for children under 2 years: risk of slow or stopped breathing.', null, 'US FDA boxed warning (children under 2 years); BNF for Children'),
  nb('nb_cough_cold', 'Cough and cold medicines', ['dextromethorphan', 'phenylephrine', 'chlorpheniramine', 'chlorphenamine', 'pseudoephedrine', 'guaifenesin'], 'avoid',
    'Not for young children: no proven benefit and reports of serious harm.', null, 'MHRA cough and cold medicines advice (2009)'),
  nb('nb_loperamide', 'Loperamide', ['loperamide', 'imodium', 'lopamide'], 'avoid', 'Not for young children: risk of paralytic ileus. Diarrhoea is treated with ORS and zinc.', null, 'BNF for Children; WHO Pocket book of hospital care for children (2013)'),
  nb('nb_metoclopramide', 'Metoclopramide under 1 year', ['metoclopramide', 'perinorm', 'reglan'], 'avoid', 'Not under 1 year of age: risk of movement disorders.', 365, 'EMA metoclopramide review (2013); BNF for Children'),
  nb('nb_domperidone', 'Domperidone', ['domperidone', 'domstal', 'vomistop'], 'caution', 'No longer recommended for nausea and vomiting in children under 12 years or under 35 kg.', null, 'MHRA domperidone advice (2019)'),
];

// ---------- Usual maximum doses ----------

const BNF_DOSE = 'BNF (adult dose); manufacturer’s label';
// maxSingle / maxDaily in `unit` (null: not given). The message adds what the number alone cannot say.
const dose = (key, label, terms, unit, maxSingle, maxDaily, message = '', source = BNF_DOSE) => ({ ...BASE, key, kind: 'dose', label, terms, doseUnit: unit, maxSingle, maxDaily, message, source });
// For newborn-care patients: per kg of body weight, checked against the weight recorded for the baby.
// maxAgeDays: the limit is only for a baby up to that age (the lower doses of the first week of life). Where a medicine
// has several per-kg entries, the one with the lowest age that still fits the baby is the one used.
const WHO_BNFC = 'WHO Pocket book of hospital care for children (2013); BNF for Children';
const perKg = (key, label, terms, unit, maxSingle, maxDaily, message = '', maxAgeDays = null, source = WHO_BNFC) => ({ ...dose(key, label, terms, unit, maxSingle, maxDaily, message, source), perKg: true, maxAgeDays });

const DOSES = [
  dose('dose_paracetamol', 'Paracetamol', ['paracetamol', 'acetaminophen', 'crocin', 'dolo', 'calpol', 'pacimol'], 'mg', 1000, 4000, 'Less for an adult under 50 kg or with liver disease.'),
  dose('dose_ibuprofen', 'Ibuprofen', ['ibuprofen', 'brufen', 'ibugesic'], 'mg', 600, 2400, 'Usual dose 300–400 mg three or four times a day.'),
  dose('dose_diclofenac', 'Diclofenac', ['diclofenac', 'voveran', 'dynapar'], 'mg', 100, 150, 'By any route.'),
  dose('dose_mefenamic', 'Mefenamic acid', ['mefenamic', 'meftal', 'ponstan'], 'mg', 500, 1500),
  dose('dose_aceclofenac', 'Aceclofenac', ['aceclofenac', 'zerodol', 'hifenac'], 'mg', 100, 200),
  dose('dose_tramadol', 'Tramadol', ['tramadol', 'tramazac', 'contramal'], 'mg', 100, 400),
  dose('dose_codeine', 'Codeine', ['codeine'], 'mg', 60, 240),
  dose('dose_tranexamic', 'Tranexamic acid', ['tranexamic', 'pause', 'trapic'], 'mg', 1500, 4000, 'Heavy periods: 1 g three times a day for up to 4 days.'),
  dose('dose_drotaverine', 'Drotaverine', ['drotaverine', 'drotin'], 'mg', 80, 240, '', 'Manufacturer’s label'),
  dose('dose_ondansetron', 'Ondansetron', ['ondansetron', 'emeset', 'ondem', 'vomikind', 'zofer'], 'mg', 16, null,
    'The limit is for one dose into a vein: higher doses lengthen the QT interval. By mouth the usual dose is 4 to 8 mg, two or three times a day.', 'MHRA ondansetron advice (2012); BNF'),
  dose('dose_metoclopramide', 'Metoclopramide', ['metoclopramide', 'perinorm', 'reglan', 'maxeran'], 'mg', 10, 30, 'For up to 5 days.', 'EMA metoclopramide review (2013); BNF'),
  dose('dose_domperidone', 'Domperidone', ['domperidone', 'domstal', 'vomistop'], 'mg', 10, 30, 'For up to 7 days.', 'MHRA domperidone advice (2014); BNF'),
  dose('dose_labetalol', 'Labetalol (by mouth)', ['labetalol', 'lobet', 'labebet'], 'mg', null, 2400, 'In 2 to 4 divided doses.', 'BNF; FOGSI GCPR Hypertensive disorders in pregnancy (2019)'),
  dose('dose_nifedipine', 'Nifedipine', ['nifedipine', 'nicardia', 'depin', 'calcigard', 'adalat'], 'mg', null, 120,
    'Extended-release tablets (the BNF gives 90 mg a day). Short-acting capsules for severe hypertension only under protocol.', 'FOGSI GCPR Hypertensive disorders in pregnancy (2019); ACOG Practice Bulletin 222 (2020); BNF'),
  dose('dose_methyldopa', 'Methyldopa', ['methyldopa', 'alphadopa', 'aldomet'], 'mg', null, 3000, '', 'BNF; FOGSI GCPR Hypertensive disorders in pregnancy (2019)'),
  dose('dose_metformin', 'Metformin', ['metformin', 'glycomet', 'glyciphage', 'obimet'], 'mg', null, 2000, 'The manufacturer’s label allows up to 3 g a day in divided doses.'),
  dose('dose_nitrofurantoin', 'Nitrofurantoin', ['nitrofurantoin', 'niftran', 'furadantin'], 'mg', 100, 400),
  dose('dose_cefixime', 'Cefixime', ['cefixime', 'zifi', 'taxim-o'], 'mg', 400, 400),
  dose('dose_doxycycline', 'Doxycycline', ['doxycycline', 'doxy', 'microdox'], 'mg', 200, 200),
  dose('dose_ciprofloxacin', 'Ciprofloxacin (by mouth)', ['ciprofloxacin', 'ciplox', 'cifran'], 'mg', 750, 1500),
  dose('dose_clomifene', 'Clomifene', ['clomiphene', 'clomifene', 'fertomid', 'siphene', 'clomid'], 'mg', null, 100, 'For 5 days in a cycle. Higher doses only under specialist care.'),
  dose('dose_letrozole', 'Letrozole (ovulation induction)', ['letrozole', 'letroz', 'letoval'], 'mg', null, 7.5, 'For 5 days in a cycle (off-label use).', 'ACOG Practice Bulletin 194, Polycystic ovary syndrome (2018)'),
  dose('dose_iron_sucrose', 'Iron sucrose (IV)', ['iron sucrose', 'orofer s', 'sucrofer'], 'mg', 200, null, 'Not more than 3 times a week; the total dose is worked out from her weight and haemoglobin.', 'Manufacturer’s label; BNF'),
  dose('dose_fcm', 'Ferric carboxymaltose (IV)', ['ferric carboxymaltose', 'carboxymaltose', 'ferinject', 'encicarb', 'orofer fcm'], 'mg', 1000, 1000, 'Not more than 20 mg/kg in one dose, and not more than 1000 mg in a week.', 'Manufacturer’s label; BNF'),
  dose('dose_betamethasone', 'Betamethasone', ['betamethasone', 'betnesol', 'celestone'], 'mg', 12, 12, 'Antenatal steroid course: 12 mg, two doses 24 hours apart.', 'WHO recommendations on antenatal corticosteroids (2022); RCOG Green-top Guideline 74'),
  dose('dose_carboprost', 'Carboprost', ['carboprost', 'prostodin', 'hemabate'], 'mcg', 250, 2000, 'Every 15 minutes at the soonest; at most 8 doses (2 mg).', 'WHO Managing complications in pregnancy and childbirth (2017); manufacturer’s label'),
  dose('dose_methylergometrine', 'Methylergometrine', ['methylergometrine', 'methergine', 'methergin', 'methylergonovine'], 'mcg', 200, 1000,
    'At most 5 doses (1 mg) in 24 hours. Not in high blood pressure.', 'WHO Managing complications in pregnancy and childbirth (2017); manufacturer’s label'),
  // Babies: only where a dose per kg can be checked against the recorded weight.
  perKg('dosekg_paracetamol', 'Paracetamol (baby)', ['paracetamol', 'acetaminophen', 'crocin', 'calpol', 'dolo', 'pacimol'], 'mg', 20, 60,
    'By mouth: usual dose 10–15 mg/kg (a first dose of 20 mg/kg). Preterm, under 32 weeks corrected age: at most 30 mg/kg a day. By injection the doses are lower – see the BNF for Children.',
    null, 'BNF for Children; WHO Pocket book of hospital care for children (2013)'),
  perKg('dosekg_amoxicillin', 'Amoxicillin (baby, by mouth)', ['amoxicillin', 'amoxycillin', 'novamox'], 'mg', 50, 100,
    'Young infants: 50 mg/kg twice a day. The BNF for Children allows more in severe infection.', null, 'WHO guideline: possible serious bacterial infection in young infants (2015); BNF for Children'),
  // The first week of life has lower doses: an entry of its own (up to 7 days old), used instead of the general one.
  perKg('dosekg_ampicillin_week1', 'Ampicillin (baby, first week of life)', ['ampicillin'], 'mg', 50, 100,
    'First week of life: 50 mg/kg every 12 hours. In meningitis up to 100 mg/kg a dose – this caution is then expected.', 7),
  perKg('dosekg_ampicillin', 'Ampicillin (baby)', ['ampicillin'], 'mg', 50, 200, 'After the first week of life: every 8 hours, then every 6 hours. Up to 100 mg/kg a dose in meningitis.'),
  perKg('dosekg_gentamicin_week1', 'Gentamicin (baby, first week of life)', ['gentamicin', 'genticyn', 'garamycin'], 'mg', 5, 5,
    'First week of life: 5 mg/kg once a day; 3 mg/kg for a low-birth-weight baby.', 7),
  perKg('dosekg_gentamicin', 'Gentamicin (baby)', ['gentamicin', 'genticyn', 'garamycin'], 'mg', 7.5, 7.5, 'Once a day, after the first week of life.'),
  perKg('dosekg_amikacin', 'Amikacin (baby)', ['amikacin', 'mikacin'], 'mg', 15, 15, 'Once a day.'),
  perKg('dosekg_cefotaxime_week1', 'Cefotaxime (baby, first week of life)', ['cefotaxime', 'omnatax', 'claforan'], 'mg', 50, 100,
    'First week of life: every 12 hours (BNF for Children). The WHO Pocket book gives 50 mg/kg every 8 hours for a term baby – this caution is then expected.', 7),
  perKg('dosekg_cefotaxime', 'Cefotaxime (baby)', ['cefotaxime', 'omnatax', 'claforan'], 'mg', 50, 200, 'After the first week of life: every 6 to 8 hours.'),
  // The limit is the loading dose. A further loading dose (up to 40 mg/kg in all) is meant to raise the caution.
  perKg('dosekg_phenobarbitone', 'Phenobarbitone (baby)', ['phenobarbitone', 'phenobarbital', 'gardenal'], 'mg', 20, 20,
    'Loading dose 20 mg/kg; further doses of 10 mg/kg, up to 40 mg/kg in all, raise this caution. Maintenance is about 5 mg/kg a day – the check cannot tell a maintenance dose from a loading dose.'),
];

export const BUILT_IN_MED_SAFETY = [...PREGNANCY, ...BREASTFEEDING, ...NEWBORN, ...DOSES];

// The built-in version each entry first appeared in (entries not listed: version 1). A hospital whose list a doctor
// approved or changed is offered the entries added after the version its list was made from.
export const BUILT_IN_SINCE = Object.fromEntries([...BREASTFEEDING, ...NEWBORN, ...DOSES].map((e) => [e.key, 3]));
/** The version before breastfeeding, newborn and dose entries existed: a list with no record of its own is this old. */
export const BUILT_IN_BEFORE_NEW_KINDS = 2;
