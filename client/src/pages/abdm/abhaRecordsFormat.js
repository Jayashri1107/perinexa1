// Her records in ABHA (ABDM milestone M2) in words: each record's status, why a record is not shared, the consents
// and what was sent. PURE – the server decides what may be shared (server/src/abdm/shareRules.js); this only says it.
import { Ban, CircleCheck, CircleX, Clock, Hourglass, Link2, Send, TriangleAlert } from 'lucide-react';

export const HI_TYPE_WORDS = { OPConsultation: 'Consultation', Prescription: 'Prescription', DiagnosticReport: 'Lab report', DischargeSummary: 'Discharge summary' };
export const HI_TYPES = Object.keys(HI_TYPE_WORDS);
export const typesLine = (types = []) => types.map((t) => HI_TYPE_WORDS[t] ?? t).join(', ');

/** Why a record is not shared (the server's reason codes). */
export const REASON_WORDS = {
  visit_not_signed: 'The visit is not signed yet.',
  lab_not_reviewed: 'A doctor has not reviewed these results (or they were changed after the review).',
  discharge_not_signed: 'The discharge card is not confirmed yet.',
  entered_in_error: 'Marked entered in error.',
  cancelled: 'The lab order was cancelled.',
  confidential_test: 'HIV test – confidential, never shared.',
  mentions_confidential: 'It mentions HIV – confidential, never shared.',
  sensitive_record: 'Her record is marked sensitive.',
  hiv_on_record: 'HIV is among her known conditions: her visits and discharge summaries are never shared (confidential).',
};

/** What is never shared through ABHA – said on her ABHA tab. */
export const NEVER_SHARED = [
  'Anything from a record marked sensitive.',
  'HIV tests (confidential), any record that mentions HIV, and – when HIV is among her known conditions – her visits and discharge summaries.',
  "The doctor's private note, and the reasons given to go ahead despite a medicine warning.",
  "The doctor's review comment on lab results, and the note to the lab.",
  'A visit that is not signed, lab results not reviewed by a doctor (or changed since), a discharge card not confirmed.',
  'Anything marked entered in error, and cancelled lab orders.',
  'Report files (PDFs and photos), scan reports, operation notes, care plans, consent forms and bills. A discharge summary still lists the procedures and operations written on it.',
];
/** The words that mark a record as about HIV are a draft (server/src/abdm/shareRules.js, shown on Hospital admin → ABDM). */
export const CONFIDENTIAL_DRAFT_NOTE = "The words that mark a record as about HIV are a draft list, to be checked by the hospital's doctor before use (Hospital admin → ABDM).";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Oct 2026" – the day of a moment on this computer's clock (as the other times on the screens). */
const shortDate = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/**
 * A record's status on the list: { tone, icon, label, hint } – a status is always colour, icon and word.
 * A link to an earlier ABHA does not count (her record has another ABHA now).
 */
export function recordStatus(item) {
  const l = item.link && !item.link.earlierAbha ? item.link : null;
  const reason = REASON_WORDS[item.reason] ?? '';
  if (l?.status === 'linked') {
    const how = item.link.via === 'patient' ? `Linked from her ABHA app, ${shortDate(l.at)}.` : `Linked by ${l.byName || 'the hospital'}, ${shortDate(l.at)}.`;
    if (item.state !== 'ready') return { tone: 'watch', icon: Link2, label: 'Linked – not shared now', hint: `${how} ${reason}`.trim() };
    return { tone: 'stable', icon: Link2, label: 'Linked', hint: how };
  }
  if (l?.status === 'waiting') return { tone: 'due', icon: Hourglass, label: 'Waiting for ABDM', hint: 'ABDM has not answered yet.' };
  if (l?.status === 'no_answer' && item.state === 'ready') return { tone: 'high', icon: TriangleAlert, label: 'No answer from ABDM', hint: 'ABDM did not answer within 30 minutes. It can be linked again.' };
  if (l?.status === 'failed' && item.state === 'ready') return { tone: 'high', icon: CircleX, label: 'Not linked', hint: [l.error, 'It can be linked again.'].filter(Boolean).join(' ') };
  if (item.state === 'ready') {
    const hint = item.link?.earlierAbha ? 'Linked to her earlier ABHA – link it again to her ABHA now.' : '';
    return { tone: 'neutral', icon: CircleCheck, label: 'Can be linked', hint: [hint, item.confidentialLeftOut ? 'Shared without the HIV test (confidential).' : ''].filter(Boolean).join(' ') };
  }
  if (item.state === 'not_yet') return { tone: 'inactive', icon: Clock, label: 'Not yet', hint: reason };
  return { tone: 'inactive', icon: Ban, label: 'Never shared', hint: reason };
}

