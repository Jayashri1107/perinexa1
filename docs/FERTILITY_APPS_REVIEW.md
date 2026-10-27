# What the leading fertility and IVF applications offer – and what Perinexa could add

Written 24 Oct 2026 at the owner's request, after the fertility treatment plans were built (`docs/FERTILITY_PLAN.md`).
Nothing here is built: the feature pause holds until the developer's health check, and these are candidates for the
owner and the developer to choose from. Every product claim below is from the vendor's own pages or a buyer's guide
unless a trial or guideline is named; prices and rankings were not verified.

## 1. What was looked at

| Kind | Products read | Where used |
| --- | --- | --- |
| Fertility clinic record systems (EMR) | eIVF (Practice Highway, US), BabySentry (ver. 15, UK/EU), IDEAS (Mellowood Medical), MedITEX (CRITEX, Germany), Fertility Pro, Meditab FertilityEHR | Multi-site IVF networks and single clinics abroad |
| Indian fertility software | ARTis, Healcon IVF, MedART (Meddilink) | Indian IVF chains and clinics |
| Patient apps | Salve (clinic-branded app), Embie (IVF tracker; the app is closing, a clinic platform remains), the BabySentry and ARTis apps, Embraya, iConceive | Patients during a cycle |
| AI decision support | Alife Health (Embryo Predict – FDA-cleared; Stim Assist; Schedule Predict; Success Predictor), Fairtility CHLOE (EQ embryo, OQ oocyte – CE 2023, KPI), Vitrolife iDAScore | IVF laboratories |
| Counselling tools | SART Patient Predictor (US, from over 1 million cycles), the Aberdeen OPIS calculator (UK, HFEA data) | Chance of a live birth per cycle by age and diagnosis |
| Laboratory quality | Vienna consensus 2017 (12 KPIs, 5 performance and 2 reference indicators); IFS KPI newsletter 2025 | IVF laboratories |
| Witnessing | RI Witness (RFID), IMT Matcher (barcode), Gidget | Every hand-over of gametes and embryos |
| India's rules | ART (Regulation) Act 2021, Rules 2022, Regulations 2023; the National ART and Surrogacy Registry (Department of Health Research) | Registration, counselling, consent, donor limits, reporting of services and outcomes |

## 2. What the leading products have in common

**Clinical cycle work (every product)**
- A **stimulation or monitoring sheet** per cycle: day by day, the drug and dose, each follicle's size per ovary, the
  endometrial thickness and pattern, E2 / LH / progesterone, the trigger, the insemination or transfer, and the outcome
  (ARTis "dynamic calendar", Healcon, MedART "Smart Stimulation Sheet", Meditab "STIM sheet", BabySentry "Monitor").
- **Protocol templates** (agonist, antagonist, mild, natural, letrozole or clomiphene) with dose deviations logged and
  versioned (MedART, Healcon).
- **Semen analysis** reported against the WHO 6th-edition limits, often from a CASA analyser, with the post-wash count
  for IUI (BabySentry, MedART, ARTis).
- **Cycle outcome** recorded per cycle – beta hCG, clinical pregnancy, live birth – with success rates by age, AMH,
  protocol and diagnosis (Healcon, BabySentry KPIs, MedART benchmarking).
- A **couple record**: the partner's chart linked to hers, switched with one click (Meditab, MedART, the Blaze guide's
  checklist); donor and surrogate records linked where the clinic does third-party reproduction.

**IVF laboratory (the IVF systems)**
- Embryology records from oocyte to embryo: Day 0–7 grading (Gardner, Istanbul), fertilisation results, PGT, images;
  time-lapse incubator integration (EmbryoScope, Geri, MIRI).
- **Cryostorage inventory** down to tank and position, with consent status, renewal alerts and storage billing
  (BabySentry, MedART "MedCryo", CooperSurgical Embryo Options for automated storage billing).
- **Electronic witnessing**: RFID or barcode identity checks at every step, with a chain-of-custody log (RI Witness,
  IMT Matcher, Gidget; integrated by BabySentry and MedART).
- **Laboratory KPIs** against the Vienna consensus (fertilisation, cleavage, blastocyst, cryosurvival, implantation
  rates) on a dashboard (MedART, Fairtility CHLOE KPI, BabySentry QA).

**Patients**
- A **treatment calendar** with medication and injection reminders, injection videos and a medication library, the
  "two-week wait", results shared, encrypted messaging and video calls, education in the patient's language, a
  boarding-pass style check-in, satisfaction metrics (Salve, BabySentry app, Embie, ARTis WhatsApp alerts, MedART
  education videos in 90+ languages).
