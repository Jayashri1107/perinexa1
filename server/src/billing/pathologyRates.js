// The hospital's pathology rate list (owner, 23 Oct 2026: "PATHOLOGY RATE LIST-6.pdf"), loaded into every hospital's
// price list by the person who runs the server: npm run load:lab-rates. Prices are in rupees. Only prices: no test's
// fields or usual ranges change (those are clinical and need the owner's approval).
//
// - KEYED: the app's own lab tests (lab/labTests.js) – ordering one in the Lab charges this price automatically.
//   Choices made on 23 Oct 2026: HIV and HBsAg at the card-test price; a test made of several on the list is their
//   sum (Day 2–3 hormones = FSH + LH + AMH + prolactin; the baby's tests likewise); HVS culture at the pus/swab culture
//   price; histopathology at the small-biopsy price. Tests not on the list keep their price.
// - EXTRA: the other tests on the list, added under Lab test so reception can put them on a bill. They are not Lab
//   tests yet (no ordering or results) until each is set up in Lab → Tests.
// HIV is never named on a bill (the HIV and AIDS Act 2017; billingRules.js CONFIDENTIAL_NAME): its other methods
// carry the neutral name with the method.

import { CONFIDENTIAL_NAME } from './billingRules.js';

export const RATE_LIST_NAME = 'Pathology rate list (Oct 2026)';

export const KEYED_RATES = {
  cbc: 300,
  hb: 100,
  group: 100,
  ict: 600,
  hiv: 350,
  vdrl: 250,
  hbsag: 250,
  hcv: 500,
  tsh: 300,
  ogtt: 300,
  fbs: 50,
  ppbs: 50,
  rbs: 50,
  hba1c: 600,
  lft: 600,
  rft: 500,
  thyroid: 500,
  lipid: 600,
  ferritin: 1000,
  bhcg: 800,
  hormones: 600 + 600 + 2400 + 600, // FSH + LH + AMH + prolactin
  urine: 100,
  urineCulture: 600,
  hvsCulture: 600, // as pus culture
  semen: 500,
  pap: 800,
  histopath: 1500, // small biopsy (medium and large are extra items)
  nb_sugar: 50,
  nb_bilirubin: 200,
  nb_cbc: 300 + 500, // CBC + reticulocyte count
  nb_group_dct: 100 + 600, // blood group + direct Coombs
  nb_g6pd: 600,
  nb_chem: 400 + 200, // sodium + potassium, calcium
  nb_bone: 200 + 200 + 150, // calcium, phosphorus, alkaline phosphatase
  nb_tsh: 300 + 500, // TSH + free T4
  nb_culture: 1500, // blood culture
};

const CONF = (method) => `${CONFIDENTIAL_NAME} – ${method}`;

