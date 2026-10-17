import { config } from '../config.js';

// Who sends the messages (Version 2): nobody (the default – staff send them by hand), or Twilio (SMS and WhatsApp).
// The keys come from server/.env only. Tests use the "test" sender, which keeps the messages in memory.
// Nothing about a message is written to the server's log.

const testOutbox = [];
export const testSent = () => testOutbox;
let testSender = null;
/** Tests only: replace the sender ({ send }), or null to go back to the configured one. */
export const setTestSender = (sender) => {
  testSender = sender;
};

export const TEST_SENDER = {
  name: 'test',
  channels: ['sms', 'whatsapp'],
  async send({ channel, to, text }) {
    testOutbox.push({ channel, to, text });
    return { providerId: `test-${testOutbox.length}` };
  },
};

function twilio() {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_SMS_FROM: smsFrom, TWILIO_WHATSAPP_FROM: waFrom } = config;
  if (!sid || !token || (!smsFrom && !waFrom)) return null;
  return {
    name: 'twilio',
    channels: [...(smsFrom ? ['sms'] : []), ...(waFrom ? ['whatsapp'] : [])],
    async send({ channel, to, text }) {
      const from = channel === 'whatsapp' ? waFrom : smsFrom;
      if (!from) throw new Error(`No ${channel} sender is set up`);
      const body = new URLSearchParams({ From: from, To: channel === 'whatsapp' ? `whatsapp:${to}` : to, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`The provider refused the message (${res.status}${data.code ? `, code ${data.code}` : ''})`);
      return { providerId: String(data.sid ?? '') };
    },
  };
}

/** The sender in use, or null when none is set up. */
export function currentSender() {
  if (testSender) return testSender;
  if (config.REMINDER_PROVIDER === 'twilio') return twilio();
  return null;
}

// ---------- Sign-in OTPs ----------
// In India every business SMS must use a template registered on DLT (TRAI); MSG91 links its templates to DLT. The
// OTP template in MSG91 (its "Flow") must read, with these variable names:
//   ##otp## is your OTP to sign in to ##hospital##. It works for ##minutes## minutes. Do not share it.
// (on DLT: {#var#} is your OTP to sign in to {#var#}. It works for {#var#} minutes. Do not share it.)
const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow';
const DLT_VARIABLE = 30; // a DLT variable holds at most 30 characters

/** MSG91, for OTPs only: { name, sendOtp({ to, otp, hospital, minutes }) }, or null without its keys. */
export function msg91({ authKey = config.MSG91_AUTH_KEY, templateId = config.MSG91_OTP_TEMPLATE_ID, fetchFn = fetch } = {}) {
  if (!authKey || !templateId) return null;
  return {
    name: 'msg91',
    async sendOtp({ to, otp, hospital, minutes }) {
      const mobiles = String(to).replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91'); // 91 + the 10 digits
      const res = await fetchFn(MSG91_FLOW_URL, {
        method: 'POST',
        headers: { authkey: authKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          short_url: '0',
          recipients: [{ mobiles, otp: String(otp), hospital: String(hospital).slice(0, DLT_VARIABLE), minutes: String(minutes) }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      // MSG91 can answer 200 with { type: 'error' } – both are refusals; its message is never logged (it may hold the number)
      if (!res.ok || data.type === 'error') throw new Error(`MSG91 refused the message (${res.status}${data.type ? `, ${data.type}` : ''})`);
      return { providerId: String(data.message ?? '') };
    },
  };
}

/**
 * Who sends sign-in OTPs: the test sender in tests, MSG91 when its keys are set, else the reminders' SMS sender (its
 * free text) – or null (practice mode on a development computer; no OTP sign-in on a live server).
 */
export function otpSender() {
  if (testSender) return { name: testSender.name, sendOtp: ({ to, otp, hospital, minutes }) => testSender.send({ channel: 'sms', to, text: otpText(otp, hospital, minutes) }) };
  const m = msg91();
  if (m) return m;
  const s = currentSender();
  if (s?.channels?.includes('sms')) return { name: s.name, sendOtp: ({ to, otp, hospital, minutes }) => s.send({ channel: 'sms', to, text: otpText(otp, hospital, minutes) }) };
  return null;
}
export const otpText = (otp, hospital, minutes) => `${otp} is your OTP to sign in to ${hospital}. It works for ${minutes} minutes. Do not share it.`;
