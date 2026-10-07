// The medicine safety list: medicines to avoid or use with caution in pregnancy (by weeks), combinations, in
// breastfeeding and in newborns, and usual maximum doses. It warns while a prescription is written; it never blocks.
// Built-in entries are switched off rather than removed; the hospital's own entries can be removed.
import { CircleCheck, CirclePause, OctagonX, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { StateBadge } from '../../../components/StateBadge.jsx';
import { MED_KIND_WORDS, newKey } from '../libraryFormat.js';
import { RowsEditor, listOf, listText, numInput, numOrNull } from './RowsEditor.jsx';

const LEVELS = {
  avoid: { tone: 'danger', icon: OctagonX, word: 'Avoid' },
  caution: { tone: 'pending', icon: TriangleAlert, word: 'Caution' },
};
const ON = { tone: 'active', icon: CircleCheck, word: 'In use' };
const OFF = { tone: 'inactive', icon: CirclePause, word: 'Off' };
const KIND_OPTIONS = Object.entries(MED_KIND_WORDS).map(([value, label]) => ({ value, label }));

function limitsText(e) {
  if (e.kind === 'dose') {
    const unit = `${e.doseUnit}${e.perKg ? '/kg' : ''}`;
    return [e.maxSingle != null && `${e.maxSingle} ${unit} a dose`, e.maxDaily != null && `${e.maxDaily} ${unit} a day`, e.maxAgeDays != null && `up to day ${e.maxAgeDays}`].filter(Boolean).join(' · ');
  }
  if (e.kind === 'combination') return `with ${listText(e.otherTerms)}`;
  if (e.kind === 'newborn') return e.maxAgeDays != null ? `up to day ${e.maxAgeDays}` : 'any age';
  if (e.fromWeek != null || e.toWeek != null) return `weeks ${e.fromWeek ?? 0}–${e.toWeek ?? 'birth'}`;
  return '';
}

export function MedicineSafetyEditor({ content, editing, onChange }) {
  const [kind, setKind] = useState('');
  const entries = content.entries ?? [];
  const rows = kind ? entries.filter((e) => e.kind === kind) : entries;
  const columns = [
    { key: 'on', label: '', render: (e) => <StateBadge look={e.active === false ? OFF : ON} small /> },
    { key: 'label', label: 'Medicine', render: (e) => (<><strong>{e.label}</strong><span className="muted block small">{listText(e.terms)}</span></>) },
    { key: 'kind', label: 'Kind', render: (e) => (<>{MED_KIND_WORDS[e.kind]}<span className="muted block small">{limitsText(e)}</span></>) },
    { key: 'level', label: 'Level', render: (e) => (e.kind === 'dose' ? '' : <StateBadge look={LEVELS[e.level]} small />) },
    { key: 'message', label: 'Warning', render: (e) => (<><span className="small">{e.message}</span><span className="muted block small">{e.source}</span></>) },
  ];
  const fields = (v) => [
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: KIND_OPTIONS, width: 'third' },
    { name: 'label', label: 'Name shown', required: true, width: 'two-thirds' },
    { name: 'terms', label: 'Names to look for (generic and brand names, separated by commas)', required: true },
    ...(v.kind === 'combination' ? [{ name: 'otherTerms', label: 'Together with (names, separated by commas)', required: true }] : []),
    ...(v.kind !== 'dose' ? [{ name: 'level', label: 'Level', type: 'select', required: true, options: [{ value: 'avoid', label: 'Avoid' }, { value: 'caution', label: 'Caution' }], width: 'third' }] : []),
    ...(v.kind === 'medicine'
      ? [
          { name: 'fromWeek', label: 'From week (empty = whole pregnancy)', type: 'number', width: 'third' },
          { name: 'toWeek', label: 'To week', type: 'number', width: 'third' },
        ]
      : []),
    ...(v.kind === 'newborn' || v.kind === 'dose' ? [{ name: 'maxAgeDays', label: 'Up to day of life (empty = any age)', type: 'number', width: 'third' }] : []),
    ...(v.kind === 'dose'
      ? [
          { name: 'doseUnit', label: 'Unit', type: 'select', required: true, options: ['mg', 'mcg', 'g', 'IU'].map((u) => ({ value: u, label: u })), width: 'third' },
          { name: 'maxSingle', label: 'Most in one dose', type: 'number', width: 'third' },
          { name: 'maxDaily', label: 'Most in a day', type: 'number', width: 'third' },
          { name: 'perKg', label: 'Per kg of body weight', type: 'switch', onLabel: 'Per kg', offLabel: 'Whole dose' },
        ]
      : []),
    { name: 'message', label: 'Warning shown to the doctor', type: 'textarea', rows: 3 },
    { name: 'source', label: 'Source', width: 'full' },
    { name: 'active', label: 'In use', type: 'switch', onLabel: 'In use', offLabel: 'Off' },
  ];
  return (
    <>
      <div className="pad-row">
        <div className="segmented" role="group" aria-label="Kind">
          {[{ value: '', label: 'All' }, ...KIND_OPTIONS].map((o) => (
            <button key={o.value} type="button" className={kind === o.value ? 'on' : ''} aria-pressed={kind === o.value} onClick={() => setKind(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>
      <RowsEditor
        rows={rows}
        columns={columns}
        editing={editing}
        fields={fields}
        title="Change the entry"
        addLabel="Add an entry"
        newRow={() => ({ kind: kind || 'medicine', label: '', terms: [], otherTerms: [], level: 'caution', message: '', source: '', fromWeek: null, toWeek: null, maxAgeDays: null, doseUnit: 'mg', maxSingle: null, maxDaily: null, perKg: false, active: true })}
        toValues={(e) => ({ ...e, terms: listText(e.terms), otherTerms: listText(e.otherTerms), fromWeek: numInput(e.fromWeek), toWeek: numInput(e.toWeek), maxAgeDays: numInput(e.maxAgeDays), maxSingle: numInput(e.maxSingle), maxDaily: numInput(e.maxDaily), active: e.active !== false })}
        toRow={(v, e) => ({
          key: e?.key ?? newKey(),
          kind: v.kind,
          label: v.label,
          terms: listOf(v.terms).map((t) => t.toLowerCase()),
          otherTerms: v.kind === 'combination' ? listOf(v.otherTerms).map((t) => t.toLowerCase()) : [],
          level: v.kind === 'dose' ? e?.level ?? 'caution' : v.level,
          message: v.message,
          source: v.source,
          fromWeek: v.kind === 'medicine' ? numOrNull(v.fromWeek) : null,
          toWeek: v.kind === 'medicine' ? numOrNull(v.toWeek) : null,
          maxAgeDays: v.kind === 'newborn' || v.kind === 'dose' ? numOrNull(v.maxAgeDays) : null,
          doseUnit: v.kind === 'dose' ? v.doseUnit : '',
          maxSingle: v.kind === 'dose' ? numOrNull(v.maxSingle) : null,
          maxDaily: v.kind === 'dose' ? numOrNull(v.maxDaily) : null,
          perKg: v.kind === 'dose' ? Boolean(v.perKg) : false,
          active: v.active,
        })}
        canRemove={(e) => e.key.startsWith('own_')}
        onChange={(next) => {
          // the shown rows are a filter of the whole list: put the changes back in place
          const shownKeys = new Set(rows.map((r) => r.key));
          const others = entries.filter((x) => !shownKeys.has(x.key));
          onChange({ ...content, entries: kind ? [...others, ...next] : next });
        }}
      />
    </>
  );
}
