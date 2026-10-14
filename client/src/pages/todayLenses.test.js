// Today for someone with many roles (owner, 14 Oct 2026): an Overview plus one view per role they have; someone with
// one or two roles gets their own Today as before.
import { describe, expect, it } from 'vitest';
import { lensesFor } from './TodayPage.jsx';

describe('lensesFor', () => {
  it('gives no switch to a receptionist, a doctor, or a doctor who is also an admin', () => {
    expect(lensesFor(['receptionist'])).toEqual([]);
    expect(lensesFor(['doctor'])).toEqual([]);
    expect(lensesFor(['doctor', 'admin'])).toEqual([]);
  });

  it('gives a super admin in a hospital (every role) the Overview first and a view per role', () => {
    const keys = lensesFor(['doctor', 'rmo', 'nurse', 'receptionist', 'lab', 'pharmacist', 'billing', 'admin']).map((l) => l.key);
    expect(keys).toEqual(['overview', 'reception', 'doctor', 'ward', 'lab', 'pharmacy', 'billing', 'admin']);
  });
});
