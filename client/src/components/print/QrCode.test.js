import { describe, expect, it } from 'vitest';
import { scalable } from './QrCode.jsx';

describe('QR code SVG scaling', () => {
  it('adds a viewBox the size of the drawing, so the code fills its box', () => {
    const svg = '<?xml version="1.0"?>\n<svg width="45" height="45" version="1.1" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="7" height="1"/></svg>';
    const out = scalable(svg);
    expect(out).toContain('<svg viewBox="0 0 45 45" width="45" height="45"');
    expect(out).toContain('<rect x="0" y="0" width="7" height="1"/>');
  });
  it('leaves an SVG that already has a viewBox, or has no size, as it is', () => {
    const withBox = '<svg viewBox="0 0 10 10" width="10" height="10"></svg>';
    expect(scalable(withBox)).toBe(withBox);
    const noSize = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(scalable(noSize)).toBe(noSize);
  });
});
