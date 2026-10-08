// Speech to text ON THIS COMPUTER only (Google Chrome's on-device speech recognition, as in Perinexa's
// voiceSession.js). PRIVACY: the microphone is used only when Chrome confirms the speech is processed locally
// (processLocally); it never falls back to webkitSpeechRecognition, which may send the audio online. Nothing said is
// saved or sent anywhere – the text stays on the page.

const LANGS = ['en-IN', 'en-US', 'en-GB'];
const Recognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition ?? null);

// 'unsupported' (not a Chrome with on-device speech) | 'ready' | 'needs-setup' | 'setting-up' | 'unavailable'
export async function speechStatus() {
  const R = Recognition();
  if (!R || !('processLocally' in R.prototype) || typeof R.available !== 'function') return { status: 'unsupported' };
  for (const lang of LANGS) {
    let status;
    try {
      status = await R.available({ langs: [lang], processLocally: true });
    } catch {
      status = 'unavailable';
    }
    if (status === 'available') return { status: 'ready', lang };
    if (status === 'downloadable') return { status: 'needs-setup', lang };
    if (status === 'downloading') return { status: 'setting-up', lang };
  }
  return { status: 'unavailable' };
}

// Downloads Chrome's speech model for this language (once per computer).
export async function setUpSpeech(lang) {
  const R = Recognition();
  return R.install({ langs: [lang], processLocally: true });
}

// Starts listening; onText(finalText, interimText) as words come. Returns stop().
export function listen(lang, { onText, onEnd, onError }) {
  const R = Recognition();
  const rec = new R();
  rec.processLocally = true;
  // the privacy check, on this very recogniser: refuse to start if it is not local
  if (rec.processLocally !== true) {
    onError?.('This browser cannot promise that speech stays on this computer, so the microphone stays off.');
    return () => {};
  }
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
      else interim += e.results[i][0].transcript;
    }
    onText(finalText.trim(), interim);
  };
  rec.onerror = (e) => onError?.(e.error === 'not-allowed' ? 'The microphone is blocked for this site. Allow it in the browser and try again.' : `Speech stopped (${e.error}).`);
  rec.onend = () => onEnd?.();
  rec.start();
  return () => rec.stop();
}

// Listens for ONE answer (it stops by itself after a pause); onText(finalText, interimText) as words come,
// onDone(finalText) at the end. Returns stop(). The same privacy check as listen().
export function listenOnce(lang, { onText, onDone, onError }) {
  const R = Recognition();
  const rec = new R();
  rec.processLocally = true;
  if (rec.processLocally !== true) {
    onError?.('This browser cannot promise that speech stays on this computer, so the microphone stays off.');
    return () => {};
  }
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  let finalText = '';
  let failed = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
      else interim += e.results[i][0].transcript;
    }
    onText?.(finalText.trim(), interim);
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // nothing heard: onDone('') follows
    failed = true;
    onError?.(e.error === 'not-allowed' ? 'The microphone is blocked for this site. Allow it in the browser and try again.' : `Speech stopped (${e.error}).`);
  };
  rec.onend = () => !failed && onDone?.(finalText.trim());
  rec.start();
  return () => rec.abort();
}

// Says a question aloud with the computer's own voice (an Indian English one when there is one). Only the question
// is spoken – never anything the patient said. Resolves when it has been said (or at once without a voice).
export function speak(text) {
  const synth = typeof window === 'undefined' ? null : window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices().filter((v) => v.localService);
    u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang?.startsWith('en')) ?? null;
    u.lang = u.voice?.lang ?? 'en-IN';
    u.rate = 0.95;
    const done = () => resolve();
    u.onend = done;
    u.onerror = done;
    setTimeout(done, 9000); // never wait for ever
    synth.speak(u);
  });
}

export const stopSpeaking = () => (typeof window !== 'undefined' ? window.speechSynthesis?.cancel() : undefined);
