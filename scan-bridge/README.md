# Scan bridge – the ultrasound machine on the LAN

Plan: `docs/USG_MACHINE_PLAN.md`. The bridge runs on one PC in the hospital, on the same network as the ultrasound
machine:

```
 Ultrasound machine ──DICOM (LAN)──▶ Orthanc (this PC) ◀──REST──▶ bridge.mjs ──HTTPS──▶ Perinexa
   Send / Store                        stores the study             sends readings + JPEGs   Scans → the study
   Worklist query ◀──────────────────  worklist plugin  ◀── .wl files ◀── today's ultrasound orders
```

- **Orthanc** (free, open source, https://www.orthanc-server.com) receives what the machine sends and answers its
  worklist query. It is a separate program the hospital installs – the developer agreed to it before it is used.
- **bridge.mjs** (this folder, Node 22 or later, no packages) sends each finished study to Perinexa and writes the
  worklist. It signs in to Perinexa with the hospital's bridge key.

Nothing here is tested against a real machine yet: check each step below with the machine's service engineer, using
a **dummy patient** only (never a real patient while setting up).

## Try it without a machine (demo, sample data only)

`demo.mjs` plays the machine and the bridge once: it sends a made-up study – repeated readings (BPD three times and the
machine's mean, HC, AC and FL twice, heart rate, AFI, deepest pocket, one measurement Perinexa has no field for) and three
generated pictures marked SAMPLE – for the first ultrasound order on today's worklist.

1. In Perinexa as the hospital admin: Hospital admin → **Ultrasound machine** → **Make a key**, copy it.
2. Copy `scan-bridge/.env.example` to `scan-bridge/.env`; set `PERINEXA_URL=http://localhost:4001` (the server of this
   copy) and `BRIDGE_KEY=` the key. The Orthanc lines are not needed for the demo.
3. As a doctor, order an ultrasound scan for a sample patient (her Lab tab → Order a scan, e.g. USG – growth).
4. Run `node scan-bridge/demo.mjs` (or `node scan-bridge/demo.mjs P-000123` for a patient without an order).
5. Sonography → open her scan → **From the machine**: the pictures and the average table. **Mark done**, tick pictures,
   confirm, **Add to the report**; untick a reading or change a rule, **Fill the report with these values**; **Write the
   report from the readings**, **Save**; as a doctor **Review the final report** → **Finalise – sign and print**.

Never run the demo against a live hospital: it adds a made-up study to the patient's scan list.

## 1. Perinexa: make the key

Hospital admin → **Ultrasound machine** → **Make a new key**. Copy it: it is shown once. Making a new key later
stops the old one (do this if it is ever shared by mistake); **Switch off** stops the bridge.

## 2. The PC

1. A Windows PC that stays on, on the machine's network, with a fixed IP address. Encrypt its disk (BitLocker): it
   holds patient pictures.
2. Install Orthanc for Windows (with its plugins, which include the worklist plugin).
3. Copy `orthanc.json` from this folder over Orthanc's configuration and change every `CHANGE_ME`:
   - `DicomModalities` → the machine's AE title, IP address and port (from the machine's network settings);
   - `RegisteredUsers` → a long password for the user `bridge`.
   `RemoteAccessAllowed: false` keeps Orthanc's web page to this PC only; `DicomCheckModalityHost` and
   `DicomAlwaysAllowStore: false` accept studies only from the listed machine. Restart the Orthanc service.
4. Install Node 22 (LTS), copy this `scan-bridge` folder to the PC, copy `.env.example` to `.env` and fill it in
   (Perinexa's address, the key, Orthanc's user and password, the worklist folder).
5. Run `node bridge.mjs` in the folder. It prints "Scan bridge running". To start it with Windows, make a Task
   Scheduler task "At startup" that runs `node C:\PerinexaBridge\scan-bridge\bridge.mjs` (or use a service wrapper the
   developer chooses).

## 3. The machine (with its service engineer)

1. **Storage (send)**: add a DICOM storage destination – AE title `PERINEXA`, this PC's IP address, port `4242`. Turn on
   sending the **structured report** (often called "OB report", "SR" or "measurement report") with the images. Use
   "Send / Store at end of exam" or the Send button.
2. **Worklist** (if the machine has it, "DICOM Modality Worklist"): AE title `PERINEXA`, this PC's IP, port `4242`.
   The machine then lists today's ultrasound orders from Perinexa; choosing the patient there fills her name, patient
   number and the scan number (accession number), and the study comes back matched to the order.
3. Test with a dummy patient: in Perinexa, order a scan for a sample patient, wait for the worklist (2 minutes), pick her
   on the machine, take a few measurements (several readings of BPD, for example) and a few still pictures, end the exam.
   About a minute later (Orthanc waits `StableAge` seconds for the study to finish) the study shows on her scan in
   Perinexa → **From the machine**.

Without a worklist, staff type her **patient number** (e.g. P-000123) in the machine's patient ID field. A study with
neither waits on Scans → **From the machine – not linked** for staff to link it.

## What the bridge sends, and keeps

- To Perinexa: each study's identity as typed on the machine, the machine's make and model, its structured reports
  (only measurements are read; anything about the sex of a fetus is dropped by Perinexa) and a JPEG of each still
  picture. Video clips are not sent.
- On this PC: Orthanc's copy of each study, deleted by the bridge after `ORTHANC_KEEP_DAYS` (30 by default); the
  worklist files; `bridge-state.json` (the last Orthanc change sent – no patient data).
- In Perinexa: what arrived is kept `SCAN_BRIDGE_KEEP_DAYS` (server/.env, 30 by default), then deleted. Pictures and
  readings the sonologist used are copied into the scan's record and kept with it.

## To check against the real machine (DRAFT)

- The measurement codes in `server/src/imaging/machineReadings.js` (`MACHINE_FIELDS`): compare with the machine's DICOM
  conformance statement and its sample report. A measurement Perinexa does not recognise shows as "not matched" on the
  study; add its code there (owner approval: clinical content).
- Whether the machine marks its own average ("Mean") – the table shows it as "Machine".
- Orthanc's `/tools/create-dicom` makes the worklist files; check the machine reads them (Orthanc's worklist plugin
  documentation describes the tags it needs).
