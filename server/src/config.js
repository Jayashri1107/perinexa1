// Loads settings from server/.env and checks they make sense before the app starts.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
dotenv.config({ path: ENV_FILE, quiet: true });

// The secret key that signs sign-in sessions is never written in the code: on the first start of a development copy
// (no JWT_SECRET yet) a long random one is made and kept in server/.env (never in git). In production it must be set.
if (!process.env.JWT_SECRET && (process.env.NODE_ENV ?? 'development') === 'development') {
  const secret = randomBytes(48).toString('base64url');
  try {
    const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
    writeFileSync(ENV_FILE, `${before}${before && !before.endsWith('\n') ? '\n' : ''}# Made automatically on the first start – keep it secret, never share or commit it.\nJWT_SECRET=${secret}\n`);
    console.log('ℹ️  A new secret key for sign-in sessions was made and saved in server/.env.');
  } catch {
    console.warn('⚠️  Could not save the new secret key in server/.env; sessions end when the server restarts.');
  }
  process.env.JWT_SECRET = secret;
}

// A time zone name the computer knows, e.g. "Asia/Kolkata".
const isValidTimeZone = (timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  // A hosted database's own CA certificate (the PEM text, e.g. DigitalOcean Managed MongoDB's CA_CERT): the connection
  // is then checked against it. Empty: no extra certificate (a local database, or one with a public certificate).
  MONGO_CA_CERT: z.string().default(''),
  // Behind a hosting service's load balancer (e.g. DigitalOcean App Platform): how many proxies to trust, so the
  // sign-in limits see each visitor's own address. 0 (default): the app is reached directly.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  // WRONG sign-in tries per 15 minutes from one internet address (right ones are not counted): a whole hospital often
  // shares one address. Each account also locks on its own after wrong tries (utils/loginLock.js).
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  // Requests a minute per signed-in person (per internet address before signing in).
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  // A request slower than this (milliseconds) is written to the server's log; 0 = off.
  SLOW_REQUEST_MS: z.coerce.number().int().min(0).default(1500),
  // The one-time code the sign-in page asks for when the first super admin is created. Required on the live server
  // (NODE_ENV=production), so nobody who finds the new address first can make themselves super admin.
  SETUP_CODE: z.string().trim().default(''),
  // Several copies of the server behind one address (scaling out): where the request limits are counted. 'database'
  // (the default on the live server): every copy counts the same requests. 'memory': this copy only (one server, tests).
  RATE_LIMIT_STORE: z.enum(['memory', 'database']).optional(),
  // More limits, per 15 minutes from one internet address unless said otherwise (wrong tries only where marked)
  PORTAL_SIGNIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20), // portal code + 4 digits, wrong tries
  VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60), // checking a printed document's QR
  ABDM_PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3000), // a minute: ABDM's gateway, other hospitals
  // Database connections each copy may open at once (MongoDB driver default 100); lower it on a small database plan.
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().max(500).default(50),
  // Risk levels: after the first refresh, a due refresh runs in the background and lists do not wait for it.
  // Default: on, except in tests (which check the result of each refresh straight away).
  RISK_REFRESH_IN_BACKGROUND: z.enum(['true', 'false']).optional(),
  // Seconds a person's worklist is kept for them (utils/worklistCache.js); 0 = never. Default 15, 0 in tests.
  WORKLIST_CACHE_SECONDS: z.coerce.number().int().min(0).max(120).optional(),
  // Outside services' addresses (only change for a test stand-in or a provider's regional address)
  TWILIO_API_URL: z.url().default('https://api.twilio.com/2010-04-01'),
  MSG91_FLOW_URL: z.url().default('https://control.msg91.com/api/v5/flow'),
  // OTPs one computer may ask for in 15 minutes on a hospital's portal page (sign-up and sign-in with ABHA).
  PORTAL_OTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(8),
  // The hospital's time zone: "today" for care plans and pregnancy weeks is the date there.
  HOSPITAL_TIME_ZONE: z.string().default('Asia/Kolkata').refine(isValidTimeZone, 'HOSPITAL_TIME_ZONE is not a known time zone'),
  // Smart features that use AI (OpenAI). Without a key the AI buttons explain that AI is not set up.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.5'), // reading reports
  OPENAI_MODEL_FAST: z.string().default('gpt-5.4-mini'), // everything else: summaries, letters, briefs, translations, questions, checks
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-transcribe'), // AI dictation (voice entry)
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  // How long a doctor's Analytics page is kept in memory (seconds; 0 = never kept). Lists are never kept.
  ANALYTICS_CACHE_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
  // How long the super admin's Analytics pages are kept in memory (seconds; 0 = never kept).
  ANALYTICS_PLATFORM_CACHE_SECONDS: z.coerce.number().int().min(0).max(900).default(300),
  // Automatic reminders by SMS or WhatsApp (Version 2). Empty = no provider: reminders wait in the outbox for
  // staff to send by hand. 'twilio' sends through Twilio (SMS and WhatsApp) with the keys below.
  REMINDER_PROVIDER: z.enum(['', 'twilio']).default(''),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(), // e.g. +1… or an approved sender id
  TWILIO_WHATSAPP_FROM: z.string().optional(), // e.g. whatsapp:+1…
  // Patients' sign-in OTPs by SMS through MSG91 (India; owner, 17 Oct 2026), with one DLT-approved template – used
  // for OTPs only (reminders are free text: the outbox or Twilio, above). Both empty = OTPs go by REMINDER_PROVIDER.
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  // The hour (hospital time, 0–23) from which the next day's appointment reminders are sent.
  REMINDER_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(10),
  // The hour (hospital time, 1–24) from which the two general messages ("a check-up or test is due", "we missed you")
  // no longer go out that day: they are not tied to a day, so one that became due in the evening waits for the next
  // morning's round. 19 = none from 19:00. Must be later than REMINDER_SEND_HOUR, or they would never go out.
  REMINDER_LAST_HOUR: z.coerce.number().int().min(1).max(24).default(19),
  // Sending a prescription to the patient on WhatsApp in one click (Meta's WhatsApp Business Platform, Cloud API).
  // Empty = off. 'practice' pretends to send (nothing leaves the computer). 'live' sends with the keys below, and
  // needs a message template approved by Meta (visits/whatsappSender.js). The PDF then goes through Meta's servers.
  WHATSAPP_MODE: z.enum(['', 'practice', 'live']).default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_TEMPLATE: z.string().default('perinexa_document'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  WHATSAPP_API_URL: z.url().default('https://graph.facebook.com/v21.0'),
  // WhatsApp at the desk (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md): the same Cloud API also sends sign-in OTPs
  // (an AUTHENTICATION template with a "Copy code" button: body {{1}} = the code) and the patient messages – booking,
  // move, cancellation, reminders, the queue time – through one UTILITY template whose body is
  // "Message from {{1}}: {{2}}" ({{1}} the hospital, {{2}} the message). WHATSAPP_NUMBER: the hospital's WhatsApp
  // number as patients know it (shown on the settings page only – the sending number is the phone number id above).
  WHATSAPP_OTP_TEMPLATE: z.string().default('perinexa_otp'),
  WHATSAPP_UPDATE_TEMPLATE: z.string().default('perinexa_update'),
  WHATSAPP_NUMBER: z.string().max(20).default(''),
  // ABDM linking (M1, docs/ABDM_PLAN.md). 'practice' (default): a built-in stand-in, no connection to ABDM.
  // 'sandbox' or 'production': ABDM's V3 APIs with the client ID and secret ABDM issues (never in the code).
  ABDM_MODE: z.enum(['practice', 'sandbox', 'production']).default('practice'),
  ABDM_CLIENT_ID: z.string().optional(),
  ABDM_CLIENT_SECRET: z.string().optional(),
  // M2 (sharing her records): Perinexa's public HTTPS address once it is on the internet, e.g.
  // https://perinexa.example.in – ABDM calls <this>/api/abdm/public/… (the "bridge URL"). Empty until then.
  ABDM_PUBLIC_URL: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v), 'ABDM_PUBLIC_URL must be an https:// address (or empty)'),
  // M2 and M3: the client ID in the tokens ABDM's gateway signs its own calls with (checked on every call from ABDM,
  // so another hospital's token is refused). "gateway" unless the sandbox shows otherwise (ABDM_CHECKLIST_M2).
  ABDM_GATEWAY_CLIENT_ID: z.string().trim().default('gateway'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n❌ Problem with server/.env settings:');
  for (const issue of parsed.error.issues) console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  console.error('   Copy server/.env.example to server/.env and fill it in.\n');
  process.exit(1);
}

