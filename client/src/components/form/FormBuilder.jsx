// Draws any form from a list of field descriptions. `form` is the object from useForm().
// A field with showIf(values) appears only when that returns true; a "section" entry draws a heading.
import { getPath } from '../../utils/objectPath.js';
import { Alert } from '../Alert.jsx';
import { FormField } from './FormField.jsx';

export function FormBuilder({ fields, form }) {
  return (
    <div className="form-grid">
      <Alert type="error">{form.formError}</Alert>
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
