// WhatsApp without a paid service (owner, 10 Oct 2026): a link that opens WhatsApp (the app, or WhatsApp Web) at the
// patient's number with the message written in. Staff press Send there and attach a PDF if one goes with it (Print →
// Save as PDF). Nothing is sent by Perinexa1 itself. Indian mobile numbers: 10 digits get the country code 91.

/** The number as WhatsApp wants it (digits only, with the country code), or '' when it does not look like a mobile. */
export function whatsappNumber(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : '';
}

/** The link that opens a chat with the message, or null without a usable number. */
export function whatsappUrl(phone, text) {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

const first = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';

// Short messages in Marathi and English together. The Marathi wording is a draft – to be checked by a Marathi speaker.
// No test names, results or amounts: those are in the attached PDF.
export const reportMessage = ({ name, hospital }) =>
  `नमस्कार ${first(name)}, ${hospital} मधील आपला तपासणी अहवाल तयार आहे. तो या संदेशासोबत पाठवला आहे.\n\nNamaste ${first(name)}, your report from ${hospital} is ready. It is attached to this message.`;

export const billMessage = ({ name, hospital, billNumber }) =>
  `नमस्कार ${first(name)}, ${hospital} चे आपले बिल ${billNumber} या संदेशासोबत पाठवले आहे. धन्यवाद.\n\nNamaste ${first(name)}, your bill ${billNumber} from ${hospital} is attached to this message. Thank you.`;
