// A table of rows (care-plan items, rules, medicine entries) that, while editing, opens each row in a dialog to change
// it, adds rows and removes those that may be removed. The dialog is drawn from field descriptions like every form.
// toValues(row) → the form's values; toRow(values, row) → the changed row (row is null for a new one).
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '../../../components/list/DataTable.jsx';
import { FormModal } from '../../../components/form/FormModal.jsx';
import { useForm } from '../../../hooks/useForm.js';

export function RowsEditor({ rows, columns, editing, fields, toValues, toRow, onChange, newRow, addLabel = 'Add', canRemove = () => false, title = 'Change', emptyText = 'Nothing here yet.', rowKey = 'key' }) {
  const [open, setOpen] = useState(null); // { index } (−1 = new)
  const form = useForm({});

  const edit = (index) => {
    form.reset(toValues(index === -1 ? newRow() : rows[index]));
    setOpen({ index });
  };
  const save = async (values) => {
    const row = toRow(values, open.index === -1 ? null : rows[open.index]);
    onChange(open.index === -1 ? [...rows, row] : rows.map((r, i) => (i === open.index ? row : r)));
    setOpen(null);
  };

  const shown = editing
    ? [
        ...columns,
        {
          key: '_edit',
          label: '',
          className: 'nowrap',
          render: (r) => {
            const index = rows.indexOf(r);
            return (
              <div className="row-actions">
                <button type="button" className="icon-btn" aria-label="Change" title="Change" onClick={() => edit(index)}><Pencil size={15} /></button>
                {canRemove(r) && (
                  <button type="button" className="icon-btn" aria-label="Remove" title="Remove" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                )}
              </div>
            );
          },
        },
      ]
    : columns;

  return (
    <>
      <DataTable columns={shown} rows={rows} emptyText={emptyText} rowKey={rowKey} />
      {editing && newRow && (
        <div className="pad-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(-1)}><Plus size={14} aria-hidden /> {addLabel}</button>
        </div>
      )}
      {open && (
        <FormModal
          title={open.index === -1 ? addLabel : title}
          size="lg"
          fields={fields(form.values, open.index === -1 ? null : rows[open.index])}
          form={form}
          submitLabel="Done"
          onSubmit={save}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

// Form inputs give numbers as '' when empty.
export const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
export const numInput = (v) => (v == null ? '' : v);
// "warfarin, acitrom" ⇄ ['warfarin', 'acitrom']
export const listOf = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export const listText = (list) => (list ?? []).join(', ');
