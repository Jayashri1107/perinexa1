# Perinexa — Project Rules & Summary

## Project summary
Perinexa is a web app for the medical field, built step by step for a non-technical owner.
- Tech stack: MERN — MongoDB (database), Express + Node (server), React with Vite (website).
- Folders: `/server` (Node + Express + Mongoose), `/client` (React + Vite + React Router).
- Phases:
  - Phase 0 – Check and set up the computer (Node LTS, npm, git, MongoDB).
  - Phase 1 – Base app: login (JWT in httpOnly cookie), admin-only user management, audit log, security basics, tests, 30-min inactivity logout.
  - Phase 2 – Interview the owner (one question at a time) → `docs/USE_CASE.md`.
  - Phase 3 – Propose features (V1 vs Later) and roles, get approval, then build one feature at a time (backend first, then frontend).
  - Phase 4 (from Oct 2026) – A developer makes it ready for commercial use. Start with `docs/HANDOVER.md`.
- Progress is tracked in `docs/PROGRESS.md`.

## Rules for every session
1. The owner is non-technical. Before each step, explain what you are doing and why in 1–2 plain sentences. No jargon without a simple explanation.
2. Ask before installing anything globally, deleting files, or running commands that change system settings.
3. Use ONLY fake/sample data. Never ask for real patient information. If the owner tries to enter real patient data, remind them not to until the app has been reviewed by an experienced developer.
4. Use git. Commit with a clear message after every working step.
5. Never put passwords, secrets, or API keys in the code. Use a `.env` file (listed in `.gitignore`) and keep a `.env.example` with placeholder values.
6. After finishing each feature, explain exactly how to test it in the browser.
7. Keep `docs/PROGRESS.md` updated: what's done, what's next, how to start the app.

## Working with the developer (from Oct 2026)
The owner hired a developer to take Perinexa to a commercial launch; she works with Claude Code. Her starting point is
`docs/HANDOVER.md` (code map, security model, single-server parts, owner decisions, DRAFT content).
- **Who is at the keyboard.** When the person says they are the developer, or the task is clearly hers, talk engineer to
  engineer: skip rule 1's plain-language explanations and rule 6's browser walkthroughs. Every other rule in this file
  still applies. When working with the owner, follow rules 1 and 6 as before. If unsure, ask once.
- **Feature freeze** until her health check (`docs/HEALTH_CHECK.md`) is done and she and the owner have agreed what the
  first commercial version contains. New ideas go on a list, not into the code.
- **Git.** One branch per task; merge into `main` only when `npm test` and `npm run build` pass and she has read the
  change. Stage only your own files (never `git add -A`). She pushes to GitHub herself (auto mode blocks `git push`).
- **Tests.** Only `npm test` from the project root. Never run a server test file without `server/vitest.config.js`
  (a run without it once dropped the development database); parallel copies use `PERINEXA_TEST_DB=<name>_test`.
- **No new dependency, tool or `npx` download** without her agreement.
- **Clinical content** (care-plan templates, risk and red-flag rules, the medicine safety list, lab ranges, consent
  forms, patient wording) changes only with the owner's approval – the owner is a doctor. DRAFT stays marked DRAFT.
- **Owner decisions** listed in `docs/HANDOVER.md` section 9 are not reversed without asking the owner.
- **Never weaken**: hospital separation (`tenantScoped`; `aggregate()` needs its own `tenantId` match), need-to-know
  record access, the audit log and its trimming, the fetal-sex protection, the neutral name for HIV tests, and the
  super admin never seeing patient data.
- **Real patient data** only after the go-live checklist in the handover plan is complete – and never in a Claude chat,
  a test, a fixture or a developer's computer.

## Look and feel
- The UI follows the Perinexa Brand & UI Guidelines v1.0 – see `docs/BRAND.md` (colours only from
  `client/src/styles/tokens.css`, status = colour + icon + word, one primary button per screen, no exclamation marks or emoji).

## Security expectations (medical app)
- Every data endpoint must check the user is logged in and has permission.
- Log access to sensitive records in the AuditLog.
- Never return password hashes. Deactivate users instead of deleting them.
- If a requested feature is a privacy/safety risk for patient data, say so clearly and suggest a safer way.
