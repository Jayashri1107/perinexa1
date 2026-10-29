# Ultrasound machine on the LAN – plan (DRAFT, 29 Oct 2026; built on branch `usg-machine`, not merged)

Written at the developer's request on 29 Oct 2026. It turns ideas 19 and 20 in `docs/IDEAS_FOR_LATER.md` (scan
images in the report; the machine sends its readings and images by itself) into a plan.

**Built on 29 Oct 2026 at the developer's request, on branch `usg-machine` (not merged)** – an exception to the
feature freeze: the owner's go-ahead is recorded here before merging. Not yet tried with a real machine or a real
Orthanc: the tests use a made-up structured report. What was built, step by step:

| Step | Where |
| --- | --- |
| 1. Scan bridge | `scan-bridge/` (bridge.mjs, README.md, orthanc.json, .env.example); the key: Hospital admin → Ultrasound machine (`server/src/routes/scanBridge.js`) |
| 2. Pictures | Scans → a study → From the machine → tick pictures → confirm no fetal sex → Add to the report; Scans → From the machine – not linked (`server/src/routes/imaging.js`, `client/src/pages/imaging/MachinePanel.jsx`) |
| 3. Readings and the average table | `server/src/imaging/machineReadings.js` (codes, units, rules – DRAFT); the table on the study; Fill the report with these values |
| 4. Final report | Review the final report → Finalise – sign and print (the report shows the machine's readings, unticked ones struck through, values changed by hand marked) |
| 5. Worklist | The bridge writes today's ultrasound orders for Orthanc's worklist plugin; each order gets a scan number (US00000001…) the machine sends back |

What arrives is kept `SCAN_BRIDGE_KEEP_DAYS` (30) in Perinexa and `ORTHANC_KEEP_DAYS` (30) on the bridge PC, then
deleted; what is used is copied into the scan. Questions 1, 3, 4, 6, 7 and 8 below are still open; the defaults used
are the ones proposed (average of the ticked readings; 30 days).

## What is asked for

1. The ultrasound machine is connected to the hospital network (LAN).
2. Pictures captured on the machine reach Perinexa; the sonologist picks the ones she wants for the report.
3. When a study from the machine is chosen, **all its readings appear** in Perinexa.
4. The sonologist chooses the template on Scans (`/scans`). Each measurement taken more than once shows every reading
   and an **average table** (the way dedicated sonography reporting software such as the one the developer named,
   "Scando", works). We build our own screens; we do not copy another product's.
5. Perinexa then asks the sonologist for the **final report**, she checks it and **finalises** (signs) it.

## What perinexa1 already has (reused, not rebuilt)

- Scans worklist and dashboard, scan orders per patient (`server/src/routes/imaging.js`,
  `server/src/models/ImagingOrder.js`, `client/src/pages/imaging/ImagingPages.jsx`).
- Eight DRAFT templates with their fields (`server/src/imaging/templates.js`).
- DRAFT calculations: gestational age from CRL or biometry, estimated fetal weight, weight centile (Hadlock), and the
  draft report sentences (`client/src/pages/imaging/usgCalc.js`).
- Pictures on a study: added by hand (JPEG, PNG, WebP, at most 5 MB), stored as `StoredFile`, never deleted, chosen for
  print, taken off with a reason.
- Signing; a signed report changed only with a reason (the earlier one kept); the fetal-sex filter on free text
  (`server/src/utils/pcpndt.js`); the audit log.

## How it would work

```
 Ultrasound machine ──DICOM over LAN──▶ Scan bridge PC (Orthanc) ──HTTPS──▶ Perinexa server ──▶ Scans screen
   "Send / Store"                        keeps studies for N days            pictures + readings
```

### Step 1 – the scan bridge (in the hospital)

- A small DICOM receiver on a PC in the hospital, on the same network as the machine. Proposal: **Orthanc**
  (free, open source, widely used in hospitals; runs as a Windows service). **New tool – needs the developer's
  agreement** (CLAUDE.md: no new tool without it).
- Why a bridge: the machine speaks DICOM, not web; the Perinexa server may be in the cloud
  (`docs/DEPLOY_AWS.md`), which the machine cannot and should not reach directly. Orthanc also turns DICOM pictures
  into JPEG, so the Perinexa server needs no DICOM package for pictures.
- The machine is set up once: Perinexa's bridge as a "DICOM storage" destination (its IP address, port, AE title).
  The sonologist presses the machine's **Send / Store** (or it sends at the end of each exam).
- Link to Perinexa: the bridge sends each new study to Perinexa over HTTPS with a per-hospital key (in `.env`, never
  in the code), or Perinexa reads from the bridge when the server is inside the hospital. Developer decides.
- Safety: the bridge accepts only the hospital's machines (AE title + IP list), keeps studies only a short time
  (e.g. 30 days; owner decides), and its disk is encrypted. It holds patient data: same rules as the server.

### Step 2 – pictures: choose from the machine (branch 1)

- On a study (Scans → open a study) a **From the machine** panel lists the studies received for this patient today:
  time, number of pictures, and thumbnails.
- Matching a machine study to a Perinexa scan order: by the patient ID typed on the machine (Perinexa's patient
  number), or by the worklist in step 5 (automatic). An unmatched study waits in an **Unmatched** list where a doctor
  links it to the right patient; nothing is linked by name alone.
- The sonologist ticks pictures → they are saved as the study's pictures through the existing pictures feature (same
  `StoredFile`, same print choice, same audit).
