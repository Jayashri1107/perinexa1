// A patient registered at the desk for OPD is marked arrived, so she is on Today's patients (28 Oct 2026).
import { describe, expect, it } from 'vitest';
import { arrivesOnRegistration } from './patientFormat.js';

describe('registering a patient marks her arrived', () => {
  it('for OPD at the desk, by reception, nurses, doctors and RMOs', () => {
    for (const role of ['receptionist', 'nurse', 'doctor', 'rmo']) expect(arrivesOnRegistration({ setting: 'opd', roles: [role] }), role).toBe(true);
  });

  it('not for a stay, a booking, an online sign-up, or a role that does not mark arrivals', () => {
    expect(arrivesOnRegistration({ setting: 'ipd', roles: ['receptionist'] })).toBe(false);
    expect(arrivesOnRegistration({ setting: 'day_care', roles: ['receptionist'] })).toBe(false);
    expect(arrivesOnRegistration({ setting: 'opd', booking: { id: 'a1' }, roles: ['receptionist'] })).toBe(false);
    expect(arrivesOnRegistration({ setting: 'opd', fromSignup: { id: 's1' }, roles: ['receptionist'] })).toBe(false);
    expect(arrivesOnRegistration({ setting: 'opd', roles: ['billing', 'admin'] })).toBe(false);
  });
});
