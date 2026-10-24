import { useEffect, useRef, useState } from 'react';
import { Info, Mic } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Avatar, Field, FieldError, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dictatedFields, isInfoPath, keepForLater, mergeDictated, newFillMemory, noteHandEdit, noteTick, planFill, splitFound } from './dictation.js';
import {
  BLOOD_GROUPS,
  BREASTFEEDING_LABELS,
  CARE_TYPE_HINTS,
  CARE_TYPE_LABELS,
  CARE_TYPES,
  CONDITION_LABELS,
  FEEDING_AT_DISCHARGE_LABELS,
  NEWBORN_SEX_LABELS,
  NICU_ADMITTED_LABELS,
  NO_KNOWN_ALLERGIES,
  PAST_COMPLICATION_LABELS,
  PREGNANCY_FINDING_HINTS,
  PREGNANCY_FINDING_LABELS,
  currentFindings,
  eddFromLmp,
  formatGestation,
  gestationFromEdd,
  allergyStatus,
  isFirstPregnancy,
  isNoKnownAllergies,
  toDateInput,
  toDateTimeInput,
  datesWarning,
} from './patientFormat.js';
import { DictateButton, VoiceBar, VoiceEntry, useVoiceOpen } from './VoiceEntry.jsx';
import { AadhaarQrFill } from './AadhaarQrFill.jsx';
import { AbortionSection, abortionEmpty, abortionFindingErrors, abortionPayload, abortionTextErrors, abortionValues, localToday } from './AbortionSection.jsx';
import { THREATENED_HINT, currentLossFindings, lmpCarryOver, lossRulesOn, obstetricHint, presentationWeeks } from './abortionFormat.js';
import { mentionsFetalSex, PCPNDT_MESSAGE } from '../../pcpndtWords.js';
import { DELIVERY_MODE_LABELS } from '../inpatient/inpatientFormat.js';
import { asName } from '../../personName.js';
import { lookupPin } from './pinLookup.js';
import { DEPARTMENTS } from '../../platform/departments.js';
import { FertilitySection } from './FertilitySection.jsx';
import { fertilityNumberErrors, fertilityPayload, fertilityValues } from './fertilityFormat.js';

const str = (v) => (v == null ? '' : String(v));

// The ID proofs reception may note (same keys as server/src/models/Patient.js ID_PROOF_TYPES).
export const ID_PROOF_OPTIONS = [
  ['aadhaar', 'Aadhaar'],
  ['voter_id', 'Voter ID'],
  ['pan', 'PAN card'],
  ['driving_licence', 'Driving licence'],
  ['passport', 'Passport'],
  ['ration_card', 'Ration card'],
  ['other', 'Other'],
];

// Who pays (same keys as server/src/models/Patient.js PAYER_TYPES), and what the payer's name is called
export const PAYER_OPTIONS = [
  ['self', 'She pays herself'],
  ['insurance', 'Insurance or TPA'],
  ['govt_scheme', 'Government scheme (e.g. PM-JAY, JSY)'],
  ['corporate', 'Employer (corporate)'],
];
export const PAYER_NAME_LABELS = { insurance: 'Insurer or TPA', govt_scheme: 'Scheme', corporate: 'Employer' };
// Suggested in the State box (any other spelling can still be typed)
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

// Form values are kept as text (what the inputs show) and converted when saving.
function initialValues(p) {
  return {
    careType: p?.careType ?? '',
    fullName: p?.fullName ?? '',
    ageYears: str(p?.currentAge ?? p?.ageYears),
    phone: p?.phone ?? '',
    address: p?.address ?? '',
    pinCode: p?.pinCode ?? '',
    city: p?.city ?? '',
    state: p?.state ?? '',
    referredBy: p?.referredBy ?? '',
    payer: { type: p?.payer?.type ?? '', name: p?.payer?.name ?? '', number: p?.payer?.number ?? '' },
    emergencyContact: { name: p?.emergencyContact?.name ?? '', relation: p?.emergencyContact?.relation ?? '', phone: p?.emergencyContact?.phone ?? '' },
    idProof: { kind: p?.idProof?.kind ?? '', last4: p?.idProof?.last4 ?? '' },
    assignedDoctor: p?.assignedDoctor ?? '',
    // findings: ticked for this pregnancy. findingsSeen: the list as this form opened (sent with the changes, so a
    // finding a colleague ticks meanwhile is not unticked by saving this form).
    pregnancy: {
      lmp: toDateInput(p?.pregnancy?.lmp),
      scanEdd: toDateInput(p?.pregnancy?.scanEdd),
      findings: currentFindings(p).map((f) => f.key),
      findingsSeen: currentFindings(p).map((f) => f.key),
    },
    abortion: abortionValues(p?.abortion),
    // The fertility history (Infertility type of care): every field may stay empty
    fertility: fertilityValues(p?.fertility),
    obstetric: {
      gravida: str(p?.obstetric?.gravida),
      para: str(p?.obstetric?.para),
      living: str(p?.obstetric?.living),
      abortions: str(p?.obstetric?.abortions),
      previousCaesareans: str(p?.obstetric?.previousCaesareans),
      pastComplications: p?.obstetric?.pastComplications ?? [],
      complicationsReviewed: p?.obstetric?.complicationsReviewed ?? false,
    },
    medical: {
      bloodGroup: p?.medical?.bloodGroup ?? '',
      heightCm: str(p?.medical?.heightCm),
      weightKg: str(p?.medical?.weightKg),
      allergies: p?.medical?.allergies ?? '',
      conditions: p?.medical?.conditions ?? [],
      conditionsReviewed: p?.medical?.conditionsReviewed ?? false,
      otherConditions: p?.medical?.otherConditions ?? '',
    },
    newborn: {
      birthAt: toDateTimeInput(p?.newborn?.birthAt),
      birthWeightGrams: str(p?.newborn?.birthWeightGrams),
      sex: p?.newborn?.sex ?? '',
      mother: p?.newborn?.mother ?? '',
      fatherName: p?.newborn?.fatherName ?? '',
    },
    notes: p?.notes ?? '',
    // A delivery at another hospital (postnatal); locked when it comes from a delivery note confirmed here.
    delivery: {
      on: toDateInput(p?.lastDelivery?.at),
      mode: p?.lastDelivery?.mode ?? '',
      locked: Boolean(p?.lastDelivery?.documentId),
    },
    // After delivery (postnatal): whether she is breastfeeding – '' = not recorded
    postnatal: { breastfeeding: p?.postnatal?.breastfeeding ?? '' },
    // A baby's care after birth: the NICU or SNCU stay and feeding at discharge – '' = not recorded
    newbornCare: {
      admitted: p?.newbornCare?.nicu?.admitted ?? '',
      from: toDateInput(p?.newbornCare?.nicu?.from),
      to: toDateInput(p?.newbornCare?.nicu?.to),
      feedingAtDischarge: p?.newbornCare?.feedingAtDischarge ?? '',
    },
  };
}

/** The baby's care after birth as the server takes it (the dates of a stay only with "admitted: yes"). */
export function newbornCarePayload(c) {
  const yes = c.admitted === 'yes';
  return { nicu: { admitted: c.admitted, from: yes ? c.from || null : null, to: yes ? c.to || null : null }, feedingAtDischarge: c.feedingAtDischarge };
}

