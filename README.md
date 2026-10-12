# Perinexa

A web app for the medical field, built with MongoDB, Express, React and Node (MERN).

> ⚠️ **Development version. Use fake/sample data only.** Do not enter real patient information
> until the app has been reviewed by an experienced developer.

## Start the app (everyday use)

In a terminal, inside this folder, run:

```bash
npm run dev
```

This single command starts the database, the server and the website. Then open
**http://localhost:5173** in your browser.

To stop the app, click in the terminal and press **Ctrl + C**. The database keeps running in the
background (it uses very little). To stop it too:

```bash
npm run db:stop
```

## First-time setup (only once, on a new computer)

You need Node.js (LTS), git and MongoDB Community Server installed.

1. Download the building blocks: `npm install`
2. Create your private settings file: copy `server/.env.example` to `server/.env`. No password or secret key is
   typed there: the secret key for login sessions is made automatically on the first start. Never share or commit
   `server/.env`.
3. Prepare the database: `npm run seed`
4. Start the app: `npm run dev` and open it. On the very first start it asks you to **create the first super admin**
   (your name, email and password). After that, the super admin creates every other account in the app.

## How hospitals (tenants) work

- A **super admin** creates hospitals and every account, and tags people to hospitals with roles. Super admins
  manage the platform and each hospital's setup, but cannot see patient data.
- A **platform admin** sees what a super admin sees, view only; the super admin ticks what they may change
  (Users & access → User permissions).
- Each hospital's data is labelled with its `tenantId`, so hospitals never see each other's data.
- One person can work at several hospitals; a dropdown at the top right lets them switch. Everything they add
  (e.g. patients) goes into the hospital currently selected.
- A hospital's **admin** manages that hospital's staff (new people are added by the super admin) and sees that
  hospital's audit log.

## Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs the automatic checks for login and admin features (uses a separate test database). |
| `npm run seed` | Prepares the database (safe to run again). The first super admin is made in the app. |
| `npm run db:start` / `npm run db:stop` | Starts / stops the local database. |
| `npm run build` | Builds the website for production. |
| `npm run export:hospital` | Takes one hospital's data out into a folder (server operator only – see below). |

## Taking a hospital's data out (for the person who runs the server)

For a move to another system, a legal request or an off-site copy, every record of **one** hospital can be
written to a folder. This is not a button in the app on purpose: one folder with every patient is the riskiest
thing Perinexa can make, so only the person who runs the server can do it, from a terminal in this folder:

```bash
npm run export:hospital -- --hospital "<exact hospital name>" --out "<folder>"
```

- `--hospital`: the hospital's name exactly as on the platform's Hospitals page (capitals included).
- `--out`: a **new or empty** folder **outside** this project folder, best on an encrypted disk. Any other
  folder is refused, so the data can never end up in git or on the website.
- You are asked to type the hospital's name again before anything is written.

The folder gets one `.json` file per kind of record of that hospital only (patients, visits, care plans, lab
orders, stays and their documents, the nursing chart, consent forms, appointments, bills, the pharmacy, the
hospital's audit log, the staff's names and roles …), a `files` folder with the stored files (lab report
files, scanned signed consent forms) and a `README.txt` that says what each file is, when it was made and how
many records each holds. Never in it: passwords or password hashes, sign-in sessions, patient portal codes, the
waiting-room screen key, staff e-mail addresses, another hospital's data, or anything from `server/.env`. The
export is recorded in that hospital's audit log as "Hospital data exported by the server operator" (counts only).
If anything goes wrong, or you press Ctrl + C, what was written is removed again.

> **Warning:** the folder holds confidential patient data and is **not encrypted**. Keep it only on an
> encrypted disk, give it only to the people it is for, and delete it as soon as it is no longer needed.
> Best run when nobody is using Perinexa (for example at night), so that all the files match each other.

## How it is organised

```
server/   Node + Express + Mongoose – the "back office": stores data, checks logins and permissions
  src/models/       What is stored (Tenant = hospital, User, Membership, Patient, AuditLog)
  src/routes/       The addresses the website talks to (/api/auth/…, /api/admin/…)
  src/middleware/   Checks run on every request (logged in? admin? errors)
  scripts/seed.js   Prepares the database
  tests/            Automatic checks
client/   React (Vite) – the website you see in the browser
  src/pages/        One file per screen
  src/auth/         Login state, page protection, 30-minute inactivity logout
docs/     Progress notes and project documents
```

## Security features (so far)

- Login cookie is `httpOnly` (not readable by JavaScript), `sameSite=strict`, and `secure` (HTTPS-only) in production.
- Passwords are stored only as bcrypt hashes and never sent back by the server.
- No public sign-up; only admins create accounts. New/reset accounts must change their password at first login.
- Login attempts are rate-limited; failed logins are recorded.
- Automatic logout after 30 minutes of inactivity (both in the browser and on the server).
- Users are deactivated, never deleted. Admins can't demote/deactivate themselves; the last active admin can't be removed.
- Audit log of logins, failed logins and all account changes. Entries can't be edited or deleted through the app.
- helmet security headers, CORS limited to the website address, input validation (zod), central error handling.
