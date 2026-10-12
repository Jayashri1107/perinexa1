import { config } from '../config.js';

// Sending a printout (a prescription or a visit summary, as a PDF) to the patient on WhatsApp in one click, from the
// hospital's own WhatsApp Business number, through Meta's WhatsApp Business Platform (Cloud API).
//
// ⚠️ A privacy step: the PDF leaves Perinexa and goes through Meta's servers. So it is off unless ALL of these hold:
//   - WHATSAPP_MODE is set in server/.env ('practice' pretends to send – nothing leaves the computer; 'live' sends);
//   - for 'live': the phone number id and access token of the hospital's WhatsApp Business account are in
//     server/.env (never in the code, never in chat), and Meta approved the message template named there;
//   - the hospital admin switched it on (Hospital admin → Patient messages);
//   - the patient agreed to WhatsApp messages (recorded on her page: More → Reminders and portal).
// It only ever goes to the mobile number on the patient's own record. Nothing about a message is written to the
// server's log.
//
// Meta's rule: a business may start a conversation only with an approved TEMPLATE. The template must have a
// DOCUMENT header (the PDF) and a body with one variable, {{1}} – the hospital's name. Suggested body:
//   "Your document from {{1}} is attached. Please call the hospital if you have any questions."

const practiceOutbox = [];
/** Tests and practice mode: what was "sent" ({ to, fileName, bytes, hospital }) – never the PDF itself. */
export const practiceSent = () => practiceOutbox;

/** How one-click WhatsApp is set up: { mode: '' | 'practice' | 'live', ready }. */
export function whatsappStatus() {
  const mode = config.WHATSAPP_MODE;
  if (mode === 'practice') return { mode, ready: true };
  if (mode === 'live') return { mode, ready: Boolean(config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_TEMPLATE) };
  return { mode: '', ready: false };
}

const refused = (step, res, data) => new Error(`WhatsApp refused the ${step} (${res.status}${data?.error?.code ? `, code ${data.error.code}` : ''})`);

/**
 * Sends one PDF. to: "+919876543210"; pdf: a Buffer. Returns { providerId }. Throws an Error that names only the
 * step and the provider's status – never the number or anything from the document.
 */
export async function sendDocument({ to, pdf, fileName, hospital }) {
  const { mode, ready } = whatsappStatus();
  if (!ready) throw new Error('WhatsApp sending is not set up');
  if (mode === 'practice') {
    practiceOutbox.push({ to, fileName, bytes: pdf.length, hospital });
    return { providerId: `practice-${practiceOutbox.length}` };
  }
  const base = `${config.WHATSAPP_API_URL}/${encodeURIComponent(config.WHATSAPP_PHONE_NUMBER_ID)}`;
  const auth = { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` };
  // 1. The PDF is uploaded to WhatsApp, which gives it an id
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', 'application/pdf');
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), fileName);
  const up = await fetch(`${base}/media`, { method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(30_000) });
  const media = await up.json().catch(() => ({}));
  if (!up.ok || !media.id) throw refused('file', up, media);
  // 2. The approved template is sent with that file as its header
  const message = {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: config.WHATSAPP_TEMPLATE,
      language: { code: config.WHATSAPP_TEMPLATE_LANG },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: media.id, filename: fileName } }] },
        { type: 'body', parameters: [{ type: 'text', text: hospital }] },
      ],
    },
  };
  const res = await fetch(`${base}/messages`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw refused('message', res, data);
  return { providerId: String(data.messages?.[0]?.id ?? '') };
}
