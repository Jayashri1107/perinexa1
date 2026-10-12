// The Marathi and Hindi wording of what the patient reads (5 Oct 2026) is a DRAFT: every file that holds it says so
// in its header, and every Marathi or Hindi string in those files is listed for fluent speakers to check in
// docs/TRANSLATIONS_TO_CHECK.md. This test fails when a string is added or changed without updating that list.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'pages/careplans/itemTranslations.js',
  'pages/patients/carePlanPrintFormat.js',
  'components/print/printLanguage.js',
  'pages/inpatient/dischargeWords.js',
  'pages/portal/portalWords.js',
];
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DOC = read('../../docs/TRANSLATIONS_TO_CHECK.md');
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Every string in a JavaScript file (comments skipped): quoted strings, and the fixed pieces of template strings
 * (between their ${…}, which are read as code, nested strings included). Enough for these word files (no regular
 * expressions in them).
 */
export function stringsOf(src) {
  const out = [];
  let i = 0;
  const quoted = (q) => {
    let s = '';
    i += 1;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        s += src[i + 1];
        i += 2;
      } else s += src[(i += 1) - 1];
    }
    i += 1;
    out.push(s);
  };
  const template = () => {
    let piece = '';
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') {
        piece += src[i + 1];
        i += 2;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        out.push(piece);
        piece = '';
        i += 2;
        code(true);
      } else piece += src[(i += 1) - 1];
    }
    out.push(piece);
    i += 1;
  };
  const code = (inTemplate) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
      else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i + 2) + 2;
      else if (c === "'" || c === '"') quoted(c);
      else if (c === '`') template();
      else {
        if (c === '{') depth += 1;
        if (c === '}') {
          if (inTemplate && depth === 0) {
            i += 1;
            return;
          }
          depth -= 1;
        }
        i += 1;
      }
    }
  };
  code(false);
  return out;
}

describe('the Marathi and Hindi wording to be checked by fluent speakers', () => {
  it('reads strings, not comments, and the fixed pieces of template strings', () => {
    const src = "// 'not this'\nconst a = 'one'; /* \"nor this\" */ const b = `two ${x ? `three ${y}` : 'four'} five`; const c = { d: \"six\" };";
    expect(stringsOf(src).filter(Boolean)).toEqual(['one', 'two ', 'three ', 'four', ' five', 'six']);
  });

  it('is marked as a draft in the header of every file that holds it', () => {
    for (const file of FILES) {
      // the first lines, as one text (a sentence may run over two comment lines)
      const header = read(file)
        .split('\n')
        .slice(0, 15)
        .map((l) => l.replace(/^\s*(\/\/|\/?\*+\/?)\s?/, ''))
        .join(' ');
      expect(header, file).toMatch(/DRAFT/);
      expect(header, file).toMatch(/fluent speakers/);
      expect(header, file).toContain('docs/TRANSLATIONS_TO_CHECK.md');
    }
    expect(DOC).toMatch(/^# Marathi and Hindi wording to check/);
    expect(DOC).toContain('**DRAFT.**');
  });

  it('lists every Marathi and Hindi string of those files in docs/TRANSLATIONS_TO_CHECK.md', () => {
    let count = 0;
    for (const file of FILES) {
      const strings = stringsOf(read(file))
        .filter((s) => DEVANAGARI.test(s))
        .map((s) => s.trim());
      count += strings.length;
      const missing = strings.filter((s) => !DOC.includes(s));
      expect(missing, `${file}: add these to docs/TRANSLATIONS_TO_CHECK.md`).toEqual([]);
    }
    expect(count).toBeGreaterThan(300);
  });
});
