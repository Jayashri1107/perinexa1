// An amount in Indian words for bills: 4300.5 → "Rupees Four Thousand Three Hundred and Paise Fifty Only".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const threeDigits = (n) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && twoDigits(n % 100)].filter(Boolean).join(' ');

// Indian grouping: crore, lakh, thousand, hundred.
function wholeWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wholeWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ');
}

export function amountInWords(amount) {
  const value = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(value + 1e-9);
  const paise = Math.round((value - rupees) * 100);
  return `Rupees ${wholeWords(rupees)}${paise ? ` and Paise ${twoDigits(paise)}` : ''} Only`;
}
