// Findings of a pregnancy loss (the Abortion type of care), recorded on the record as optional fields: the cervical
// os, products of conception, the scan (gestational sac, mean sac diameter, crown–rump length, heartbeat, adnexal
// mass, free fluid), signs of rupture, bleeding, fever with foul-smelling discharge (patients/abortionRules.js
// LOSS_FINDINGS).
//
// A finding is recorded or changed only by a person who may edit the clinical details of the record (the treating or
// an unassigned doctor, an RMO) – never by the software. Every value keeps who recorded it and when. A new value ends
// the entry before it; clearing a field ends its entry. Ended entries stay on the record (who ended them, and when) –
// nothing is deleted. Only pregnancy loss that was not brought on is recorded, and there is no field about the baby.
// The findings belong to ONE loss: when another loss is recorded on the same record (abortionRules.js anotherLoss),
// every finding of the earlier one is ended (endLossFindings) – the new loss starts with none.
//
// Pure – no database (only the hospital's time zone is read, for the day a finding was recorded).

import { addDays, toHospitalDate, utcDay } from '../careplans/dates.js';
import { LOSS_FINDINGS, LOSS_FINDING_KEYS, NOT_PREGNANT_NOW, SAME_LOSS_DAYS, lossFindingApplies, lossLocation } from './abortionRules.js';

/** How a finding was recorded: on the record itself (Edit details), or from a visit page. */
export const LOSS_FINDING_VIA = ['record', 'visit'];
/** Entries kept per record (values and their earlier values); the oldest ended ones go first. */
export const MAX_LOSS_FINDING_ENTRIES = 200;

const FINDING = new Map(LOSS_FINDINGS.map((f) => [f.key, f]));
const blank = (v) => v === undefined || v === null || v === '';
const sameValue = (a, b) => (blank(a) ? blank(b) : !blank(b) && String(a) === String(b));
const entriesOf = (abortion) => abortion?.findings ?? [];

// Positions (in abortion.findings) of the entries that count now: not ended, one per finding (the newest).
function currentIndexes(abortion) {
  const at = new Map();
  entriesOf(abortion).forEach((f, i) => {
    if (!f || f.endedAt || !FINDING.has(f.key) || blank(f.value)) return;
    at.set(f.key, i);
  });
  return at;
}

/** The values recorded now: { os: 'open', crlMm: 7.5 } – only the findings that have one. */
export function lossFindingValues(abortion) {
  const list = entriesOf(abortion);
  return Object.fromEntries([...currentIndexes(abortion)].map(([key, i]) => [key, list[i].value]));
}

/** The entries that count now, in the fixed order of LOSS_FINDINGS. */
export function currentLossFindings(abortion) {
  const at = currentIndexes(abortion);
  const list = entriesOf(abortion);
  return LOSS_FINDING_KEYS.filter((k) => at.has(k)).map((k) => list[at.get(k)]);
}

/**
 * Records the findings sent by a form (in memory; the caller saves). abortion: the record's pregnancy-loss section
 * (a database record or a plain object) – it must have its type of loss.
 *  - wanted: { key: value } as the form shows them now. A key that is not there is not touched; '' or null clears
 *    the finding. Values are taken as they are: the route checks them first (a choice of the list, a number in range).
 *  - seen: the values the form showed when it was opened. Then only what the person changed on the form is applied,
 *    so a finding a colleague recorded meanwhile – for example from a visit page – is never put back by saving an
 *    older form.
 *  - who: { by, byName, at, via, visitId }.
 * A finding that does not fit the type of loss (lossFindingApplies) is not recorded, and one on the record is ended:
 * what does not fit is dropped, as for the other fields of the section – but kept as an ended entry. One exception:
 * "Signs of rupture: yes" is a doctor's safety finding and is never ended by a change to something else (the scan, the
 * type of miscarriage) – it stays, and the form keeps showing it, until a person changes it. Only a record that is no
 * longer a pregnancy now (the recurrent-loss work-up) ends it with the rest.
 * Returns true if the record changed.
 */
