// Printouts made into PDFs: the paper, where pages end, and the PDF file itself (no browser needed).
import { describe, expect, it } from 'vitest';
import { jpegPdf } from './imagePdf.js';
import { pageBreaks, paperOf } from './paperLayout.js';

describe('the paper', () => {
  it('is A4 with 12 mm margins unless the design says otherwise', () => {
    expect(paperOf(null)).toEqual({ size: 'A4', width: 210, height: 297, margin: { top: 12, right: 12, bottom: 12, left: 12 } });
    expect(paperOf({ size: 'A5', margin: '8mm' })).toMatchObject({ size: 'A5', width: 148, height: 210, margin: { top: 8, left: 8 } });
    // a doctor's own printed pad: room for its printed top and bottom
    expect(paperOf({ size: 'A4', margin: '45mm 12mm 20mm 12mm' }).margin).toEqual({ top: 45, right: 12, bottom: 20, left: 12 });
    expect(paperOf({ margin: '10mm 5mm' }).margin).toEqual({ top: 10, right: 5, bottom: 10, left: 5 });
  });
});

describe('where pages end', () => {
  const lines = (from, to, step = 20) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => [from + i * step, from + i * step + 16]);

  it('keeps a document that fits on one page', () => {
    expect(pageBreaks(lines(0, 400), 400, 1000)).toEqual([0, 400]);
  });

  it('ends a page between lines, never through one', () => {
    const breaks = pageBreaks(lines(0, 2500), 2500, 1010); // lines at 0–16, 20–36 … a page end at 1010 would cut one
    expect(breaks[1]).toBe(1000);
    expect(breaks.at(-1)).toBe(2500);
    expect(breaks).toHaveLength(4);
  });

  it('moves a box kept together to the next page, and cuts one taller than a page', () => {
    const units = [...lines(0, 700), [700, 1100]]; // the box from 700 to 1100 does not fit on the first page
    expect(pageBreaks(units, 1100, 1000)).toEqual([0, 700, 1100]);
    expect(pageBreaks([[0, 2500]], 2500, 1000)).toEqual([0, 1000, 2000, 2500]);
  });

  it('ends a page between lines of a part too long to keep together', () => {
    const units = [[0, 2500], ...lines(0, 2500)]; // e.g. the whole page marked "keep together"
    expect(pageBreaks(units, 2500, 1010)).toEqual([0, 1000, 2000, 2500]);
  });
});

describe('the PDF file', () => {
  const text = (bytes) => String.fromCharCode(...bytes);
  const picture = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9); // (a stand-in: the PDF does not read the picture)

  it('has one page per picture, the size of the paper', () => {
    const pdf = text(jpegPdf([{ jpeg: picture, width: 1985, height: 2807 }, { jpeg: picture, width: 1985, height: 2807 }], { width: 595.28, height: 841.89, title: 'Prescription P-000002' }));
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf.match(/\/MediaBox \[0 0 595.28 841.89\]/g)).toHaveLength(2);
    expect(pdf.match(/\/Width 1985 \/Height 2807 .* \/Filter \/DCTDecode \/Length 4 >>/g)).toHaveLength(2);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a table that points at every object, so viewers can open it', () => {
    const pdf = text(jpegPdf([{ jpeg: picture, width: 10, height: 10 }], { width: 419.53, height: 595.28, title: 'Visit summary · हिंदी' }));
    const xref = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const offsets = pdf
      .slice(xref)
      .split('\n')
      .filter((l) => / 00000 n $/.test(l))
      .map((l) => Number(l.slice(0, 10)));
    expect(offsets).toHaveLength(6); // catalog, pages, information; the page, its contents and its picture
    offsets.forEach((at, i) => expect(pdf.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(pdf).toContain('/Title <FEFF'); // any language, written safely
  });
});
