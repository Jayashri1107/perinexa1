// My settings → Appearance: the look as data-* attributes on <html> (fake root element, no browser needed).
import { describe, expect, it } from 'vitest';
import { STANDARD_APPEARANCE, THEMES, applyAppearance, isStandard, normalizeAppearance, rememberedAppearance } from './appearance.js';

const fakeRoot = () => {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => (attrs[k] = v), removeAttribute: (k) => delete attrs[k] };
};

describe('a look', () => {
  it('fills in anything missing or unknown with the standard choice', () => {
    expect(normalizeAppearance(null)).toEqual(STANDARD_APPEARANCE);
    expect(normalizeAppearance({ theme: 'plum', font: 'comic', textSize: 'large' })).toEqual({ ...STANDARD_APPEARANCE, theme: 'plum', textSize: 'large' });
    expect(isStandard({})).toBe(true);
    expect(isStandard({ motion: 'off' })).toBe(false);
  });

  it('sets an attribute on <html> only for what differs from the standard look', () => {
    const root = fakeRoot();
    applyAppearance({ theme: 'contrast', font: 'system', textSize: 'xlarge', density: 'compact', motion: 'off' }, root);
    expect(root.attrs).toEqual({ 'data-theme': 'contrast', 'data-font': 'system', 'data-text-size': 'xlarge', 'data-density': 'compact', 'data-motion': 'off' });
    applyAppearance({ ...STANDARD_APPEARANCE, textSize: 'large' }, root);
    expect(root.attrs).toEqual({ 'data-text-size': 'large' });
    applyAppearance(STANDARD_APPEARANCE, root);
    expect(root.attrs).toEqual({});
  });

  it('opens in the standard look when nothing is kept on this computer', () => {
    expect(rememberedAppearance()).toEqual(STANDARD_APPEARANCE); // no localStorage here
  });

  it('has a named colour template for each choice, Perinexa Indigo first', () => {
    expect(THEMES[0]).toEqual({ key: 'indigo', name: 'Perinexa Indigo' });
    expect(new Set(THEMES.map((t) => t.key)).size).toBe(THEMES.length);
  });
});
