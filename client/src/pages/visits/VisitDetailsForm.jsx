import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { keyboardEntry } from './keyboardEntry.js';
import { CalendarCheck, CalendarDays, Check, Lock, Mic, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { ITEM_KIND_ICONS, ITEM_KIND_LABELS } from '../careplans/templateFormat.js';
import { addDays, toDateInput, windowText } from '../patients/carePlanFormat.js';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { DictateButton, VoiceBar, VoiceEntry, useVoiceOpen } from '../patients/VoiceEntry.jsx';
import {
  FETAL_MOVEMENTS,
  MOVEMENT_LABELS,
  OEDEMA_GRADES,
  OEDEMA_LABELS,
  PRESENTATIONS,
  PRESENTATION_LABELS,
  URINE_GRADES,
  URINE_LABELS,
  pregnancyCheckText,
  vitalsText,
} from './rxFormat.js';
import { vitalFlags } from './vitalLimits.js';
import { appendText } from './rxRows.js';
import { ReportReaderDialog } from '../ai/ReportReaderDialog.jsx';
import { TranslateDialog } from '../ai/TranslateDialog.jsx';
import {
  PREGNANCY_CHECK_PATHS,
  VISIT_VOICE_PATHS,
  extractVisitDetails,
  newVisitFillMemory,
  noteVisitHandEdit,
  planVisitFill,
  visitAnswer,
  visitHearing, visitSuggestionMeaning } from './visitDictation.js';

// The Visit details tab (Feature 8): vital signs (nurses, the doctor, RMOs), the pregnancy check and the
// doctor's notes, the next visit, and the care-plan items done at this visit (the doctor or an RMO). Each part
// is saved only if nobody saved it meanwhile; what the person may not change is shown as text.
// Voice entry at the top fills what this person may enter from what they say (registration's card; the rules for a
// visit are in visitDictation.js): each field filled is marked "From voice – check" until it is changed by hand.
// The parent remounts this form (key) after a save, so it always starts from what was saved. Through `ref` it can
// save the form before printing ({ pending(), save() }); `printAction` is its print button, shown next to Save.

const str = (v) => (v == null ? '' : String(v));
const VITAL_KEYS = ['weightKg', 'bpSystolic', 'bpDiastolic', 'pulse', 'temperatureF', 'spo2', 'hb', 'urineAlbumin', 'urineSugar'];
const DETAIL_KEYS = ['complaints', 'fundalHeightCm', 'fetalHeartRate', 'presentation', 'fetalMovements', 'oedema', 'examination', 'diagnosis', 'investigations', 'advice', 'privateNote', 'nextVisitNote'];
const TEXT_KEYS = ['complaints', 'examination', 'diagnosis', 'investigations', 'advice', 'privateNote', 'nextVisitNote'];
const fromVitals = (v) => Object.fromEntries(VITAL_KEYS.map((k) => [k, str(v[k])]));
const fromDetails = (d) => ({ ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, str(d[k])])), nextVisitOn: toDateInput(d.nextVisitOn) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BP_PATHS = ['vitals.bpSystolic', 'vitals.bpDiastolic'];

// Voice entry on a visit: what the card says, by what this person may enter
const VOICE_INTRO = {
  all: 'Say the vital signs, the pregnancy check and your notes, and they are filled in below for you to check. ',
  notes: 'Say the vital signs and your notes, and they are filled in below for you to check. ',
  vitals: 'Say the vital signs and they are filled in below for you to check. ',
};
const VOICE_PRIVACY =
  'Speech is turned into text on this computer: nothing is sent anywhere or kept. Perinexa includes corrections for common Indian English ' +
  'pronunciations of medical words and numbers, and asks when it is not sure.';
