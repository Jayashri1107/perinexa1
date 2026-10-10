// One bill: its lines, discount, payments and refunds; take payment, refund, cancel, print, UPI link.
import { ArrowLeft, Ban, IndianRupee, Pencil, Percent, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { billingSettingsApi, billsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { toast } from '../../components/Toast.jsx';
import { DataTable } from '../../components/list/DataTable.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { WhatsAppButton } from '../../components/WhatsAppButton.jsx';
import { billMessage } from '../../utils/whatsapp.js';
import { cancelFields, discountFields, lineEditFields, paymentFields, refundFields } from '../../forms/billingForms.js';
import { useForm } from '../../hooks/useForm.js';
import { amountInWords } from '../../utils/amountInWords.js';
import { ageText, formatDate, formatDateTime, formatMoney, labelOf } from '../../utils/format.js';
import { BillLinesEditor, newLine, toServerLines } from './BillLinesEditor.jsx';
import { BillStatus } from './BillStatus.jsx';

export function BillDetailPage() {
  const { id } = useParams();
  const { billing, patients: patientSettings } = useAppConfig();
  const { activeMembership } = useAuth();
  const [data, setData] = useState(null);
  const [payee, setPayee] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null); // 'pay' | 'refund' | 'discount' | 'cancel' | 'lines' | { line }
  const [newLines, setNewLines] = useState([newLine()]);
  const form = useForm({});

  const load = useCallback(() => {
    billsApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    billingSettingsApi.payee().then((r) => setPayee(r.payee)).catch(() => setPayee(null));
  }, []);
  // Opened with "Collect" (…?pay=1, from Today): the payment form opens with the balance filled in, once.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!data || params.get('pay') !== '1') return;
    setParams({}, { replace: true });
    if (data.bill.status !== 'cancelled' && data.bill.balance > 0) {
      form.reset({ mode: billing.paymentModes[0].key, amount: data.bill.balance, reference: '' });
      setDialog('pay');
    }
  }, [data]);

  if (!data) return error ? <Alert type="error">{error}</Alert> : <Loader />;
  const { bill, payments, context } = data;
  const open = bill.status !== 'cancelled';
  const netPaid = bill.paid - bill.refunded;

  const show = (name, values) => {
    form.reset(values);
    setDialog(name);
  };
  const done = (result, message = '') => {
    setData(result);
    setDialog(null);
    setNotice(message);
    toast(message);
  };
  const run = async (action) => {
    setError('');
    try {
      setData(await action());
    } catch (err) {
      setError(err.message);
    }
  };
  const addLines = async () => {
    setError('');
    try {
      done(await billsApi.addLines(id, toServerLines(newLines)));
      setNewLines([newLine()]);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };

  const upiLink =
    payee && bill.balance > 0
      ? `upi://pay?pa=${encodeURIComponent(payee.upiId)}&pn=${encodeURIComponent(payee.payeeName)}&am=${bill.balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(bill.billNumber)}`
      : null;

  const lineColumns = [
    { key: 'no', label: '#', className: 'num', render: (l) => bill.lines.indexOf(l) + 1 },
    { key: 'name', label: 'Service', render: (l) => (<>{l.name}{l.source === 'pharmacy' && <span className="muted block small">from the pharmacy</span>}</>) },
    { key: 'group', label: 'Group', render: (l) => labelOf(billing.priceGroups, l.group) },
    { key: 'qty', label: 'Qty', className: 'num' },
    { key: 'unitPrice', label: 'Rate', className: 'num', render: (l) => formatMoney(l.unitPrice) },
    { key: 'amount', label: 'Amount', className: 'num', render: (l) => formatMoney(l.amount) },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (l) =>
        open && l.source !== 'pharmacy' ? (
          <span className="row-actions">
          <button type="button" className="icon-btn" aria-label={`Change ${l.name}`} title="Change quantity or rate" onClick={() => show({ line: l }, { qty: l.qty, unitPrice: l.unitPrice })}>
            <Pencil size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => window.confirm(`Remove ${l.name}?`) && run(() => billsApi.removeLine(id, l.id))}>
            <Trash2 size={15} />
          </button>
          </span>
        ) : null,
    },
  ];

  const paymentColumns = [
    { key: 'receiptNumber', label: 'Receipt', className: 'nowrap' },
    { key: 'createdAt', label: 'When', className: 'nowrap', render: (p) => formatDateTime(p.createdAt) },
    { key: 'kind', label: 'Kind', render: (p) => (p.kind === 'refund' ? 'Refund' : 'Payment') },
    { key: 'mode', label: 'Mode', render: (p) => `${labelOf(billing.paymentModes, p.mode)}${p.reference ? ` · ${p.reference}` : ''}` },
    { key: 'byName', label: 'By' },
    { key: 'amount', label: 'Amount', className: 'num', render: (p) => formatMoney(p.kind === 'refund' ? -p.amount : p.amount) },
    {
      key: 'print',
      label: '',
      className: 'actions',
      render: (p) => (
        <a href={`/hospital/print/receipt/${bill.id}/${p.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label={`Print receipt ${p.receiptNumber}`}>
          <Printer size={14} aria-hidden /> Receipt
        </a>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        back={<Link to="/hospital/billing" className="back-link"><ArrowLeft size={16} aria-hidden /> Bills</Link>}
        title={`Bill ${bill.billNumber}`}
        subtitle={[
          bill.patient?.name,
          bill.patient?.patientNumber,
          bill.patient?.birthDate && ageText(bill.patient.birthDate, bill.patient.birthDateApprox),
          bill.patient?.sex && labelOf(patientSettings.sexes, bill.patient.sex),
          bill.patient?.phone,
          bill.doctorName && `Doctor: ${bill.doctorName}`,
          formatDateTime(bill.createdAt),
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <BillStatus bill={bill} />
            <Link to={`/hospital/print/bill/${bill.id}`} target="_blank" className="btn btn-ghost"><Printer size={16} aria-hidden /> Print</Link>
            {context?.contact && (
              <WhatsAppButton
                phone={context.contact.phone}
                agreed={context.contact.consentMessages}
                text={billMessage({ name: bill.patient?.name, hospital: activeMembership?.hospital?.name ?? '', billNumber: bill.billNumber })}
              />
            )}
            {open && bill.balance > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => show('pay', { mode: billing.paymentModes[0].key, amount: bill.balance, reference: '' })}>
                <IndianRupee size={16} aria-hidden /> Take payment
              </button>
            )}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      {bill.status === 'cancelled' && <Alert type="info">Cancelled: {bill.cancelReason}</Alert>}
      {context && (
        <p className="muted small">
          {context.stay
            ? `Inpatient · ${context.stay.admissionNumber ? `${context.stay.admissionNumber} · ` : ''}${[context.stay.ward, context.stay.bed].filter(Boolean).join(' / ')} · admitted ${formatDate(context.stay.admittedAt)}${context.stay.dischargedAt ? `, discharged ${formatDate(context.stay.dischargedAt)}` : ' (in hospital)'}`
            : `Outpatient${context.visitOn ? ` · visit ${formatDate(context.visitOn)}` : ''}`}
          {context.createdByName && ` · bill made by ${context.createdByName}`}
        </p>
      )}

      <section className="card list-panel">
        <DataTable columns={lineColumns} rows={bill.lines} emptyText="No lines yet." />
        <dl className="totals">
          <dt>Subtotal</dt><dd>{formatMoney(bill.subtotal)}</dd>
          {bill.discount.amount > 0 && (<><dt>Discount{bill.discount.reason ? ` (${bill.discount.reason})` : ''}</dt><dd>−{formatMoney(bill.discount.amount)}</dd></>)}
          <dt><strong>Total</strong></dt><dd><strong>{formatMoney(bill.total)}</strong></dd>
          <dt className="muted small">In words</dt><dd className="muted small">{amountInWords(bill.total)}</dd>
          <dt>Paid</dt><dd>{formatMoney(netPaid)}</dd>
          <dt><strong>{bill.balance < 0 ? 'To refund' : 'Balance'}</strong></dt><dd><strong>{formatMoney(Math.abs(bill.balance))}</strong></dd>
        </dl>
      </section>

      {open && (
        <div className="button-row">
          <button type="button" className="btn btn-ghost" onClick={() => setDialog('lines')}><Plus size={16} aria-hidden /> Add lines</button>
          <button type="button" className="btn btn-ghost" onClick={() => show('discount', { mode: bill.discount.mode, value: bill.discount.value, reason: bill.discount.reason })}>
            <Percent size={16} aria-hidden /> Discount
          </button>
          {netPaid > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => show('refund', { mode: billing.paymentModes[0].key, amount: bill.balance < 0 ? -bill.balance : '', reference: '', reason: '' })}>
              <Undo2 size={16} aria-hidden /> Refund
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => show('cancel', { reason: '' })}><Ban size={16} aria-hidden /> Cancel bill</button>
        </div>
      )}

      {upiLink && (
        <section className="card top-gap">
          <h2>Pay by UPI</h2>
          <p className="muted small">On a phone this opens the UPI app with the amount filled in. Paid to {payee.payeeName} ({payee.upiId}).</p>
          <a className="btn btn-ghost" href={upiLink}>Open UPI payment for {formatMoney(bill.balance)}</a>
        </section>
      )}

      <h2 className="top-gap">Payments and refunds</h2>
      <section className="card list-panel">
        <DataTable columns={paymentColumns} rows={payments} emptyText="Nothing paid yet." />
      </section>

      {dialog === 'pay' && (
        <FormModal title="Take payment" fields={paymentFields({ modes: billing.paymentModes })} form={form} submitLabel="Record payment"
          onSubmit={async (v) => { const r = await billsApi.pay(id, v); done(r, `Payment recorded – receipt ${r.receipt}.`); }} onClose={() => setDialog(null)} />
      )}
      {dialog === 'refund' && (
        <FormModal title="Refund" fields={refundFields({ modes: billing.paymentModes })} form={form} submitLabel="Record refund"
          onSubmit={async (v) => { const r = await billsApi.refund(id, v); done(r, `Refund recorded – receipt ${r.receipt}.`); }} onClose={() => setDialog(null)} />
      )}
      {dialog === 'discount' && (
        <FormModal title="Discount" fields={discountFields} form={form} onSubmit={async (v) => done(await billsApi.discount(id, v))} onClose={() => setDialog(null)} />
      )}
      {dialog === 'cancel' && (
        <FormModal title="Cancel bill" fields={cancelFields} form={form} submitLabel="Cancel the bill" onSubmit={async (v) => done(await billsApi.cancel(id, v.reason))} onClose={() => setDialog(null)} />
      )}
      {dialog?.line && (
        <FormModal title={`Change ${dialog.line.name}`} fields={lineEditFields} form={form} submitLabel="Save"
          onSubmit={async (v) => done(await billsApi.updateLine(id, dialog.line.id, { qty: Number(v.qty), unitPrice: Number(v.unitPrice) }), `${dialog.line.name} changed – totals worked out again.`)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'lines' && (
        <Modal title="Add lines" size="lg" onClose={() => setDialog(null)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={addLines}>Add</button></>}>
          <Alert type="error">{error}</Alert>
          <BillLinesEditor value={newLines} onChange={setNewLines} />
        </Modal>
      )}
    </>
  );
}
