// Patients' sign-in OTPs through MSG91 (17 Oct 2026). MSG91 is never called: a stand-in records what would be sent.
import { describe, expect, it } from 'vitest';
import { msg91, otpText } from '../src/reminders/sender.js';

const answer = (status, body) => async (url, init) => {
  answer.last = { url, init };
  return { ok: status < 400, status, json: async () => body };
};

describe('MSG91 for OTPs', () => {
  it('is off without both keys', () => {
    expect(msg91({ authKey: '', templateId: 'T1' })).toBeNull();
    expect(msg91({ authKey: 'K', templateId: '' })).toBeNull();
  });

  it('sends the DLT template with her OTP, the hospital (at most 30 letters) and the minutes, to 91 + her number', async () => {
    const fetchFn = answer(200, { type: 'success', message: 'req-1' });
    const out = await msg91({ authKey: 'sample-key', templateId: 'sample-template', fetchFn }).sendOtp({ to: '+919876543210', otp: '042117', hospital: 'Sample Hospital With A Very Long Name Indeed', minutes: 10 });
    expect(out).toEqual({ providerId: 'req-1' });
    expect(answer.last.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(answer.last.init.headers.authkey).toBe('sample-key');
    expect(JSON.parse(answer.last.init.body)).toEqual({
      template_id: 'sample-template',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '042117', hospital: 'Sample Hospital With A Very Lo', minutes: '10' }],
    });
  });

  it('a 10-digit number gets 91 in front', async () => {
    await msg91({ authKey: 'k', templateId: 't', fetchFn: answer(200, { type: 'success' }) }).sendOtp({ to: '9876543210', otp: '1', hospital: 'H', minutes: 10 });
    expect(JSON.parse(answer.last.init.body).recipients[0].mobiles).toBe('919876543210');
  });

  it('a refusal – an HTTP error, or 200 with type "error" – is an error (MSG91\'s own message is not passed on)', async () => {
    const send = (status, body) => msg91({ authKey: 'k', templateId: 't', fetchFn: answer(status, body) }).sendOtp({ to: '9876543210', otp: '1', hospital: 'H', minutes: 10 });
    await expect(send(401, { type: 'error', message: 'Authentication failure for 9876543210' })).rejects.toThrow('MSG91 refused the message (401, error)');
    await expect(send(200, { type: 'error', message: 'Template not approved' })).rejects.toThrow('(200, error)');
  });

  it('the wording is the one registered on DLT', () => {
    expect(otpText('123456', 'Sample Hospital', 10)).toBe('123456 is your OTP to sign in to Sample Hospital. It works for 10 minutes. Do not share it.');
  });
});
