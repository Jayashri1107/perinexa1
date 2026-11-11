import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';

/**
 * A patient record that could not be opened. "Patient not found" only when the server said so (another hospital, a
 * record the department rule hides, a wrong address: 400, 403 or 404 – never "not allowed", which would show that the
 * record exists). A dropped connection or a server error says that, with "Try again": the record may well be there.
 */
export function PatientNotOpened({ status, error, tenantName, breadcrumbs, tabs, onRetry }) {
  // (0 or null: the server was not reached; 408, 429: busy, try again)
  const notFound = status >= 400 && status < 500 && status !== 408 && status !== 429;
  if (notFound) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Patient not found" tabs={tabs} />
        <div className="pf-content">
          <div className="card narrow pf-message">
            <p>
              This patient doesn't exist in <strong>{tenantName}</strong>, or you don't have access.
            </p>
            <Link to="/patients" className="btn btn-link">
              Back to patients
            </Link>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader breadcrumbs={breadcrumbs} title="Record not opened" tabs={tabs} />
      <div className="pf-content">
        <div className="card narrow pf-message">
          <Alert type="error">The patient's record could not be opened: {error}</Alert>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              Try again
            </button>
            <Link to="/patients" className="btn btn-link">
              Back to patients
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