export function setLossFindings(abortion, wanted, { by = null, byName, at, via = 'record', visitId = null }, { seen = null } = {}) {
  if (!abortion.findings) abortion.findings = [];
  const list = abortion.findings;
  let changed = false;
  const end = (index) => {
    list[index].endedAt = at;
    list[index].endedByName = byName;
    changed = true;
  };
  const record = (key, value) => {
    // Room for the new entry: the oldest ended entries go first (current ones are never dropped)
    while (list.length >= MAX_LOSS_FINDING_ENTRIES) {
      const oldest = list.findIndex((f) => f.endedAt);
      if (oldest < 0) break;
      list.splice(oldest, 1);
    }
    list.push({ key, value, by, byName, at, via, visitId, endedAt: null, endedByName: null });
    changed = true;
  };

  // (In the order of LOSS_FINDINGS: the products of conception and the gestational sac are settled before "signs of
  // rupture", which depends on them.)
  const fits = (key) => {
    const now = lossFindingValues(abortion);
    return lossFindingApplies(key, abortion.lossType ?? null, now.sacSeen ?? null, now.productsSeen ?? null);
  };
  // A recorded "signs of rupture: yes" while she is still cared for a pregnancy loss now: kept even where it no
  // longer fits (sending the same "Yes" again keeps it; a person clears it with '' or changes it)
  const pregnantNow = Boolean(abortion.lossType) && !NOT_PREGNANT_NOW.includes(abortion.lossType);
  const kept = (key, value) => pregnantNow && key === 'ruptureSigns' && value === 'yes';
  for (const key of LOSS_FINDING_KEYS) {
    if (!wanted || !(key in wanted) || wanted[key] === undefined) continue; // not sent: not touched
    if (seen && sameValue(wanted[key], seen[key])) continue; // not changed on the form
    const index = currentIndexes(abortion).get(key);
    const now = index === undefined ? null : list[index].value;
    // A value that does not fit is not recorded (except the same kept "Yes")
    const value = !blank(wanted[key]) && (fits(key) || (kept(key, wanted[key]) && sameValue(now, wanted[key]))) ? wanted[key] : null;
    if (sameValue(now, value)) continue;
    if (index !== undefined) end(index);
    if (!blank(value)) record(key, value);
  }
  // What no longer fits the type of loss (or the scan) is ended, with who made the change that ended it – except the
  // kept "signs of rupture: yes"
  for (const [key, index] of currentIndexes(abortion)) {
    if (fits(key) || kept(key, list[index].value)) continue;
    end(index);
  }
  return changed;
}

/**
 * Another loss is recorded on the same record: every finding that counts now belonged to the earlier loss, so each is
 * ended with the name of the person who recorded the new loss (kept as an earlier entry, never deleted). In memory;
 * the caller saves. Returns true if anything was ended.
 */
export function endLossFindings(abortion, { byName, at }) {
  let changed = false;
  for (const index of currentIndexes(abortion).values()) {
    abortion.findings[index].endedAt = at;
    abortion.findings[index].endedByName = byName;
    changed = true;
  }
  return changed;
}

/**
 * What the screens get: every entry without staff ids, oldest first, with `current` (the value that counts now).
 * An entry that is not current was replaced, cleared, no longer fits the type of loss, or belonged to an earlier loss.
 * on / endedOn: the hospital's date of `at` / `endedAt` (what the screens show – a finding recorded at 01:00 in India
 * is on that day, not on the day before as the UTC date would say).
 */
export function lossFindingsView(abortion) {
  const current = new Set(currentIndexes(abortion).values());
  return entriesOf(abortion).map((f, i) => ({
    key: f.key,
    value: f.value ?? null,
    byName: f.byName ?? null,
    at: f.at ?? null,
    on: f.at ? toHospitalDate(f.at) : null,
    via: f.via ?? 'record',
    endedAt: f.endedAt ?? null,
    endedOn: f.endedAt ? toHospitalDate(f.endedAt) : null,
    endedByName: f.endedByName ?? null,
    current: current.has(i),
  }));
}

