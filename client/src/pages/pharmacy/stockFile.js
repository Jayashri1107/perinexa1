// Reading the old pharmacy software's stock list for Opening stock (Pharmacy → Stock → Import opening stock): an
// Excel file (.xlsx) or a CSV file, read here in the browser – the file is never sent anywhere, only its stock lines
// go to the server (server/src/pharmacy/openingStock.js judges them).
//
// An .xlsx file is a zip of XML files: it is unzipped with the browser's own DecompressionStream, so no spreadsheet
// library is needed. The first sheet is read. Its heading row is found by the column names old software uses
// ("ItemName", "BatchNo", "Exp_Date", "Bal Qty", "MRP", "Total Amt - Landed" …).

// ---------- Unzipping ----------

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip: Map name → () => Promise<Uint8Array>. */
export function unzip(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const files = new Map();
  const names = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const skip = nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    files.set(name, () => (method === 0 ? Promise.resolve(data) : method === 8 ? inflate(data) : Promise.reject(new Error('The Excel file is packed in a way that cannot be read.'))));
    at += 46 + skip;
  }
  return files;
}

// ---------- The first sheet of an .xlsx file, as rows of cells ----------

// The sheet's XML is regular (rows of cells), so it is read with patterns rather than a full XML parser – the same
// code then runs in the browser and in the tests. Element names may carry a prefix ("x:row").
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? all)));
const elements = (text, name) => [...text.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'g'))].map((m) => ({ attrs: m[1], body: m[2] ?? '' }));
const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`))?.[1] ?? null;
const textOf = (body) => elements(body, 't').map((t) => unescape(t.body)).join('');
/** "AB12" → 27 (0-based column). */
const columnOf = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(bytes) {
  const files = unzip(bytes);
  const read = async (name) => (files.has(name) ? new TextDecoder().decode(await files.get(name)()) : null);
  const book = await read('xl/workbook.xml');
  if (!book) throw new Error('This is not an Excel (.xlsx) file.');
  const sheet = elements(book, 'sheet')[0];
  const rid = sheet && attr(sheet.attrs, 'id');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = elements(rels, 'Relationship').find((r) => attr(r.attrs, 'Id') === rid);
  const to = (target && attr(target.attrs, 'Target')) ?? 'worksheets/sheet1.xml';
  const path = to.startsWith('/') ? to.slice(1) : `xl/${to.replace(/^\.\//, '')}`;
  const sheetText = await read(path);
  if (!sheetText) throw new Error('The Excel file has no sheet to read.');
  const shared = await read('xl/sharedStrings.xml');
  const strings = shared ? elements(shared, 'si').map((si) => textOf(si.body)) : [];
  const rows = [];
  for (const r of elements(sheetText, 'row')) {
    const cells = [];
    elements(r.body, 'c').forEach((c, i) => {
      const ref = attr(c.attrs, 'r');
      const col = ref ? columnOf(ref) : i;
      const type = attr(c.attrs, 't');
      const v = unescape(elements(c.body, 'v')[0]?.body ?? '');
      cells[col] = type === 's' ? (strings[Number(v)] ?? '') : type === 'inlineStr' ? textOf(c.body) : type === 'str' || type === 'b' || type === 'e' ? v : v === '' ? '' : Number(v);
    });
    rows[Number(attr(r.attrs, 'r') ?? rows.length + 1) - 1] = cells;
  }
  return rows;
}

/** A CSV file (Excel → Save As → CSV) as rows of cells. */
export function readCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

// ---------- The columns ----------

const key = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9%]/g, '');
// Each field: the headings that name it (compared without spaces, capitals or punctuation).
const HEADINGS = {
  name: ['itemname', 'item', 'name', 'productname', 'product', 'medicine', 'medicinename', 'description', 'itemdescription', 'particulars', 'drugname'],
  batch: ['batch', 'batchno', 'batchnumber', 'batchname'],
  expiry: ['exp', 'expiry', 'expdate', 'expirydate', 'expdt'],
  qty: ['balqty', 'qty', 'quantity', 'stock', 'closingstock', 'closingqty', 'clqty', 'clstock', 'balance', 'currentstock', 'stockqty', 'balanceqty'],
  mrp: ['mrp', 'mrprate', 'mrpperunit', 'unitmrp'],
  mrpTotal: ['totalamtmrp', 'totalmrp', 'mrpvalue', 'mrpamount', 'valuemrp', 'mrpamt', 'stockvaluemrp'],
  rate: ['rate', 'purchaserate', 'prate', 'purrate', 'ptr', 'cost', 'costrate', 'landed', 'landedrate', 'landedcost', 'netrate', 'unitcost'],
  rateTotal: ['totalamtlanded', 'totallanded', 'landedvalue', 'landedamount', 'totalamtpurchase', 'totalpurchase', 'purchasevalue', 'costvalue', 'stockvalue', 'value', 'amount'],
  gstRate: ['gst', 'gst%', 'gstrate', 'gstper', 'tax', 'tax%', 'taxrate', 'igst', 'igst%'],
  hsn: ['hsn', 'hsncode', 'hsnsac', 'hsnno'],
  schedule: ['schedule', 'sch', 'drugschedule', 'schtype'],
  form: ['form', 'dosageform', 'itemtype'],
  unit: ['unit', 'uom', 'units'],
};
export const NEEDED = ['name', 'batch', 'expiry', 'qty'];
export const FIELD_LABELS = { name: 'Item name', batch: 'Batch', expiry: 'Expiry', qty: 'Quantity', mrp: 'MRP', mrpTotal: 'Total MRP', rate: 'Purchase rate', rateTotal: 'Total purchase value', gstRate: 'GST %', hsn: 'HSN', schedule: 'Schedule', form: 'Form', unit: 'Unit' };

