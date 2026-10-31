// The installable app (31 Oct 2026): the manifest names the app and its icons, the page links them, and the service
// worker keeps no patient data – it never answers /api, never stores a page, and only shows the offline page.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pub = (f) => new URL(`../../public/${f}`, import.meta.url);
const read = (f) => readFileSync(pub(f), 'utf8');

describe('the installable app', () => {
  it('the manifest: name, start, standalone, the icons it lists exist', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    expect(m).toMatchObject({ name: 'Perinexa', short_name: 'Perinexa', start_url: '/', scope: '/', display: 'standalone', theme_color: '#1E2163' });
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
    expect(existsSync(pub('apple-touch-icon.png'))).toBe(true);
  });

  it('the page links the manifest and the home-screen icon', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });

  it('the service worker leaves /api alone, stores no page, and keeps only the offline page and its icon', () => {
    const sw = read('sw.js');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("req.mode !== 'navigate'");
    expect(sw).toContain('fetch(req).catch(() => caches.match(OFFLINE))');
    expect(sw).not.toMatch(/cache\.put|caches\.open\([^)]*\)\.then\(\(c\) => c\.put/);
    expect(sw).toContain("cache.addAll([OFFLINE, '/icon-192.png'])");
    expect(read('offline.html')).toContain('Nothing is kept on this device');
  });
});
