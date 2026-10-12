# Care plan – decisions for the doctor to review

The antenatal care plan (Feature 7) had to make some clinical and practical choices. Each one below is **already
built with the recommended default**, so the app works now. Please read them, and tell us which ones to change.
Nothing here has been reviewed by a doctor yet.

Where a number can be changed, the place is given (for the developer): `server/src/careplans/planRules.js`.

## Timing and statuses

1. **Colour of "Overdue".** Red, with a calendar icon and the word "Overdue" (the same red as High risk).
   The before-booking, decide and missed rules below leave only real misses. Choose amber instead if red next to the
   red High-risk badge confuses the doctors.
2. **Items due at booking** (booking bloods, Td – dose 1, counselling) count as overdue **14 days** after the booking
   date, to allow for reports. (`BOOKING_WINDOW_DAYS`)
3. **Items timed after another item** (for example Td – dose 2, 4 weeks after dose 1) are due for **14 days** from
   the earliest date. (`AFTER_WINDOW_DAYS`)
4. **Late booking, per type of item.** When she books after an item's window has passed:
   - visits show "Before booking";
   - advice is given at booking;
   - tests, scans, medicines and vaccinations wait for the doctor ("Decide"). (`LATE_START`)
5. **Missed visits.** When the next visit's window starts, an unattended visit stops being "Overdue" and shows as
   "Missed". It is counted on the card, stays off reminder lists, and can still be marked attended.
6. **Covered by the booking visit.** A visit whose window contains the booking date (the 16-week visit when she books
   at 16 w 3 d) counts as covered. The doctor can use "Plan now" to bring it back.
7. **Big EDD change.** More than **8 weeks** puts the plan on hold and asks "same pregnancy or new pregnancy?". A
   smaller change moves the dates by itself and shows under "Recent automatic changes". (`SAME_PREGNANCY_DAYS`)
8. **Past the EDD.** From EDD + 21 days (43 weeks) reminders stop and the plan asks whether she has delivered.
   (`POST_DATES_DAYS`)
9. **Booking date.** By default, the day the pregnancy dates are entered and the plan is built (normally the booking
   visit). Doctors can change it, from 4 w 0 d up to today. Please confirm that the dates are normally entered at the
   booking visit. (`MIN_BOOKING_DAYS`)
10. **Time zone.** "Today" follows India time (Asia/Kolkata) in all hospitals. This is a server setting
    (`HOSPITAL_TIME_ZONE` in `server/.env`).

## Draft and approval

11. **Plans while the template is a draft.** Plans are built anyway, always labelled "Draft – not approved for
    clinical use". A doctor must review and approve the template before any real use.
12. **Risk rules changed since approval.** The plan also shows the Draft label (the rules decide which high-risk items
    apply), with the reason, and high-risk items are marked "Based on draft risk rules". This does not apply when the
    doctor has overridden that patient's risk level.
13. **Which template a new plan uses.** The hospital standard template. The doctor can switch per patient to their
    own protocol or the assigned doctor's. A default protocol per doctor could come later. (Built in October 2026 –
    see Next in `docs/PROGRESS.md`: a new plan starts from the assigned doctor's default protocol for that type of
    care while it is approved as it is now, has items and its doctor still works here as a doctor; otherwise from
    the hospital standard template. Choosing, changing or removing a default never changes existing plans.)
14. **Template updates.** Each plan is updated separately, after a preview ("Update available"; "Approved v2 –
    replaced by approved v3"). "Apply to all plans" could come later. (Built in October 2026 – see Next in
    `docs/PROGRESS.md`: "Update plans to version N" on the template's page, for approved versions only – a protocol
    by its own doctor, the standard template by any doctor. The preview gives counts only; each plan is moved exactly
    as a single update and audited on its own. Closed plans, closed records and duplicate records are never
    touched; paused plans and other doctors' patients are left for one-by-one updates. An added item that may repeat
    another is marked "May repeat" until it is kept or one of the two is marked not needed.)

