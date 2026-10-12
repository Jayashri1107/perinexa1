// A PDF with one picture per page (JPEG, filling the page) – the smallest PDF writer that a printout needs, so no
// library is added. Plain functions: no browser needed.

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
// A PDF text string that can hold any letters: UTF-16 with a byte-order mark, written in hex
const pdfText = (text) => {
  let hex = 'FEFF';
  for (const c of String(text)) {
    const code = c.codePointAt(0);
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
    for (const u of units) hex += u.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
};
const num = (n) => String(Math.round(n * 100) / 100);
const pdfDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/**
 * The PDF's bytes. pages: [{ jpeg: Uint8Array, width, height }] (the picture's size in pixels); size: { width, height }
 * of each page in points (A4 is 595.28 × 841.89); title: shown by PDF viewers; now: the creation date.
 */
export function jpegPdf(pages, { width, height, title = '', now = new Date() }) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const put = (part) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n, ...parts) => {
    offsets[n] = length;
    put(`${n} 0 obj\n`);
    parts.forEach(put);
    put('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page list, 3 information; then for each page its page, contents and picture
  const pageObject = (i) => 4 + i * 3;
  put('%PDF-1.4\n');
  put(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)); // marks the file as binary
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfText(title)} /Producer (Perinexa) /CreationDate (${pdfDate(now)}) >>`);
  pages.forEach((page, i) => {
    const n = pageObject(i);
    const draw = `q ${num(width)} 0 0 ${num(height)} 0 0 cm /Pic Do Q`;
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /XObject << /Pic ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    object(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(
      n + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      '\nendstream',
    );
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n += 1) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
