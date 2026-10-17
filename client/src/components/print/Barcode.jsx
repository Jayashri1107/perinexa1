import { code128Bars } from './barcode.js';

/** A Code 128 barcode of `value` as SVG, `height` in mm; the text is printed under it by the caller. */
export function Barcode({ value, height = 9, className = '' }) {
  const { bars, width } = code128Bars(value);
  return (
    <svg className={`barcode ${className}`.trim()} viewBox={`0 0 ${width} 30`} preserveAspectRatio="none" style={{ height: `${height}mm` }} role="img" aria-label={`Barcode ${value}`}>
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="30" fill="currentColor" />
      ))}
    </svg>
  );
}
