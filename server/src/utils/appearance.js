// How the app looks for one person (My settings → Appearance): a colour template, the font, the text size, the
// spacing and whether things move. Saved to their account, so it follows them to every computer. The website has
// the same lists (client/src/appearance.js); a test checks they match.

export const APPEARANCE_CHOICES = {
  theme: ['indigo', 'blue', 'green', 'plum', 'burgundy', 'slate', 'contrast'],
  font: ['jost', 'mukta', 'system'],
  textSize: ['small', 'standard', 'large', 'xlarge'],
  density: ['comfortable', 'compact'],
  motion: ['on', 'off'],
  help: ['hidden', 'shown'], // explanations on the screens (safety notes and records are always shown)
};

/** The standard look – Perinexa as the brand guide draws it. */
export const STANDARD_APPEARANCE = { theme: 'indigo', font: 'jost', textSize: 'standard', density: 'comfortable', motion: 'on', help: 'hidden' };
