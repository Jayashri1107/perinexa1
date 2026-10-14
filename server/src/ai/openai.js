// The AI service (Smart features 4–9): OpenAI's Chat Completions API, called with fetch (no extra package).
//
// Rules for every AI feature:
//  - Only what the feature needs is sent – never the patient's name, phone, address or patient number
//    (see ai/context.js). The request asks OpenAI not to store it (store: false).
//  - The answer is a suggestion: nothing the AI writes is saved to a record until a person checks it.
//  - Every use is recorded in the audit log (feature, model, token counts – never the text).
//  - Without OPENAI_API_KEY the features say that AI is not set up (503).

import { config } from '../config.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';

const TIMEOUT_MS = 90_000;

// Read when used (not at start-up), so the key can be added to server/.env and tests can set their own.
const settings = () => ({
  key: (process.env.OPENAI_API_KEY ?? config.OPENAI_API_KEY ?? '').trim(),
  model: process.env.OPENAI_MODEL || config.OPENAI_MODEL,
  fastModel: process.env.OPENAI_MODEL_FAST || config.OPENAI_MODEL_FAST,
  baseUrl: (process.env.OPENAI_BASE_URL || config.OPENAI_BASE_URL).replace(/\/+$/, ''),
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || config.OPENAI_TRANSCRIBE_MODEL,
});

// Tests may only ever use a fake key (a real one would spend real money and send test data out).
const usable = (key) => Boolean(key) && (process.env.NODE_ENV !== 'test' || key.startsWith('sk-test'));
export const aiEnabled = () => usable(settings().key);

export class AiUnavailable extends HttpError {
  constructor(message = 'AI is not set up for this hospital yet. The administrator adds the OpenAI key to server/.env.') {
    super(503, message, 'AI_NOT_SET_UP');
  }
}

/**
 * Asks the AI for an answer in a fixed JSON shape.
 *  req: the request (for the audit log); feature: its short name ("visit_summary"); ids: { patientId, mrn }.
 *  instructions: what the AI must do (the "developer" message); content: text, or content parts (text / image).
 *  schema: JSON schema of the answer (strict: every property required, no others).
 *  fast: use the faster, cheaper model.
 * Returns the parsed answer. Throws 503 (not set up), 502 (the service failed) or 422 (it declined).
 */
export async function askAI(req, { feature, ids = {}, instructions, content, schema, fast = false, maxTokens = 4000 }) {
  const s = settings();
  if (!usable(s.key)) throw new AiUnavailable();
  const model = fast ? s.fastModel : s.model;
  const body = {
    model,
    store: false,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'developer', content: instructions },
      { role: 'user', content },
    ],
    response_format: { type: 'json_schema', json_schema: { name: feature, schema, strict: true } },
  };

  let res;
  try {
    res = await globalThis.fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('AI request failed', err?.name ?? err);
    throw new HttpError(502, "The AI service couldn't be reached. Please try again in a minute.", 'AI_FAILED');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Never pass on the service's own message: it could quote what was sent.
    console.error('AI service answered', res.status, data?.error?.code ?? data?.error?.type ?? '');
    const message =
      res.status === 401
        ? 'The OpenAI key in server/.env was not accepted. The administrator should check it.'
        : res.status === 429
          ? 'The AI service is busy or the account has no credit left. Please try again later.'
          : 'The AI service had a problem. Please try again in a minute.';
    throw new HttpError(502, message, 'AI_FAILED');
  }
  const choice = data?.choices?.[0];
  const usage = data?.usage ?? {};
  await audit(req, 'AI_USED', {
    details: { feature, ...ids, model: data?.model ?? model, inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null },
  });
  if (choice?.message?.refusal) throw new HttpError(422, 'The AI declined to answer this. Please write it yourself.', 'AI_DECLINED');
  if (choice?.finish_reason === 'length') throw new HttpError(502, 'The AI answer was too long and was cut off. Please try again.', 'AI_FAILED');
  try {
    return JSON.parse(choice?.message?.content ?? '');
  } catch {
    throw new HttpError(502, 'The AI answer could not be read. Please try again.', 'AI_FAILED');
  }
}

// Words an obstetrician in India says while dictating: helps the transcription spell them right.
const DICTATION_PROMPT = [
  'Dictation by an obstetrician in India, in Indian English (a few Hindi or Marathi words may occur – write them in English letters).',
  'Write numbers as digits and dates like 18/05/2026. Common terms: LMP, EDD, G2 P1 L1 A0, gravida, para, primi, LSCS, caesarean,',
  'PIH, GDM, OGTT, DIPSI, Hb, TSH, HBsAg, VDRL, HIV, USG, NT scan, anomaly scan, TIFFA, AFI, FHR, cephalic, breech, oedema,',
  'fundal height, P/A soft, IFA, Td injection, Rh negative, blood group O positive, BP 120/80, pulse, SpO2, per vaginal, PCOS, PCOD.',
].join(' ');

/**
 * Speech to text for voice entry (only when the person chooses AI dictation): the recording goes to OpenAI's
 * transcription (not stored there), the text comes back to the form. audio: Buffer; mediaType: e.g. audio/webm.
 */
export async function transcribe(req, { audio, mediaType, feature = 'dictation' }) {
  const s = settings();
  if (!usable(s.key)) throw new AiUnavailable();
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[mediaType] ?? 'webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mediaType }), `dictation.${ext}`);
  form.append('model', s.transcribeModel);
  form.append('language', 'en');
  form.append('prompt', DICTATION_PROMPT);
  form.append('response_format', 'json');
  let res;
  try {
    res = await globalThis.fetch(`${s.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('AI transcription failed', err?.name ?? err);
    throw new HttpError(502, "The AI service couldn't be reached. Please try again, or use Record on this computer instead.", 'AI_FAILED');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('AI transcription answered', res.status, data?.error?.code ?? data?.error?.type ?? '');
    const message =
      res.status === 401
        ? 'The OpenAI key in server/.env was not accepted. The administrator should check it.'
        : res.status === 429
          ? 'The AI service is busy or the account has no credit left. Please try again later.'
          : 'The AI service could not write down the recording. Please try again.';
    throw new HttpError(502, message, 'AI_FAILED');
  }
  await audit(req, 'AI_USED', { details: { feature, model: s.transcribeModel, inputTokens: data?.usage?.input_tokens ?? null, outputTokens: data?.usage?.output_tokens ?? null } });
  return String(data?.text ?? '').trim();
}

/** A JSON schema object with every property required and no others (what strict mode needs). */
export const strictObject = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
