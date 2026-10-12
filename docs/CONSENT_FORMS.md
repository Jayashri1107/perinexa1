# Consent forms – what they are and what must be checked before use

Perinexa prints consent forms for patients **in English with Marathi or Hindi next to it, clause by clause**,
filled in with the patient's details. Each hospital gets its own copy of the **draft** forms, which its doctors
can edit, approve, stop using, or add to.

> ⚠️ The draft wording, including both translations, was prepared by the software developer (Claude) from common
> Indian hospital practice and published guidance. It has **not** been reviewed by a lawyer, and the translations
> have not been checked by native speakers. Until a doctor approves a form, every printed copy says
> **DRAFT – not approved by the hospital** at the top of every page.

## The draft forms

| Form | Listed for | Suggested for a patient when |
| --- | --- | --- |
| Consent for HIV test (with counselling) | Antenatal, gynaecology, infertility | the HIV test in her care plan is due |
| High-risk pregnancy: information and consent | Antenatal | her risk level is High (the reasons are filled in) |
| Consent for labour and vaginal delivery | Antenatal | from 37 weeks |
| Consent for induction of labour | Antenatal | from 40 weeks |
| Consent for vaginal birth after caesarean (trial of labour) | Antenatal | she had a caesarean before |
| Consent for caesarean section | Antenatal | she had a caesarean before |
| Consent for tubal ligation (permanent family planning) | Antenatal, postnatal, gynaecology | – (the doctor chooses) |
| General consent for admission and treatment | Every patient | – |
| Consent for an operation or procedure | Every patient | – (the doctor types the procedure and reason, or leaves lines to write in) |
| Consent for anaesthesia | Antenatal, postnatal, gynaecology, infertility | – |
| Consent for blood transfusion | Every patient | – |
| Refusal of advised treatment / leaving against medical advice | Every patient | – |
| Consent for newborn care and vaccination | Newborn | always (signed by a parent or guardian) |

Suggestions are only a help: the doctor decides which consents to take.

2 Oct 2026 – At the owner's request the ultrasound consent ("Consent and declaration for ultrasound in
pregnancy") was removed with the PC-PNDT and MTP registers. A hospital's stored copies (and copies made from them)
are kept but no longer listed, opened or printed; printouts already on patients are kept but hidden. The app still
never records or shows the baby's sex before birth.

## What the hospital must check before approving a form

1. **Legal review** of the English wording, e.g. the clauses on costs, valuables, the female chaperone, disposal
   of tissue, and "I will not hold the hospital responsible" in the refusal form.
2. **Translations** read by a fluent Marathi speaker and a fluent Hindi speaker, against the English, clause by
   clause (the points the translators flagged are listed below).
3. **Figures** a doctor should confirm: VBAC succeeds in about 3 in 4, scar rupture about 1 in 200 (RCOG
   Green-top Guideline 45); tubal ligation failure about 1 in 200.
4. **Statutory forms these do not replace:**
   - **Sterilisation:** where the Government of India "Standards for Female and Male Sterilization Services"
     (2014) consent form is required (e.g. government schemes), use that form.
   - **HIV testing:** compare with the hospital's NACO / ICTC consent formats.

Approving: open the form in **Consent forms**, read it in both languages (switch at the top of the wording),
then **Approve** and tick the confirmation. Any later change makes it a draft again.

## Points the translators asked a reviewer to look at

**Marathi**
- "मी, खाली सही करणार" ("I, the undersigned") could be read as "will sign"; "खाली सही करणारी व्यक्ती" is an alternative.
- "पालक" means both parent and guardian; "कायदेशीर पालक" may be clearer for guardian.
- Placenta is "वार (प्लॅसेंटा)"; perineal tears are "प्रसूतीच्या वेळी योनीमार्ग फाटणे" (may not cover the perineum).
- Short explanations added that the English doesn't have, e.g. स्थानिक भूल, फुगा असलेली नळी (balloon catheter),
  दिव्याखाली ठेवण्याचे उपचार (phototherapy).
- "वैद्यकशास्त्र हे अचूक शास्त्र नाही" ("medicine is not an exact science") may be too abstract for some patients.

