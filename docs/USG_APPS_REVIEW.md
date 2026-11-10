# What the leading sonography (ultrasound reporting) applications offer – and what is missing from Perinexa

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, commit d84c05e1).** Sections 3 and 4
> describe the **other** copy's ultrasound module (`routes/usg.js`, `pages/usg/`). Perinexa1's module is **Scans /
> Sonography** (`server/src/routes/imaging.js`, `server/src/imaging/`, `client/src/pages/imaging/`, ideas 17–22 in
> `docs/IDEAS_FOR_LATER.md`) and already has several of the "missing" items:
> - **U9 follicle study**: a follicular template is in `server/src/imaging/templates.js` (with breast, abdomen and
>   X-ray templates the other copy lacks).
> - **U12 images**: up to 12 pictures per study, each with a choice to print it (`IMAGING_IMAGE_ADDED`); the
>   storage and PC-PNDT questions in item 12 still apply.
> - **U16 machine link**: built and merged 29 Oct 2026 (`docs/USG_MACHINE_PLAN.md`, `scanBridge`, `MachineStudy`).
> - **U8, partly**: scans ordered by reception or from the care plan and confirmed by a doctor or RMO (idea 18); the
>   scan on her bill and portal. Check the remaining links (plan item ticked on signing, voice entry) in the code.
> - **Role**: perinexa1 calls the sonography login `sonographer` (the other copy: `sonologist`).
> U1–U7, U10, U11 and U13–U15 are not in perinexa1 either. Nothing here is built; it waits for the health check.

Written 10 Nov 2026 at the owner's request ("the best features a sonography software has and what is missing from our
app"), after the ultrasound report module was built on 15 Oct 2026 (`docs/USG_PLAN.md`).
Nothing here is built: the feature pause holds until the developer's health check, and these are candidates for the
owner and the developer to choose from. Every product claim below is from the vendor's own pages unless a study,
guideline or news report is named; vendors' pages are advertising, and prices and rankings were not verified. A number
in square brackets points to the source list in section 8, which also says which pages could be read in full and which
only as a search summary.

## 1. What was looked at

| Kind | Products and documents read | Where used |
| --- | --- | --- |
| Obstetric and gynaecology ultrasound databases | astraia (NEXUS / ASTRAIA, Germany – the full 2026 brochure) [1]; ViewPoint 6 for Women's Health (GE HealthCare) [2]; AS Software (US, maternal-fetal medicine) [5]; Philips FetView (a press description only) [27] | Fetal-medicine units and hospitals abroad; astraia says it is installed in more than 70 countries |
| Reporting with AI checks | Sonio (France, bought by Samsung Medison in 2024): Sonio Pro reporting and Sonio Detect [3] | Clinics in the US and Europe |
| Image sharing in the cloud | Tricefy (Trice Imaging) [4] | Women's health clinics, mostly US |
| Indian sonography reporting software | Meeravio [6], Everrtech [7], AvimedTech [8], Drlogy [9], and the OneCity hospital system's note on PC-PNDT [10] | Indian sonography centres and hospitals |
| Free calculators that the products build on | The Fetal Medicine Foundation (FMF, London) [11]; Fetal Medicine Barcelona [12]; the IOTA group's ADNEX model as fitted on Esaote machines [13]; the INTERGROWTH-21st app [28] | Fetal-medicine and gynaecology scanning everywhere |
| Indian evidence on growth charts and Doppler | Fernandez Hospital, Hyderabad, with the Perinatal Institute: Hadlock against GROW-India in 67,808 births [14]; Safdarjung Hospital, Delhi: Hadlock against INTERGROWTH-21st [15]; the Journal of Fetal Medicine on report templates [16]; the IRIA's Samrakshan programme [17] | Which chart and which Doppler to report in India |
| Guidelines | ISUOG on twins (updated 2025) [18]; nuchal translucency quality audits (Ontario) [19] | What a report must contain; how scanning quality is checked |
| India's rules | PC-PNDT: the Delhi and Goa online Form F systems [20], the Supreme Court's judgment of June 2026 on Form F [21], record keeping [24]; AI and fetal sex in the news [22]; CDSCO's guidance on software as a medical device [23] | What a sonography program may and may not do in India |

A 2026 "top 10" list of obstetric reporting software [26] was read only for names: it earns commission from the
vendors and mostly lists general hospital systems.

