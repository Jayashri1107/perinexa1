// Voice entry: the voice corpora, scored the strict way (all fake sample data).
// Each case is one of:
//  - correct:   every expected value, and nothing else
//  - safe miss: nothing wrong, something expected is empty, and there is a question or note about it
//  - miss:      nothing wrong, something expected is empty, and nothing tells the person
//  - wrong:     a different value, or any tick, note or field that was not expected
// Safe misses never count towards pass rates. The data format is described at the top of each JSON file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERMS } from './obgyTerms.js';
import { extractPatientDetails, noteFinding } from './dictation.js';
import corpusA from './testdata/voiceCorpusA.json';
import corpusB from './testdata/voiceCorpusB.json';
import regions from './testdata/voiceRegions.json';
import negatives from './testdata/voiceNegatives.json';
import heldOut from './testdata/voiceHeldOut.json';
import ownerChrome from './testdata/voiceOwnerChrome.json';

process.env.TZ = 'Asia/Kolkata'; // the corpora's dates and times are in India's time
const NOW = new Date('2026-09-28T06:00:00Z'); // 28 Sep 2026, 11:30 in India

// Known gaps (plan 4.3): skipped until a later task fixes them
const KNOWN_GAPS = new Set([
  'cd32', // "known case of Asma": a name as well (too short to match by sound; the doctor can teach it)
  'md13', // "Nicardia for preterm labour" asks two questions
  'adv15', // "fibroid in mother" (gynaecology)
  'bg09', // "0 negative" with no blood-group words
]);

// The stage this code is at. Every LATER entry (and every negative case's `later`) must name a later task, so the
// task that fixes a case cannot end with it still listed.
const STAGE = '2b';
const TASKS = ['1a', '1b', '2a', '2b', '3a', '3b', '4'];
// Wrong cases allowed across all corpora (with LATER and `later` cases) at the end of each stage: the plan's gate is
// at most 3 after Task 1b and 0 after Task 2b. The Task 1a and 2a figures are what was measured.
const WRONG_GATE = { '1a': 30, '1b': 3, '2a': 0, '2b': 0 };

// Cases still wrong at this stage, and the task that fixes each (plan 4.1). Every other case must not be wrong.
const LATER = {};

// Pass-rate floors at this stage (Task 2b); they only go up. The plan's gates: Corpus A no drop below the Task 1b
// figure (80 %), Corpus B ≥ 97 %, and in each of the 12 regions ≥ 85 % correct and none wrong. Measured after Task 2b:
// Corpus A 97.4 %, Corpus B 99.0 %, regional cases 97.9 % (each region 7 or 8 of 8, none wrong).
const FLOORS = { A: 0.97, B: 0.98, regions: 0.95, eachRegion: 0.85 };

const LISTS = new Set(['medical.conditions', 'obstetric.pastComplications']);
const TEXT_LISTS = new Set(['medical.otherConditions', 'notes']);
const LOOSE = new Set(['fullName', 'address', 'motherName', 'medical.allergies']);
const NUMBERS = /^(?:ageYears|medical\.(?:heightCm|weightKg)|obstetric\.(?:gravida|para|living|abortions|previousCaesareans)|newborn\.birthWeightGrams)$/;
const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9+-]+/g, ' ').trim();

// What was filled, by path ("medical.conditions" → ['asthma'], "notes" → ['…', '…'])
function filled(r) {
  const out = {};
  for (const path of r.paths) {
    const [a, b] = path.split('.');
    const v = b ? r.values[a]?.[b] : r.values[a];
    if (v === undefined || v === null || v === '') continue;
    out[path] = TEXT_LISTS.has(path) ? String(v).split('; ').filter(Boolean) : v;
  }
  return out;
}
const questionText = (q) => [q.prompt, q.heard, ...q.options.map((o) => o.label)].join(' | ');

