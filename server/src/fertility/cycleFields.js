// The cycle (follicular study) sheet (docs/FERTILITY_PLAN.md section 7): the lists the FertilityCycle model, the routes
// and the website share (client/src/pages/patients/fertilityCycleFormat.js keeps the same keys with labels in English,
// Marathi and Hindi; a test compares them).

export const PROTOCOL_KINDS = ['natural', 'letrozole', 'clomiphene', 'gonadotrophins', 'letrozole_gonadotrophins', 'other'];
export const ENDOMETRIUM_PATTERNS = ['trilaminar', 'homogeneous', 'other'];
export const TIMING_KINDS = ['intercourse', 'iui', 'none'];
export const CANCEL_REASONS = ['too_many_follicles', 'no_response', 'ovulated_early', 'patient_choice', 'other'];
export const TEST_RESULTS = ['positive', 'negative', 'not_done'];
export const CLINICAL_RESULTS = ['yes', 'no', 'pending'];
export const CYCLE_STATUSES = ['monitoring', 'after_trigger', 'completed', 'cancelled'];

export const MAX_ENTRIES = 20; // scan days in one cycle
export const MAX_FOLLICLES = 12; // follicles measured per ovary on one day
export const FOLLICLE_MM = { min: 2, max: 60 };
export const ENDOMETRIUM_MM = { min: 0, max: 40 };
export const HORMONES = { e2: { min: 0, max: 20000 }, lh: { min: 0, max: 500 }, p4: { min: 0, max: 500 } };
export const POST_WASH_MILLIONS = { min: 0, max: 500 };
export const BETA_HCG = { min: 0, max: 500000 };

/** The cycle's state from what is filled in: cancelled, or completed once a test result is in, or after the trigger. */
export function statusOf(c) {
  if (c.cancelled?.reason) return 'cancelled';
  const o = c.outcome ?? {};
  if (TEST_RESULTS.includes(o.test) || o.clinical === 'yes' || o.clinical === 'no') return 'completed';
  if (c.trigger?.at || c.timing?.on) return 'after_trigger';
  return 'monitoring';
}
