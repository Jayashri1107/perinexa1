# Appointment booking – plan (approved and built)

Planned with the owner on 3 Oct 2026, approved the same day and built (server, then screens). How to test it:
`docs/PROGRESS.md` → "How to test appointment booking".

Added while building: saving a doctor's OPD timings also gives next visits that were waiting for a time the first
free slot (fewer for reception to do by hand); a **Walk-in token** button on Today finds the patient first.

## The owner's answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | How do patients get an appointment? | **Both**: time slots for booked patients, token numbers for walk-ins |
| 2 | Slot length | **10 minutes** |
| 3 | OPD timings | **Each doctor sets their own** days, hours and leave |
| 4 | Who books, moves and cancels | **Reception and doctors** (not RMOs, nurses or lab staff) |
| 5 | Doctor sets "Next visit: 15 Oct" on a visit | **The app books the first free slot** that day with the same doctor; reception can move it |
| 6 | Token numbers | **Per doctor, per day** (1, 2, 3 … through the whole day) |
| 7 | Booked and walk-in patients both waiting | **Booked patients go in at their time**; walk-ins fill the gaps in token order |
| 8 | Messages to the patient | **Yes, SMS/WhatsApp** on booking, change and cancellation, plus the reminder the day before |
| 9 | A new patient phones to book | **Quick booking** with name and phone; full registration when she arrives |

## How it will work

### 1. Each doctor's OPD timings (My account → OPD timings)
- For each day of the week, one or more sessions, e.g. Mon–Sat 10:00–13:00 and 17:00–20:00; Sunday off.
- **Leave days** (a single day or a range, e.g. 20–24 Oct). The app warns if appointments are already booked on those
  days and lists them so reception can move them.
- The sessions are cut into **10-minute slots** (one hospital setting, so it can change later).
- *Default chosen (can change):* the hospital admin can also enter a doctor's timings, for doctors who would rather
  not do it themselves.

### 2. Booking a time slot (new **Appointments** page for reception and doctors)
- Pick a doctor and a day → see that doctor's slots: free, booked (patient name) or past.
- Click a free slot → find the patient (name, phone or patient number) → book. Optional visit type: **New,
  Follow-up, Scan, Other** – deliberately no medical details, as reception must not see them.
- **Move** (pick another day or time) and **Cancel** (with a short reason: patient asked, doctor on leave, other).
- **Quick booking for a new patient:** name and phone only. She shows as "Not registered yet". When she arrives,
  reception presses **Register** and the form opens with her name and phone already filled in. The booking then
  joins her record.
- *Default chosen:* a slot that is already taken can still be booked, after a warning ("10:20 is already booked
  for … – book anyway?"), because clinics squeeze in urgent patients. The doctor's day shows the double booking.
- *Default chosen:* booking outside the doctor's OPD hours or on a leave day is refused. The page suggests the next
  day the doctor is available.

### 3. "Next visit" on a visit books automatically
- When a doctor saves a visit with "Next visit: 15 Oct", the app books the **first free 10-minute slot on 15 Oct
  with the patient's assigned doctor** (or the doctor who saved the visit, if none is assigned). The visit page
  shows "Booked: 15 Oct, 10:30 with Dr. A".
- If that doctor is not working that day, is on leave or has no free slot, the booking goes on a **"Needs a
  time"** list on reception's Today page. The doctor sees "Reception will give a time".
- Changing the next-visit date moves this booking. Clearing it cancels the booking. A booking that reception has
  already moved by hand is left alone, and the doctor sees a note.

### 4. Walk-ins and tokens (Today page)
- A patient who comes **without a booking** gets a **token** when reception marks her arrived: Dr. A's tokens run
  1, 2, 3 … for the whole day, Dr. B's separately. Reception picks the doctor (the assigned doctor is chosen first).
- A printable **token slip** (hospital name, doctor, token number, date – no medical details).
- Booked patients are marked **Arrived** as today, and keep their slot time.

### 5. The doctor's waiting list (Today page, per doctor)
- One list per doctor in the order they will be called: a **booked patient whose slot time has come** goes first
  (earliest slot first); in between, **walk-ins in token order**. A booked patient who comes early waits until her
  slot time. One who comes late goes in at the next gap.
- The top line is marked **Next**. The doctor (or nurse) can still call anyone. Starting the patient's visit
  marks the appointment **Seen**.
- *Default chosen:* at the end of the day, booked patients who never arrived are marked **Did not come**. They
  then appear on reception's **Overdue** call list, as missed visits do today.

### 6. Messages to the patient
- **Only for patients who agreed to messages** (the consent already recorded at registration). The messages use
  the SMS/WhatsApp set-up already built, in her language (English, Marathi or Hindi).
- On **booking, moving and cancelling**: hospital name, day, time, doctor's name, and the hospital phone. **Never
  any medical detail.**
- The **day-before reminder** now includes the time and the doctor.
- *Default chosen:* a quick booking (not registered yet) has no message consent on record, so no message is sent.
  Reception tells her on the phone. Messages start once she is registered and has agreed.

### 7. Who sees what
| Role | Appointments |
| --- | --- |
| Reception | Book, move, cancel, tokens, waiting lists – names, phone, patient number, doctor, time, visit type only |
| Doctor | Book, move, cancel; their own day and waiting list; other doctors' days (names and times only) |
| RMO, nurse | See the waiting lists (to call patients in); cannot book |
| Lab staff, hospital admin (alone) | No appointments |
| Super admin | Numbers only (bookings, walk-ins, "did not come" per hospital) |

Every booking, move, cancellation, token and status change is written to the **audit log**.

### 8. What changes in the existing parts
- **Calendar:** shows appointments with their time and doctor instead of the next-visit date alone.
- **Today:** "Needs a time", the per-doctor waiting lists, tokens, and "Did not come".
- **Patient record:** an **Appointments** tab (upcoming and past, with status).
- **Patient portal, reminders, AI brief:** use the appointment (day, time, doctor).
- **Existing fake next-visit dates** are turned into appointments once, automatically.

## Build order (each step tested and committed)
1. Server: OPD timings and leave per doctor; 10-minute slots.
2. Server: appointments (book, move, cancel, quick booking, double-booking warning), audit log.
3. Server: next visit → automatic booking; "Needs a time"; end-of-day "Did not come".
4. Server: tokens and the per-doctor waiting order; Calendar, Today, portal, reminders and AI brief read appointments.
5. Server: messages on booking, moving and cancelling.
6. Screens: OPD timings; Appointments page; Today (tokens, waiting lists, token slip); patient Appointments tab;
   Calendar.
7. Fake demo data, then how to test it in the browser (written in `docs/PROGRESS.md`).

## Not included (could come later)
- Patients booking online by themselves (through the portal).
- Paying a fee when booking.
- A waiting-room display screen or calling tokens out loud.
- Different slot lengths by visit type or by doctor.
