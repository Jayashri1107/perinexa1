// A care-plan template: its items (visits, tests, scans, vaccines, medicines, advice), each due at booking, in a
// window of weeks, or some weeks after another item; some only when a condition applies (e.g. Rh negative).
import { useMemo } from 'react';
import { ITEM_KIND_WORDS, newKey, whenText } from '../libraryFormat.js';
import { RowsEditor, numInput, numOrNull } from './RowsEditor.jsx';

const KIND_OPTIONS = Object.entries(ITEM_KIND_WORDS).map(([value, label]) => ({ value, label }));

export function CarePlanEditor({ content, editing, onChange }) {
  const items = content.items ?? [];
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const columns = [
    { key: 'when', label: 'When', className: 'nowrap', render: (i) => whenText(i, byKey) },
    { key: 'kind', label: 'Kind', render: (i) => ITEM_KIND_WORDS[i.kind] ?? i.kind },
    { key: 'name', label: 'Item', render: (i) => (<><strong>{i.name}</strong>{i.patientText && <span className="muted block small">Patient sees: {i.patientText}</span>}</>) },
    { key: 'applies', label: 'Only when', render: (i) => (i.appliesWhen && i.appliesWhen !== 'always' ? <span className="pill">{i.appliesWhen.replace(/_/g, ' ')}</span> : '') },
    { key: 'source', label: 'Source', render: (i) => <span className="muted small">{i.source}</span> },
  ];
  const fields = (values) => [
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: KIND_OPTIONS, width: 'third' },
    { name: 'name', label: 'Name (what staff see)', required: true, width: 'two-thirds' },
    { name: 'patientText', label: 'Patient’s wording (printouts and reminders – never a diagnosis)' },
    { name: 'atBooking', label: 'Due at the booking visit', type: 'switch', onLabel: 'Yes', offLabel: 'No' },
    ...(values.atBooking
      ? []
      : [
          { name: 'fromWeek', label: 'From week', type: 'number', width: 'half' },
          { name: 'toWeek', label: 'To week', type: 'number', width: 'half' },
        ]),
    { name: 'appliesWhen', label: 'Only when (empty = always)', width: 'half', help: 'e.g. rh_negative, high_risk, gdm – as in the built-in items' },
    { name: 'source', label: 'Source (for doctors)', type: 'textarea', rows: 3 },
  ];
  return (
    <RowsEditor
      rows={items}
      columns={columns}
      editing={editing}
      fields={fields}
      title="Change the item"
      addLabel="Add an item"
      newRow={() => ({ kind: 'visit', name: '', patientText: '', atBooking: false, fromWeek: null, toWeek: null, appliesWhen: '', source: '' })}
      toValues={(i) => ({ ...i, atBooking: Boolean(i.atBooking), fromWeek: numInput(i.fromWeek), toWeek: numInput(i.toWeek), appliesWhen: i.appliesWhen ?? '', patientText: i.patientText ?? '', source: i.source ?? '' })}
      toRow={(v, row) => ({
        key: row?.key ?? newKey(),
        kind: v.kind,
        name: v.name,
        patientText: v.patientText,
        atBooking: v.atBooking,
        fromWeek: v.atBooking ? null : numOrNull(v.fromWeek),
        toWeek: v.atBooking ? null : numOrNull(v.toWeek),
        after: row?.after ?? null,
        appliesWhen: v.appliesWhen,
        source: v.source,
      })}
      canRemove={() => true}
      onChange={(next) => onChange({ ...content, items: next })}
      emptyText="No items yet. Add the visits, tests and advice of this plan."
    />
  );
}
