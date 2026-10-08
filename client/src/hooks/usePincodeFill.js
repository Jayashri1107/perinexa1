// Fills in the city and state of a form's address once its PIN code has 6 digits (asked of the server, which asks the
// India Post PIN code service – only the PIN code is sent). Nothing happens when the service cannot be reached:
// the city and state are then typed by hand.
import { useEffect, useRef } from 'react';
import { patientsApi } from '../api/index.js';

export function usePincodeFill(form, prefix = 'address') {
  const pin = form.valueOf(`${prefix}.pincode`) ?? '';
  const asked = useRef(pin); // a PIN code the form opened with is not looked up again
  const { setField } = form;
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(pin) || asked.current === pin) return undefined;
    asked.current = pin;
    let cancelled = false;
    patientsApi
      .pincode(pin)
      .then((r) => {
        if (cancelled) return;
        if (r.city) setField(`${prefix}.city`, r.city);
        if (r.state) setField(`${prefix}.state`, r.state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pin, prefix, setField]);
}

/** The same, as a piece to put inside a form: a PIN code the form opened with is left alone. */
export function PincodeFill({ form, prefix }) {
  usePincodeFill(form, prefix);
  return null;
}
