// The clinic library (as in Perinexa's "Clinic library"): each hospital's own copy of care-plan templates, clinical
// rules (red flags, medicine safety, risk), consent and information forms, test packages and prescription sets.
// The built-in DRAFT content is copied in the first time the library is opened. Doctors, RMOs and nurses read it;
// doctors and RMOs edit; doctors approve (config.access.library*). Prescription sets are for prescribers only.
// Any change makes an entry a draft again until a doctor approves it.
import { randomBytes } from 'node:crypto';
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, parse, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { testByKey } from '../lab/labTests.js';
import { User } from '../users/user.model.js';
import { BUILT_IN_ENTRIES, LIBRARY_KINDS, kindOf, riskRuleText, ruleText } from './library.content.js';
import { LibraryEntry } from './libraryEntry.model.js';
import { CONTENT } from './library.validation.js';

const { access, prescriberRoles } = config;
const has = (req, list) => req.membership.roles.some((r) => list.includes(r));
const canEdit = (req) => has(req, access.libraryEdit);
const canApprove = (req) => has(req, access.libraryApprove);
const isPrescriber = (req) => has(req, prescriberRoles);
// The kinds this person may open.
const kindsFor = (req) => LIBRARY_KINDS.filter((k) => !k.prescribers || isPrescriber(req));

// ---------- The built-in copy ----------

// Copies the built-in DRAFT entries into a hospital's library: the first time, and any built-in entry added since.
export async function ensureLibrary(hospitalId) {
  const hid = toObjectId(hospitalId);
  const have = await LibraryEntry.countDocuments({ hospitalId: hid, origin: 'built_in' });
  if (have >= BUILT_IN_ENTRIES.length) return;
  const existing = new Set((await LibraryEntry.find({ hospitalId: hid, origin: 'built_in' }).select('kind key').lean()).map((e) => `${e.kind}:${e.key}`));
  const missing = BUILT_IN_ENTRIES.filter((e) => !existing.has(`${e.kind}:${e.key}`));
  if (!missing.length) return;
  try {
    await LibraryEntry.insertMany(missing.map((e) => ({ ...e, hospitalId: hid, origin: 'built_in', status: 'draft' })), { ordered: false });
  } catch (err) {
    // another request copied them at the same moment: the unique index kept one of each
    if (err?.code !== 11000 && !err?.writeErrors?.every((w) => w.code === 11000)) throw err;
  }
}

// ---------- Views ----------

function sizeOf(e) {
  const c = e.content ?? {};
  return c.items?.length ?? c.rules?.length ?? c.entries?.length ?? c.clauses?.length ?? c.tests?.length ?? 0;
}

const SIZE_WORDS = {
  care_plan: 'items',
  red_flag_rules: 'rules',
  risk_rules: 'rules',
  medicine_safety: 'entries',
  consent_form: 'clauses',
  information_form: 'clauses',
  test_package: 'tests',
  prescription_set: 'medicines',
};

const rowOf = (e, approverName) => ({
  id: String(e._id),
  kind: e.kind,
  key: e.key,
  origin: e.origin,
  name: e.name,
  careTypes: e.careTypes,
  status: e.status,
  isActive: e.isActive,
  version: e.version,
  size: sizeOf(e),
  sizeWord: SIZE_WORDS[e.kind],
  approved: e.approved?.at ? { at: e.approved.at, by: approverName ?? '' } : null,
  updatedAt: e.updatedAt,
});

export async function summary(req) {
  await ensureLibrary(req.hospitalId);
  const kinds = kindsFor(req).map((k) => k.key);
  const rows = await LibraryEntry.aggregate([
    { $match: { hospitalId: toObjectId(req.hospitalId), kind: { $in: kinds }, isActive: true } },
    { $group: { _id: '$kind', total: { $sum: 1 }, drafts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } } } },
  ]);
  const by = new Map(rows.map((r) => [r._id, r]));
  return {
    kinds: kindsFor(req).map((k) => ({ ...k, total: by.get(k.key)?.total ?? 0, drafts: by.get(k.key)?.drafts ?? 0 })),
    can: { edit: canEdit(req), approve: canApprove(req) },
  };
}

