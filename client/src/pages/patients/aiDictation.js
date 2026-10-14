// AI dictation (Smart features): the microphone is recorded in the browser (MediaRecorder) and, when the person
// presses Stop, the recording is sent to Perinexa's server, which has OpenAI write it down (POST /ai/transcribe).
// Used only when the person presses "AI dictation" – the on-device voice entry stays the default. Nothing is kept.

import { api } from '../../api.js';

export const MAX_AI_SECONDS = 5 * 60; // longer recordings stop by themselves

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
export const recordingType = (MR = globalThis.MediaRecorder) => TYPES.find((t) => MR?.isTypeSupported?.(t)) ?? '';

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error("The recording couldn't be read."));
    r.readAsDataURL(blob);
  });

/**
 * Starts recording. Returns { stop(): Promise<Blob>, abort() }. deviceId: the chosen microphone ('' = default).
 * onAutoStop: called when the time limit stops it.
 */
export async function startAiRecording({ deviceId = '', onAutoStop } = {}) {
  if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Please use Google Chrome.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  const mimeType = recordingType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  const off = () => stream.getTracks().forEach((t) => t.stop());
  let finished;
  const done = new Promise((resolve) => {
    rec.onstop = () => {
      off();
      resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }));
    };
  });
  // Started only when the recorder says so (then "Listening" shows): nothing said before that is lost unnoticed
  const started = new Promise((resolve) => {
    rec.onstart = resolve;
    setTimeout(resolve, 2000);
  });
  rec.start(1000);
  await started;
  const timer = setTimeout(() => {
    if (rec.state !== 'inactive') {
      rec.stop();
      onAutoStop?.();
    }
  }, MAX_AI_SECONDS * 1000);
  return {
    stop: () => {
      clearTimeout(timer);
      if (!finished) {
        finished = true;
        if (rec.state !== 'inactive') rec.stop();
      }
      return done;
    },
    abort: () => {
      clearTimeout(timer);
      finished = true;
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      off();
    },
  };
}

/** Sends the recording to be written down; returns the text. */
export async function transcribeRecording(blob) {
  if (!blob.size) throw new Error('Nothing was recorded. Check the microphone and try again.');
  const data = await toBase64(blob);
  const res = await api('/ai/transcribe', { method: 'POST', body: { mediaType: blob.type || 'audio/webm', data } });
  return res.text;
}