- **Counselling numbers**: the chance of a live birth per cycle and over three cycles from age, duration and diagnosis
  (SART predictor; Aberdeen OPIS – for example 46 % in the first complete cycle and 79 % over three for a 30-year-old
  with two years of unexplained infertility, on UK data).

**Operations, money and compliance**
- Cycle **packages** (IVF, IUI, ICSI, FET, add-ons), wallet advances, cancellation and refund schemes, fee-for-service
  by doctor role (ARTis, Healcon).
- **Cycle-aware scheduling** that clusters monitoring scans and predicts retrieval-day load (Alife Schedule Predict,
  MedART scheduler, BabySentry resource calendars); teleconsultation built in (BabySentry via Teams, Healcon video).
- **Registry exports** in the national formats – SART/NASS, HFEA PRISM, ANZARD, ESHRE (BabySentry, MedART). None of the
  Indian vendors' pages mentions the National ART and Surrogacy Registry or the ART Act by name; the registry portal
  asks clinics for their services and "the outcome of the services" on a regular basis without publishing a format.
- Consent management with digital signatures, validity and renewal tracking (Healcon, BabySentry, EngagedMD).

**AI (laboratories)**
- Embryo and oocyte scoring from time-lapse or still images (Alife Embryo Predict, Fairtility CHLOE, iDAScore);
  stimulation dose and trigger suggestions (Alife Stim Assist); success predictors for conversion; AI scribes and
  chatbots (MedART). The evidence is mixed: the 2024 Nature Medicine randomised trial of iDAScore found clinical
  pregnancy 46.5 % with AI against 48.2 % with standard morphology – no gain; most other validations are single-centre
  with surrogate outcomes. Indian launches in 2026 (Gaudium SiD / ERICA) have little independent validation.

## 3. What Perinexa already has for fertility care

Registration with the Infertility type of care (sensitive by default); the **fertility history** on the record;
the **DRAFT protocol library** (21 protocols from WHO 2025, NICE NG257 2026, ESHRE, the PCOS guideline 2023, FOGSI
and the ART Act), rule-based **suggestions** and the **Treatment plan** with the ladder (follicular study → IUI →
IVF/ICSI, procedures) and cycle counters; the **care plan** for the evaluation; visits with vital signs, diagnosis,
prescriptions and **prescription sets**; the **lab module** (orders, results with flags, report files, test packages);
**ultrasound reports** (a gynaecology template, Hadlock numbers – no follicular-monitoring template yet); bilingual
**consent and information forms** with doctor approval; **reminders** by SMS or WhatsApp with consent and a limited
**patient portal**; appointments, tokens and OPD timings; billing with a price list, pharmacy, referrals, analytics,
ABDM linking, the audit log and the copy of the whole record. Things the leaders do not all have: PC-PNDT protection
in every free text, need-to-know access with sensitive records, bilingual printed consents, ABHA linking.

## 4. Candidate features, in the order they would pay off

**Tier 1 – fits what exists; for an OBGY clinic that does ovulation induction and IUI and refers IVF out**

1. **Cycle (follicular study) sheet** on the Treatment plan: one sheet per cycle – day, drug and dose, follicles per
   ovary, endometrium, E2 / LH / P4, trigger (drug, time), timed intercourse or IUI (post-wash count), luteal support,
   cancelled with the reason (more than 2 follicles of 14 mm), outcome (beta hCG, clinical pregnancy). A printable
   **follicular study report** for the couple, in English with Marathi or Hindi. When a cycle ends, the plan's cycle
   counter rises by itself (today the doctor enters it when switching). Every product read has this; it is the daily
   work of OI and IUI.
2. **Semen analysis** as a lab test panel with the WHO 2021 lower reference limits as flags (volume 1.4 mL,
   16 million/mL, 39 million total, 42 % motile, 30 % progressive, 54 % vital, 4 % normal forms), the abstinence
   days, and the **post-wash total motile count** for IUI; a standard report; the result can set the record's semen
   field with the doctor's confirmation (as the ultrasound suggestions do).
3. **Counselling numbers** on the plan: a small card giving the chance of a live birth per cycle and over three
   cycles by her age band and step, from published tables (NICE NG257 figure 2 / HFEA; SART predictor bands), marked as
   population figures and not a prediction for her – printed on the plan copy.
