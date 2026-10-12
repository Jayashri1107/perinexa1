// "Nice" y-axis ticks for a column chart: 0 and 2 to 4 more round steps (1, 2 or 5 × 10^n) that reach the
// highest value. 0 → [0, 1]; 7 → [0, 2, 4, 6, 8]; 1234 → [0, 500, 1000, 1500].

const MAX_STEPS = 4;

export function niceTicks(max) {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  if (top === 0) return [0, 1];
  let step = 1;
  for (let power = 1; ; power *= 10) {
    const found = [1, 2, 5].map((m) => m * power).find((s) => Math.ceil(top / s) <= MAX_STEPS);
    if (found) {
      step = found;
      break;
    }
  }
  const steps = Math.max(1, Math.ceil(top / step));
  return Array.from({ length: steps + 1 }, (_, i) => i * step);
}
