# Perinexa look and feel (brand rules for the app)

The app follows the **Perinexa Brand & UI Guidelines v1.0** (September 2026, owner Docvritta). The live version of
those rules, the logos and the fonts is the **Perinexa design system** in Claude; the PDF is a snapshot.

## Where things live
| What | Where |
| --- | --- |
| Every colour, size, radius, shadow and font (the guide's token sheet) | `client/src/styles/tokens.css` |
| Page text and headings | `client/src/styles/base.css` |
| Buttons, inputs, cards, status pills, alerts, tables, dialogs | `client/src/styles/components.css` |
| Sidebar, title bar, login screen, tablet and phone layouts | `client/src/styles/layout.css` |
| Screen-specific styles | `client/src/styles/pages-*.css` (one file per area) |
| Shared React pieces (`StatusPill`, `Avatar`, `KpiCard`, `ConfirmDialog`/`useConfirm`, `FieldError`, date formats) | `client/src/components/ui.jsx` |
| Logos, app icon, fonts (Jost, Mukta) | `client/src/assets/brand/`, `client/src/assets/fonts/` (bundled, works offline) |

## Rules for every new screen
1. **Colours only from tokens.** No hex or rgb values outside `tokens.css`, no gradients. A new colour or component goes into
   the brand guide first, then into `tokens.css`.
2. **Mist canvas, white cards.** Everything the user works on sits on a white card.
3. **One primary button per screen** (Perinexa Indigo). Others: secondary (white, indigo border), link (e.g. Cancel),
   positive (Deep Teal), destructive (Alert Red – usually inside the confirmation dialog). Buttons and click targets are 44 px.
4. **A status is always colour + icon + word**: `<StatusPill tone="stable|due|admitted|watch|high|inactive">`.
   Risk: High-risk (high), Moderate-risk (watch), Low-risk (stable), Incomplete (inactive). Roles and types are neutral tags.
5. **Teal marks what is scheduled or connected** (visits, reminders, due dates) – never decoration. White text never on Nexa Teal.
6. **Type scale**: screen title 40 px, card titles 22 px, body 15 px, labels 13 px; nothing smaller than 13 px except 12 px captions.
7. **People in lists get initials avatars** – never photos (privacy, DPDP Act).
8. **Voice: doctor to doctor.** Short, specific, clinical. No exclamation marks, no emoji. Errors say what to fix.
   Decision support: the consultant decides. Only claim features that exist.
9. **Formats**: dates `12 Oct 2026` (`formatDate`), date + time `12 Oct 2026, 10:30` in 24-hour (`formatDateTime`), gestation `28 w 3 d`.
10. **Check every new screen at 1366 × 768** (the common clinic monitor), and at tablet (icon rail under 1024 px) and phone width.
11. **Who is logged in, and in which hospital, is shown only in the sidebar card below the logo** (initials avatar, name,
    role, hospital, Switch hospital). Page headers never repeat the person's name or the hospital's name (one exception,
    at the owner's request: the Dashboard title "Welcome, Dr. …"): no hospital in
    the breadcrumb path (a one-step path is not shown), no "You are working in …" notices, nothing at the top right
    except "Fake sample data only". On the icon rail the avatar's tooltip gives the name, role and hospital.

## Dashboard look (owner's request, 8 Oct 2026)
A calm, premium clinical dashboard: deep indigo sidebar, soft lavender-blue canvas, white cards, no gradients.
- **Canvas**: Mist `--mist-100` #E9EBF8 (soft lavender-blue); Mist Light `--mist-50` #F5F6FD.
- **Cards** (`.card`, `.panel`, `.kpi`, `.dt-card`, filter bars): white, **24 px corners** (`--radius-lg`), a subtle 1 px
  edge (`--card-border`) and a soft two-layer shadow (`--shadow-card`). Every card has the same corners – table cards
  too. 28 px (`--radius-xl`) only for dialogs and the sign-in card. Boxes inside a card: 12 px (`--radius-md`); inputs 8 px.
- **Pastel icon tiles**: a KPI card shows its icon in a 44 px rounded tile tinted with its status colour (neutral:
  Lavender Wash `--indigo-100`), the word beside it in the status colour – still colour + icon + word.
- **Pill-shaped filters**: quick filters, calendar type toggles, the tab track and the patient search box are pills.
  The active filter or tab is solid Perinexa Indigo with white text.
- **Selected = one look everywhere**: anything picked from a set of choices (option cards, time slots, a prescription
  set, a calendar day, a chosen row) is Teal Wash (`--selected-bg`) with a 1.5 px indigo edge (`--selected-edge`).
  Filters and tabs are not selections – they use the solid indigo active state above.

## Personal look (My account → Appearance)
Each person can change how the app looks for them; it is saved to their account and follows them to every
computer (logging out goes back to the standard look). The standard look is the brand as described above.
- **Colour templates** (`[data-theme]` in `tokens.css`): Perinexa Indigo (standard), Ocean blue, Forest green,
  Plum, Burgundy, Slate grey and High contrast. A template changes only the Perinexa Indigo family (`--indigo-*`:
  sidebar, primary buttons, headings, links, active states), `--ink`, the Mist canvas tint and the shadow tint.
  **Never changed**: status colours, Nexa/Deep Teal (what is scheduled, positive "Approve" buttons), Alert Red and
  everything printed. There is deliberately no teal template: teal already means "scheduled" and "approve".
  Every template keeps text at 4.5:1 or more (WCAG AA; body text 7:1) – check any new one the same way.
  High contrast also darkens secondary text and borders and swaps soft shadows for outlines.
- **Text size** (`[data-text-size]`): the whole type scale (`--fs-*`, `--lh-*`) × 0.9, 1, 1.125 or 1.25. So every
  screen must take its sizes from the type tokens – never a fixed px font size. Print sizes never change.
- **Spacing** (`[data-density="compact"]`): smaller `--space-3` to `--space-12`, 56 px table rows, 44 px inputs;
  click targets stay at least 44 px.
- **Font** (`[data-font]`): Jost (standard), Mukta, or the computer's own system font – all offline. Paper always
  uses `--font-print` (Jost, with Mukta for Hindi and Marathi).
- **Animation off** (`[data-motion="off"]`, and computers set to reduce motion): no transitions or animations.

## Patterns
New patterns are added here (and to the design system) before a screen uses them.

### Today divider row (care plan, Feature 7)
A full-width row inside a dated table that shows where **today** falls between past and future items.
- **Use it** only in lists sorted by date, between the items that start on or before today and the later ones.
  One per table, never at the very top or bottom (then it adds nothing).
- **Looks**: a table row spanning every column, a 2 px Nexa Teal top line (`--teal-500`), the label in Deep Teal
  (`--teal-700`), 13 px / 500 with a `CalendarDays` icon: **Today · 18 w 0 d** (date or gestation, tabular figures).
  No fill, no status colour – teal marks what is scheduled, so it is the right accent for "now".
- **Accessible**: a real `<tr>` with one `<td colSpan>`; the words carry the meaning (not only the line).
  It is not clickable and has no actions.
- **Phone**: stays a full-width line between the stacked item cards.
- **CSS**: `.plan-today-row` in `client/src/styles/pages-careplans.css`.

### Text button inside a sentence (care plan, Feature 7)
A tertiary action that belongs to one message, e.g. "Hb marked done (14 Sep 2026). **Undo**", "Review changes",
"Try again".
- **Use it** only inside an Alert's sentence, for the one action that message offers. Everything else uses a normal
  button on its own line.
- **Looks**: the tertiary (link) button – Indigo, underlined – at the size of the text, so the line keeps its height.
- **Click target**: still 44 px. The button keeps the 44 px minimum width, and an invisible layer makes the click
  area 44 px tall (the same technique as a care-plan item name).
- **CSS**: `.btn-link.plan-inline-link` in `client/src/styles/pages-careplans.css`.

### Printed documents (care-plan copies, consent forms)
Anything printed from the app: A4, print-friendly, the same look on every document.
- **Print preview first**: the document is shown over the whole app with **Print** (the one primary button) and
  **Close**; only the document is printed, never the app around it. Component: `PrintPreview` and `PrintDocument`
  in `client/src/components/print/PrintPreview.jsx`.
- **Paper**: A4 with 12 mm margins; black text (`--print-ink`) on white; Jost, with Mukta for Hindi and Marathi;
  thin grey rules (`--print-rule`); sizes from the print tokens (`--fs-print-*`) in `tokens.css`.
- **Top of the first page**: the hospital letterhead, the title centred, then the patient's details as a label /
  value grid (`PrintFacts`).
- **Every page repeats** the footer line (patient's name and number, printed when and by whom) and – for anything
  not approved – the **Draft band**: a watch-colour border, triangle icon and the words, e.g. "Draft – not approved
  for clinical use". Loose pages still say whose they are and that they are drafts.
- **Colour only where it means something, and never alone**: the next check-up in a Deep Teal box with a calendar icon
  (teal marks what is scheduled); the Draft band. Everything reads the same in black and white.
- **Privacy**: the browser tab title while printing names the document ("Care plan – patient copy"), never the
  patient – browsers can print it in the page header.
- **CSS**: `client/src/styles/print.css` (`.pv*` preview, `.pdoc*` paper).

### Bilingual printed form (consent forms)
- English in the left column, Marathi or Hindi in the right, **clause by clause**, each clause numbered once, so the
  patient reads her language and the doctor or a witness can check both line by line.
- Printed labels in both languages: "Signature / सही". Values filled in from the record, or typed by the doctor, in
  bold; an empty blank prints as a line to fill in by hand. Signature boxes two by two.
- On a phone the preview stacks the two languages; paper always keeps them side by side.
- **CSS**: `.pdoc-clauses`, `.pdoc-sig*`, `.pdoc-line` in `print.css`.

### Printed prescriptions (10 designs, Feature 8)
Built on the printed-documents pattern above (preview first, the footer on every page, the tab title names the
document, never the patient). The designs are listed in `docs/PRESCRIPTIONS.md`.
- **The doctor's accent colour** – the only colour a user chooses, and only on paper (it is their stationery; on
  screen, colours keep their meanings). Five print accents, dark enough to read in black and white, each with a
  light tint for table headers and bands: Indigo `--rx-indigo` #302A78, Teal `--rx-teal` #0A7064, Maroon
  `--rx-maroon` #7A1F3D, Green `--rx-green` #2E6B34, Charcoal `--rx-charcoal` #33333D (tints: `--rx-*-tint`).
  The accent colours headings, rules, the ℞ and the next-visit box; body text stays `--print-ink`.
- **Sizes in em**, so "Large" text (`--fs-print-large`, 12.5 pt) and half-page A5 (`--fs-print-compact`, 9.5 pt,
  `--print-sheet-width-a5`) scale the whole page.
- **Instructions in two languages**: the English line, then the Marathi or Hindi line under it (Mukta); numbers
  and 1-0-1 patterns stay as they are. Headings read "Advice / सल्ला".
- **Dose chart**: Sunrise, Sun, Sunset and Moon icons with the time of day in both languages; a dash where the
  medicine is not taken.
- **The signature never stands alone on a page** (`break-before: avoid`); a medicine or table row never splits.
- **The doctor's own printed pad**: blank top and bottom margins in mm (`@page`, through `PrintPreview`'s `page`
  prop); on the design page, grey bands stand for the pad's own header and footer.
- **CSS**: `client/src/styles/print-rx.css` (`.rx*`); the design page `.rxd*` in `pages-visits.css`.

### Choose from a library (prescription sets, Feature 8b)
A wide dialog for picking one item from a library and seeing what it will do before it is used.
- **Left**: a search box, then a radio list grouped by what fits the patient ("For antenatal patients", then
  "Other sets"); each option shows its name, what it holds in Slate, and the Draft pill when it is a draft. The
  chosen option is tinted Teal 100, like a chosen design.
- **Right**: the preview – the name, a Draft warning (watch) or "Approved by …", and exactly what will be added,
  with anything it replaces said in words. Nothing changes until the one primary button ("Add to prescription");
  Cancel is a link.
- On a phone the list comes first with its own short scroll, then the preview.
- **CSS**: `.rxs-picker*`, `.rxs-option*`, `.rxs-preview*` in `client/src/styles/pages-visits.css`.

### Blank chip (consent-form page)
Shows what a blank such as `{patient}` becomes when the form is printed ("patient's name"): a neutral chip with a
dashed Slate border on Mist Light – not a status, so no status colour and no icon. CSS: `.cf-blank` in
`client/src/styles/pages-consents.css`.

### Calendar event marks (Calendar)
Each kind of calendar entry has its own mark, so a doctor can tell them apart at a glance. Marks are **types, not
statuses**: colour + icon + word on the pill base (`.pill`, 13 px / 500), existing tokens only.

| type | class | look | icon | word (doctors, RMOs) | word (reception) |
| --- | --- | --- | --- | --- | --- |
| Booked next visit | `.cal-mark-booked` | Teal Wash `--teal-100` fill, Deep Teal `--teal-700` text | `CalendarCheck` | Booked visit | Booked visit |
| Care-plan visit | `.cal-mark-plan` | `--surface` fill, 1 px `--teal-700` border, `--teal-700` text | `Stethoscope` | Plan visit | Visit due |
| EDD | `.cal-mark-edd` | `--status-admitted-bg` / `--status-admitted-fg` (violet) | `Baby` | EDD (scan) / EDD (LMP) | – |
| LMP | `.cal-mark-lmp` | `--surface` fill, 1 px `--slate-600` border, `--ink` text | `Droplet` | LMP | – |

- **An exception to rule 4, on purpose.** Rule 4 keeps types as neutral tags; calendar marks are the one stated
  exception, because the owner asked for a colour per kind of entry. A mark always carries its icon and its word,
  so it never relies on colour.
- **EDD borrows the Admitted violet.** EDD marks always carry the Baby icon and the word "EDD", never appear in a
  status column, and Admitted pills never appear on the calendar, so the two cannot be confused.
- **Teal only for visits** (rule 5: teal marks what is scheduled): booked and care-plan visits. No white text on teal.
- **LMP is an outline**, so it stays visible on white and on Mist in every personal colour theme (checked in each theme).
- The status of a care-plan visit is shown next to the mark with the usual `StatusPill` (Due now, Upcoming, Overdue,
  Missed, Attended – the same words as the Care plan tab); a past booking with no visit recorded gets the Inactive
  pill "No visit recorded" with the `UserX` icon.
- In the type filter the marks double as the legend: each is a toggle button (`aria-pressed`) with a tick box
  before the mark, so "on" and "off" do not rely on colour. The last type left on cannot be switched off.
- **Component**: `EventMark` in `client/src/pages/calendar/EventMark.jsx` (`compact` = icon only, with the word as its
  label, used only where the word is close by; add `decorative` (hidden from screen readers) where the word is inside
  the same element, such as the day view's section headings). **CSS**: `.cal-mark*` in `client/src/styles/pages-calendar.css`.

### Calendar month grid and day lists (Calendar)
- **Month grid**: seven columns, whole weeks (Monday first; the server decides). The grid is the date-picker ARIA
  pattern: `role="grid"` → `row` → `columnheader` / `gridcell`, each day a 44 px button; arrow keys move a day or a
  week, Home / End the start or end of the week, Page Up / Page Down a month; Enter or Space chooses.
- **Cell**: the day number, then small icon + number pieces in a fixed order (booked, plan, EDD, LMP), two per line;
  a zero shows nothing. The words are in the type filter and in the cell's accessible name ("Monday 12 October
  2026: 5 booked visits, 3 visit windows open, 1 EDD").
- **Cell states**: today – a 2 px Nexa Teal top line and a small "Today" label in Deep Teal (teal marks "now", as
  in the Today divider row); chosen – Teal Wash fill; days outside the month – Mist Light fill and a Slate day number.
- **Chosen day**: a white card beside the grid (360 px) when the calendar's own width is 980 px or more, otherwise
  below it; it lists the day's entries.
- **Phone** (calendar narrower than 560 px): a cell shows the day number and the total only, with a small
  decorative teal dot when a booked visit falls on it; today's number gets a 2 px Deep Teal ring (the Today word
  does not fit), and the chosen-day card title starts with "Today ·" when the chosen day is today. The words stay
  in the accessible name and the day list. Stacked day and week rows leave out cells with nothing in them.
- **Week**: a list of days at every width – one white card per day with its heading ("Mon 12 Oct", Today marker)
  and a compact table, or one Slate line "Nothing on this day." A 7-column week grid is for later.
- **Day**: one white card per kind of entry (Booked visits, Plan visits, EDD, LMP), each a table keyed by patient.
- **CSS**: `.cal-page`, `.cal-toolbar*`, `.cal-month`, `.cal-cell*`, `.cal-count`, `.cal-week`, `.cal-day-section`,
  `.cal-note` in `client/src/styles/pages-calendar.css`.

### Charts and analytics (Analytics, Feature 11)
Numbers for doctors, hospital admins and the super admin, drawn by hand (no chart library) in
`client/src/components/charts/`.
- **One series per chart, labelled directly.** No categorical palette, no donut, no stacked multi-colour bars, no
  dual axis. Bars and columns use `--chart-bar` (follows the person's colour template); expected deliveries use
  `--chart-scheduled` (teal, because those are future dates). "Not recorded" rows come last, after a hairline, in
  `--chart-unknown`.
- **Chart grey `#838AA2`** (`--chart-unknown`) is the one new colour: at least 3:1 on white, and clearly apart from
  `--indigo-700` in all seven colour templates and from `--teal-700`. `--slate-600` is not used for data marks (too
  close to the Ocean blue, Forest green and Slate templates). Teal and grey never sit next to each other in one chart.
- Other chart tokens: `--chart-track` (meter track), `--chart-grid` (1 px solid gridlines), `--chart-axis` (axis text).
- **Status colours appear only in pills.** A row that is a status (risk level, care-plan state) carries a
  `StatusPill` – colour, icon and word – and its bar stays in the one series colour.
- **Bars** (`BarList`): a real table – label, number, bar; bars 16 px (at most 24 px), square at the baseline,
  4 px rounded end. A row that opens a list of patients (doctors only) is one 44 px click target with a chevron.
- **Columns** (`ColumnChart`): at most 24 px wide, 2 px apart, 4 px rounded top; 3–4 round y ticks; direct labels
  only on the highest and the last column; a tooltip on hover and keyboard focus; always a **Show as table** text
  button under the chart.
- **"x of y"** (`Meter`): an 8 px track with the words beside it – "34 of 40 · 85%", or "12 of 15 · Too few to
  compare" when fewer than 20. A percentage is shown only from two exact numbers.
- **Numbers shown in words**: a hospital admin's 1–4 read "fewer than 5", and a protected number reads "Not shown" –
  never "<5". In a tile they are set at the card-title size (`.kpi-value-text`).
- **The sex ratio at birth** is a neutral tile with the `Info` icon and the words "For information" – never a status
  colour.
- **Tabular figures** for numbers in KPI tiles, tables and axes (as `.kpi-value` already does).
- No animation. **CSS**: `.an-*`, `.barlist*`, `.colchart*`, `.meter*` in `client/src/styles/pages-analytics.css`;
  the chart tokens in `tokens.css` after the status tokens.
