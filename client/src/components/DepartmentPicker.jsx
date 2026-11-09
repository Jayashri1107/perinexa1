import { DEPARTMENTS } from '../platform/departments.js';
import { FieldError } from './ui.jsx';

/**
 * A doctor's departments on the Add person forms (owner, 9 Nov 2026 – docs/DEPARTMENT_ACCESS_PLAN.md): shown when
 * "Doctor" is ticked. A doctor sees only the patients of their departments, so at least one is asked for.
 */
export function DepartmentPicker({ value, onChange, idPrefix = 'dept', error, disabled = false }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : DEPARTMENTS.filter((x) => x === d || value.includes(x)));
  return (
    <fieldset className="fieldset">
      <legend>Doctor's departments</legend>
      <p className="hint">The doctor sees only the patients of these departments. Choose at least one.</p>
      <div className="role-picker" role="group">
        {DEPARTMENTS.map((d) => (
          <label key={d} className={`role-option ${value.includes(d) ? 'checked' : ''}`} htmlFor={`${idPrefix}-${d.replace(/\W+/g, '-')}`}>
            <input id={`${idPrefix}-${d.replace(/\W+/g, '-')}`} type="checkbox" checked={value.includes(d)} onChange={() => toggle(d)} disabled={disabled} />
            <span>
              <strong>{d}</strong>
            </span>
          </label>
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}

/** The message when a doctor is added without a department, or null. */
export const departmentsMissing = (roles, departments) => (roles.includes('doctor') && departments.length === 0 ? 'Choose at least one department for the doctor.' : null);
