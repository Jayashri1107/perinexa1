// The treatment ladder (docs/FERTILITY_PLAN.md section 6): the steps a couple commonly moves through – follicular
// study with timed intercourse, IUI, IVF or ICSI – and the other procedures infertility care may need. From a current
// plan the doctor switches to the next step or to a procedure (routes/fertilityPlans.js POST with `switchFrom`): the
// old plan is closed as "moved to the next step", the cycles completed under it are added to her record, and a new
// draft is built from the step's protocol. The website keeps the same lists in fertilityFormat.js (a test compares them).

export const LADDER_STEPS = [
  { key: 'follicular_study', label: 'Follicular study with timed intercourse', protocols: ['follicular_study'], counter: 'oiCycles' },
  { key: 'iui', label: 'IUI with ovarian stimulation', protocols: ['iui'], counter: 'iuiCycles' },
  { key: 'ivf', label: 'IVF or ICSI', protocols: ['ivf'], counter: 'ivfCycles' },
];

// Other procedures, each the protocol that describes it
export const PROCEDURES = [
  { key: 'los', label: 'Laparoscopy with ovarian drilling', protocols: ['los'] },
  { key: 'tubal', label: 'Tubal surgery, or surgery for a hydrosalpinx', protocols: ['tubal'] },
  { key: 'uterine', label: 'Hysteroscopic surgery (septum, fibroid, polyp, adhesions)', protocols: ['uterine'] },
  { key: 'endometriosis', label: 'Endometriosis surgery', protocols: ['endometriosis'] },
  { key: 'varicocele', label: 'Varicocele repair and the male work-up', protocols: ['male_mild'] },
  { key: 'sperm_retrieval', label: 'Surgical sperm retrieval with ICSI', protocols: ['male_severe'] },
  { key: 'donor', label: 'Donor gametes', protocols: ['donor'] },
  { key: 'preservation', label: 'Fertility preservation', protocols: ['preservation'] },
];

export const SWITCH_TARGETS = [...LADDER_STEPS, ...PROCEDURES];
export const SWITCH_KEYS = SWITCH_TARGETS.map((t) => t.key);
export const targetByKey = new Map(SWITCH_TARGETS.map((t) => [t.key, t]));

// Which cycle counter on her record a protocol's cycles belong to (null: no cycles are counted for it)
export const COUNTER_FOR_PROTOCOL = {
  follicular_study: 'oiCycles',
  oi_letrozole: 'oiCycles',
  oi_gonadotrophins: 'oiCycles',
  oi_group1: 'oiCycles',
  hyperprolactinaemia: 'oiCycles',
  iui: 'iuiCycles',
  ivf: 'ivfCycles',
  dor: 'ivfCycles',
  donor: 'ivfCycles',
};
const STEP_RANK = { follicular_study: 1, iui: 2, ivf: 3 };
const STEP_OF_COUNTER = { oiCycles: 'follicular_study', iuiCycles: 'iui', ivfCycles: 'ivf' };

/** The ladder step a plan stands on, from its protocols: the highest of them, or null when it is a procedure or work-up. */
export function stepOf(protocolKeys = []) {
  let best = null;
  for (const k of protocolKeys) {
    const counter = COUNTER_FOR_PROTOCOL[k];
    const step = counter ? STEP_OF_COUNTER[counter] : null;
    if (step && (!best || STEP_RANK[step] > STEP_RANK[best])) best = step;
  }
  return best;
}

/** The cycle counter the cycles of a plan are added to when the doctor switches away from it (null: none). */
export const counterFor = (protocolKeys = []) => LADDER_STEPS.find((s) => s.key === stepOf(protocolKeys))?.counter ?? null;
