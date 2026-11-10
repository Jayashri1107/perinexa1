// USG and radiology studies and their DRAFT report templates (Lab version 2 part 8 – docs/LAB_V2_PLAN.md). Written from
// common Indian OBGY sonography reporting practice; for the doctor to check and approve before clinical use – every
// printed report says DRAFT template until then. PCPNDT Act: no template and no field holds the sex of a fetus, and
// the free text of a report refuses words about it (utils/pcpndt.js).

const num = (key, name, unit) => ({ key, name, type: 'number', unit });
const text = (key, name) => ({ key, name, type: 'text' });
const choice = (key, name, options) => ({ key, name, type: 'choice', options });

const LIQUOR = ['Adequate', 'Reduced (oligohydramnios)', 'Increased (polyhydramnios)'];
const PLACENTA = ['Anterior', 'Posterior', 'Fundal', 'Lateral', 'Low lying', 'Covering the internal os'];
const PRESENTATION = ['Cephalic', 'Breech', 'Transverse', 'Oblique', 'Variable'];
const PRESENT = ['Present', 'Absent'];
const CHORIONICITY = ['Dichorionic diamniotic (DCDA)', 'Monochorionic diamniotic (MCDA)', 'Monochorionic monoamniotic (MCMA)', 'Not certain'];

export const MODALITIES = { usg: 'Ultrasound', xray: 'X-ray', other: 'Other imaging' };

