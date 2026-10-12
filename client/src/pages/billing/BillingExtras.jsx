import { useState } from 'react';
import { Copy, Link2, Save, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import {
  CLAIM_LAYOUTS,
  INSURANCE_FIELDS,
  PMJAY_FIELDS,
  UPI_USUAL_LIMIT_PAISE,
  billingTabs,
  claimMissing,
  insuranceForm,
  insuranceRows,
  itemsWord,
  rupees,
  takeMoneyLabel,
  toInput,
  toPaise,
  upiSettingsProblems,
} from './billingFormat.js';
import { Modal, useSend } from './billingUi.jsx';

// Billing extras (4 Oct 2026), all for reception and the hospital admin:
//  - insurance or scheme details on a bill, and the two printouts made from them – the claim form and the PM-JAY
//    claim sheet. Perinexa connects to no insurer and not to the PM-JAY portal; the screens and the paper say so.
//    The forms hold identity, dates, the doctor and the bill by group: the "Diagnosis and procedure" part is printed
//    EMPTY for the treating doctor (reception has no access to clinical details and gets none through the form).
//  - the UPI payment link: only a link and a message to copy. It records nothing; reception records the payment
//    with "Take payment" when the money has arrived.
//  - Billing → Settings: the hospital's UPI ID and payee name (hospital admin).

const NOT_CONNECTED = 'Perinexa is not connected to any insurer or to the PM-JAY portal. The claim is made outside Perinexa.';

// ---------- Insurance or scheme details ----------

/** The card on the bill: what is recorded, and the button to add or change it. */
export function InsuranceSection({ bill, open, onEdit }) {
  const rows = insuranceRows(bill.insurance);
  return (
    <section className="card bill-section" aria-labelledby="bill-insurance">
      <div className="row-between">
        <h2 id="bill-insurance">Insurance or scheme</h2>
        {open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
            <ShieldCheck aria-hidden="true" /> {rows.length ? 'Change the details' : 'Add details'}
          </button>
        )}
      </div>
      {rows.length ? (
        <dl className="bill-facts">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">None recorded. Add them when an insurer or a scheme such as PM-JAY pays for this bill.</p>
      )}
      {bill.insurance?.byName && (
        <p className="hint">
          Last changed by {bill.insurance.byName}, {formatDateTime(bill.insurance.at)}.
        </p>
      )}
      <p className="hint">{NOT_CONNECTED} The claim form and the PM-JAY claim sheet are under Print.</p>
    </section>
  );
}

export function InsuranceDialog({ bill, earlier, onClose, onDone }) {
  return (
    <Modal id="bill-ins" title="Insurance or scheme details" wide onClose={onClose}>
      <InsuranceForm bill={bill} earlier={earlier} onClose={onClose} onDone={onDone} />
    </Modal>
  );
}

/** What the dialog holds: every detail, the PM-JAY part, and the details of an earlier bill to use again. */
export function InsuranceForm({ bill, earlier, onClose, onDone }) {
  const [form, setForm] = useState(() => insuranceForm(bill.insurance));
  const s = useSend(onDone);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
  const any = Object.values(body).some(Boolean);
  const insurerMissing = any && body.insurer.length < 2;
  const field = ([k, label, max, hint]) => (
    <Field key={k} label={label} id={`bill-ins-${k}`} hint={hint} error={s.fields[k] ?? (k === 'insurer' && insurerMissing ? 'Write the insurance company or scheme (for PM-JAY, write PM-JAY).' : undefined)}>
      <input id={`bill-ins-${k}`} value={form[k]} maxLength={max} onChange={set(k)} autoComplete="off" />
    </Field>
  );
  return (
    <>
      <p>All optional. They are printed on the claim form. Write no diagnosis here: the doctor fills that in on the printed form.</p>
      <Alert type="error">{s.error}</Alert>
      {earlier && !bill.insurance && (
        <p className="bill-earlier">
          Her bill {earlier.number} has: {[earlier.insurer, earlier.policyNumber, earlier.tpa, earlier.pmjayId].filter(Boolean).join(' · ')}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, insurer: earlier.insurer, policyNumber: earlier.policyNumber, tpa: earlier.tpa, pmjayId: earlier.pmjayId })}>
            Use these details
          </button>
        </p>
      )}
      <div className="form-grid">{INSURANCE_FIELDS.map(field)}</div>
      <h3 className="bill-subhead">For the PM-JAY claim sheet</h3>
      <div className="form-grid">{PMJAY_FIELDS.map(field)}</div>
      <p className="hint">{NOT_CONNECTED}</p>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={insurerMissing || s.busy}
          onClick={() => s.send(`/billing/bills/${bill.id}/insurance`, body, () => (any ? 'Insurance details saved.' : bill.insurance ? 'Insurance details taken off.' : null), 'PUT')}
        >
          <Save aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save the details'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}

