// The built-in DRAFT content of the clinic library, copied from Perinexa (content/*.json): care-plan templates, the
// red-flag rules, the medicine safety list, the risk rules, consent and information forms, test packages and
// prescription sets. ⚠️ Prepared by the software developer from published guidance – NOT reviewed by a doctor or a
// lawyer. Each hospital gets its own copy as a DRAFT, which its doctors check, edit and approve in the app.
// Nothing here is used for a patient until a doctor has approved it.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`./content/${name}.json`, import.meta.url), 'utf8'));

// The kinds of entry, in the order of the library's tabs. own: the hospital may add its own; single: one entry per
// hospital (a rule set or list); prescribers: only for those who write prescriptions.
export const LIBRARY_KINDS = [
  { key: 'care_plan', label: 'Care plans', singular: 'Care plan', own: true },
  { key: 'red_flag_rules', label: 'Red-flag rules', singular: 'Red-flag rules', single: true },
  { key: 'medicine_safety', label: 'Medicine safety', singular: 'Medicine safety list', single: true },
  { key: 'risk_rules', label: 'Risk rules', singular: 'Risk rules', single: true },
  { key: 'consent_form', label: 'Consent forms', singular: 'Consent form', own: true },
  { key: 'information_form', label: 'Information forms', singular: 'Information form', own: true },
  { key: 'test_package', label: 'Test packages', singular: 'Test package', own: true },
  { key: 'prescription_set', label: 'Prescription sets', singular: 'Prescription set', own: true, prescribers: true },
];
export const KIND_KEYS = LIBRARY_KINDS.map((k) => k.key);
export const kindOf = (key) => LIBRARY_KINDS.find((k) => k.key === key);

export const FACTORS = load('factors');
export const CARE_PLAN_ITEM_KINDS = ['visit', 'investigation', 'scan', 'vaccination', 'medication', 'advice'];
export const RED_FLAG_LEVELS = ['urgent', 'watch'];
export const RISK_LEVELS = ['high', 'moderate'];
export const MED_SAFETY_KINDS = ['medicine', 'combination', 'breastfeeding', 'newborn', 'dose'];
export const MED_SAFETY_LEVELS = ['avoid', 'caution'];
export const DOSE_UNITS = ['', 'mg', 'mcg', 'g', 'IU'];
export const FORM_LANGUAGES = ['en', 'mr', 'hi'];

const OP_WORDS = { lt: 'below', lte: 'at most', gt: 'above', gte: 'at least', eq: 'exactly' };

// "BP systolic at least 160 mmHg" – one condition of a red-flag rule in words.
export function conditionText(c) {
  const f = FACTORS.redFlag[c.factor] ?? { label: c.factor, unit: '' };
  if (c.grade) return `${f.label} ${c.grade} or more`;
  if (c.choices) return `${f.label}: ${c.choices.join(' or ')}`;
  return `${f.label} ${OP_WORDS[c.op] ?? c.op} ${c.value}${f.unit ? ` ${f.unit}` : ''}`;
}
export const ruleText = (rule) => rule.conditions.map(conditionText).join(' and ');

// "Age below 20 years" – a risk rule in words.
export function riskRuleText(r) {
  const f = FACTORS.risk[r.factor] ?? { label: r.factor, unit: '' };
  if (r.op) return `${f.label} ${OP_WORDS[r.op] ?? r.op} ${r.value}${f.unit ? ` ${f.unit}` : ''}`;
  return `${f.label}: ${r.condition ?? r.complication ?? r.finding ?? 'yes'}`;
}

const DRAFT_NOTE = 'DRAFT copied from Perinexa – prepared from published guidance, not reviewed by a doctor. Check every item before approving.';

// Every built-in entry, shaped as a library entry (without hospital or status).
function builtIns() {
  const entries = [];
  let order = 0;
  const add = (e) => entries.push({ order: (order += 10), ...e });

  for (const t of load('carePlans')) {
    add({ kind: 'care_plan', key: `cp_${t.careType}`, name: t.name, careTypes: [t.careType], about: [t.description, t.sources && `Sources: ${t.sources}`, DRAFT_NOTE].filter(Boolean).join('\n\n'), content: { items: t.items } });
  }
  add({
    kind: 'red_flag_rules',
    key: 'red_flags',
    name: 'Red-flag rules – DRAFT',
    careTypes: [],
    about: `Warnings worked out from values recorded for a patient. Decision support only: a flag is raised only from values actually recorded. ${DRAFT_NOTE}`,
    content: { rules: load('redFlagRules').map((r) => ({ ...r, text: ruleText(r), active: true })) },
  });
  add({
    kind: 'medicine_safety',
    key: 'medicine_safety',
    name: 'Medicine safety list – DRAFT',
    careTypes: [],
    about: `Medicines to avoid or use with caution in pregnancy, while breastfeeding and in newborns, and usual maximum doses. It warns while writing a prescription and never blocks saving – the doctor decides. ${DRAFT_NOTE}`,
    content: { entries: load('medicineSafety').map((e) => ({ ...e, active: true })) },
  });
  add({
    kind: 'risk_rules',
    key: 'risk_rules',
    name: 'Antenatal risk rules – DRAFT',
    careTypes: ['antenatal'],
    about: `The automatic risk level of a pregnancy: each rule raises the level to high or moderate. The doctor can always override it with a reason. ${DRAFT_NOTE}`,
    content: { rules: load('riskRules').map((r) => ({ ...r, text: riskRuleText(r), active: true })) },
  });
  for (const f of [...load('consentForms'), ...load('informationForms')]) {
    add({
      kind: f.kind === 'consent' ? 'consent_form' : 'information_form',
      key: f.key,
      name: f.title.en,
      careTypes: f.careTypes,
      about: f.description,
      content: { title: f.title, clauses: f.clauses, suggestWhen: f.suggestWhen ?? 'none' },
    });
  }
  for (const p of load('testPackages')) {
    add({
      kind: 'test_package',
      key: p.key,
      name: p.name,
      careTypes: p.who === 'newborn' ? ['newborn'] : [],
      about: [p.about, DRAFT_NOTE].filter(Boolean).join('\n\n'),
      content: { who: p.who, fromDay: p.fromDay ?? null, toDay: p.toDay ?? null, forWhom: p.forWhom ?? '', tests: p.tests },
    });
  }
  for (const s of load('prescriptionSets')) {
    add({
      kind: 'prescription_set',
      key: s.key,
      name: s.name,
      careTypes: s.careTypes,
      about: [s.about, DRAFT_NOTE].filter(Boolean).join('\n\n'),
      content: { items: s.items, notes: s.notes ?? '', investigations: s.investigations ?? '', advice: s.advice ?? '' },
    });
  }
  return entries;
}

export const BUILT_IN_ENTRIES = Object.freeze(builtIns());
