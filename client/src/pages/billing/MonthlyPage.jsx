// Monthly income: billed by group and received by mode, month by month; and the export for Excel (admin).
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { billingReportsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { Loader } from '../../components/Loader.jsx';
import { exportFields } from '../../forms/billingForms.js';
import { useForm } from '../../hooks/useForm.js';
import { formatMoney, monthText, todayInput } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';

export function MonthlyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const form = useForm({ from: `${todayInput().slice(0, 8)}01`, to: todayInput() });

  useEffect(() => {
    billingReportsApi.monthly().then(setData).catch((err) => setError(err.message));
  }, []);

  const download = (values) => {
    if (values.from > values.to) {
      form.setErrors({ to: 'The end must be on or after the start.' });
      return;
    }
    window.location.href = billingReportsApi.exportUrl(values.from, values.to);
  };

  return (
    <BillingFrame subtitle="Income month by month">
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <section className="card list-panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Bills</th>
                  {data.groups.map((g) => <th key={g.key} className="num">{g.label}</th>)}
                  <th className="num">Discounts</th>
                  <th className="num">Billed</th>
                  {data.modes.map((m) => <th key={m.key} className="num">{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...data.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td className="nowrap">{monthText(m.month)}</td>
                    <td className="num">{m.bills}</td>
                    {data.groups.map((g) => <td key={g.key} className="num">{formatMoney(m.byGroup[g.key])}</td>)}
                    <td className="num">{formatMoney(m.discounts)}</td>
                    <td className="num"><strong>{formatMoney(m.billed)}</strong></td>
                    {data.modes.map((md) => <td key={md.key} className="num">{formatMoney(m.byMode[md.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="card top-gap">
        <h2>Export bills for Excel</h2>
        <form onSubmit={form.submit(download)} noValidate>
          <FormBuilder fields={exportFields} form={form} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary"><Download size={16} aria-hidden /> Download CSV</button>
          </div>
        </form>
      </section>
    </BillingFrame>
  );
}
