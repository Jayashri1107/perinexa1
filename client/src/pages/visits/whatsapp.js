// Sending a printout on WhatsApp from the print preview: WhatsApp's own "click to chat" link opens a chat with the
// patient's number, and the doctor attaches the PDF (saved at the same moment). A website can't put a file into a
// chat by itself; sending it automatically needs Meta's WhatsApp Business Platform (docs/PRESCRIPTIONS.md).

/**
 * The number as WhatsApp needs it – the country code and number, digits only ("919876543210") – or null when it is
 * not a mobile number. An Indian mobile number (10 digits, 6–9 first; written with or without +91, 91 or 0) gets 91;
 * a number written with + and another country's code is used as written.
 */
export function whatsappNumber(phone) {
  const text = String(phone ?? '').trim();
  const digits = text.replace(/\D/g, '');
  const indian = digits.replace(/^(?:0091|091|91|0)(?=[6-9]\d{9}$)/, '');
  if (/^[6-9]\d{9}$/.test(indian)) return `91${indian}`;
  if (text.startsWith('+') && !digits.startsWith('91') && /^[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

/** WhatsApp's click-to-chat address. No message in it: nothing about the patient goes into the address. */
export const whatsappLink = (number) => `https://wa.me/${number}`;

/** The number as people write it: "+91 98765 43210". */
export const showWhatsappNumber = (number) => (number.length === 12 && number.startsWith('91') ? `+91 ${number.slice(2, 7)} ${number.slice(7)}` : `+${number}`);

/** A file as base64 text (to send the PDF to the server, which passes it on to WhatsApp). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The PDF could not be read.'));
    reader.readAsDataURL(blob);
  });
}
