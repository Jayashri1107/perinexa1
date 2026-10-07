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
