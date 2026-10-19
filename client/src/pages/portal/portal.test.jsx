// The patient portal in English, Marathi or Hindi (5 Oct 2026): its words, the language it opens in, refusals in her
// language, and her care plan with the built-in items translated (rendered to HTML, no browser). Fake data only.
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeSlipDocument } from '../patients/PatientMessagesDialog.jsx';
import { Booking, MyCare, PortalScreen, signInState, signedInState } from './PortalPage.jsx';
import {
  PORTAL_LANGUAGES,
  PORTAL_LANGUAGE_NAMES,
  PORTAL_SLIP_WORDS,
  PORTAL_WORDS,
  isTypedText,
  portalError,
  portalItemText,
  portalLanguage,
  portalWords,
  rememberPortalLanguage,
  rememberedPortalLanguage,
} from './portalWords.js';
import { PORTAL_ACCOUNT_WORDS } from './portalAccountWords.js';

const DEVANAGARI = /[ऀ-ॿ]/;
const text = (markup) => markup.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('the words of the portal', () => {
  it('has every word in English, Marathi and Hindi, the same kind of value in each', () => {
    expect(PORTAL_LANGUAGES).toEqual(['en', 'mr', 'hi']);
    expect(PORTAL_LANGUAGE_NAMES).toEqual({ en: 'English', mr: 'मराठी', hi: 'हिंदी' });
    for (const table of [PORTAL_WORDS, PORTAL_SLIP_WORDS, PORTAL_ACCOUNT_WORDS]) {
      const keys = Object.keys(table.en).sort();
      for (const lang of ['mr', 'hi']) {
        expect(Object.keys(table[lang]).sort(), lang).toEqual(keys);
        for (const key of keys) {
          const en = table.en[key];
          const other = table[lang][key];
          expect(typeof other, `${lang}.${key}`).toBe(typeof en);
          if (typeof en === 'function') expect(other('Sample'), `${lang}.${key}`).toContain('Sample');
          if (typeof other === 'string' && en !== '' && !['.', ' on '].includes(en)) {
            // the punctuation and the joins may differ; every sentence is in Devanagari
            if (/[A-Za-z]{3}/.test(en) && key !== 'pageTitle' && key !== 'codeHint') expect(other, `${lang}.${key}`).toMatch(DEVANAGARI);
          }
        }
        // Word lists (kinds of care-plan items; tabs, flags and bill words of her records): the same entries
        for (const key of keys.filter((k) => table.en[k] && typeof table.en[k] === 'object' && !Array.isArray(table.en[k]))) {
          expect(Object.keys(table[lang][key]).sort(), `${lang}.${key}`).toEqual(Object.keys(table.en[key]).sort());
          for (const [k, v] of Object.entries(table[lang][key])) {
            const en = table.en[key][k];
            expect(typeof v, `${lang}.${key}.${k}`).toBe(typeof en);
            // (a group inside a group – the Aadhaar words' field names, 17 Oct 2026 – the same entries, in Devanagari)
            if (typeof v === 'function') expect(v('Sample'), `${lang}.${key}.${k}`).toMatch(DEVANAGARI);
            else if (typeof v === 'object') for (const x of Object.values(v)) expect(x, `${lang}.${key}.${k}`).toMatch(DEVANAGARI);
            else if (/[A-Za-z]{3}/.test(en) && v !== 'UPI') expect(v, `${lang}.${key}.${k}`).toMatch(DEVANAGARI);
          }
        }
      }
    }
    // The draft note shows only in Marathi and Hindi
    expect(PORTAL_WORDS.en.draftNote).toBe('');
    expect(PORTAL_WORDS.mr.draftNote).toMatch(DEVANAGARI);
    expect(PORTAL_WORDS.hi.draftNote).toMatch(DEVANAGARI);
    expect(portalWords('gu')).toBe(PORTAL_WORDS.en);
  });

  it('opens in the language chosen on this phone, else the language recorded for her messages, else English', () => {
    expect(portalLanguage('hi', 'mr')).toBe('hi');
    expect(portalLanguage(null, 'mr')).toBe('mr');
    expect(portalLanguage(null, null)).toBe('en');
    expect(portalLanguage(null, 'gu')).toBe('en');
    // Without browser storage (a private window, a test): nothing remembered, and nothing breaks
    expect(rememberedPortalLanguage()).toBeNull();
    expect(() => rememberPortalLanguage('mr')).not.toThrow();
  });

  it('says a refusal in her language: by its code in Marathi and Hindi, the server’s own sentence in English', () => {
    const failed = { message: 'The code or the 4 digits are not right.', code: 'PORTAL_LOGIN_FAILED' };
    expect(portalError(failed, 'en')).toBe('The code or the 4 digits are not right.');
    expect(portalError(failed, 'mr')).toMatch(/^कोड किंवा 4 अंक बरोबर नाहीत/);
    expect(portalError({ message: "Can't reach", code: 'NETWORK' }, 'hi')).toMatch(/^अस्पताल के सर्वर से संपर्क/);
    // A day outside the booking days (VALIDATION) in a booking; any other refusal: a general sentence, never English
    expect(portalError({ message: 'Please choose a day', code: 'VALIDATION' }, 'mr', { booking: true })).toMatch(/उद्यापासून पुढील 30 दिवसांतील/);
    expect(portalError({ message: 'Please check the highlighted fields.', code: 'VALIDATION' }, 'hi')).toMatch(/कुछ ग़लत हो गया/);
    expect(portalError({ message: 'Something new', code: 'SOMETHING_NEW' }, 'mr')).toMatch(/काहीतरी चुकले/);
    for (const code of ['PORTAL_LOCKED', 'RATE_LIMITED', 'PORTAL_SIGNED_OUT', 'SLOT_TAKEN', 'BOOKING_OFF', 'ALREADY_BOOKED', 'NOT_CANCELLABLE']) {
      for (const lang of ['mr', 'hi']) {
        expect(portalError({ message: 'x', code }, lang), `${code}.${lang}`).toMatch(DEVANAGARI);
        expect(portalError({ message: 'x', code }, lang)).not.toBe(portalError({ message: 'x', code: 'SOMETHING_NEW' }, lang));
      }
    }
  });

  it('shows a built-in care-plan item in her language; an item a doctor added or reworded as typed, marked as English', () => {
    const builtIn = { builtIn: true, text: 'Thyroid blood test' };
    expect(portalItemText(builtIn, 'mr')).toBe('थायरॉईडची रक्त तपासणी');
    expect(portalItemText(builtIn, 'en')).toBe('Thyroid blood test');
    expect(isTypedText(builtIn, 'hi')).toBe(false);
    for (const typed of [{ builtIn: false, text: 'Thyroid blood test' }, { builtIn: true, text: 'Thyroid blood test (fasting)' }, { text: 'Thyroid blood test' }]) {
      expect(portalItemText(typed, 'hi')).toBe(typed.text);
      expect(isTypedText(typed, 'hi')).toBe(true);
      expect(isTypedText(typed, 'en')).toBe(false);
    }
  });
});