export async function list(req, q) {
  await ensureLibrary(req.hospitalId);
  const kinds = kindsFor(req).map((k) => k.key);
  if (q.kind && !kinds.includes(q.kind)) throw new HttpError(403, 'Prescription sets are for those who write prescriptions.', 'FORBIDDEN');
  const match = { hospitalId: toObjectId(req.hospitalId), kind: q.kind || { $in: kinds } };
  if (q.status) match.status = q.status;
  if (q.active) match.isActive = q.active === 'true';
  if (q.search) match.name = containsText(q.search);
  const result = await paginate(LibraryEntry, {
    match,
    sort: toSort(q.sort),
    page: q.page,
    limit: q.limit,
    pageStages: [
      { $lookup: { from: User.collection.name, localField: 'approved.by', foreignField: '_id', as: 'approver', pipeline: [{ $project: { name: 1 } }] } },
      { $set: { approverName: { $first: '$approver.name' } } },
      // only what the list needs (a form's text can be long)
      { $set: { size: { $size: { $ifNull: ['$content.items', { $ifNull: ['$content.rules', { $ifNull: ['$content.entries', { $ifNull: ['$content.clauses', { $ifNull: ['$content.tests', []] }] }] }] }] } } } },
      { $unset: ['content', 'approver'] },
    ],
  });
  result.items = result.items.map((e) => ({ ...rowOf(e, e.approverName), size: e.size }));
  return result;
}

async function load(req, id) {
  const entry = await LibraryEntry.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!entry) throw notFoundError('Library entry');
  if (kindOf(entry.kind).prescribers && !isPrescriber(req)) throw notFoundError('Library entry');
  return entry;
}

