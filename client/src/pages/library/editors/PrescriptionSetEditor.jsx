// A prescription set: the medicines with their doses, general instructions, tests advised and advice for the patient.
// It is only a starting point: the doctor changes it for each patient before saving a prescription.
import { Plus, Trash2 } from 'lucide-react';

const FIELDS = [
  ['drug', 'Medicine', 'e.g. Folic acid'],
  ['form', 'Form', 'tab'],
  ['strength', 'Strength', '5 mg'],
  ['dose', 'Dose', '1'],
  ['frequency', 'How often', '1-0-1'],
  ['timing', 'When', 'after_food'],
  ['durationValue', 'For', '5'],
  ['durationUnit', 'Unit', 'days'],
  ['instructions', 'Instructions', ''],
];
const EMPTY = { drug: '', form: '', strength: '', dose: '', frequency: '', frequencyText: '', timing: '', route: '', durationValue: null, durationUnit: '', instructions: '' };
const words = (v) => String(v ?? '').replace(/_/g, ' ');
const durationText = (i) => (i.durationUnit === 'till_delivery' ? 'till delivery' : i.durationValue ? `${i.durationValue} ${i.durationUnit}` : words(i.durationUnit));

export function PrescriptionSetEditor({ content, editing, onChange }) {
  const items = content.items ?? [];
  const set = (patch) => onChange({ ...content, ...patch });
  const setItem = (i, key, value) => set({ items: items.map((it, j) => (j === i ? { ...it, [key]: value } : it)) });

  return (
    <div className="pad">
      <div className="table-wrap">
        <table className="table rx-table">
          <thead>
            <tr>{FIELDS.map(([, label]) => <th key={label}>{label}</th>)}{editing && <th />}</tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={FIELDS.length + 1} className="empty">No medicines yet.</td></tr>}
            {items.map((it, i) =>
              editing ? (
                <tr key={i}>
                  {FIELDS.map(([key, label, hint]) => (
                    <td key={key}>
                      <input
                        aria-label={`${label}, medicine ${i + 1}`}
                        placeholder={hint}
                        value={it[key] ?? ''}
                        inputMode={key === 'durationValue' ? 'numeric' : undefined}
                        onChange={(e) => setItem(i, key, key === 'durationValue' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                      />
                    </td>
                  ))}
                  <td><button type="button" className="icon-btn" aria-label={`Remove medicine ${i + 1}`} onClick={() => set({ items: items.filter((_, j) => j !== i) })}><Trash2 size={15} /></button></td>
                </tr>
              ) : (
                <tr key={i}>
                  <td><strong>{it.drug}</strong></td>
                  <td>{it.form}</td>
                  <td>{it.strength}</td>
                  <td>{it.dose}</td>
                  <td>{it.frequency || it.frequencyText}</td>
                  <td>{words(it.timing)}</td>
                  <td colSpan={2}>{durationText(it)}</td>
                  <td className="small">{it.instructions}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <button type="button" className="btn btn-ghost btn-sm top-gap-sm" disabled={items.length >= 20} onClick={() => set({ items: [...items, { ...EMPTY }] })}>
          <Plus size={14} aria-hidden /> Add a medicine
        </button>
      )}
      <div className="form-grid top-gap">
        {[
          ['notes', 'General instructions (printed under the medicines)', 1000],
          ['investigations', 'Tests advised', 1000],
          ['advice', 'Advice for the patient', 2000],
        ].map(([key, label, max]) => (
          <div key={key} className="form-field width-third">
            <label htmlFor={`rx-${key}`}>{label}</label>
            {editing ? <textarea id={`rx-${key}`} rows={4} maxLength={max} value={content[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} /> : <p className="pre small" id={`rx-${key}`}>{content[key] || '—'}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
