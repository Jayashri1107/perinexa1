import { CircleHelp, Info, LayoutGrid, Mic, ShieldCheck, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { normalizeAppearance } from '../appearance.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { ACCOUNT_MODULE, hospitalModules, platformModules } from '../platform/modules.js';

// "Help" in the top bar (owner, 14 Oct 2026): how to use Perinexa, in one page. Each person sees the guide for the
// menu items they have; the explanations on every screen are switched on or off here.

const GUIDE = {
  today: 'Your work for today at a glance: who is waiting, appointments, results and tasks. Click a card to open the list behind it.',
  patients:
    'Find a patient by name, phone or patient number, or press New patient. A new patient is saved in two steps: patient information first, then the clinical details.',
  appointments: 'Book a 10-minute slot for a doctor, see the day’s list and the next visits that still need a time.',
  calendar: 'The month with the day’s appointments, visits and tasks beside it. Click a day to see its list.',
  beds: 'The bed board: which beds are free or occupied, admitting at the desk and moving a patient.',
  lab: 'Tests ordered, samples collected and results entered. Results outside the range are marked in colour, with an icon and a word.',
  billing: 'Bills, payments and receipts. A bill can be printed or shared as a PDF.',
  pharmacy: 'Sell or issue to a ward: choose the patient and her prescription comes up. Also the stock, purchases and supplier returns.',
  analytics: 'Counts and charts for the hospital, and “Ask your records” to search the records in plain words.',
  knowledge: 'The clinic library: care-plan templates, consent forms, test packages and prescription sets. A doctor approves each one before it is used.',
  'hospital-admin': 'Staff, roles, beds and the hospital’s settings. Deactivate a person instead of deleting them.',
};

const BASICS = [
  'The left menu shows only what your role needs. ☰ folds it into icons.',
  '“Working in” at the top shows the hospital you are in. If you work at more than one, switch it there.',
  'Find a patient from any screen with the search box at the top (press / to jump to it).',
  'Click your initial (top right) for your details, Change password and My settings.',
  'After 30 minutes without use you are logged out, to keep patient records safe. Unsaved typing is lost.',
];

const SAFETY = [
  'This is a development version: use fake sample patients only, never real patient information.',
  'Anything marked “From voice” or suggested by AI must be checked before you save it.',
  'The baby’s sex is never recorded during a pregnancy (PCPNDT).',
  'Every record you open is written in the audit log.',
  'Forgot your password? Ask your hospital administrator to reset it.',
];

const VOICE = [
  'On a new patient or a visit, open Voice entry and press Start recording (speech is turned into text on this computer) or AI dictation.',
  'Speak normally; say each detail with its name, for example “age 28, LMP 12 July”.',
  'Press Stop. The details are filled in below for you to check. With AI dictation the whole recording is written down by AI (OpenAI) – the i button says more.',
  'You can also type in the box: the form fills in a moment after you stop typing.',
  'Parts that were not understood are listed; enter them by hand or press Ask AI where these belong.',
];

const REGISTER = [
  'OPD (a visit without a stay): New patient (top right of Today or Patients) → choose the type of care → patient information → Save and continue → clinical details. Then book a time in Appointments, or give a walk-in token on Today.',
  'Someone already registered: find her with the search at the top – never register her twice. Mark arrived on Today when she comes.',
  'IPD (a stay in hospital): register her first if she is new, then Admit to a bed – from Today, the bed board (Beds) or her record (More → Admit to a bed). Choose a free bed, the reason and the time; print the admission slip.',
  'The stay’s bill opens with the bed charge by itself; take an advance in Billing. The doctor confirms the discharge card, which frees the bed; reception settles the bill.',
];

function List({ items }) {
  return (
    <ul className="help-list">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function HelpPage() {
  const { user, saveAppearance, activeMembership, isPlatform, platform } = useAuth();
  const look = normalizeAppearance(user.preferences?.appearance);
  const shown = look.help === 'shown';
  const inSetup = Boolean(activeMembership?.platform);
  const modules = isPlatform && !inSetup ? platformModules(platform) : hospitalModules(activeMembership?.roles);
  const guided = modules.filter((m) => GUIDE[m.key]);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Help' }]} title="Help" subtitle="How to use Perinexa" documentTitle="Help" />
      <div className="pf-content help-page">
        <section className="card help-card" aria-labelledby="help-basics">
          <h2 id="help-basics">
            <CircleHelp aria-hidden="true" /> Getting around
          </h2>
          <List items={BASICS} />
        </section>

        <section className="card help-card" aria-labelledby="help-safety">
          <h2 id="help-safety">
            <ShieldCheck aria-hidden="true" /> Safety rules
          </h2>
          <List items={SAFETY} />
        </section>

        {guided.length > 0 && (
          <section className="card help-card help-wide" aria-labelledby="help-menu">
            <h2 id="help-menu">
              <LayoutGrid aria-hidden="true" /> Your menu
            </h2>
            <dl className="help-modules">
              {guided.map((m) => {
                const Icon = m.icon;
                return (
                  <div key={m.key}>
                    <dt>
                      <Link to={m.to}>
                        <Icon aria-hidden="true" /> {m.label}
                      </Link>
                    </dt>
                    <dd>{GUIDE[m.key]}</dd>
                  </div>
                );
              })}
              <div>
                <dt>
                  <Link to={ACCOUNT_MODULE.to}>
                    <ACCOUNT_MODULE.icon aria-hidden="true" /> {ACCOUNT_MODULE.label}
                  </Link>
                </dt>
                <dd>Your profile, password, appearance and your own voice words.</dd>
              </div>
            </dl>
          </section>
        )}

        <section className="card help-card" aria-labelledby="help-register">
          <h2 id="help-register">
            <UserPlus aria-hidden="true" /> Registering and admitting
          </h2>
          <List items={REGISTER} />
        </section>

        <section className="card help-card" aria-labelledby="help-voice">
          <h2 id="help-voice">
            <Mic aria-hidden="true" /> Voice entry
          </h2>
          <List items={VOICE} />
        </section>

        <section className="card help-card help-wide" aria-labelledby="help-explain">
          <h2 id="help-explain">
            <Info aria-hidden="true" /> Explanations on every screen
          </h2>
          <p className="hint">Short explanations under headings and fields. Useful while learning; switch them off when you know the screens.</p>
          <label className="check">
            <input type="checkbox" checked={shown} onChange={() => saveAppearance({ ...look, help: shown ? 'hidden' : 'shown' }).catch(() => {})} /> Show
            explanations on the screens
          </label>
        </section>
      </div>
    </>
  );
}