async function fullView(req, entry) {
  const ids = [entry.approved?.by, entry.updatedBy, entry.createdBy].filter(Boolean);
  const users = new Map((await User.find({ _id: { $in: ids } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const e = entry.toObject();
  const kind = kindOf(e.kind);
  return {
    entry: {
      ...rowOf(e, users.get(String(e.approved?.by))),
      about: e.about,
      content: e.content,
      updatedBy: users.get(String(e.updatedBy)) ?? null,
      // the approval is for an earlier version: a doctor changed it since
      approvedVersionOld: Boolean(e.approved && e.approved.version !== e.version),
    },
    kind,
    can: {
      edit: canEdit(req),
      approve: canApprove(req) && e.status === 'draft' && e.isActive,
      toggle: canEdit(req),
      duplicate: canEdit(req) && Boolean(kind.own),
    },
  };
}

export async function get(req, id) {
  return fullView(req, await load(req, id));
}

// ---------- Changes ----------

function assertCanEdit(req) {
  if (!canEdit(req)) throw new HttpError(403, 'Doctors and RMOs change the clinic library.', 'FORBIDDEN');
}

// The checked content of an entry, from what the browser sent. Rule sets merge the changes into the rules by key.
function checkedContent(kind, sent, current) {
  const parsed = parse(CONTENT[kind], sent);
  if (kind === 'red_flag_rules') {
    const byKey = new Map(parsed.rules.map((r) => [r.key, r]));
    return {
      rules: current.rules.map((r) => {
        const edit = byKey.get(r.key);
        if (!edit) return r;
        const conditions = r.conditions.map((c, i) => (c.value != null && edit.values[i] != null ? { ...c, value: edit.values[i] } : c));
        const rule = { ...r, label: edit.label, level: edit.level, message: edit.message, source: edit.source, active: edit.active, conditions };
        return { ...rule, text: ruleText(rule) };
      }),
    };
  }
  if (kind === 'risk_rules') {
    const byKey = new Map(parsed.rules.map((r) => [r.key, r]));
    return {
      rules: current.rules.map((r) => {
        const edit = byKey.get(r.key);
        if (!edit) return r;
        const rule = { ...r, label: edit.label, level: edit.level, source: edit.source, active: edit.active, ...(r.op && edit.value != null && { value: edit.value }) };
        return { ...rule, text: riskRuleText(rule) };
      }),
    };
  }
  if (kind === 'test_package') {
    const wrong = parsed.tests.find((t) => testByKey.get(t)?.who !== parsed.who);
    if (wrong) throw fieldError('content.tests', `${testByKey.get(wrong).name} is not a test for ${parsed.who === 'newborn' ? 'a baby' : 'an adult'}.`);
  }
  if (kind === 'care_plan' || kind === 'medicine_safety') {
    const list = parsed.items ?? parsed.entries;
    const keys = list.map((x) => x.key);
    if (new Set(keys).size !== keys.length) throw fieldError('content', 'Two entries have the same key.');
  }
  return parsed;
}

const newKey = () => `own_${randomBytes(4).toString('hex')}`;

export async function create(req, body) {
  assertCanEdit(req);
  const kind = kindOf(body.kind);
  if (!kind.own) throw new HttpError(400, `The hospital has one ${kind.singular.toLowerCase()} – change it instead.`, 'SINGLE');
  if (kind.prescribers && !isPrescriber(req)) throw new HttpError(403, 'Prescription sets are for those who write prescriptions.', 'FORBIDDEN');
  const count = await LibraryEntry.countDocuments({ hospitalId: req.hospitalId, kind: kind.key });
  if (count >= config.library.maxEntries) throw new HttpError(400, `At most ${config.library.maxEntries} entries of one kind.`, 'TOO_MANY');
  const entry = await LibraryEntry.create({
    hospitalId: req.hospitalId,
    kind: kind.key,
    key: newKey(),
    origin: 'hospital',
    name: body.name,
    careTypes: body.careTypes,
    about: body.about,
    content: checkedContent(kind.key, body.content, null),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await recordAudit(req, 'LIBRARY_CREATED', { hospitalId: req.hospitalId, details: { entryId: String(entry._id), kind: kind.key, name: entry.name } });
  return fullView(req, entry);
}

export async function update(req, id, body) {
  assertCanEdit(req);
  const entry = await load(req, id);
  const content = checkedContent(entry.kind, body.content, entry.content);
  const changed = ['name', 'careTypes', 'about'].filter((f) => JSON.stringify(entry[f]) !== JSON.stringify(body[f]));
  if (JSON.stringify(entry.content) !== JSON.stringify(content)) changed.push('content');
  if (!changed.length) return fullView(req, entry);
  entry.set({ name: body.name, careTypes: body.careTypes, about: body.about, content, status: 'draft', version: entry.version + 1, updatedBy: req.user._id });
  entry.markModified('content');
  await entry.save();
  await recordAudit(req, 'LIBRARY_UPDATED', { hospitalId: req.hospitalId, details: { entryId: id, kind: entry.kind, name: entry.name, changed } });
  return fullView(req, entry);
}

export async function approve(req, id) {
  if (!canApprove(req)) throw new HttpError(403, 'Only a doctor can approve clinic library entries.', 'FORBIDDEN');
  const entry = await load(req, id);
  if (!entry.isActive) throw new HttpError(409, 'Activate this entry before approving it.', 'INACTIVE');
  if (entry.status === 'approved') return fullView(req, entry);
  entry.set({ status: 'approved', approved: { by: req.user._id, at: new Date(), version: entry.version } });
  await entry.save();
  await recordAudit(req, 'LIBRARY_APPROVED', { hospitalId: req.hospitalId, details: { entryId: id, kind: entry.kind, name: entry.name, version: entry.version } });
  return fullView(req, entry);
}

export async function setActive(req, id, isActive) {
  assertCanEdit(req);
  const entry = await load(req, id);
  if (entry.isActive !== isActive) {
    entry.set({ isActive, updatedBy: req.user._id });
    await entry.save();
    await recordAudit(req, isActive ? 'LIBRARY_ACTIVATED' : 'LIBRARY_DEACTIVATED', { hospitalId: req.hospitalId, details: { entryId: id, kind: entry.kind, name: entry.name } });
  }
  return fullView(req, entry);
}

// A copy the hospital can change freely (a doctor's own version of a built-in form or plan), as a draft.
export async function duplicate(req, id) {
  const source = await load(req, id);
  if (!kindOf(source.kind).own) throw new HttpError(400, 'This entry cannot be copied.', 'SINGLE');
  return create(req, { kind: source.kind, name: `Copy of ${source.name}`.slice(0, 200), careTypes: source.careTypes, about: source.about, content: source.content });
}

// ---------- For other modules ----------

// The active test packages, for the lab's order form (approved or not – a draft package says so).
export async function testPackageOptions(hospitalId) {
  await ensureLibrary(hospitalId);
  const rows = await LibraryEntry.find({ hospitalId, kind: 'test_package', isActive: true }).sort({ order: 1, name: 1 }).lean();
  return rows.map((p) => ({ key: p.key, name: p.name, status: p.status, who: p.content.who, forWhom: p.content.forWhom, tests: p.content.tests }));
}

// The APPROVED entries in use of one kind – what other modules may apply to patients (drafts never are).
export async function approvedEntries(hospitalId, kind) {
  await ensureLibrary(hospitalId);
  return LibraryEntry.find({ hospitalId, kind, status: 'approved', isActive: true }).sort({ order: 1, name: 1 }).lean();
}
