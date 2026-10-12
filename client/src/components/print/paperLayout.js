// Paper sizes and page breaks for a printout made into a PDF (pdfExport.js). Plain functions: no browser needed.

/** CSS pixels in a millimetre (96 per inch, as on paper). */
export const PX_PER_MM = 96 / 25.4;
/** Points (the PDF's unit, 72 per inch) in a millimetre. */
export const PT_PER_MM = 72 / 25.4;
const PAPER_MM = { A4: { width: 210, height: 297 }, A5: { width: 148, height: 210 } };

/**
 * The paper of a print preview's `page` ({ size: 'A4' | 'A5', margin: '12mm' | '45mm 12mm 20mm 12mm' }, or null for
 * A4 with 12 mm margins): { size, width, height, margin: { top, right, bottom, left } }, all in mm. The margin is
 * written as in CSS: one to four values.
 */
export function paperOf(page) {
  const size = page?.size === 'A5' ? 'A5' : 'A4';
  const mm = String(page?.margin ?? '12mm')
    .trim()
    .split(/\s+/)
    .map((x) => Number.parseFloat(x))
    .map((x) => (Number.isFinite(x) && x >= 0 ? x : 12));
  const [top, right = top, bottom = top, left = right] = mm;
  return { size, ...PAPER_MM[size], margin: { top, right, bottom, left } };
}

/**
 * Where each page ends: [0, end of page 1, end of page 2, …, total] (CSS pixels from the top of the document).
 * `units` are [top, bottom] spans that must not be cut – a line of text, a medicine, a box kept together; a page
 * ends at the lowest place that cuts none of them. A span taller than a page can't be kept together (as when
 * printing): it is left out, so its lines decide; a single line taller than a page is cut at the page's end.
 */
export function pageBreaks(allUnits, total, pageHeight) {
  const breaks = [0];
  if (!(pageHeight > 0)) return [0, total];
  const units = allUnits.filter(([a, b]) => b - a <= pageHeight);
  const cuts = (y) => units.some(([a, b]) => a < y - 0.5 && b > y + 0.5);
  let start = 0;
  while (total - start > pageHeight + 0.5) {
    const limit = start + pageHeight;
    const places = new Set([limit]);
    for (const [a, b] of allUnits) {
      if (a > start + 1 && a <= limit) places.add(a);
      if (b > start + 1 && b <= limit) places.add(b);
    }
    const end = [...places].sort((x, y) => y - x).find((y) => !cuts(y)) ?? limit;
    breaks.push(end);
    start = end;
  }
  breaks.push(total);
  return breaks;
}
