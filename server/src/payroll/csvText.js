// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): the attendance file as text. A small reader of our own –
// quoted cells, the byte-order mark, CRLF, and comma, semicolon or tab between cells. Every cell stays text: nothing
// in the file is ever worked out or run. The file is untrusted: a size limit, a row limit, and plain refusals.
// No database, no requests: every function here is PURE.

export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 80;
export const DELIMITERS = [',', ';', '\t'];

/** A file that can't be read, said in plain words for the person who chose it. */
export class FileProblem extends Error {
  constructor(message, code = 'FILE_NOT_READ') {
    super(message);
    this.code = code;
  }
}

/** The file's bytes as text, or a FileProblem: too big, empty, an Excel workbook, or not text at all. */
export function decodeFile(bytes) {
  if (!bytes?.length) throw new FileProblem('This file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw new FileProblem('This file is larger than 1 MB. An attendance file for one month is far smaller – check that the right file was chosen.', 'FILE_TOO_BIG');
  // An Excel workbook (.xlsx is a zip; .xls starts D0 CF 11 E0) is not read: it is saved as CSV first
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) {
    throw new FileProblem('This is an Excel workbook. In Excel choose File → Save As → “CSV (Comma delimited)”, then choose that file here.', 'EXCEL_FILE');
  }
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  else text = new TextDecoder('utf-8').decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
  if (text.includes('\u0000')) throw new FileProblem('This file is not a text file. Save the attendance as CSV and choose that file.', 'NOT_TEXT');
  return text;
}

/** Comma, semicolon or tab: the one that splits the first lines into the most cells (outside quotes). */
export function sniffDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 10);
  let best = ',';
  let most = 0;
  for (const d of DELIMITERS) {
    let n = 0;
    for (const line of lines) {
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n += 1;
      }
    }
    if (n > most) {
      most = n;
      best = d;
    }
  }
  return best;
}

/**
 * The text as rows of cells (each cell trimmed text). Rows keep their place: rows[0] is the file's first line, and an
 * empty line is an empty row, so "row 12" on the screen is line 12 of the file as Excel shows it.
 */
export function parseCsv(text, delimiter = sniffDelimiter(text)) {
  if (!DELIMITERS.includes(delimiter)) throw new FileProblem('Unknown separator.');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  const endCell = () => {
    row.push(wasQuoted ? cell : cell.trim());
    cell = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    if (row.length > MAX_COLUMNS) throw new FileProblem(`Row ${rows.length + 1} has more than ${MAX_COLUMNS} columns. This does not look like an attendance file.`, 'TOO_WIDE');
    rows.push(row.length === 1 && row[0] === '' ? [] : row);
    if (rows.length > MAX_ROWS) throw new FileProblem(`This file has more than ${MAX_ROWS} rows. Read one month at a time.`, 'TOO_LONG');
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (ch === delimiter) endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else if (!wasQuoted || ch.trim() !== '') cell += ch; // (spaces after a closing quote are dropped)
  }
  if (quoted) throw new FileProblem('A quoted cell in this file is never closed. Save the file as CSV again and choose it.', 'BAD_QUOTES');
  if (cell !== '' || row.length) endRow();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  if (!rows.some((r) => r.length)) throw new FileProblem('This file has no rows.');
  return { rows, delimiter, columns: rows.reduce((m, r) => Math.max(m, r.length), 0) };
}