function sameScalar(path, got, want) {
  if (want && typeof want === 'object' && want.match) return new RegExp(want.match, 'i').test(String(got));
  if (path === 'phone') return String(got).replace(/\D/g, '') === String(want).replace(/\D/g, '');
  if (LOOSE.has(path)) return norm(got) === norm(want);
  if (NUMBERS.test(path)) return Number(got) === Number(want);
  return got === want;
}

// One way of reading a case's expectations: { wrong: [...], missing: [...] }
function check(expected, r, strictPaths) {
  const got = filled(r);
  const questions = r.questions.map(questionText);
  const wrong = [];
  const missing = [];
  const confirm = expected.confirm ?? {};
  const allowed = new Set([...Object.keys(expected.values), ...(expected.allow ?? []), ...Object.keys(confirm)]);
  for (const [path, want] of Object.entries(expected.values)) {
    const have = got[path];
    if (LISTS.has(path) || TEXT_LISTS.has(path)) {
      const list = have ?? [];
      const matches = (item, w) => (TEXT_LISTS.has(path) ? new RegExp(w, 'i').test(item) : item === w);
      for (const w of want) if (!list.some((item) => matches(item, w))) missing.push(`${path} ${w}`);
    } else if (have === undefined) missing.push(path);
    else if (!(Array.isArray(want) ? want : [want]).some((w) => sameScalar(path, have, w))) wrong.push(`${path}: want ${JSON.stringify(want)}, got ${JSON.stringify(have)}`);
  }
  for (const [path, { value, ask }] of Object.entries(confirm)) {
    const tick = path.match(/^(medical\.conditions|obstetric\.pastComplications)\.(.+)$/);
    const have = tick ? (got[tick[1]] ?? []).includes(tick[2]) || undefined : got[path];
    if (have !== undefined && !(tick ? value === true : sameScalar(path, have, value))) wrong.push(`${path}: want ${value}, got ${have}`);
    if (have === undefined && !questions.some((q) => new RegExp(ask, 'i').test(q))) missing.push(`${path} (no question)`);
  }
  // Anything else filled is wrong: an extra field, tick, other condition or note
  for (const [path, have] of Object.entries(got)) {
    if (strictPaths && !strictPaths.has(path)) continue;
    // A "Findings in this pregnancy" tick comes with its note (16 Oct 2026): right when that note was expected
    if (path === 'pregnancy.findings') {
      const notes = (got.notes ?? []).filter((n) => (expected.values.notes ?? []).some((w) => new RegExp(w, 'i').test(n)) || expected.allow?.includes('notes'));
      for (const item of have) if (!notes.some((n) => noteFinding(n) === item)) wrong.push(`extra ${path}: ${item}`);
      continue;
    }
    if (LISTS.has(path) || TEXT_LISTS.has(path)) {
      const want = expected.values[path] ?? [];
      const confirmed = Object.keys(confirm).filter((p) => p.startsWith(`${path}.`)).map((p) => p.slice(path.length + 1));
      if (expected.allow?.includes(path)) continue;
      for (const item of have) {
        const ok = TEXT_LISTS.has(path) ? want.some((w) => new RegExp(w, 'i').test(item)) : want.includes(item) || confirmed.includes(item);
        if (!ok) wrong.push(`extra ${path}: ${item}`);
      }
    } else if (!allowed.has(path)) wrong.push(`extra ${path}: ${JSON.stringify(have)}`);
  }
  for (const rx of expected.questions ?? []) if (!questions.some((q) => new RegExp(rx, 'i').test(q))) missing.push(`question /${rx}/`);
  for (const rx of expected.notes ?? []) if (!r.notes.some((n) => new RegExp(rx, 'i').test(n))) missing.push(`note /${rx}/`);
  return { wrong, missing };
}

