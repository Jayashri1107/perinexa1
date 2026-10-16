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

## Keep in mind

- **"Fun" must fit the brand rules** (`docs/BRAND.md`): no emoji and no exclamation marks. The fun should come from things
  being fast and satisfying, not from badges, points or confetti.
- **Never weaken** the protections listed in `CLAUDE.md` (hospital separation, need-to-know access, the audit log,
  fetal-sex protection and the others) while building any of these.
