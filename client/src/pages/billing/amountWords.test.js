// The amount in words on a receipt ("Received with thanks: Rs. Three Hundred Only").
import { describe, expect, it } from 'vitest';
import { amountInWords, rupeesInWords } from './amountWords.js';

describe('an amount in words', () => {
  it('says rupees the Indian way, in lakh and crore', () => {
    expect(amountInWords(30000)).toBe('Rs. Three Hundred Only');
    expect(amountInWords(12500000)).toBe('Rs. One Lakh Twenty Five Thousand Only');
    expect(rupeesInWords(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
    expect(rupeesInWords(0)).toBe('Zero');
  });
  it('adds the paise when there are any', () => {
    expect(amountInWords(30050)).toBe('Rs. Three Hundred and Fifty Paise Only');
  });
});
