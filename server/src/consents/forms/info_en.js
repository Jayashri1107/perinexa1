// English wording of the built-in DRAFT information forms: the doctor explains a condition or complication
// (e.g. PIH, GDM) to the patient and her relatives, and they sign that they were informed. This is not a consent:
// any operation or procedure still needs its own consent form. The Marathi (info_mr.js) and Hindi (info_hi.js)
// drafts are translated from this file, clause by clause.
//
// ⚠️ Drafted by the software developer (Claude) from published guidance (FOGSI good clinical practice
// recommendations, MoHFW India GDM and Anemia Mukt Bharat guidelines, RCOG patient information). NOT reviewed by a
// doctor or a lawyer: the hospital's doctor must check every sheet (and its translations) before use.
//
// Blanks: {patient}, {mrn}, {doctor} as in the consent forms (forms/en.js); {condition} is typed by the doctor
// when printing (the general form only).

const opening = (what) => `{doctor} has explained to me, {patient} (patient no. {mrn}), and to my relatives that ${what}`;

// The last two clauses of every information form.
const FOLLOW =
  'We understand that even with good care some of these complications cannot always be prevented, and that following the advice, taking the medicines as prescribed and coming for every check-up lowers the risks.';
const CLOSING =
  'This information was explained to me and my relatives in a language we understand. We had the chance to ask questions and our questions were answered. We sign to record that we have been informed about the condition, its risks and its possible complications. This is not a consent for any operation or procedure: those will be explained and consented to separately.';

