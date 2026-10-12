// The built-in DRAFT test packages every hospital starts with (its own copy, lab/labPackages.js): ready-made sets of
// tests ordered together. Baby packages are by day of life (the day of birth is day 0); packages for adults (the
// mother) say when they are used. The doctor chooses: a package only ticks its tests in the order form, and any test
// can be unticked. ⚠️ Not reviewed by a doctor – sources in newbornTests.js, the antenatal care-plan draft and a
// package's own notes for doctors (about).

// Increase when the built-in packages change: unapproved copies that no one has edited are refreshed.
export const BUILT_IN_PACKAGES_VERSION = 1;

// Baby packages. fromDay / toDay: the days when the package fits (null toDay = any later day). forWhom: which babies
// it is for (null = every baby).
const NEWBORN_PACKAGES = [
  { who: 'newborn', key: 'nb_pkg_cord', name: 'At birth – cord blood', fromDay: 0, toDay: 0, forWhom: 'Mother Rh negative or blood group O, or a previous baby with jaundice needing treatment',
    tests: ['nb_group_dct', 'nb_bilirubin', 'nb_cbc'] },
  { who: 'newborn', key: 'nb_pkg_sugar', name: 'First 24 hours – low-sugar watch', fromDay: 0, toDay: 1, forWhom: 'Small, big or preterm baby, or mother with diabetes (check at 2 hours, then before feeds)',
    tests: ['nb_sugar'] },
  { who: 'newborn', key: 'nb_pkg_idm', name: 'Day 0–2 – baby of a mother with diabetes', fromDay: 0, toDay: 2, forWhom: 'Mother with diabetes (GDM or known)',
    tests: ['nb_sugar', 'nb_cbc', 'nb_chem'] },
  { who: 'newborn', key: 'nb_pkg_discharge', name: 'Day 2–3 – newborn screening before going home', fromDay: 2, toDay: 7, forWhom: null,
    tests: ['nb_screening', 'nb_oae', 'nb_pulseox', 'nb_tcb'] },
  { who: 'newborn', key: 'nb_pkg_jaundice', name: 'Day 1–14 – jaundice work-up', fromDay: 1, toDay: 14, forWhom: 'Visible jaundice, or a high skin (TcB) reading',
    tests: ['nb_bilirubin', 'nb_group_dct', 'nb_cbc', 'nb_g6pd'] },
  { who: 'newborn', key: 'nb_pkg_sepsis', name: 'Sepsis screen – baby unwell', fromDay: 0, toDay: 28, forWhom: 'Signs of infection, or mother with fever, prolonged leaking or foul-smelling liquor',
    tests: ['nb_sepsis', 'nb_culture', 'nb_sugar'] },
  { who: 'newborn', key: 'nb_pkg_thyroid_mother', name: 'Day 3–14 – baby of a mother with thyroid disease', fromDay: 3, toDay: 14, forWhom: 'Mother with hypothyroidism or Graves’ disease (repeat at 2 weeks)',
    tests: ['nb_tsh'] },
  { who: 'newborn', key: 'nb_pkg_rescreen', name: 'Day 7–14 – repeat newborn screening', fromDay: 7, toDay: 14, forWhom: 'Preterm, low birth weight or sick baby, or first sample taken before 48 hours',
    tests: ['nb_screening', 'nb_tsh'] },
  { who: 'newborn', key: 'nb_pkg_prolonged_jaundice', name: 'After day 14 – prolonged jaundice', fromDay: 14, toDay: null, forWhom: 'Jaundice beyond 14 days (21 days in a preterm baby), or pale stools / dark urine',
    tests: ['nb_bilirubin', 'nb_tsh', 'nb_g6pd', 'nb_cbc'] },
  { who: 'newborn', key: 'nb_pkg_preterm', name: 'Week 3–6 – preterm baby: anaemia and bone check', fromDay: 21, toDay: 42, forWhom: 'Born before 34 weeks or under 1.5 kg',
    tests: ['nb_cbc', 'nb_bone'] },
];

// Packages for adults (mostly the mother): no day window; forWhom says when they are used.
const ADULT_PACKAGES = [
  { who: 'adult', key: 'anc_pkg_booking', name: 'Antenatal booking tests', fromDay: null, toDay: null, forWhom: 'First antenatal visit (the HIV test needs its consent form and counselling)',
    tests: ['cbc', 'group', 'hiv', 'vdrl', 'hbsag', 'tsh', 'ogtt', 'urine'] },
  { who: 'adult', key: 'anc_pkg_24_28', name: '24–28 weeks', fromDay: null, toDay: null, forWhom: 'Every pregnant woman (ICT only if Rh negative)',
    tests: ['ogtt', 'hb', 'ict'] },
  { who: 'adult', key: 'anc_pkg_third', name: '32–36 weeks', fromDay: null, toDay: null, forWhom: 'Every pregnant woman',
    tests: ['hb', 'urine'] },
  { who: 'adult', key: 'anc_pkg_pe', name: 'Pre-eclampsia work-up', fromDay: null, toDay: null, forWhom: 'Raised blood pressure after 20 weeks',
    tests: ['cbc', 'lft', 'rft', 'urine'] },
  { who: 'adult', key: 'adult_pkg_preop', name: 'Before an operation', fromDay: null, toDay: null, forWhom: 'Caesarean section or gynaecological surgery (the HIV test needs its consent)',
    tests: ['cbc', 'group', 'hiv', 'hbsag', 'hcv', 'rbs', 'rft', 'urine'] },
  { who: 'adult', key: 'pnc_pkg_gdm', name: '6–12 weeks after delivery – sugar test after GDM', fromDay: null, toDay: null, forWhom: 'Mother who had diabetes in pregnancy',
    tests: ['ogtt'] },
  // Pregnancy-loss care, part 2 (5 Oct 2026). The care plan's "Recurrent-loss work-up" item stays for the doctor to
  // tick: it also covers the scan of the uterus, so one lab result does not complete it.
  { who: 'adult', key: 'loss_pkg_recurrent', name: 'Recurrent pregnancy loss work-up', fromDay: null, toDay: null,
    forWhom: 'Two or more pregnancy losses (ESHRE 2022) – the doctor decides when to test',
    tests: ['lupusAnticoagulant', 'acl', 'b2gpi', 'tsh', 'antiTpo', 'hba1c'],
    about:
      'Tests for the work-up after two or more pregnancy losses (ESHRE Recurrent pregnancy loss, 2022; RCOG Green-top Guideline 17, 2023). Antiphospholipid antibodies: lupus anticoagulant (before any heparin), anticardiolipin IgG and IgM, anti-beta-2-glycoprotein I (ESHRE: can be considered); a positive result counts only if it is positive again at least 12 weeks later. Thyroid: TSH and TPO antibodies. HbA1c (or a fasting sugar): the hospital\'s choice, for diabetes that may be present or uncontrolled – not a routine ESHRE or RCOG test; the doctor decides. Not in the package: parental karyotype of both partners, only on the doctor\'s decision after assessment (order it as "Another test"; the lab attaches the report, as a typed karyotype is refused by the PCPNDT check); tests for inherited thrombophilia (not advised routinely); and a pelvic ultrasound for the shape of the uterus (3D if available), which is a scan, not a lab test – book it separately.' },
];

export const BUILT_IN_PACKAGES = [...NEWBORN_PACKAGES, ...ADULT_PACKAGES].map((p, i) => ({ ...p, forWhom: p.forWhom ?? '', about: p.about ?? '', order: (i + 1) * 10 }));
