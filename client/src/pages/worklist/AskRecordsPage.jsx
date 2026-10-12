import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDate, hasRole } from '../../components/ui.jsx';
import { ASK_TAB } from '../../platform/modules.js';
import { analyticsTabs } from '../analytics/analyticsFormat.js';
import { RiskBadge } from '../patients/RiskCard.jsx';
import { flagCountText } from '../redflags/redFlagFormat.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const EXAMPLES = [
  'High-risk patients over 34 weeks',
  'Who is due to deliver in the next 4 weeks?',
  'Patients with overdue care plan items',
  'Rh negative mothers between 26 and 30 weeks',
  'My patients with urgent red flags',
  "Pregnant patients not seen for 6 weeks",
];

// "Ask your records" (Smart features, step 9): a question in plain words; the AI only turns it into a search
// (it never sees patient data) and Perinexa shows the patients that match, among those this person may see.
export function AskRecordsPage() {
  const { activeMembership } = useAuth();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (q = question) => {
    if (!q.trim()) return;
    setQuestion(q);
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api('/ai/ask', { method: 'POST', body: { question: q } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Patient',
      render: (r) => (
        <span className="name-cell-text">
          <Link to={`/patients/${r.id}`} className="strong-name">
            {r.fullName}
          </Link>
          <span className="muted tabular">{r.mrn}</span>
        </span>
      ),
    },
    { key: 'weeks', header: 'Weeks', width: 110, render: (r) => (r.gestationalAge ? <span className="tabular">{`${r.gestationalAge.weeks}w ${r.gestationalAge.days}d`}</span> : <span className="muted">—</span>) },
    { key: 'edd', header: 'EDD', width: 130, render: (r) => (r.edd ? <span className="tabular">{formatDate(r.edd)}</span> : <span className="muted">—</span>) },
    { key: 'risk', header: 'Risk', width: 150, render: (r) => (r.risk ? <RiskBadge level={r.risk.level} /> : <span className="muted">—</span>) },
    {
      key: 'why',
      header: 'Found because',
      className: 'vs-col-wrap',
      render: (r) =>
        [r.flags?.length ? `Red flags: ${flagCountText(r.flags)}` : null, r.carePlan ? `Care plan: ${r.carePlan.top.map((i) => i.name).join(', ') || 'items to act on'}` : null].filter(Boolean).join(' · ') || (
          <span className="muted">{r.assignedDoctorName ?? ''}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: hasRole(activeMembership, 'doctor') ? '/analytics' : '/analytics/ask' }, { label: 'Ask your records' }]}
        title="Ask your records"
        tabs={hasRole(activeMembership, 'doctor') ? analyticsTabs('/analytics', '', { ask: true, report: true }) : [ASK_TAB]}
      />
      <div className="pf-content ask-page">
        <form
          className="card ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <label className="field-label" htmlFor="ask-q">
            Ask in plain words
          </label>
          <div className="ask-row">
            <input id="ask-q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="e.g. High-risk patients over 34 weeks" />
            <button type="submit" className="btn btn-primary" disabled={busy || question.trim().length < 3}>
              <Search aria-hidden="true" /> {busy ? 'Searching…' : 'Ask'}
            </button>
          </div>
          <div className="ask-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="btn btn-link btn-sm" onClick={() => ask(ex)} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
          <p className="hint">
            <Sparkles aria-hidden="true" className="inline-icon" /> Only your question is sent to the AI (OpenAI), never patient details. It turns the question
            into a search; Perinexa runs the search on the records you may see. Don't type patient names in the question.
          </p>
        </form>
        <Alert type="error">{error}</Alert>
        {answer && (
          <>
            <Alert type="info">
              <strong>Understood as:</strong> {answer.understood}
              {answer.unsupported ? ` Not possible yet: ${answer.unsupported}` : ''}
            </Alert>
            {answer.cut && <Alert type="warning">Only the first 200 patients are shown – make the question narrower.</Alert>}
            <DataTable columns={columns} rows={answer.results} emptyText="No patients match." caption={`${answer.results.length} patient${answer.results.length === 1 ? '' : 's'}`} />
          </>
        )}
      </div>
    </>
  );
}
