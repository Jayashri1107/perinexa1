import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Alert, Field, formatDate } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { accountTabs } from '../platform/modules.js';
import { builtInWords, meaningLabel } from './patients/dictation.js';

// Voice entry remembers a few habits under these keys rather than a word
const HABITS = {
  edd: 'An EDD said without “scan”',
  'b rh': '“B positive” (or A) said without “blood group”',
  'height n.n': 'A height like “5.2”',
};

// Asked about every time, because the answer depends on the patient
const ALWAYS_ASKED = [
  '“sugar”, “high BP”, insulin, metformin, labetalol / nifedipine / methyldopa and heparin in a pregnancy: from before the pregnancy, or of this pregnancy?',
  '“PIH”, “PE”, “IUD”, and problems such as PPH or IUGR said without “previous” or “this pregnancy”: a previous pregnancy, or this one?',
  'HIV, HBsAg, VDRL, HCV without a result: positive or negative?',
  'An Hb below 11 (12 if not pregnant): anaemia? · “Rh negative” without the ABO group: which group? · “ART”: antiretroviral, or assisted reproduction?',
];

// "My settings → Voice words": the words this person taught voice entry (remove any that are wrong), and the OBGY
// words and short forms the app already knows.
export function VoiceWordsPage() {
  const { user, memberships } = useAuth();
  const { data, error, reload } = useFetch('/me/dictation-words');
  const [flash, setFlash] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const known = useMemo(() => builtInWords(), []);
  const words = data?.words ?? [];

  const remove = async (word) => {
    setBusyId(word.id);
    setActionError(null);
    try {
      await api(`/me/dictation-words/${word.id}`, { method: 'DELETE' });
      setFlash(`Removed ${HABITS[word.phrase] ?? `“${word.phrase}”`}. Voice entry will ask about it again.`);
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = q ? known.filter((g) => g.label.toLowerCase().includes(q) || g.says.some((w) => w.toLowerCase().includes(q))) : known;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'My settings', to: '/account' }, { label: 'Voice words' }]}
        title="My settings"
        subtitle={`${user.name} · ${user.email}`}
        tabs={accountTabs(memberships)}
      />
      <div className="pf-content voice-words">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError ?? error}
        </Alert>

        <section className="card">
          <h2>Your words</h2>
          <p className="muted">
            Words you taught voice entry by ticking “Remember my answer” on the new-patient pages. They are used every time you dictate, on any
            computer. Only the word and what it means are kept – never anything about a patient.
          </p>
          {data && words.length === 0 && <p className="hint">None yet. When voice entry asks about a word, tick “Remember my answer” to add it here.</p>}
          {words.length > 0 && (
            <ul className="plain-list voice-word-list">
              {words.map((w) => (
                <li key={w.id}>
                  <span className="voice-word-text">
                    <strong>{HABITS[w.phrase] ?? `“${w.phrase}”`}</strong>
                    <span>{meaningLabel(w.meaning)}</span>
                    <span className="t-caption muted">Since {formatDate(w.createdAt)}</span>
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={() => remove(w)} disabled={busyId === w.id}>
                    {busyId === w.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Words the app already knows</h2>
          <p className="muted">
            OBGY terms, Indian short forms and medicine names that voice entry understands, and where each goes in the form. Tell the developer
            about any word that is missing or wrong.
          </p>
          <Field label="Find a word" id="word-search">
            <input id="word-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. LSCS, GDM, Thyronorm" />
          </Field>
          {shown.length === 0 && <p className="hint">No built-in word matches “{search}”.</p>}
          <dl className="voice-known">
            {shown.map((g) => (
              <div key={g.to}>
                <dt>{g.label}</dt>
                <dd>{g.says.join(' · ')}</dd>
              </div>
            ))}
          </dl>
          <h3>Asked about every time</h3>
          <ul className="voice-asked">
            {ALWAYS_ASKED.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
