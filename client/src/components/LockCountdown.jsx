import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Alert } from './ui.jsx';

// The wait after 3 wrong passwords (owner, 19 Oct 2026 – server/src/auth/loginLock.js): the sign-in answers 429 with the
// seconds left; the page shows them counting down and keeps the Sign in button off until the time is up.

/** "1:45" */
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * { seconds, catchLock(err) }: catchLock returns true (and starts the countdown) when err is the sign-in lock;
 * seconds counts down to 0.
 */
export function useLockCountdown() {
  const [until, setUntil] = useState(null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setSeconds(left);
      if (!left) setUntil(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);
  const catchLock = (err) => {
    if (err?.status !== 429 || !(err.retryAfterSeconds > 0)) return false;
    setUntil(Date.now() + err.retryAfterSeconds * 1000);
    setSeconds(err.retryAfterSeconds);
    return true;
  };
  return { seconds, catchLock };
}

const WORDS = {
  en: (t) => `Too many wrong tries. Please wait ${t} – then you can try again.`,
  mr: (t) => `खूप चुकीचे प्रयत्न झाले. कृपया ${t} थांबा – मग पुन्हा प्रयत्न करा.`, // DRAFT – to be checked by a fluent speaker
  hi: (t) => `बहुत ग़लत कोशिशें हुईं। कृपया ${t} रुकें – फिर से कोशिश करें।`, // DRAFT – to be checked by a fluent speaker
};

/** The notice while the sign-in waits: the time left, read out every 30 seconds to a screen reader (not every second). */
export function LockNotice({ seconds, lang = 'en' }) {
  if (!seconds) return null;
  const text = (WORDS[lang] ?? WORDS.en)(clock(seconds));
  return (
    <Alert type="warning" icon={Timer}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only" aria-live="polite">
        {(WORDS[lang] ?? WORDS.en)(clock(Math.ceil(seconds / 30) * 30))}
      </span>
    </Alert>
  );
}