function scoreCase(c, r, strictPaths) {
  let best = null;
  for (const expected of [c.expected, c.alt].filter(Boolean)) {
    const { wrong, missing } = check(expected, r, strictPaths);
    const told = r.questions.length > 0 || r.notes.length > 0;
    const status = wrong.length ? 'wrong' : !missing.length ? 'correct' : told ? 'safe miss' : 'miss';
    const rank = { correct: 0, 'safe miss': 1, miss: 2, wrong: 3 }[status];
    if (!best || rank < best.rank) best = { status, rank, wrong, missing };
  }
  return best;
}

const read = (c) => extractPatientDetails(c.text, { careType: c.careType, now: NOW, words: [], voice: true });
const ticks = (r) => [...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])];
const wordList = (file) =>
  readFileSync(new URL(`./testdata/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .map((w) => w.trim())
    .filter((w) => w && !w.startsWith('#'));
const commonWords = wordList('commonWords.txt');
const indianNames = wordList('indianNames.txt');

function run(corpus, name) {
  const strict = corpus.strictPaths ? new Set(corpus.strictPaths) : null;
  const results = corpus.cases
    .filter((c) => !KNOWN_GAPS.has(c.id))
    .map((c) => {
      const r = read(c);
      return { c, r, ...scoreCase(c, r, strict) };
    });
  const count = (s) => results.filter((x) => x.status === s).length;
  // VOICE_REPORT=1 npm test -w client: lists every case that is not correct (fake data), for working on the rules
  if (process.env.VOICE_REPORT) {
    for (const x of results.filter((y) => y.status !== 'correct')) console.log(`REPORT ${name} ${x.status} ${x.c.id} [${x.c.careType}] "${x.c.text}" :: ${[...x.wrong, ...x.missing].join(' | ')}`);
  }
  const summary = { name, total: results.length, correct: count('correct'), safe: count('safe miss'), miss: count('miss'), wrong: count('wrong') };
  summary.rate = summary.correct / summary.total;
  return { results, summary };
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const line = (s) => `${s.name}: ${s.correct}/${s.total} correct (${pct(s.rate)}), ${s.safe} safe misses, ${s.miss} misses, ${s.wrong} wrong`;

// One test per case: never wrong (a case listed in LATER is a to-do until its task)
function eachCase(results) {
  for (const x of results) {
    if (LATER[x.c.id]) it.todo(`${x.c.id} (${LATER[x.c.id]})`);
    else it(`${x.c.id} is not wrong`, () => expect(x.wrong, x.c.text).toEqual([]));
  }
}

const runs = {};

describe('Corpus A – patient information, numbers and dates', () => {
  const { results, summary } = (runs.A = run(corpusA, 'Corpus A'));
  eachCase(results);
  it(`meets the floor (${line(summary)})`, () => {
    console.info(line(summary));
    expect(summary.rate).toBeGreaterThanOrEqual(FLOORS.A);
  });
});

describe('Corpus B – clinical details', () => {
  const { results, summary } = (runs.B = run(corpusB, 'Corpus B'));
  eachCase(results);
  it(`meets the floor (${line(summary)})`, () => {
    console.info(line(summary));
    expect(summary.rate).toBeGreaterThanOrEqual(FLOORS.B);
  });
});

describe('Regional cases (8 for each of 12 varieties of Indian English)', () => {
  const { results, summary } = (runs.regions = run(regions, 'Regions'));
  eachCase(results);
  it(`reports each region and meets the floor (${line(summary)})`, () => {
    const byRegion = new Map();
    for (const x of results) byRegion.set(x.c.region, [...(byRegion.get(x.c.region) ?? []), x]);
    const rows = [...byRegion].map(([region, xs]) => `${region}: ${xs.filter((x) => x.status === 'correct').length}/${xs.length} correct, ${xs.filter((x) => x.status === 'wrong').length} wrong`);
    console.info([line(summary), ...rows].join('\n'));
    expect(summary.rate).toBeGreaterThanOrEqual(FLOORS.regions);
    expect(byRegion.size).toBe(12);
    // each region: at least 85 % correct, and none wrong
    const below = [...byRegion].filter(([, xs]) => xs.filter((x) => x.status === 'correct').length / xs.length < FLOORS.eachRegion || xs.some((x) => x.status === 'wrong'));
    expect(below.map(([region]) => region)).toEqual([]);
  });
});

// The held-out cases (plan 4.3): written by a separate author before any rule changes, and kept out of the builders'
// sight until the final check. Two of their failures (H05, H19) guided the fixes in commit 48f050a, so they are a
// regression set now, not an independent measure. None may be wrong, and every case that was correct at the final
// check (38 of 40) must stay correct. The two below were left empty then, with nothing wrong filled; one that becomes
// correct must be taken off the list, so the figure only goes up.
const HELD_OUT_MISSES = {
  H17: 'antenatal sex words fill nothing; the note that they were removed comes from the voice box, not the reader',
  H38: '"previous baby had cleft lip" is not ticked as a congenital anomaly',
};
describe('Held-out cases (regression set)', () => {
  const { results, summary } = (runs.heldOut = run(heldOut, 'Held-out'));
  eachCase(results);
  for (const x of results.filter((y) => !HELD_OUT_MISSES[y.c.id])) {
    it(`${x.c.id} stays correct`, () => expect([x.status, ...x.missing], x.c.text).toEqual(['correct']));
  }
  it(`keeps its pass rate (${line(summary)})`, () => {
    console.info(line(summary));
    expect(summary.total).toBe(40);
    expect(summary.correct).toBeGreaterThanOrEqual(38);
    const nowCorrect = Object.keys(HELD_OUT_MISSES).filter((id) => results.find((x) => x.c.id === id)?.status === 'correct');
    expect(nowCorrect, 'correct now: take off HELD_OUT_MISSES').toEqual([]);
  });
});

// What the owner's own Google Chrome wrote (29 Sep 2026), read as on that day: every case correct, with nothing asked
// that must not be, every correction listed, and exactly the parts expected listed as not understood.
describe("The owner's Chrome transcripts (29 Sep 2026)", () => {
  const now = new Date(ownerChrome.now);
  for (const c of ownerChrome.cases) {
    it(`${c.id} is correct`, () => {
      const r = extractPatientDetails(c.text, { careType: c.careType, now, words: [], voice: true });
      const { wrong, missing } = check(c.expected, r, null);
      expect([...wrong, ...missing], c.text).toEqual([]);
      const asked = r.questions.map(questionText);
      for (const rx of c.expected.noQuestions ?? []) expect(asked.filter((q) => new RegExp(rx, 'i').test(q)), rx).toEqual([]);
      for (const want of c.expected.corrections ?? []) expect(r.corrections).toContainEqual(expect.objectContaining(want));
      if (c.expected.unused) expect(r.unused.map((u) => u.text)).toEqual(c.expected.unused);
    });
  }
});

// "Not understood" lists only what nothing was taken from (plan G5.10): never a result, a "no" or a clinical word said
// with a finding that was read ("HIV non reactive", "not a known case of DM", "known case of diabetes"), nor the label
// of a value read ("birth weight 2.8 kg"). Listed, it would read as ignored, and "Add to notes" would note it alone.
const USED_WORDS =
  /^(?:(?:not\s+a\s+|no\s+)?(?:known\s+case\s+of|k\s*\/?\s*c\s*\/?\s*o|history\s+of|h\/o|family\s+history\s+of)|non\s+reactive|negative(?:\s+no)?|birth\s+weight)$/i;
describe('"Not understood" never lists words that were used', () => {
  it('in every correct case of corpora A and B, the regions and the held-out set', () => {
    const listed = [runs.A, runs.B, runs.regions, runs.heldOut]
      .flatMap(({ results }) => results.filter((x) => x.status === 'correct'))
      .flatMap((x) => x.r.unused.filter((u) => USED_WORDS.test(u.text)).map((u) => `${x.c.id}: “${u.text}”`));
    expect(listed).toEqual([]);
  });
});

describe('phrases that must change nothing (negative corpus)', () => {
  for (const c of negatives.cases.filter((x) => !x.later)) {
    it(`${c.id}: “${c.text}”`, () => {
      const r = read(c);
      const got = scoreCase(c, r, null);
      expect(got.wrong, 'wrong or extra values').toEqual([]);
      expect(got.missing, 'expected values').toEqual([]);
      expect([...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])], 'ticks').toEqual(c.expected.values['medical.conditions'] ?? []);
      expect(r.corrections, 'words changed').toEqual([]); // plan 4.3: 0 changes
    });
  }
  for (const c of negatives.cases.filter((x) => x.later)) it.todo(`${c.id}: “${c.text}” (${c.later})`);

  // Husbands', doctors' and hospitals' names (testdata/indianNames.txt): nothing changed, ticked or filled
  it(`the names in indianNames.txt as a husband's, a doctor's or a hospital's name (${indianNames.length} names)`, () => {
    const changed = [];
    for (const name of indianNames) {
      for (const text of [`husband ${name}`, `referred by Dr ${name}`, `${name} Hospital`, `w/o ${name}`]) {
        const r = read({ text, careType: 'antenatal' });
        if (r.corrections.length || ticks(r).length || r.paths.length) changed.push(`${text}: ${JSON.stringify([r.corrections, ticks(r), r.paths])}`);
      }
    }
    expect(changed).toEqual([]);
  });
});