**Hindi**
- The closing clause says "मैंने … हस्ताक्षर किए हैं" ("I have signed") to stay the same for any signer.
- Refusal form: "मैंने … ले जाने का निर्णय लिया है" and "ज़िम्मेदार नहीं ठहराया जाएगा" – confirm they are legally
  as strong as the English.
- Anaesthesia is "एनेस्थीसिया (बेहोशी या सुन्न करने की दवा)", as spinal and local anaesthesia don't cause unconsciousness.
- Placenta is "आँवल (प्लेसेंटा)" – the local word varies by region.
- Tissue "नष्ट किया जा सकता है" ("may be destroyed"); a lawyer may prefer "निपटान" (disposal).
- "रोगी" is used for the patient throughout; some hospitals prefer "मरीज़".

## How it works in the app

- **Consent forms** (left menu; doctors, RMOs and nurses): the library. Doctors edit (title and clauses in all
  three languages, who the form is for, when it is suggested), copy, approve, stop using, and add forms. Blanks such
  as `{patient}` are filled in when printing; every language must use the same blanks.
- Abortion (pregnancy loss, added 2 Oct 2026): the HIV test, anaesthesia and the forms for any type of care, and
  the information sheets on miscarriage, ectopic and molar pregnancy. No new form, and nothing suggested
  automatically. The threatened-miscarriage sheet is for antenatal and gynaecology care only (owner, 3 Oct 2026: a
  threatened miscarriage stays under Antenatal). Induced termination (MTP) is never recorded in Perinexa.
- **Patient record → Consent forms** (those who may see her medical details): the forms for her type of care,
  suggested ones first, and the forms printed so far. Her doctor or an RMO prints: choose English + Marathi,
  English + Hindi or English only, fill in or leave the procedure and reason, print your name or leave it blank,
  preview, print on A4.
- **Settings → Print letterhead** (hospital admin): which second language is offered first. After the first print,
  the patient's last language is offered.
- **What is recorded:** each printout (form, version, language, what was typed, who and when), shown on the
  patient's tab. The signed paper is the consent – recording signatures, witnesses and scanned copies comes with
  the full Consents feature. The audit log records "Consent form printed" with the record number only.

## Information forms (added 2 Oct 2026)

Separate from consent forms (38 sheets, early pregnancy to after delivery – list in `docs/PROGRESS.md`): the doctor
records that a condition or complication (PIH, GDM, low thyroid,
oligohydramnios, anaemia, obstetric cholestasis, bad obstetric history, FGR, low-lying placenta, Rh negative, twins, breech, preterm labour / PROM, or any other
typed in) was explained to the patient and her relatives, who sign that they were informed. Every sheet ends with
"This is not a consent for any operation or procedure". Wording: `server/src/consents/forms/info_en.js`
(Marathi `info_mr.js`, Hindi `info_hi.js`).

Before approving each sheet, the doctor should check: the figures and thresholds (BP 140/90, Hb 11 and 7 g/dL,
TSH testing every 4–6 weeks, anti-D at 28 weeks and within 72 hours, twins delivered before 38 weeks, cholestasis delivery from about 35–38 weeks by bile acids) against the
hospital's protocols; that the risks listed are complete enough without frightening; the warning signs; and the
Marathi and Hindi with fluent speakers (the translations use "मी … आले पाहिजे" / "मुझे … आना चाहिए", written for
the woman herself).

Points the translators asked a reviewer to check in the later 24 sheets (2 Oct 2026): long transliterated terms
(hyperemesis gravidarum, hydatidiform mole, gestational trophoblastic disease, puerperal sepsis) may be unfamiliar to
patients; the words used for "tear" (Hindi चीरा suggests a cut – फटना may be better), "confusion" (Hindi घबराहट leans
to anxiety), "count only kicks", "stroke" (लकवा vs दिमाग़ में रक्तस्राव – make it the same in every sheet), "as
allowed by law" in the fetal-anomaly sheet, and the grammatical gender of गरोदरपणा in Marathi. HIV is deliberately not
an information sheet (see `docs/PROGRESS.md`).