const VOICE_EXAMPLE = {
  antenatal: '"BP 110 by 70, pulse 84, weight 58 kg, fundal height 28, FHR 140, cephalic. Complaints mild backache. Advised iron and calcium. Next visit after 2 weeks."',
  abortion: '"BP 110 by 70, pulse 88. Complaints bleeding PV and passing clots for 2 days. On examination os open. Diagnosis incomplete miscarriage. Advised USG and Hb. Review after 2 days."',
  newborn: '"Weight 3.2 kg, temperature 98.4, SpO2 98. No complaints. On examination active, feeding well. Next visit after 1 week."',
  other: '"BP 120 by 80, pulse 78, weight 62 kg. Complaints irregular periods. On examination P/A soft. Diagnosis PCOS. Advised TSH and USG pelvis. Review after 1 month."',
  vitals: '"Weight 58 kg, BP 110 by 70, pulse 84, temperature 98.6, SpO2 99, Hb 10.5, urine albumin nil, sugar nil."',
};
const VOICE_TIPS = [
  'Say each detail with its name, for example “BP 110 by 70”, “pulse 84”, “weight 58 kg” or “FHR 140”.',
  'Start your notes with a heading: “complaints …”, “on examination …”, “diagnosis …”, “advised …” or “private note …”.',
  'Say the next visit as “next visit after 2 weeks”, “review on 15 October” or “follow up next Monday”.',
  'If you say something wrong, say “sorry” and the right value, for example “pulse 88, sorry, 92”.',
  'Say the temperature in °F. One said in °C is shown in °F for you to confirm.',
  'A headset microphone works best in a busy OPD.',
  'Use Google Chrome on a Windows or Mac computer. The first set-up needs the internet once, and again in an Incognito window.',
  'The corrections were built for Indian English as spoken in the Hindi belt, Punjab, Gujarat, Maharashtra, Bengal, Odisha, Assam and the North-East, ' +
    'Tamil Nadu, Andhra Pradesh and Telangana, Karnataka, Kerala, and in cities.',
];
// A part not understood can be added to one of these notes
const NOTE_TO = [
  { key: 'complaints', label: 'Add to complaints' },
  { key: 'examination', label: 'Add to examination' },
  { key: 'advice', label: 'Add to advice' },
];

// "From voice – check": under a field filled from what was said, until the field is changed.
function VoiceMark() {
  return (
    <span className="voice-mark">
      <Mic aria-hidden="true" /> From voice – check
    </span>
  );
}

function Byline({ part, verb }) {
  if (!part.byName) return null;
  return (
    <p className="hint vs-byline">
      {verb} by {part.byName} · {formatDateTime(part.at)}
    </p>
  );
}

function Shown({ label, value }) {
  return (
    <div className="vs-shown">
      <span className="vs-shown-label">{label}</span>
      <span className="pre-line">{value || '—'}</span>
    </div>
  );
}

