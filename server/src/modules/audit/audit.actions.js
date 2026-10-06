// Every event the audit log can hold, with the plain words shown on screen.
// A new event is added here once; the model, the filter and the screen all read this list.
export const AUDIT_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'Logged in',
  LOGIN_FAILED: 'Login failed',
  LOGIN_RATE_LIMITED: 'Too many login attempts',
  LOGOUT: 'Logged out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET: 'Password reset',
  USER_CREATED: 'Account created',
  USER_UPDATED: 'Account updated',
  USER_ACTIVATED: 'Account activated',
  USER_DEACTIVATED: 'Account deactivated',
  HOSPITAL_CREATED: 'Hospital created',
  HOSPITAL_UPDATED: 'Hospital updated',
  HOSPITAL_ACTIVATED: 'Hospital activated',
  HOSPITAL_DEACTIVATED: 'Hospital deactivated',
  MEMBER_ADDED: 'Staff added to hospital',
  MEMBER_ROLES_CHANGED: 'Staff roles changed',
  MEMBER_ACTIVATED: 'Staff access activated',
  MEMBER_DEACTIVATED: 'Staff access deactivated',
  MASTER_CREATED: 'Master data added',
  MASTER_UPDATED: 'Master data updated',
  MASTER_ACTIVATED: 'Master data activated',
  MASTER_DEACTIVATED: 'Master data deactivated',
});

export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTIONS);
