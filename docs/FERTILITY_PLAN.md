# Fertility treatment plans – DRAFT protocol library and the plan on the record

Built on 24 Oct 2026 at the owner's request (an exception to the feature pause, like the ultrasound module): on an
infertility record, after the patient's details and fertility history are entered, the app offers the treatment
protocols that fit her, the doctor picks one or more, and the plan built from them is edited by the doctor.

> **DRAFT.** Every protocol below is a written summary of published guidance, not yet reviewed or approved by the
> owner (a doctor). Doses, days and numbers of cycles that the guideline texts do not spell out are marked
> "doctor to confirm" in the app. Nothing is prescribed, ordered or sent anywhere by a plan: it is a decided and
> editable text on her record. Fake sample data only, as for the rest of Perinexa.

## 1. What was built

| Part | Where |
| --- | --- |
| Fertility history on the record (Infertility type of care): kind and months of infertility, cycles, ovulation, tubes, uterus, endometriosis, the partner's semen (WHO 2021 ranges), diagnoses already made, AMH / AFC / FSH / prolactin / TSH, cycles done before, previous treatment | `server/src/fertility/fertilityFields.js`, `models/Patient.js` (`fertility`), `routes/patients.js`; form section `client/src/pages/patients/FertilitySection.jsx`; Overview card "Fertility history" |
| The protocol library (21 protocols, each with its sources, cautions and the sections of a plan) | `server/src/fertility/protocols.js` |
| The treatment ladder (follicular study → IUI → IVF/ICSI) and the other procedures; switching from a plan | `server/src/fertility/ladder.js`, `routes/fertilityPlans.js` (POST with `switchFrom`) |
| The suggestion rules: which protocols fit her record and why, best fit first; what the record still lacks | `server/src/fertility/suggest.js` |
| The plan: built from the chosen protocols, edited as text per section, confirmed by a doctor, ended with an outcome; every save keeps the earlier text | `models/FertilityPlan.js`, `routes/fertilityPlans.js`; the **Treatment plan** tab `client/src/pages/patients/FertilityPlanTab.jsx` |
| Copy of the whole record: the fertility history and the plans | `patients/recordCopyView.js`, `routes/recordCopy.js`, `RecordCopy.jsx` |
| Hospital export: `fertility-plans.json` | `src/export/hospitalExport.js` |
| Audit log: plan opened, built, edited, confirmed or ended – ids and the status only | `models/AuditLog.js`, `components/auditFormat.js` |
| Tests | `server/tests/fertility-plans.test.js`, `client/src/pages/patients/fertilityFormat.test.js`, `fertilitySection.test.jsx` |

The evaluation checklist with dates stays on the Care plan tab (the infertility care-plan template); the treatment
plan is the decision that follows it.

## 2. How it works for the doctor

1. **Edit details → Fertility history.** Every field may stay empty; "Not tested yet" says the test is still to come.
2. **Treatment plan tab → Suggest plans.** The rules read her record (age, BMI, medical background, the obstetric
   counts, the fertility history) and show the library in three groups: *Suggested for her* (with why), *May also
   apply*, and the rest of the library to browse. Each card shows the bodies it rests on, the cautions, and the
   whole protocol text.
3. **Tick one or more protocols (up to five) → Build the plan.** A draft is built: Aim and basis, Cautions,
   Investigations, Treatment steps, Medicines and doses, Monitoring and safety, Review and next step, What to explain
   to the couple, General advice for the couple. With several protocols each section names the protocol each block
   comes from.
4. **Edit.** Every section is plain text, one line per point; the title, start and review dates too. The earlier text
   is kept in the plan's versions (the last 30), with who saved it and when.
