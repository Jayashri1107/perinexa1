import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readCsv, readExpiry, readNumber, readXlsx, stockLines } from './stockFile.js';

// Reading the old pharmacy software's stock list for Opening stock. Fake sample stock only.

/** A small zip, as an .xlsx is: each file deflated (or stored). The reader does not check the CRC, so it is 0. */
function zip(files, { store = [] } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const stored = store.includes(name);
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, stored ? 0 : 8, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    parts.push(local, data);
    central.push(dir);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, d) => s + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const cellXml = (ref, v) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${v.s}</v></c>`);
function xlsx(rows) {
  const strings = [];
  const s = (text) => {
    if (!strings.includes(text)) strings.push(text);
    return { s: strings.indexOf(text) };
  };
  const body = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v == null ? '' : cellXml(`${String.fromCharCode(65 + c)}${r + 1}`, typeof v === 'number' ? v : s(v)))).join('')}</row>`)
    .join('');
  const sst = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((t) => `<si><t>${t.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
  return zip(
    {
      'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Current Stock" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${body}</sheetData></worksheet>`,
      'xl/sharedStrings.xml': sst,
    },
    { store: ['xl/workbook.xml'] },
  );
}

describe('values as old pharmacy software writes them', () => {
  it('reads expiry dates in every usual way, as the expiry month', () => {
    expect(readExpiry('30/06/2029')).toBe('2029-06');
    expect(readExpiry('06/2029')).toBe('2029-06');
    expect(readExpiry('6/29')).toBe('2029-06');
    expect(readExpiry('2028-02-29')).toBe('2028-02');
    expect(readExpiry('Jun-29')).toBe('2029-06');
    expect(readExpiry('30 Nov 2027')).toBe('2027-11');
    expect(readExpiry(47299)).toBe('2029-06'); // an Excel date: 30 Jun 2029
    expect(readExpiry('soon')).toBe('soon'); // the server reports it
    expect(readExpiry('')).toBeNull();
  });
  it('reads numbers with thousands commas; text that is not a number is kept to be reported', () => {
    expect(readNumber('1,236.90')).toBe(1236.9);
    expect(readNumber(' 3.00 ')).toBe(3);
    expect(readNumber('')).toBeNull();
    expect(readNumber('ten')).toBe('ten');
  });
  it('reads a CSV file with quoted cells', () => {
    expect(readCsv('﻿Item,Qty\r\n"SAMPLE SYP, 100 ML",2\r\n')).toEqual([
      ['Item', 'Qty'],
      ['SAMPLE SYP, 100 ML', '2'],
    ]);
  });
});

describe('the stock lines of a sheet', () => {
  // Laid out like the "Current Stock" sheet: a title above the headings, totals per line, an item's name once over
  // its batches, a total row at the end.
  const rows = [
    ['SAMPLE MEDICAL STORES'],
    ['Current Stock'],
    ['Sr. No', 'ItemName', 'BatchNo', 'Exp_Date', 'Bal Qty', 'Phy Qty', 'Total Amt - MRP', 'Total Amt - Landed'],
    [1, 'SAMPLE CANNULA CHILD', 'G24G040630', '30/06/2029', '3.00', '', '756.00', '80.19'],
    [2, '', 'G24G040631', '31/03/2028', '61.00', '', '6,100.00', '1,220.00'],
    [3, 'SAMPLE DROP', '26490618', 47299, 3, '', 145, 112.5],
    [],
    ['', 'Total Amt (MRP)', '', '', '', '', '7,001.00', '1,412.69'],
  ];
  it('finds the heading row, gives every batch its item, works totals back to per-unit prices, leaves totals out', () => {
    const { lines, missing } = stockLines(rows);
    expect(missing).toEqual([]);
    expect(lines).toEqual([
      { row: 4, name: 'SAMPLE CANNULA CHILD', batch: 'G24G040630', expiry: '2029-06', qty: 3, mrpPaise: 25200, ratePaise: 2673, gstRate: null, hsn: null, schedule: null, form: null, unit: null },
      { row: 5, name: 'SAMPLE CANNULA CHILD', batch: 'G24G040631', expiry: '2028-03', qty: 61, mrpPaise: 10000, ratePaise: 2000, gstRate: null, hsn: null, schedule: null, form: null, unit: null },
      { row: 6, name: 'SAMPLE DROP', batch: '26490618', expiry: '2029-06', qty: 3, mrpPaise: 4833, ratePaise: 3750, gstRate: null, hsn: null, schedule: null, form: null, unit: null },
    ]);
  });
  it('uses per-unit columns and GST, HSN and schedule when the file has them (a GST % cell may hold 0.05)', () => {
    const { lines } = stockLines([
      ['Item Name', 'Batch', 'Expiry', 'Qty', 'MRP', 'P.Rate', 'GST %', 'HSN Code', 'Schedule'],
      ['SAMPLE TAB', 'B1', '06/2028', 10, 12.5, 8, 0.05, '3004', 'H1'],
    ]);
    expect(lines[0]).toMatchObject({ qty: 10, mrpPaise: 1250, ratePaise: 800, gstRate: 5, hsn: '3004', schedule: 'H1' });
  });
  it('names the needed columns it could not find', () => {
    expect(stockLines([['Item', 'Qty'], ['A', 1]]).missing).toEqual(['name', 'batch', 'expiry', 'qty']);
    expect(stockLines([['Item', 'Batch', 'Expiry', 'Qty'], ['A', 'B', '06/2028', 1]]).missing).toEqual(['mrp', 'rate']);
  });
});

describe('an Excel (.xlsx) file', () => {
  it('is unzipped and its first sheet read: shared texts, numbers and dates', async () => {
    const file = xlsx([
      ['ItemName', 'BatchNo', 'Exp_Date', 'Bal Qty', 'MRP', 'Rate'],
      ['SAMPLE A & B TAB', 'X1', 47299, 20, 10.5, 7.25],
    ]);
    const rows = await readXlsx(file);
    expect(rows).toEqual([
      ['ItemName', 'BatchNo', 'Exp_Date', 'Bal Qty', 'MRP', 'Rate'],
      ['SAMPLE A & B TAB', 'X1', 47299, 20, 10.5, 7.25],
    ]);
    expect(stockLines(rows).lines[0]).toMatchObject({ name: 'SAMPLE A & B TAB', expiry: '2029-06', qty: 20, mrpPaise: 1050, ratePaise: 725 });
  });
  it('says so when the file is not an Excel file', async () => {
    await expect(readXlsx(new TextEncoder().encode('just text'))).rejects.toThrow('not an Excel');
  });
});