// Only the part of the form that is shown is saved (see `part` on PatientForm). `loaded`: the values the form started
// with – breastfeeding is sent only when it was changed here, so a form left open (the prescription links to this page
// in a second tab) never puts an older answer back over a newer one.
export function toPayload(v, isEdit, access, part, loaded = null) {
  const isNewborn = v.careType === 'newborn';
  const payload = {};
  if (part !== 'clinical') {
    Object.assign(payload, {
      careType: v.careType,
      fullName: v.fullName,
      phone: v.phone,
      address: v.address,
      pinCode: v.pinCode,
      city: v.city,
      state: v.state,
      referredBy: v.referredBy,
      // the insurer and number only when someone other than she pays
      payer: v.payer && (v.payer.type && v.payer.type !== 'self' ? v.payer : { type: v.payer.type, name: '', number: '' }),
    });
    for (const k of ['pinCode', 'city', 'state', 'referredBy', 'payer']) if (payload[k] === undefined) delete payload[k];
    if (!isNewborn) Object.assign(payload, { ageYears: v.ageYears, emergencyContact: v.emergencyContact, idProof: v.idProof });
    if (isNewborn && access.canEditNewborn) payload.newborn = { ...v.newborn, birthAt: v.newborn.birthAt ? new Date(v.newborn.birthAt).toISOString() : '' };
    if (!access.canEditIdentity) {
      for (const k of ['careType', 'fullName', 'phone', 'address', 'pinCode', 'city', 'state', 'referredBy', 'payer', 'ageYears', 'emergencyContact', 'idProof']) delete payload[k];
    }
    if (!isEdit) payload.assignedDoctor = v.assignedDoctor;
  }
  if (part !== 'info' && access.canEditClinical) {
    if (!isNewborn) {
      // First pregnancy: there are no previous pregnancies, so clear anything ticked before G was set to 1.
      payload.obstetric = isFirstPregnancy(v.careType, v.obstetric) ? { ...v.obstetric, pastComplications: [], complicationsReviewed: false } : v.obstetric;
      payload.medical = v.medical;
      // Pregnancy dates only for a current pregnancy; the pregnancy-loss section only for the Abortion type of care
      // (sent as a whole once anything is entered in it).
      if (v.careType === 'antenatal') payload.pregnancy = v.pregnancy;
      if (v.careType === 'abortion' && !abortionEmpty(v.abortion)) payload.abortion = abortionPayload(v.abortion);
      // The fertility history only for the Infertility type of care (the server merges it field by field)
      if (v.careType === 'infertility') payload.fertility = fertilityPayload(v.fertility);
    } else {
      payload.medical = { bloodGroup: v.medical.bloodGroup };
    }
    payload.notes = v.notes;
    if (isEdit && v.careType === 'postnatal' && !v.delivery.locked && (v.delivery.on || v.delivery.mode)) {
      payload.delivery = { on: v.delivery.on, mode: v.delivery.mode };
    }
    if (isEdit && v.careType === 'postnatal' && v.postnatal.breastfeeding !== (loaded?.postnatal?.breastfeeding ?? '')) {
      payload.postnatal = { breastfeeding: v.postnatal.breastfeeding };
    }
    // A baby's care after birth: sent only when it was changed here (as breastfeeding above)
    if (isEdit && isNewborn && loaded && JSON.stringify(newbornCarePayload(v.newbornCare)) !== JSON.stringify(newbornCarePayload(loaded.newbornCare))) {
      payload.newbornCare = newbornCarePayload(v.newbornCare);
    }
  }
  return payload;
}

// The record's free text in a pregnancy (antenatal or abortion care) must not mention the baby's sex – only text that
// changed is checked, as on the server (infertility and gynaecology notes may say "male factor").
function fetalSexErrors(type, v, stored) {
  if (type !== 'antenatal' && type !== 'abortion') return {};
  const out = {};
  const texts = [
    ['notes', v.notes, stored?.notes],
    ['medical.allergies', v.medical.allergies, stored?.medical?.allergies],
    ['medical.otherConditions', v.medical.otherConditions, stored?.medical?.otherConditions],
  ];
  for (const [path, text, before] of texts) if (text !== (before ?? '') && mentionsFetalSex(text)) out[path] = PCPNDT_MESSAGE;
  return type === 'abortion' ? { ...out, ...abortionTextErrors(v.abortion) } : out;
}

// Examples of what to say (fake sample details): [patient information only, with clinical details, clinical page]
const SAY = {
  antenatal: [
    '"Asha Sample, age 28, phone 98765 43210, address 12 MG Road, Pune"',
    '"Asha Sample, age 28, phone 98765 43210, LMP 12 July 2026, G2 P1 L1 A0, blood group O positive, allergic to penicillin"',
    '"LMP 12 July 2026, G2 P1 L1 A0, one previous caesarean, blood group O positive, height 158 cm, weight 60 kg, no known conditions, allergic to penicillin"',
  ],
  abortion: [
    '"Asha Sample, age 28, phone 98765 43210, address 12 MG Road, Pune"',
    '"Asha Sample, age 28, phone 98765 43210, LMP 2 August 2026, missed miscarriage, G2 P1 L1 A0, blood group O negative, no allergies"',
    '"LMP 2 August 2026, missed miscarriage, G2 P1 L1 A0, blood group O negative, no allergies"',
  ],
  other: [
    '"Asha Sample, age 28, phone 98765 43210, address 12 MG Road, Pune"',
    '"Asha Sample, age 28, phone 98765 43210, G2 P2 L2 A0, blood group O positive, diabetic, no allergies"',
    '"G2 P2 L2 A0, blood group O positive, height 158 cm, weight 60 kg, diabetic, no allergies"',
  ],
  newborn: [
    '"Baby of Asha Sample, born today at 9:15 am, birth weight 3.1 kg, baby girl"',
    '"Baby of Asha Sample, born today at 9:15 am, birth weight 3.1 kg, baby girl, blood group B positive"',
    '"Blood group B positive"',
  ],
};
const voiceExample = (part, type, clinical) => (SAY[type] ?? SAY.other)[part === 'clinical' ? 2 : clinical ? 1 : 0];

// "From voice – check": under a field filled from what was said, until the field is changed.
function VoiceMark() {
  return (
    <span className="voice-mark">
      <Mic aria-hidden="true" /> From voice – check
    </span>
  );
}

