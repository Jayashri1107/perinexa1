// Lab tests for babies (patients registered for newborn care), and ready-made packages of them by the baby's day of
// life. A baby's record offers only these tests; the mother's tests are on her own record.
//
// ⚠️ DRAFT newborn values and packages, from published guidance (NNF India clinical practice guidelines –
// hypoglycaemia, neonatal jaundice, sepsis; AAP 2022 hyperbilirubinemia guideline; MoHFW RBSK newborn screening and
// hearing screening; AAP/AHA pulse-oximetry CCHD screening). Not reviewed by a paediatrician: the lab's report and
// the treating doctor decide – a flag only draws attention. Many newborn values depend on the age in hours or days.

const rangeText = (low, high, unit) =>
  low != null && high != null ? `${low}–${high} ${unit}`.trim() : high != null ? `up to ${high} ${unit}`.trim() : low != null ? `${low} ${unit} or more`.trim() : '';
const num = (key, name, unit, low, high, range = '') => ({ key, name, type: 'number', unit, low, high, range: range || rangeText(low, high, unit) });
const choice = (key, name, options, abnormal) => ({ key, name, type: 'choice', options, abnormal });
const text = (key, name) => ({ key, name, type: 'text' });

const SCREEN = ['Screen negative', 'Screen positive – recall'];
const PASS = ['Pass', 'Refer'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const AGE_HOURS = num('ageHours', "Baby's age when sampled", 'hours', null, null, 'for the hour-specific bilirubin chart');

export const NEWBORN_GROUPS = {
  nb_blood: 'Baby: blood tests',
  nb_infection: 'Baby: infection',
  nb_screening: 'Baby: newborn screening',
  nb_bedside: 'Baby: nursery checks',
};

export const NEWBORN_TESTS = [
  { key: 'nb_sugar', name: 'Blood sugar (baby)', group: 'nb_blood', sample: 'Heel prick or venous blood',
    fields: [num('glucose', 'Blood glucose', 'mg/dL', 45, 150, '45–150 mg/dL (below 45 is low – NNF)')] },
  { key: 'nb_bilirubin', name: 'Serum bilirubin, total and direct (baby)', group: 'nb_blood', sample: 'Venous blood (plain), protected from light',
    fields: [AGE_HOURS, num('total', 'Total bilirubin', 'mg/dL', null, null, 'judge on the hour-specific chart for the age in hours'), num('direct', 'Direct (conjugated) bilirubin', 'mg/dL', null, 1.0, 'up to 1.0 mg/dL (or under 20 % of total)')] },
  { key: 'nb_cbc', name: 'Complete blood count with reticulocytes (baby)', group: 'nb_blood', sample: 'Blood (EDTA)',
    fields: [
      num('hb', 'Haemoglobin', 'g/dL', 13.5, 22, '13.5–22 g/dL in the first week (falls after)'),
      num('hct', 'Haematocrit (PCV)', '%', 42, 65, '42–65 % (above 65 is polycythaemia)'),
      num('tlc', 'Total WBC count', '/µL', 9000, 30000, '9,000–30,000 /µL in the first days'),
      num('platelets', 'Platelets', 'lakh/µL', 1.5, 4.5),
      num('retic', 'Reticulocytes', '%', null, 7, 'up to 7 % at birth, falls by the end of the first week'),
    ] },
  { key: 'nb_group_dct', name: 'Blood group, Rh and direct Coombs test (baby)', group: 'nb_blood', sample: 'Cord or venous blood (EDTA)',
    fields: [choice('group', 'Blood group', BLOOD_GROUPS, []), choice('dct', 'Direct Coombs test (DCT)', ['Negative', 'Positive'], ['Positive'])] },
  { key: 'nb_g6pd', name: 'G6PD (quantitative, baby)', group: 'nb_blood', sample: 'Blood (EDTA)',
    fields: [choice('result', 'G6PD', ['Normal', 'Deficient', 'Intermediate'], ['Deficient', 'Intermediate']), num('activity', 'G6PD activity', 'U/g Hb', null, null, "as per the lab's range")] },
  { key: 'nb_chem', name: 'Sodium, potassium and calcium (baby)', group: 'nb_blood', sample: 'Blood (plain)',
    fields: [num('na', 'Sodium', 'mmol/L', 135, 145), num('k', 'Potassium', 'mmol/L', 3.5, 6.0, '3.5–6.0 mmol/L (newborn)'), num('ca', 'Total calcium', 'mg/dL', 8, 11, '8–11 mg/dL (below 7 is hypocalcaemia)')] },
  { key: 'nb_bone', name: 'Calcium, phosphorus and alkaline phosphatase (preterm bone check)', group: 'nb_blood', sample: 'Blood (plain)',
    fields: [num('ca', 'Total calcium', 'mg/dL', 8, 11), num('phosphorus', 'Phosphorus', 'mg/dL', 4.5, 9, '4.5–9 mg/dL (below 4 suggests bone disease of prematurity)'), num('alp', 'Alkaline phosphatase', 'IU/L', null, 500, 'up to 500 IU/L (above 800–900 suggests bone disease of prematurity)')] },
  { key: 'nb_tsh', name: 'TSH and free T4 (baby)', group: 'nb_blood', sample: 'Venous blood (plain)',
    fields: [num('tsh', 'TSH', 'µIU/mL', null, 20, 'up to 20 in the first week, up to 10 after 2 weeks'), num('ft4', 'Free T4', 'ng/dL', null, null, "doctor to judge by age (higher in the first week)")] },
  { key: 'nb_sepsis', name: 'Sepsis screen (baby)', group: 'nb_infection', sample: 'Blood (EDTA + plain)',
    fields: [
      num('tlc', 'Total WBC count', '/µL', 5000, null, '5,000 /µL or more (below is abnormal)'),
      num('anc', 'Absolute neutrophil count', '/µL', null, null, 'judge on the chart for the age in hours'),
      num('it', 'Immature : total neutrophil ratio', '', null, 0.2, 'up to 0.2'),
      num('esr', 'Micro-ESR', 'mm in 1st hour', null, 15, 'up to (age in days + 3) mm, at most 15'),
      num('crp', 'CRP', 'mg/L', null, 10, 'up to 10 mg/L'),
    ] },
  { key: 'nb_culture', name: 'Blood culture and sensitivity (baby)', group: 'nb_infection', sample: 'Blood culture bottle (paediatric)',
    fields: [choice('growth', 'Growth', ['No growth', 'Growth'], ['Growth']), text('organism', 'Organism'), text('sensitivity', 'Sensitive to')] },
  { key: 'nb_screening', name: 'Newborn screening panel (heel-prick blood spot)', group: 'nb_screening', planKeys: ['nb_lab_screening'], sample: 'Dried blood spot on filter card, after 48 hours of age',
    fields: [
      num('ageHours', "Baby's age when sampled", 'hours', 48, null, 'after 48 hours (repeat if taken earlier)'),
      choice('ch', 'Congenital hypothyroidism (TSH)', SCREEN, [SCREEN[1]]),
      choice('g6pd', 'G6PD deficiency', SCREEN, [SCREEN[1]]),
      choice('cah', 'Congenital adrenal hyperplasia (17-OHP)', SCREEN, [SCREEN[1]]),
      choice('gal', 'Galactosaemia', SCREEN, [SCREEN[1]]),
      choice('pku', 'Phenylketonuria (PKU)', SCREEN, [SCREEN[1]]),
      choice('btd', 'Biotinidase deficiency', SCREEN, [SCREEN[1]]),
    ] },
  { key: 'nb_oae', name: 'Hearing screen (OAE)', group: 'nb_bedside', planKeys: ['nb_hearing'], sample: 'Done at the bedside / in the nursery',
    fields: [choice('right', 'Right ear', PASS, ['Refer']), choice('left', 'Left ear', PASS, ['Refer'])] },
  { key: 'nb_pulseox', name: 'Pulse-oximetry heart screen (CCHD), after 24 hours', group: 'nb_bedside', planKeys: ['nb_cchd'], sample: 'Done at the bedside: right hand and a foot',
    fields: [num('hand', 'SpO₂ right hand', '%', 95, null), num('foot', 'SpO₂ foot', '%', 95, null), choice('result', 'Result', ['Pass', 'Repeat', 'Fail – echo'], ['Repeat', 'Fail – echo'])] },
  { key: 'nb_tcb', name: 'Skin bilirubin (transcutaneous, TcB)', group: 'nb_bedside', sample: 'Done at the bedside with a bilirubin meter',
    fields: [AGE_HOURS, num('tcb', 'TcB', 'mg/dL', null, null, 'judge on the hour-specific chart; confirm a high reading with a blood test')] },
];
