// Leaving a page with unsaved changes: which clicks would leave the page (and so ask first).
import { describe, expect, it } from 'vitest';
import { leavesPage } from './useUnsavedWarning.js';

const here = { href: 'http://localhost:5174/patients/1/edit', origin: 'http://localhost:5174', pathname: '/patients/1/edit', search: '' };
const click = (href, extra = {}) => {
  const a = { getAttribute: () => href, target: extra.target ?? '', hasAttribute: () => Boolean(extra.download) };
  return { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: Boolean(extra.ctrl), shiftKey: false, altKey: false, target: { closest: () => a } };
};

describe('leaving a page with unsaved changes', () => {
  it('asks for a link to another page of Perinexa', () => {
    expect(leavesPage(click('/patients/1'), here)).toBe(true);
    expect(leavesPage(click('/billing?kind=opd'), here)).toBe(true);
  });
  it('does not ask for the same page, a new tab, a download or another site', () => {
    expect(leavesPage(click('/patients/1/edit'), here)).toBe(false);
    expect(leavesPage(click('/patients/1', { target: '_blank' }), here)).toBe(false);
    expect(leavesPage(click('/patients/1', { ctrl: true }), here)).toBe(false);
    expect(leavesPage(click('/file.pdf', { download: true }), here)).toBe(false);
    expect(leavesPage(click('https://example.com/x'), here)).toBe(false);
  });
});
