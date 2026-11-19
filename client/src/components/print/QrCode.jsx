import { useEffect, useState } from 'react';
import zxingWriterUrl from 'zxing-wasm/writer/zxing_writer.wasm?url';

// A QR code drawn in this browser with ZXing's writer (zxing-wasm – already part of the app for reading QR codes; its
// program file comes with the app, never from the internet). Used on the printed lab report (Lab version 2): it opens
// the public page that confirms the report is genuine. Nothing is drawn until it is ready, and nothing when it fails.

let writer = null; // a promise of writeBarcode, or of null when it can't load
function loadWriter() {
  writer ??= (async () => {
    try {
      const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/writer');
      await prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWriterUrl : prefix + path) }, fireImmediately: true });
      return writeBarcode;
    } catch {
      return null;
    }
  })();
  return writer;
}

/**
 * ZXing's SVG has a fixed width and height (one pixel per module, e.g. 45 × 45) and no viewBox, so stretching the
 * <svg> only made its canvas bigger and the code stayed tiny in one corner. A viewBox of the same size lets it scale.
 */
export function scalable(svg) {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!tag || /\bviewBox=/.test(tag)) return svg;
  const w = /\bwidth="([\d.]+)"/.exec(tag)?.[1];
  const h = /\bheight="([\d.]+)"/.exec(tag)?.[1];
  if (!w || !h) return svg;
  return svg.replace(tag, tag.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`));
}

/** The QR code of `value` as an inline SVG, sizeMm wide. */
export function QrCode({ value, sizeMm = 22, className = '', label = 'QR code to check this report' }) {
  const [svg, setSvg] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const write = await loadWriter();
      if (!write || !value) return;
      try {
        const out = await write(value, { format: 'QRCode' });
        if (alive && out?.svg && !out.error) setSvg(scalable(out.svg));
      } catch {
        // no QR code then – the printed report still carries the address in words
      }
    })();
    return () => {
      alive = false;
    };
  }, [value]);
  if (!svg) return null;
  // The SVG comes from ZXing's own writer for our own text – not from a person or the network
  return <span className={`qr-code ${className}`.trim()} style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
