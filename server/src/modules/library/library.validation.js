// What the browser may send for the clinic library. Each kind of entry has its own content shape. The rule sets
// (red flags, risk rules) are edited rule by rule: names, levels, wording, thresholds and on/off – the conditions
// themselves stay as they are (library.service.js merges the changes by rule key).
import { z } from 'zod';
import { CARE_TYPE_KEYS } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { objectId } from '../../core/validate.js';
import { LAB_TESTS } from '../lab/labTests.js';
import { CARE_PLAN_ITEM_KINDS, DOSE_UNITS, KIND_KEYS, MED_SAFETY_KINDS, MED_SAFETY_LEVELS, RED_FLAG_LEVELS, RISK_LEVELS } from './library.content.js';

const text = (max) => z.string().trim().max(max, 'This is too long').default('');
// weeks of pregnancy, or after the start of care (a child's vaccines run to about 16 years)
const week = z.number().int().min(0).max(1040).nullable().default(null);
const dayNum = z.number().int().min(0).max(3660).nullable().default(null);
const key = z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/i, 'Letters, numbers and _ only');

export const libraryListQuery = listQuery({
  sortFields: ['order', 'name', 'updatedAt'],
  defaultSort: 'order',
  extra: {
    kind: z.enum(['', ...KIND_KEYS]).default(''),
    status: z.enum(['', 'draft', 'approved']).default(''),
    active: z.enum(['', 'true', 'false']).default(''),
  },
});

export const idParams = z.object({ id: objectId });
export const statusBody = z.object({ isActive: z.boolean('isActive must be true or false') });

const careItem = z.object({
  key,
  kind: z.enum(CARE_PLAN_ITEM_KINDS),
  name: z.string().trim().min(2, 'Name the item').max(200),
  patientText: text(300),
  atBooking: z.boolean().default(false),
  fromWeek: week,
  toWeek: week,
  after: z.object({ key, weeks: z.number().int().min(0).max(1040) }).nullable().default(null),
  appliesWhen: z.string().trim().max(60).default(''),
  source: text(1000),
});

const redFlagEdit = z.object({
  key,
  label: z.string().trim().min(2).max(150),
  level: z.enum(RED_FLAG_LEVELS),
  message: text(1000),
  source: text(1000),
  active: z.boolean(),
  // the thresholds of the rule's conditions, in order (null for a condition without a number)
  values: z.array(z.number().nullable()).max(10).default([]),
});

const riskEdit = z.object({
  key,
  label: z.string().trim().min(2).max(200),
  level: z.enum(RISK_LEVELS),
  value: z.number().nullable().default(null),
  source: text(1000),
  active: z.boolean(),
});

const terms = z.array(z.string().trim().toLowerCase().min(2).max(60)).max(30).default([]);
const medEntry = z.object({
  key,
  kind: z.enum(MED_SAFETY_KINDS),
  label: z.string().trim().min(2).max(150),
  terms: terms.refine((t) => t.length > 0, 'Give at least one name to look for'),
  otherTerms: terms,
  level: z.enum(MED_SAFETY_LEVELS),
  message: text(1000),
  source: text(500),
  fromWeek: week,
  toWeek: week,
  maxAgeDays: dayNum,
  doseUnit: z.enum(DOSE_UNITS).default(''),
  maxSingle: z.number().positive().nullable().default(null),
  maxDaily: z.number().positive().nullable().default(null),
  perKg: z.boolean().default(false),
  active: z.boolean().default(true),
});

const words = z.object({ en: z.string().trim().max(3000).default(''), mr: z.string().trim().max(3000).default(''), hi: z.string().trim().max(3000).default('') });
const formContent = z.object({
  title: words.refine((t) => t.en.length >= 2, { path: ['en'], message: 'Give the title in English' }),
  clauses: z.array(words.refine((c) => c.en.length > 0, { path: ['en'], message: 'Every clause needs its English wording' })).min(1, 'Add at least one clause').max(80),
  suggestWhen: z.string().trim().max(40).default('none'),
});

const labKeys = LAB_TESTS.map((t) => t.key);
const rxItem = z.object({
  drug: z.string().trim().min(2, 'Name the medicine').max(120),
  form: text(20),
  strength: text(40),
  dose: text(40),
  frequency: text(40),
  frequencyText: text(80),
  timing: text(30),
  route: text(30),
  durationValue: z.number().int().min(1).max(999).nullable().default(null),
  durationUnit: text(20),
  instructions: text(200),
});

export const CONTENT = {
  care_plan: z.object({ items: z.array(careItem).max(200) }),
  red_flag_rules: z.object({ rules: z.array(redFlagEdit).max(300) }),
  risk_rules: z.object({ rules: z.array(riskEdit).max(200) }),
  medicine_safety: z.object({ entries: z.array(medEntry).max(300) }),
  consent_form: formContent,
  information_form: formContent,
  test_package: z
    .object({
      who: z.enum(['adult', 'newborn']),
      fromDay: dayNum,
      toDay: dayNum,
      forWhom: text(300),
      tests: z.array(z.enum(labKeys)).min(1, 'Choose at least one test').max(30),
    })
    .refine((p) => p.fromDay == null || p.toDay == null || p.fromDay <= p.toDay, { path: ['toDay'], message: 'The last day must be on or after the first' }),
  prescription_set: z.object({ items: z.array(rxItem).min(1, 'Add at least one medicine').max(20), notes: text(1000), investigations: text(1000), advice: text(2000) }),
};

export const entryBody = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  careTypes: z.array(z.enum(CARE_TYPE_KEYS)).max(CARE_TYPE_KEYS.length).default([]),
  about: text(5000),
  content: z.unknown(),
});

export const createBody = entryBody.extend({ kind: z.enum(KIND_KEYS) });
