# Ideas for later: easier and more pleasant for doctors

> **16 Oct 2026 – the owner asked for these to be built.** Ideas **1–11 are built** (branch `doctor-ideas`; how to use
> each one: `docs/PROGRESS.md`, "How to test the doctor ideas"). Ideas **12–16 are planned, not built**: the risks and
> the decisions needed first are in `docs/IDEAS_12_16_PLANS.md`. The clinical parts of 7, 8 and 10 are DRAFT for the
> owner to approve.

Collected 15 Oct 2026. **Nothing here is built or approved.** New features are paused until the developer's health
check (`docs/HEALTH_CHECK.md`) is done and the owner and the developer have agreed what the first commercial version
contains. Pick from this list at that point.

Ideas marked **(clinical)** include medical content or wording that the owner approves as the doctor before use.

## Quickest wins: easier to use

| # | Idea | Why it helps |
| --- | --- | --- |
| 1 | **One search box for everything**: one key opens a box; type "P-000003 anaemia" or "book Friday" and go straight there | Skips clicking through menus |
| 2 | **"Same as last visit"**: copies the last visit's medicines and advice; the doctor changes only what differs | Routine follow-up prescriptions in seconds |
| 3 | **Personal shortcuts for typing**: `.fu2` becomes "Follow up after 2 weeks with CBC report"; each doctor keeps their own list | Less typing of the same sentences |
| 4 | **Nothing gets lost**: a half-typed visit is kept if the doctor is called away or logged out after 30 minutes; "Continue Mrs. ___'s visit" is waiting next time | No retyping, no lost notes |
| 5 | **Undo instead of "Are you sure?"**: a few seconds to undo a mistake; signed visits and other records that must not change still ask first | Fewer pop-ups to click through |
| 6 | **Keyboard-only visit entry**: Tab and Enter move through vitals, notes and medicines | Fast typists never need the mouse |

## Making it pleasant

| # | Idea | Why it helps |
| --- | --- | --- |
| 7 | **Pregnancy timeline picture** **(clinical)**: a ribbon from LMP to EDD, today marked, dots for visits and scans (done, due, missed) | The whole pregnancy in one look |
| 8 | **Gestational-age wheel** **(clinical)**: a digital version of the cardboard pregnancy wheel; pick a date, see weeks and days | A tool doctors already use, now built in |
| 9 | **End-of-day summary**: "You saw 23 patients today. 2 lab reports are waiting for you. 1 high-risk patient missed her visit." | A sense of finishing the day; catches loose ends |
| 10 | **Baby keepsake card** **(clinical wording)**: after a delivery, a simple printable card for the family (date, time, weight, a short note from the doctor) | Patients remember it; promotes the hospital |
| 11 | **Short tips and "What's new"**: one short tip the first time a doctor opens a new or changed screen | No long training needed |

## Bigger ideas: need more care

| # | Idea | What to watch |
| --- | --- | --- |
| 12 | **AI listening during the consult** **(clinical)**: with the patient's consent, the conversation becomes a draft visit note for the doctor to check | Serious privacy risk: patient conversations would go to an outside AI company. Needs patient consent, a careful provider choice and the developer's security review first |
| 13 | **Phone or tablet for ward rounds**: an "install on phone" version for bedside round notes | Security on phones (lock, logout, lost phone) |
| 14 | **Photo of an outside report**: a phone photo of another lab's report; the values are read into the record for the doctor to confirm | The doctor must confirm every value; reading mistakes are possible |
| 15 | **Registration from the QR code on her Aadhaar card** (owner, 15 Oct 2026): reception holds the card to the webcam; the government-signed Secure QR is read in the browser and fills name, date of birth, sex and address for reception to check. Only with her consent; no photo kept, never the Aadhaar number, nothing sent to an AI company; the QR's signature is checked | **First make Scan & Share work for real** (built, practice mode only – needs the ABDM sandbox, HFR registration and a public address; `docs/ABDM_PLAN.md`): it already fills the form from her ABHA app. Needs a QR-reading add-on (the developer agrees to new add-ons) and a check of UIDAI's rules for offline verification. **Not chosen:** a photo of the Aadhaar card or other ID read by AI – Aadhaar rules restrict keeping copies, the photo would go to an outside company, and misreads are common |
| 16 | **Ultrasound (USG) reports** – **first version built 15 Oct 2026** at the owner's request (owner, 15 Oct 2026 – full plan in `docs/USG_PLAN.md`) **(clinical)**: scan orders and a scan list; DRAFT templates per scan type; measurements typed, spoken or later sent by the machine; the app works out gestational age, weight and centiles and writes the report; suggestions from owner-approved rules are added only when the doctor presses Add; signed and printed on the letterhead | **Check the PC-PNDT Act first** (registered centre and sonologist, Form F). **Not chosen:** AI reading the scan images – not tested for ultrasound, would be a medical device needing CDSCO approval, and could reveal the baby's sex |

