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
