// Reading an Aadhaar QR (16 Oct 2026). Fake cards only: the QR text is built here the way UIDAI builds it.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ageFrom, decimalToBytes, parseAadhaarQr } from './aadhaarQr.js';

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
    expect(out).toEqual({ fullName: 'Asha Sample', ageYears: '30', address: '12, MG Road, Near Temple, Kothrud, Haveli', pinCode: '411038', city: 'Pune', state: 'Maharashtra', last4: '1234' });
    expect(JSON.stringify(out)).not.toContain('W/O'); // care of: not used
  });
  it('version 1 (no "V2" at the start) reads the same', async () => {
    expect((await parseAadhaarQr(secureQr(FIELDS), TODAY)).fullName).toBe('Asha Sample');
  });
  it('the decimal number becomes its bytes', () => {
    expect(Array.from(decimalToBytes('65535'))).toEqual([255, 255]);
    expect(Array.from(decimalToBytes('256'))).toEqual([1, 0]);
  });
});

describe('the old XML QR', () => {
  it('reads the attributes; of the number only the last 4 digits are kept', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="999988887777" name="Meena Sample" gender="F" yob="1990" co="D/O Sample" house="4" street="Station Road" lm="" loc="Shivaji Nagar" vtc="Nashik" po="Nashik" dist="Nashik" subdist="Nashik" state="Maharashtra" pc="422001"/>';
    const out = await parseAadhaarQr(xml, TODAY);
    expect(out).toEqual({ fullName: 'Meena Sample', ageYears: '36', address: '4, Station Road, Shivaji Nagar', pinCode: '422001', city: 'Nashik', state: 'Maharashtra', last4: '7777' });
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