// ---------- The UPI payment link ----------

/** The notice in the dialog. It names the button this bill really has: "Take a deposit" while she is in hospital. */
export const upiNotRecorded = (bill) => `This only makes a link to copy. It records nothing on the bill. When the money has arrived in the hospital’s account, record it with ${takeMoneyLabel(bill)} (paid by UPI).`;

/** The link that was made: who is paid, the message and the link to copy. Sending is done by hand. */
export function UpiLinkResult({ made, copied, onCopy, onClose }) {
  return (
    <>
      <p>
        Asks for <strong>{rupees(made.amountPaise)}</strong> for bill {made.number}, paid to <strong>{made.payeeName}</strong> (<span className="tabular">{made.upiId}</span>). Check that this is the hospital’s UPI ID before you send it.
      </p>
      <Field label="Message for the patient" id="bill-upi-message" keepHint hint="Copy it and send it to the patient yourself, for example by SMS or WhatsApp. Perinexa does not send it.">
        <textarea id="bill-upi-message" className="bill-upi-text" rows={9} readOnly value={made.message} onFocus={(e) => e.target.select()} />
      </Field>
      <Field label="The link only" id="bill-upi-link" keepHint hint="It opens a UPI app on a phone. Where it does not open, the message also gives the UPI ID to pay to.">
        <input id="bill-upi-link" className="tabular" readOnly value={made.link} onFocus={(e) => e.target.select()} />
      </Field>
      {copied && (
        <Alert type={copied.ok ? 'success' : 'warning'}>
          {copied.ok ? (copied.what === 'message' ? 'The message was copied.' : 'The link was copied.') : 'Could not copy. Select the text and copy it by hand.'}
        </Alert>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => onCopy('message', made.message)}>
          <Copy aria-hidden="true" /> Copy the message
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onCopy('link', made.link)}>
          <Copy aria-hidden="true" /> Copy the link only
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

export function UpiLinkDialog({ bill, upiReady, onClose }) {
  return (
    <Modal id="bill-upi" title="UPI payment link" wide={upiReady} onClose={onClose}>
      <UpiLinkForm bill={bill} upiReady={upiReady} onClose={onClose} />
    </Modal>
  );
}

/** What the dialog holds: the amount to ask for, then the link and the message – or who sets the UPI ID. */
export function UpiLinkForm({ bill, upiReady, onClose }) {
  const { activeMembership } = useAuth();
  const [amount, setAmount] = useState(toInput(bill.balance));
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(null); // { what: 'message' | 'link', ok }
  const s = useSend((res) => setMade(res));
  const paise = toPaise(amount);
  const tooMuch = paise != null && paise > bill.balance;
  const tooLittle = paise != null && paise < 100;
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ what, ok: true });
    } catch {
      setCopied({ what, ok: false });
    }
  };

  if (!upiReady) {
    return (
      <>
        <p>The hospital’s UPI ID is not set yet, so no link can be made.</p>
        {activeMembership.roles.includes('admin') ? (
          <p>
            Enter it under <Link to="/billing/settings">Billing → Settings</Link>.
          </p>
        ) : (
          <p>Ask the hospital admin to enter it under Billing → Settings.</p>
        )}
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Alert type="info">{upiNotRecorded(bill)}</Alert>
      <Alert type="error">{s.error}</Alert>
      {!made && (
        <>
          <Field
            label="Amount to ask for (₹)"
            id="bill-upi-amount"
            keepHint
            error={tooMuch ? `More than the balance of ${rupees(bill.balance)}.` : tooLittle ? 'A UPI payment is at least ₹1.' : s.fields.amountPaise}
            hint={
              paise > UPI_USUAL_LIMIT_PAISE
                ? 'Many UPI apps take at most ₹1,00,000 in one payment. A larger amount may have to be paid in parts.'
                : `The balance is ${rupees(bill.balance)}. For a part payment, enter less.`
            }
          >
            <input id="bill-upi-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <p className="hint">The link holds the hospital’s UPI ID, the amount and the bill number {bill.number}. Nothing about the patient is in it.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={paise == null || tooMuch || tooLittle || s.busy} onClick={() => s.send(`/billing/bills/${bill.id}/upi-link`, { amountPaise: paise })}>
              <Link2 aria-hidden="true" /> {s.busy ? 'Making…' : 'Make the link'}
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {made && <UpiLinkResult made={made} copied={copied} onCopy={copy} onClose={onClose} />}
    </>
  );
}

// ---------- The claim form and the PM-JAY claim sheet ----------

// An empty line on paper, to fill in by hand: for what is not recorded, and for what this reader may not see.
const Blank = () => <span className="pdoc-line" />;
const orBlank = (value) => (value === '' || value == null ? <Blank /> : value);
/** Label / value pairs on paper, three to a row; span: how many of the three columns a pair takes. */
const Facts = ({ items }) => (
  <dl className="pdoc-facts">
    {items.map(([label, value, span = 1]) => (
      <div key={label} className={span === 3 ? 'pdoc-wide' : span === 2 ? 'claim-span2' : undefined}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
);
const FillLine = ({ label }) => (
  <div className="pdoc-sig-line">
    {label && <span className="pdoc-sig-label">{label}</span>}
    <span className="pdoc-sig-fill" />
  </div>
);

/**
 * The printed claim form (layout 'claim') or PM-JAY claim sheet (layout 'pmjay'), A4.
 * form: what GET /billing/bills/:id/claim-form sends. It has no clinical detail, and this document adds none:
 * "Diagnosis and procedure" is an empty box for the treating doctor.
 */
export function ClaimDocument({ form, layout, printedAt, printedBy }) {
  const { hospital, patient, doctor, dates, bill, groups, sums } = form;
  const ins = form.insurance ?? {};
  const pmjay = layout === 'pmjay';
  const footer = (
    <>
      <span>
        {patient.fullName} · {patient.mrn} · bill {bill.number}
      </span>
      <span>
        Printed {formatDateTime(printedAt)} by {printedBy}
      </span>
    </>
  );
  return (
    <PrintDocument className="bill-doc claim-doc" footer={footer}>
      <Letterhead letterhead={hospital} />
      <h1 className="pdoc-title">{CLAIM_LAYOUTS[layout].title}</h1>
      <p className="pdoc-note claim-note">
        {pmjay
          ? 'For copying into the PM-JAY portal by hand. Perinexa is not connected to the PM-JAY portal.'
          : 'Prepared by the hospital from its bill. It is not the insurer’s own form, and Perinexa is not connected to any insurer.'}
      </p>

      <h2>Hospital and bill</h2>
      <Facts
        items={[
          ['Hospital registration no.', orBlank(hospital.registrationNumber)],
          ['Bill no.', bill.number],
          ['Bill date', formatDate(bill.date)],
        ]}
      />

      <h2>Patient</h2>
      <Facts
        items={[
          ['Name', patient.fullName],
          ['Patient no.', patient.mrn],
          // baby null: this reader may not see whether she is a baby – one empty line for either
          patient.baby == null ? ['Age or date of birth', <Blank key="age" />] : patient.baby ? ['Date of birth', patient.bornOn ? formatDate(patient.bornOn) : <Blank />] : ['Age', patient.age != null ? `${patient.age} years` : <Blank />],
          ['Phone', orBlank(patient.phone)],
          ['Address', orBlank(patient.address), 2],
        ]}
      />

      <h2>{dates.kind === 'stay' ? 'Stay in hospital' : 'Visit'}</h2>
      <Facts
        items={[
          ...(dates.kind === 'stay'
            ? [
                ['Admitted', dates.admittedAt ? formatDateTime(dates.admittedAt) : <Blank />],
                ['Discharged', dates.dischargedAt ? formatDateTime(dates.dischargedAt) : 'Still in hospital', 2],
              ]
            : [['Date of visit', formatDate(dates.on), 3]]),
          ['Treating doctor', doctor ? [doctor.name, doctor.qualification].filter(Boolean).join(', ') : <Blank />, 2],
          ['Doctor’s registration no.', doctor?.registrationNumber ? `${doctor.registrationNumber}${doctor.council ? ` (${doctor.council})` : ''}` : <Blank />],
        ]}
      />

      <h2>{pmjay ? 'PM-JAY details' : 'Insurance or scheme'}</h2>
      <Facts
        items={
          pmjay
            ? [
                ['PM-JAY ID', orBlank(ins.pmjayId)],
                ['Pre-authorisation number', orBlank(ins.preAuthNumber)],
                ['Package code', orBlank(ins.packageCode)],
                ['Package name', orBlank(ins.packageName), 3],
                ['Scheme', orBlank(ins.insurer)],
                ['Claim number', orBlank(ins.claimNumber), 2],
              ]
            : [
                ['Insurance company or scheme', orBlank(ins.insurer)],
                ['Policy or member number', orBlank(ins.policyNumber)],
                ['TPA', orBlank(ins.tpa)],
                ['Pre-authorisation number', orBlank(ins.preAuthNumber)],
                ['Claim number', orBlank(ins.claimNumber), 2],
              ]
        }
      />

      <section className="claim-summary">
        <h2>Bill summary</h2>
        <table className="ptable pdoc-table claim-table">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col" className="num">
                Items
              </th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group}>
                <td>{g.label}</td>
                <td className="num">{itemsWord(g.items)}</td>
                <td className="num">{rupees(g.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="ptable bill-doc-sums">
          <tbody>
            {sums.discount > 0 && (
              <>
                <tr>
                  <th scope="row">Subtotal</th>
                  <td>{rupees(sums.subtotal)}</td>
                </tr>
                <tr>
                  <th scope="row">Discount</th>
                  <td>−{rupees(sums.discount)}</td>
                </tr>
              </>
            )}
            <tr>
              <th scope="row">Total</th>
              <td>{rupees(sums.total)}</td>
            </tr>
            <tr>
              <th scope="row">Paid</th>
              <td>{rupees(sums.paid)}</td>
            </tr>
            {sums.paidByInsurance > 0 && (
              <tr>
                <th scope="row">Of this, paid by insurance or a scheme</th>
                <td>{rupees(sums.paidByInsurance)}</td>
              </tr>
            )}
            <tr className="bill-doc-balance">
              <th scope="row">{sums.balance < 0 ? 'Due back' : 'Due'}</th>
              <td>{rupees(Math.abs(sums.balance))}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="pdoc-box claim-doctor">
        <h2>Diagnosis and procedure – to be filled in and signed by the treating doctor</h2>
        <p className="pdoc-note">Left empty on purpose: the billing desk has no clinical details.</p>
        <FillLine label="Diagnosis" />
        <FillLine />
        <FillLine label="Procedure or treatment" />
        <FillLine />
        <div className="claim-sign-row">
          <FillLine label="Doctor’s signature" />
          <FillLine label="Date" />
        </div>
        <FillLine label="Name and registration no." />
      </section>

      <div className="pdoc-sigs">
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">Patient or insured person</h2>
          <FillLine label="Signature" />
          <FillLine label="Name and date" />
        </div>
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">For the hospital</h2>
          <FillLine label="Signature and stamp" />
          <FillLine label="Name and date" />
        </div>
      </div>
    </PrintDocument>
  );
}

/** The print preview of a claim form: what is not recorded yet is said on screen and prints as an empty line. */
export function ClaimFormPrint({ bill, layout, onClose }) {
  const { user } = useAuth();
  const res = useFetch(`/billing/bills/${bill.id}/claim-form`);
  const [printedAt] = useState(() => new Date());
  const title = CLAIM_LAYOUTS[layout].title;
  if (!res.data) {
    return (
      <Modal id="bill-claim" title={title} onClose={onClose}>
        <Alert type="error">{res.error}</Alert>
        {!res.error && (
          <p className="muted" aria-busy="true">
            Preparing the form…
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }
  const { form } = res.data;
  const missing = claimMissing(form.insurance, layout);
  const record = () => api(`/billing/bills/${bill.id}/claim-form/printed`, { method: 'POST', body: { layout } });
  return (
    <PrintPreview
      title={`${title} – print preview`}
      hint={
        layout === 'pmjay'
          ? 'Check it, then print on A4 paper (two pages). The sheet is for copying into the PM-JAY portal by hand: Perinexa is not connected to the portal.'
          : 'Check it, then print on A4 paper (two pages). The doctor fills in and signs the diagnosis and procedure by hand.'
      }
      controls={
        missing.length > 0 ? (
          <Alert type="warning">
            Not recorded yet: {missing.join(', ')}. {missing.length > 1 ? 'They print' : 'It prints'} as an empty line. To type {missing.length > 1 ? 'them' : 'it'} in, close this and open “Insurance or scheme” on the bill.
          </Alert>
        ) : null
      }
      onPrint={record}
      onClose={onClose}
    >
      <ClaimDocument form={form} layout={layout} printedAt={printedAt} printedBy={user?.name ?? ''} />
    </PrintPreview>
  );
}

// ---------- Billing → Settings (hospital admin): the UPI ID and payee name ----------

export function BillingSettingsPage() {
  const { activeMembership } = useAuth();
  const res = useFetch('/billing/settings');
  const [form, setForm] = useState(null);
  const [savedNow, setSavedNow] = useState(null);
  const [savedHistory, setSavedHistory] = useState(null);
  const s = useSend((out) => {
    setSavedNow(out.settings);
    setSavedHistory(out.history ?? null);
    setForm(null);
  });
  const saved = savedNow ?? res.data?.settings;
  const canEdit = Boolean(res.data?.canEdit);
  const v = form ?? (saved ? { upiId: saved.upiId, payeeName: saved.payeeName, again: '' } : null);
  const set = (k) => (e) => setForm({ ...v, [k]: e.target.value });
  const problems = v ? upiSettingsProblems(v, saved) : {};
  const idChanged = v && saved && v.upiId.trim() !== saved.upiId;
  const off = v && !v.upiId.trim() && !v.payeeName.trim();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Settings' }]} title="Billing settings" tabs={billingTabs(activeMembership.roles)} />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="error">{s.error}</Alert>
        {savedNow && !form && <Alert type="success">{savedNow.upiReady ? 'Saved. Bills with a balance now offer a UPI payment link.' : 'Saved. UPI payment links are switched off.'}</Alert>}
        {v && (
          <section className="card bill-section narrow" aria-labelledby="bill-set-upi">
            <h2 id="bill-set-upi">UPI payment link</h2>
            <p>
              With the hospital’s UPI ID here, a bill with a balance offers a link the patient can pay with from a UPI app. Reception copies the link and sends it by hand.
            </p>
            <Alert type="warning">
              Money paid with the link goes to this UPI ID. Check every letter. After saving, make a link on a bill and pay ₹1 from your own phone to see that the hospital’s name appears.
            </Alert>
            <Field label="Hospital’s UPI ID" id="bill-set-upiid" error={form ? problems.upiId : undefined} hint="It looks like name@bank. Leave both boxes empty to switch the links off.">
              <input id="bill-set-upiid" className="tabular" value={v.upiId} maxLength={100} onChange={set('upiId')} disabled={!canEdit} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </Field>
            {canEdit && idChanged && v.upiId.trim() && !problems.upiId && (
              <Field label="Type the UPI ID again" id="bill-set-again" error={v.again ? problems.again : undefined} keepHint hint="Typed twice, so a slip of the finger is caught.">
                <input id="bill-set-again" className="tabular" value={v.again} maxLength={100} onChange={set('again')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </Field>
            )}
            <Field label="Payee name" id="bill-set-payee" error={form ? problems.payeeName : undefined} hint="The name the UPI ID is registered under, as the bank shows it. The patient sees it before paying.">
              <input id="bill-set-payee" value={v.payeeName} maxLength={80} onChange={set('payeeName')} disabled={!canEdit} autoComplete="off" />
            </Field>
            <p className="hint">
              Perinexa is not connected to a bank or a payment service. It never knows whether a link was paid: reception records each payment with Take payment (or Take a deposit, for a patient in hospital) when the money has arrived.
            </p>
            {saved?.updatedByName && (
              <p className="hint">
                Last changed by {saved.updatedByName}, {formatDateTime(saved.updatedAt)}.
              </p>
            )}
            {!canEdit && <Alert type="info">Only the hospital admin can change these settings.</Alert>}
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!form || Object.keys(problems).length > 0 || s.busy}
                onClick={() => s.send('/billing/settings', { upiId: v.upiId.trim(), payeeName: v.payeeName.trim() }, null, 'PUT')}
              >
                <Save aria-hidden="true" /> {s.busy ? 'Saving…' : off && saved?.upiId ? 'Save and switch the links off' : 'Save'}
              </button>
            )}
          </section>
        )}
        {canEdit && <UpiHistory history={savedHistory ?? res.data?.history} />}
      </div>
    </>
  );
}

/**
 * Every change of the UPI ID and payee name, newest first (hospital admin only). The UPI ID decides where patients'
 * money goes: this shows which account the links of any day pointed to, and who set it.
 */
export function UpiHistory({ history }) {
  if (!history?.length) return null;
  return (
    <section className="card bill-section" aria-labelledby="bill-set-history">
      <h2 id="bill-set-history">Changes to the UPI ID</h2>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Changed on</th>
            <th scope="col">By</th>
            <th scope="col">UPI ID</th>
            <th scope="col">Payee name</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={`${h.at}-${i}`}>
              <td>{h.at ? formatDateTime(h.at) : 'Not recorded'}</td>
              <td>{h.byName || 'Not recorded'}</td>
              <td className="tabular">{h.upiId || 'None – links switched off'}</td>
              <td>{h.payeeName || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Every change is kept here, newest first, so you can see which UPI ID the links of any day pointed to. The audit log shows who made a UPI link for which bill, and when. If you see a UPI ID here that is not the hospital’s, links made while
        it was set asked patients to pay to it.
      </p>
    </section>
  );
}