describe('ordinary sentences change and tick nothing (random, seeded)', () => {
  // 500 sentences of 4 to 10 words from the common dictation words, Indian names and places, and Hinglish words (not
  // the few words that are findings themselves, or numbers)
  const SAID_AS_TERM = new Set(TERMS.flatMap((t) => t.says.map((say) => say.toLowerCase())));
  const HINGLISH = 'haan ji achha theek bas abhi wala wali mein se ko ka ki ke aur bhi nahi hai tha thi kya matlab pehle baad'.split(' ');
  const pool = [...commonWords.filter((w) => !SAID_AS_TERM.has(w) && !/^(?:three|seven|eight|eleven|twelve|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)$/.test(w)), ...indianNames, ...HINGLISH];
  let seed = 2929;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sentences = Array.from({ length: 500 }, () => Array.from({ length: 4 + Math.floor(next() * 7) }, () => pool[Math.floor(next() * pool.length)]).join(' '));
  it('0 ticks and 0 automatic corrections in 500 sentences', () => {
    const changed = sentences
      .map((text) => ({ text, r: read({ text, careType: 'antenatal' }) }))
      .filter(({ r }) => r.corrections.length || ticks(r).length)
      .map(({ text, r }) => `${text} :: ${JSON.stringify([r.corrections, ticks(r)])}`);
    expect(changed).toEqual([]);
  });
});

