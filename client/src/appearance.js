// How the app looks for the logged-in person (My settings → Appearance): colour template, font, text size,
// spacing and animation. Saved to their account (the server has the same lists: server/src/utils/appearance.js,
// and a test checks they match). The look is set as data-* attributes on <html>; tokens.css and base.css do the
// rest. A copy is kept on this computer only so the next visit opens in the same look straight away; logging out
// goes back to the standard look.

export const THEMES = [
  { key: 'indigo', name: 'Perinexa Indigo' },
  { key: 'blue', name: 'Ocean blue' },
  { key: 'green', name: 'Forest green' },
  { key: 'plum', name: 'Plum' },
  { key: 'burgundy', name: 'Burgundy' },
  { key: 'slate', name: 'Slate grey' },
  { key: 'contrast', name: 'High contrast' },
];
export const FONTS = [
  { key: 'jost', name: 'Jost – the Perinexa font' },
  { key: 'mukta', name: 'Mukta – rounder, the same as the Hindi and Marathi text' },
  { key: 'system', name: "This computer's own font" },
];
export const TEXT_SIZES = [
  { key: 'small', name: 'Small' },
  { key: 'standard', name: 'Standard' },
  { key: 'large', name: 'Large' },
  { key: 'xlarge', name: 'Extra large' },
];
export const DENSITIES = [
  { key: 'comfortable', name: 'Comfortable' },
  { key: 'compact', name: 'Compact' },
];
export const MOTIONS = [
  { key: 'on', name: 'On' },
  { key: 'off', name: 'Off' },
];
// Explanations on the screens (how-to texts marked "help"). Safety notes, warnings and records are always shown.
export const HELP = [
  { key: 'hidden', name: 'Hidden' },
  { key: 'shown', name: 'Shown' },
];

export const APPEARANCE_CHOICES = {
  theme: THEMES.map((t) => t.key),
  font: FONTS.map((f) => f.key),
  textSize: TEXT_SIZES.map((t) => t.key),
  density: DENSITIES.map((d) => d.key),
  motion: MOTIONS.map((m) => m.key),
  help: HELP.map((h) => h.key),
};

/** The standard look – Perinexa as the brand guide draws it. */
export const STANDARD_APPEARANCE = { theme: 'indigo', font: 'jost', textSize: 'standard', density: 'comfortable', motion: 'on', help: 'hidden' };

/** Every setting present and known; anything missing or unknown is the standard one. */
export function normalizeAppearance(a) {
  return Object.fromEntries(Object.entries(STANDARD_APPEARANCE).map(([k, standard]) => [k, APPEARANCE_CHOICES[k].includes(a?.[k]) ? a[k] : standard]));
}

export const isStandard = (a) => Object.entries(STANDARD_APPEARANCE).every(([k, v]) => normalizeAppearance(a)[k] === v);

// The attribute for each setting on <html>; the standard value has none.
const ATTRIBUTES = { theme: 'data-theme', font: 'data-font', textSize: 'data-text-size', density: 'data-density', motion: 'data-motion', help: 'data-help' };

/** Shows a look: the data-* attributes on <html> (or `root`). */
export function applyAppearance(a, root = document.documentElement) {
  const look = normalizeAppearance(a);
  for (const [k, attr] of Object.entries(ATTRIBUTES)) {
    if (look[k] === STANDARD_APPEARANCE[k]) root.removeAttribute(attr);
    else root.setAttribute(attr, look[k]);
  }
}

// This computer's copy of the last person's look (so the page does not flash in the standard look first).
const KEY = 'perinexa:appearance';
export function rememberAppearance(a) {
  try {
    if (isStandard(a)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(normalizeAppearance(a)));
  } catch {
    /* storage unavailable: the look still comes from the account after login */
  }
}
export function forgetAppearance() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}
export function rememberedAppearance() {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return { ...STANDARD_APPEARANCE };
  }
}
