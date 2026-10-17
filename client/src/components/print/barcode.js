// Code 128 (set B) barcodes for the lab's sample labels (docs/LAB_LIMS_PLAN.md feature 1), drawn as SVG bars – no
// library. Any barcode scanner reads them as typed text ("261017-0003-2"), so scanning a label into Lab → Find opens
// its order. Set B covers the printable ASCII characters (space to ~).

// The bar and space widths of the 107 Code 128 symbols (values 0–105, then the stop symbol), each 11 modules wide
// (the stop: 13), from the standard (ISO/IEC 15417).
export const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** The symbol values of a text in set B, with the start symbol and the check symbol (not the stop). */
export function code128Values(text) {
  const values = [START_B];
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error('A barcode holds only plain letters, digits and signs.');
    values.push(code - 32);
  }
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check];
}

/** The bars of a text: [{ x, w }] in modules, and the total width in modules (with a 10-module quiet zone each side). */
export function code128Bars(text) {
  const QUIET = 10;
  const widths = [...code128Values(text), STOP].flatMap((v) => PATTERNS[v].split('').map(Number));
  const bars = [];
  let x = QUIET;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w }); // bar, space, bar, space …
    x += w;
  });
  return { bars, width: x + QUIET };
}
