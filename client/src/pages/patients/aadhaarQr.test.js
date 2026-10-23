// Reading an Aadhaar QR (16 Oct 2026). Fake cards only: the QR text is built here the way UIDAI builds it.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ageFrom, careOf, decimalToBytes, parseAadhaarQr, searchAreas } from './aadhaarQr.js';

const TODAY = new Date(2026, 9, 16);

// A Secure QR: fields split by byte 255, gzip, then the bytes as one big decimal number
function secureQr(fields) {
  const parts = fields.map((f) => Buffer.from(f, 'latin1'));
  const sep = Buffer.from([255]);
  const raw = Buffer.concat(parts.flatMap((p) => [p, sep]).concat([Buffer.from([1, 2, 3, 4])])); // + a fake photo
  return BigInt(`0x${gzipSync(raw).toString('hex')}`).toString(10);
}
const FIELDS = ['3', '123420191231120000000', 'Asha Sample', '15-08-1996', 'F', 'W/O Ravi Sample', 'Pune', 'Near Temple', '12', 'Kothrud', '411038', 'Kothrud', 'Maharashtra', 'MG Road', 'Haveli', 'Pune'];

describe('the Secure QR', () => {
  it('version 2: name, age from the date of birth, address, PIN, city, state and only the last 4 digits', async () => {
    const out = await parseAadhaarQr(secureQr(['V2', ...FIELDS, '0000']), TODAY);
    expect(out).toEqual({ fullName: 'Asha Sample', ageYears: '30', address: '12, MG Road, Near Temple, Kothrud, Haveli', pinCode: '411038', city: 'Pune', state: 'Maharashtra', last4: '1234', contactName: 'Ravi Sample', contactRelation: 'Husband' });
    expect(JSON.stringify(out)).not.toContain('W/O'); // care of: her husband, as her contact person
  });
  it('version 1 (no "V2" at the start) reads the same', async () => {
    expect((await parseAadhaarQr(secureQr(FIELDS), TODAY)).fullName).toBe('Asha Sample');
  });
  it('the decimal number becomes its bytes', () => {
    expect(Array.from(decimalToBytes('65535'))).toEqual([255, 255]);
    expect(Array.from(decimalToBytes('256'))).toEqual([1, 0]);
  });
});

// Real cards that failed on the live site while the demo card read (23 Oct 2026) – rebuilt here with fake details
describe('real-card Secure QRs that used to fail', () => {
  // A fake photo of some size (as on a real card), so the fields are well before the end of the packed data
  let seed = 12345;
  const photo = Buffer.from(Array.from({ length: 3000 }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255)); // hardly packs, like a photo
  const packed = (fields) => gzipSync(Buffer.concat([...fields.flatMap((f) => [Buffer.from(f, 'latin1'), Buffer.from([255])]), photo]));
  const asNumber = (buf) => BigInt(`0x${buf.toString('hex')}`).toString(10);

  it('extra bytes after the packed data', async () => {
    const qr = asNumber(Buffer.concat([packed(['V2', ...FIELDS, '0000']), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])]));
    expect((await parseAadhaarQr(qr, TODAY)).fullName).toBe('Asha Sample');
  });
  it('the end of the packed data damaged (photo and check sum): the details at the start still read', async () => {
    const buf = packed(['V2', ...FIELDS, '0000']);
    buf[buf.length - 6] ^= 0xff; // the check sum
    expect((await parseAadhaarQr(asNumber(buf), TODAY)).fullName).toBe('Asha Sample');
    expect((await parseAadhaarQr(asNumber(buf.subarray(0, buf.length - 400)), TODAY)).pinCode).toBe('411038'); // cut short
  });
  it('a newer version with one field more before the name', async () => {
    const out = await parseAadhaarQr(asNumber(packed(['V3', 'X', ...FIELDS, '0000'])), TODAY);
    expect(out).toMatchObject({ fullName: 'Asha Sample', ageYears: '30', pinCode: '411038', city: 'Pune', state: 'Maharashtra', last4: '1234' });
  });
  it('spaces or line breaks in the number from a scanner', async () => {
    const qr = secureQr(['V2', ...FIELDS, '0000']);
    expect((await parseAadhaarQr(`${qr.slice(0, 200)}\n${qr.slice(200)} \n`, TODAY)).fullName).toBe('Asha Sample');
  });
  it('a name in UTF-8', async () => {
    const f = [...FIELDS];
    f[2] = 'Asha Sämple';
    const raw = Buffer.concat([...['V2', ...f, '0000'].flatMap((x) => [Buffer.from(x, 'utf8'), Buffer.from([255])]), photo]);
    expect((await parseAadhaarQr(asNumber(gzipSync(raw)), TODAY)).fullName).toBe('Asha Sämple');
  });
});