function Choice({ id, label, value, options, labels, onChange, error, voice }) {
  return (
    <Field label={label} id={id} error={error}>
      <select id={id} className={voice ? 'voice-filled' : undefined} value={value} onChange={onChange}>
        {options.map((o) => (
          <option key={o || '-'} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
      {voice && <VoiceMark />}
    </Field>
  );
}

const PREGNANCY_FLAGS = ['fhr', 'movements', 'oedema'];

/** "Check these values": the values outside the usual range, each as colour + icon + words. */
function VitalFlags({ flags }) {
  if (!flags.length) return null;
  return (
    <div className="vs-flags" role="status" aria-live="polite">
      <span className="vs-flags-title">Check these values:</span>
      {flags.map((f) => (
        <StatusPill key={f.key} tone={f.level} icon={TriangleAlert}>
          {f.text}
        </StatusPill>
      ))}
    </div>
  );
}

/**
 * The appointment the saved next visit booked (appointment booking): the app takes the first free slot that day with
 * her doctor; when it can't, reception gives it a time.
 */
function NextVisitBooking({ booking, saved }) {
  if (!saved) return null;
  if (!booking) return <p className="hint vs-booking">Not booked as an appointment (no doctor to book with). Reception can book it on the Appointments page.</p>;
  return (
    <p className="vs-booking">
      <CalendarCheck aria-hidden="true" />
      {booking.needsTime
        ? ` Booked for ${formatDate(booking.date)} with ${booking.doctorName} – no free time that day, so reception will give a time.`
        : ` Booked: ${formatDate(booking.date)} at ${timeLabel(booking.start)} with ${booking.doctorName}.`}
      {booking.movedByHand ? ' Reception set this time; changing the date here no longer moves it.' : ''}
    </p>
  );
}

export function VisitDetailsForm({ patient, page, onSaved, onConflict, onPlanConflict, onDirty, append = null, onAppended = null, shown = true, printAction = null, draft = null, onDraft = null, ref }) {
  const { visit, carePlan: plan, access } = page;
  const antenatal = patient.careType === 'antenatal';
  const active = visit.status === 'active';
  const canVitals = active && access.canRecordVitals;
  const canEdit = active && access.canEdit;
  // draft: the person's own unsaved typing, put back (doctor ideas #4 – visitDraft.js)
  const [vitals, setVitals] = useState(() => draft?.vitals ?? fromVitals(visit.vitals));
  const [details, setDetails] = useState(() => draft?.details ?? fromDetails(visit.details));
  const isToday = toDateInput(visit.visitOn) === toDateInput(page.today);
  // The visit the care plan expects today is ticked for the doctor (they can untick it); nothing else is.
  const [ticked, setTicked] = useState(() => {
    if (Array.isArray(draft?.ticked)) return draft.ticked;
    const expected = isToday && canEdit && plan?.canTick ? plan.dueNow.find((i) => i.kind === 'visit' && ['due', 'overdue'].includes(i.status)) : null;
    return expected ? [expected.id] : [];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [fromVoice, setFromVoice] = useState(() => new Set()); // fields filled from what was said, until changed by hand
  const [recording, setRecording] = useState(false); // voice entry is recording: saving waits for Stop
  const [voiceStatus, setVoiceStatus] = useState(null); // the recording's status, for the bar above Save
  const [aiDialog, setAiDialog] = useState(null); // 'translate' | 'report' (Smart features)
  const [voiceOpen, setVoiceOpen] = useVoiceOpen();
  const voiceControl = useRef(null);
  // A new reading of what was said never undoes the person's own work, on this form only (see planVisitFill)
  const memory = useRef(null);
  if (!memory.current) memory.current = newVisitFillMemory();

  const vitalsChanged = !same(vitals, fromVitals(visit.vitals));
  const detailsChanged = !same(details, fromDetails(visit.details));
  // Typed changes (they would be missing from a printout); ticks only change the care plan.
  const edited = (canVitals && vitalsChanged) || (canEdit && detailsChanged);
  const toSave = edited || (canEdit && ticked.length > 0);
  useEffect(() => onDirty(edited), [edited, onDirty]);
  // What is typed and not saved yet, kept as the person's draft (nothing unsaved: none)
  useEffect(() => onDraft?.(edited ? { vitals, details, ticked } : null), [edited, vitals, details, ticked, onDraft]);

  // Tests and advice of a ready-made set added on the Prescription tab (each addition once; saved with the visit).
  useEffect(() => {
    if (!append) return;
    if (canEdit) {
      setDetails((x) => ({ ...x, investigations: appendText(x.investigations, append.investigations), advice: appendText(x.advice, append.advice) }));
    }
    onAppended?.();
  }, [append, canEdit, onAppended]);

  // The Prescription tab (or another page): the recording stops, so the microphone never stays on for a form that is
  // out of sight. What was said is filled in when it ends.
  useEffect(() => {
    if (!shown) voiceControl.current?.stop();
  }, [shown]);

  // A field changed by hand has been checked: its "From voice" mark goes, and voice never changes it again.
  const unmark = (...paths) => {
    noteVisitHandEdit(memory.current, paths);
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

  const setV = (k) => (e) => {
    unmark(...(k.startsWith('bp') ? BP_PATHS : [`vitals.${k}`])); // the blood pressure is one reading
    setVitals((x) => ({ ...x, [k]: e.target.value }));
  };
  const setD = (k) => (e) => {
    unmark(`details.${k}`);
    setDetails((x) => ({ ...x, [k]: e.target.value }));
  };
  const setNextVisit = (date) => {
    unmark('details.nextVisitOn');
    setDetails((x) => ({ ...x, nextVisitOn: date }));
  };
  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  // The care plan's next visit (not one ticked now), for the next-visit date.
  const suggested = plan?.nextVisits.find((i) => !ticked.includes(i.id) && i.status === 'upcoming') ?? null;
  const quick = [
    ['1 week', 7],
    ['2 weeks', 14],
    ['4 weeks', 28],
  ];

  // Voice entry: what this person may enter – vital signs (with canVitals), the pregnancy check (antenatal visits)
  // and the notes (canEdit; the private note only for those who see it).
  const mayFill = (path) =>
    path.startsWith('vitals.') ? canVitals : canEdit && (path !== 'details.privateNote' || access.canViewNotes) && (antenatal || !PREGNANCY_CHECK_PATHS.includes(path));
  // `reading`: the whole text was read (again) – what the person did by hand is left alone. Otherwise it is an answer to
  // a question: the person chose it, so it is used even over a change by hand.
  const fillIn = (result, { reading }) => {
    const plan = planVisitFill(memory.current, result, { reading, usable: VISIT_VOICE_PATHS.filter(mayFill), form: { vitals, details }, fromVoice });
    setVitals(plan.form.vitals);
    setDetails(plan.form.details);
    setFromVoice(plan.marks);
    return {
      here: plan.here,
      notChanged: plan.notChanged,
      handEdited: [...memory.current.handEdited],
      later: [],
      // A nurse's notes about the patient's condition: a doctor or RMO adds them
      dropped: result.paths.some((p) => !p.startsWith('vitals.') && !mayFill(p)),
    };
  };
  const applyDictation = (result) => ({
    ...fillIn(result, { reading: true }),
    notes: result.notes,
    corrections: result.corrections,
    questions: result.questions.filter((q) => q.paths.every(mayFill)),
    unused: result.unused,
  });
  const applyAnswer = (result) => fillIn(result, { reading: false });
  const readVisit = (text, options) => extractVisitDetails(text, { ...options, visitOn: visit.visitOn });

  // Saves what changed. Returns the visit as saved, or null (the form shows what to fix) – or 'recording': saving now
  // would miss what is being said, so the recording stops and the form is filled in when it ends.
  const saveNow = async () => {
    if (recording) {
      voiceControl.current?.stop();
      return 'recording';
    }
    setError(null);
    const local = {};
    if (patient.careType !== 'newborn') {
      for (const k of TEXT_KEYS) if (canEdit && mentionsFetalSex(details[k])) local[`details.${k}`] = PCPNDT_MESSAGE;
    }
    if (canVitals && Boolean(vitals.bpSystolic) !== Boolean(vitals.bpDiastolic)) local[`vitals.${vitals.bpSystolic ? 'bpDiastolic' : 'bpSystolic'}`] = 'Enter both numbers of the blood pressure';
    if (Object.keys(local).length) {
      setFields(local);
      setError('Please check the highlighted fields.');
      return null;
    }
    const body = {};
    if (canVitals && vitalsChanged) body.vitals = { rev: visit.vitals.rev, ...vitals };
    if (canEdit && detailsChanged) {
      const { privateNote, ...rest } = details;
      body.details = { rev: visit.details.rev, ...rest, ...(access.canViewNotes ? { privateNote } : {}) };
    }
    if (canEdit && ticked.length) body.doneItems = ticked.map((id) => ({ id, rev: plan.dueNow.find((i) => i.id === id)?.rev ?? 0 }));
    if (!Object.keys(body).length) return null;
    setSaving(true);
    setFields({});
    try {
      const res = await api(`/patients/${patient.id}/visits/${visit.id}`, { method: 'PATCH', body });
      const n = body.doneItems?.length ?? 0;
      onSaved(res, `${canEdit ? 'Visit' : 'Vital signs'} saved${n ? ` – ${n} care-plan ${n === 1 ? 'item' : 'items'} marked done` : ''}.`);
      return res;
    } catch (err) {
      setSaving(false);
      if (err.code === 'PLAN_CONFLICT') {
        setTicked([]);
        onPlanConflict(err.message);
        return null;
      }
      // (the record was marked as a duplicate meanwhile: the refusal is shown here and what was typed stays on the
      // screen, to be written on the main record – nothing is reloaded)
      if (err.status === 409 && err.code !== 'DUPLICATE_RECORD') {
        onConflict(err.message); // someone saved this part meanwhile: the page loads the latest
        return null;
      }
      setError(err.message);
      setFields(err.fields ?? {});
      return null;
    }
  };
  const save = (e) => {
    e.preventDefault();
    saveNow();
  };
  // The visit page's "AI tools" menu opens these here (they fill in this form). 'translate' needs the advice first.
  const openAi = (kind) => {
    if (!canEdit) return 'not-allowed';
    if (kind === 'translate' && !details.advice.trim()) return 'no-advice';
    setAiDialog(kind);
    return 'opened';
  };
  useImperativeHandle(ref, () => ({ pending: () => toSave, save: saveNow, openAi }));

  const fe = (k) => fields[k];
  // Due now (or within a week) first; items overdue from earlier folded underneath.
  const nowItems = (plan?.dueNow ?? []).filter((i) => i.status !== 'overdue');
  const lateItems = (plan?.dueNow ?? []).filter((i) => i.status === 'overdue');
  const tickRow = (i) => {
    const Icon = ITEM_KIND_ICONS[i.kind];
    return (
      <label key={i.id} className="check vs-plan-item" htmlFor={`vs-plan-${i.id}`}>
        <input id={`vs-plan-${i.id}`} type="checkbox" checked={ticked.includes(i.id)} onChange={() => toggle(i.id)} />
        <span>
          {Icon && <Icon aria-hidden="true" />} {i.name}
          <span className="muted">
            {' '}
            · {ITEM_KIND_LABELS[i.kind]} · {windowText(i.dueFrom, i.dueBy)}
            {i.status === 'overdue' ? ' · overdue' : ''}
          </span>
        </span>
      </label>
    );
  };
  // Read-only: what is due, without the tick boxes.
  const dueRow = (i) => (
    <li key={i.id}>
      {i.name}
      <span className="muted">
        {' '}
        · {ITEM_KIND_LABELS[i.kind]} · {windowText(i.dueFrom, i.dueBy)}
      </span>
    </li>
  );
  // Values outside the usual range, as typed (vitalLimits.js) – a reminder, the doctor decides
  const flags = vitalFlags(canVitals ? vitals : visit.vitals, canEdit ? details : visit.details, { pregnant: antenatal, baby: patient.careType === 'newborn' });

  return (
    <form className="vs-form" onSubmit={save} noValidate onKeyDown={keyboardEntry()}>
      <Alert type="error">{error}</Alert>

      {(canVitals || canEdit) && !voiceOpen && <DictateButton onOpen={() => setVoiceOpen(true)} />}
      {(canVitals || canEdit) && voiceOpen && (
        <VoiceEntry
          onHide={() => setVoiceOpen(false)}
          careType={patient.careType}
          read={readVisit}
          answerWith={visitAnswer}
          hearing={visitHearing}
          noteTo={NOTE_TO}
          intro={VOICE_INTRO[!canEdit ? 'vitals' : antenatal ? 'all' : 'notes'] + VOICE_PRIVACY}
          tips={VOICE_TIPS}
          example={canEdit ? (VOICE_EXAMPLE[patient.careType] ?? VOICE_EXAMPLE.other) : VOICE_EXAMPLE.vitals}
          onDetails={applyDictation}
          onAnswer={applyAnswer}
          aiForm="visit"
          aiMeaning={visitSuggestionMeaning}
          onBusy={setRecording}
          onStatus={setVoiceStatus}
          control={voiceControl}
          canNote={canEdit}
        />
      )}

      <section className="card vs-section" aria-labelledby="vs-vitals">
        <h2 id="vs-vitals">Vital signs</h2>
        <Byline part={visit.vitals} verb="Recorded" />
        {canVitals ? (
          <div className="vs-grid">
            <Field label="Weight (kg)" id="vs-weight" error={fe('vitals.weightKg')}>
              <input id="vs-weight" className={vc('vitals.weightKg')} inputMode="decimal" value={vitals.weightKg} onChange={setV('weightKg')} />
              {vm('vitals.weightKg')}
            </Field>
            <div className="field vs-bp">
              <span className="field-label" id="vs-bp-label">
                Blood pressure (mmHg)
              </span>
              <div className="vs-bp-inputs" role="group" aria-labelledby="vs-bp-label">
                <input
                  aria-label="Upper number (systolic)"
                  className={vc('vitals.bpSystolic')}
                  inputMode="numeric"
                  value={vitals.bpSystolic}
                  onChange={setV('bpSystolic')}
                  aria-invalid={Boolean(fe('vitals.bpSystolic'))}
                />
                <span aria-hidden="true">/</span>
                <input
                  aria-label="Lower number (diastolic)"
                  className={vc('vitals.bpDiastolic')}
                  inputMode="numeric"
                  value={vitals.bpDiastolic}
                  onChange={setV('bpDiastolic')}
                  aria-invalid={Boolean(fe('vitals.bpDiastolic'))}
                />
              </div>
              {vm('vitals.bpSystolic')}
              {(fe('vitals.bpSystolic') || fe('vitals.bpDiastolic')) && <p className="field-error">{fe('vitals.bpSystolic') || fe('vitals.bpDiastolic')}</p>}
            </div>
            <Field label="Pulse (/min)" id="vs-pulse" error={fe('vitals.pulse')}>
              <input id="vs-pulse" className={vc('vitals.pulse')} inputMode="numeric" value={vitals.pulse} onChange={setV('pulse')} />
              {vm('vitals.pulse')}
            </Field>
            <Field label="Temperature (°F)" id="vs-temp" error={fe('vitals.temperatureF')}>
              <input id="vs-temp" className={vc('vitals.temperatureF')} inputMode="decimal" value={vitals.temperatureF} onChange={setV('temperatureF')} />
              {vm('vitals.temperatureF')}
            </Field>
            <Field label="SpO2 (%)" id="vs-spo2" error={fe('vitals.spo2')}>
              <input id="vs-spo2" className={vc('vitals.spo2')} inputMode="numeric" value={vitals.spo2} onChange={setV('spo2')} />
              {vm('vitals.spo2')}
            </Field>
            <Field label="Hb (g/dL)" id="vs-hb" error={fe('vitals.hb')}>
              <input id="vs-hb" className={vc('vitals.hb')} inputMode="decimal" value={vitals.hb} onChange={setV('hb')} />
              {vm('vitals.hb')}
            </Field>
            <Choice id="vs-alb" label="Urine albumin" value={vitals.urineAlbumin} options={URINE_GRADES} labels={URINE_LABELS} onChange={setV('urineAlbumin')} error={fe('vitals.urineAlbumin')} voice={voiced('vitals.urineAlbumin')} />
            <Choice id="vs-sugar" label="Urine sugar" value={vitals.urineSugar} options={URINE_GRADES} labels={URINE_LABELS} onChange={setV('urineSugar')} error={fe('vitals.urineSugar')} voice={voiced('vitals.urineSugar')} />
          </div>
        ) : (
          <p>{vitalsText(visit.vitals) || <span className="muted">Not recorded.</span>}</p>
        )}
        <VitalFlags flags={flags.filter((f) => !PREGNANCY_FLAGS.includes(f.key))} />
      </section>

      {antenatal && (
        <section className="card vs-section" aria-labelledby="vs-check">
          <h2 id="vs-check">Pregnancy check</h2>
          {canEdit ? (
            <div className="vs-grid">
              <Field label="Fundal height (cm)" id="vs-fh" error={fe('details.fundalHeightCm')}>
                <input id="vs-fh" className={vc('details.fundalHeightCm')} inputMode="numeric" value={details.fundalHeightCm} onChange={setD('fundalHeightCm')} />
                {vm('details.fundalHeightCm')}
              </Field>
              <Field label="Fetal heart rate (/min)" id="vs-fhr" error={fe('details.fetalHeartRate')}>
                <input id="vs-fhr" className={vc('details.fetalHeartRate')} inputMode="numeric" value={details.fetalHeartRate} onChange={setD('fetalHeartRate')} />
                {vm('details.fetalHeartRate')}
              </Field>
              <Choice id="vs-pres" label="Presentation" value={details.presentation} options={PRESENTATIONS} labels={PRESENTATION_LABELS} onChange={setD('presentation')} error={fe('details.presentation')} voice={voiced('details.presentation')} />
              <Choice id="vs-moves" label="Fetal movements" value={details.fetalMovements} options={FETAL_MOVEMENTS} labels={MOVEMENT_LABELS} onChange={setD('fetalMovements')} error={fe('details.fetalMovements')} voice={voiced('details.fetalMovements')} />
              <Choice id="vs-oedema" label="Oedema" value={details.oedema} options={OEDEMA_GRADES} labels={OEDEMA_LABELS} onChange={setD('oedema')} error={fe('details.oedema')} voice={voiced('details.oedema')} />
            </div>
          ) : (
            <p>{pregnancyCheckText(visit.details) || <span className="muted">Not recorded.</span>}</p>
          )}
          <VitalFlags flags={flags.filter((f) => PREGNANCY_FLAGS.includes(f.key))} />
        </section>
      )}

      <section className="card vs-section" aria-labelledby="vs-notes">
        <h2 id="vs-notes">Doctor's notes</h2>
        <Byline part={visit.details} verb="Written" />
        {canEdit ? (
          <>
            <div className="two-col vs-notes-grid">
              <Field label="Complaints" id="vs-complaints" error={fe('details.complaints')}>
                <textarea id="vs-complaints" className={vc('details.complaints')} rows={3} maxLength={1000} value={details.complaints} onChange={setD('complaints')} />
                {vm('details.complaints')}
              </Field>
              <Field label="Examination findings" id="vs-exam" error={fe('details.examination')}>
                <textarea id="vs-exam" className={vc('details.examination')} rows={3} maxLength={2000} value={details.examination} onChange={setD('examination')} />
                {vm('details.examination')}
              </Field>
              <Field label="Diagnosis" id="vs-dx" error={fe('details.diagnosis')}>
                <textarea id="vs-dx" className={vc('details.diagnosis')} rows={2} maxLength={500} value={details.diagnosis} onChange={setD('diagnosis')} />
                {vm('details.diagnosis')}
              </Field>
              <Field label="Tests advised" id="vs-tests" error={fe('details.investigations')}>
                <textarea id="vs-tests" className={vc('details.investigations')} rows={2} maxLength={1000} value={details.investigations} onChange={setD('investigations')} />
                {vm('details.investigations')}
              </Field>
            </div>
            <Field label="Advice for the patient" id="vs-advice" error={fe('details.advice')} hint="Printed on the prescription.">
              <textarea id="vs-advice" className={vc('details.advice')} rows={3} maxLength={2000} value={details.advice} onChange={setD('advice')} />
              {vm('details.advice')}
            </Field>
            {aiDialog === 'translate' && (
              <TranslateDialog
                patientId={patient.id}
                text={details.advice}
                onClose={() => setAiDialog(null)}
                onAdd={(t) => {
                  setDetails((x) => ({ ...x, advice: appendText(x.advice, t) }));
                  unmark('details.advice');
                  setAiDialog(null);
                }}
              />
            )}
            {aiDialog === 'report' && (
              <ReportReaderDialog
                patientId={patient.id}
                canHb={canVitals}
                onClose={() => setAiDialog(null)}
                onUse={({ line, hb }) => {
                  setDetails((x) => ({ ...x, examination: appendText(x.examination, line) }));
                  if (hb != null) setVitals((x) => ({ ...x, hb: String(hb) }));
                  unmark('details.examination', ...(hb != null ? ['vitals.hb'] : []));
                  setAiDialog(null);
                }}
              />
            )}
            {access.canViewNotes && (
              <Field label="Private note" id="vs-private" error={fe('details.privateNote')} hint="Never printed, and not shown to nurses." keepHint>
                <textarea id="vs-private" className={vc('details.privateNote')} rows={2} maxLength={2000} value={details.privateNote} onChange={setD('privateNote')} />
                {vm('details.privateNote')}
              </Field>
            )}
          </>
        ) : (
          <div className="vs-shown-list">
            <Shown label="Complaints" value={visit.details.complaints} />
            <Shown label="Examination findings" value={visit.details.examination} />
            <Shown label="Diagnosis" value={visit.details.diagnosis} />
            <Shown label="Tests advised" value={visit.details.investigations} />
            <Shown label="Advice for the patient" value={visit.details.advice} />
            {access.canViewNotes && (
              <div className="vs-shown">
                <span className="vs-shown-label">
                  <Lock aria-hidden="true" /> Private note
                </span>
                <span className="pre-line">{visit.details.privateNote || '—'}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card vs-section" aria-labelledby="vs-next">
        <h2 id="vs-next">Next visit</h2>
        {canEdit ? (
          <>
            <div className="form-grid">
              <Field label="Date" id="vs-next-date" error={fe('details.nextVisitOn')}>
                <input
                  id="vs-next-date"
                  type="date"
                  className={vc('details.nextVisitOn')}
                  min={toDateInput(addDays(visit.visitOn, 1))}
                  value={details.nextVisitOn}
                  onChange={setD('nextVisitOn')}
                />
                {vm('details.nextVisitOn')}
              </Field>
              <Field label="Note (optional)" id="vs-next-note" error={fe('details.nextVisitNote')} hint="e.g. with the scan report">
                <input id="vs-next-note" className={vc('details.nextVisitNote')} maxLength={200} value={details.nextVisitNote} onChange={setD('nextVisitNote')} />
                {vm('details.nextVisitNote')}
              </Field>
            </div>
            <div className="row vs-quick" role="group" aria-label="Quick dates">
              {suggested && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNextVisit(toDateInput(suggested.dueFrom))}>
                  <CalendarDays aria-hidden="true" /> Care plan: {suggested.name} · {windowText(suggested.dueFrom, suggested.dueBy)}
                </button>
              )}
              {quick.map(([label, days]) => (
                <button key={label} type="button" className="btn btn-link" onClick={() => setNextVisit(toDateInput(addDays(visit.visitOn, days)))}>
                  In {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p>
            {visit.details.nextVisitOn ? formatDate(visit.details.nextVisitOn) : '—'}
            {visit.details.nextVisitNote ? ` – ${visit.details.nextVisitNote}` : ''}
          </p>
        )}
        <NextVisitBooking booking={page.booking} saved={Boolean(visit.details.nextVisitOn)} />
      </section>

      {plan && (
        <section className="card vs-section" aria-labelledby="vs-plan">
          <h2 id="vs-plan">Care plan at this visit</h2>
          {plan.label && <p className="hint">The care plan is a draft – not approved for clinical use.</p>}
          {plan.doneHere.length > 0 && (
            <ul className="plain-list vs-plan-list">
              {plan.doneHere.map((i) => (
                <li key={i.id}>
                  <StatusPill tone="stable" icon={Check}>
                    Done at this visit
                  </StatusPill>{' '}
                  {i.name}
                </li>
              ))}
            </ul>
          )}
          {canEdit && plan.canTick ? (
            plan.dueNow.length ? (
              <fieldset className="fieldset">
                <legend>Tick what was done at this visit – it is marked done in the care plan on {formatDate(visit.visitOn)}.</legend>
                {nowItems.map(tickRow)}
                {nowItems.length === 0 && <p className="muted">Nothing is due now.</p>}
                {lateItems.length > 0 && (
                  <details className="vs-late" open={lateItems.length <= 3 || lateItems.some((i) => ticked.includes(i.id))}>
                    <summary>
                      Overdue from earlier <span className="tabular">({lateItems.length})</span>
                    </summary>
                    {lateItems.map(tickRow)}
                  </details>
                )}
              </fieldset>
            ) : (
              <p className="muted">Nothing in the care plan is due now.</p>
            )
          ) : (
            plan.dueNow.length > 0 && (
              <>
                <p className="hint">
                  {canEdit
                    ? 'Due in the care plan now. The care plan is closed, so nothing can be marked done here.'
                    : `Due in the care plan now. Only the patient's doctor or an RMO can mark ${plan.dueNow.length === 1 ? 'it' : 'them'} done.`}
                </p>
                {nowItems.length > 0 && <ul className="plain-list vs-plan-list">{nowItems.map(dueRow)}</ul>}
                {lateItems.length > 0 && (
                  <details className="vs-late" open={lateItems.length <= 3}>
                    <summary>
                      Overdue from earlier <span className="tabular">({lateItems.length})</span>
                    </summary>
                    <ul className="plain-list vs-plan-list">{lateItems.map(dueRow)}</ul>
                  </details>
                )}
              </>
            )
          )}
        </section>
      )}

      {(canVitals || canEdit) && (
        <div className="sticky-actions">
          {recording && <VoiceBar status={voiceStatus} onStop={() => voiceControl.current?.stop()} />}
          <span className="grow hint">
            {edited
              ? 'Unsaved changes.'
              : ticked.length
                ? `${ticked.length} care-plan ${ticked.length === 1 ? 'item' : 'items'} ticked – press Save visit to mark ${ticked.length === 1 ? 'it' : 'them'} done.`
                : 'All changes saved.'}
          </span>
          {printAction}
          <button title="Ctrl+Enter saves · Enter moves to the next box" type="submit" className="btn btn-primary" disabled={saving || !toSave || recording} aria-describedby={recording ? 'vs-save-wait' : undefined}>
            {saving ? 'Saving…' : canEdit ? 'Save visit' : 'Save vital signs'}
          </button>
          {recording && (
            <span id="vs-save-wait" className="hint voice-save-wait">
              Stop recording before saving.
            </span>
          )}
        </div>
      )}
    </form>
  );
}
