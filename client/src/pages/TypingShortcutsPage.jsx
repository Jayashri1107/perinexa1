import { useState } from 'react';
import { Keyboard, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Alert, Field } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { accountTabs } from '../platform/modules.js';
import { useUndo } from '../components/Undo.jsx';
import { SHORTCUTS_CHANGED } from '../shortcuts/useTextShortcuts.js';

// "My settings → Typing shortcuts" (doctor ideas #3, 16 Oct 2026): the person's own shortcuts. Type a dot and the
// shortcut, then a space, in any text box: ".fu2 " becomes "Follow up after 2 weeks with CBC report ". Personal to
// the account; sentences you often write – never a patient's details.

export function TypingShortcutsPage() {
  const { user, memberships } = useAuth();
  const { data, error, reload } = useFetch('/me/shortcuts');
  const [form, setForm] = useState({ key: '', text: '' });
  const [fields, setFields] = useState({});
  const [flash, setFlash] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = data?.shortcuts ?? [];
  const changed = (message) => {
    setFlash(message);
    reload();
    window.dispatchEvent(new Event(SHORTCUTS_CHANGED));
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setActionError(null);
    try {
      const { shortcut } = await api('/me/shortcuts', { method: 'PUT', body: form });
      setForm({ key: '', text: '' });
      changed(`Saved: type .${shortcut.key} and a space.`);
    } catch (err) {
      setFields(err.fields ?? {});
      setActionError(err.fields ? null : err.message);
    } finally {
      setBusy(false);
    }
  };
  // Removed at once, with Undo (doctor ideas #5): Undo saves it again
  const undo = useUndo();
  const remove = async (s) => {
    setActionError(null);
    try {
      await api(`/me/shortcuts/${s.id}`, { method: 'DELETE' });
      reload();
      window.dispatchEvent(new Event(SHORTCUTS_CHANGED));
      undo.offer(`Removed .${s.key}.`, async () => {
        await api('/me/shortcuts', { method: 'PUT', body: { key: s.key, text: s.text } }).catch((err) => setActionError(err.message));
        changed(`.${s.key} is back.`);
      });
    } catch (err) {
      setActionError(err.message);
    }
  };
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'My settings', to: '/account' }, { label: 'Typing shortcuts' }]} title="My settings" subtitle={`${user.name} · ${user.email}`} tabs={accountTabs(memberships)} />
      <div className="pf-content">
        <Alert type="error">{error ?? actionError}</Alert>
        {undo.element}
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <section className="card narrow">
          <h2>
            <Keyboard aria-hidden="true" /> Typing shortcuts
          </h2>
          <p className="hint">
            In any text box, type a dot, your shortcut and a space – <kbd>.fu2</kbd> then space – and it becomes your text. They are yours only, in every hospital you work in. Keep them to
            sentences you often write; never a patient's details.
          </p>
          <form onSubmit={save} noValidate className="ts-form">
            <Field label="Shortcut" id="ts-key" error={fields.key} hint="Letters and numbers, e.g. fu2">
              <input id="ts-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} maxLength={21} autoComplete="off" />
            </Field>
            <Field label="It becomes" id="ts-text" error={fields.text}>
              <textarea id="ts-text" rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} maxLength={1000} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !form.key.trim() || !form.text.trim()}>
              <Plus aria-hidden="true" /> {busy ? 'Saving…' : 'Save shortcut'}
            </button>
          </form>
        </section>
        {data && (
          <section className="card narrow" aria-labelledby="ts-list">
            <h2 id="ts-list">Your shortcuts ({list.length})</h2>
            {!list.length && <p className="muted">None yet. Saving the same shortcut again changes its text.</p>}
            <ul className="ts-list">
              {list.map((s) => (
                <li key={s.id}>
                  <kbd>.{s.key}</kbd>
                  <span className="pre-line">{s.text}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove .${s.key}`} onClick={() => remove(s)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
