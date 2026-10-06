// State for any form: values (nested names such as "address.city" work), the server's per-field messages,
// and a submit wrapper that shows them.
import { useCallback, useState } from 'react';
import { getPath, setPath } from '../utils/objectPath.js';

export function useForm(initialValues) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setField = useCallback((name, value) => {
    setValues((v) => setPath(v, name, value));
    setErrors((e) => ({ ...e, [name]: undefined }));
  }, []);

  const reset = useCallback((next = initialValues) => {
    setValues(next);
    setErrors({});
    setFormError('');
  }, [initialValues]);

  // submit(action) → an onSubmit handler. action(values) may throw an ApiError; returns its result or undefined.
  const submit = (action) => async (event) => {
    event?.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError('');
    try {
      return await action(values);
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      setFormError(err.message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  };

  return { values, errors, formError, submitting, setField, setValues, setErrors, reset, submit, valueOf: (name) => getPath(values, name) };
}
