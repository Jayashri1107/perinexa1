// Quality control (Lab version 2 – docs/LAB_V2_PLAN.md): the Westgard rules on one lot's runs, newest last.
// z = (value − mean) / SD. Rules (classic multirule, within one control lot and level):
//   1-2s  one run beyond ±2 SD – a warning only
//   1-3s  one run beyond ±3 SD – rejected
//   2-2s  this and the previous run beyond 2 SD on the same side – rejected
//   R-4s  this and the previous run more than 4 SD apart (one above +2, one below −2) – rejected
//   4-1s  this and the 3 previous runs beyond 1 SD on the same side – rejected
//   10x   this and the 9 previous runs on the same side of the mean – rejected
// Accepted runs and warnings count as earlier runs; earlier rejected runs do too (as the Levey-Jennings chart shows them).

export const REJECTING = ['1-3s', '2-2s', 'R-4s', '4-1s', '10x'];
export const RULE_WORDS = {
  '1-2s': 'One run beyond 2 SD (warning)',
  '1-3s': 'One run beyond 3 SD',
  '2-2s': 'Two runs in a row beyond 2 SD, same side',
  'R-4s': 'Two runs in a row more than 4 SD apart',
  '4-1s': 'Four runs in a row beyond 1 SD, same side',
  '10x': 'Ten runs in a row on the same side of the mean',
};

export const zScore = (value, lot) => (value - lot.mean) / lot.sd;

/** The rules a new run breaks, given the earlier z-scores of the lot (oldest first). Returns { violations, status }. */
export function westgard(z, earlier = []) {
  const all = [...earlier, z];
  const last = (n) => all.slice(-n);
  const v = [];
  if (Math.abs(z) > 3) v.push('1-3s');
  const two = last(2);
  if (two.length === 2 && ((two[0] > 2 && two[1] > 2) || (two[0] < -2 && two[1] < -2))) v.push('2-2s');
  if (two.length === 2 && Math.abs(two[0] - two[1]) > 4 && Math.max(...two) > 2 && Math.min(...two) < -2) v.push('R-4s');
  const four = last(4);
  if (four.length === 4 && (four.every((x) => x > 1) || four.every((x) => x < -1))) v.push('4-1s');
  const ten = last(10);
  if (ten.length === 10 && (ten.every((x) => x > 0) || ten.every((x) => x < 0))) v.push('10x');
  if (!v.length && Math.abs(z) > 2) v.push('1-2s');
  const status = v.some((r) => REJECTING.includes(r)) ? 'rejected' : v.length ? 'warning' : 'accepted';
  return { violations: v, status };
}
