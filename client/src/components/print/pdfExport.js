// A printout as a PDF file, made in this browser from the print preview – nothing is sent anywhere. The document is
// laid out on the paper in a hidden frame with the app's own styles and fonts (the screen's sizes and colours left
// out), its pages end between lines (paperLayout.js), and each page is drawn as a picture – so Marathi and Hindi
// look exactly as the browser writes them – into a PDF (imagePdf.js). The same layout counts the pages to print.

import { jpegPdf } from './imagePdf.js';
import { PT_PER_MM, PX_PER_MM, pageBreaks, paperOf } from './paperLayout.js';

const SCALE = 2.5; // picture pixels per CSS pixel: about 240 dots per inch, sharp on paper and on a phone
const QUALITY = 0.9;
const px = (mm) => mm * PX_PER_MM;

// ---------- The app's styles, with its fonts inside (a picture can't fetch them) ----------

const fonts = new Map(); // font address → data: URL (fetched once)
const asDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
async function withFontsInside(css, base) {
  let out = css;
  for (const [, , address] of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    if (address.startsWith('data:')) continue;
    const full = new URL(address, base).href;
    if (!fonts.has(full)) {
      const res = await fetch(full);
      if (!res.ok) throw new Error('A font could not be loaded.');
      fonts.set(full, await asDataUrl(await res.blob()));
    }
    out = out.split(address).join(fonts.get(full));
  }
  return out;
}

// Every rule of the app's stylesheets except @media ones: paper keeps its own layout whatever the screen's size or
// colour scheme (and a person's own look is set on <html>, which the paper leaves out).
async function paperStyles() {
  const parts = [];
  const read = async (sheet) => {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      return; // (a stylesheet from another site: Perinexa has none)
    }
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) await read(rule.styleSheet);
      } else if (rule instanceof CSSFontFaceRule) parts.push(await withFontsInside(rule.cssText, sheet.href ?? document.baseURI));
      else if (!(rule instanceof CSSMediaRule)) parts.push(rule.cssText);
    }
  };
  for (const sheet of document.styleSheets) await read(sheet);
  return parts.join('\n');
}

// ---------- The document on paper ----------

// What must not be cut at the end of a page: every line of text, a picture, a table row, a part kept together
// (break-inside: avoid) – and the gap between a part and the one it is kept with (break-before / after: avoid).
function unitsIn(root, top) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const units = [];
  const span = (r) => [r.top - top, r.bottom - top];
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_ELEMENT | win.NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === win.Node.TEXT_NODE) {
      if (!n.data.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.height > 0) units.push(span(r));
      continue;
    }
    const r = n.getBoundingClientRect();
    if (!r.height) continue;
    const cs = win.getComputedStyle(n);
    const row = n.localName === 'tr' && !n.closest('table')?.classList.contains('pframe');
    if (cs.breakInside.startsWith('avoid') || row || n.localName === 'svg' || n.localName === 'img') units.push(span(r));
    const before = n.previousElementSibling;
    if (before && cs.breakBefore.startsWith('avoid')) units.push([before.getBoundingClientRect().bottom - top - 1, r.top - top + 1]);
    const after = n.nextElementSibling;
    if (after && cs.breakAfter.startsWith('avoid')) units.push([r.bottom - top - 1, after.getBoundingClientRect().top - top + 1]);
  }
  return units;
}

/** How closely a document may be fitted on its pages: the classes set around it (see print-rx.css). */
export const FITS = ['', 'pv-tight', 'pv-tight pv-tighter'];

// The document laid out on the paper in a hidden frame: its body, and the frame's header (a Draft band) and footer
// (patient and print details), which go on every page. `fit`: how closely (FITS).
async function layOut(docEl, page, { fit = 0 } = {}) {
  const paper = paperOf(page);
  const width = px(paper.width - paper.margin.left - paper.margin.right);
  const css = await paperStyles();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.ceil(width) + 40}px;height:1000px;border:0;visibility:hidden;pointer-events:none`;
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0;padding:0;background:#fff}</style></head><body></body></html>`);
    doc.close();
    const box = () => {
      const div = doc.createElement('div');
      if (FITS[fit]) div.className = FITS[fit];
      div.style.width = `${width}px`;
      doc.body.append(div);
      return div;
    };
    const content = box();
    const main = doc.importNode(docEl, true);
    content.append(main);
    const only = (keep) => {
      const copy = main.cloneNode(true);
      for (const part of copy.querySelectorAll('.pframe > thead, .pframe > tbody, .pframe > tfoot')) if (part.localName !== keep) part.remove();
      const holder = box();
      holder.append(copy);
      return holder;
    };
    const head = main.querySelector('.pframe > thead') ? only('thead') : null;
    const foot = main.querySelector('.pframe > tfoot') ? only('tfoot') : null;
    for (const part of main.querySelectorAll('.pframe > thead, .pframe > tfoot')) part.remove();

    await Promise.all([...doc.fonts].map((f) => f.load().catch(() => null)));
    await doc.fonts.ready;
    const height = (el) => (el ? Math.ceil(el.getBoundingClientRect().height) : 0);
    const top = content.getBoundingClientRect().top;
    const total = height(content);
    const headHeight = height(head);
    const footHeight = height(foot);
    const pageHeight = px(paper.height - paper.margin.top - paper.margin.bottom) - headHeight - footHeight;
    return { frame, css, paper, width, content, head, foot, headHeight, footHeight, total, breaks: pageBreaks(unitsIn(content, top), total, pageHeight) };
  } catch (err) {
    frame.remove();
    throw err;
  }
}

