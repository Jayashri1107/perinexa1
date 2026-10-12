// Sending a printout on WhatsApp: the patient's number as WhatsApp needs it (fake sample numbers only).
import { describe, expect, it } from 'vitest';
import { showWhatsappNumber, whatsappLink, whatsappNumber } from './whatsapp.js';

describe('the WhatsApp number', () => {
  it('reads an Indian mobile number however it was written', () => {
    for (const phone of ['98765 43210', '9876543210', '+91 98765 43210', '91-98765-43210', '098765 43210', '(+91) 98765-43210']) {
      expect(whatsappNumber(phone), phone).toBe('919876543210');
    }
    expect(whatsappNumber('91234 56789')).toBe('919123456789'); // a number that itself starts with 91
  });

  it('takes a number from another country only when written with its code', () => {
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('44 7700 900123')).toBeNull(); // without the +, it is not clear whose number it is
  });

  it('refuses what is not a mobile number', () => {
    for (const phone of ['', null, '+91 00000 00002', '5566778899', '020 2567 8901', '12345', '+91 98765']) {
      expect(whatsappNumber(phone), String(phone)).toBeNull();
    }
  });

  it('opens a chat with the number only – nothing about the patient in the address', () => {
    expect(whatsappLink('919876543210')).toBe('https://wa.me/919876543210');
    expect(showWhatsappNumber('919876543210')).toBe('+91 98765 43210');
    expect(showWhatsappNumber('447700900123')).toBe('+447700900123');
  });
});
