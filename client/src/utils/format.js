const dateTime = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (value) => (value ? dateTime.format(new Date(value)) : '—');
export const formatDate = (value) => (value ? dateOnly.format(new Date(value)) : '—');

// A person's status on screen: active, inactive, or active but still on the temporary password.
export const userStatus = (user) => (!user.isActive ? 'inactive' : user.mustChangePassword ? 'pending' : 'active');

export const activeStatus = (record) => (record.isActive ? 'active' : 'inactive');

// [{ key, label }] → [{ value, label }] for selects and checkboxes.
export const toOptions = (items, valueKey = 'key', labelKey = 'label') =>
  items.map((i) => ({ value: i[valueKey], label: i[labelKey] }));

// Money in rupees with the currency symbol from the server's settings (set once by AppConfigContext).
let currencySymbol = '';
export const setCurrencySymbol = (symbol) => {
  currencySymbol = symbol;
};
const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatMoney = (n) => `${n < 0 ? '−' : ''}${currencySymbol}${money.format(Math.abs(Number(n) || 0))}`;

// Age in whole years from the date of birth ("about" when only the age was given at registration).
export function ageText(birthDate, approx) {
  if (!birthDate) return '—';
  const b = new Date(birthDate);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) years -= 1;
  return `${approx ? 'about ' : ''}${Math.max(0, years)} y`;
}

// A count from analytics: a number, or { below: N } for a small number that is not shown exactly.
export const countText = (value) => (value && typeof value === 'object' ? `fewer than ${value.below}` : String(value ?? 0));
export const countValue = (value) => (value && typeof value === 'object' ? 0 : Number(value ?? 0));

// "2026-10" → "Oct 2026"
export const monthText = (ym) => new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00`));

// Today's date as "YYYY-MM-DD" (this computer's clock).
export const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// A key's label from a [{ key, label }] list.
export const labelOf = (list, key) => list.find((x) => x.key === key)?.label ?? key;
