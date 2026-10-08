import { PasswordInput } from './PasswordInput.jsx';

// One field of any form. The field is described by data (see client/src/forms/*.js):
// { name, label, type, required, options, placeholder, help, width, disabled, autoComplete }
// type: text | email | password | number | tel | date | textarea | select | checkboxes | switch
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
    case 'switch':
      control = (
        <label className={`switch${value ? ' on' : ''}`}>
          <input {...common} type="checkbox" role="switch" aria-labelledby={`${id}-label`} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
          <span className="switch-word">{value ? field.onLabel ?? 'On' : field.offLabel ?? 'Off'}</span>
        </label>
      );
      break;
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
    default: {
      // digits: only digits can be typed (anything else is dropped), at most `maxLength`; upper: capital letters.
      const clean = (v) => {
        if (field.digits) return v.replace(/\D/g, '');
        if (field.upper) return v.toUpperCase().replace(/\s+/g, '');
        return v;
      };
      control = (
        <input
          {...common}
          type={field.type ?? 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete}
          inputMode={field.digits ? 'numeric' : undefined}
          maxLength={field.maxLength}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : clean(e.target.value))}
        />
      );
    }
  }

  return (
    <div className={`form-field width-${field.width ?? 'full'}${error ? ' has-error' : ''}`}>
      <label id={`${id}-label`} htmlFor={field.type === 'checkboxes' || field.type === 'switch' ? undefined : id}>
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
