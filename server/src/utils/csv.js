// Excel-ready CSV. PURE. A cell that starts like a formula (= + - @, a tab or a return) gets a leading apostrophe, so
// opening the file in Excel or Google Sheets never runs anything; the byte-order mark makes Excel read the file as UTF-8
// (Marathi and Hindi names, the rupee sign).
export const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