export const STUDIES = [
  {
    key: 'usg_early',
    modality: 'usg',
    name: 'USG – early pregnancy (dating and viability)',
    fields: [choice('site', 'Pregnancy site', ['Intrauterine', 'Not seen in the uterus', 'Ectopic suspected']), choice('number', 'Number of embryos', ['Single', 'Twins', 'More than two']), num('crl', 'Crown-rump length (CRL)', 'mm'), num('msd', 'Mean sac diameter', 'mm'), choice('cardiac', 'Cardiac activity', PRESENT), num('fhr', 'Fetal heart rate', 'bpm'), text('ga', 'Gestational age by scan'), text('edd', 'EDD by scan'), text('adnexa', 'Adnexa')],
  },
  {
    key: 'usg_nt',
    modality: 'usg',
    name: 'USG – NT scan (11–13+6 weeks)',
    fields: [num('crl', 'Crown-rump length (CRL)', 'mm'), num('nt', 'Nuchal translucency (NT)', 'mm'), choice('nasal', 'Nasal bone', PRESENT), num('fhr', 'Fetal heart rate', 'bpm'), text('ductus', 'Ductus venosus flow'), text('ga', 'Gestational age by scan'), choice('placenta', 'Placenta', PLACENTA)],
  },
  {
    key: 'usg_anomaly',
    modality: 'usg',
    name: 'USG – anomaly scan (18–22 weeks)',
    fields: [num('bpd', 'BPD', 'mm'), num('hc', 'Head circumference', 'mm'), num('ac', 'Abdominal circumference', 'mm'), num('fl', 'Femur length', 'mm'), num('efw', 'Estimated fetal weight', 'g'), num('fhr', 'Fetal heart rate', 'bpm'), choice('placenta', 'Placenta', PLACENTA), choice('liquor', 'Liquor', LIQUOR), text('anatomy', 'Fetal anatomy survey'), num('cervix', 'Cervical length', 'mm')],
  },
  {
    key: 'usg_growth',
    modality: 'usg',
    name: 'USG – growth and well-being (third trimester)',
    fields: [choice('presentation', 'Presentation', PRESENTATION), num('bpd', 'BPD', 'mm'), num('hc', 'Head circumference', 'mm'), num('ac', 'Abdominal circumference', 'mm'), num('fl', 'Femur length', 'mm'), num('efw', 'Estimated fetal weight', 'g'), text('efwCentile', 'EFW centile'), num('afi', 'Amniotic fluid index (AFI)', 'cm'), num('dvp', 'Deepest vertical pocket', 'cm'), choice('placenta', 'Placenta', PLACENTA), text('doppler', 'Doppler (UA PI, MCA PI, CPR)'), num('fhr', 'Fetal heart rate', 'bpm')],
  },
  {
    // Twins (owner's go-ahead, 10 Nov 2026 – docs/USG_APPS_REVIEW.md U4): chorionicity, each twin by itself, and the
    // weight difference worked out from the two estimated weights (client/src/pages/imaging/usgCalc.js). DRAFT.
    key: 'usg_twins',
    modality: 'usg',
    name: 'USG – twins (growth and well-being)',
    fields: [
      choice('chorionicity', 'Chorionicity', CHORIONICITY),
      choice('presentation1', 'Twin 1 – presentation', PRESENTATION),
      num('bpd1', 'Twin 1 – BPD', 'mm'),
      num('hc1', 'Twin 1 – head circumference', 'mm'),
      num('ac1', 'Twin 1 – abdominal circumference', 'mm'),
      num('fl1', 'Twin 1 – femur length', 'mm'),
      num('efw1', 'Twin 1 – estimated fetal weight', 'g'),
      num('dvp1', 'Twin 1 – deepest vertical pocket', 'cm'),
      num('fhr1', 'Twin 1 – fetal heart rate', 'bpm'),
      choice('presentation2', 'Twin 2 – presentation', PRESENTATION),
      num('bpd2', 'Twin 2 – BPD', 'mm'),
      num('hc2', 'Twin 2 – head circumference', 'mm'),
      num('ac2', 'Twin 2 – abdominal circumference', 'mm'),
      num('fl2', 'Twin 2 – femur length', 'mm'),
      num('efw2', 'Twin 2 – estimated fetal weight', 'g'),
      num('dvp2', 'Twin 2 – deepest vertical pocket', 'cm'),
      num('fhr2', 'Twin 2 – fetal heart rate', 'bpm'),
      text('discordance', 'Weight difference between the twins'),
      text('placenta', 'Placenta(s)'),
      num('cervix', 'Cervical length', 'mm'),
    ],
  },
  {
    key: 'usg_pelvis',
    modality: 'usg',
    name: 'USG – pelvis / TVS (gynaecology)',
    fields: [text('uterus', 'Uterus (size, position)'), num('endometrium', 'Endometrial thickness', 'mm'), text('myometrium', 'Myometrium (fibroids, adenomyosis)'), text('rightOvary', 'Right ovary'), text('leftOvary', 'Left ovary'), text('adnexa', 'Adnexa and pouch of Douglas'), choice('fluid', 'Free fluid', PRESENT)],
  },
  {
    key: 'usg_follicular',
    modality: 'usg',
    name: 'USG – follicular study',
    fields: [text('cycleDay', 'Day of the cycle'), num('endometrium', 'Endometrial thickness', 'mm'), text('rightFollicles', 'Right ovary follicles (sizes, mm)'), text('leftFollicles', 'Left ovary follicles (sizes, mm)'), choice('ovulation', 'Signs of ovulation', ['Not yet', 'Ovulated', 'Not seen'])],
  },
  {
    key: 'usg_breast',
    modality: 'usg',
    name: 'USG – breast',
    fields: [text('right', 'Right breast'), text('left', 'Left breast'), text('axilla', 'Axillae'), choice('birads', 'BI-RADS category', ['0', '1', '2', '3', '4', '5', '6'])],
  },
  { key: 'usg_abdomen', modality: 'usg', name: 'USG – abdomen and pelvis', fields: [text('liver', 'Liver'), text('gallbladder', 'Gall bladder'), text('kidneys', 'Kidneys'), text('pelvis', 'Pelvis')] },
  { key: 'xray', modality: 'xray', name: 'X-ray', fields: [text('part', 'Part and view')] },
  { key: 'other', modality: 'other', name: 'Other imaging', fields: [text('study', 'Study')] },
];

export const STUDY_KEYS = STUDIES.map((s) => s.key);
export const studyByKey = new Map(STUDIES.map((s) => [s.key, s]));