4. **Fertility information sheets** (bilingual, in the existing information-forms library): ovulation induction with
   letrozole or clomiphene, follicular monitoring, IUI, IVF and ICSI, the ART Act's counselling points, donor gametes,
   OHSS warning signs, the two-week wait – signed as "informed" like the pregnancy sheets.
5. **Cycle reminders**: the plan's scan days, injection times and the pregnancy-test day as reminders through the
   existing consented SMS or WhatsApp channel, in her language; the "take" confirmation through the portal.
6. **Prescription sets for OI and IUI** (letrozole, clomiphene, hCG trigger, progesterone), approved by the doctor,
   checked by the medicine safety list – one tap from the cycle sheet.
7. **Next scan booking from the cycle sheet**: the follicle-tracking visit booked for cycle day X in the doctor's OPD
   slots (the appointment module exists), and a day view that shows the clinic's monitoring load.
8. **Fertility analytics tab**: cycles per step, pregnancies per cycle and per couple, time to pregnancy, how often
   couples switch steps and why, with the same role rules as the other tabs.

**Tier 2 – bigger pieces that need the owner's decision**

9. **Partner (male) record** linked to hers with his consent: his semen results, examination, hormones, genetics and
   urology notes; today the partner is not identified anywhere (a privacy choice). Decide whether a second record,
   or fields on hers, is right under the DPDP Act.
10. **Treatment packages and refund schemes** for IUI and IVF cycles in Billing (ARTis, Healcon): a package with its
    included scans and medicines, advances, and the refund when a cycle is cancelled. Owner's and accountant's call.
11. **ART Act consent forms** in the consent library: the consents the Rules prescribe for the commissioning couple,
    donors and the clinic's counselling record – after legal review, like the other DRAFT forms.
12. **Teleconsultation** for review visits (video from the record; results and plan shared on screen).
13. **A patient copy of the plan** – already an open decision in `docs/FERTILITY_PLAN.md`.
14. **Partner and donor screening checklist** (the ART Act's screening tests) with dates and validity.

**Tier 3 – only if the clinic runs or partners with an IVF laboratory**

15. Embryology lab records (oocytes, fertilisation, Day 0–7 grading, images, PGT), **cryostorage inventory** with
    consents, renewals and storage billing, **electronic witnessing** (RI Witness or Matcher integration), time-lapse
    incubator integration, **Vienna consensus KPIs**.
16. **Donor and surrogacy modules** under the ART Act and the Surrogacy Act (donor bank records, one donor to one
    couple, insurance, the registry's reporting), and **exports for the National ART and Surrogacy Registry** once its
    format is known.
17. **AI embryo or oocyte scoring and stimulation dose suggestions**: not recommended now – the randomised evidence
    shows no gain for embryo selection, and dose tools need the clinic's own outcome data; revisit when independent
    trials report.

## 5. Notes for the decision

- Items 1–8 reuse modules that exist (lab, ultrasound, consents, reminders, appointments, analytics, prescription sets)
  and keep Perinexa's rules: need-to-know access, sensitive records, PC-PNDT checks on free text, the audit log with
  ids only, DRAFT until the doctor approves.
- Items 9–11 touch privacy and money: the partner's data is personal data of another person; packages change
  billing and the Tally file; the ART Act forms need the lawyer.
- Tier 3 is a different product (an IVF laboratory system); the ART Act requires registration of the clinic and the
  bank before any of it is used for real.
- Across all of it: no sex selection anywhere (PC-PNDT Act; ART Act), and no real patient data before the go-live
  checklist in the handover plan.

## 6. Sources read (vendor pages unless named otherwise)

BabySentry ver. 15 feature page; ARTis (artisivf.com); Healcon IVF clinic management; MedART (meddilink.com);
Salve (salvehealth.com); Embie (embieapp.com); Alife Health (alifehealth.com); Fairtility CHLOE pages and press
releases (CE for CHLOE OQ, June 2023); Blaze "Fertility EHR: key features + 5 top platforms (2026)" (the author is one
of the five); Pulse "tech stack for a fertility clinic" and Capterra on eIVF; CooperSurgical Embryo Options; IMT
Matcher; the Vienna consensus 2017 and later KPI proposals; the SART Patient Predictor and the University of Aberdeen
OPIS calculator; Nature Medicine 2024 randomised trial of iDAScore (reported figures); India's National ART and
Surrogacy Registry portal (artsurrogacy.gov.in). eIVF's and IDEAS' own sites could not be reached from here.