## Sonography: what is still missing (asked 24 Oct 2026)

A full sonography module was asked for (separate login, orders, machine link, images, approval, dashboard, billing,
security). Most of it is already in **Scans** (`ImagingOrder`): orders linked to the patient, DRAFT templates, readings
that give the EDD and weight, a drafted report, signing, printing, the scan on her bill, the scans in her record and
portal, the audit log and the fetal-sex protection. These parts are not built. They extend Scans rather than add a
second system, so the bill, the history and the audit stay in one place.

| # | Idea | What to decide first |
| --- | --- | --- |
| 17 | **Sonography staff login**: a sonologist or sonography technician role that works the scan list, writes reports and sends them for a doctor's signature | **Owner decision:** Scans is for doctors and RMOs only, and the separate sonologist login was left out on 19 Oct 2026. PC-PNDT: only a registered sonologist may scan. A technician must never see or write the baby's sex |
| 18 | **Scans ordered by reception and from the ANC care plan**: reception books a scan a doctor asked for on paper; a scan due in the care plan becomes an order with one click | **Owner decision:** who may order a scan. A scan from the care plan still needs a doctor to confirm it |
| 19 | **Scan images in the report**: import JPG, PDF or DICOM image files from the machine into the study, choose which ones print with the report | Where the images are stored (they are patient data: encrypted, backed up, kept only as long as needed). Images must not show the baby's sex. Size limits |
| 20 | **The machine sends its readings and images by itself** (DICOM worklist, storage and structured report) | **Developer:** the machine's make, model and what it can export (DICOM over the network, files on USB, a network folder). Needs a DICOM add-on and a small program in the hospital that talks to the machine |
| 21 | **Sonography dashboard**: today's scans, waiting, reports waiting for signature, done | Can be built on the existing scan list. Which counts the owner wants |
| 22 | **Two-step approval**: whoever writes the report sends it, an authorised doctor signs it | Only with idea 17. Who may sign which scan types (owner) |

## Aadhaar: scan with a phone, fill in on this computer (asked 24 Oct 2026)

| # | Idea | What to decide first |
| --- | --- | --- |
| 23 | **Scan Aadhaar with your phone and send it to this computer**: the New patient form on the reception computer shows a short-lived QR code; reception scans it with their own phone (already signed in to Perinexa), the phone's camera reads the Aadhaar QR live the way PhonePe does, and the details appear in the form on the computer for reception to check and save. Why: laptop webcams cannot focus close enough for the dense Aadhaar Secure QR (about 5 times denser than a UPI QR), and photos forwarded on WhatsApp are too blurred to read | **Privacy (developer and owner):** today nothing of the card leaves the computer; this would send the details through the server. So: only the fields the form uses (name, age, address, PIN, city, state, last 4 digits, the signature result) – never the whole Aadhaar number, the photo in the QR, gender or the QR itself; the pairing code works once, for one form, for about 2 minutes, and only for the same staff member in the same hospital; the details are held in memory only until the computer collects them (never saved in the database, never in logs or error reports), over HTTPS only; the audit log records that a card was scanned, without its details; the patient's agreement is asked on the phone before the camera opens. **Simpler first:** a USB 2D QR scanner (about ₹2,000–4,000) already works with nothing sent anywhere, and opening Perinexa on the phone itself already scans live |

## Reception: follow-ups and vaccinations hard to see (asked 26 Oct 2026)

Reception cannot clearly see who should come back. On reception's Today page the call lists ("Visits due now – not
booked", "Overdue – not booked", "Babies due – not booked") come last, below today's patients, payments, discharges,
tomorrow's calls, Scan & Share, sign-ups and quick bookings; the "calls" number card at the top is the only way to
them. They list only people already late with nothing booked (`server/src/routes/today.js`, `callLists` and
`babiesDue`). Compared with Docterz, whose Reception app shows the day's queue at a glance and whose Vaccine Manager
works out each child's schedule and sends reminders by itself.

> **26 Oct 2026: ideas 24, 25 and 27 are built** on branch `reception-followups` (not merged): Follow-ups in
> reception's menu (`docs/PROGRESS.md`, 26 Oct 2026). For 27, only the babies due in the next 7 days; babies overdue
> for longer than 6 weeks still drop off reception's list (owner decision). 26, 28 and 29 are not built.

