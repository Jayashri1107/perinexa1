// A small tag with the floor of a ward, e.g. "1st floor" (owner, 9 Oct 2026). Nothing when the ward has no floor.
import { Building2 } from 'lucide-react';

export function FloorTag({ floor }) {
  if (!floor) return null;
  return (
    <span className="floor-tag">
      <Building2 size={11} aria-hidden /> {floor}
    </span>
  );
}

/** "General ward (1st floor)" – how a stay keeps its ward – as { name: 'General ward', floor: '1st floor' }. */
export function wardParts(label = '') {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label ?? '');
  return m ? { name: m[1], floor: m[2] } : { name: label ?? '', floor: '' };
}
