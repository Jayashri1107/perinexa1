# Perinexa1

A hospital platform (MongoDB, Express, React, Node), built **one module at a time**, following the flow of Perinexa.
Fake sample data only.

| # | Module | Status |
| --- | --- | --- |
| 1 | **Main admin** (super admin): login, dashboard, hospitals, users & access, master data, audit log | Done |
| 2 | Hospital admin workspace (staff, settings of one hospital) | Next |

## Run it

Needs Node LTS and MongoDB running on this computer (the Windows "MongoDB" service). The project uses its own
database, `perinexa1`.

```bash
npm install
npm run seed     # first super admin + starting master data (safe to run again)
npm run dev      # website http://localhost:5174 · API http://127.0.0.1:5000/api
```

First login: the email and password under `seed.superAdmin` in `config/local.json`. The app then asks for a new password.

Other commands: `npm run build` (website build), `npm run db:evaluate` (checks that every main query uses an index).

## Settings – `config/`, no .env file

| File | In git | Holds |
| --- | --- | --- |
| `config/default.json` | yes | every setting: ports, database, session time, password rules, pagination sizes, roles, master-data lists, dashboard sizes, starting data |
| `config/local.json` | **no** | secrets and this computer's overrides (`auth.jwtSecret`, `seed.superAdmin`) – copy `local.example.json` |
| `config/loadConfig.js` | yes | merges the two (local wins) |

The server checks all settings at start-up (`server/src/config/index.js`) and stops with a clear message if one is
wrong. The website gets the non-secret ones from `GET /api/meta`, so nothing is repeated in its code.
Production: set `auth.cookieSecure` to `true` (HTTPS) in that server's `config/local.json`.

## Folder structure

```
config/                     settings (see above)
server/
  scripts/                  seed.js, evaluate-queries.js
  src/
    index.js, app.js        start-up; app.js mounts every module from modules/index.js
    config/                 reads and checks config/*.json
    core/                   shared: pagination, aggregate stages, validation, password, session (JWT), errors
    db/                     connection, query timer (slow-query warnings)
    middleware/             auth guards, rate limits, error handler
    modules/
      index.js              the list of modules: path + who may call it + router
      <module>/
        <name>.model.js       Mongoose schema and indexes
        <name>.validation.js  what the browser may send (zod)
        <name>.service.js     the work: list (aggregate) / get / create / update / status
        <name>.controller.js  reads the request, calls the service, sends the answer
        <name>.routes.js      the module's addresses only
client/src/
  api/                      http.js (one fetch wrapper), resource.js (standard CRUD calls), index.js (one entry per module)
  context/                  app settings (from /api/meta), login session
  hooks/                    usePagedList, useForm, useOptions, useIdleLogout
  components/
    form/                   FormBuilder, FormField, FormModal – every form
    list/                   ListPanel = ListToolbar + DataTable + Pagination – every list
  forms/                    each form described as data (fields, empty values)
  config/navigation.js      the menu
  layout/, routes/, pages/<module>/, styles/ (tokens.css holds every colour)
```

## How the main admin module works

- **Login** (same rules as Perinexa): no sign-up; JWT in an httpOnly, sameSite=strict cookie; bcrypt; temporary
  password must be changed at first login; 30 minutes without activity logs out (website and server); 10 failed
  tries in 15 minutes are blocked; logout and password change end the session on the server (`tokenVersion`);
  every attempt is in the audit log.
- **Accounts**: the super admin creates hospitals (optionally with the first hospital admin), super admins and staff.
  New accounts get a temporary password shown once. Accounts, hospitals, staff access and master data are
  deactivated, never deleted. There is always at least one active super admin and one admin per hospital.
- **Main super admin**: the first super admin (made by the seed, `isPrimary`) is protected – nobody else can edit,
  deactivate or reset it. Only the main super admin creates super admins or changes other super admin accounts;
  every super admin can manage hospitals and staff.
- **Lists**: every list is one aggregate – `$match` → `$sort` → `$facet` (the page + the total) – with joins
  (`$lookup`) only for the rows on the page (`server/src/core/pagination.js`).
- **Consolidated views**: the dashboard (platform totals, staff by role, largest hospitals, master data, recent
  activity), a hospital with its departments and staff per role, and each user with all their hospitals and roles.
- **Master data**: one collection for every list; the lists are named in `config.masterData.types`.

## Add the next module

1. `server/src/modules/<name>/` with model, validation, service, controller, routes (copy `masterData/`).
2. One line in `server/src/modules/index.js` (path, access, router).
3. One entry in `client/src/api/index.js` (usually `createResource('/<path>')`).
4. A field list in `client/src/forms/`, a page in `client/src/pages/<name>/` using `ListPanel` and `FormModal`.
5. A menu line in `client/src/config/navigation.js` and a route in `client/src/App.jsx`.
6. New audit events in `server/src/modules/audit/audit.actions.js`; new indexes checked with `npm run db:evaluate`.
