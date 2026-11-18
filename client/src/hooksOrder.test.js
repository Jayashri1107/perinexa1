// A component that returns early must call every hook before that return (18 Nov 2026): Ask the pharmacy had a useState
// after `if (!d) return null`, and the whole stay page broke ("This page could not open") the moment its list arrived
// – React counts the hooks of each drawing and stops when the count changes. This reads every screen's source and
// looks for a hook after an early return at the component's own level.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.jsx') && !f.includes('.test.') ? [join(dir, f)] : []));

/** [line, hook line] pairs where a hook follows a component-level early return. PURE. */
export function lateHooks(text) {
  const found = [];
  let inComponent = false;
  let returnedAt = null;
  text.split('\n').forEach((line, i) => {
    if (/^(export )?(default )?function [A-Z]\w*\(/.test(line)) {
      inComponent = true;
      returnedAt = null;
    } else if (inComponent && line.startsWith('}')) {
      inComponent = false;
    } else if (inComponent && /^ {2}if \(.*\) return\b/.test(line)) {
      returnedAt = i + 1;
    } else if (inComponent && returnedAt && /^ {2}((const|let) .*=\s*)?use[A-Z]\w*\(/.test(line)) {
      found.push([returnedAt, i + 1]);
    }
  });
  return found;
}

describe('hooks before an early return', () => {
  it('finds a hook after an early return', () => {
    expect(lateHooks('function A() {\n  const a = useState(1);\n  if (!a) return null;\n  const [b] = useState(2);\n}')).toEqual([[3, 4]]);
    expect(lateHooks('function A() {\n  const a = useState(1);\n  const [b] = useState(2);\n  if (!a) return null;\n}')).toEqual([]);
  });

  it('no screen has one', () => {
    expect(files(src).length).toBeGreaterThan(100); // the screens were read
    const late = files(src).flatMap((f) => lateHooks(readFileSync(f, 'utf8')).map(([r, h]) => `${f.slice(src.length)}: return on line ${r}, hook on line ${h}`));
    expect(late).toEqual([]);
  });
});