describe(`the gate for this stage (Task ${STAGE})`, () => {
  it(`at most ${WRONG_GATE[STAGE]} wrong cases across all corpora`, () => {
    const wrong = [
      ...[runs.A, runs.B, runs.regions, runs.heldOut].flatMap(({ results }) => results.filter((x) => x.status === 'wrong').map((x) => x.c.id)),
      ...negatives.cases.filter((c) => scoreCase(c, read(c), null).status === 'wrong').map((c) => c.id),
    ];
    console.info(`Wrong across all corpora: ${wrong.length} (${wrong.join(', ')})`);
    expect(wrong.length).toBeLessThanOrEqual(WRONG_GATE[STAGE]);
  });

  it('every case put off is put off to a later task', () => {
    const task = (label) => String(label).match(/Task (\d[a-z]?)/)?.[1];
    const due = [...Object.entries(LATER), ...negatives.cases.filter((c) => c.later).map((c) => [c.id, c.later])].filter(
      ([, label]) => !TASKS.includes(task(label)) || TASKS.indexOf(task(label)) <= TASKS.indexOf(STAGE),
    );
    expect(due).toEqual([]);
  });
});

describe('Undo on a correction never puts a different value in the form (plan 1.7)', () => {
  // Each correction that offers Undo, undone on its own: every value is the same as before, or empty (with a question
  // or a note) – never a different one. Notes and other conditions may lose the words undone, a ticked list its tick.
  const cases = [...corpusA.cases, ...corpusB.cases, ...regions.cases];
  it(`in every case of corpora A, B and the regions`, () => {
    const changed = [];
    let undone = 0;
    for (const c of cases) {
      const opts = { careType: c.careType, now: NOW, voice: true };
      const before = filled(extractPatientDetails(c.text, opts));
      for (const corr of extractPatientDetails(c.text, opts).corrections.filter((x) => x.undo !== false)) {
        undone++;
        const after = filled(extractPatientDetails(c.text, { ...opts, keep: [corr.heard] }));
        for (const [path, value] of Object.entries(after)) {
          if (TEXT_LISTS.has(path)) continue;
          if (LISTS.has(path) ? value.some((x) => !before[path]?.includes(x)) : JSON.stringify(value) !== JSON.stringify(before[path])) changed.push(`${c.id} “${corr.heard}”: ${path} ${JSON.stringify(before[path])} → ${JSON.stringify(value)}`);
        }
      }
    }
    expect(undone).toBeGreaterThan(50);
    expect(changed).toEqual([]);
  });
});

