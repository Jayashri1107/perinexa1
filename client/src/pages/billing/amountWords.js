// An amount in words, the Indian way (lakh, crore), for "Received with thanks: Rs. Three Hundred Only" on a receipt.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const belowHundred = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const belowThousand = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', belowHundred(n % 100)].filter(Boolean).join(' ');

/** Whole rupees in words: 300 → "Three Hundred", 125000 → "One Lakh Twenty Five Thousand", 0 → "Zero". */
export function rupeesInWords(rupees) {
  let n = Math.floor(Math.abs(rupees));
  if (n === 0) return 'Zero';
  const parts = [];
  for (const [size, name] of [
    [10_000_000, 'Crore'],
    [100_000, 'Lakh'],
    [1000, 'Thousand'],
  ]) {
    if (n >= size) {
      const count = Math.floor(n / size);
      parts.push(`${size === 10_000_000 ? rupeesInWords(count) : belowHundred(count)} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** An amount in paise as the receipt says it: 30000 → "Rs. Three Hundred Only", 30050 → "Rs. Three Hundred and Fifty Paise Only". */
export function amountInWords(paise) {
  const p = Math.round(Math.abs(paise));
  const rupees = Math.floor(p / 100);
  const rest = p % 100;
  return `Rs. ${rupeesInWords(rupees)}${rest ? ` and ${belowHundred(rest)} Paise` : ''} Only`;
}