describe('what she sees once signed in', () => {
  const data = {
    hospital: { name: 'Sample Hospital', phone: '020 0000 0000' },
    patient: { fullName: 'Sample Mother' },
    language: 'mr',
    appointment: '2026-10-09T00:00:00.000Z',
    appointmentTime: '10:30',
    plan: {
      nextVisit: { builtIn: true, text: 'Check-up at about 20 weeks', from: '2026-10-12T00:00:00.000Z', by: '2026-10-26T00:00:00.000Z' },
      items: [
        { kind: 'scan', builtIn: true, text: 'Detailed ultrasound of baby (18–20 weeks)', from: '2026-10-19T00:00:00.000Z', by: '2026-10-26T00:00:00.000Z' },
        { kind: 'investigation', builtIn: false, text: 'Sample test added by the doctor', from: '2026-10-12T00:00:00.000Z', by: null },
      ],
    },
  };
  const html = (lang) => renderToStaticMarkup(<MemoryRouter><MyCare data={data} booking={null} onChanged={() => {}} onSignOut={() => {}} lang={lang} /></MemoryRouter>);

  it('in Marathi: the portal’s words and the built-in items; dates and times as usual; an added item as typed, marked as English', () => {
    const out = html('mr');
    const words = text(out);
    for (const w of ['बाहेर पडा', 'तुमची पुढील भेट', 'तुमच्या काळजीच्या योजनेत पुढे', 'सुमारे 20 आठवड्यांची तपासणी', 'बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे)', 'Sample Hospital ला फोन करा', 'आणीबाणीच्या वेळी'])
      expect(words).toContain(w);
    expect(words).toContain('9 Oct 2026, 10:30 AM');
    expect(words).toContain('12 Oct 2026 – 26 Oct 2026');
    expect(out).toContain('<span lang="en">Sample test added by the doctor</span>');
    expect(words).not.toMatch(/Your next appointment|Coming up|Sign out/);
  });

  it('in English: as before', () => {
    const words = text(html('en'));
    for (const w of ['Sign out', 'Your next appointment', 'Coming up in your care plan', 'Check-up: Check-up at about 20 weeks', 'Scan: Detailed ultrasound of baby (18–20 weeks)', 'Call Sample Hospital on 020 0000 0000.'])
      expect(words).toContain(w);
    // (the language switch in her top bar names each language in its own script)
    expect(words.replace(PORTAL_LANGUAGE_NAMES.mr, '').replace(PORTAL_LANGUAGE_NAMES.hi, '')).not.toMatch(DEVANAGARI);
  });
});