/** Which column holds each field, from a heading row: { field: column index }. */
export function columnsOf(headings) {
  const found = {};
  headings.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    for (const [field, names] of Object.entries(HEADINGS)) if (!(field in found) && names.includes(k)) found[field] = i;
  });
  return found;
}

/** The heading row: the first of the top 20 rows that names an item, a batch, an expiry and a quantity. */
export function findHeadings(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const cols = columnsOf(rows[i] ?? []);
    if (NEEDED.every((f) => f in cols)) return { index: i, columns: cols };
  }
  return null;
}

// ---------- Values ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ym = (y, m) => (m >= 1 && m <= 12 ? `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, '0')}` : null);

/** An expiry as old software writes it → 'YYYY-MM' (the pack's expiry month), or the text as it was. */
export function readExpiry(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); // an Excel date
      return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
    }
    return String(v);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/); // 30/06/2029
  if (m) return ym(Number(m[3]), Number(m[2])) ?? t;
  m = t.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/); // 06/2029, 6/29
  if (m) return ym(Number(m[2]), Number(m[1])) ?? t;
  m = t.match(/^(\d{4})[/.-](\d{1,2})(?:[/.-]\d{1,2})?(?:[T ].*)?$/); // 2029-06-30
  if (m) return ym(Number(m[1]), Number(m[2])) ?? t;
  m = t.match(/^(?:\d{1,2}[\s/.-])?([a-z]{3})[a-z]*[\s/.,-]+(\d{2}|\d{4})$/i); // Jun-29, 30 Jun 2029
  if (m && MONTHS[m[1].toLowerCase()]) return ym(Number(m[2]), MONTHS[m[1].toLowerCase()]);
  return t;
}

/** "1,236.90" → 1236.9; '' → null; text that is not a number stays as it was (the server reports it). */
export function readNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = String(v).replace(/[,₹\s]/g, '').replace(/%$/, '');
  if (t === '' || t === '-') return null;
  return Number.isFinite(Number(t)) ? Number(t) : String(v).trim();
}
// A GST column formatted as a percentage in Excel holds 0.05 for 5 %.
const percent = (v) => (typeof v === 'number' && v > 0 && v < 1 ? Math.round(v * 100) : v);
const toPaise = (rupees) => (typeof rupees === 'number' ? Math.round(rupees * 100) : rupees);

/**
 * The stock lines of a sheet: { lines, columns, missing } – lines ready for the server, `columns` the fields found,
 * `missing` the needed ones not found. A row without a name but with a batch belongs to the item above it (old
 * software prints an item's name once over its batches); empty rows and total rows are left out.
 */
export function stockLines(rows) {
  const head = findHeadings(rows);
  if (!head) return { lines: [], columns: {}, missing: NEEDED };
  const c = head.columns;
  const at = (row, field) => (field in c ? row[c[field]] : null);
  const lines = [];
  let lastName = '';
  for (let i = head.index + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.every((x) => x === '' || x == null)) continue;
    const ownName = String(at(row, 'name') ?? '').trim();
    const batch = at(row, 'batch');
    if (!ownName && (batch == null || batch === '')) continue; // a total or a page heading
    if (/^(grand\s*)?total\b/i.test(ownName) && (batch == null || batch === '')) continue;
    const name = ownName || lastName;
    lastName = name;
    const qty = readNumber(at(row, 'qty'));
    const perUnit = (single, total) => {
      const one = readNumber(at(row, single));
      if (one != null) return toPaise(one);
      const all = readNumber(at(row, total));
      return typeof all === 'number' && typeof qty === 'number' && qty > 0 ? Math.round((all * 100) / qty) : all;
    };
    const text = (field) => {
      const v = at(row, field);
      return v == null || v === '' ? null : String(v).trim();
    };
    lines.push({
      row: i + 1,
      name,
      batch: text('batch'),
      expiry: readExpiry(at(row, 'expiry')),
      qty,
      mrpPaise: perUnit('mrp', 'mrpTotal'),
      ratePaise: perUnit('rate', 'rateTotal'),
      gstRate: percent(readNumber(at(row, 'gstRate'))),
      hsn: text('hsn'),
      schedule: text('schedule'),
      form: text('form'),
      unit: text('unit'),
    });
  }
  const has = (f) => f in c;
  const missing = [...NEEDED.filter((f) => !has(f)), ...(!has('mrp') && !has('mrpTotal') ? ['mrp'] : []), ...(!has('rate') && !has('rateTotal') ? ['rate'] : [])];
  return { lines, columns: c, missing };
}

/** A chosen file → { lines, columns, missing }. */
export async function readStockFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('This is the old Excel format (.xls). Open it in Excel and save it as .xlsx, then choose it again.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rows = name.endsWith('.csv') ? readCsv(new TextDecoder().decode(bytes)) : await readXlsx(bytes);
  return stockLines(rows);
}