## Items that depend on the patient

15. **Missing information** (no blood group, risk Incomplete or "may be higher", conditions not confirmed): the
    dependent items show "Check needed" and the missing information is listed. They are not left out or added.
16. **Findings in this pregnancy** (GDM, high blood pressure, twins) are not detected automatically. The labels say
    "Pre-existing diabetes only" and "Chronic high blood pressure only"; for now the doctor uses "Include anyway".
    Recommended later: simple "this pregnancy" tick boxes that switch these items on.
    **Built on 4 Oct 2026 (see Next in `docs/PROGRESS.md`):** a doctor or RMO ticks five findings on the record (Edit
    details → Findings in this pregnancy: GDM, high blood pressure in this pregnancy, twins or more, low-lying
    placenta / praevia, bleeding). A tick counts for the risk level and switches on the items the template has
    "for" that finding. Nothing is ticked by the software. The two labels above keep their meaning; "Any diabetes"
    and "Any high blood pressure" were added. "Include anyway" stays for what the template has no item for.
    Still to decide: the DRAFT levels and items, and whether nurses may tick findings.
17. **Template content to check.** Several windows are only one week long (anti-D 28 w, repeat ICT 28 w,
    fetal-movement advice 28 w, visits 36–41 w). Some items overlap for late bookers: the booking OGTT at 24 weeks or
    later vs the repeat OGTT, and folic acid "until 12 weeks". Recommended: widen windows where clinically acceptable
    (for example anti-D 28–30 w). Overlaps are handled with "Not needed – covered by another item".

## Who can do what

18. **Nurses and vaccinations.** Nurses can only view the plan in Feature 7. Whether they may tick vaccinations as
    given (Td, Tdap, flu, anti-D) is decided with nurse vitals in Feature 8.
19. **Nurses see item notes and results** on the care plan. Doctors' record notes stay hidden from nurses, as today.
20. **RMOs can change any plan fully** (move, not needed, add items, switch to the assigned doctor's protocol). Every
    change is recorded.
21. **Reasons.** Required for:
    - Not needed with "Not indicated" or "Other";
    - Include anyway;
    - moving a date outside the guideline window;
    - Close plan.

    Optional elsewhere. Please confirm the Not-needed choices: Not indicated – doctor's decision · Patient declined ·
    Covered by another item · Window passed · Not available here · Other.
22. **Infertility patient who becomes pregnant.** The record stays "sensitive", so nurses can't see her pregnancy care
    plan. The treating doctor can remove the marking with "Remove sensitive". Should the app ask the doctor instead?
23. **Reception on the future overdue list** (Feature 10): name, patient number, phone, "overdue since" and a general
    category only (Visit / Test or scan / Vaccination), never item names such as "Anti-D" or "HIV test".

## Privacy and layout

24. **Words refused** in notes, results and templates, so that the baby's sex is never recorded (PCPNDT Act):
    - boy, girl, male, female, son, daughter, sex, gender;
    - ladka, ladke, ladki, ladkiyan, larka, larke, larki;
    - karyotypes such as 46,XY or XX;
    - the ♂ and ♀ symbols.

    The same list is used by voice entry. Doctors can suggest local words to add. A word list can be misspelt around,
    so staff training is still needed.
25. **The Care plan card is the first card** on the patient's Overview, above Risk level, because "what is due today"
    is the first question in OPD.

## Changed while testing (28 Sep 2026)

- A date the doctor **moved outside the guideline window with a reason** keeps the marker "Outside guideline window"
  but no longer asks for a decision again. Their reason is the decision. Only dates that an automatic change may have
  made wrong ("Check date") ask again.
- The "also due" list on the next-visit line shows three items and then "and N more".
- For a scan still months away that shows "Check needed", the row offers Include anyway / Not needed. The late-booking
  buttons (Plan now, Done elsewhere) are kept for items whose time has passed.