- PC-PNDT: a picture cannot be checked automatically for the baby's sex. Before pictures are added, the sonologist
  confirms "These pictures do not show the baby's sex." The confirmation is in the audit log.

### Step 3 – readings and the average table (branch 2)

- Most machines send their measurements as a **DICOM structured report (SR)** for obstetric and gynaecology exams.
  Perinexa reads it and matches each measurement to the template's fields (BPD, HC, AC, FL, CRL, MSD, NT, AFI, DVP,
  FHR, endometrium, follicles, Doppler indices …).
- Each machine brand codes its measurements differently (standard codes plus its own). The matching table is written
  per machine model, from a sample export (see the questions). A measurement Perinexa does not recognise is shown as
  "Not matched" – never dropped silently, never guessed.
- **Average table** on the report screen:

  | Measurement | Reading 1 | Reading 2 | Reading 3 | Used | Value | GA | Centile |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | BPD (mm) | 78.1 | 78.6 | 77.9 | Average | 78.2 | 31w 2d | – |
  | AC (mm) | 270.4 | 268.9 | – | Average | 269.7 | 31w 0d | – |

  - Each reading has a tick; the sonologist can untick a bad one, and the average changes.
  - "Used" is Average, Last or one chosen reading. The default (average or the machine's own choice) is the owner's
    decision.
  - GA and centile come from the existing DRAFT calculations in `usgCalc.js`.
- Pressing **Fill the report** puts the used values into the template's fields. The sonologist can still change any
  field by hand; a changed value shows it was edited after the machine.
- Stored on the study: the readings as received (each with the machine, time and the SR's ID), which were ticked, the
  rule used, and the final values. Nothing about the baby's sex is stored: any such item in the SR is dropped on
  arrival and the drop is logged without its value.

### Step 4 – final report and finalising (branch 2)

- After the fields are filled, Perinexa writes the draft report text (the existing `draftReport`), then asks:
  **Review the final report**. The screen shows the whole report as it will print – patient, template, the average
  table, findings, impression, the chosen pictures – with every sentence editable.
- **Finalise and sign** uses the existing sign step (doctor or RMO; owner decision of 19 Oct 2026 stands). After that,
  a change needs a reason, as now. Printing and sharing work as today.

### Step 5 – worklist to the machine (branch 3, optional)

- With a **DICOM worklist**, the machine shows the day's scan list from Perinexa: name, patient number, scan type. The
  sonologist picks the patient on the machine instead of typing, so pictures and readings match the right patient
  automatically. Orthanc can serve the worklist from files Perinexa writes for it.
- Sent to the machine: only what it needs (name, patient number, age, scan type, order number). Never anything about
  sex of the baby.

## If the machine cannot send over the network

Some machines only save to a USB stick or a shared folder. Then: pictures are added by hand as now (Perinexa could
also accept DICOM files dropped on the bridge's watched folder), and readings are typed. The average table still
works for typed readings (several boxes per measurement).

## Questions to answer before building

| # | Question | Who |
| --- | --- | --- |
| 1 | Go-ahead for this work during the feature freeze | Owner |
| 2 | Orthanc as the scan bridge (or another way) | Developer |
| 3 | Machine make and model; can it send DICOM storage and an OB/GYN structured report; can it read a worklist | Developer, with the machine's service engineer |
| 4 | A sample export from the machine with a **dummy patient** (pictures and SR). Never a real patient | Developer |
| 5 | Where the server runs (hospital PC or cloud); so how the bridge reaches it | Developer |
| 6 | Default for a measurement taken more than once: average, last, or the machine's own | Owner (clinical) |
| 7 | How long the bridge keeps studies (proposal: 30 days) | Owner |
| 8 | The match of machine measurements to template fields, and any new template fields | Owner (clinical), drafted by the developer |

## Build order (one branch each; merge only when `npm test` and `npm run build` pass)

1. **Pictures over the LAN** – the bridge, the "From the machine" panel, the unmatched list, the PC-PNDT confirmation.
2. **Readings and the average table** – SR reading for the hospital's machine model, the average table, Fill the
   report, Review the final report.
3. **Worklist** – only if the machine supports it and the owner wants it.

Tests for each branch use made-up DICOM samples (no real patient), kept as fixtures. Every template, matching table,
averaging rule and report sentence is clinical content: it stays marked **DRAFT** until the owner approves it.