describe('the short XML QR (QPDB)', () => {
  it('name, age, address split into city, state and PIN; last 4 digits only', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><QPDB u="xxxxxxxx5678" n="Kavita Sample" g="F" d="02-03-1992" a="W/O Anil Sample, 7, Lake Road, Pune, Maharashtra - 411001" x="" s="ABC"/>';
    const out = await parseAadhaarQr(xml, TODAY);
    expect(out).toEqual({ fullName: 'Kavita Sample', ageYears: '34', address: '7, Lake Road', pinCode: '411001', city: 'Pune', state: 'Maharashtra', last4: '5678', contactName: 'Anil Sample', contactRelation: 'Husband' });
  });
});

describe('the old XML QR', () => {
  it('reads the attributes; of the number only the last 4 digits are kept', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="999988887777" name="Meena Sample" gender="F" yob="1990" co="D/O Sample" house="4" street="Station Road" lm="" loc="Shivaji Nagar" vtc="Nashik" po="Nashik" dist="Nashik" subdist="Nashik" state="Maharashtra" pc="422001"/>';
    const out = await parseAadhaarQr(xml, TODAY);
    expect(out).toEqual({ fullName: 'Meena Sample', ageYears: '36', address: '4, Station Road, Shivaji Nagar', pinCode: '422001', city: 'Nashik', state: 'Maharashtra', last4: '7777', contactName: 'Sample', contactRelation: 'Father' });
    expect(JSON.stringify(out)).not.toContain('99998888');
  });
});

describe('anything else', () => {
  it('is refused as not an Aadhaar QR', async () => {
    for (const t of ['https://example.com', '12345', '', `${'9'.repeat(150)}`]) await expect(parseAadhaarQr(t, TODAY)).rejects.toThrow('NOT_AADHAAR');
  });
});

describe('age', () => {
  it('counts whole years, before and after the birthday', () => {
    expect(ageFrom({ dob: '16-10-1996' }, TODAY)).toBe('30');
    expect(ageFrom({ dob: '17-10-1996' }, TODAY)).toBe('29');
    expect(ageFrom({ dob: '1996-10-17' }, TODAY)).toBe('29');
    expect(ageFrom({ yob: '1990' }, TODAY)).toBe('36');
    expect(ageFrom({ dob: 'unknown' }, TODAY)).toBe('');
  });
});

describe('care of: her contact person (17 Oct 2026)', () => {
  it('wife of → husband, daughter of → father, care of → no relation', () => {
    expect(careOf('W/O: Ravi Sample')).toEqual({ name: 'Ravi Sample', relation: 'Husband' });
    expect(careOf('D/O Mohan Sample')).toEqual({ name: 'Mohan Sample', relation: 'Father' });
    expect(careOf('C/O Sita Sample')).toEqual({ name: 'Sita Sample', relation: '' });
    expect(careOf('Ravi Sample')).toEqual({ name: 'Ravi Sample', relation: '' });
  });
});

describe('where the QR is looked for in a picture', () => {
  it('the whole, the middle, then nine overlapping halves; the camera only the whole and its middle 85 %', () => {
    expect(searchAreas(4000, 3000)).toHaveLength(11);
    expect(searchAreas(4000, 3000)[1]).toEqual([800, 600, 2400, 1800]);
    expect(searchAreas(1920, 1080, true)).toEqual([[0, 0, 1920, 1080], [144, 81, 1632, 918]]);
  });
});

describe('a USB webcam before the laptop’s own camera (17 Oct 2026)', () => {
  it('knows a laptop camera by its name', async () => {
    const { isBuiltInCamera } = await import('./AadhaarQrFill.jsx');
    for (const name of ['Integrated Camera (04f2:b6dd)', 'Integrated Webcam', 'FaceTime HD Camera', 'HP TrueVision HD Camera (Built-in)']) expect(isBuiltInCamera(name), name).toBe(true);
    for (const name of ['Logitech BRIO (046d:085e)', 'HD Pro Webcam C920', 'USB Camera', '']) expect(isBuiltInCamera(name), name).toBe(false);
  });
});