## 2. What the leading products have in common

**The link to the ultrasound machine (every foreign product, and the better Indian ones)**
- The patient's name appears on the machine by itself (a "worklist"), and the **measurements, images, clips and 3D
  volumes come back from the machine** into the report without typing. astraia: "can receive images, videos, volumes,
  measurements and manage the Worklist for practically any modern US machine", with its own small image store and
  viewer [1]. ViewPoint: "automate the data flow from your ultrasound system" to the report and on to the hospital
  system [2]. Sonio Pro acts as the worklist and receives the machine's pictures [3]. Meeravio (India): worklist,
  images and measurements received, "with unit checks and plausibility guards" [6]. Everrtech (India): reporting
  built on the machine's structured measurement file [7].
- This link is not free of risk: in 2022 astraia had to issue a safety notice about a fault in the transfer of
  measurements used for risk calculation [25].

**Growth charts, graphs and the trend across scans (every obstetric product)**
- Each measurement is shown against a reference chart, as a **graph with this pregnancy's earlier scans on it**, and
  the graph is printed in the report. astraia holds "over 400 charts from peer-reviewed articles" and lets the centre
  choose the chart and the weight formula [1]; ViewPoint reports carry "images, measurements, and graphs" [2];
  Tricefy now has "reports synchronized with growth charts, percentiles and measurements" [4]; Meeravio has Hadlock
  formulas, centiles, "growth charts across visits, and Doppler indices" [6].
- Indian fetal-medicine specialists write that a growth scan report should plot the measurements on a standard growth
  chart, and a twin report must state the chorionicity [16].

**Doppler and risk calculation (the fetal-medicine products)**
- Doppler of the uterine, umbilical and middle cerebral arteries and the ductus venosus, each plotted on its normal
  range, with the cerebroplacental ratio (FMF and Barcelona calculators [11] [12]; astraia [1]).
- **First-trimester risk calculation**: astraia contains "the latest FMF risk algorithm (FMF 2018)" for trisomy 21,
  18 and 13, growth restriction and preterm delivery, and pre-eclampsia in all three trimesters; the blood results
  (PAPP-A, beta-hCG, PlGF, AFP) come from the laboratory analyser and are calibrated per analyser [1]. ViewPoint's
  older brochure also lists first-trimester FMF risk assessment [2]. The licence for the FMF calculation is given only
  by the FMF, and the person scanning needs FMF certification and a yearly audit [11].
- astraia is itself **certified as a medical device** (class IIa, and as a laboratory test device) [1].

