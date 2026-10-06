// Draws any form from a list of field descriptions. `form` is the object from useForm().
// A field with showIf(values) appears only when that returns true; a "section" entry draws a heading.
// A server message for a field that is not on screen is shown at the top, so no error is ever invisible.
import { getPath } from '../../utils/objectPath.js';
import { Alert } from '../Alert.jsx';
import { FormField } from './FormField.jsx';

export function FormBuilder({ fields, form }) {
  const visible = fields.filter((f) => !f.section && (!f.showIf || f.showIf(form.values)));
  const visibleNames = new Set(visible.map((f) => f.name));
  const otherErrors = Object.entries(form.errors).filter(([name, message]) => message && !visibleNames.has(name));

  return (
    <div className="form-grid">
      <Alert type="error">
        {form.formError}
        {otherErrors.map(([name, message]) => (
          <div key={name}>{message}</div>
        ))}
      </Alert>
      {fields
        .filter((f) => !f.showIf || f.showIf(form.values))
        .map((f) =>
          f.section ? (
            <h3 key={f.section} className="form-section">{f.section}</h3>
          ) : (
            <FormField key={f.name} field={f} value={getPath(form.values, f.name)} error={form.errors[f.name]} onChange={(v) => form.setField(f.name, v)} />
          ),
        )}
    </div>
  );
}