/** May this record be ticked for "Link to ABHA"? */
export const canChoose = (item) => item.state === 'ready' && !(item.link && !item.link.earlierAbha && ['linked', 'waiting'].includes(item.link.status));

/** Counts for the heading: linked to her ABHA now, ready to link. */
export function recordCounts(items = []) {
  return {
    linked: items.filter((i) => i.link && !i.link.earlierAbha && i.link.status === 'linked').length,
    ready: items.filter(canChoose).length,
  };
}

const CONSENT = {
  GRANTED: { tone: 'stable', label: 'Consent given' },
  REVOKED: { tone: 'inactive', label: 'Withdrawn' },
  EXPIRED: { tone: 'inactive', label: 'Expired' },
  DENIED: { tone: 'inactive', label: 'Refused' },
};
export const consentStatus = (c) => CONSENT[c.status] ?? { tone: 'inactive', label: c.status };

/** "Lab report, Discharge summary · records of 1 Jan 2026 to 5 Oct 2026 · until 4 Nov 2026" */
export function consentLine(c) {
  return [typesLine(c.hiTypes), c.from || c.to ? `records of ${shortDate(c.from) || 'any date'} to ${shortDate(c.to) || 'today'}` : '', c.expiresAt ? `until ${shortDate(c.expiresAt)}` : ''].filter(Boolean).join(' · ');
}

const REFUSAL_WORDS = {
  unknown_consent: 'no consent was found for it',
  consent_revoked: 'the consent was withdrawn',
  consent_denied: 'the consent was refused',
  consent_expired: 'the consent had expired',
  consent_incomplete: 'the consent did not say its dates or until when it lasts',
  dates_outside_consent: 'the dates asked for were outside the consent',
  push_address: 'the address to send to was not allowed',
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One request for data, in words – counts only. */
export function transferLine(t) {
  if (t.status === 'refused') return `Nothing sent: ${REFUSAL_WORDS[t.refusal] ?? 'it was refused'}.`;
  if (t.status === 'working') return 'Being sent.';
  const held = t.heldBack ? `, ${plural(t.heldBack, 'record')} held back` : '';
  if (t.status === 'sent') return `Sent: ${plural(t.records, 'record')} (${plural(t.documents, 'document')})${held}.${t.error ? ` ${t.error}` : ''}`;
  if (t.status === 'failed') return `Not sent: ${(t.error || 'the records could not be sent').replace(/\.$/, '')}.`;
  return `Nothing sent: none of the records may be shared now${held}.`;
}

/**
 * One request for data as a status: { tone, icon, label, hint } – colour, icon and word, with the counts as the hint.
 */
export function transferStatus(t) {
  const held = t.heldBack ? `, ${plural(t.heldBack, 'record')} held back` : '';
  if (t.status === 'refused') return { tone: 'inactive', icon: Ban, label: 'Nothing sent', hint: `${(REFUSAL_WORDS[t.refusal] ?? 'it was refused').replace(/^./, (c) => c.toUpperCase())}.` };
  if (t.status === 'working') return { tone: 'due', icon: Hourglass, label: 'Being sent', hint: '' };
  if (t.status === 'sent') return { tone: 'stable', icon: Send, label: 'Sent', hint: `${plural(t.records, 'record')} (${plural(t.documents, 'document')})${held}.${t.error ? ` ${t.error}` : ''}` };
  if (t.status === 'failed') return { tone: 'high', icon: TriangleAlert, label: 'Not sent', hint: `${(t.error || 'The records could not be sent').replace(/\.$/, '')}.` };
  return { tone: 'inactive', icon: Ban, label: 'Nothing sent', hint: `None of the records may be shared now${held}.` };
}

/** The practice consent form, to start with: the last 12 months, every kind of record, valid 30 days – by this computer's own date. */
export function practiceConsentDefaults(today = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  return { from: iso(from), to: iso(today), hiTypes: [...HI_TYPES], days: 30 };
}
