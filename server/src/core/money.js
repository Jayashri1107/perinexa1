// Money in rupees, always rounded to paise, so sums never drift (0.1 + 0.2 problems).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const sum = (values) => round2(values.reduce((total, v) => total + Number(v || 0), 0));