**Scan types beyond the routine ones**
- Twins and higher multiples (Barcelona has separate growth and twin-to-twin transfusion calculators for monochorionic
  and dichorionic twins [12]; ISUOG's 2025 guideline lists what to report [18]); **fetal echo** and **fetal brain**
  modules with step-by-step screens and prompts for the next measurement (astraia [1], ViewPoint [2]); invasive
  procedures, NIPT and genetic results (astraia [1]).
- **Gynaecology**: structured description of the uterus, ovaries and adnexa; the **IOTA** rules and risk models for
  an ovarian mass and the RMI (astraia [1]; the ADNEX model on Esaote machines gives the chance of benign, borderline,
  stage I, stage II–IV and metastatic cancer from nine findings and the CA-125 [13]); **follicle tracking**, early
  pregnancy, procedures (astraia [1]).

**The report itself**
- Templates for every major scan, report text made from the entries, the centre's letterhead, images and charts in the
  report (all products). ViewPoint and Sonio mark **what is still missing before signing** – ViewPoint "highlights
  mandatory fields", Sonio shows a visual checklist of the views to be taken [2] [3].
- Languages: astraia switches between about 20 languages during the examination [1]; Drlogy offers forms in several
  languages [9]. No Indian product read names Marathi or Hindi patient reports.
- Typing by voice: Everrtech and AvimedTech list voice dictation [7] [8].

**Sharing**
- With referring doctors: reports "printed and shared with colleagues by e-mail, fax or internal network" (astraia
  [1]); by fax (Sonio [3]); a doctors' portal (Everrtech [7]); **e-mail and WhatsApp** (AvimedTech [8]).
- With patients: images, clips and reports to the patient's phone or a patient app (Tricefy [4], Sonio [3]); patient
  portals (Everrtech [7], Drlogy [9]).
- Work from anywhere in the clinic through a browser (ViewPoint WebConnect, AS Software, Sonio [2] [5] [3]).

**Quality figures**
- astraia has a built-in **audit** for the first-trimester and second-trimester scans "for a whole centre or for each
  individual sonographer", and a query tool for the centre's own questions and studies [1]. Screening programmes audit
  each operator's nuchal translucency measurements against the expected curve, because quality drifts without it [19].
  Sonio and AvimedTech show practice figures and daily summaries [3] [8].

**AI**
- **Sonio Detect** (cleared by the US FDA): finds which view an image shows, finds the structures in it and checks
  quality points such as the zoom; the company's own figure is over 90 % sensitivity for recognising views. It does
  **not** find abnormalities – its chief executive writes that this is expected in future [3].
- Meeravio (India) offers an optional AI that drafts the impression text, marked until the doctor edits it, with the
  data stripped of names first [6].

**PC-PNDT tools (the Indian products)**
- **Form F** prepared from what was already typed, with missing fields flagged; Meeravio fills the government portal's
  fields but "never logs in by itself … never presses Submit" – the doctor submits [6]. Drlogy tracks which forms are
  incomplete [9]. OneCity **blocks signing or printing** a pregnancy scan report until its Form F is complete, and
  keeps the machine's registration with a renewal reminder [10]. Delhi (March 2025) and Goa run government portals for
  online Form F [20].
- In June 2026 the Supreme Court held, in a case from Maharashtra, that gaps in Form F cannot be brushed aside as
  technical errors at the start of a prosecution [21].

## 3. What Perinexa already has for ultrasound

Confirmed in the code on 10 Nov 2026 (`server/src/routes/usg.js`, `server/src/usg/`, `client/src/pages/usg/`):

- **Five DRAFT templates**: early pregnancy (viability), dating and NT, anomaly, growth (with fluid and two Doppler
  boxes), gynaecology (pelvis). A report is started from the patient's record; the **Scans** menu lists the reports to
  finish and those signed in the last seven days.
- **Worked out by the app**: weeks from the CRL, the sac or the four measurements, the estimated weight and **its
  centile** (Hadlock – the owner's choice of 15 Oct 2026), with the formulas' sources named on the screen and
  automatic tests of the arithmetic.
- **The findings written from the measurements**, every word changeable before signing.
- **Suggestions from written rules, never from AI**, each with its reason and **Add** or **Ignore**: pregnancy of
  unknown location, the two failure criteria, increased NT, nasal bone, low placenta, short cervix, too little or too
  much liquor, small or large for dates, breech at 36 weeks, a new EDD from the scan. Nothing reaches her record
  without a click, a report cannot be signed until every suggestion is answered, and a sonologist's Add that would
  change the record **waits for the patient's own doctor**.
- **Signing** locks the report; a correction is an **addendum**; a cancelled report keeps its reason. The print has the
  letterhead, the doctor's name, qualification and registration number, and the DRAFT band.
- A separate **sonologist login** that sees only the scan details – no visits, laboratory results, bills or phone
  number – and even less on a sensitive record.
- **No field for the baby's sex anywhere**, and every free-text box refuses such words, karyotypes and symbols
  (`server/src/utils/pcpndt.js`).
- The audit log notes every opening, Add, Ignore, signature and print; hospitals are kept apart; scan reports are in
  the copy of the whole record. Because Perinexa runs in a browser, a report can be read or signed from any room.

Things the leaders do not all have: the approve-first suggestions with the doctor's answer kept; the second check by
the patient's doctor before a scan changes her EDD; a sonologist who sees only what the scan needs; the fetal-sex
filter on every word; and the scan sitting in the same record as the visits, laboratory results, care plan and
delivery – the foreign products are separate programs that have to be connected to the hospital system.

Planned in `docs/USG_PLAN.md` but not built yet: images with the report, measurements from the machine, twin and
follicle templates, the care-plan scan item ticked by itself, the scan's charge added by itself, the report in her
ABHA records, voice entry on the scan form, and a centile for each measurement (today only the weight has one).

## 4. What is missing, area by area

| Area | The leaders | Perinexa today |
| --- | --- | --- |
| Link to the machine | Worklist; measurements, images and clips arrive by themselves | Everything is typed |
| Images | Kept with the report, printed in it, viewed and re-measured | None with the report |
| Growth | A centile and a graph for each measurement, earlier scans on the same graph, printed | One number: the weight centile. No graph, no earlier scans beside it |
| Choice of chart | The centre chooses among many charts and formulas | Hadlock only |
| Doppler | Uterine, umbilical, middle cerebral, ductus venosus, the ratio, each on its normal range | Two boxes (umbilical and middle cerebral PI), no normal range, no rules |
| First-trimester risks | Trisomies and pre-eclampsia calculated (FMF licence) | Not calculated, and no place to record a result calculated elsewhere |
| Twins | Each twin separately, chorionicity, growth difference, twin-specific checks | One tick "more than one" and a reminder to state chorionicity |
| Fetal heart and brain | Step-by-step modules | One line "no structural abnormality seen / see other findings" |
| Follicle study | Follicle tracking screens | None (already idea F1 in `docs/IDEAS_FOR_LATER.md`) |
| Gynaecology | IOTA description and risk of an ovarian mass, RMI, procedures | Uterus size, endometrium, free text for each ovary |
| Completeness | Missing items shown before signing | Only the suggestions must be answered; an empty box does not stop signing |
| Urgent findings | (not described by the vendors read) | The report waits in the list; her doctor is not alerted, unlike a laboratory result outside its range |
| Sharing | Referring doctor by e-mail, portal or WhatsApp; patient by app or portal | Print only; not on the patient portal, not in the ABHA records |
| Languages | About 20 (astraia); several (Drlogy) | English only |
| Quality figures | Audit per centre and per operator; a query tool | None for scans |
| Money | Coding and charge capture | The charge is added by hand under "Scans and procedures done" |
| PC-PNDT paperwork | Form F prepared, checked, sent to the state portal | None – the owner's decision: on paper (section 6) |

## 5. Candidate features, in the order they would pay off for an OBGY hospital

**(clinical)** marks medical content the owner approves as the doctor; all of it would start as DRAFT.

**Tier 1 – fits what exists, needs no new add-on**

1. **Growth charts and the trend across scans** **(clinical)**: a centile for each measurement (BPD, HC, AC, FL) and
   not only the weight; one graph per measurement with every earlier scan of this pregnancy on it; a line "since the
   scan of 12 Oct: weight +420 g in 21 days"; the graph printed in the report. Every obstetric product has this, and
   Indian specialists call it a must for a growth report [16]. It can be drawn without an add-on.
2. **Urgent findings reach her doctor** **(clinical)**: when a signed report carries a finding from an owner-approved
   list (no cardiac activity, pregnancy not seen in the uterus, placenta praevia, weight under the 3rd centile,
   absent or reversed flow, short cervix), it appears on her doctor's **Today** page to be acknowledged, as a
   laboratory result outside its range already does. Perinexa has the sonologist and the doctor as two people; this
   closes the gap between them.
3. **Doppler in full** **(clinical)**: uterine arteries, umbilical artery, middle cerebral artery, ductus venosus and
   the cerebroplacental ratio, each with its centile for the weeks; end-diastolic flow as a choice (present, absent,
   reversed); rules for the suggestions. This is the IRIA's Samrakshan third-trimester protocol; the programme's own
   reports found an abnormal Doppler in about a quarter of third-trimester scans and linked it to late stillbirth
   [17].
4. **Twins template** **(clinical)**: chorionicity and amnionicity, each twin named by its position (never by sex),
   measurements and Doppler for each, the deepest pocket in each sac, the weight difference in per cent worked out,
   and rules (for example a difference above 20 % [18]).
5. **A second growth chart for the owner to choose, and the chart named on every report** **(clinical)**: at
   Fernandez Hospital, Hadlock called 31.2 % of 67,808 babies small against 12.0 % by a chart fitted to Indian
   babies, and the extra 13,043 had no higher stillbirth risk [14]; a Delhi study found Hadlock and INTERGROWTH-21st
   both acceptable [15]. The owner chose Hadlock on 15 Oct 2026; this item does not change that – it puts the
   evidence in front of the owner and asks whether a second chart (INTERGROWTH-21st, whose tables are published)
   should be offered, and whether the "small for dates" rules should use the 10th centile or a stricter limit.
6. **Anomaly scan as a checklist** **(clinical)**: head, face, spine, chest, four-chamber heart and outflow tracts,
   abdomen, kidneys, bladder, limbs, cord – each "seen normal / not seen / abnormal", with what was not seen listed
   before signing. It replaces today's single line and does without AI what Sonio's checklist does. The list must
   **leave out the genital area**, which foreign checklists include.
7. **Gynaecology in standard terms** **(clinical)**: an ovarian mass described in IOTA words with the Simple Rules
   result and an O-RADS category; fibroids by FIGO type with size and position; polycystic ovarian morphology
   (follicle count and volume per ovary). Classification only – the ADNEX percentage is item 14.
8. **The links already planned**: the care-plan scan item ticked when the report is signed; the scan's charge added
   from the price list; a scan **ordered** by the doctor so that the Scans list shows who is waiting and since when;
   voice entry on the scan form (the probe hand is busy), through the same fetal-sex filter.
9. **Follicle study template** – idea F1 in `docs/IDEAS_FOR_LATER.md` (the cycle sheet); listed here so that it is not counted
   twice.
10. **Scan quality figures in Analytics** **(clinical choice of figures)**: scans by type and month; time from start
    to signature; reports with an addendum; and two figures only a whole-hospital record can give – **the last
    estimated weight against the birth weight**, and **how many babies born small had been picked up before birth**.
    Whether any figure is shown per sonologist is the owner's decision (for waiting times the owner chose no split by
    named staff).

**Tier 2 – bigger pieces that need the owner's decision first**

11. **Sharing the signed report**: on the patient portal, in her ABHA records (planned, not built), to the referring
    doctor through the referral desk, and a patient summary in Marathi or Hindi **(clinical wording)**. WhatsApp
    delivery of the report itself, as AvimedTech offers [8], would put scan findings on a channel Perinexa uses today
    only for consented reminders – a link to the portal is the safer way. A code on the printout to check that a
    report is genuine needs a small add-on (the developer's agreement, as for idea 15).
12. **A few chosen images with the report**, uploaded by the sonologist from the machine or a USB stick (planned in
    `docs/USG_PLAN.md`). Before building: where the files live (they are large; the move of files to separate
    storage waits for the developer), who may open them, whether they are printed (the plan's default is no), and
    the lawyer's view on keeping pregnancy scan images as records under the PC-PNDT Rules [24]. Images of a
    pregnancy are **not** sent to patients (section 6).
13. **Recording a risk result worked out elsewhere** **(clinical)**: a place on the dating scan for the combined
    screening result and the pre-eclampsia risk as figures, with where they came from (the laboratory's report, the
    FMF website, the machine), and an owner-approved rule on top (for example, a suggestion to discuss low-dose
    aspirin above the limit the owner sets). This gives most of the benefit without Perinexa doing the calculation.
14. **Risk calculation inside Perinexa** (FMF trisomy and pre-eclampsia risks, the IOTA ADNEX percentage): **not
    recommended now.** The FMF licence comes only from the FMF and requires each operator's certification and audit
    [11]; the blood results must be calibrated per analyser [1]; astraia, which does this, is certified as a medical
    device [1]; and under CDSCO's guidance on medical device software (draft October 2025, reported final July 2026)
    software that gives information for a clinical decision can count as a medical device needing registration
    [23]. The same reasoning made the owner decide against AI reading of images. Item 13 is the safer way.
15. **Fetal echo and fetal brain templates** **(clinical)**: only if the hospital does these scans itself; otherwise
    the anomaly checklist (item 6) with a referral is enough.

**Tier 3 – needs the developer's agreement on a new add-on and a check of the hospital's machine**

16. **The link to the ultrasound machine**: the patient's name on the machine, and the measurements arriving in the
    report by themselves. Every leading product has it and it removes typing mistakes. It needs a DICOM add-on (a new
    dependency), a small receiving program inside the hospital's own network once Perinexa runs in the cloud, the
    machine set up by its engineer, and the same plausibility checks the typed boxes have – astraia's 2022 safety
    notice shows what can go wrong [25]. Measurements first; automatic transfer of **all** images is a separate and
    larger decision (storage, and every frame of a pregnancy scan would be kept).

## 6. What should not be copied, and why

- **Anything that records, shows, prints or lets staff work out the baby's sex before birth.** The foreign products
  are made for countries where this is lawful; none of the pages read mentions the subject at all. In practice that
  means: no sex field; no genital area in the anomaly checklist; twins named by position; no sex chromosomes when a
  NIPT or karyotype result is recorded (astraia records these [1] – Perinexa's filter already refuses them); and **no
  pregnancy scan images or clips sent to the patient's phone**, which is the main selling point of Tricefy and of
  Sonio's patient app [3] [4]. The fetal-sex protection is one of Perinexa's "never weaken" rules.
- **AI reading of scan images.** The owner decided against it on 15 Oct 2026: not validated, a medical device needing
  CDSCO approval, and able to reveal the sex. The review confirms the decision. The best-known product, Sonio Detect,
  only recognises views and checks picture quality; it does not find abnormalities [3]. In India the founder of an
  imaging-AI company told a newspaper in February 2026 that AI for ultrasound is not allowed at present (one
  person's statement, not an official notice), and the hospitals' association asked manufacturers in 2024 for AI
  that hides the genital area – then still "in the works" [22]. Items 6 and 2 give the useful part (nothing
  forgotten, nothing urgent missed) with written rules.
- **AI that drafts the impression** (optional in Meeravio [6]). Perinexa's written rules do this in a way the owner
  can read and approve line by line, and no pregnancy finding leaves the hospital.
- **PC-PNDT registers and Form F.** The Indian leaders have it (section 2). **Owner's decision: on paper** (2 Oct
  2026, confirmed 5 Nov 2026). It is listed here only so that the comparison is complete; nothing in this document
  proposes to change it. The legal check listed in `docs/USG_PLAN.md` (registered centre, registered sonologist,
  Form F for every pregnancy scan) stays open for the developer and a lawyer, and the June 2026 judgment [21] is one
  more reason to have it done before real patients.
- **Anything that needs a new add-on** – the machine link (item 16), a code on the printout (item 11) – is marked
  "needs the developer's agreement" and is not to be started without it.
- **American billing codes and insurance coding** (ViewPoint, Sonio [2] [3]): not relevant to an Indian hospital;
  Perinexa's own price list and bills do this job.

## 7. Notes for the decision

- Items 1–10 reuse what exists (the report form, the rule engine with Add and Ignore, the Today page, the care plan,
  billing, Analytics) and keep Perinexa's rules: hospitals kept apart, need-to-know access, the sonologist's narrow
  view, the audit log with ids only, the fetal-sex filter on every word, DRAFT until the doctor approves.
- Every chart, centile table, Doppler range, rule limit and checklist in items 1–7, 10, 13 and 15 is clinical
  content: the owner approves the source and the limits, and each formula is tested against its published examples,
  as the Hadlock ones were.
- Items 11 and 12 touch privacy (a report or an image leaving the hospital) and the PC-PNDT record rules: the
  owner's and the lawyer's call before the developer's.
- Items 14 and 16 are different in kind: one could make Perinexa a medical device, the other needs a new add-on and
  work on the hospital's machine.
- Across all of it: only fake data until the go-live checklist in the handover plan is complete.

## 8. Sources read

Read in full unless marked. "Search summary" means the page itself could not be opened from here and only the search
engine's summary of it was seen – check it before relying on it.

1. astraia product brochure 0226R10-EN, NEXUS / ASTRAIA GmbH –
   https://nexus-ag.de/files/astraia/Downloads/astraia_product_brochure_0226R10EN.pdf
2. GE HealthCare, ViewPoint 6 for Women's Health (page dated April 2024) –
   https://www.gehealthcare.com/en-au/products/ultrasound/ultrasound-reporting/viewpoint-womens-health . The older
   brochure with the first-trimester FMF module: search summary.
3. Sonio – https://sonio.ai/ and https://sonio.ai/products/ ; Samsung's press release of 3 Sep 2024 –
   https://usa.samsunghealthcare.com/news-center/samsung-concludes-sonio-acqusition ; Femtech Insider, 29 May 2025,
   written by Sonio's chief executive –
   https://femtechinsider.com/the-future-of-ultrasound-reporting-how-ai-and-portability-are-transforming-prenatal-care/
4. Tricefy – ITN, 1 May 2026 (a company announcement) –
   http://www.itnonline.com/content/trice-imaging-accelerates-growth-women%E2%80%99s-health-sector ; sharing to
   patients' phones: search summary of the vendor's pages. The 2023 brochure was too large to open.
5. AS Software – https://www.as-software.com/?p=1567 and https://www.as-software.com/?p=1072
6. Meeravio – https://meeravio.com/ and https://meeravio.com/pcpndt-form-f-software.html (updated August 2026)
7. Everrtech – https://www.everrtech.com/leading-medical-imaging-software/ultrasound-reporting-software-healthcare
8. AvimedTech – https://avimedtech.com/ultrasound-reporting-software-in-india/
9. Drlogy – https://drlogy.com/blog/usg-reporting-software-form-f and
   https://drlogy.com/blog/usg-reporting-software-usg-report (only a summary of the article text could be read)
10. OneCity, 8 Jun 2026 – https://onecity.biz/blog/pcpndt-act-hospital-ultrasound-compliance/
11. The Fetal Medicine Foundation calculators – https://courses.fetalmedicine.com/calculator/chart?locale=en ; the
    licence and certification terms are from the FMF program manual (search summary) –
    https://courses.fetalmedicine.com/software/Program%20manual-%20Version%202017-281_CE.pdf
12. Fetal Medicine Barcelona calculators (in Spanish) – https://fetalmedicinebarcelona.org/calc/
13. Esaote, Adnex-IOTA leaflet (2026) –
    https://www.esaote.com/fileadmin/GLOBAL/Ultrasound/Clinical_solutions/Gynecology/Leaflet_A5_Adnex-IOTA_E_160000622_V01.pdf .
    The IOTA group's own pages could not be opened, so the terms for using its models in other software are not known.
14. Chandra P, Hugh O, Gardosi J. Late onset growth restriction preceding stillbirth in India: Hadlock vs GROW charts
    (congress poster; Fernandez Hospital, 2015–2022) – https://www.perinatal.org.uk/pdfs/rcog/EP.0128_GROW_India_and_Hadlock.pdf
15. Saini R et al. Comparison of Hadlock and INTERGROWTH-21st growth charts … Cureus 2025;17(3):e81333 (277 low-risk
    women, one centre) – https://pmc.ncbi.nlm.nih.gov/articles/PMC12042984/
16. Journal of Fetal Medicine, 2024, on ultrasound report templates – search summary (the publisher's page refused to
    open) – https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0044-1790246
17. IRIA Samrakshan programme, Indian Journal of Radiology and Imaging – search summaries of the abstracts –
    https://pmc.ncbi.nlm.nih.gov/articles/PMC9200467 and https://pmc.ncbi.nlm.nih.gov/articles/PMC6958882 . Programme
    reports without a comparison group.
18. ISUOG Practice Guidelines (updated): role of ultrasound in twin pregnancy, 2025 – search summary –
    https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11788470/
19. Prenatal Screening Ontario, NT measurement and quality assurance report – search summary –
    https://www.bornontario.ca/en/pso/resources/Documents/NT-Measurement-and-Quality-Assurance-Report.pdf
20. Delhi's PC-PNDT portal – Medical Dialogues, 22 Mar 2025 –
    https://medicaldialogues.in/news/health/delhi-govt-launches-digital-portal-to-keep-check-on-illegal-sex-determination-145326 ;
    Goa – https://nhm.goa.gov.in/pc-pndt/ . No source confirming an online Form F rule for Maharashtra was found.
21. Dr. Ramesh v. State of Maharashtra, 2026 INSC 635 (11 June 2026), as reported by India Law, 24 Jun 2026 –
    https://www.indialaw.in/blog/medico-legal/pcpndt-act-supreme-court-compliance-sex/
22. ThePrint, 12 Jun 2024 –
    https://theprint.in/health/ultrasound-that-doesnt-reveal-sex-of-foetus-in-the-works-what-it-means-for-pregnant-women/2128628 ;
    South First, 8 Feb 2026 –
    https://thesouthfirst.com/health/when-ultrasounds-go-8k-indias-sex-selection-ban-faces-new-test/
23. CDSCO guidance on medical device software – search summaries of law-firm and regulatory notes –
    https://nishithdesai.com/research-and-articles/hotline/pharma-healthcare-update/the-next-frontier-in-medtech-regulation-dissecting-cdscos-draft-guidance-on-medical-device-software-15465
    and https://www.emergobyul.com/news/india-cdsco-finalizes-guidance-medical-device-software . To be checked on
    CDSCO's own site by the developer or a regulatory adviser.
24. PC-PNDT record keeping (records and images for two years; a signed print of records kept on a computer) – search
    summaries – https://tncea.dmrhs.tn.gov.in/pdf/faq/maintainanceandpresrevationofrecords.pdf . For the lawyer.
25. astraia field safety notice, February 2022 (Swissmedic) – search summary –
    https://fsca.swissmedic.ch/mep/api/publications/Vk_20220211_06/documents/3
26. Gitnux, "Top 10 best OB ultrasound reporting software of 2026" (earns commission) –
    https://gitnux.org/best/ob-ultrasound-reporting-software/
27. Philips FetView – search summary of a trade report –
    https://www.massdevice.com/philips-unveils-cloud-based-fetal-ultrasound-tech/
28. INTERGROWTH-21st app, version 2 (fetal growth standards, free) – search summary –
    https://www.wrh.ox.ac.uk/news/intergrowth-21st-launches-version-2-of-its-growth-standards-app-expanding-to-fetal-growth-and-multilingual-access

astraia's own website and the IOTA group's site could not be reached from here; the Tricefy and older ViewPoint
brochures could not be opened.

## 9. Built in perinexa1 – stage 1 (10 Nov 2026)

The owner agreed to build U1–U5. The developer chose two stages: what needs no new medical reference numbers now, and
the rest once the owner gives the published tables to copy from (no reference value is typed from memory).

**Stage 1 – built:**
- **U2 Urgent findings reach her doctor.** When a scan report is signed, written rules (never AI) pick the findings
  (`server/src/imaging/urgentFindings.js`): no cardiac activity, ectopic suspected, pregnancy not seen in the uterus,
  fetal heart rate under 100 or over 180 bpm, placenta covering the internal os, AFI 5 cm or less or 25 cm or more,
  deepest vertical pocket under 2 or over 8 cm, cervical length under 25 mm, NT 3.5 mm or more, nasal bone not seen,
  monochorionic monoamniotic twins, and twins' weight difference of 25 % or more. They show on the scan's page and on
  **Today → Urgent scan findings** of her doctor (the treating doctor, or any doctor for an unassigned patient – as
  laboratory results to review) until a doctor marks them **Seen** (`IMAGING_URGENT_SEEN` in the audit log). A changed
  report that is signed again is checked again. **⚠️ DRAFT: the list and the limits are the owner's to approve.**
- **U4 Twins template** (`usg_twins`): chorionicity; for each twin presentation, BPD, HC, AC, FL, estimated weight,
  deepest vertical pocket and heart rate; placenta(s), cervical length. Each twin's weight (Hadlock 1985) and centile
  for the weeks by her dates, and the weight difference with which twin is heavier, are worked out; the report's
  sentences are written for each twin. Weeks come from her dates (no dating from twins' biometry).
- **U1 Growth across scans, first part:** on the page and in the printed report of an anomaly, growth or twins scan –
  the estimated weight of each of her scans of this pregnancy on the Hadlock 1991 10th, 50th and 90th centile lines
  (the curve the app already used for the weight centile), twin 2 as squares, and a table of BPD, HC, AC, FL and weight
  (with its centile) across the scans. Measurements only are sent (`growth` on `GET /api/imaging/:id`).

**Stage 2 – waiting for the owner's tables:**
- **U1, second part:** centile bands for BPD, HC, AC and FL (which reference: Hadlock 1984, INTERGROWTH-21st, an Indian
  chart).
- **U3 Doppler in full:** uterine, umbilical, middle cerebral arteries, ductus venosus, the CPR, each with its normal
  range by weeks, and the rules for each – the published tables and the owner's choice of source.
- **U5 A second growth chart** for the owner to choose (INTERGROWTH-21st or a chart fitted to Indian babies), named on
  every report. Hadlock stays until the owner decides.

Code: `server/src/imaging/urgentFindings.js`, `templates.js` (`usg_twins`), `routes/imaging.js` (`/urgent`,
`/:id/urgent-seen`, `growth`), `models/ImagingOrder.js` (`urgentFindings`, `urgentSeen`); website `usgCalc.js`
(twins, `weightBand`), `GrowthAcrossScans.jsx`, `ImagingPages.jsx`, `TodayPage.jsx`. Tests:
`server/tests/usg-stage1.test.js`, `client/src/pages/imaging/usgStage1.test.jsx`.

