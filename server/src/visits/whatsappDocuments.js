import { mobileNumber } from '../reminders/phone.js';
import { Tenant } from '../models/Tenant.js';
import { isClosed } from '../patients/deathRules.js';
import { HttpError } from '../utils/httpError.js';
import { sendDocument, whatsappStatus } from './whatsappSender.js';

// A PDF sent to the patient on WhatsApp in one click – the bill or receipt, the reviewed lab report (owner, 17 Oct
// 2026 – docs/WHATSAPP_DESK_PLAN.md), as the prescription already is (routes/visits.js). The same four conditions:
// WhatsApp set up in server/.env, the hospital admin switched documents on (Hospital admin → Patient messages), a
// mobile number on her record, and her agreement to WhatsApp messages. A closed record gets nothing. The PDF is made
// in the browser and goes only to the number on her own record – the browser never chooses the number.

export const MAX_WHATSAPP_PDF_BYTES = 5 * 1024 * 1024;

const WORDS = {
  not_set_up: 'Sending on WhatsApp is not set up on this server.',
  switched_off: 'Sending on WhatsApp is switched off for this hospital (Hospital admin → Patient messages).',
  no_mobile: 'Her record has no mobile number.',
  no_agreement: 'She has not agreed to WhatsApp messages (her page: More → Reminders and portal).',
  record_closed: 'This record is closed, so nothing is sent from it. Print it, or use Download PDF.',
};

/** Whether a document can be sent to this patient now, and if not, why: { available, reason, practice, to, hospital }. */
export async function documentOffer(tenantId, patient) {
  const status = whatsappStatus();
  const tenant = await Tenant.findById(tenantId, { name: 1, letterhead: 1, messaging: 1 }).lean();
  const to = mobileNumber(patient.phone);
  let reason = null;
  if (isClosed(patient)) reason = 'record_closed';
  else if (!status.ready) reason = 'not_set_up';
  else if (!tenant?.messaging?.whatsappDocuments) reason = 'switched_off';
  else if (!to) reason = 'no_mobile';
  else if (!(patient.reminders?.consent && patient.reminders?.channel === 'whatsapp')) reason = 'no_agreement';
  return { available: !reason, reason, practice: status.mode === 'practice', to, hospital: tenant?.letterhead?.name || tenant?.name || '' };
}

/** The offer for the screen: { available, reason, practice, label } – the number only as its last 4 digits. */
export const offerView = (o) => ({ available: o.available, reason: o.reason, practice: o.practice, label: o.to ? `******${o.to.slice(-4)}` : null });

/** Sends the PDF (base64 from the browser) after checking the offer and the file. Throws the words to show. */
export async function sendPatientPdf(offer, { pdf: base64, fileName }) {
  if (!offer.available) throw new HttpError(409, WORDS[offer.reason], 'WHATSAPP_UNAVAILABLE');
  const pdf = Buffer.from(base64, 'base64');
  if (pdf.length > MAX_WHATSAPP_PDF_BYTES) throw new HttpError(400, 'The PDF is too large to send (5 MB at most).', 'VALIDATION');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only a PDF can be sent.', 'VALIDATION');
  try {
    await sendDocument({ to: offer.to, pdf, fileName, hospital: offer.hospital });
  } catch (err) {
    console.error('WhatsApp: a document could not be sent:', err?.message ?? err);
    throw new HttpError(502, `It was not sent: ${err?.message ?? 'WhatsApp could not be reached'}. Print it, or use Download PDF.`, 'WHATSAPP_FAILED');
  }
}
