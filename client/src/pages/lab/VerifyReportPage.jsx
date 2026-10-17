import { useEffect, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { formatDateTime } from '../../components/ui.jsx';

// Is this lab report genuine? (Lab version 2 – docs/LAB_V2_PLAN.md) – the page the QR code on a printed report opens.
// No login. It shows only the hospital, the sample number, the dates, the tests (a confidential one under its neutral
// name) and the patient's initials – never a result or a name.

export function VerifyReportPage() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    fetch(`/api/verify/lab/${encodeURIComponent(code)}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => alive && setState(ok ? { data: body } : { error: body?.error?.message ?? 'This report could not be checked.' }))
      .catch(() => alive && setState({ error: 'This report could not be checked just now. Please try again.' }));
    return () => {
      alive = false;
    };
  }, [code]);
  const d = state.data;
  return (
    <main className="portal-page">
      <section className="card portal-card" aria-labelledby="verify-title">
        <h1 id="verify-title">Lab report check</h1>
        {state.loading && !d && !state.error && <p className="muted">Checking…</p>}
        {state.error && (
          <p className="verify-bad">
            <TriangleAlert aria-hidden="true" /> {state.error}
          </p>
        )}
        {d && (
          <>
            <p className="verify-good">
              <CircleCheck aria-hidden="true" /> This is a genuine report from {d.hospital}.
            </p>
            <dl className="lab-stamps">
              <dt>Sample number</dt>
              <dd className="tabular">{d.sampleNo ?? '—'}</dd>
              <dt>Patient</dt>
              <dd>{d.patientInitials}</dd>
              <dt>Sample taken</dt>
              <dd>{d.sampleTaken ? formatDateTime(d.sampleTaken) : '—'}</dd>
              <dt>Reported</dt>
              <dd>{d.reported ? formatDateTime(d.reported) : '—'}</dd>
              <dt>Tests</dt>
              <dd>{d.tests.join(', ')}</dd>
            </dl>
            {d.changedAfterReport && <p className="hint">The results were changed after the first report: ask the hospital for the latest copy.</p>}
            <p className="hint">Results are not shown here. Compare the details above with the printed report.</p>
          </>
        )}
      </section>
    </main>
  );
}