describe('after she signs out or is timed out', () => {
  const data = { hospital: { name: 'Sample Hospital', phone: '' }, patient: { fullName: 'Sample Mother' }, language: 'mr', appointment: null, plan: null };
  const screen = (state, notice, chosen = null) =>
    renderToStaticMarkup(<MemoryRouter><PortalScreen state={state} notice={notice} chosen={chosen} onChoose={() => {}} onDismiss={() => {}} onSignedIn={() => {}} onChanged={() => {}} onSignOut={() => {}} /></MemoryRouter>);

  it('keeps the language recorded for her messages: the notice and the sign-in page stay in Marathi or Hindi', () => {
    const before = signedInState(data, null);
    expect(text(screen(before, null))).toContain('बाहेर पडा');
    const after = signInState(before);
    expect(after).toEqual({ step: 'signin', recorded: 'mr' });
    expect(after).not.toHaveProperty('data'); // nothing of her record is kept
    for (const notice of ['signedOut', 'timedOut']) {
      const out = screen(after, notice);
      expect(out).toContain('<main class="portal-page" lang="mr">');
      expect(text(out)).toContain(PORTAL_WORDS.mr[notice]);
      expect(text(out)).toContain(PORTAL_WORDS.mr.signInTitle);
      expect(text(out)).not.toContain(PORTAL_WORDS.en[notice]);
    }
    // A session that ended on the server (sign in again), and a refusal: the same
    const hi = signedInState({ ...data, language: 'hi' }, null);
    expect(signInState(hi).recorded).toBe('hi');
    expect(signInState(hi, { code: 'NETWORK', message: 'x' })).toMatchObject({ step: 'signin', recorded: 'hi', error: { code: 'NETWORK' } });
    expect(text(screen(signInState(hi), 'timedOut'))).toContain(PORTAL_WORDS.hi.timedOut);
  });

  it('a language chosen on the phone still comes first; someone else signing in gets her own language', () => {
    const after = signInState(signedInState(data, null));
    expect(text(screen(after, 'signedOut', 'en'))).toContain(PORTAL_WORDS.en.signedOut);
    const next = signedInState({ ...data, language: null }, null);
    expect(next.recorded).toBeNull();
    expect(text(screen(signInState(next), 'signedOut'))).toContain(PORTAL_WORDS.en.signedOut);
    // Opening the page: English until /me answers
    expect(text(screen({ step: 'loading', recorded: null }, null))).toContain(PORTAL_WORDS.en.loading);
  });
});

