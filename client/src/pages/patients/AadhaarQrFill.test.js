// Which files the Aadhaar panel opens (24 Oct 2026): a clear message instead of "no QR found" for a PDF or a huge file
import { describe, expect, it } from 'vitest';
import { fileProblem } from './AadhaarQrFill.jsx';

const file = (name, type, size = 1000) => ({ name, type, size });

describe('a file uploaded as the photo of the card', () => {
  it('photos and screenshots are read', () => {
    for (const [n, t] of [['card.jpg', 'image/jpeg'], ['card.png', 'image/png'], ['card.webp', 'image/webp'], ['card', '']]) expect(fileProblem(file(n, t)), n).toBeNull();
  });
  it('a PDF (e-Aadhaar, locked with a password) says to upload a screenshot', () => {
    expect(fileProblem(file('EAadhaar.pdf', 'application/pdf'))).toBe('PDF');
    expect(fileProblem(file('EAadhaar.PDF', ''))).toBe('PDF');
  });
  it('a picture Chrome cannot open (iPhone HEIC) or another file is not a picture', () => {
    expect(fileProblem(file('IMG_1.heic', 'image/heic'))).toBe('NOT_IMAGE');
    expect(fileProblem(file('notes.txt', 'text/plain'))).toBe('NOT_IMAGE');
  });
  it('over 25 MB is too large', () => {
    expect(fileProblem(file('big.jpg', 'image/jpeg', 26 * 1024 * 1024))).toBe('TOO_BIG');
  });
});
