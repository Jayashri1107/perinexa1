import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// crypto.randomUUID exists only on a secure page (https or localhost). Called directly it blanked the Admit and Book a
// scan forms on an http address (2 Nov 2026): use newRequestId from api.js, which has a fallback.
const SRC = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.jsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

describe('features of secure pages only', () => {
  it('only api.js calls crypto.randomUUID', () => {
    const callers = sources(SRC).filter((f) => /crypto\.randomUUID\(\)/.test(readFileSync(f, 'utf8')) && !f.endsWith('api.js'));
    expect(callers).toEqual([]);
  });
});
