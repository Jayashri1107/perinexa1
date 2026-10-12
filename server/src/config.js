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
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
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

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  // Secure cookies are only sent over HTTPS. Always on in production.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
};
