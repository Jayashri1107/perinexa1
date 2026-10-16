import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BadgeCheck, CircleMinus, FileSearch, FileText, Languages, MoreHorizontal, Pill, Printer, Sparkles } from 'lucide-react';
import { Link, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { addDays, gaOn, gaText, windowText } from '../patients/carePlanFormat.js';
import { patientWhat } from '../patients/carePlanPrintFormat.js';
import { ageText, allergyPrintLine, formatGpla } from '../patients/patientFormat.js';
import { RISK_SHORT } from '../patients/riskFormat.js';
import { AiCheckDialog } from '../ai/AiCheckDialog.jsx';
import { AiSummaryCard } from '../ai/AiSummaryCard.jsx';
import { FindingOffers } from './FindingOffers.jsx';
import { LossFindingsCard } from './LossFindingsCard.jsx';
import { RedFlagCard } from '../redflags/RedFlagList.jsx';
import { flagsElsewhere } from '../redflags/redFlagFormat.js';
import { PrescriptionForm } from './PrescriptionForm.jsx';
import { RxDocument, rxPage } from './RxDocument.jsx';
import { VisitDetailsForm } from './VisitDetailsForm.jsx';
import { AdditionsCard, SignDialog, SignedPill, VisitHistory, signedText } from './VisitSignature.jsx';
import { DESIGNS } from './rxFormat.js';
import { useVisitDraft } from './visitDraft.js';
import { blobToBase64, showWhatsappNumber, whatsappLink, whatsappNumber } from './whatsapp.js';

// One visit (Feature 8), with its two tabs: Visit details and Prescription (?tab=prescription). Both stay
// mounted, so switching tabs never loses what was typed. "Print or share" (at the top, and next to Save on both
// tabs) prints the saved visit – the prescription, or the visit summary when no medicines are given – signed by
// the doctor who wrote it and in that doctor's design (their own choice on My settings → Prescription design), or
// saves it as a PDF to send to the patient or to print elsewhere. Unsaved changes are saved first ("Save and
// print"), so the paper always matches the record. "Sign and finish" (the treating doctor or an RMO) saves what is
// not saved yet and locks the visit; corrections are then added below it (VisitSignature.jsx).

const MS_DAY = 86_400_000;
// A visit's red flags as one text, to see whether a save changed them
const flagKeys = (redFlags) => (redFlags?.flags ?? []).map((f) => `${f.key}:${f.detail}`).join('|');
const DUE_HORIZON_DAYS = 28; // without a next-visit date, "due by the next visit" looks 4 weeks ahead

function CancelDialog({ patient, visit, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Please say why (at least 5 characters).');
    if (patient.careType !== 'newborn' && mentionsFetalSex(reason)) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    try {
      onDone(await api(`/patients/${patient.id}/visits/${visit.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } }));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-cancel-title" onSubmit={submit} noValidate>
        <h2 id="vs-cancel-title">Mark this visit as entered in error?</h2>
        <p>The visit is kept, but it can no longer be changed or printed. Care-plan items ticked at it stay done – reopen them on the Care plan tab if needed.</p>
        <Field label="Why" id="vs-cancel-reason" error={error} hint="e.g. Started for the wrong patient">
          <input id="vs-cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={saving}>
            {saving ? 'Saving…' : 'Mark as entered in error'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The printout of a visit, as saved: the prescription, or the visit summary (the same page without the medicines –
 * always when none were given). Signed by the doctor who wrote it (the prescription, else the doctor's notes –
 * page.prescriber) and in that doctor's design, whoever prints it. Also as a PDF, e.g. to send to the patient or to
 * reception when the printer in this room is not working.
 */
function VisitPrintPreview({ patient, page, copy, onCopy, onClose, aiNote = null }) {
  const { user, activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const [printedAt] = useState(() => new Date());
  const v = page.visit;
  const doctor = page.prescriber;
  const design = doctor.design;
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const antenatal = patient.careType === 'antenatal';
  const edd = patient.pregnancy?.effectiveEdd ?? null;
  const pregnancy =
    antenatal && patient.pregnancy
      ? {
          lmp: patient.pregnancy.lmp,
          edd,
          eddSource: patient.pregnancy.scanEdd ? 'scan' : 'LMP',
          gpla: formatGpla(patient.obstetric),
          bloodGroup: patient.medical?.bloodGroup ?? '',
          risk: RISK_SHORT[patient.risk?.level] ?? '',
        }
      : null;
  const limit = new Date(v.details.nextVisitOn ?? addDays(page.today, DUE_HORIZON_DAYS)).getTime() + MS_DAY - 1;
  const nextDue = (page.carePlan?.upcoming ?? [])
    .filter((i) => new Date(i.dueFrom).getTime() <= limit)
    .map((i) => ({ text: patientWhat(i, patient.careType), when: windowText(i.dueFrom, i.dueBy) }));
  const overdue = design.show.planItems ? (page.carePlan?.overdue ?? 0) : 0;
  const ownDesign = doctor.id === user.id;
  const medicines = v.prescription.items.length > 0;
  const kind = medicines && copy !== 'summary' ? 'prescription' : 'summary';
  const what = kind === 'summary' ? 'Visit summary' : 'Prescription';
  const record = (as) => api(`/patients/${patient.id}/visits/${v.id}/printed`, { method: 'POST', body: { copy: kind, as } });
  // The file's name has the patient number, never the name (it shows in download lists and chats). WhatsApp: a chat
  // with the mobile number on the record, to attach the PDF.
  const mobile = whatsappNumber(patient.phone);
  const offer = useFetch(mobile ? `/patients/${patient.id}/visits/${v.id}/whatsapp` : null);
  const pdf = {
    fileName: `${what} ${patient.mrn} ${formatDate(v.visitOn)}.pdf`,
    title: `${what} ${patient.mrn}`,
    onSaved: (way) => record(way === 'whatsapp' ? 'whatsapp' : 'pdf'),
    // (never for a closed record: it gets no message of any kind – print it, or save the PDF)
    whatsapp: mobile && !patient.closed ? { href: whatsappLink(mobile), label: showWhatsappNumber(mobile) } : null,
    // In one click from the hospital's own WhatsApp number, when that is set up and she agreed to WhatsApp messages
    sendNow:
      mobile && offer.data?.available
        ? {
            label: showWhatsappNumber(mobile),
            practice: offer.data.practice,
            send: async (blob) => api(`/patients/${patient.id}/visits/${v.id}/whatsapp`, { method: 'POST', body: { copy: kind, pdf: await blobToBase64(blob) } }),
          }
        : null,
  };

  const hint = (
    <>
      {DESIGNS[design.design].name}
      {ownDesign ? '' : ` – ${doctor.name}'s design`}.{kind === 'summary' ? ' The visit summary: the visit’s details, without medicines.' : ''} Check the page, then print it
      on {rxPage(design)?.size ?? 'A4'} paper or save it as a PDF.
      {patient.phone !== undefined && !mobile ? ' To send it on WhatsApp, add a mobile number to the patient’s details.' : ''}
      {overdue > 0 && ` ${overdue} overdue care-plan ${overdue === 1 ? 'item is' : 'items are'} not printed – write any still needed under Tests advised.`}
      {!doctor.professional?.registrationNumber && ` ${ownDesign ? 'Your' : `${doctor.name}'s`} registration number is missing (My settings → Professional details).`}{' '}
      {ownDesign && (
        <Link to="/account/prescription-design" className="btn btn-link plan-inline-link">
          Change my design
        </Link>
      )}
    </>
  );

  // With medicines, the visit summary can be printed instead (e.g. for the patient's file)
  const controls = (
    <>
      {/* The AI check could not run: said here, on the screen where the decision to print is made */}
      {aiNote && kind === 'prescription' && <Alert type="warning">{aiNote}</Alert>}
      {medicines && (
        <div className="segmented pv-controls" role="group" aria-label="What to print">
          <button type="button" aria-pressed={kind === 'prescription'} onClick={() => onCopy('prescription')}>
            <Pill aria-hidden="true" /> Prescription
          </button>
          <button type="button" aria-pressed={kind === 'summary'} onClick={() => onCopy('summary')}>
            <FileText aria-hidden="true" /> Visit summary
          </button>
        </div>
      )}
    </>
  );

  return (
    <PrintPreview
      title={`${what} – print preview`}
      hint={hint}
      controls={controls}
      page={rxPage(design)}
      onPrint={() => record('paper')}
      pdf={pdf}
      fit
      docKey={lh.loading ? null : kind}
      onClose={onClose}
    >
      {/* After the letterhead has loaded (or failed to – then the hospital's name alone) */}
      {!lh.loading && (
        <RxDocument
          copy={kind}
          design={design}
          letterhead={letterhead}
          doctor={doctor}
          patient={{ fullName: patient.fullName, ageText: ageText(patient), mrn: patient.mrn, careType: patient.careType, allergies: allergyPrintLine(patient) }}
          visit={{
            visitOn: v.visitOn,
            ga: antenatal && edd ? gaOn(edd, v.visitOn) : null,
            vitals: v.vitals,
            details: v.details,
            items: v.prescription.items,
            notes: v.prescription.notes,
          }}
          pregnancy={pregnancy}
          nextDue={nextDue}
          planLabel={page.carePlan?.label ?? null}
          printedAt={printedAt}
          printedByName={user.name}
        />
      )}
    </PrintPreview>
  );
}

export function VisitPage() {
  const { patient, reload: reloadPatient } = useOutletContext();
  const { visitId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'prescription' ? 'prescription' : 'details';
  const { activeMembership } = useAuth();
  const { data, error, loading, reload } = useFetch(`/patients/${patient.id}/visits/${visitId}`);
  // The answer of the latest save, shown until the next load.
  const [latest, setLatest] = useState(null);
  const [keys, setKeys] = useState({ details: 0, rx: 0 });
  const [pendingReset, setPendingReset] = useState(null); // a part to start again from the next load
  const [dirty, setDirty] = useState({ details: false, rx: false });
  const [notice, setNotice] = useState(null);
  const [printing, setPrinting] = useState(null); // { copy, page } while the print preview is open
  const [preparing, setPreparing] = useState(false); // saving (or checking) before printing: false | 'saving' | 'checking'
  const [aiCheck, setAiCheck] = useState(null); // what the AI check found: { key, issues, page }
  const [cancelling, setCancelling] = useState(false);
  const [showSummary, setShowSummary] = useState(false); // the AI summary card, when chosen from AI tools
  const [signing, setSigning] = useState(null); // the saved page to sign, while the Sign dialog is open
  const detailsForm = useRef(null); // { pending(), save() } of each tab, to save before printing
  const rxForm = useRef(null);
  // Tests and advice of a ready-made set, on their way from the Prescription tab to Visit details.
  const [detailsAppend, setDetailsAppend] = useState(null);
  const recent = useFetch(hasRole(activeMembership, 'doctor', 'rmo') ? '/prescription-design/recent-medicines' : null);
  const appendToDetails = useCallback((a) => setDetailsAppend({ ...a, at: Date.now() }), []);
  const appended = useCallback(() => setDetailsAppend(null), []);
  // A medicine from the care plan (Overview card: Add to prescription), on its way to the Prescription tab.
  const [medicineAdd, setMedicineAdd] = useState(null);
  const medicineAdded = useCallback(() => setMedicineAdd(null), []);
  const location = useLocation();
  const navigate = useNavigate();
  // Nothing gets lost (doctor ideas #4): unsaved typing kept as the person's draft, offered back on opening
  const drafts = useVisitDraft(patient.id, visitId);

  useEffect(() => {
    setLatest(null);
    if (pendingReset) {
      setKeys((k) => ({ ...k, [pendingReset]: k[pendingReset] + 1 }));
      setPendingReset(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new load arrives
  }, [data]);

  const onDirtyDetails = useCallback((d) => setDirty((x) => (x.details === d ? x : { ...x, details: d })), []);
  const onDirtyRx = useCallback((d) => setDirty((x) => (x.rx === d ? x : { ...x, rx: d })), []);
  const anyDirty = dirty.details || dirty.rx;
  useEffect(() => {
    if (!anyDirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  const page = latest ?? data;

  // "Add to prescription" on the Overview's care plan card: the item goes to Tests advised (tests, scans), Advice
  // (vaccinations, advice) or the medicines, unsaved – the doctor checks it and saves. Once only: the note is
  // cleared from the page's history entry, so going back or reloading doesn't add it again.
  const fromPlan = location.state?.fromPlan ?? null;
  const pageReady = Boolean(page?.visit && page.visit.id === visitId);
  useEffect(() => {
    if (!fromPlan || !pageReady) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    if (page.visit.status !== 'active' || !page.access.canEdit) {
      setNotice({ type: 'warning', text: `${fromPlan.name} was not added: you can't change this visit.` });
      return;
    }
    const where =
      fromPlan.kind === 'medication'
        ? 'the medicines – add the dose and how long'
        : fromPlan.kind === 'investigation' || fromPlan.kind === 'scan'
          ? 'Tests advised'
          : 'Advice';
    if (fromPlan.kind === 'medication') setMedicineAdd({ name: fromPlan.name, at: Date.now() });
    else if (fromPlan.kind === 'investigation' || fromPlan.kind === 'scan') appendToDetails({ investigations: fromPlan.name });
    else appendToDetails({ advice: fromPlan.name });
    setNotice({ type: 'info', text: `Added from the care plan to ${where}: ${fromPlan.name}. Check it and save.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the visit has loaded
  }, [fromPlan, pageReady]);
  if (error && !page) {
    return (
      <div className="card">
        <Alert type="error">{error}</Alert>
        <Link to={`/patients/${patient.id}/visits`} className="btn btn-link">
          <ArrowLeft aria-hidden="true" /> All visits
        </Link>
      </div>
    );
  }
  if (!page || (loading && !latest && data?.visit?.id !== visitId)) {
    return (
      <div className="card plan-loading" aria-busy="true">
        <span className="sr-only">Loading the visit…</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="plan-skeleton" />
        ))}
      </div>
    );
  }

  const v = page.visit;
  const active = v.status === 'active';
  const edd = patient.pregnancy?.effectiveEdd ?? null;
  const ga = patient.careType === 'antenatal' && edd ? gaText(gaOn(edd, v.visitOn)) : '';
  const setTab = (t) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (t === 'details') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  const saved = (part) => (res, message) => {
    // The red flags of this visit changed with this save: the "Red flag" pill in the page header follows
    const flagsChanged = flagKeys(res?.redFlags) !== flagKeys(page?.redFlags);
    setLatest(res);
    setKeys((k) => ({ ...k, [part]: k[part] + 1 }));
    setNotice({ type: 'success', text: message });
    // Items done at this visit change the care plan shown on the Overview; new vital signs can change her record:
    // the risk level in the page header, and also – with the level unchanged – its reasons, the readings and
    // "override needs review" on the Overview. The server says when anything changed (recordChanged); the record
    // is not read again otherwise.
    if ((part === 'details' && /care-plan/.test(message)) || res?.recordChanged || res?.riskChanged || flagsChanged) reloadPatient();
  };
  const conflict = (part) => (message) => {
    setNotice({ type: 'warning', text: message });
    setPendingReset(part);
    reload();
  };
  const planConflict = (message) => {
    setNotice({ type: 'warning', text: message });
    reload();
  };

  // What is not saved yet is saved first (each tab shows what to fix). The latest saved page, or null when something
  // could not be saved (then = what to press again).
  const saveAll = async (then) => {
    let fresh = page;
    for (const [form, where] of [
      [detailsForm, 'details'],
      [rxForm, 'prescription'],
    ]) {
      if (!form.current?.pending()) continue;
      const res = await form.current.save();
      if (res === 'recording') {
        setTab('details');
        setNotice({ type: 'info', text: `The recording was stopped and what was said is filled in. Check it, then press ${then} again.` });
        return null;
      }
      if (!res) {
        setTab(where);
        return null;
      }
      fresh = res;
    }
    return fresh;
  };

  // Print or share: saved first, so the paper matches the record
  const startPrint = async () => {
    if (preparing) return;
    setPreparing('saving');
    setNotice(null);
    try {
      const fresh = await saveAll('Save and print');
      if (!fresh) return;
      if (!fresh.prescriber) {
        setNotice({ type: 'info', text: 'Nothing to print yet – a doctor or RMO needs to save the notes or the prescription first.' });
        return;
      }
      const copy = fresh.visit.prescription.items.length ? 'prescription' : 'summary';
      // The AI check (Smart features): the saved prescription, before printing or sharing. It never stops printing –
      // if it can't run, the preview opens and says so (never skipped silently).
      let aiNote = null;
      if (copy === 'prescription' && (fresh.access.canCheckPrescription ?? fresh.access.canEdit)) {
        setPreparing('checking');
        try {
          const check = await api(`/patients/${patient.id}/visits/${fresh.visit.id}/ai-check`, { method: 'POST' });
          if (check.issues?.length) {
            setAiCheck({ ...check, page: fresh });
            return;
          }
        } catch (err) {
          aiNote =
            err.status === 503
              ? 'AI check not done: the AI service is not set up or not available. Check every medicine, dose and allergy yourself before printing.'
              : `AI check not done (${err.message}). Check every medicine, dose and allergy yourself before printing.`;
        }
      }
      setPrinting({ copy, page: fresh, aiNote });
    } finally {
      setPreparing(false);
    }
  };
  // Sign and finish: saved first, then the dialog signs exactly that version.
  const startSign = async () => {
    if (preparing) return;
    setPreparing('saving');
    setNotice(null);
    try {
      const fresh = await saveAll('Sign and finish');
      if (!fresh) return;
      if (!fresh.prescriber) {
        setNotice({ type: 'info', text: 'Nothing to sign yet – write and save the notes or the prescription first.' });
        return;
      }
      setSigning(fresh);
    } finally {
      setPreparing(false);
    }
  };

  // AI tools (Smart features), in one menu: the summary before seeing her, translating the advice, reading a report.
  const openAi = (kind) => {
    setTab('details');
    const r = detailsForm.current?.openAi(kind);
    if (r === 'no-advice') setNotice({ type: 'info', text: 'Write the advice for the patient first (Visit details), then translate it.' });
  };
  const aiTools =
    active && page.access.canEdit
      ? [
          { label: 'Summary before you see her', icon: FileText, onSelect: () => setShowSummary(true) },
          { label: 'Translate the advice for her', icon: Languages, onSelect: () => openAi('translate') },
          { label: 'Read a lab or scan report', icon: FileSearch, onSelect: () => openAi('report') },
        ]
      : [];

  const printButton = (
    <button type="button" className="btn btn-secondary" onClick={startPrint} disabled={!active || preparing || (!anyDirty && !page.prescriber)}>
      <Printer aria-hidden="true" /> {preparing === 'checking' ? 'Checking with AI…' : preparing ? 'Saving…' : anyDirty ? 'Save and print' : 'Print or share'}
    </button>
  );

  return (
    <div className="vs-page">
      <section className="card vs-visit-head">
        <div className="vs-visit-top">
          <Link to={`/patients/${patient.id}/visits`} className="btn btn-link vs-back">
            <ArrowLeft aria-hidden="true" /> All visits
          </Link>
          <div className="row">
            {page.access.canSign && (
              <button type="button" className="btn btn-positive" onClick={startSign} disabled={Boolean(preparing)}>
                <BadgeCheck aria-hidden="true" /> {anyDirty ? 'Save, sign and finish' : 'Sign and finish'}
              </button>
            )}
            {printButton}
            {aiTools.length > 0 && <MenuButton className="btn btn-secondary" icon={Sparkles} label="AI tools" items={aiTools} align="end" />}
            {active && (page.access.canCancel ?? page.access.canEdit) && (
              <MenuButton
                className="btn btn-secondary"
                icon={MoreHorizontal}
                label="More"
                ariaLabel="More actions for this visit"
                align="end"
                items={[{ label: 'Mark as entered in error', icon: CircleMinus, danger: true, onSelect: () => setCancelling(true) }]}
              />
            )}
          </div>
        </div>
        <div className="vs-visit-title">
          <h2>Visit · {formatDate(v.visitOn)}</h2>
          {ga && <span className="tabular vs-ga">{ga}</span>}
          {!active && (
            <StatusPill tone="inactive" icon={CircleMinus}>
              Entered in error
            </StatusPill>
          )}
          {active && <SignedPill signed={v.signed} />}
        </div>
        <p className="hint">
          Started by {v.createdByName} · {formatDateTime(v.createdAt)}
          {v.signed ? ` · ${signedText(v.signed)}` : ''}
          {active && !anyDirty && !page.prescriber ? ' · Nothing to print yet – a doctor or RMO needs to save the notes or the prescription first.' : ''}
        </p>
        <div className="segmented vs-tabs" role="group" aria-label="Visit">
          <button type="button" aria-pressed={tab === 'details'} onClick={() => setTab('details')}>
            <FileText aria-hidden="true" /> Visit details{dirty.details ? ' •' : ''}
          </button>
          <button type="button" aria-pressed={tab === 'prescription'} onClick={() => setTab('prescription')}>
            <Pill aria-hidden="true" /> Prescription ({v.prescription.items.length}){dirty.rx ? ' •' : ''}
          </button>
        </div>
      </section>

      {!active && (
        <Alert type="info">
          Marked as entered in error by {v.cancelled?.byName} on {formatDate(v.cancelled?.at)}: {v.cancelled?.reason}
        </Alert>
      )}
      {/* Unsaved typing from earlier (doctor ideas #4): put it back, or let it go */}
      {drafts.found && active && !v.signed && (
        <Alert type="info">
          <span className="vs-draft">
          <span>
            You have unsaved changes on this visit from {formatDateTime(drafts.found.savedAt)}
            {drafts.found.details && drafts.found.rx ? ' (visit details and prescription)' : drafts.found.rx ? ' (prescription)' : ' (visit details)'}.
          </span>
          <span className="row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                drafts.restoreNow();
                setKeys((k) => ({ details: k.details + 1, rx: k.rx + 1 }));
                setNotice({ type: 'info', text: 'Your unsaved changes are back. Check them, then save.' });
              }}
            >
              Restore them
            </button>
            <button type="button" className="btn btn-link btn-sm" onClick={drafts.discard}>
              Discard
            </button>
          </span>
          </span>
        </Alert>
      )}
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <AdditionsCard
        patient={patient}
        page={page}
        onAdded={(res) => {
          setLatest(res);
          setNotice({ type: 'success', text: 'Correction added.' });
        }}
      />
      {/* Red flags from the values saved at this visit (they update after each save) */}
      <RedFlagCard redFlags={page.redFlags} patientId={patient.id} about="From the values saved at this visit" />
      {/* What the record has besides: flags from lab results, from the nursing chart, or from another visit */}
      <RedFlagCard
        redFlags={{ flags: flagsElsewhere(patient.redFlags?.flags, page.redFlags?.flags), rules: patient.redFlags?.rules }}
        patientId={patient.id}
        title="Other red flags on the record"
        titleId="rf-other-title"
        about={patient.careType === 'abortion' ? 'From her record, lab results, the nursing chart or another visit' : 'From lab results, the nursing chart or another visit'}
      />
      {/* A finding of this pregnancy the saved vital signs suggest: the doctor or RMO adds it with one click */}
      <FindingOffers
        patient={patient}
        page={page}
        onAdded={(text) => {
          setNotice({ type: 'success', text });
          reloadPatient();
          reload();
        }}
      />
      {/* Pregnancy-loss care: the findings on her record (os, scan, signs of rupture, bleeding, fever), recorded from here */}
      <LossFindingsCard
        patient={patient}
        page={page}
        onSaved={(text) => {
          setNotice({ type: 'success', text });
          reloadPatient();
          reload();
        }}
      />
      {/* Smart features: a few lines to read before seeing her (made by AI only when the doctor asks) */}
      {showSummary && active && page.access.canEdit && <AiSummaryCard patientId={patient.id} className="vs-ai" />}

      <div hidden={tab !== 'details'}>
        <VisitDetailsForm
          ref={detailsForm}
          key={`details-${keys.details}`}
          patient={patient}
          page={page}
          onSaved={saved('details')}
          onConflict={conflict('details')}
          onPlanConflict={planConflict}
          onDirty={onDirtyDetails}
          append={detailsAppend}
          onAppended={appended}
          shown={tab === 'details'}
          draft={drafts.restore?.details ?? null}
          onDraft={drafts.onDetails}
        />
      </div>
      <div hidden={tab !== 'prescription'}>
        <PrescriptionForm
          ref={rxForm}
          key={`rx-${keys.rx}`}
          patient={patient}
          page={page}
          recent={recent.data?.medicines}
          onSaved={saved('rx')}
          onConflict={conflict('rx')}
          onDirty={onDirtyRx}
          draft={drafts.restore?.rx ?? null}
          onDraft={drafts.onRx}
          onAppendDetails={appendToDetails}
          addMedicine={medicineAdd}
          onMedicineAdded={medicineAdded}
          canAddSets={hasRole(activeMembership, 'doctor')}
          onRecheckPatient={reloadPatient}
        />
      </div>

      <VisitHistory patient={patient} visitId={v.id} version={v.updatedAt} />

      {signing && (
        <SignDialog
          patient={patient}
          page={signing}
          onCancel={() => setSigning(null)}
          onDone={(res) => {
            setSigning(null);
            setLatest(res);
            setKeys((k) => ({ details: k.details + 1, rx: k.rx + 1 }));
            setNotice({ type: 'success', text: 'The visit is signed and finished. Corrections can be added below.' });
          }}
        />
      )}
      {aiCheck && (
        <AiCheckDialog
          patientId={patient.id}
          visitId={aiCheck.page.visit.id}
          check={aiCheck}
          onCorrect={() => {
            setAiCheck(null);
            setTab('prescription');
          }}
          onPrint={() => {
            setPrinting({ copy: 'prescription', page: aiCheck.page });
            setAiCheck(null);
          }}
        />
      )}
      {printing && (
        <VisitPrintPreview
          patient={patient}
          page={printing.page}
          copy={printing.copy}
          aiNote={printing.aiNote}
          onCopy={(copy) => setPrinting((p) => ({ ...p, copy }))}
          onClose={() => setPrinting(null)}
        />
      )}
      {cancelling && (
        <CancelDialog
          patient={patient}
          visit={v}
          onCancel={() => setCancelling(false)}
          onDone={(res) => {
            setCancelling(false);
            setLatest(res);
            setKeys((k) => ({ details: k.details + 1, rx: k.rx + 1 }));
            setNotice({ type: 'success', text: 'The visit is marked as entered in error.' });
            if (res?.recordChanged || res?.riskChanged) reloadPatient(); // its readings no longer count for the risk level
          }}
        />
      )}
    </div>
  );
}
