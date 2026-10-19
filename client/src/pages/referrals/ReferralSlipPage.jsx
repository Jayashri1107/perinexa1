import { useState } from 'react';
import { Phone, Printer, Square } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { showWhatsappNumber, whatsappNumber } from '../visits/whatsapp.js';
import { SENT_FIELDS } from './referralFormat.js';

// The printable referral slip (docs/REFERRALS_PLAN.md) for referring doctors' pads: blank lines for exactly what the
// Clinical Partner Guide asks the doctor to send – LMP or EDD, gravida and para, today's BP, the latest Hb and sugar,
// scan reports, current medicines and the question to be answered – with the referral desk's WhatsApp number and
// the consultants' direct lines (kept by the hospital admin). Nothing about any patient is on it.

// The blanks sit closer than on a consent form (a slip is one A5 page): 12 px above each line instead of 16.
const LINE = { marginTop: 'var(--space-3)' };
const WIDE = { ...LINE, gridColumn: '1 / -1' };

/** A label and a line to fill in by hand. */
function Blank({ label, wide = false }) {
  return (
    <div className="pdoc-sig-line" style={wide ? WIDE : LINE}>
      <span className="pdoc-sig-label">{label}</span>
      <span className="pdoc-sig-fill" />
    </div>
  );
}
/** Boxes to tick by hand, after a label. */
function Ticks({ label, choices }) {
  return (
    <div className="pdoc-sig-line" style={LINE}>
      <span className="pdoc-sig-label">{label}:</span>
      {choices.map((c) => (
        <span key={c} className="pdoc-nowrap">
          <Square aria-hidden="true" /> {c}
        </span>
      ))}
    </div>
  );
}

const number = (phone) => {
  const n = whatsappNumber(phone);
  return n ? showWhatsappNumber(n) : phone;
};

function SlipDocument({ letterhead, view }) {
  const desk = view?.deskNumber ? number(view.deskNumber) : null;
  const lines = (view?.consultantLines ?? []).filter((c) => c.phone);
  const sent = Object.fromEntries(SENT_FIELDS.map((f) => [f.key, f.label]));
  return (
    <PrintDocument footer={null}>
      <Letterhead letterhead={letterhead} />
      <h1 className="pdoc-title">Referral slip</h1>
      <p className="pdoc-note">
        Send a photo of this slip to the referral desk on WhatsApp, or give it to the patient. We reply within 2 working hours with her appointment time and the
        consultant. Urgent: seen the same day. Routine: within 48 hours.
      </p>
      {/* Two blanks to a line, so the slip fits on one A5 page */}
      <div className="pdoc-sig" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 'var(--space-4)' }}>
        <Blank label="Referring doctor" />
        <Blank label="WhatsApp number" />
        <Blank label="Clinic" />
        <Blank label="Date and time" />
        <Blank label="Patient’s name" />
        <Blank label="Age" />
        <Blank label="Her phone" />
        <Ticks label="How soon" choices={['Urgent', 'Routine']} />
        <Blank label="Reason for referral" wide />
        <Blank label="The question you want answered" wide />
        <Blank label={sent.lmpEdd} />
        <Blank label={sent.gravidaPara} />
        <Blank label={sent.bp} />
        <Blank label={sent.hb} />
        <Blank label={sent.sugar} />
        <Ticks label={sent.scans} choices={['attached', 'none']} />
        <Blank label={sent.medicines} wide />
        <Blank label="Signature and stamp" />
        <Blank label="Registration number" />
      </div>
      {(desk || lines.length > 0) && (
        <p className="pdoc-note">
          {desk && (
            <span className="pdoc-block">
              <Phone aria-hidden="true" /> <strong>Referral desk (WhatsApp):</strong> <span className="pdoc-tabular">{desk}</span>
            </span>
          )}
          {lines.length > 0 && (
            <span className="pdoc-block">
              <strong>A consultant you can call:</strong>{' '}
              {lines.map((c, i) => (
                <span key={c.userId}>
                  {i > 0 ? ' · ' : ''}
                  {c.name} <span className="pdoc-tabular pdoc-nowrap">{number(c.phone)}</span>
                  {c.note ? ` (${c.note})` : ''}
                </span>
              ))}
            </span>
          )}
        </p>
      )}
      <LetterheadFooter letterhead={letterhead} />
    </PrintDocument>
  );
}

export function ReferralSlipPage() {
  const { activeMembership } = useAuth();
  const view = useFetch('/referrals/settings-view');
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const [size, setSize] = useState('A5');
  const [printing, setPrinting] = useState(false);
  const missing = view.data && !view.data.deskNumber;
  return (
    <>
      <PageHeader
        title="Referral slip"
        help="A blank slip for referring doctors’ pads: the details the Clinical Partner Guide asks for, the referral desk’s WhatsApp number and the consultants’ direct lines."
        tabs={moduleByKey('referrals')?.tabs}
      />
      <div className="pf-content appt-page">
        <Alert type="error">{view.error}</Alert>
        {missing && <Alert type="warning">The referral desk’s number is not set yet. The hospital admin adds it under Hospital admin → Referrals; until then the slip prints without it.</Alert>}
        <section className="card narrow" aria-labelledby="ref-slip-title">
          <h2 id="ref-slip-title">Print the slip</h2>
          <p>Print a few and give them to the referring doctors, or send them the PDF (Print, then “Save as PDF”). Nothing about any patient is printed.</p>
          <fieldset className="fieldset">
            <legend>Paper</legend>
            <div className="segmented" role="group" aria-label="Paper size">
              <button type="button" aria-pressed={size === 'A5'} onClick={() => setSize('A5')}>
                A5 (half page, for a pad)
              </button>
              <button type="button" aria-pressed={size === 'A4'} onClick={() => setSize('A4')}>
                A4
              </button>
            </div>
          </fieldset>
          <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)} disabled={!view.data && !view.error}>
            <Printer aria-hidden="true" /> Print the slip
          </button>
        </section>
      </div>
      {printing && (
        <PrintPreview title="Referral slip" hint={`Check the slip, then print it on ${size} paper.`} page={{ size }} fit docKey={`slip-${size}-${view.data ? 'ready' : 'none'}`} onClose={() => setPrinting(false)}>
          <SlipDocument letterhead={letterhead} view={view.data} />
        </PrintPreview>
      )}
    </>
  );
}
