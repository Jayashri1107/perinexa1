import { PasswordInput } from './PasswordInput.jsx';

// One field of any form. The field is described by data (see client/src/forms/*.js):
// { name, label, type, required, options, placeholder, help, width, disabled, autoComplete }
// type: text | email | password | number | tel | date | textarea | select | checkboxes
export function FormField({ field, value, error, onChange }) {
  const id = `field-${field.name.replace(/\./g, '-')}`;
  const common = {
    id,
    name: field.name,
    disabled: field.disabled,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${id}-error` : field.help ? `${id}-help` : undefined,
  };

  let control;
  switch (field.type) {
    case 'password':
      control = <PasswordInput {...common} value={value} placeholder={field.placeholder} autoComplete={field.autoComplete} onChange={onChange} />;
      break;
    case 'textarea':
      control = <textarea {...common} rows={field.rows ?? 3} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.placeholder ?? 'Choose…'}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'checkboxes': {
      const selected = value ?? [];
      const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
      control = (
        <div className="checkbox-group" role="group" aria-labelledby={`${id}-label`}>
          {field.options.length === 0 && <span className="muted">{field.emptyText ?? 'Nothing to choose yet.'}</span>}
          {field.options.map((o) => (
            <label key={o.value} className={`chip-check${selected.includes(o.value) ? ' checked' : ''}`}>
              <input type="checkbox" checked={selected.includes(o.value)} disabled={field.disabled} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    default:
      control = (
        <input
          {...common}
          type={field.type ?? 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        />
      );
  }

  return (
    <div className={`form-field width-${field.width ?? 'full'}${error ? ' has-error' : ''}`}>
      <label id={`${id}-label`} htmlFor={field.type === 'checkboxes' ? undefined : id}>
        {field.label}
        {field.required && <span className="required" aria-hidden> *</span>}
      </label>
      {control}
      {error ? (
        <span id={`${id}-error`} className="field-error">{error}</span>
      ) : (
        field.help && <span id={`${id}-help`} className="field-help">{field.help}</span>
      )}
    </div>
  );
}