describe('the paper with her portal code', () => {
  const slip = (lang) =>
    renderToStaticMarkup(<CodeSlipDocument patient={{ fullName: 'Sample Mother' }} code="ABCD-EFGH-JKLM" letterhead={{ name: 'Sample Hospital' }} address="https://sample.example/portal" lang={lang} />);

  it('prints in English, or with Hindi or Marathi under the English; the code, address and names as they are', () => {
    const en = text(slip('en'));
    expect(en).toContain('Your care at Sample Hospital – online');
    expect(en).toContain('Open https://sample.example/portal and sign in with:');
    expect(en).not.toMatch(DEVANAGARI);
    const hi = slip('hi');
    expect(text(hi)).toContain('Sample Hospital में आपकी देखभाल – ऑनलाइन');
    expect(text(hi)).toContain('https://sample.example/portal खोलें और इससे अंदर आएँ:');
    expect(text(hi)).toContain('For / नाम: Sample Mother');
    expect(text(hi)).toContain('ABCD-EFGH-JKLM');
    expect(hi).not.toContain('lang="mr"');
    expect(text(slip('mr'))).toContain('हा कागद सांभाळून ठेवा.');
  });
});

describe('booking online (16 Oct 2026)', () => {
  const booking = {
    enabled: true,
    upcoming: null,
    from: '2026-10-02',
    to: '2026-10-31',
    doctorId: 'a1',
    doctors: [
      { id: 'a1', name: 'Dr Sample A', leave: [] },
      { id: 'b2', name: 'Dr Sample B', leave: [{ from: '2026-10-07', to: '2026-10-07' }] },
    ],
  };
  it('she chooses the doctor (her own first, chosen), then a day; only free times are offered', () => {
    const out = renderToStaticMarkup(<Booking booking={booking} onChanged={() => {}} lang="en" />);
    const words = text(out);
    expect(words).toContain('Book an appointment with Dr Sample A');
    expect(words).toContain('Doctor');
    expect(out).toMatch(/aria-pressed="true"[^>]*>Dr Sample A</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Dr Sample B</);
    expect(words).not.toContain('on leave'); // Dr A has no leave
  });
  it('one doctor only: no chooser; an older answer without the list still works', () => {
    const words = text(renderToStaticMarkup(<Booking booking={{ ...booking, doctors: undefined, doctorName: 'Dr Sample A', leave: [] }} onChanged={() => {}} lang="mr" />));
    expect(words).toContain('Dr Sample A यांची भेट ठरवा');
    expect(words).not.toContain('डॉक्टर');
  });
});

describe('her Home page at a glance (17 Oct 2026)', () => {
  const summary = { appointment: null, prescriptions: 2, visits: 3, lab: 1, bills: 1, toPayPaise: 30000 };
  it('the next step is one clear button; four cards with her real counts; a Call button and the emergency line', () => {
    const data = { hospital: { name: 'Sample Hospital', phone: '020 0000 0000' }, patient: { fullName: 'Sample Mother' }, appointment: null, plan: null };
    const out = renderToStaticMarkup(<MemoryRouter><MyCare data={data} booking={{ enabled: true, upcoming: null, doctors: [{ id: 'a1', name: 'Dr Sample A', leave: [] }] }} summary={summary} onChanged={() => {}} onSignOut={() => {}} lang="en" /></MemoryRouter>);
    const words = text(out);
    expect(out.match(/btn btn-primary/g)).toHaveLength(1);
    for (const w of ['Book an appointment', 'Your health at a glance', 'Prescriptions', 'Medicines prescribed to you', 'Lab reports', '₹300 to pay', 'None booked', 'Call the hospital', 'In an emergency', 'My profile']) expect(words).toContain(w);
    expect(out).toContain('href="tel:02000000000"');
  });
  it('in Marathi', () => {
    const data = { hospital: { name: 'Sample Hospital', phone: '' }, patient: { fullName: 'Sample Mother' }, appointment: null, plan: null };
    const words = text(renderToStaticMarkup(<MemoryRouter><MyCare data={data} booking={{ enabled: true, doctors: [{ id: 'a1', name: 'Dr Sample A', leave: [] }] }} summary={{ ...summary, toPayPaise: 0 }} onChanged={() => {}} onSignOut={() => {}} lang="mr" /></MemoryRouter>));
    for (const w of ['तुमचे आरोग्य एका नजरेत', 'भेट ठरवा', 'काही भरायचे बाकी नाही']) expect(words).toContain(w);
  });
});