/**
 * How many pages the document prints on – and, when it may be fitted (`canFit`), the least close fit that saves a
 * page: { pages, fit } (fit: an index into FITS; 0 as it is).
 */
export async function paperPages(docEl, page, { canFit = false } = {}) {
  let best = null;
  for (let fit = 0; fit < (canFit ? FITS.length : 1); fit += 1) {
    const layout = await layOut(docEl, page, { fit });
    layout.frame.remove();
    const pages = layout.breaks.length - 1;
    if (!best || pages < best.pages) best = { pages, fit };
    if (pages === 1) break;
  }
  return best;
}

// ---------- Pictures of the pages ----------

// One part of the document, from y0 to y1 (CSS pixels), as a picture at SCALE. (A data: address: Chrome won't let a
// page be saved from a picture with HTML inside that came from a blob: address.)
async function picture({ css, width }, node, y0, y1, total) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * SCALE)}" height="${Math.round((y1 - y0) * SCALE)}" viewBox="0 ${y0} ${width} ${y1 - y0}">` +
    `<style><![CDATA[${css}]]></style>` +
    `<foreignObject x="0" y="0" width="${width}" height="${total}">${new XMLSerializer().serializeToString(node)}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    throw new Error('The page could not be drawn.');
  }
  return img;
}

const CANT = 'This browser can’t make the PDF. Press Print and choose “Save as PDF” as the printer instead.';
const jpeg = (canvas) =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error(CANT))), 'image/jpeg', QUALITY);
    } catch {
      reject(new Error(CANT)); // (a browser that won't let a drawn page be saved)
    }
  });

/**
 * The document as a PDF file (a Blob), each page as it prints. fit: as paperPages found; title: shown by PDF viewers;
 * pageNumbers: "Page 1 of 2" drawn in each page's bottom margin, as the printout has it.
 */
export async function makePdf(docEl, page, { fit = 0, title = '', pageNumbers = false } = {}) {
  const layout = await layOut(docEl, page, { fit });
  try {
    const { paper, breaks } = layout;
    const at = (mm) => Math.round(px(mm) * SCALE);
    const head = layout.head && (await picture(layout, layout.head, 0, layout.headHeight, layout.headHeight));
    const foot = layout.foot && (await picture(layout, layout.foot, 0, layout.footHeight, layout.footHeight));
    const pages = [];
    // Each page is cut a pixel above where the next part starts, so no edge of it (a box's border) shows
    const cut = (i) => (i === 0 || i === breaks.length - 1 ? breaks[i] : breaks[i] - 1);
    for (let i = 0; i < breaks.length - 1; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = at(paper.width);
      canvas.height = at(paper.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const left = at(paper.margin.left);
      const top = at(paper.margin.top);
      if (head) ctx.drawImage(head, left, top);
      const body = await picture(layout, layout.content, cut(i), cut(i + 1), layout.total);
      ctx.drawImage(body, left, top + Math.round(layout.headHeight * SCALE));
      if (foot) ctx.drawImage(foot, left, at(paper.height - paper.margin.bottom) - Math.round(layout.footHeight * SCALE));
      if (pageNumbers) {
        ctx.fillStyle = '#000000';
        ctx.font = `${Math.round(at(2.8))}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`Page ${i + 1} of ${breaks.length - 1}`, at(paper.width - paper.margin.right), at(paper.height - paper.margin.bottom / 2));
      }
      pages.push({ jpeg: await jpeg(canvas), width: canvas.width, height: canvas.height });
    }
    const bytes = jpegPdf(pages, { width: paper.width * PT_PER_MM, height: paper.height * PT_PER_MM, title });
    return new Blob([bytes], { type: 'application/pdf' });
  } finally {
    layout.frame.remove();
  }
}

// ---------- Handing the file over ----------

/** This browser can hand a PDF to other apps (WhatsApp, e-mail …) with its share window. */
export function canSharePdf() {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** Saves the file to the computer's Downloads folder (the browser's own download). */
export function downloadFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