const env = parsed.data;

// A secret that was typed or copied from an example rather than made at random (21 Oct 2026): a known word, or too
// few different characters (a random value of 48 bytes has about 40).
const MAKE_ONE = 'make one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
const looksTyped = (value) => /replace|example|change.?me|placeholder|secret|password|perinexa/i.test(value) || new Set(value).size < 16;

/** What would weaken sign-in on the live server – each a sentence for the person starting it. PURE. */
export function productionProblems(settings) {
  const unsafe = [];
  if (!settings.CLIENT_URL.startsWith('https://')) unsafe.push('CLIENT_URL must be the https:// address of the website');
  if (settings.COOKIE_SECURE === 'false') unsafe.push('COOKIE_SECURE=false sends the sign-in cookie without HTTPS – remove it');
  if (looksTyped(settings.JWT_SECRET)) unsafe.push(`JWT_SECRET looks typed or copied from an example – ${MAKE_ONE}`);
  if (settings.SETUP_CODE && (settings.SETUP_CODE.length < 20 || looksTyped(settings.SETUP_CODE))) unsafe.push(`SETUP_CODE is too easy to guess – ${MAKE_ONE}`);
  return unsafe;
}

// On the live server a setting that would weaken sign-in stops the start, so it is seen at once (docs/DEPLOY_AWS.md).
if (env.NODE_ENV === 'production') {
  const unsafe = productionProblems(env);
  if (unsafe.length) {
    console.error('\n❌ Unsafe settings for production:');
    for (const problem of unsafe) console.error(`   - ${problem}`);
    console.error('');
    process.exit(1);
  }
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  RATE_LIMIT_STORE: env.RATE_LIMIT_STORE ?? (env.NODE_ENV === 'production' ? 'database' : 'memory'),
  WORKLIST_CACHE_SECONDS: env.WORKLIST_CACHE_SECONDS ?? (env.NODE_ENV === 'test' ? 0 : 15),
  RISK_REFRESH_IN_BACKGROUND: env.RISK_REFRESH_IN_BACKGROUND ? env.RISK_REFRESH_IN_BACKGROUND === 'true' : env.NODE_ENV !== 'test',
  // Secure cookies are only sent over HTTPS. Always on in production.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
};