export const INFO_EN = {
  info_hypertension: {
    title: 'Information: high blood pressure in pregnancy (PIH / pre-eclampsia)',
    clauses: [
      opening('I have high blood pressure in this pregnancy (pregnancy-induced hypertension, PIH), which may be or may become pre-eclampsia.'),
      'High blood pressure in pregnancy means a blood pressure of 140/90 or more. When there is also protein in the urine, or other organs are affected, it is called pre-eclampsia. It can get worse quickly, sometimes without any symptoms.',
      'The possible risks to me have been explained: fits (eclampsia), bleeding in the brain (stroke), damage to the kidneys and liver, a fall in platelets with bleeding problems (HELLP syndrome), fluid in the lungs, separation of the placenta before delivery (abruption), heavy bleeding after delivery and, rarely, risk to life.',
      'The possible risks to the baby have been explained: poor growth, less water around the baby, lack of oxygen, early (premature) birth with admission to the newborn unit and, rarely, death of the baby in the womb.',
      "The care needed has been explained: regular checks of blood pressure, urine and blood tests, scans and checks of the baby's heart, medicines to control the blood pressure (and to prevent fits if needed) and admission to hospital if needed. The only cure is delivery, which may have to be done early – by induction of labour or caesarean section – for my safety or the baby's.",
      'I must come to the hospital at once if I have a severe headache, blurred vision or see spots, pain in the upper abdomen, vomiting, sudden swelling of the face or hands, breathlessness, fits, less movement of the baby, bleeding or leaking of water.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_gdm: {
    title: 'Information: diabetes in pregnancy (gestational diabetes, GDM)',
    clauses: [
      opening('I have diabetes (high blood sugar) in this pregnancy: diabetes that started in pregnancy (gestational diabetes, GDM), or diabetes that was present before.'),
      'In diabetes the body cannot keep the blood sugar normal. In pregnancy it is controlled with diet, exercise and, when needed, tablets (such as metformin) or insulin injections.',
      'The possible risks to me have been explained: high blood pressure and pre-eclampsia, urine and vaginal infections, too much water around the baby, a difficult labour, a greater chance of caesarean section, low sugar during treatment, and a higher chance of diabetes in a later pregnancy and later in life.',
      'The possible risks to the baby have been explained: a big baby with a difficult delivery and injury at birth (shoulder dystocia), birth defects (mainly when diabetes was present before pregnancy and the sugar is poorly controlled), breathing problems, low blood sugar and jaundice after birth, admission to the newborn unit and, rarely, death of the baby in the womb, especially near the due date.',
      "The care needed has been explained: regular blood sugar checks, diet advice, tablets or insulin as advised, scans of the baby's growth and the water around it, checks of the baby's heart, a planned time of delivery, and a sugar test 6 to 12 weeks after delivery and regularly after that.",
      'I must come to the hospital at once if the baby moves less, if my sugar is very high or very low (sweating, shaking, confusion), if I am vomiting and cannot eat, or if I have fever, burning while passing urine, leaking of water, bleeding or labour pains.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_hypothyroid: {
    title: 'Information: low thyroid (hypothyroidism) in pregnancy',
    clauses: [
      opening('my thyroid gland is working less than normal (hypothyroidism) in this pregnancy.'),
      "The thyroid gland makes a hormone that my body needs, and that the baby needs for its brain to develop, especially in early pregnancy. Hypothyroidism is treated with thyroxine tablets; the dose often has to be increased in pregnancy.",
      'If it is not well controlled, the possible risks to me have been explained: miscarriage, anaemia, high blood pressure and pre-eclampsia, separation of the placenta, heavy bleeding after delivery, tiredness and weight gain.',
      "If it is not well controlled, the possible risks to the baby have been explained: early (premature) birth, low birth weight, effects on the baby's brain development and, rarely, death of the baby in the womb. With regular treatment these risks become much lower.",
      "The care needed has been explained: the thyroxine tablet every day on an empty stomach, 30 to 60 minutes before breakfast, at least 4 hours apart from iron and calcium tablets; a TSH blood test every 4 to 6 weeks and a change of dose when advised; a thyroid test for the baby after birth; and follow-up after delivery.",
      'I must not stop or change the tablet on my own. I must come to the hospital at once if I have bleeding, leaking of water, pain in the abdomen or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_oligohydramnios: {
    title: 'Information: less water around the baby (oligohydramnios)',
    clauses: [
      opening('the scan shows less water (amniotic fluid) around the baby than normal (oligohydramnios).'),
      "The water around the baby protects it and helps its lungs and limbs develop. It may be less because of leaking of water, a problem with the placenta, poor growth of the baby, high blood pressure, going past the due date, some medicines or a problem with the baby's kidneys; sometimes no cause is found.",
      'The possible risks to me have been explained: a greater chance of induction of labour, early delivery and caesarean section. The cause (for example high blood pressure or leaking) may have risks of its own.',
      "The possible risks to the baby have been explained: pressure on the cord with lack of oxygen and changes in the baby's heart rate during labour, poor growth, passing stool (meconium) in the womb, early (premature) birth, problems with the lungs or limbs when the water is very low early in pregnancy, admission to the newborn unit and, rarely, death of the baby in the womb.",
      "The care needed has been explained: repeat scans of the water and the baby's growth (with Doppler), checks of the baby's heart (NST / CTG), drinking enough water as advised, treatment of the cause, admission if needed, and delivery – which may have to be early, or by caesarean section – depending on the baby's condition.",
      'I must come to the hospital at once if the baby moves less, or if I have leaking of water, bleeding, pain or tightening of the abdomen, or fever.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_anaemia: {
    title: 'Information: anaemia (low haemoglobin) in pregnancy',
    clauses: [
      opening('I have anaemia (low haemoglobin in the blood) in this pregnancy.'),
      'Haemoglobin carries oxygen to my body and to the baby. In pregnancy, haemoglobin below 11 g/dL is anaemia and below 7 g/dL is severe anaemia. The commonest cause is lack of iron; others are lack of folic acid or vitamin B12, worms, infections, and blood disorders such as thalassaemia or sickle cell disease.',
      'The possible risks to me have been explained: tiredness, breathlessness, infections, heart failure when anaemia is severe, and danger from bleeding at delivery – even a normal blood loss can become dangerous – the need for blood transfusion and, in severe anaemia, risk to life.',
      'The possible risks to the baby have been explained: poor growth and low birth weight, early (premature) birth, low iron stores in the baby and, rarely, death of the baby in the womb.',
      'The care needed has been explained: iron and folic acid tablets, or iron by injection or drip, as advised; food rich in iron (green leafy vegetables, pulses, jaggery, dates, and eggs or meat if eaten) with fruit containing vitamin C; tablets for worms if advised; repeat blood tests; and blood transfusion if the anaemia is severe or delivery is near, with its own consent.',
      'I must come to the hospital at once if I have breathlessness at rest, chest pain, fainting, a fast heartbeat, swelling of the body, bleeding or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_fgr: {
    title: 'Information: baby not growing well (fetal growth restriction)',
    clauses: [
      opening('the baby is smaller than expected for the weeks of pregnancy and may not be growing well (fetal growth restriction, FGR / IUGR).'),
      'Most often this is because the placenta is not giving the baby enough nourishment and oxygen. It can be linked with high blood pressure, anaemia, tobacco or smoking, infections, twins or a problem in the baby; sometimes the baby is simply small.',
      'The possible risks to me have been explained: a greater chance of induction of labour, early delivery and caesarean section. The cause (for example high blood pressure) may have risks of its own.',
      'The possible risks to the baby have been explained: lack of oxygen before or during labour, early (premature) birth and its problems, low blood sugar, low body temperature and infections after birth, admission to the newborn unit, problems with development later and, rarely, death of the baby in the womb.',
      "The care needed has been explained: repeat growth scans with Doppler, checks of the baby's heart, rest and good food, treatment of the cause, steroid injections to help the baby's lungs if early delivery is likely, and delivery at the safest time – which may be early, or by caesarean section.",
      'I must come to the hospital at once if the baby moves less, or if I have bleeding, leaking of water, pain in the abdomen, severe headache or blurred vision.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_placenta_praevia: {
    title: 'Information: low-lying placenta (placenta praevia)',
    clauses: [
      opening('the placenta (afterbirth) is lying low in the womb, near or over its mouth (low-lying placenta / placenta praevia).'),
      "In many women the placenta moves up as the womb grows; a repeat scan will check this. If it stays low, it can block the baby's way out and a normal delivery may not be possible. After a previous caesarean the placenta may also grow deep into the scar (placenta accreta), which makes bleeding more likely.",
      'The possible risks to me have been explained: sudden heavy bleeding from the vagina before or during delivery, which may need emergency admission, blood transfusion and an emergency caesarean section; heavy bleeding during and after the operation; rarely, removal of the womb (hysterectomy) to stop the bleeding, injury to the bladder, intensive care and risk to life.',
      'The possible risks to the baby have been explained: early (premature) birth if bleeding makes early delivery necessary, with admission to the newborn unit, and lack of oxygen if I bleed heavily.',
      'The care needed has been explained: a repeat scan of the position of the placenta; no internal (vaginal) examination; no intercourse and no heavy work; my blood group checked and blood arranged; admission if there is bleeding; and a planned caesarean section, in a hospital with a blood bank, if the placenta stays low.',
      'I must come to the hospital at once for any bleeding from the vagina, even if it is small or painless, and for labour pains or less movement of the baby. Transport to the hospital should be arranged in advance.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_rh_negative: {
    title: 'Information: Rh-negative blood group in pregnancy',
    clauses: [
      opening('my blood group is Rh negative.'),
      "If the baby's father is Rh positive, the baby may be Rh positive. If the baby's blood enters my blood (at delivery, abortion, bleeding, an injury to the abdomen or some procedures), my body may make antibodies. These usually do not harm this baby, but they can harm a baby in a later pregnancy.",
      'It has been explained to me that once these antibodies are made they stay, and every later pregnancy becomes a high-risk pregnancy.',
      "The possible risks to the baby (mostly in a later pregnancy) have been explained: breakdown of the baby's red blood cells causing anaemia and jaundice, swelling of the baby (hydrops), the need for blood transfusions before or after birth and, rarely, death of the baby.",
      "The care needed has been explained: my husband's blood group; an antibody test (indirect Coombs test) during pregnancy; the anti-D injection at about 28 weeks if advised, within 72 hours after delivery if the baby is Rh positive, and after any bleeding, abortion, injury to the abdomen or procedure; and the baby's blood group after birth.",
      'I must tell the doctors that I am Rh negative in every future pregnancy, bleeding or abortion, and keep the record of my anti-D injections. I must come to the hospital at once if I have bleeding, an injury to the abdomen or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_twins: {
    title: 'Information: twin pregnancy',
    clauses: [
      opening('I am carrying twins (two babies).'),
      'A twin pregnancy has higher risks than a pregnancy with one baby, and the risks are greater when the twins share one placenta.',
      'The possible risks to me have been explained: severe vomiting, anaemia, high blood pressure and pre-eclampsia, diabetes, too much water around the babies, early labour, a greater chance of caesarean section, heavy bleeding after delivery and the need for blood transfusion.',
      'The possible risks to the babies have been explained: early (premature) birth and its problems, poor growth of one or both babies, problems when the twins share a placenta (twin-to-twin transfusion), birth defects, admission to the newborn unit and, rarely, death of one or both babies.',
      "The care needed has been explained: more frequent check-ups and scans; iron, folic acid and calcium; extra rest and food; steroid injections for the babies' lungs if early delivery is likely; a planned delivery, usually before 38 weeks (earlier when the twins share a placenta); and a normal delivery or a caesarean section depending on the babies' positions.",
      'I must come to the hospital at once if I have pains or tightening of the abdomen, leaking of water, bleeding, less movement of the babies, severe headache, blurred vision or sudden swelling.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_breech: {
    title: 'Information: baby not head-down (breech or transverse lie)',
    clauses: [
      opening('the baby is not lying head-down: it is lying bottom or feet first (breech), or across the womb (transverse lie).'),
      'Many babies turn head-down by themselves before 36 weeks. If the baby stays breech, the choices are: turning the baby from outside the abdomen (external cephalic version) where it is available, a planned caesarean section or, for selected women, a vaginal breech delivery. A baby lying across the womb cannot be born normally.',
      'The possible risks to me have been explained: the risks of a caesarean section, and an emergency operation if labour starts with the baby lying across or the cord comes down.',
      "The possible risks to the baby have been explained: the cord coming down before the baby (cord prolapse), difficulty in delivering the head in a vaginal breech birth, lack of oxygen, injury during birth and, rarely, death of the baby.",
      'The care needed has been explained: a scan to confirm the position and check the baby and the placenta, and a discussion of the choices and their risks. The way of delivery that is chosen will have its own consent.',
      'I must come to the hospital at once if my water breaks (leaking), if I have labour pains or bleeding, if I feel something coming down in the vagina, or if the baby moves less.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_preterm: {
    title: 'Information: early labour or leaking of water (preterm labour / PROM)',
    clauses: [
      opening('I have signs of early (preterm) labour and/or leaking of water (rupture of the membranes) before the due time.'),
      'Labour before 37 weeks is preterm labour. Leaking of water before labour starts is premature rupture of the membranes (PROM). The causes include infection, twins, too much water, a weak mouth of the womb, bleeding and high blood pressure; often no cause is found.',
      'The possible risks to me have been explained: infection of the womb and of the blood, separation of the placenta, a greater chance of caesarean section and the side effects of the medicines used.',
      'The possible risks to the baby have been explained: early (premature) birth – the earlier the birth, the greater the risk – with breathing problems, infection, jaundice, feeding and temperature problems, bleeding in the brain, a long stay in the newborn intensive care unit (which may mean transfer to another hospital), problems with development later and, rarely, death of the baby; and, after leaking, the cord coming down and infection.',
      "The care needed has been explained: admission and rest, checks for infection, antibiotics, steroid injections to help the baby's lungs, magnesium sulphate to protect the baby's brain when the birth is very early, medicines to delay labour for a short time where suitable, and delivery when continuing the pregnancy becomes more dangerous than delivery.",
      'I must tell the staff at once if I have fever, a foul-smelling discharge, more pains, bleeding or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_cholestasis: {
    title: 'Information: itching due to the liver in pregnancy (obstetric cholestasis / ICP)',
    clauses: [
      opening('I have obstetric cholestasis (intrahepatic cholestasis of pregnancy, ICP), a liver condition of pregnancy.'),
      'In this condition the flow of bile in the liver slows down, and bile acids build up in the blood. It causes itching, mostly of the palms and soles and worse at night, without a rash. It is found by blood tests (bile acids and liver function tests). It usually goes away within a few weeks after delivery.',
      'The possible risks to me have been explained: troublesome itching and loss of sleep, rarely jaundice and problems with blood clotting (a lack of vitamin K) with a risk of bleeding, and a high chance of the condition coming back in a later pregnancy or with hormonal (birth control) pills.',
      'The possible risks to the baby have been explained: early (premature) birth, passing stool (meconium) in the womb, breathing problems after birth, admission to the newborn unit and, rarely, sudden death of the baby in the womb – the risk is higher when the bile acids are very high. This cannot always be predicted by the tests done on the baby.',
      "The care needed has been explained: repeat blood tests (bile acids and liver function tests) as advised; medicines for the itching (such as ursodeoxycholic acid) and creams; checks of the baby's movements and heart; vitamin K if advised; a planned delivery, which may be advised early (often from about 35 to 38 weeks, depending on the bile acids) by induction of labour or caesarean section; and liver tests after delivery.",
      'I must come to the hospital at once if the baby moves less, if the itching becomes much worse, if my eyes or skin turn yellow, my urine turns dark or my stools turn pale, or if I have bleeding, leaking of water or labour pains.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_bad_obstetric_history: {
    title: 'Information: problems in earlier pregnancies (bad obstetric history)',
    clauses: [
      opening('I have had problems in my earlier pregnancies (bad obstetric history): {condition}.'),
      'It has been explained to me that some of these problems can happen again in this pregnancy, and that in many women the next pregnancy goes well with closer care. Tests may be advised to look for a cause, such as blood sugar, thyroid, blood group antibodies, antiphospholipid antibodies, infections and blood clotting tests, and sometimes tests of my husband.',
      'The possible risks to me have been explained: the earlier problem happening again – for example miscarriage, early labour, high blood pressure and pre-eclampsia, diabetes, heavy bleeding or a difficult delivery – a greater chance of caesarean section, and the side effects of any medicines or injections advised.',
      'The possible risks to the baby have been explained, depending on what happened before: miscarriage, early (premature) birth, poor growth, birth defects, admission to the newborn unit and, rarely, death of the baby in the womb or after birth.',
      'The care needed has been explained: early registration and more frequent check-ups; scans at the advised times (dating, NT, anomaly and growth scans with Doppler); the tests for a cause; medicines only as advised (for example aspirin, progesterone or heparin injections); and a planned time, way and place of delivery, in a hospital with a newborn unit where needed.',
      'I must come to the hospital at once if I have bleeding, pain or tightening of the abdomen, leaking of water, less movement of the baby, severe headache, blurred vision or sudden swelling, or if I feel that something is wrong.',
      FOLLOW,
      CLOSING,
    ],
  },

  // ---------- Early pregnancy ----------

  info_hyperemesis: {
    title: 'Information: severe vomiting in pregnancy (hyperemesis gravidarum)',
    clauses: [
      opening('I have severe nausea and vomiting in this pregnancy (hyperemesis gravidarum).'),
      'Nausea and vomiting are common in early pregnancy. When they are severe – unable to keep food or water down, losing weight, or becoming dry (dehydrated) – it is called hyperemesis gravidarum. It usually gets better by 16 to 20 weeks, but in some women it lasts longer. Twins and a molar pregnancy can be causes, and a scan may be done to check.',
      'The possible risks to me have been explained: dehydration, weakness and weight loss, salt and mineral imbalance, lack of vitamins (including vitamin B1, which can rarely affect the brain), blood clots in the legs, and low mood or anxiety.',
      'The possible risks to the baby have been explained: when the vomiting is severe and lasts long, the baby may be small at birth. With treatment, most babies are not harmed.',
      'The care needed has been explained: small frequent meals and fluids; medicines to stop vomiting, which are considered safe in pregnancy; admission for drip fluids, vitamins and blood tests when needed; injections to prevent blood clots if advised; and support for my mood.',
      'I must come to the hospital at once if I cannot keep any fluids down for 24 hours, pass very little or dark urine, feel faint or confused, vomit blood, or have pain in the abdomen, fever or bleeding.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_threatened_miscarriage: {
    title: 'Information: bleeding in early pregnancy (threatened miscarriage)',
    clauses: [
      opening('I have bleeding from the vagina in early pregnancy (threatened miscarriage), and the pregnancy is still continuing.'),
      'Bleeding in the first months of pregnancy is common. In many women the pregnancy continues normally, but in some it ends in a miscarriage. A scan and blood tests help to find out how the pregnancy is going; sometimes they have to be repeated before the answer is clear.',
      'The possible risks to me have been explained: the bleeding increasing, a miscarriage (which may need medicines or a procedure, with its own consent), heavy bleeding needing admission and, rarely, a pregnancy outside the womb (ectopic pregnancy) that was not seen at first.',
      'The possible risks to the pregnancy have been explained: miscarriage, which usually happens because of a problem in the pregnancy itself and is not caused by anything I did. If the pregnancy continues, the risks of early labour and of problems with the placenta may be a little higher.',
      'The care needed has been explained: rest as advised, no intercourse while bleeding, a repeat scan and blood tests when advised, medicines such as progesterone only if advised, and anti-D injection if my blood group is Rh negative.',
      'I must come to the hospital at once if the bleeding becomes heavy (soaking a pad in an hour) or I pass clots or tissue, or if I have severe pain in the abdomen or shoulder, fainting, or fever or foul-smelling discharge.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_miscarriage: {
    title: 'Information: miscarriage',
    clauses: [
      opening('the pregnancy has ended, or will not continue (miscarriage – missed, incomplete or complete).'),
      'A miscarriage is the loss of a pregnancy before 20 weeks. Most happen because the pregnancy did not develop normally, and are not caused by work, travel, food or anything I did. One miscarriage usually does not mean that the next pregnancy will also end in a miscarriage.',
      'The choices for treatment have been explained: waiting for the pregnancy to pass by itself, medicines (tablets) to help it pass, or a procedure to empty the womb – each with its own consent. The possible risks to me have been explained: heavy bleeding that may need a blood transfusion or a procedure, infection, tissue left behind needing further treatment and, with a procedure, rarely injury to the womb.',
      'It has been explained to me that the tissue may be sent for testing, that an Rh-negative woman needs an anti-D injection, and that the next period usually comes in 4 to 6 weeks.',
      'The care needed has been explained: a follow-up visit or pregnancy test as advised; tests to look for a cause after repeated miscarriages; folic acid before the next pregnancy; family planning advice; and support for grief and low mood, which are common.',
      'I must come to the hospital at once if I have heavy bleeding (soaking a pad in an hour), large clots, severe pain, fainting, fever, or foul-smelling discharge.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_ectopic: {
    title: 'Information: suspected pregnancy outside the womb (ectopic pregnancy)',
    clauses: [
      opening('a pregnancy outside the womb (ectopic pregnancy) is suspected or has been found, usually in the tube.'),
      'A pregnancy outside the womb cannot grow into a baby and cannot be moved into the womb. As it grows it can burst the tube and cause serious bleeding inside the abdomen. Sometimes the place of the pregnancy is not clear at first, and repeat blood tests (beta hCG) and scans are needed.',
      'The possible risks to me have been explained: sudden bleeding inside the abdomen, which is an emergency and may need blood transfusion and an emergency operation, loss of the tube, and, rarely, risk to life. It may affect future fertility, and a later pregnancy has a higher chance of being ectopic again.',
      'The choices for treatment have been explained, depending on my condition: careful watching with repeat blood tests, an injection (methotrexate), or an operation (laparoscopy or open) to remove the pregnancy, with or without the tube – each with its own consent.',
      'The care needed has been explained: staying in or near the hospital as advised, repeat blood tests until the hormone is negative, no intercourse and no heavy work, no pregnancy for the advised time after methotrexate, anti-D injection if Rh negative, and an early scan in a future pregnancy.',
      'I must come to the hospital at once if I have pain in the abdomen or shoulder tip, bleeding, dizziness or fainting, a fast heartbeat, or feel unwell in any way.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_molar: {
    title: 'Information: molar pregnancy (hydatidiform mole)',
    clauses: [
      opening('I have a molar pregnancy (hydatidiform mole).'),
      'In a molar pregnancy the placenta grows abnormally and a normal baby does not develop. It needs to be removed from the womb, usually by suction evacuation, with its own consent. The tissue is sent for testing.',
      'The possible risks to me have been explained: heavy bleeding needing blood transfusion, infection, injury to the womb during the procedure, and, in a few women, abnormal tissue that remains or grows again (gestational trophoblastic disease), which may need medicines (chemotherapy) and is almost always curable when found early.',
      'It has been explained to me that this is not caused by anything I did, and that a future pregnancy usually goes well.',
      'The care needed has been explained: regular blood or urine tests of the pregnancy hormone (beta hCG) until it is normal, and for the advised time after that; reliable family planning and no new pregnancy until the doctor advises; anti-D injection if Rh negative; and an early scan in the next pregnancy.',
      'I must come to the hospital at once if I have heavy bleeding, pain in the abdomen, breathlessness, cough with blood, or fever, and I must not miss the hormone tests.',
      FOLLOW,
      CLOSING,
    ],
  },

  // ---------- Later pregnancy ----------

  info_polyhydramnios: {
    title: 'Information: too much water around the baby (polyhydramnios)',
    clauses: [
      opening('the scan shows more water (amniotic fluid) around the baby than normal (polyhydramnios).'),
      "Often no cause is found. It can be linked with diabetes, twins, infection, or a problem in the baby (for example with swallowing or the bowel). Tests for sugar and infection and a detailed scan of the baby may be advised.",
      'The possible risks to me have been explained: discomfort and breathlessness, early labour, leaking of water, separation of the placenta, the baby lying in an abnormal position, heavy bleeding after delivery and a greater chance of caesarean section.',
      "The possible risks to the baby have been explained: early (premature) birth, the cord coming down when the water breaks (cord prolapse), problems linked with the cause, admission to the newborn unit and, rarely, death of the baby.",
      "The care needed has been explained: tests for the cause, repeat scans, control of sugar if I have diabetes, admission if I am very uncomfortable or breathless, sometimes removal of some fluid, and delivery in a hospital with a newborn unit; the baby will be checked after birth.",
      'I must come to the hospital at once if my water breaks (lying down if possible), if I have pains, bleeding, breathlessness, or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_antepartum_haemorrhage: {
    title: 'Information: bleeding in later pregnancy (antepartum haemorrhage / abruption)',
    clauses: [
      opening('I have had bleeding from the vagina in the later part of this pregnancy (antepartum haemorrhage), for example because the placenta has partly separated (abruption) or is lying low.'),
      'Bleeding after 20 weeks is always taken seriously. The bleeding seen outside may be less than the bleeding inside. Its cause is looked for with an examination (an internal examination only after a scan has excluded a low-lying placenta), a scan and blood tests.',
      'The possible risks to me have been explained: heavy bleeding with shock, the need for blood transfusion, problems with blood clotting, an emergency caesarean section, heavy bleeding after delivery, rarely removal of the womb (hysterectomy), kidney damage, intensive care and risk to life.',
      "The possible risks to the baby have been explained: lack of oxygen, early (premature) birth, poor growth, admission to the newborn unit and death of the baby in the womb, which can happen quickly when the placenta separates.",
      "The care needed has been explained: admission, a drip and blood tests, blood kept ready, checks of the baby's heart, steroid injections for the baby's lungs if early delivery is likely, anti-D if Rh negative, and delivery – which may have to be urgent, by induction or caesarean section – when it is safer for me or the baby.",
      'I must tell the staff at once, or come to the hospital at once, if I have any new bleeding, pain or a hard abdomen, less movement of the baby, dizziness or fainting.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_short_cervix: {
    title: 'Information: short or weak mouth of the womb (short cervix / cervical insufficiency)',
    clauses: [
      opening('the mouth of my womb (cervix) is short or weak (short cervix / cervical insufficiency).'),
      'A short or weak cervix can open too early, without pain, and lead to miscarriage in the middle of pregnancy or early labour. It is found by a scan of the cervix or because of what happened in an earlier pregnancy.',
      'The possible risks to me have been explained: late miscarriage or early labour, leaking of water and infection. If a stitch (cervical cerclage) is advised, it has its own consent and risks, such as bleeding, infection, leaking of water and the stitch having to be removed early.',
      'The possible risks to the baby have been explained: birth too early, when the baby may not survive or may have the problems of prematurity, and admission to the newborn intensive care unit.',
      'The care needed has been explained: repeat scans of the cervix, vaginal progesterone if advised, a stitch in the cervix if advised (usually removed at about 36 to 37 weeks), avoiding heavy work and intercourse as advised, and steroid injections for the baby if early birth is likely.',
      'I must come to the hospital at once if I have watery discharge or leaking, bleeding, pressure low in the vagina, back pain or tightening of the abdomen, or fever.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_reduced_movements: {
    title: "Information: baby's movements are less (reduced fetal movements)",
    clauses: [
      opening("I have noticed that the baby's movements are less than usual, or have stopped (reduced fetal movements)."),
      "A baby's movements are a sign that it is well. Babies do not move less towards the end of pregnancy. Fewer movements can be a warning sign that the baby is not getting enough oxygen or nourishment, and should always be checked the same day.",
      'The possible risks have been explained: most women with fewer movements have a healthy baby, but it can be a sign of a problem with the placenta or the baby, and is sometimes followed by poor growth or, rarely, death of the baby in the womb.',
      "The checks needed have been explained: listening to the baby's heart, a CTG (NST) and, if advised, a scan of the baby's growth, water and blood flow (Doppler). Depending on the results, delivery may be advised, which may be early or by induction or caesarean section.",
      "It has been explained to me that I should know my own baby's usual pattern of movements and not wait until the next day, or count only kicks, if the movements are less.",
      "I must come to the hospital at once – the same day, at any time of day or night – if the baby's movements are less than usual again, or if I have bleeding, leaking of water or pain.",
      FOLLOW,
      CLOSING,
    ],
  },

  info_postdates: {
    title: 'Information: pregnancy going past the due date (prolonged pregnancy)',
    clauses: [
      opening('my pregnancy has reached or gone past the expected date of delivery (prolonged / post-dated pregnancy).'),
      'Many women deliver within two weeks of the due date. After 41 weeks the placenta may work less well, and the risks to the baby slowly increase.',
      'The possible risks to me have been explained: induction of labour, a longer labour, a big baby with a difficult delivery, tears, and a greater chance of caesarean section.',
      'The possible risks to the baby have been explained: less water around the baby, passing stool (meconium) in the womb and breathing it in, lack of oxygen in labour, a big baby with injury at birth and, rarely, death of the baby in the womb.',
      "The care needed has been explained: checks of the baby (CTG and a scan of the water) as advised, a membrane sweep if suitable, and induction of labour – usually offered between 41 and 42 weeks, or earlier if needed – with its own consent. If I choose to wait, closer checks of the baby are needed.",
      'I must come to the hospital at once if the baby moves less, or if I have leaking of water, bleeding, regular pains, severe headache or blurred vision.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_iufd: {
    title: 'Information: death of the baby in the womb (intrauterine fetal death)',
    clauses: [
      opening("the baby's heart is not beating and the baby has died in the womb (intrauterine fetal death)."),
      'Sometimes a cause is found, such as high blood pressure, diabetes, a problem with the placenta or cord, infection or a problem in the baby; often no cause is found. Tests on me, and with our agreement on the baby and the placenta, may help to find a cause and to plan a future pregnancy.',
      'The choices for delivery have been explained: most women are advised to deliver vaginally, with medicines to start labour, either soon or after a short wait; a caesarean section is done only for specific reasons. Each will have its own consent.',
      'The possible risks to me have been explained: when the baby has died some time ago, problems with blood clotting and infection can develop, as well as heavy bleeding after delivery; the medicines used for induction have their own risks, and in women with a previous caesarean there is a risk of scar rupture.',
      'It has been explained to us that we may see and hold the baby if we wish, that the birth will be registered, and that we will be helped with arrangements for the baby. Medicines to stop breast milk can be given if wanted, and support for grief will be offered. A follow-up visit will discuss the results and a future pregnancy.',
      'I must tell the staff, or come to the hospital at once, if I have fever, heavy bleeding, severe pain, foul-smelling discharge or feel unwell, while waiting for delivery or after it.',
      CLOSING,
    ],
  },

  info_fetal_anomaly: {
    title: 'Information: a problem found in the baby on the scan or tests (fetal anomaly)',
    clauses: [
      opening('the scan or tests have found a problem in the baby: {condition}.'),
      'What is known about this problem, how certain the finding is, and what further tests (for example a detailed scan, fetal echo or tests of the baby\'s chromosomes) may help have been explained to me. Some findings become clearer only later in pregnancy or after birth.',
      'The possible effects on the baby have been explained: depending on the problem, the baby may be healthy, may need treatment or an operation after birth, may have long-term problems, or may not survive.',
      'The possible effects on me and on the pregnancy have been explained, including more check-ups and scans, the possibility of too much water, early labour, and the need to deliver in a hospital with a newborn intensive care unit or specialist surgeons.',
      'The choices available have been explained, as allowed by law, and a referral to a specialist (fetal medicine, paediatric surgeon or genetic counsellor) where needed. Any procedure will have its own consent. Nothing about the sex of the baby has been or will be disclosed (PC&PNDT Act).',
      'I must come to the hospital at once if I have bleeding, leaking of water, pains, or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_macrosomia: {
    title: 'Information: big baby (suspected macrosomia)',
    clauses: [
      opening('the baby is expected to be big for the weeks of pregnancy (suspected macrosomia, usually an expected weight of 4 kg or more).'),
      "A baby may be big because of diabetes, a big build in the family, a high weight of the mother or going past the due date. The weight estimated by scan can be wrong by 10 to 15 percent, in either direction.",
      'The possible risks to me have been explained: a long labour, an assisted (forceps or vacuum) delivery or caesarean section, tears of the vagina and perineum, and heavy bleeding after delivery.',
      "The possible risks to the baby have been explained: the shoulders getting stuck during birth (shoulder dystocia) with injury to the nerves of the arm or a broken collar bone, lack of oxygen, and low blood sugar after birth.",
      'The choices for delivery have been explained: waiting for labour, induction of labour, or a planned caesarean section when the baby is expected to be very big or I have diabetes – each with its own consent. Tests for diabetes may be advised.',
      'I must come to the hospital at once if the baby moves less, or if I have leaking of water, bleeding or labour pains.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_heart_disease: {
    title: 'Information: heart disease in pregnancy',
    clauses: [
      opening('I have heart disease (for example rheumatic heart disease, a valve problem or a heart defect from birth), which needs special care in pregnancy.'),
      'Pregnancy increases the work of the heart, especially from the middle of pregnancy, during labour and in the first days after delivery. The risk depends on the type of heart disease and how well my heart works; a heart specialist (cardiologist) will be involved.',
      'The possible risks to me have been explained: heart failure with fluid in the lungs, an irregular heartbeat, blood clots and stroke (especially with an artificial valve), infection of the heart valves, the need for admission or intensive care and, in some heart diseases, risk to life.',
      'The possible risks to the baby have been explained: poor growth, early (premature) birth, effects of some heart medicines (some are changed in pregnancy), and a higher chance of a heart defect in the baby when I have a heart defect from birth.',
      "The care needed has been explained: check-ups with the obstetrician and the cardiologist, heart tests (ECG, echo), medicines as advised – blood thinners only exactly as prescribed – rest and control of anaemia and infections, a planned delivery in a hospital with intensive care, usually a vaginal delivery with pain relief and a shorter second stage, and close watching after delivery.",
      'I must come to the hospital at once if I have breathlessness that is getting worse or comes on lying down, chest pain, palpitations, fainting, cough with frothy or blood-stained sputum, swelling of the legs, or fever.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_epilepsy: {
    title: 'Information: epilepsy (fits) in pregnancy',
    clauses: [
      opening('I have epilepsy (fits).'),
      "Most women with epilepsy have healthy babies. In pregnancy the fits may become more frequent, especially if tablets are missed or sleep is poor. Some anti-fit medicines (especially valproate) increase the risk of birth defects; the medicine and dose may be changed, but I must not stop it on my own.",
      'The possible risks to me have been explained: more fits, injury during a fit, and, rarely, sudden death in epilepsy, which is more likely when fits are not controlled. A fit in late pregnancy must also be checked for eclampsia.',
      "The possible risks to the baby have been explained: birth defects and effects on development linked with some medicines, injury or lack of oxygen during a fit, and poor growth.",
      'The care needed has been explained: taking the tablets every day as prescribed, high-dose folic acid, a detailed anomaly scan, review by a neurologist, enough sleep, not bathing alone or cooking at an open fire alone, vitamin K for the baby at birth, safe breastfeeding, and care when handling the baby (for example changing the baby on the floor).',
      'I or my relatives must bring me to the hospital at once if I have a fit, especially one lasting more than 5 minutes or fits one after another, or if I have headache, blurred vision, injury, or less movement of the baby.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_hepatitis_b: {
    title: 'Information: hepatitis B in pregnancy',
    clauses: [
      opening('my blood test for hepatitis B (HBsAg) is positive.'),
      'Hepatitis B is a virus infection of the liver. Many people with it have no symptoms. It can pass to the baby, mostly at birth, and to others through blood and sexual contact. Further blood tests (liver tests, viral load) and a review by a physician may be advised.',
      'The possible risks to me have been explained: long-term liver disease in some people, and rarely liver failure. Medicines against the virus may be advised in late pregnancy when the viral load is high.',
      'The possible risks to the baby have been explained: infection at birth, which in babies often becomes lifelong and can damage the liver later in life. Hepatitis B vaccine and hepatitis B immunoglobulin given to the baby soon after birth (within 12 hours) prevent most infections.',
      "The care needed has been explained: the baby's vaccine and immunoglobulin at birth and the full vaccine course, a blood test of the baby after the vaccines, breastfeeding is allowed, testing and vaccination of my husband and family members, safe disposal of blood-stained items, and not sharing razors or toothbrushes.",
      'It has been explained to me that this result is confidential and is shared only with the people involved in my care, and with relatives only with my agreement. I must tell the doctors who look after me in future, and come to the hospital at once if I have jaundice, dark urine, vomiting, confusion or bleeding.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_obesity: {
    title: 'Information: high body weight in pregnancy (BMI 30 or more)',
    clauses: [
      opening('my body mass index (BMI) is 30 or more, which increases some risks in pregnancy.'),
      'Most women with a high BMI have a healthy pregnancy and baby. Weight loss is not advised during pregnancy, but healthy eating and gentle activity help, and gaining only the advised amount of weight is important.',
      'The possible risks to me have been explained: diabetes, high blood pressure and pre-eclampsia, blood clots, a longer labour, a greater chance of caesarean section, difficulties with anaesthesia, wound infection, and heavy bleeding after delivery.',
      'The possible risks to the baby have been explained: birth defects (higher risk, and harder to see on scans), a big baby, and a higher risk of death of the baby in the womb.',
      'The care needed has been explained: folic acid (a higher dose may be advised), vitamin D, a sugar test (OGTT), checks of blood pressure, aspirin if advised, growth scans, a review by the anaesthetist before delivery, blood thinner injections if advised, and help with weight after delivery.',
      'I must come to the hospital at once if the baby moves less, or if I have severe headache, blurred vision, swelling, pain or swelling of a leg, breathlessness, bleeding, or leaking of water.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_older_mother: {
    title: 'Information: pregnancy at the age of 35 or more',
    clauses: [
      opening('being 35 years of age or older increases some risks in pregnancy.'),
      'Most women of this age have a healthy pregnancy and baby. The risks increase slowly with age, and more so after 40, and closer care helps to find problems early.',
      'The possible risks to me have been explained: miscarriage, twins, diabetes, high blood pressure and pre-eclampsia, a problem with the placenta, blood clots, induction of labour, and a greater chance of caesarean section.',
      'The possible risks to the baby have been explained: a higher chance of chromosome conditions such as Down syndrome, poor growth, early birth and, rarely, death of the baby in the womb, especially after the due date.',
      'The care needed has been explained: screening tests for chromosome conditions (with an NT scan) and an anomaly scan – further tests if a result is high-risk – a sugar test, checks of blood pressure, aspirin if advised, growth scans if advised, and delivery around the due date, as advised.',
      'I must come to the hospital at once if the baby moves less, or if I have bleeding, leaking of water, pains, severe headache, blurred vision or swelling.',
      FOLLOW,
      CLOSING,
    ],
  },

  // ---------- Labour ----------

  info_fetal_distress: {
    title: "Information: concern about the baby's condition in labour (fetal distress / meconium)",
    clauses: [
      opening("during labour there are signs that the baby may not be coping well (fetal distress), such as changes in the baby's heart rate on monitoring and/or stool (meconium) in the water."),
      "Changes in the baby's heart rate and meconium can be signs that the baby is short of oxygen, but they do not always mean that the baby is unwell. Close monitoring (CTG) is needed, and the doctors may need to act quickly.",
      "The steps that may be needed have been explained: changing my position, a drip, stopping the medicine that strengthens the pains, oxygen, and – if the signs continue – a quick delivery by forceps or vacuum or by an emergency caesarean section, each with its own consent where time allows.",
      'The possible risks to the baby have been explained: lack of oxygen, breathing in meconium, the need for help with breathing at birth, admission to the newborn unit, and, rarely, brain injury or death of the baby, even with quick delivery.',
      'The possible risks to me have been explained: the risks of an emergency operation or an assisted delivery, including bleeding, infection and tears.',
      'It has been explained that, in an emergency, the doctors may need to act before every question can be answered, and that they will explain fully afterwards.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_prolonged_labour: {
    title: 'Information: labour not progressing (prolonged or obstructed labour)',
    clauses: [
      opening('my labour is not progressing as expected (prolonged labour), or the baby is not coming down well.'),
      "This can happen because the pains are weak, the baby is big or in an awkward position, or the baby's head is large compared with the pelvis. The progress is checked by examinations and recorded on a chart (partograph).",
      'The possible risks to me have been explained: exhaustion, infection, injury to the bladder, heavy bleeding after delivery and, if labour is obstructed, rupture of the womb – especially after a previous caesarean.',
      'The possible risks to the baby have been explained: lack of oxygen, infection, injury during a difficult delivery and admission to the newborn unit.',
      'The steps that may be needed have been explained: breaking the waters, a drip with medicine to strengthen the pains (oxytocin), pain relief, a catheter, and – if progress is still poor or the baby is distressed – an assisted delivery or a caesarean section, each with its own consent.',
      'It has been explained that the doctors and nurses will keep checking me and the baby, and will explain any change in the plan.',
      FOLLOW,
      CLOSING,
    ],
  },

  // ---------- After delivery ----------

  info_pph: {
    title: 'Information: heavy bleeding after delivery (postpartum haemorrhage, PPH)',
    clauses: [
      opening('I had heavy bleeding after delivery (postpartum haemorrhage, PPH).'),
      'The usual causes are the womb not contracting well, tears, pieces of the placenta left behind, or a problem with blood clotting. It is treated quickly, step by step.',
      'The treatment that was given or may be needed has been explained: massage of the womb, medicines to contract it, a drip, blood transfusion, repair of tears, removal of retained placenta, a balloon in the womb and, if bleeding does not stop, an operation, which rarely may include removal of the womb (hysterectomy), with consent where time allows.',
      'The possible risks to me have been explained: shock, anaemia and weakness, blood transfusion and its risks, infection, kidney problems, intensive care and, rarely, risk to life; and a higher chance of PPH in a future delivery.',
      'The care needed has been explained: observation of bleeding, pulse and blood pressure, a blood test of haemoglobin, iron tablets or iron injection, rest and good food, and delivery in a hospital with a blood bank in a future pregnancy.',
      'I must tell the staff at once, or come to the hospital at once after going home, if I have bleeding that soaks a pad in an hour, large clots, dizziness or fainting, fast heartbeat, fever, or foul-smelling discharge.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_puerperal_sepsis: {
    title: 'Information: infection after delivery (puerperal sepsis)',
    clauses: [
      opening('I have an infection after delivery (puerperal infection / sepsis).'),
      'The infection may be in the womb, the stitches or caesarean wound, the urine, the breasts or the blood. Sepsis means that the infection is affecting the whole body; it can become serious quickly and needs urgent treatment.',
      'The possible risks to me have been explained: spread of the infection, a collection of pus, shock, effects on the kidneys, lungs and blood clotting, the need for an operation to drain pus or, rarely, to remove the womb, intensive care and risk to life.',
      'It has been explained to me whether breastfeeding can continue, and that the baby will be checked for infection and may need treatment.',
      'The care needed has been explained: blood and urine tests and cultures, antibiotics through a drip and then by mouth for the full course, fluids, pain relief, care of the wound, and close observation; a scan if needed.',
      'I must tell the staff at once, or come to the hospital at once after going home, if I have fever or shivering, fast breathing, confusion, severe pain, foul-smelling discharge, redness or discharge from the wound, or a painful red breast.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_perineal_tear: {
    title: 'Information: severe tear during delivery (third- or fourth-degree perineal tear)',
    clauses: [
      opening('during delivery I had a severe tear of the perineum that involved the muscle around the back passage (a third- or fourth-degree tear).'),
      'This kind of tear can happen even with good care, especially with a first baby, a big baby or an assisted delivery. It is repaired in the operation theatre with anaesthesia, with its own consent.',
      'The possible risks have been explained: pain, infection or breakdown of the repair, difficulty in controlling wind or stool, or urgency, which usually improves with time and exercises, and pain during intercourse.',
      'The care needed has been explained: antibiotics, pain relief, medicines to keep the stool soft, keeping the area clean, pelvic floor exercises, and a follow-up visit to check healing and control of stool.',
      'It has been explained that in a future pregnancy the way of delivery will be discussed, depending on how well I have recovered.',
      'I must come to the hospital at once if I have increasing pain, fever, foul-smelling discharge, opening of the stitches, or I cannot control stool or wind.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_postnatal_depression: {
    title: 'Information: low mood after delivery (postnatal depression)',
    clauses: [
      opening('I have symptoms of low mood or anxiety after delivery (postnatal depression).'),
      'Feeling tearful in the first days after delivery is common and passes quickly. When low mood, worry, loss of interest, poor sleep or feeling unable to cope last more than two weeks, it may be postnatal depression. It is common, it is an illness and not a weakness, and it can be treated.',
      'The possible risks have been explained: if not treated, it can last a long time, affect my health and my care of the baby and my bond with the baby, and, rarely, lead to thoughts of harming myself or the baby.',
      'The care needed has been explained: talking support and counselling, help from the family with the baby and rest, review by a psychiatrist where needed, and medicines if advised – many can be taken while breastfeeding.',
      'It has been explained that what I share is confidential, and that my relatives are informed with my agreement so that they can support me.',
      'I or my relatives must contact the hospital at once if I have thoughts of harming myself or the baby, hear or see things others do not, become very confused or agitated, or cannot sleep or eat at all.',
      FOLLOW,
      CLOSING,
    ],
  },

  info_condition: {
    title: 'Information about a condition or complication',
    clauses: [
      opening('I have the following condition or complication: {condition}.'),
      'What the condition is, and how it was found, have been explained to me.',
      'The possible risks and complications for me have been explained to me, including the serious ones.',
      'The possible effects on the pregnancy and on the baby, where this applies, have been explained to me.',
      'The tests, treatment and follow-up that are needed, and the possibility of admission or early delivery, have been explained to me.',
      'The warning signs for which I must come to the hospital at once have been explained to me.',
      FOLLOW,
      CLOSING,
    ],
  },

  // Fertility (idea F4, the owner's go-ahead of 27 Oct 2026) – DRAFT like every sheet here
  info_ovulation_induction: {
    title: "Information: ovulation induction with tablets and follicular monitoring",
    clauses: [
      opening("I am to have ovulation induction: tablets (letrozole or clomiphene) to help an egg grow and be released, with scans to follow it (follicular monitoring)."),
      "The tablets are taken for 5 days from day 2 to 5 of the period, as written on the prescription. Scans from about day 9 to 10 show how many eggs (follicles) are growing, how big they are, and the lining of the womb. An injection may be given to time the release of the egg, and the days for intercourse or IUI are then advised.",
      "Letrozole is used off-label for this purpose in India (it is approved for another use); this has been explained to me. Side effects such as hot flushes, headache, tiredness, mood changes or bloating can happen and usually pass. With clomiphene, blurred vision or spots before the eyes must be reported at once and the tablet stopped.",
      "The possible risks have been explained: more than one egg growing, with a chance of twins or more (the cycle may be cancelled and intercourse avoided if more than 2 follicles grow to 14 mm or more), ovarian cysts, rarely ovarian hyperstimulation (OHSS), and that a cycle may give no egg, or no pregnancy.",
      "The chance of pregnancy in each cycle, the number of cycles planned, and the next step if there is no pregnancy, have been explained to me. The treatment does not choose or reveal the sex of a baby.",
      "I must come to the hospital at once if I have severe pain or swelling of the abdomen, vomiting, breathlessness, passing very little urine, or heavy bleeding.",
      CLOSING,
    ],
  },
  info_iui: {
    title: "Information: intrauterine insemination (IUI)",
    clauses: [
      opening("I am to have intrauterine insemination (IUI): my husband's washed semen sample is placed inside the womb with a thin tube around the time of ovulation."),
      "IUI is usually done with tablets or injections to grow one or two eggs, scans to follow them, and an injection to time ovulation. The semen sample is collected on the day, washed and prepared in the laboratory, and the count after washing is recorded.",
      "The procedure takes a few minutes, needs no anaesthesia and is usually not painful; mild cramps or a little spotting can follow. I can go home the same day and carry on with normal work.",
      "The possible risks have been explained: twins or more when more than one egg grows (the cycle may be cancelled), ovarian hyperstimulation (OHSS) with injections, infection (rare), and that a cycle may not give a pregnancy.",
      "The chance of pregnancy in each cycle, the number of IUI cycles planned (usually 3 to 6), and the next step if there is no pregnancy, have been explained to me. Only my husband's sample is used unless donor sperm has been separately agreed and consented. The treatment does not choose or reveal the sex of a baby.",
      "A pregnancy test is done 14 days after the IUI if the period has not come. I must come to the hospital at once for severe pain, fever, heavy bleeding, vomiting or breathlessness.",
      CLOSING,
    ],
  },
  info_ivf_icsi: {
    title: "Information: IVF and ICSI (in vitro fertilisation)",
    clauses: [
      opening("IVF or ICSI may be the next step for us: eggs are collected from the ovaries, joined with sperm in the laboratory (ICSI: one sperm placed into each egg), and an embryo is placed into the womb."),
      "The steps have been explained: injections for about 10 to 12 days with scans and blood tests, an injection to mature the eggs, egg collection through the vagina under anaesthesia, fertilisation in the laboratory, transfer of an embryo after 3 to 5 days, and freezing of good extra embryos if we agree.",
      "Under the Assisted Reproductive Technology (Regulation) Act 2021, IVF is done only at a registered ART clinic, with written consent of both partners, after counselling; the number of embryos transferred is limited; and the sex of an embryo is never tested or chosen. This hospital refers couples to such a clinic.",
      "The possible risks have been explained: ovarian hyperstimulation (OHSS), bleeding or infection after egg collection, twins or more, ectopic pregnancy, miscarriage, and that a cycle may give no eggs, no embryos or no pregnancy.",
      "The chance of a baby depends mainly on the woman's age and the number and quality of eggs; the costs, the time needed and the emotional strain have been explained, and support is available.",
      CLOSING,
    ],
  },
  info_donor_gametes: {
    title: "Information: treatment with donor eggs or donor sperm",
    clauses: [
      opening("treatment with donor eggs or donor sperm has been suggested for us."),
      "Under the Assisted Reproductive Technology (Regulation) Act 2021, donor eggs and sperm come only through a registered ART bank; the donor stays anonymous to us and we stay anonymous to the donor; the donor is screened for infections and genetic conditions; and both partners give written consent after counselling.",
      "A child born from donated eggs or sperm is, in law, our child, with all the rights of a child born to us. The donor has no rights or duties towards the child.",
      "The possible risks have been explained: those of IUI or IVF, a small chance of an infection or a genetic condition despite screening, and that treatment may not lead to a pregnancy.",
      "We have been told about counselling for ourselves, now and later, including about what to tell the child, and that we may take time to decide.",
      CLOSING,
    ],
  },
  info_ohss: {
    title: "Information: ovarian hyperstimulation syndrome (OHSS)",
    clauses: [
      opening("I am at risk of, or have, ovarian hyperstimulation syndrome (OHSS), a reaction of the ovaries to fertility medicines."),
      "In OHSS the ovaries become large and fluid leaks into the abdomen and sometimes the chest. It usually starts within a few days of the injection that times ovulation, or early in a pregnancy, and most often settles by itself in 1 to 2 weeks.",
      "The possible risks have been explained: dehydration, kidney problems, blood clots in the legs or lungs, fluid in the chest with breathlessness, and rarely twisting of an ovary or risk to life.",
      "The care needed has been explained: drinking enough fluid, rest without lying still all day, paracetamol for pain (no anti-inflammatory painkillers), weighing myself and noting the urine passed, blood tests and scans, and admission to hospital if needed. The treatment cycle may be stopped or the embryos frozen to lower the risk.",
      "I must come to the hospital at once for severe pain or swelling of the abdomen, vomiting so that I cannot keep fluids down, breathlessness, passing very little urine, pain or swelling of a leg, or feeling faint.",
      CLOSING,
    ],
  },
  info_two_week_wait: {
    title: "Information: the two weeks before the pregnancy test",
    clauses: [
      opening("the treatment of this cycle is complete and a pregnancy test is due about 14 days after the IUI, the egg-release injection or the embryo transfer."),
      "Normal activity and work can go on; there is no need for bed rest. The medicines advised (for example progesterone) must be continued until the test unless the doctor says otherwise.",
      "Mild cramps, breast tenderness or a little spotting are common and do not tell whether the treatment has worked. A home test before the day advised can give a wrong answer.",
      "The test is done on the day advised, and the result is told to the hospital. If it is positive, an early scan is planned; if it is negative, the next step is discussed. Feeling anxious or low in these days is common, and we can talk to the team.",
      "I must come to the hospital at once for heavy bleeding, severe pain in the abdomen, pain in the shoulder tip, fainting, vomiting, breathlessness or swelling of the abdomen.",
      CLOSING,
    ],
  },
};
