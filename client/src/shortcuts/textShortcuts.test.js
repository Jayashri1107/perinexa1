import { describe, expect, it } from 'vitest';
import { expandShortcut } from './textShortcuts.js';

// Doctor ideas #3: typing shortcuts (16 Oct 2026).
const MAP = new Map([['fu2', 'Follow up after 2 weeks with CBC report'], ['ifa', 'Continue iron and folic acid']]);
const at = (value) => expandShortcut(value, value.length, MAP);

describe('typing shortcuts', () => {
  it('replaces .key and a space, keeping the space, and moves the caret after it', () => {
    expect(at('.fu2 ')).toEqual({ value: 'Follow up after 2 weeks with CBC report ', caret: 40 });
    expect(at('Advice: .ifa ').value).toBe('Advice: Continue iron and folic acid ');
    expect(at('Line one\n.FU2\n').value).toBe('Line one\nFollow up after 2 weeks with CBC report\n');
  });
  it('works in the middle of the text', () => {
    const v = 'A .ifa  rest';
    expect(expandShortcut(v, 7, MAP)).toEqual({ value: 'A Continue iron and folic acid  rest', caret: 31 });
  });
  it('leaves everything else alone', () => {
    expect(at('e.g.fu2 ')).toBeNull(); // not at the start of a word
    expect(at('.unknown ')).toBeNull();
    expect(at('.fu2')).toBeNull(); // no space yet
    expect(expandShortcut('.fu2 ', 5, new Map())).toBeNull();
  });
});
