import { Field } from './ui.jsx';

// The second-person check (Clinical Requirements Group C – PX-X-06): a second member of staff types their own email
// and password here, on the same screen, for this one step. Their password is checked as at sign-in and never kept;
// only their name, role and the time are saved. value: { email, password }.

export function WitnessFields({ id, value, onChange, errors = {}, what }) {
  return (
    <fieldset className="fieldset witness">
      <legend>Second person</legend>
      <p className="hint">{`${what} is checked by two people. The second person types their own email and password – it is not saved, only their name and the time.`}</p>
      <div className="form-grid">
        <Field label="Their email" id={`${id}-email`} error={errors['witness.email']}>
          <input id={`${id}-email`} type="email" autoComplete="off" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
        </Field>
        <Field label="Their password" id={`${id}-password`} error={errors['witness.password']}>
          <input id={`${id}-password`} type="password" autoComplete="new-password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} />
        </Field>
      </div>
    </fieldset>
  );
}

export const emptyWitness = () => ({ email: '', password: '' });
/** "Checked by Name (Role), time" for a saved second-person stamp. */
export const witnessWords = (w, formatDateTime) => (w ? `Checked by ${w.byName} (${w.role}), ${formatDateTime(w.at)}` : '');