| # | Idea | What to decide first |
| --- | --- | --- |
| 24 | **Call lists higher on reception's Today**: "Follow-ups and vaccinations to call" right under today's patients, or a tab beside them, with the counts on the top card | Layout only. Which order reception wants (owner) |
| 25 | **Follow-ups coming up**: everyone with a next visit today, tomorrow and this week (booked, or only written as "next visit on" by the doctor), marked as follow-up, so reception can confirm or remind | Shows bookings, never the reason for the visit. Sensitive records as on the calendar |
| 26 | **Follow-ups for every type of care**: today the due and overdue lists come only from antenatal care plans; gynaecology, infertility and general patients appear only after a missed booked day | **Owner decision:** which care types' plan windows reception may see |
| 27 | **Babies' vaccinations due soon**: babies with a vaccination due in the next 7 days and nothing booked, so reception books them before they are late; and babies overdue for longer than 6 weeks, who drop off reception's list today (they stay only on the baby's care plan) | **Owner decision:** reception sees "a check-up or test is due", never the vaccine (privacy rule of 4 Oct 2026); showing vaccine names to reception would reverse it. A draft schedule still says "ask the doctor before calling" |
| 28 | **(clinical) Vaccination reminders sent by themselves** to the parents in their language (Marathi, Hindi and others) until the schedule ends | Wording approved by the owner. Which channel (SMS, WhatsApp) and the parents' consent. The message names no vaccine unless the owner agrees |
| 29 | **Vaccine stock**: vaccines ordered, given and left, and what to order | Belongs with the pharmacy stock. Who keeps it (owner) |

## Keep in mind

- **"Fun" must fit the brand rules** (`docs/BRAND.md`): no emoji and no exclamation marks. The fun should come from things
  being fast and satisfying, not from badges, points or confetti.
- **Never weaken** the protections listed in `CLAUDE.md` (hospital separation, need-to-know access, the audit log,
  fetal-sex protection and the others) while building any of these.

## Fertility and IVF: what the leading applications offer (24 Oct 2026)

The owner asked which features the best infertility and IVF applications have that Perinexa could add. The review of
eIVF, BabySentry, IDEAS, MedITEX, the Indian ARTis, Healcon and MedART, the patient apps Salve and Embie, the AI tools of
Alife and Fairtility, the SART and Aberdeen counselling calculators, the Vienna laboratory KPIs and India's ART Act is in
`docs/FERTILITY_APPS_REVIEW.md`. Its candidate list, in the order it would pay off for an OBGY clinic that does
ovulation induction and IUI and refers IVF out:

| # | Idea | Why it helps |
| --- | --- | --- |
| F1 | **Cycle (follicular study) sheet** on the Treatment plan, with a printable bilingual report **(clinical)** | The daily work of OI and IUI; every product read has it; the cycle counters fill themselves |
| F2 | **Semen analysis panel** in the lab module against the WHO 2021 limits, with the post-wash count **(clinical)** | A standard report, flags, and the record's semen field set with the doctor's confirmation |
| F3 | **Counselling numbers** by age band and step (NICE / HFEA, SART bands) **(clinical)** | Honest chances per cycle on the plan and its copy |
| F4 | **Fertility information sheets** (OI, monitoring, IUI, IVF/ICSI, ART Act points, donor gametes, OHSS, two-week wait) **(clinical)** | Bilingual, signed as informed, like the pregnancy sheets |
| F5 | **Cycle reminders** (scan days, injections, test day) through the consented SMS/WhatsApp channel | What the patient apps do, with what exists |
| F6 | **Prescription sets for OI and IUI** **(clinical)** | One tap from the cycle sheet, checked by the medicine safety list |
| F7 | **Next scan booked from the cycle sheet**; a monitoring-load day view | Cycle-aware scheduling |
| F8 | **Fertility analytics tab** (cycles per step, pregnancies per cycle, time to pregnancy, switches) | Outcomes by protocol, as the leaders report |
| F9–F14 | Partner (male) record with consent; cycle packages and refunds; ART Act consent forms; teleconsultation; a patient copy of the plan; donor and partner screening checklist | Bigger pieces – privacy, money and legal review first |
| F15–F17 | Embryology lab, cryostorage and witnessing; donor and surrogacy modules and registry exports; AI embryo or dose tools | Only with an in-house IVF laboratory; AI not recommended until independent trials show a gain |

## A new patient as a history-taking sheet (27 Oct 2026, layout only)

The owner wants a new patient's history taken on one short page in the words of the paper template (patient is …
with complaints of …, LMP and cycle, married since and consanguinity, previous deliveries, any other personal, medical,
operative or family history), dictated in one go, with everything else in drop-downs the doctor opens only for reference and
every hint, example, risk warning and AI check hidden until Save. The agreed layout and
the owner's nine decisions are in `docs/HISTORY_SHEET_LAYOUT.md`; whether and when it is built is a separate decision.
The printed page in template form (history, vitals, prescription) is drafted as board 3 of the mock-up, to finalise.