export const EXTRA_RATES = [
  // Haematology
  ['ESR', 100],
  ['Peripheral smear for opinion', 150],
  ['Peripheral smear for malaria parasite (MP)', 200],
  ['TLC and DLC', 200],
  ['Platelet count', 300],
  ['Reticulocyte count', 500],
  ['Direct Coombs test (DCT)', 600],
  ['G6PD', 600],
  ['Hb electrophoresis by HPLC (A2)', 1000],
  // Coagulation
  ['Prothrombin time (PT)', 300],
  ['APTT', 300],
  ['Coagulogram (PT, APTT, INR)', 600],
  // Biochemistry
  ['Urea', 150],
  ['Creatinine', 150],
  ['SGOT', 150],
  ['SGPT', 150],
  ['Bilirubin (total and direct)', 200],
  ['Alkaline phosphatase', 150],
  ['Gamma GT', 400],
  ['Proteins (total and albumin)', 200],
  ['Cholesterol', 200],
  ['HDL cholesterol (direct)', 200],
  ['LDL cholesterol (direct)', 200],
  ['Triglycerides', 200],
  ['Lipid profile with direct LDL', 800],
  ['Sodium', 200],
  ['Potassium', 200],
  ['Sodium and potassium', 400],
  ['Calcium (ionic or total)', 200],
  ['Phosphorus', 200],
  ['Chlorides', 200],
  ['Magnesium', 200],
  ['Urine microalbumin', 500],
  ['LDH', 500],
  ['CPK – total', 500],
  ['CPK – MB', 650],
  ['Amylase (kinetic)', 600],
  ['Lipase (kinetic)', 600],
  ['Cholinesterase', 800],
  ['Uric acid', 200],
  ['Ammonia', 800],
  ['Bicarbonate on ABG', 800],
  ['Iron and TIBC', 1000],
  ['Iron only', 300],
  ['Lactate', 600],
  ['Urine osmolality', 1000],
  ['Serum osmolality', 1000],
  ['ABG or venous blood gases', 1000],
  // Immunoassay
  ['C3', 650],
  ['C4', 650],
  ['T3', 150],
  ['T4', 150],
  ['ADA (adenosine deaminase for TB)', 800],
  ['Free T3', 500],
  ['Free T4', 500],
  ['Homocysteine', 1500],
  ['Vitamin B12', 1000],
  ['Vitamin D (total 25-OH)', 1500],
  ['AMH', 2400],
  ['FSH', 600],
  ['LH', 600],
  ['Prolactin', 600],
  ['Estradiol', 800],
  ['Progesterone', 800],
  ['Cortisol', 800],
  ['Testosterone', 800],
  ['Insulin', 800],
  ['DHEAS', 800],
  ['Parathyroid hormone (PTH)', 1500],
  ['Troponin I (ELFA)', 1200],
  ['NT-proBNP', 2500],
  ['IgE', 800],
  // Serology
  ['RA test (nephelometry)', 400],
  ['ASO titre', 400],
  ['C-reactive protein (CRP)', 400],
  [CONF('Duo Ultra'), 800],
  [CONF('Chemi'), 800],
  ['HBsAg (chemi)', 800],
  ['HAV IgM (VIDAS)', 1500],
  ['HEV IgM (VIDAS)', 1500],
  ['TORCH IgG', 1500],
  ['TORCH IgM', 1500],
  ['TORCH (IgG and IgM)', 3000],
  ['Toxoplasma IgG or IgM', 800],
  ['Rubella IgG or IgM', 800],
  ['CMV IgG or IgM', 800],
  ['Herpes (HSV) IgG or IgM', 800],
  ['Scrub typhus (card, IgM and IgG)', 1000],
  ['Scrub typhus IgM (ELISA)', 1500],
  ['Widal test (slide)', 200],
  ['Leptospira IgG and IgM', 1500],
  ['Malaria P. vivax / P. falciparum (card)', 500],
  ['Dengue NS1 antigen (card)', 600],
  ['Dengue IgG and IgM antibodies (card)', 600],
  ['Chikungunya', 1000],
  // Tumour markers
  ['Alpha-fetoprotein (AFP)', 1200],
  ['Carcinoembryonic antigen (CEA)', 1500],
  ['Prostate-specific antigen (PSA)', 800],
  ['CA 19-9', 1500],
  ['CA-125', 1500],
  ['CA 15-3', 1500],
  // Urine and stool
  ['Urine ketones', 100],
  ['Urine protein / creatinine ratio', 500],
  ['Stool routine', 100],
  ['Stool occult blood', 100],
  // Microbiology
  ['Pus culture', 600],
  ['Fluid culture', 800],
  ['Blood culture', 1500],
  ['Culture with MIC', 1500],
  ['Gram stain', 200],
  ['AFB stain', 300],
  // Histopathology and cytology
  ['Cytology', 1500],
  ['Biopsy – medium', 2500],
  ['Biopsy – large', 4000],
  // Special tests
  ['ANA by IFA', 1000],
  ['ANA (ELISA)', 700],
  ['ds-DNA (ELISA)', 1200],
  ['ANA blot (17 parameters)', 3300],
  ['TB Gold', 3400],
  ['TB PCR', 2500],
  ['Ceruloplasmin', 1500],
  ['HBV DNA PCR', 6000],
  ['CD4 and CD8', 2500],
  ['D-dimer', 1400],
  ['HLA-B27 (PCR)', 3500],
  ['Anti-CCP', 1500],
  ['Procalcitonin', 2500],
  // Other tests
  ['Mantoux test', 150],
  ['Conjunctival smear', 300],
  ['Fluid examination (routine and biochemistry)', 800],
].map(([name, rupees]) => ({ name, rupees }));