5. **Confirm plan** (a doctor; an RMO drafts and edits). Then **Record outcome** – pregnant, moved to the next step –
   or **Stop** (no response, the couple's choice, other, with a reason). One plan at a time; the earlier ones stay
   below, and a new plan can be built for the next step.
6. **Switch to…** (section 6): the next step of the ladder or another procedure, in one move.

Who may do what: seen with the medical details (infertility records are sensitive, so her doctor and RMOs; a nurse
reads a plan on a record that is not sensitive); drafted and edited by her doctor (any doctor while she has none) or
an RMO; confirmed by a doctor. Reception, the lab, the pharmacist, the sonologist and the referral desk never.

## 3. The library and its sources

Read for this draft (24 Oct 2026):

- **WHO. Guideline for the prevention, diagnosis and treatment of infertility** (28 Nov 2025) – the first WHO guideline
  on infertility, 40 recommendations; the summary table of the WHO policy brief. Nearly all are conditional on low or
  very low certainty evidence. Key points used: investigate after 12 months; mid-luteal progesterone to confirm
  ovulation; HSG or HyCoSy for the tubes; SIS or 3D ultrasound for the cavity; semen repeated after at least 11 weeks
  when abnormal; letrozole over clomiphene or metformin in PCOS (clomiphene with metformin where letrozole is not
  permitted); gonadotrophins over ovarian drilling; IVF after failed induction; cabergoline over bromocriptine;
  tubal surgery under 35 with mild–moderate disease, IVF otherwise; salpingectomy or occlusion of a hydrosalpinx before
  IVF; no septoplasty without recurrent loss; varicocele treatment over waiting; unexplained infertility – expectant
  management 3–6 months, then stimulated IUI with letrozole or clomiphene (3–6 cycles), then IVF without ICSI.
- **NICE NG257. Fertility problems: assessment and treatment** (31 Mar 2026; replaces CG156). Recommendation numbers
  in the app are NG257's: referral at 36 or with a known cause; the WHO 2021 semen limits; genetic tests in male
  factor; no DNA fragmentation testing; AMH or AFC predict the response to stimulation, not natural pregnancy; tubal
  surgery, catheterisation, hydrosalpinx before IVF; endometriosis – expectant management up to 2 years, surgery, up to
  4 IUI cycles, IVF; unexplained – 2 years, then up to 4 gonadotrophin-stimulated IUI cycles or IVF; IVF under 42, 3
  cycles under 40 (up to 3 more), 1 at 40–41; embryo numbers by age; ICSI only for male factor; the add-ons not offered;
  fertility preservation; donor insemination and oocyte donation indications. NICE removed its PCOS induction
  section (a PCOS guideline is in preparation), so PCOS follows the 2023 international guideline and WHO 2025.
- **ESHRE. Unexplained infertility** (2023; 52 recommendations) – the definition and the tests not to do; IUI with
  ovarian stimulation as the first active treatment, decided by prognosis; no ICSI; oil-based tubal flushing; no
  endometrial scratching, antioxidants, inositol, acupuncture.
- **ESHRE. Endometriosis** (2022) – the infertility chapter: no ovarian suppression for fertility; surgery in stage
  I–II; IUI with stimulation; ART; no routine endometrioma surgery before ART; the EFI.
- **ESHRE. Recurrent pregnancy loss** (update 2022) – investigations and treatments (also the basis of the
  pregnancy-loss care plan).
- **ESHRE, ASRM, IMS and CRE-WHiRL. Premature ovarian insufficiency** (2024).
- **ESHRE. Ovarian stimulation for IVF/ICSI** (2019, update 2025) – referred to by NICE for stimulation; summarised
  only as "the clinic's protocol" with the 2019 points (antagonist protocol, individualised dose, agonist trigger with
  freeze-all for OHSS risk).
- **International evidence-based guideline for the assessment and management of PCOS** (2023; endorsed by ESHRE and
  ASRM), chapter 5: letrozole first line; clomiphene, metformin, their combination; gonadotrophins low-dose step-up
  with the cancel rule (more than 2 follicles of 14 mm); laparoscopic ovarian surgery second line; IVF third line;
  preconception care.
- **FOGSI.** Focus – PCOS practice points: PCOS and infertility (Nov 2024); Focus on ovulation induction and IUI
  (2014) and on IUI (2010). The FOGSI PDFs could not be downloaded by the app's build (the site blocks automatic
  readers): the practice points are cited from their summary and should be read by the owner.
- **WHO laboratory manual for the examination and processing of human semen**, 6th edition (2021) – the lower
  reference limits as NICE quotes them.
- **ASRM / AUA** practice documents (male infertility 2020–2021; myomas 2017; embryo numbers 2021); **EAU** male
  infertility (2025).
- **India:** ART (Regulation) Act 2021 (woman 21–50, man 21–55; registered clinics and banks; counselling and
  consent; no sex selection), ART Rules 2022 (donor rules: oocyte donor 23–35, married with a child, once, up to 7
  oocytes, insured; sperm donor 21–55; one donor to one couple), ART Regulations 2023 (1–2 embryos per transfer,
  3 only in exceptional cases), Surrogacy (Regulation) Act 2021, PC-PNDT Act 1994.

The 21 protocols: Evaluation of the couple · Lifestyle and preconception care · Follicular study with timed intercourse · Letrozole ovulation induction ·
Gonadotrophin induction (low-dose step-up) · Laparoscopic ovarian surgery · Hypogonadotropic hypogonadism (WHO group I)
· Hyperprolactinaemia · Unexplained infertility · Tubal factor · Mild to moderate male factor · Severe male factor and
azoospermia · Endometriosis · Uterine factor · Older age or diminished reserve · Premature ovarian insufficiency · IUI
with stimulation · IVF or ICSI and the rules in India · Recurrent pregnancy loss · Fertility preservation · Donor
gametes under the ART Act.

## 4. The suggestion rules (plain words)

- Nothing recorded, or ovulation, tubes or semen not yet tested → **Evaluation** (with the list of what is missing).
  Under 12 months of trying, under 36, nothing abnormal → **Preconception care** first.
