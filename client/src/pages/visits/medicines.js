// Common medicines in Indian obstetrics & gynaecology practice, by generic name, with their usual forms and
// strengths – only to make typing quicker. It is NOT a formulary: it holds no doses, and whether a medicine
// suits a patient (and in pregnancy) is the doctor's decision. The doctor's own recent medicines (with the way
// they last wrote them) are offered before these. Brand names can always be typed.

const M = (name, form, strengths = [], group = '') => ({ name, form, strengths, group });

export const MEDICINES = [
  // Pregnancy supplements
  M('Folic acid', 'tab', ['400 mcg', '5 mg'], 'Supplements'),
  M('Iron + folic acid (IFA)', 'tab', ['60 mg + 500 mcg', '100 mg + 500 mcg'], 'Supplements'),
  M('Ferrous ascorbate + folic acid', 'tab', ['100 mg + 1.5 mg'], 'Supplements'),
  M('Ferrous fumarate + folic acid', 'tab', ['152 mg + 1.5 mg'], 'Supplements'),
  M('Calcium carbonate + vitamin D3', 'tab', ['500 mg + 250 IU', '1250 mg + 500 IU'], 'Supplements'),
  M('Vitamin D3 (cholecalciferol)', 'sachet', ['60,000 IU'], 'Supplements'),
  M('Methylcobalamin', 'tab', ['500 mcg', '1500 mcg'], 'Supplements'),
  M('Vitamin B complex', 'tab', [], 'Supplements'),
  M('Docosahexaenoic acid (DHA)', 'cap', ['200 mg'], 'Supplements'),
  M('Protein supplement', 'powder', [], 'Supplements'),
  M('Albendazole', 'tab', ['400 mg'], 'Supplements'),
  // Nausea, acidity, bowels
  M('Doxylamine + pyridoxine', 'tab', ['10 mg + 10 mg'], 'Nausea and acidity'),
  M('Ondansetron', 'tab', ['4 mg', '8 mg'], 'Nausea and acidity'),
  M('Metoclopramide', 'tab', ['10 mg'], 'Nausea and acidity'),
  M('Pantoprazole', 'tab', ['40 mg'], 'Nausea and acidity'),
  M('Antacid (aluminium + magnesium hydroxide)', 'syrup', ['10 ml'], 'Nausea and acidity'),
  M('Lactulose', 'syrup', ['10 ml', '15 ml'], 'Nausea and acidity'),
  M('Ispaghula husk', 'powder', ['3.5 g'], 'Nausea and acidity'),
  // Progesterone and pregnancy support
  M('Progesterone (micronised)', 'cap', ['100 mg', '200 mg', '400 mg'], 'Hormones'),
  M('Dydrogesterone', 'tab', ['10 mg'], 'Hormones'),
  M('Hydroxyprogesterone caproate', 'inj', ['250 mg', '500 mg'], 'Hormones'),
  M('Aspirin (low dose)', 'tab', ['75 mg', '150 mg'], 'Pregnancy'),
  M('Enoxaparin', 'inj', ['40 mg', '60 mg'], 'Pregnancy'),
  M('Betamethasone', 'inj', ['12 mg'], 'Pregnancy'),
  M('Dexamethasone', 'inj', ['6 mg'], 'Pregnancy'),
  // Blood pressure, sugar, thyroid
  M('Labetalol', 'tab', ['100 mg', '200 mg'], 'Blood pressure, sugar, thyroid'),
  M('Nifedipine (extended release)', 'tab', ['10 mg', '20 mg', '30 mg'], 'Blood pressure, sugar, thyroid'),
  M('Methyldopa', 'tab', ['250 mg', '500 mg'], 'Blood pressure, sugar, thyroid'),
  M('Metformin', 'tab', ['500 mg', '850 mg', '1 g'], 'Blood pressure, sugar, thyroid'),
  M('Insulin, human regular', 'inj', ['40 IU/ml', '100 IU/ml'], 'Blood pressure, sugar, thyroid'),
  M('Insulin, isophane (NPH)', 'inj', ['40 IU/ml', '100 IU/ml'], 'Blood pressure, sugar, thyroid'),
  M('Levothyroxine', 'tab', ['12.5 mcg', '25 mcg', '50 mcg', '75 mcg', '100 mcg'], 'Blood pressure, sugar, thyroid'),
  // Vaccines and immunoglobulin
  M('Tetanus and diphtheria (Td) vaccine', 'inj', ['0.5 ml'], 'Vaccines'),
  M('Tdap vaccine', 'inj', ['0.5 ml'], 'Vaccines'),
  M('Influenza vaccine (inactivated)', 'inj', ['0.5 ml'], 'Vaccines'),
  M('Anti-D immunoglobulin', 'inj', ['300 mcg', '150 mcg'], 'Vaccines'),
  // Iron by injection
  M('Iron sucrose', 'inj', ['100 mg/5 ml'], 'Iron by injection'),
  M('Ferric carboxymaltose', 'inj', ['500 mg/10 ml', '1000 mg/20 ml'], 'Iron by injection'),
  // Pain and bleeding
  M('Paracetamol', 'tab', ['500 mg', '650 mg'], 'Pain and bleeding'),
  M('Mefenamic acid', 'tab', ['250 mg', '500 mg'], 'Pain and bleeding'),
  M('Drotaverine', 'tab', ['40 mg', '80 mg'], 'Pain and bleeding'),
  M('Dicyclomine', 'tab', ['10 mg', '20 mg'], 'Pain and bleeding'),
  M('Tranexamic acid', 'tab', ['500 mg'], 'Pain and bleeding'),
  // Infections
  M('Amoxicillin', 'cap', ['250 mg', '500 mg'], 'Infections'),
  M('Amoxicillin + clavulanic acid', 'tab', ['625 mg'], 'Infections'),
  M('Cefixime', 'tab', ['200 mg'], 'Infections'),
  M('Cefuroxime', 'tab', ['250 mg', '500 mg'], 'Infections'),
  M('Cephalexin', 'cap', ['500 mg'], 'Infections'),
  M('Nitrofurantoin', 'cap', ['100 mg'], 'Infections'),
  M('Azithromycin', 'tab', ['500 mg'], 'Infections'),
  M('Metronidazole', 'tab', ['400 mg'], 'Infections'),
  M('Clindamycin', 'cap', ['300 mg'], 'Infections'),
  M('Fluconazole', 'tab', ['150 mg'], 'Infections'),
  M('Clotrimazole', 'pessary', ['100 mg', '200 mg', '500 mg'], 'Infections'),
  M('Clotrimazole', 'cream', ['1%'], 'Infections'),
  M('Povidone-iodine', 'ointment', ['5%'], 'Infections'),
  // Gynaecology, infertility, contraception
  M('Letrozole', 'tab', ['2.5 mg'], 'Gynaecology and infertility'),
  M('Clomiphene citrate', 'tab', ['50 mg', '100 mg'], 'Gynaecology and infertility'),
  M('Myo-inositol + folic acid', 'sachet', ['2 g + 200 mcg'], 'Gynaecology and infertility'),
  M('Norethisterone', 'tab', ['5 mg'], 'Gynaecology and infertility'),
  M('Medroxyprogesterone acetate', 'tab', ['10 mg'], 'Gynaecology and infertility'),
  M('Estradiol valerate', 'tab', ['2 mg'], 'Gynaecology and infertility'),
  M('Cabergoline', 'tab', ['0.5 mg'], 'Gynaecology and infertility'),
  M('Levonorgestrel + ethinylestradiol', 'tab', ['0.15 mg + 0.03 mg'], 'Contraception'),
  M('Ormeloxifene', 'tab', ['30 mg'], 'Contraception'),
  M('Medroxyprogesterone acetate (DMPA)', 'inj', ['150 mg'], 'Contraception'),
  // After delivery and others
  M('Oxytocin', 'inj', ['5 IU', '10 IU'], 'Labour and after delivery'),
  M('Lignocaine', 'gel', ['2%'], 'Labour and after delivery'),
  M('Cetirizine', 'tab', ['10 mg'], 'Other'),
  M('Oral rehydration salts (ORS)', 'sachet', [], 'Other'),
];

/** The listed medicine with this name (any case), if any – the first one for a name listed in two forms. */
export const findMedicine = (name) => {
  const key = (name ?? '').trim().toLowerCase();
  return key ? (MEDICINES.find((m) => m.name.toLowerCase() === key) ?? null) : null;
};