// Finds the mother among this hospital's (non-newborn) patients. `initial` is the linked mother ({ fullName, mrn }) when editing.
// `suggest` (a name said in voice entry) starts the search; the person still picks the right patient.
function MotherPicker({ value, initial, onChange, error, suggest }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(initial ?? null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (suggest) setSearch(suggest);
  }, [suggest]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api('/patients', { query: { search: search.trim(), limit: 8 } })
        .then((res) => setResults(res.patients.filter((p) => p.careType !== 'newborn')))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  if (value) {
    return (
      <div className={`field ${error ? 'has-error' : ''}`}>
        <span className="field-label">Mother</span>
        <div className="picked">
          {picked ? (
            <span className="name-cell">
              <Avatar name={picked.fullName} seed={value} />
              <span className="name-cell-text">
                <strong>{picked.fullName}</strong>
                <span className="muted tabular">{picked.mrn}</span>
              </span>
            </span>
          ) : (
            <span>Selected</span>
          )}
          <button type="button" className="btn btn-link" onClick={() => onChange('', '')}>
            Change
          </button>
        </div>
        <FieldError>{error}</FieldError>
      </div>
    );
  }
  return (
    <Field label="Mother (search by name, phone or patient number)" id="mother-search" error={error}>
      <input id="mother-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 letters…" autoComplete="off" />
      {results.length > 0 && (
        <ul className="pick-list">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked({ fullName: p.fullName, mrn: p.mrn });
                  onChange(p.id, `${p.fullName} (${p.mrn})`, p.fullName);
                  setSearch('');
                }}
              >
                <span className="name-cell">
                  <Avatar name={p.fullName} seed={p.id} />
                  <span className="name-cell-text">
                    <strong>{p.fullName}</strong>
                    <span className="muted tabular">
                      {p.mrn} · {p.phone || 'no phone'}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

/**
 * Registration / edit form for an OBGY patient. Shows only the sections that apply to the type of care.
 * - patient: existing patient when editing
 * - careType: registering – the type of care chosen from the "New patient" menu
 * - onCareTypeChange(type): registering – another type of care chosen on the form (a wrong menu choice corrected,
 *   owner 27 Oct 2026); what was typed stays
 * - part: what the form shows and saves – 'info' (patient and birth details), 'clinical' (pregnancy, history,
 *   medical background, notes) or 'all' (both, with the type of care, for editing a record)
 * - onSubmit(payload): saves; should throw an ApiError on failure
 * - access: what this person may fill in ({ canEditIdentity, canEditNewborn, canEditClinical })
 * - clinicalStep(values): registration only – true when saving leads on to the clinical-details page
 *   (the button then reads "Save and continue"), false when someone else adds them
 * - cancelTo, cancelLabel: the secondary link (optional)
 * - voice: show voice entry – beside the form on a wide screen (it stays in view while the form scrolls), above it
 *   on a narrow one
 * - dictated: details said on the previous page ({ values, paths, found }), filled in and marked "From voice"
 * - spoken: what was said on the New patient chooser, read into the form when it opens (voice entry open)
 * - onDictatedClinical(details | null): registration – clinical details said on this page, for the next page
 * - beforeActions: shown above the Save buttons (registration: the service charges, owner 27 Oct 2026)
 * - anotherLabel: registration without a clinical page – a second button ("Save and register another"); onSubmit
 *   then gets { another: true } as its second argument when it was pressed
 */
export function PatientForm({
  patient,
  careType,
  onCareTypeChange,
  part = 'all',
  onSubmit,
  submitLabel = 'Save',
  access,
  clinicalStep,
  cancelTo,
  cancelLabel = 'Cancel',
  voice = false,
  dictated,
  spoken = '',
  onDictatedClinical,
  prefill = null, // a new patient's details already known (a quick booking: name, phone, doctor)
  anotherLabel = null,
  beforeActions = null,
}) {
  const another = useRef(false); // which save button was pressed
  const isEdit = Boolean(patient);
  const showInfo = part !== 'clinical';
  const showClinical = part !== 'info';
  const [v, setV] = useState(() => (dictated ? mergeDictated(initialValues(patient ?? prefill), dictated.values, dictated.paths) : initialValues(patient ?? prefill)));
  // The record as it was when this form was opened (see toPayload)
  const [loaded] = useState(() => initialValues(patient ?? prefill));
  const [fromVoice, setFromVoice] = useState(() => new Set(dictated ? dictatedFields(dictated.values, dictated.paths) : []));
  const [motherSuggestion, setMotherSuggestion] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false); // voice entry is recording: saving waits for Stop
  const [voiceStatus, setVoiceStatus] = useState(null); // the recording's status, for the bar above Save
  const [lmpCopied, setLmpCopied] = useState(''); // the LMP copied from the pregnancy loss (to be checked), or ''
  const voiceControl = useRef(null);
  const [voiceOpen, setVoiceOpen] = useVoiceOpen(Boolean(dictated) || Boolean(spoken));
  // A new reading of what was said never undoes the person's own work (plan 1.7), on this form only: fields changed by
  // hand, ticks taken off, notes already added, answers (see newFillMemory in dictation.js)
  const memory = useRef(null);
  if (!memory.current) memory.current = newFillMemory(dictated);
  const doctors = useFetch(isEdit ? null : '/tenant/doctors');
  const allDoctors = doctors.data?.doctors ?? [];
  // Only the departments that have a doctor (all in the list's order)
  const departments = DEPARTMENTS.filter((d) => allDoctors.some((x) => x.department === d));

  // Another page (or another type of care from the New patient menu): the recording stops, so the microphone
  // never stays on for a page that is no longer being filled in.
  const { pathname } = useLocation();
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    voiceControl.current?.stop();
  }, [pathname]);

  // A doctor registering a patient is suggested as the assigned doctor – once, when the list arrives,
  // so that choosing "Not assigned yet" afterwards sticks.
  useEffect(() => {
    const me = doctors.data?.me;
    if (!isEdit && me) setV((cur) => (cur.assignedDoctor ? cur : { ...cur, assignedDoctor: me }));
  }, [doctors.data, isEdit]);

  // A field changed by hand has been checked: its "From voice" mark goes, and voice never changes it again.
  const unmark = (...paths) => {
    noteHandEdit(memory.current, paths);
    setFromVoice((cur) => {
      if (!paths.some((p) => cur.has(p))) return cur;
      const next = new Set(cur);
      paths.forEach((p) => next.delete(p));
      return next;
    });
  };
  const voiced = (path) => fromVoice.has(path);
  const vc = (path) => (voiced(path) ? 'voice-filled' : undefined);
  const vm = (path) => (voiced(path) ? <VoiceMark /> : null);

  // From the Aadhaar QR (AadhaarQrFill.jsx): only what the card holds replaces what is in the form
  const fillFromAadhaar = (a) =>
    setV((cur) => {
      const out = { ...cur };
      for (const k of ['fullName', 'ageYears', 'address', 'pinCode', 'city', 'state']) if (a[k]) out[k] = a[k];
      if (a.last4) out.idProof = { kind: 'aadhaar', last4: a.last4 };
      // The card's "W/O …" (husband) or "D/O …" (father) as her contact person – only into an empty contact
      if (a.contactName && !cur.emergencyContact.name.trim()) out.emergencyContact = { ...cur.emergencyContact, name: a.contactName, relation: cur.emergencyContact.relation || a.contactRelation };
      return out;
    });
  const set = (key) => (e) => {
    unmark(key);
    setV({ ...v, [key]: e.target.value });
  };
  // A change of the type of care between Antenatal and Abortion may carry the LMP over, into an empty field only
  // (lmpCarryOver): Antenatal → Abortion (the same pregnancy), and back only for an old threatened miscarriage. Judged
  // from the stored type, so passing through another type first changes nothing. An LMP copied into the pregnancy
  // says so under the field until it is changed by hand or the type changes again.
  const setCareType = (e) => {
    const next = e.target.value;
    unmark('careType');
    const out = { ...v, careType: next };
    const carry = lmpCarryOver({ from: patient?.careType ?? v.careType, to: next, pregnancyLmp: v.pregnancy.lmp, abortion: v.abortion });
    if (carry.abortionLmp) out.abortion = { ...v.abortion, lmp: carry.abortionLmp };
    if (carry.pregnancyLmp) out.pregnancy = { ...v.pregnancy, lmp: carry.pregnancyLmp };
    setLmpCopied(carry.pregnancyLmp ?? '');
    setV(out);
  };
  // PIN code → city and state (owner, 27 Oct 2026): filled when empty, or when they still hold what an earlier PIN
  // filled in – never over what was typed by hand.
  const pinFilled = useRef({ city: '', state: '' });
  // Registration: the department first, then only its doctors (owner, 27 Oct 2026) – a filter, not saved on the record
  const [department, setDepartment] = useState('');
  const setPinCode = (e) => {
    const pin = e.target.value.replace(/\D/g, '').slice(0, 6);
    unmark('pinCode');
    setV((cur) => ({ ...cur, pinCode: pin }));
    if (pin.length !== 6) return;
    lookupPin(pin).then((place) => {
      if (!place) return;
      setV((cur) => {
        if (cur.pinCode !== pin) return cur; // changed again meanwhile
        const free = (key) => !cur[key].trim() || cur[key] === pinFilled.current[key];
        const next = { ...cur, city: free('city') ? place.city : cur.city, state: free('state') ? place.state : cur.state };
        pinFilled.current = { city: next.city === place.city ? place.city : pinFilled.current.city, state: next.state === place.state ? place.state : pinFilled.current.state };
        return next;
      });
    });
  };
  const setFertility = (key, value) => {
    unmark(`fertility.${key}`);
    setV((cur) => ({ ...cur, fertility: { ...cur.fertility, [key]: value } }));
  };
  const setAbortion = (key, value) => {
    unmark(`abortion.${key}`);
    setV((cur) => ({ ...cur, abortion: { ...cur.abortion, [key]: value } }));
  };
  const setIn = (section, key) => (e) => {
    unmark(`${section}.${key}`);
    setV({ ...v, [section]: { ...v[section], [key]: e.target.value } });
  };
  const toggleCondition = (c) => {
    noteTick(memory.current, `medical.conditions.${c}`, v.medical.conditions.includes(c));
    unmark(`medical.conditions.${c}`, 'medical.conditionsReviewed');
    const conditions = v.medical.conditions.includes(c) ? v.medical.conditions.filter((x) => x !== c) : [...v.medical.conditions, c];
    setV({ ...v, medical: { ...v.medical, conditions, conditionsReviewed: conditions.length ? false : v.medical.conditionsReviewed } });
  };
  // A finding in this pregnancy, ticked or unticked by hand (voice entry ticks one when it is said, 16 Oct 2026; one
  // unticked by hand is not ticked again by the next recording)
  const toggleFinding = (k) => {
    noteTick(memory.current, `pregnancy.findings.${k}`, v.pregnancy.findings.includes(k));
    unmark(`pregnancy.findings.${k}`);
    const list = v.pregnancy.findings;
    setV({ ...v, pregnancy: { ...v.pregnancy, findings: list.includes(k) ? list.filter((x) => x !== k) : [...list, k] } });
  };
  const toggleComplication = (c) => {
    noteTick(memory.current, `obstetric.pastComplications.${c}`, v.obstetric.pastComplications.includes(c));
    unmark(`obstetric.pastComplications.${c}`, 'obstetric.complicationsReviewed');
    const list = v.obstetric.pastComplications;
    const pastComplications = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
    setV({ ...v, obstetric: { ...v.obstetric, pastComplications, complicationsReviewed: pastComplications.length ? false : v.obstetric.complicationsReviewed } });
  };

  const type = isEdit ? v.careType : (careType ?? v.careType);
  const isNewborn = type === 'newborn';
  const clinical = access.canEditClinical;
  const firstPregnancy = isFirstPregnancy(type, v.obstetric);
  const fe = (path) => fieldErrors[path];
  const showMedical = showClinical && !isNewborn && clinical;
  const noAllergies = isNoKnownAllergies(v.medical.allergies);
  const setNoAllergies = (e) => {
    unmark('medical.allergies');
    setV({ ...v, medical: { ...v.medical, allergies: e.target.checked ? NO_KNOWN_ALLERGIES : '' } });
  };

  const lmpEdd = eddFromLmp(v.pregnancy.lmp);
  const effectiveEdd = v.pregnancy.scanEdd ? new Date(`${v.pregnancy.scanEdd}T00:00:00Z`) : lmpEdd;
  const ga = gestationFromEdd(effectiveEdd);

  // Voice entry: what this page shows (and this person may enter) is filled in now; on the first page, clinical
  // details wait for the next one (kept in the fill memory: the latest reading plus the answers to questions about them).
  useEffect(() => {
    memory.current.later = null; // another type of care chosen from the menu
    memory.current.laterAnswers = null;
  }, [type]);
  // `reading`: the whole text was read (again) – what the person did by hand is left alone (planFill). Otherwise it is
  // an answer to a question: the person chose it, so it is used even over a change by hand.
  const fillIn = (result, { reading }) => {
    const infoPaths = result.paths.filter(isInfoPath);
    const clinicalPaths = result.paths.filter((p) => !isInfoPath(p));
    const usable = [...(showInfo ? infoPaths : []), ...(showClinical && clinical ? clinicalPaths : [])];
    const plan = planFill(memory.current, result, { reading, usable, v, fromVoice });
    setV(plan.values);
    setFromVoice(plan.marks);
    if (usable.includes('motherName')) setMotherSuggestion(result.values.motherName);
    const waiting = part === 'info' && clinical && clinicalPaths.length ? { values: result.values, paths: clinicalPaths, found: result.found.filter((f) => f.part === 'clinical') } : null;
    if (part === 'info' && (reading || waiting)) onDictatedClinical?.(keepForLater(memory.current, waiting, reading));
    const here = result.found.filter((f) => (f.part === 'info' ? showInfo : !waiting && showClinical && clinical));
    // What was said about a detail changed by hand is not used: listed apart, so the summary matches the form
    const { filled, notChanged } = reading ? splitFound(here, result.values, plan.keep, v) : { filled: here, notChanged: [] };
    return {
      here: filled,
      notChanged,
      handEdited: [...memory.current.handEdited],
      later: waiting ? waiting.found : [],
      dropped: part === 'info' && !clinical && clinicalPaths.length > 0,
      skippedInfo: part === 'clinical' && infoPaths.length > 0,
    };
  };
  const applyDictation = (result) => ({
    ...fillIn(result, { reading: true }),
    notes: result.notes,
    corrections: result.corrections,
    // Questions about clinical details are for staff who enter them; checks on the age or phone (part 'info') for all
    questions: result.questions.filter((q) => clinical || q.part === 'info'),
    unused: result.unused,
  });
  const applyAnswer = (result) => fillIn(result, { reading: false });

  const submit = async (e) => {
    e.preventDefault();
    if (recording) {
      // Saving now would miss what is being said: stop, and the form is filled in when the recording ends.
      voiceControl.current?.stop();
      return;
    }
    setError(null);
    setFieldErrors({});
    // Allergies must be asked: an empty note can't be told apart from "never asked" (safety strip, prescriptions).
    if (showMedical && allergyStatus(v.medical.allergies) === 'not_asked') {
      setError('Please answer the allergy question: write her allergies, or tick "None known".');
      setFieldErrors({ 'medical.allergies': 'Write the allergies, or tick "None known".' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // The baby's sex must never be written in a pregnancy record (PCPNDT): the same check as the server's.
    const sexErrors = showClinical && clinical ? fetalSexErrors(type, v, patient) : {};
    if (Object.keys(sexErrors).length) {
      setError(PCPNDT_MESSAGE);
      setFieldErrors(sexErrors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // A scan measurement of the pregnancy loss must be a number of millimetres, and a fertility number a number in its
    // range (the server checks both too)
    const findingErrors = showClinical && clinical ? (type === 'abortion' ? abortionFindingErrors(v.abortion) : type === 'infertility' ? fertilityNumberErrors(v.fertility) : {}) : {};
    if (Object.keys(findingErrors).length) {
      setError('Please check the highlighted fields.');
      setFieldErrors(findingErrors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(toPayload({ ...v, careType: type }, isEdit, access, part, loaded), { another: another.current });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  const showPregnancy = showClinical && type === 'antenatal' && clinical;
  const showLoss = showClinical && type === 'abortion' && clinical;
  const continues = clinicalStep?.(v) ?? false;
  // A doctor who assigns a colleague can't open that patient's clinical details afterwards (need-to-know).
  const doctorHint =
    clinical && clinicalStep && !continues
      ? 'The doctor responsible for this patient. That doctor or an RMO then adds the clinical details.'
      : 'The doctor responsible for this patient. Can be changed later.';

  const bloodGroupField = (
    <Field label="Blood group (optional)" id="nbBlood" error={fe('medical.bloodGroup')}>
      <select id="nbBlood" className={vc('medical.bloodGroup')} value={v.medical.bloodGroup} onChange={setIn('medical', 'bloodGroup')} disabled={!clinical}>
        <option value="">Not known</option>
        {BLOOD_GROUPS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      {vm('medical.bloodGroup')}
    </Field>
  );
  const checkClass = (path) => `check ${voiced(path) ? 'voice-filled' : ''}`.trim();
  const voiceTag = (path) =>
    voiced(path) && (
      <span className="voice-tag">
        <Mic aria-hidden="true" /> From voice
      </span>
    );

  // Voice entry beside the form (pages-patients.css: side by side on a wide screen) – once opened with Dictate
  const sideBySide = Boolean(voice && type && voiceOpen);
  return (
    <form className="patient-form" onSubmit={submit} noValidate>
      <Alert type="error">{error}</Alert>
      {showInfo && !clinical && (
        <Alert type="patient-note" icon={Info}>
          You can enter the patient's details and contact information. A doctor or RMO will add the medical details.
        </Alert>
      )}

      <div className={sideBySide ? 'pf-voice-layout' : undefined}>
        {sideBySide && (
          <div className="pf-voice-side">
            <VoiceEntry
              onHide={() => setVoiceOpen(false)}
              careType={type}
              onDetails={applyDictation}
              onAnswer={applyAnswer}
              onBusy={setRecording}
              onStatus={setVoiceStatus}
              control={voiceControl}
              canNote={clinical}
              example={voiceExample(part, type, clinical)}
              initial={dictated ? { here: dictated.found, later: [], notes: [], carried: true } : null}
              initialText={spoken}
            />
          </div>
        )}
        <div className={sideBySide ? 'pf-voice-main' : undefined}>
          {voice && type && !voiceOpen && <DictateButton onOpen={() => setVoiceOpen(true)} />}

          {showInfo && type && (
            <fieldset className="card form-section fieldset-plain" disabled={!access.canEditIdentity}>
              <h2>{isNewborn ? 'Baby' : 'Patient'}</h2>
              {/* Abortion care: a threatened miscarriage belongs under antenatal care (the pregnancy-loss section says it too) */}
              {type === 'abortion' && !showLoss && <p className="hint">{THREATENED_HINT}</p>}
              {/* In small groups (owner, 13 Oct 2026): who she is, how to reach her, someone to call, the ID seen, her doctor */}
              <div className="pf-group">
                <h3 className="pf-group-title">Basic details</h3>
                {!isNewborn && access.canEditIdentity && <AadhaarQrFill onFill={fillFromAadhaar} />}
                <div className={isEdit ? 'form-grid form-grid-fill' : 'form-grid'}>
                  {/* Editing a record: the type of care can be changed here. Registering: chosen from the New patient menu, and
                      changed here if the menu choice was wrong. */}
                  {!isEdit && onCareTypeChange && (
                    <Field label="Type of care" id="careType" hint={CARE_TYPE_HINTS[type]}>
                      <select id="careType" value={type} onChange={(e) => onCareTypeChange(e.target.value)}>
                        {CARE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {CARE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {isEdit && (
                    <Field label="Type of care" id="careType" error={fe('careType')} hint={CARE_TYPE_HINTS[type]}>
                      <select id="careType" value={type} onChange={setCareType}>
                        {CARE_TYPES.map((t) => (
                          <option key={t} value={t} disabled={(t === 'newborn') !== (patient.careType === 'newborn')}>
                            {CARE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="Full name" id="fullName" error={fe('fullName')} hint={isNewborn ? 'e.g. "B/o Asha Sample" (baby of)' : undefined}>
                    <input id="fullName" className={vc('fullName')} value={v.fullName} onChange={asName(set('fullName'))} maxLength={150} placeholder={isNewborn ? undefined : 'First and last name'} />
                    {vm('fullName')}
                  </Field>
                  {!isNewborn && (
                    <Field label="Age (years)" id="ageYears" error={fe('ageYears')}>
                      <input id="ageYears" className={vc('ageYears')} inputMode="numeric" value={v.ageYears} onChange={set('ageYears')} maxLength={3} placeholder="e.g. 28" />
                      {vm('ageYears')}
                    </Field>
                  )}
                </div>
              </div>
              <div className="pf-group">
                <h3 className="pf-group-title">Contact</h3>
                <div className="form-grid pf-contact-grid">
                  <Field label={isNewborn ? "Parent's phone" : 'Phone'} id="phone" error={fe('phone')}>
                    <input id="phone" className={vc('phone')} type="tel" value={v.phone} onChange={set('phone')} maxLength={30} placeholder="10-digit mobile number" />
                    {vm('phone')}
                  </Field>
                  <Field label="Address" id="address" error={fe('address')}>
                    <textarea id="address" className={vc('address')} rows={2} value={v.address} onChange={set('address')} maxLength={300} placeholder="House, street, village or town" />
                    {vm('address')}
                  </Field>
                </div>
                <div className="form-grid pf-place-grid">
                  <Field label="PIN code" id="pinCode" error={fe('pinCode')} hint="Fills the city and state">
                    <input id="pinCode" inputMode="numeric" value={v.pinCode} onChange={setPinCode} maxLength={6} placeholder="6 digits" />
                  </Field>
                  <Field label="City, town or village" id="city" error={fe('city')}>
                    <input id="city" value={v.city} onChange={set('city')} maxLength={60} />
                  </Field>
                  <Field label="State" id="state" error={fe('state')}>
                    <input id="state" value={v.state} onChange={set('state')} maxLength={60} list="pf-states" />
                    <datalist id="pf-states">
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st} />
                      ))}
                    </datalist>
                  </Field>
                </div>
              </div>
              <div className="pf-group">
                <h3 className="pf-group-title">Referral and payment</h3>
                <div className="form-grid">
                  <Field label="Referred by (optional)" id="referredBy" error={fe('referredBy')} hint="A doctor, clinic, ASHA worker or another hospital">
                    <input id="referredBy" value={v.referredBy} onChange={set('referredBy')} maxLength={100} />
                  </Field>
                  <Field label="Who pays" id="payerType" error={fe('payer.type')}>
                    <select id="payerType" value={v.payer.type} onChange={setIn('payer', 'type')}>
                      <option value="">Not noted</option>
                      {PAYER_OPTIONS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {v.payer.type && v.payer.type !== 'self' && (
                    <>
                      <Field label={PAYER_NAME_LABELS[v.payer.type]} id="payerName" error={fe('payer.name')}>
                        <input id="payerName" value={v.payer.name} onChange={setIn('payer', 'name')} maxLength={100} />
                      </Field>
                      <Field label="Card or policy number" id="payerNumber" error={fe('payer.number')} hint="For the bill and the claim">
                        <input id="payerNumber" value={v.payer.number} onChange={setIn('payer', 'number')} maxLength={40} autoComplete="off" />
                      </Field>
                    </>
                  )}
                </div>
              </div>
              {!isNewborn && (
                <div className="pf-group">
                  <h3 className="pf-group-title">Emergency contact</h3>
                  <div className="form-grid">
                    <Field label="Contact name" id="ecName" error={fe('emergencyContact.name')} hint="A relative or attendant to call">
                      <input id="ecName" value={v.emergencyContact.name} onChange={asName(setIn('emergencyContact', 'name'))} maxLength={100} />
                    </Field>
                    <Field label="Relation" id="ecRelation" error={fe('emergencyContact.relation')} hint="For example husband, mother">
                      <input id="ecRelation" value={v.emergencyContact.relation} onChange={setIn('emergencyContact', 'relation')} maxLength={50} />
                    </Field>
                    <Field label="Contact phone" id="ecPhone" error={fe('emergencyContact.phone')}>
                      <input id="ecPhone" type="tel" value={v.emergencyContact.phone} onChange={setIn('emergencyContact', 'phone')} maxLength={30} />
                    </Field>
                  </div>
                </div>
              )}
              {(!isNewborn || !isEdit) && (
                <div className="pf-group">
                  <h3 className="pf-group-title">{isNewborn ? 'Doctor' : isEdit ? 'ID proof' : 'ID proof and doctor'}</h3>
                  <div className="form-grid">
                    {!isNewborn && (
                      <>
                        <Field label="ID proof seen" id="idKind" error={fe('idProof.kind')}>
                          <select id="idKind" value={v.idProof.kind} onChange={setIn('idProof', 'kind')}>
                            <option value="">None noted</option>
                            {ID_PROOF_OPTIONS.map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Last 4 of the ID number" id="idLast4" error={fe('idProof.last4')} hint="Only the last 4 – never the whole number">
                          <input id="idLast4" value={v.idProof.last4} onChange={setIn('idProof', 'last4')} maxLength={4} autoComplete="off" />
                        </Field>
                      </>
                    )}
                    {!isEdit && departments.length > 0 && (
                      <Field label="Department" id="department">
                        <select
                          id="department"
                          value={department}
                          onChange={(e) => {
                            const next = e.target.value;
                            setDepartment(next);
                            // a doctor of another department is no longer offered
                            const chosen = allDoctors.find((d) => d.id === v.assignedDoctor);
                            if (next && chosen && chosen.department !== next) setV((cur) => ({ ...cur, assignedDoctor: '' }));
                          }}
                        >
                          <option value="">All departments</option>
                          {departments.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {!isEdit && (
                      <Field label="Assigned doctor" id="assignedDoctor" error={fe('assignedDoctor')} hint={doctorHint}>
                        <select id="assignedDoctor" value={v.assignedDoctor} onChange={set('assignedDoctor')}>
                          <option value="">Not assigned yet</option>
                          {allDoctors.filter((d) => !department || d.department === department).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                              {d.qualification ? ` (${d.qualification})` : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          )}

          {type && (
            <>
              {showInfo && isNewborn && (
                <section className="card form-section">
                  <h2>Birth details</h2>
                  <div className="form-grid">
                    <Field label="Date and time of birth" id="birthAt" error={fe('newborn.birthAt')} hint={v.newborn.birthAt ? formatDateTime(v.newborn.birthAt) : undefined} keepHint>
                      <input
                        id="birthAt"
                        className={vc('newborn.birthAt')}
                        type="datetime-local"
                        value={v.newborn.birthAt}
                        onChange={setIn('newborn', 'birthAt')}
                        max={toDateTimeInput(new Date())}
                      />
                      {vm('newborn.birthAt')}
                    </Field>
                    <Field label="Birth weight (grams)" id="birthWeight" error={fe('newborn.birthWeightGrams')}>
                      <input
                        id="birthWeight"
                        className={vc('newborn.birthWeightGrams')}
                        inputMode="numeric"
                        value={v.newborn.birthWeightGrams}
                        onChange={setIn('newborn', 'birthWeightGrams')}
                        maxLength={4}
                      />
                      {vm('newborn.birthWeightGrams')}
                    </Field>
                    <Field label="Sex" id="newbornSex" error={fe('newborn.sex')}>
                      <select id="newbornSex" className={vc('newborn.sex')} value={v.newborn.sex} onChange={setIn('newborn', 'sex')}>
                        <option value="">Choose…</option>
                        {Object.entries(NEWBORN_SEX_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {vm('newborn.sex')}
                    </Field>
                    {showClinical && bloodGroupField}
                  </div>
                  <MotherPicker
                    value={v.newborn.mother}
                    initial={patient?.motherInfo ? { fullName: patient.motherInfo.fullName, mrn: patient.motherInfo.mrn } : null}
                    onChange={(id, _label, motherName) =>
                      // Her name fills the baby's as "B/o …" – baby of, the short form hospitals use (owner, 24 Oct 2026) –
                      // never over a name typed by hand
                      setV({ ...v, newborn: { ...v.newborn, mother: id }, ...(motherName && (!v.fullName.trim() || /^(?:baby of|b\/o)\s/i.test(v.fullName.trim())) ? { fullName: `B/o ${motherName}` } : {}) })
                    }
                    error={fe('newborn.mother')}
                    suggest={motherSuggestion}
                  />
                  {/* The baby's parents (owner, 24 Oct 2026): the mother above, the father's name here */}
                  <Field label="Father's name (optional)" id="nb-father" error={fe('newborn.fatherName')}>
                    <input
                      id="nb-father"
                      maxLength={150}
                      value={v.newborn.fatherName}
                      onChange={asName((e) => setV({ ...v, newborn: { ...v.newborn, fatherName: e.target.value } }))}
                    />
                  </Field>
                </section>
              )}

              {!showInfo && isNewborn && clinical && (
                <section className="card form-section">
                  <h2>Medical background</h2>
                  <div className="form-grid form-grid-fill">{bloodGroupField}</div>
                </section>
              )}

              {showPregnancy && (
                <section className="card form-section">
                  <h2>Pregnancy</h2>
                  <div className="form-grid">
                    <Field
                      label="LMP (last menstrual period)"
                      id="lmp"
                      error={fe('pregnancy.lmp')}
                      hint={v.pregnancy.lmp ? (lmpCopied && lmpCopied === v.pregnancy.lmp ? `${formatDate(v.pregnancy.lmp)} · copied from the pregnancy loss – check it` : formatDate(v.pregnancy.lmp)) : undefined}
                      keepHint
                    >
                      <input
                        id="lmp"
                        className={vc('pregnancy.lmp')}
                        type="date"
                        value={v.pregnancy.lmp}
                        onChange={(e) => {
                          setLmpCopied('');
                          setIn('pregnancy', 'lmp')(e);
                        }}
                        max={toDateInput(new Date())}
                      />
                      {vm('pregnancy.lmp')}
                    </Field>
                    <Field label="EDD from dating scan (optional)" id="scanEdd" error={fe('pregnancy.scanEdd')} hint="If given, this is used instead of the LMP date.">
                      <input id="scanEdd" className={vc('pregnancy.scanEdd')} type="date" value={v.pregnancy.scanEdd} onChange={setIn('pregnancy', 'scanEdd')} />
                      {vm('pregnancy.scanEdd')}
                    </Field>
                  </div>
                  <div className="calc-row" aria-live="polite">
                    <span>
                      EDD from LMP: <strong>{lmpEdd ? formatDate(lmpEdd) : '—'}</strong>
                    </span>
                    <span>
                      EDD used: <strong>{effectiveEdd ? formatDate(effectiveEdd) : '—'}</strong>
                      {v.pregnancy.scanEdd && <span className="muted"> (scan)</span>}
                    </span>
                    <span>
                      Today: <strong>{formatGestation(ga)}</strong>
                    </span>
                  </div>
                  {datesWarning(v.pregnancy) && (
                    <Alert type="warning">
                      {datesWarning(v.pregnancy)}
                    </Alert>
                  )}
                  <fieldset className="fieldset">
                    <legend>Findings in this pregnancy</legend>
                    <div className="check-grid pf-finding-grid">
                      {Object.entries(PREGNANCY_FINDING_LABELS).map(([k, label]) => {
                        const stored = currentFindings(patient).find((f) => f.key === k);
                        const ticked = v.pregnancy.findings.includes(k);
                        return (
                          <label key={k} className="check pf-finding-check">
                            <input type="checkbox" checked={ticked} onChange={() => toggleFinding(k)} />
                            <span>
                              {label}
                              {vm(`pregnancy.findings.${k}`)}
                              {PREGNANCY_FINDING_HINTS[k] && <span className="pf-finding-by">{PREGNANCY_FINDING_HINTS[k]}</span>}
                              {stored && ticked && (
                                <span className="pf-finding-by">
                                  Recorded by {stored.byName}, {formatDate(stored.at)}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="hint">
                      Tick what has been found in this pregnancy, and untick it if it turns out not to be so. Each tick is saved with your name and the date; a tick from voice entry is marked and is saved only when you save. It counts
                      for the risk level (the Risk card shows the reason) and switches on the items her care plan has for it, as the hospital's risk rules and care-plan
                      template say.
                    </p>
                    <FieldError>{fe('pregnancy.findings')}</FieldError>
                  </fieldset>
                </section>
              )}

              {showLoss && (
                <AbortionSection
                  values={v.abortion}
                  set={setAbortion}
                  bloodGroup={v.medical.bloodGroup}
                  fe={fe}
                  vc={vc}
                  vm={vm}
                  fromAntenatal={isEdit && patient.careType === 'antenatal'}
                  storedSeen={toDateInput(patient?.abortion?.presentedOn)}
                  storedFindings={currentLossFindings(patient?.abortion)}
                  rulesOn={lossRulesOn(patient?.redFlags?.rules)}
                />
              )}

              {isEdit && showClinical && type === 'postnatal' && clinical && (
                <section className="card form-section">
                  <h2>Delivery and breastfeeding</h2>
                  {v.delivery.locked ? (
                    <p>
                      {formatDate(v.delivery.on)} – {DELIVERY_MODE_LABELS[v.delivery.mode] ?? v.delivery.mode}. From the delivery note confirmed in this hospital; any
                      change is made there with an addition.
                    </p>
                  ) : (
                    <>
                      <p className="hint">For a delivery at another hospital. The postnatal care plan is counted from this date.</p>
                      <div className="form-grid">
                        <Field label="Date of delivery" id="delivery-on" error={fe('delivery.on')}>
                          <input id="delivery-on" type="date" value={v.delivery.on} onChange={setIn('delivery', 'on')} max={toDateInput(new Date())} />
                        </Field>
                        <Field label="Mode of delivery" id="delivery-mode" error={fe('delivery.mode')}>
                          <select id="delivery-mode" value={v.delivery.mode} onChange={setIn('delivery', 'mode')}>
                            <option value="">Choose…</option>
                            {Object.entries(DELIVERY_MODE_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    </>
                  )}
                  <div className="form-grid form-grid-fill">
                    <Field label="Breastfeeding" id="breastfeeding" error={fe('postnatal.breastfeeding')} hint="For the medicine safety check on her prescriptions.">
                      <select id="breastfeeding" value={v.postnatal.breastfeeding} onChange={setIn('postnatal', 'breastfeeding')}>
                        {Object.entries(BREASTFEEDING_LABELS).map(([k, label]) => (
                          <option key={k || 'none'} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </section>
              )}

              {isEdit && showClinical && isNewborn && clinical && (
                <section className="card form-section" aria-labelledby="pf-after-birth">
                  <h2 id="pf-after-birth">Care after birth</h2>
                  <p className="hint">Optional. Leave “Not recorded” when it is not known. Counted in Analytics only from the delivery note.</p>
                  <div className="form-grid pf-after-birth-grid">
                    <Field label="Admitted to the NICU or SNCU" id="nicu-admitted" error={fe('newbornCare.nicu.admitted')}>
                      <select id="nicu-admitted" value={v.newbornCare.admitted} onChange={setIn('newbornCare', 'admitted')}>
                        {Object.entries(NICU_ADMITTED_LABELS).map(([k, label]) => (
                          <option key={k || 'none'} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {v.newbornCare.admitted === 'yes' && (
                      <>
                        <Field label="Admitted to the unit on" id="nicu-from" error={fe('newbornCare.nicu.from')}>
                          <input id="nicu-from" type="date" value={v.newbornCare.from} onChange={setIn('newbornCare', 'from')} max={toDateInput(new Date())} />
                        </Field>
                        <Field label="Discharged from the unit on (optional)" id="nicu-to" error={fe('newbornCare.nicu.to')} hint="Leave empty while the baby is still there." keepHint>
                          <input id="nicu-to" type="date" value={v.newbornCare.to} onChange={setIn('newbornCare', 'to')} max={toDateInput(new Date())} />
                        </Field>
                      </>
                    )}
                    <Field label="Feeding at discharge" id="feeding-discharge" error={fe('newbornCare.feedingAtDischarge')}>
                      <select id="feeding-discharge" value={v.newbornCare.feedingAtDischarge} onChange={setIn('newbornCare', 'feedingAtDischarge')}>
                        {/* ('' is "Not recorded": its key is not 'none', which is "No breast milk") */}
                        {Object.entries(FEEDING_AT_DISCHARGE_LABELS).map(([k, label]) => (
                          <option key={k || 'not-recorded'} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </section>
              )}

              {showClinical && clinical && type === 'infertility' && <FertilitySection values={v.fertility} set={setFertility} fe={fe} />}

              {showClinical && !isNewborn && clinical && (
                <section className="card form-section">
                  <h2>Obstetric history</h2>
                  <div className="form-grid form-grid-5">
                    {[
                      ['gravida', 'Gravida (G)', 'All pregnancies incl. current'],
                      ['para', 'Para (P)', 'Deliveries'],
                      ['living', 'Living children (L)', ''],
                      ['abortions', 'Abortions (A)', 'Pregnancies that ended before 20 weeks (any cause)'],
                      ['previousCaesareans', 'Previous caesareans', ''],
                    ].map(([key, label, hint]) => (
                      <Field key={key} label={label} id={`ob-${key}`} error={fe(`obstetric.${key}`)} hint={hint || undefined} keepHint>
                        <input id={`ob-${key}`} className={vc(`obstetric.${key}`)} inputMode="numeric" value={v.obstetric[key]} onChange={setIn('obstetric', key)} maxLength={2} />
                        {vm(`obstetric.${key}`)}
                      </Field>
                    ))}
                  </div>
                  {type === 'abortion' && (
                    <p className="hint">
                      {obstetricHint(v.abortion.lossType, presentationWeeks(v.abortion, v.abortion.presentedOn || toDateInput(patient?.abortion?.presentedOn) || localToday()))}
                    </p>
                  )}
                  <fieldset className="fieldset">
                    <legend>Problems in previous pregnancies</legend>
                    {firstPregnancy ? (
                      <p className="hint">Not needed – this is the first pregnancy (Gravida 1, no earlier deliveries or abortions).</p>
                    ) : (
                      <>
                        <div className="check-grid">
                          {Object.entries(PAST_COMPLICATION_LABELS).map(([k, label]) => (
                            <label key={k} className={checkClass(`obstetric.pastComplications.${k}`)}>
                              <input type="checkbox" checked={v.obstetric.pastComplications.includes(k)} onChange={() => toggleComplication(k)} /> {label}
                              {voiceTag(`obstetric.pastComplications.${k}`)}
                            </label>
                          ))}
                        </div>
                        <label className={`check-none ${checkClass('obstetric.complicationsReviewed')}`}>
                          <input
                            type="checkbox"
                            checked={v.obstetric.complicationsReviewed}
                            disabled={v.obstetric.pastComplications.length > 0}
                            onChange={(e) => {
                              unmark('obstetric.complicationsReviewed');
                              setV({ ...v, obstetric: { ...v.obstetric, complicationsReviewed: e.target.checked } });
                            }}
                          />{' '}
                          <strong>None of these</strong> – asked, and there were no problems in previous pregnancies
                          {voiceTag('obstetric.complicationsReviewed')}
                        </label>
                      </>
                    )}
                  </fieldset>
                </section>
              )}

              {showMedical && (
                <section className="card form-section">
                  <h2>Medical background</h2>
                  <div className="allergy-field">
                    <Field label="Allergies (required)" id="allergies" error={fe('medical.allergies')} hint='e.g. "Penicillin – rash". If she has none, tick "None known".'>
                      <input
                        id="allergies"
                        className={vc('medical.allergies')}
                        value={v.medical.allergies}
                        onChange={setIn('medical', 'allergies')}
                        maxLength={500}
                      />
                      {vm('medical.allergies')}
                    </Field>
                    <label className="check check-none">
                      <input type="checkbox" checked={noAllergies} disabled={allergyStatus(v.medical.allergies) === 'recorded'} onChange={setNoAllergies} />{' '}
                      <strong>None known</strong> – asked, and she has no allergies
                    </label>
                  </div>
                  <div className="form-grid">
                    <Field label="Blood group and Rh" id="bloodGroup" error={fe('medical.bloodGroup')} hint={type === 'abortion' ? 'Rh negative: anti-D may be needed' : undefined} keepHint>
                      <select id="bloodGroup" className={vc('medical.bloodGroup')} value={v.medical.bloodGroup} onChange={setIn('medical', 'bloodGroup')}>
                        <option value="">Not known yet</option>
                        {BLOOD_GROUPS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                      {vm('medical.bloodGroup')}
                    </Field>
                    <Field label="Height (cm)" id="heightCm" error={fe('medical.heightCm')}>
                      <input id="heightCm" className={vc('medical.heightCm')} inputMode="decimal" value={v.medical.heightCm} onChange={setIn('medical', 'heightCm')} maxLength={5} />
                      {vm('medical.heightCm')}
                    </Field>
                    <Field label="Weight (kg)" id="weightKg" error={fe('medical.weightKg')}>
                      <input id="weightKg" className={vc('medical.weightKg')} inputMode="decimal" value={v.medical.weightKg} onChange={setIn('medical', 'weightKg')} maxLength={5} />
                      {vm('medical.weightKg')}
                    </Field>
                  </div>
                  <fieldset className="fieldset">
                    <legend>Existing conditions</legend>
                    <div className="check-grid">
                      {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                        <label key={k} className={checkClass(`medical.conditions.${k}`)}>
                          <input type="checkbox" checked={v.medical.conditions.includes(k)} onChange={() => toggleCondition(k)} /> {label}
                          {voiceTag(`medical.conditions.${k}`)}
                        </label>
                      ))}
                    </div>
                    <label className={`check-none ${checkClass('medical.conditionsReviewed')}`}>
                      <input
                        type="checkbox"
                        checked={v.medical.conditionsReviewed}
                        disabled={v.medical.conditions.length > 0}
                        onChange={(e) => {
                          unmark('medical.conditionsReviewed');
                          setV({ ...v, medical: { ...v.medical, conditionsReviewed: e.target.checked } });
                        }}
                      />{' '}
                      <strong>No known conditions</strong> – asked, and none of these apply
                      {voiceTag('medical.conditionsReviewed')}
                    </label>
                    <p className="hint">Leaving everything unticked is not the same as “none”: the risk level stays “Incomplete” until one of these is ticked.</p>
                  </fieldset>
                  <div className="form-grid">
                    <Field label="Other conditions" id="otherConditions" error={fe('medical.otherConditions')} hint="Free text is not checked by the risk rules – the doctor must assess it." keepHint>
                      <input id="otherConditions" className={vc('medical.otherConditions')} value={v.medical.otherConditions} onChange={setIn('medical', 'otherConditions')} maxLength={500} />
                      {vm('medical.otherConditions')}
                    </Field>
                  </div>
                </section>
              )}

              {showClinical && clinical && (
                <section className="card form-section">
                  <Field label="Notes (optional)" id="notes" error={fe('notes')}>
                    <textarea id="notes" className={vc('notes')} rows={3} value={v.notes} onChange={set('notes')} maxLength={2000} />
                    {vm('notes')}
                  </Field>
                </section>
              )}
              {beforeActions}
              <div className="sticky-actions">
                {recording && <VoiceBar status={voiceStatus} onStop={() => voiceControl.current?.stop()} />}
                <button type="submit" className="btn btn-primary" disabled={submitting || recording} aria-describedby={recording ? 'save-wait' : undefined} onClick={() => (another.current = false)}>
                  {submitting ? 'Saving…' : continues ? 'Save and continue' : submitLabel}
                </button>
                {anotherLabel && !continues && (
                  <button type="submit" className="btn btn-secondary" disabled={submitting || recording} onClick={() => (another.current = true)}>
                    {anotherLabel}
                  </button>
                )}
                {recording && (
                  <span id="save-wait" className="hint voice-save-wait">
                    Stop recording before saving.
                  </span>
                )}
                {cancelTo && (
                  <Link to={cancelTo} className="btn btn-link">
                    {cancelLabel}
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
