// The number a message goes to. On its own (no other imports), so the appointment rules and the reminder rounds can
// both use it.

/**
 * The number with its country code ("+919876543210"), or null when it is not a mobile number. An Indian mobile
 * number (10 digits starting 6–9, with or without +91, 91 or 0) gets +91; a "+" number of another country is kept.
 */
export function mobileNumber(phone) {
  const text = String(phone ?? '').trim();
  const digits = text.replace(/\D/g, '');
  const indian = digits.replace(/^(?:0091|091|91|0)(?=[6-9]\d{9}$)/, '');
  if (/^[6-9]\d{9}$/.test(indian)) return `+91${indian}`;
  if (text.startsWith('+') && !digits.startsWith('91') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}