// The findings the red-flag rules can check: [the rule's check, the finding].
export const RED_FLAG_LOSS_FINDINGS = [
  ['lossRuptureSigns', 'ruptureSigns'],
  ['lossBleeding', 'bleeding'],
  ['lossFeverDischarge', 'feverDischarge'],
];

// An operation for an ectopic pregnancy: once one is recorded with its day, the pregnancy can no longer rupture.
const OPERATIONS = ['laparoscopy', 'laparotomy'];
const operatedOn = (abortion) => (OPERATIONS.includes(abortion?.management?.method) && abortion.management.on ? utcDay(abortion.management.on) : null);
const locationOf = (abortion) => {
  const values = lossFindingValues(abortion);
  return lossLocation(abortion?.lossType ?? null, values.sacSeen ?? null, values.productsSeen ?? null);
};

/**
 * Where the pregnancy is TODAY, for the red flags of her record – DRAFT: 'ectopic' | 'unknown' | null
 * (abortionRules.js lossLocation), and null once it can no longer rupture: the outcome is "Treatment complete", or
 * an operation (laparoscopy, laparotomy) is recorded with a day up to today. A fast pulse after the operation is
 * then not read as a ruptured ectopic.
 */
export function lossLocationNow(abortion, today) {
  if (!abortion) return null;
  const location = locationOf(abortion);
  if (!location || abortion.management?.outcome === 'complete') return null;
  const operated = operatedOn(abortion);
  return operated && today && operated <= utcDay(today) ? null : location;
}

/**
 * Where the pregnancy was at a visit on `day`, for the red flags of that visit: as today (lossLocationNow, without
 * "Treatment complete", which has no day of its own), except null for a visit after the day of the operation, or one
 * from an earlier loss (more than SAME_LOSS_DAYS before the date seen – the location of this loss says nothing
 * about it).
 */
export function lossLocationOn(abortion, day) {
  if (!abortion || !day) return null;
  const location = locationOf(abortion);
  if (!location) return null;
  const on = utcDay(day);
  if (abortion.presentedOn && on < addDays(utcDay(abortion.presentedOn), -SAME_LOSS_DAYS)) return null;
  const operated = operatedOn(abortion);
  return operated && on > operated ? null : location;
}

/**
 * "Signs of rupture" recorded before the pregnancy was treated – on or before the day of an operation recorded with
 * its day (up to today), or any time once the outcome is "Treatment complete": what it warned of has been dealt with,
 * so it no longer raises "possible ruptured ectopic" (as the location no longer does – lossLocationNow). The tick
 * stays on her record until a person changes it; one recorded after the operation still raises the flag.
 */
function ruptureTreated(abortion, on, today) {
  if (abortion.management?.outcome === 'complete') return true;
  const operated = operatedOn(abortion);
  return Boolean(operated && today && operated <= utcDay(today) && on <= operated);
}

/**
 * What the red-flag rules read from a pregnancy-loss record (pure):
 *  - location: lossLocationNow() – where the pregnancy is today, while it can still rupture;
 *  - findings: { ruptureSigns | bleeding | feverDischarge: { value, on } } – the value recorded now and the
 *    hospital's day it was recorded. since: only findings recorded from that day on count ("this episode of care");
 *    null: every current one. "Signs of rupture" from before the treatment does not count (ruptureTreated).
 * null for a record with no pregnancy-loss section, and for one that is not a loss cared for now (the recurrent-loss
 * work-up: she is not pregnant, so none of the pregnancy-loss rules is about her).
 */
export function lossRedFlagFacts(abortion, { since = null, today = null } = {}) {
  if (!abortion || NOT_PREGNANT_NOW.includes(abortion.lossType)) return null;
  const findings = {};
  for (const f of currentLossFindings(abortion)) {
    if (!RED_FLAG_LOSS_FINDINGS.some(([, key]) => key === f.key) || !f.at) continue;
    const on = toHospitalDate(f.at);
    if (since && on < utcDay(since)) continue;
    if (f.key === 'ruptureSigns' && ruptureTreated(abortion, on, today)) continue;
    findings[f.key] = { value: f.value, on };
  }
  return { location: lossLocationNow(abortion, today), findings };
}
