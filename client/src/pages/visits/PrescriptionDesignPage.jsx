import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Maximize2, Save } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { accountTabs } from '../../platform/modules.js';
import { RxDocument } from './RxDocument.jsx';
import { ACCENT_NAMES, DESIGNS, LANGUAGE_CHOICES, RX_ACCENTS, RX_DESIGNS, RX_LABELS, RX_SHOW, RX_TITLES, SHOW_LABELS } from './rxFormat.js';
import { SAMPLE } from './rxSample.js';

// My settings → Prescription design (doctors and RMOs): choose one of the 10 designs for your printed
// prescriptions at this hospital, then make it yours – colour, text size, paper, the language of the
// instructions, what to print, your specialities and timings, and margins for your own printed pad. The
// previews use a fake sample visit, your own name and registration details, and the hospital's letterhead.
// Each design's card shows its whole page; clicking it opens that page at the size it prints, to read it and
// flip through the designs (Previous / Next, or ← →) before choosing one.

const PREVIEW_AT = new Date('2026-09-28T10:30:00');

function Sample({ design, letterhead, user }) {
  return (
    <RxDocument
      design={design}
      letterhead={letterhead}
      doctor={{ name: user.name, professional: user.professional ?? {} }}
      patient={SAMPLE.patient}
      visit={{ ...SAMPLE.visit, notes: SAMPLE.visit.notes }}
      pregnancy={SAMPLE.pregnancy}
      nextDue={SAMPLE.nextDue}
      printedAt={PREVIEW_AT}
      printedByName={user.name}
    />
  );
}

// A design as the page would print it with the doctor's own choices; the half page is always A5
const withDesign = (form, key) => ({ ...form, design: key, ...(key === 'half_page' ? { paper: 'A5' } : {}) });
const isA5 = (d) => d.design === 'half_page' || d.paper === 'A5';

/** The sample on a whole sheet of the design's paper – for "Your own printed pad", grey bands where the pad's own print is. */
function SamplePage({ className, design, letterhead, user }) {
  const pad = design.design === 'preprinted';
  return (
    <span className={[className, isA5(design) ? 'rxd-a5' : '', pad ? 'rxd-pad' : ''].filter(Boolean).join(' ')}>
      {pad && <span className="rxd-pad-band" style={{ height: `${Number(design.marginTopMm) || 0}mm` }} aria-hidden="true" />}
      <Sample design={design} letterhead={letterhead} user={user} />
      {pad && <span className="rxd-pad-band rxd-pad-band-bottom" style={{ height: `${Number(design.marginBottomMm) || 0}mm` }} aria-hidden="true" />}
    </span>
  );
}

/**
 * One design's whole page at the size it prints, over the page, to read before choosing: Previous / Next (or ← →)
 * go through the 10 designs; "Use this design" chooses the one shown.
 */
function DesignPreview({ form, index, onIndex, onChoose, onClose, letterhead, user }) {
  const ref = useDialogFocus(onClose);
  const key = RX_DESIGNS[index];
  const last = RX_DESIGNS.length - 1;
  const chosen = form.design === key;

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < last) onIndex(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, last, onIndex]);
  // Each design from the top of its page
  useEffect(() => {
    ref.current?.scrollTo?.({ top: 0 });
  }, [index, ref]);

  return createPortal(
    <div ref={ref} tabIndex={-1} className="pv rxd-full" role="dialog" aria-modal="true" aria-labelledby="rxd-full-title">
      <div className="pv-bar">
        <div className="pv-bar-text">
          <h2 id="rxd-full-title">{DESIGNS[key].name}</h2>
          <p className="hint help">{DESIGNS[key].about}</p>
          <p className="hint help">
            Design {index + 1} of {RX_DESIGNS.length}, at the size it prints: a fake sample visit with your name and the hospital’s letterhead, in your colour, text
            size and language.{key === 'preprinted' ? ' The grey bands stand for your pad’s own printed header and footer.' : ''}
          </p>
        </div>
        <div className="row pv-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onIndex(index - 1)} disabled={index === 0}>
            <ChevronLeft aria-hidden="true" /> Previous
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onIndex(index + 1)} disabled={index === last}>
            Next <ChevronRight aria-hidden="true" />
          </button>
          {chosen ? (
            <StatusPill tone="stable" icon={Check}>
              Chosen
            </StatusPill>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => onChoose(key)}>
              <Check aria-hidden="true" /> Use this design
            </button>
          )}
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <SamplePage className="pv-sheet rxd-full-sheet" design={withDesign(form, key)} letterhead={letterhead} user={user} />
    </div>,
    document.body,
  );
}

