// The hospital's red-flag rules and risk rules. A doctor changes a rule's name, level, wording, thresholds and
// whether it is in use; the conditions themselves stay as they are. What is sent is one change per rule, by key.
import { CircleCheck, CirclePause, Siren, TriangleAlert } from 'lucide-react';
import { StateBadge } from '../../../components/StateBadge.jsx';
import { useAppConfig } from '../../../context/AppConfigContext.jsx';
import { labelOf } from '../../../utils/format.js';
import { LEVEL_WORDS, windowText } from '../libraryFormat.js';
import { RowsEditor, numInput, numOrNull } from './RowsEditor.jsx';

const LEVEL_LOOKS = {
  urgent: { tone: 'danger', icon: Siren, word: 'Urgent' },
  watch: { tone: 'pending', icon: TriangleAlert, word: 'Watch' },
  high: { tone: 'danger', icon: TriangleAlert, word: 'High' },
  moderate: { tone: 'pending', icon: TriangleAlert, word: 'Moderate' },
};
const ON = { tone: 'active', icon: CircleCheck, word: 'In use' };
const OFF = { tone: 'inactive', icon: CirclePause, word: 'Off' };
const levelOptions = (levels) => levels.map((l) => ({ value: l, label: LEVEL_WORDS[l] }));

export function RedFlagRulesEditor({ content, editing, onChange }) {
  const { patients } = useAppConfig();
  const rules = content.rules ?? [];
  const columns = [
    { key: 'on', label: '', render: (r) => <StateBadge look={r.active === false ? OFF : ON} small /> },
    { key: 'label', label: 'Rule', render: (r) => (<><strong>{r.label}</strong><span className="block small">{r.text}</span>{windowText(r) && <span className="muted block small">{windowText(r)}</span>}</>) },
    { key: 'level', label: 'Level', render: (r) => <StateBadge look={LEVEL_LOOKS[r.level]} small /> },
    { key: 'for', label: 'For', render: (r) => <span className="small">{(r.appliesTo ?? []).map((c) => labelOf(patients.careTypes, c)).join(', ')}</span> },
    { key: 'message', label: 'What to do', render: (r) => (<><span className="small">{r.message}</span><span className="muted block small">{r.source}</span></>) },
  ];
  const fields = (_values, rule) => [
    { name: 'label', label: 'Name', required: true, width: 'two-thirds' },
    { name: 'level', label: 'Level', type: 'select', required: true, options: levelOptions(['urgent', 'watch']), width: 'third' },
    ...rule.conditions.map((c, i) =>
      c.value != null ? { name: `values.${i}`, label: `Threshold ${i + 1} (now: ${rule.text.split(' and ')[i] ?? c.factor})`, type: 'number', width: 'half' } : null,
    ).filter(Boolean),
    { name: 'message', label: 'What to do (shown with the flag)', type: 'textarea', rows: 3 },
    { name: 'source', label: 'Source', type: 'textarea', rows: 2 },
    { name: 'active', label: 'In use', type: 'switch', onLabel: 'In use', offLabel: 'Off' },
  ];
  return (
    <RowsEditor
      rows={rules}
      columns={columns}
      editing={editing}
      fields={fields}
      title="Change the rule"
      toValues={(r) => ({ label: r.label, level: r.level, message: r.message ?? '', source: r.source ?? '', active: r.active !== false, values: r.conditions.map((c) => numInput(c.value)) })}
      toRow={(v, r) => ({
        ...r,
        label: v.label,
        level: v.level,
        message: v.message,
        source: v.source,
        active: v.active,
        conditions: r.conditions.map((c, i) => (c.value != null && numOrNull(v.values?.[i]) != null ? { ...c, value: numOrNull(v.values[i]) } : c)),
      })}
      onChange={(next) => onChange({ ...content, rules: next })}
    />
  );
}

export function RiskRulesEditor({ content, editing, onChange }) {
  const rules = content.rules ?? [];
  const columns = [
    { key: 'on', label: '', render: (r) => <StateBadge look={r.active === false ? OFF : ON} small /> },
    { key: 'label', label: 'Rule', render: (r) => (<><strong>{r.label}</strong><span className="block small">{r.text}</span></>) },
    { key: 'level', label: 'Raises the risk to', render: (r) => <StateBadge look={LEVEL_LOOKS[r.level]} small /> },
    { key: 'source', label: 'Source', render: (r) => <span className="muted small">{r.source}</span> },
  ];
  const fields = (_values, rule) => [
    { name: 'label', label: 'Name', required: true, width: 'two-thirds' },
    { name: 'level', label: 'Level', type: 'select', required: true, options: levelOptions(['high', 'moderate']), width: 'third' },
    ...(rule.op ? [{ name: 'value', label: `Threshold (now: ${rule.text})`, type: 'number', width: 'half' }] : []),
    { name: 'source', label: 'Source', type: 'textarea', rows: 3 },
    { name: 'active', label: 'In use', type: 'switch', onLabel: 'In use', offLabel: 'Off' },
  ];
  return (
    <RowsEditor
      rows={rules}
      columns={columns}
      editing={editing}
      fields={fields}
      title="Change the rule"
      toValues={(r) => ({ label: r.label, level: r.level, value: numInput(r.value), source: r.source ?? '', active: r.active !== false })}
      toRow={(v, r) => ({ ...r, label: v.label, level: v.level, source: v.source, active: v.active, ...(r.op && numOrNull(v.value) != null && { value: numOrNull(v.value) }) })}
      onChange={(next) => onChange({ ...content, rules: next })}
    />
  );
}

// What the server takes for a rule set: one change per rule.
export const ruleEdits = (kind, content) => ({
  rules: content.rules.map((r) =>
    kind === 'red_flag_rules'
      ? { key: r.key, label: r.label, level: r.level, message: r.message ?? '', source: r.source ?? '', active: r.active !== false, values: r.conditions.map((c) => c.value ?? null) }
      : { key: r.key, label: r.label, level: r.level, value: r.value ?? null, source: r.source ?? '', active: r.active !== false },
  ),
});
