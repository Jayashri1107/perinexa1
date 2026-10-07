// A test package: a ready-made set of lab tests for adults or for babies (by day of life), and who it is for.
import { useEffect, useMemo, useState } from 'react';
import { labApi } from '../../../api/index.js';
import { Loader } from '../../../components/Loader.jsx';

export function TestPackageEditor({ content, editing, onChange }) {
  const [catalogue, setCatalogue] = useState(null);
  useEffect(() => {
    labApi.catalogue().then(setCatalogue).catch(() => setCatalogue({ groups: {}, tests: [] }));
  }, []);
  const byKey = useMemo(() => new Map((catalogue?.tests ?? []).map((t) => [t.key, t])), [catalogue]);
  if (!catalogue) return <Loader />;

  const set = (patch) => onChange({ ...content, ...patch });
  const groups = Object.entries(catalogue.groups)
    .map(([key, label]) => ({ key, label, tests: catalogue.tests.filter((t) => t.group === key && t.who === content.who) }))
    .filter((g) => g.tests.length);
  const toggle = (key) => set({ tests: content.tests.includes(key) ? content.tests.filter((k) => k !== key) : [...content.tests, key] });
  const days = content.fromDay != null || content.toDay != null ? `Day ${content.fromDay ?? 0} to ${content.toDay ?? 'any later day'} of life` : '';

  if (!editing) {
    return (
      <div className="pad">
        <dl className="details wide">
          <dt>For</dt><dd>{content.who === 'newborn' ? 'Babies' : 'Adults'}{days && ` · ${days}`}</dd>
          <dt>When</dt><dd>{content.forWhom || '—'}</dd>
          <dt>Tests</dt>
          <dd>
            <ul className="plain-list tight">
              {content.tests.map((k) => <li key={k}>{byKey.get(k)?.name ?? k}</li>)}
            </ul>
          </dd>
        </dl>
      </div>
    );
  }

  const num = (v) => (v === '' ? null : Number(v));
  return (
    <div className="pad">
      <div className="form-grid">
        <div className="form-field width-third">
          <label htmlFor="pkg-who">For</label>
          <select id="pkg-who" value={content.who} onChange={(e) => set({ who: e.target.value, tests: [] })}>
            <option value="adult">Adults</option>
            <option value="newborn">Babies</option>
          </select>
        </div>
        {content.who === 'newborn' && (
          <>
            <div className="form-field width-third">
              <label htmlFor="pkg-from">From day of life</label>
              <input id="pkg-from" type="number" min={0} value={content.fromDay ?? ''} onChange={(e) => set({ fromDay: num(e.target.value) })} />
            </div>
            <div className="form-field width-third">
              <label htmlFor="pkg-to">To day (empty = any later day)</label>
              <input id="pkg-to" type="number" min={0} value={content.toDay ?? ''} onChange={(e) => set({ toDay: num(e.target.value) })} />
            </div>
          </>
        )}
        <div className="form-field">
          <label htmlFor="pkg-for">When it is used</label>
          <input id="pkg-for" value={content.forWhom} maxLength={300} onChange={(e) => set({ forWhom: e.target.value })} />
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="order-block">
          <h3>{g.label}</h3>
          <div className="checkbox-group">
            {g.tests.map((t) => (
              <label key={t.key} className={`chip-check${content.tests.includes(t.key) ? ' checked' : ''}`}>
                <input type="checkbox" checked={content.tests.includes(t.key)} onChange={() => toggle(t.key)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