const FONT_CHOICES = [
  ['standard', 'Perinexa (standard)'],
  ['sans', 'Plain (Arial)'],
  ['serif', 'Classic serif (Georgia)'],
];
const SPACING_CHOICES = [
  ['compact', 'Compact'],
  ['standard', 'Standard'],
  ['relaxed', 'Relaxed'],
];
const TITLE_LABELS = {
  medicines: 'Medicines (Minimal design)',
  instructions: 'Instructions',
  tests: 'Tests advised',
  advice: 'Advice',
  nextVisit: 'Next visit',
};
// An empty number box: null (as the design prints it)
const orNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export function PrescriptionDesignPage() {
  const { user, activeMembership, memberships } = useAuth();
  const prescriber = hasRole(activeMembership, 'doctor', 'rmo');
  const { data, error: loadError } = useFetch(prescriber ? '/prescription-design' : null);
  const lh = useFetch(prescriber ? '/tenant/settings/letterhead' : null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(null); // the design whose whole page is open (its index)

  useEffect(() => {
    if (data?.design && !form) setForm(data.design);
  }, [data, form]);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'My settings', to: '/account' }, { label: 'Prescription design' }]}
      title="Prescription design"
      subtitle={
        activeMembership
          ? `How your prescriptions look when printed at this hospital. Choose one of the 10 designs, then make it yours.`
          : 'How your prescriptions look when printed.'
      }
      tabs={accountTabs(memberships)}
    />
  );

  if (!prescriber) {
    return (
      <>
        {header}
        <div className="pf-content">
          <div className="card narrow">Prescription designs are for doctors and RMOs, in the hospital where they prescribe.</div>
        </div>
      </>
    );
  }
  if (loadError) {
    return (
      <>
        {header}
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">Couldn't load your design. {loadError}</Alert>
          </div>
        </div>
      </>
    );
  }
  if (!form) return <FullPageSpinner />;

  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const set = (changes) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...changes }));
  };
  const setShow = (key) => (e) => set({ show: { ...form.show, [key]: e.target.checked } });
  const halfPage = form.design === 'half_page';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const { saved: _s, ...body } = form;
      const res = await api('/prescription-design', {
        method: 'PUT',
        body: {
          ...body,
          marginTopMm: Number(body.marginTopMm) || 0,
          marginBottomMm: Number(body.marginBottomMm) || 0,
          bodyPt: orNull(body.bodyPt),
          medicinePt: orNull(body.medicinePt),
          doctorPt: orNull(body.doctorPt),
          marginSideMm: orNull(body.marginSideMm),
        },
      });
      setForm(res.design);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {header}
      <form className="pf-content rxd" onSubmit={save} noValidate>
        <Alert type="success" onClose={() => setSaved(false)}>
          {saved && 'Design saved. Your prescriptions print this way from now on.'}
        </Alert>
        <Alert type="error">{error && `Couldn't save the design. ${error}`}</Alert>
        {!user.professional?.registrationNumber && (
          <Alert type="warning">
            Your registration number is not in your professional details yet. Prescriptions should show it – add it in My settings → Professional details.
          </Alert>
        )}

        <section className="card rxd-section" aria-labelledby="rxd-choose">
          <h2 id="rxd-choose">1. Choose a design</h2>
          <p className="hint help">
            Click a design to see its whole page at the size it prints, then choose it with Use this design. Each page uses a fake sample visit with your
            name and the hospital&apos;s letterhead.
          </p>
          <ul className="rxd-gallery" aria-label="Designs">
            {RX_DESIGNS.map((key, i) => {
              const chosen = form.design === key;
              const design = withDesign(form, key);
              return (
                // The whole card opens the page; its button does the same for the keyboard
                <li key={key} className={`rxd-card ${chosen ? 'checked' : ''}`.trim()} onClick={() => setLooking(i)}>
                  <span className="rxd-thumb" aria-hidden="true">
                    <span className={`rxd-thumb-frame ${isA5(design) ? 'rxd-a5' : ''}`.trim()}>
                      <SamplePage className="rxd-thumb-sheet" design={design} letterhead={letterhead} user={user} />
                    </span>
                  </span>
                  <span className="rxd-card-text">
                    <strong>{DESIGNS[key].name}</strong>
                    {chosen && (
                      <StatusPill tone="stable" icon={Check}>
                        Chosen
                      </StatusPill>
                    )}
                    <small>{DESIGNS[key].about}</small>
                    <button
                      type="button"
                      className="btn btn-link rxd-card-open"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLooking(i);
                      }}
                    >
                      <Maximize2 aria-hidden="true" /> See the whole page<span className="sr-only">: {DESIGNS[key].name}</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        {looking !== null && (
          <DesignPreview
            form={form}
            index={looking}
            onIndex={setLooking}
            onChoose={(key) => {
              set(withDesign(form, key));
              setLooking(null);
            }}
            onClose={() => setLooking(null)}
            letterhead={letterhead}
            user={user}
          />
        )}

        <div className="rxd-layout">
          <section className="card rxd-section" aria-labelledby="rxd-custom">
            <h2 id="rxd-custom">2. Make it yours</h2>
            <fieldset className="fieldset">
              <legend>Colour</legend>
              <div className="rxd-swatches">
                {RX_ACCENTS.map((a) => (
                  <label key={a} className={`check rxd-swatch rx-accent-${a}`} htmlFor={`rxd-accent-${a}`}>
                    <input id={`rxd-accent-${a}`} type="radio" name="rxd-accent" checked={form.accent === a} onChange={() => set({ accent: a })} />
                    <span className="rxd-swatch-dot" aria-hidden="true" />
                    <span>{ACCENT_NAMES[a]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-grid">
              <fieldset className="fieldset">
                <legend>Text size</legend>
                {[
                  ['standard', 'Standard'],
                  ['large', 'Large – easier to read'],
                ].map(([k, label]) => (
                  <label key={k} className="check" htmlFor={`rxd-size-${k}`}>
                    <input id={`rxd-size-${k}`} type="radio" name="rxd-size" checked={form.textSize === k} onChange={() => set({ textSize: k })} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="fieldset">
                <legend>Paper</legend>
                {[
                  ['A4', 'A4 (full page)'],
                  ['A5', 'A5 (half page)'],
                ].map(([k, label]) => (
                  <label key={k} className="check" htmlFor={`rxd-paper-${k}`}>
                    <input id={`rxd-paper-${k}`} type="radio" name="rxd-paper" checked={form.paper === k} disabled={halfPage && k === 'A4'} onChange={() => set({ paper: k })} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <fieldset className="fieldset">
              <legend>Instructions for the patient</legend>
              {Object.entries(LANGUAGE_CHOICES).map(([k, label]) => (
                <label key={k} className="check" htmlFor={`rxd-lang-${k}`}>
                  <input id={`rxd-lang-${k}`} type="radio" name="rxd-lang" checked={form.language === k} onChange={() => set({ language: k })} />
                  <span>{label}</span>
                </label>
              ))}
              <p className="hint help">How often, when and how long are printed in English, and in Marathi or Hindi under them.</p>
            </fieldset>
            <label className="checkbox" htmlFor="rxd-capitals">
              <input id="rxd-capitals" type="checkbox" checked={form.capitals} onChange={(e) => set({ capitals: e.target.checked })} />
              <span>Medicine names in CAPITALS (easier for chemists to read)</span>
            </label>
            <fieldset className="fieldset">
              <legend>What to print</legend>
              <div className="check-grid">
                {RX_SHOW.map((k) => (
                  <label key={k} className="check" htmlFor={`rxd-show-${k}`}>
                    <input id={`rxd-show-${k}`} type="checkbox" checked={form.show[k]} onChange={setShow(k)} />
                    <span>{SHOW_LABELS[k]}</span>
                  </label>
                ))}
              </div>
              <p className="hint">Your private note is never printed.</p>
            </fieldset>
            <Field label="Specialities (optional)" id="rxd-spec" error={fieldErrors.specialities} hint="e.g. Obstetrics & Gynaecology · Infertility · Laparoscopy">
              <input id="rxd-spec" value={form.specialities} maxLength={200} onChange={(e) => set({ specialities: e.target.value })} />
            </Field>
            <Field label="Clinic timings (optional)" id="rxd-timings" error={fieldErrors.timings} hint="e.g. Mon–Sat 10:00–14:00, 17:00–20:00">
              <input id="rxd-timings" value={form.timings} maxLength={200} onChange={(e) => set({ timings: e.target.value })} />
            </Field>
            <Field label="Footer note (optional)" id="rxd-footer" error={fieldErrors.footerNote} hint="e.g. Please bring this prescription on your next visit.">
              <input id="rxd-footer" value={form.footerNote} maxLength={200} onChange={(e) => set({ footerNote: e.target.value })} />
            </Field>
            <fieldset className="fieldset rxd-fine">
              <legend>Fine-tune (optional)</legend>
              <p className="hint help">Leave a box empty to print it as the design does.</p>
              <div className="form-grid">
                <fieldset className="fieldset">
                  <legend>Font</legend>
                  {FONT_CHOICES.map(([k, label]) => (
                    <label key={k} className="check" htmlFor={`rxd-font-${k}`}>
                      <input id={`rxd-font-${k}`} type="radio" name="rxd-font" checked={(form.font ?? 'standard') === k} onChange={() => set({ font: k })} />
                      <span className={`rxd-font-${k}`}>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="fieldset">
                  <legend>Space between lines</legend>
                  {SPACING_CHOICES.map(([k, label]) => (
                    <label key={k} className="check" htmlFor={`rxd-lines-${k}`}>
                      <input id={`rxd-lines-${k}`} type="radio" name="rxd-lines" checked={(form.lineSpacing ?? 'standard') === k} onChange={() => set({ lineSpacing: k })} />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="form-grid">
                <Field label="Text size (pt)" id="rxd-body-pt" error={fieldErrors.bodyPt} hint="8 to 16. Replaces Standard or Large.">
                  <input id="rxd-body-pt" type="number" min={8} max={16} step={0.5} value={form.bodyPt ?? ''} onChange={(e) => set({ bodyPt: e.target.value })} />
                </Field>
                <Field label="Medicine names (pt)" id="rxd-med-pt" error={fieldErrors.medicinePt} hint="8 to 20">
                  <input id="rxd-med-pt" type="number" min={8} max={20} step={0.5} value={form.medicinePt ?? ''} onChange={(e) => set({ medicinePt: e.target.value })} />
                </Field>
                <Field label="Your name at the top (pt)" id="rxd-doctor-pt" error={fieldErrors.doctorPt} hint="10 to 30">
                  <input id="rxd-doctor-pt" type="number" min={10} max={30} step={0.5} value={form.doctorPt ?? ''} onChange={(e) => set({ doctorPt: e.target.value })} />
                </Field>
                <Field label="Left and right margins (mm)" id="rxd-side" error={fieldErrors.marginSideMm} hint="0 to 40. Used when printing.">
                  <input id="rxd-side" type="number" min={0} max={40} value={form.marginSideMm ?? ''} onChange={(e) => set({ marginSideMm: e.target.value })} />
                </Field>
              </div>
            </fieldset>
            <fieldset className="fieldset">
              <legend>Section titles (optional)</legend>
              <p className="hint help">Your own words are printed as you write them, in place of the usual title (and its Marathi or Hindi words).</p>
              <div className="form-grid">
                {RX_TITLES.map((k) => (
                  <Field key={k} label={TITLE_LABELS[k]} id={`rxd-title-${k}`} error={fieldErrors[`titles.${k}`]}>
                    <input
                      id={`rxd-title-${k}`}
                      value={form.titles?.[k] ?? ''}
                      maxLength={40}
                      placeholder={RX_LABELS[k].en}
                      onChange={(e) => set({ titles: { ...form.titles, [k]: e.target.value } })}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
            {form.design === 'preprinted' && (
              <div className="form-grid">
                <Field label="Space for your pad's printed header (mm)" id="rxd-top" error={fieldErrors.marginTopMm}>
                  <input id="rxd-top" type="number" min={0} max={120} value={form.marginTopMm} onChange={(e) => set({ marginTopMm: e.target.value })} />
                </Field>
                <Field label="Space for your pad's printed footer (mm)" id="rxd-bottom" error={fieldErrors.marginBottomMm}>
                  <input id="rxd-bottom" type="number" min={0} max={80} value={form.marginBottomMm} onChange={(e) => set({ marginBottomMm: e.target.value })} />
                </Field>
              </div>
            )}
          </section>

          <section className="card rxd-preview" aria-labelledby="rxd-preview-title">
            <h2 id="rxd-preview-title">Preview</h2>
            <p className="hint">
              {DESIGNS[form.design].name}
              {form.design === 'preprinted' ? ' – the grey bands stand for your pad’s own printed header and footer.' : ''}
            </p>
            <div className={`paper rxd-paper ${form.paper === 'A5' || halfPage ? 'rxd-paper-a5' : ''} ${form.design === 'preprinted' ? 'rxd-paper-pad' : ''}`.trim()}>
              {form.design === 'preprinted' && <span className="rxd-pad-band" style={{ height: `${Number(form.marginTopMm) || 0}mm` }} aria-hidden="true" />}
              <Sample design={form} letterhead={letterhead} user={user} />
              {form.design === 'preprinted' && <span className="rxd-pad-band" style={{ height: `${Number(form.marginBottomMm) || 0}mm` }} aria-hidden="true" />}
            </div>
          </section>
        </div>

        <div className="sticky-actions">
          <span className="grow">
            Chosen: <strong>{DESIGNS[form.design].name}</strong> · {ACCENT_NAMES[form.accent]} · {form.bodyPt ? `${form.bodyPt} pt text` : form.textSize === 'large' ? 'large text' : 'standard text'} · {halfPage ? 'A5' : form.paper}
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Save aria-hidden="true" /> {busy ? 'Saving…' : 'Save design'}
          </button>
        </div>
      </form>
    </>
  );
}