describe('saying the opposite never gives the same result (swap check)', () => {
  const SAYS = TERMS.flatMap((t) => t.says).filter((w) => w.length >= 3);
  const noTerm = new RegExp(`\\bno\\s+(?=(?:history\\s+of\\s+|h/o\\s+|known\\s+)?(?:${SAYS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b)`, 'gi');
  const swaps = [
    [/\bnon[\s-]?reactive\b/gi, 'reactive'],
    [/\bnegative\b/gi, 'positive'],
    [noTerm, ''],
  ];
  const all = [...corpusA.cases, ...corpusB.cases, ...regions.cases].filter((c) => !KNOWN_GAPS.has(c.id));
  // One copy for each place an opposite word was said, with only that one swapped
  const pairs = all.flatMap((c) =>
    swaps.flatMap(([rx, to]) => [...c.text.matchAll(rx)].map((m) => ({ c, text: `${c.text.slice(0, m.index)}${to}${c.text.slice(m.index + m[0].length)}` }))),
  );
  // Pairs where the same result is right (or a later task makes it differ), by case and the swapped words
  const SAME_OK = {
    'bg19 husband B positive': "the husband's blood group is not recorded, so no change is right",
  };
  const exception = ({ c, text }) =>
    Object.keys(SAME_OK).find((k) => {
      const [id, ...words] = k.split(' ');
      const said = words.join(' ').toLowerCase();
      return id === c.id && text.toLowerCase().includes(said) && !c.text.toLowerCase().includes(said);
    });
  // What was ticked, filled and asked. The same (and nothing new asked) means the opposite word was ignored.
  const seen = (r) =>
    JSON.stringify([ticks(r), r.values.medical?.bloodGroup, r.values.medical?.otherConditions, r.values.notes, r.questions.map((q) => [q.prompt, q.options.map((o) => o.value)])]);
  const checked = pairs.filter((p) => !exception(p));
  it(`changes what is ticked, filled or asked (${checked.length} pairs)`, () => {
    const same = checked.filter(({ c, text }) => seen(read(c)) === seen(read({ ...c, text }))).map(({ c, text }) => `${c.id}: "${c.text}" → "${text}"`);
    expect(same).toEqual([]);
  });
  for (const p of pairs.filter(exception)) {
    const why = SAME_OK[exception(p)];
    if (/^Task/.test(why)) it.todo(`${p.c.id}: "${p.text}" (${why})`);
  }
});