- Anovulation (or PCOS): **Letrozole induction** first; after six induction cycles → **Gonadotrophins**
  (ovarian drilling to consider), IVF later. Blocked tubes or a severe male factor → IVF instead.
  Low FSH and LH → **Group I induction**. Raised prolactin → **Hyperprolactinaemia**. Amenorrhoea with FSH 25 or more
  before 40 → **Ovarian insufficiency** (donor oocytes to consider).
- Hydrosalpinx → **Tubal factor** and **IVF**. Both tubes blocked → under 35 **Tubal factor** (surgery) with IVF to
  consider; from 35 **IVF**. One tube blocked → tubal factor to consider.
- Semen: mild → **Mild male factor** (IUI to consider); severe → **Severe male factor** and **IVF/ICSI**;
  azoospermia → **Severe male factor** (donor and ICSI to consider). A clinical varicocele with abnormal semen →
  repair rather than waiting.
- Endometriosis minimal–mild → **Endometriosis**; moderate–severe → **Endometriosis** and **IVF**; suspected → to
  consider (laparoscopy and dye).
- A uterine finding → **Uterine factor** (a septum is not resected for infertility alone).
- Ovulation confirmed, both tubes patent, normal semen, 12 months or more → **Unexplained infertility**; IUI to
  consider, or recommended from 35, after 36 months or after a first IUI cycle; after 3 IUI cycles → **IVF**;
  from 40 → **IVF**.
- 38 or older, or AMH under 1, AFC 5 or fewer, FSH 10 or more → **Age and reserve** (recommended from 40 or with AMH
  under 1); 35–37 with a year of trying → to consider.
- Two or more pregnancy losses → **Recurrent loss** to consider (recommended from three).
- Cautions, never refusals: above 50 (or a partner above 55) the ART Act's upper age; under 21; a BMI of 30 or more
  with PCOS; a raised TSH; tuberculosis in the medical background.

## 6. The treatment ladder: switching from follicular study to IUI to IVF, or to a procedure

Added on 24 Oct 2026 at the owner's request. On a current plan, **Switch to…** offers:

- **The ladder:** *Follicular study with timed intercourse* → *IUI with ovarian stimulation* → *IVF or ICSI* (the plan's own
  step is left out). The plan's step is shown under its title; a plan built from other protocols stands beside the
  ladder as "Procedure or work-up".
- **Other procedures:** laparoscopy with ovarian drilling; tubal surgery or surgery for a hydrosalpinx; hysteroscopic
  surgery (septum, fibroid, polyp, adhesions); endometriosis surgery; varicocele repair and the male work-up; surgical
  sperm retrieval with ICSI; donor gametes; fertility preservation – each the protocol that describes it.
- **Anything else:** the full chooser with the suggestions for her, with the switch carried along.

What a switch does, in one request (`POST /api/patients/:id/fertility-plan` with `target` and `switchFrom`):
1. the new draft is built from the step's protocol, its first line saying "Switched from “…” on … : why";
2. the current plan is closed – a confirmed plan is **completed as moved to the next step**, a draft is discarded –
   with "Switched to …" and the reason as its outcome note;
3. the **cycles completed** under the old plan (asked in the dialog) are added to the matching counter on her record
   – ovulation induction cycles for a follicular study or induction plan, IUI cycles, IVF or ICSI cycles – so the next
   suggestions count them (after three IUI cycles the rules move to IVF). A procedure has no cycles to count.

With no current plan, **Start with a step…** builds the first plan straight from the ladder. The new **Follicular
study** protocol carries the caution that WHO 2025 and NICE 2026 do not recommend ovarian stimulation with timed
intercourse as a stand-alone treatment for unexplained infertility: there it is monitoring of a natural cycle for a few
months, and the next step is stimulated IUI.

## 5. Decisions and open points for the owner

1. **Approve or change the library.** Every protocol text, especially the doses and days marked "doctor to confirm".
   The library's version (`draft-2026-10-24`) is stamped on every plan built from it.
2. **Letrozole in India.** The app says letrozole is off-label and that the regulator restricted its infertility
   indication in 2011, and asks the doctor to check the current CDSCO position and take written consent. The owner
   decides the clinic's position.
3. **Who confirms.** A doctor confirms a plan; an RMO drafts, edits and ends it. Change if the clinic works differently.
4. **FOGSI documents.** The FOGSI PCOS practice points (2024) and IUI focus issues are cited from summaries; the owner
   should read the originals and correct the library where they differ.
5. **A patient copy of the plan** (printed in her language) was not built; the plan is for the doctor. Say if the
   couple should receive a printed plan or a shorter version through the portal.
6. **AI help** (Ask AI, the brief) does not read the fertility history or the plan yet.
7. **After she conceives** the record becomes antenatal; the Treatment plan tab stays visible (read-only history) while
   the fertility history is on the record, and the plan should be completed as "pregnant".
