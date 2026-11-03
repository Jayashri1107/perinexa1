import { UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';

/**
 * Phones, lab staff: the top of Today as in the app design (2 Nov 2026), from the worklist's own counts – the main
 * button, the steps of the work in order, then the other two lists. Numbers only, no patient.
 */
export function LabHome({ counts }) {
  const n = (key) => (counts ? formatNumber(counts[key] ?? 0) : '–');
  const steps = [
    { key: 'collect', label: 'Samples to take', to: '/lab' },
    { key: 'receive', label: 'Samples to receive', to: '/lab?list=receive' },
    { key: 'report', label: 'Results to enter', to: '/lab/results' },
    // Only where the hospital checks results, or something still waits for a check
    ...(counts?.verify > 0 ? [{ key: 'verify', label: 'Results to check', to: '/lab?list=verify' }] : []),
  ];
  return (
    <div className="lb-home">
      <Link to="/lab/new" className="btn btn-primary">
        <UserPlus aria-hidden="true" /> New registration
      </Link>
      <section aria-labelledby="lb-work">
        <h2 id="lb-work">Work waiting</h2>
        <ol className="lb-steps">
          {steps.map((s, i) => (
            <li key={s.key}>
              <Link to={s.to}>
                <span className="lb-step-no" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="lb-step-word">{s.label}</span>
                <strong className="tabular">{n(s.key)}</strong>
              </Link>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="lb-other">
        <h2 id="lb-other">Other lists</h2>
        <div className="lb-tiles">
          <Link to="/lab?list=home">
            <strong className="tabular">{n('home')}</strong>
            <span>Home collections</span>
          </Link>
          <Link to="/lab?list=outside">
            <strong className="tabular">{n('outside')}</strong>
            <span>At outside labs</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
