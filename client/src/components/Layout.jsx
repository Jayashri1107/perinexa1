import { TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDialogFocus } from './ui.jsx';

// Pieces shared by the login page and the main app layout (AppLayout.jsx).

export function SampleDataBanner() {
  return (
    <div className="auth-banner" role="note">
      <TriangleAlert aria-hidden="true" />
      <span>
        Development version – use <strong>fake sample data only</strong>. Do not enter real patient information.
      </span>
    </div>
  );
}

export function IdleWarning() {
  const { secondsLeft } = useAuth();
  return secondsLeft === null ? null : <IdleDialog />;
}

function IdleDialog() {
  const { secondsLeft, stayLoggedIn, logout } = useAuth();
  const ref = useDialogFocus(null); // no Escape: the person must choose
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="modal" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-text">
        <h2 id="idle-title">Are you still there?</h2>
        <p id="idle-text">
          For safety, you'll be logged out in <strong className="tabular">{secondsLeft} seconds</strong> because there has been no activity.
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={stayLoggedIn} autoFocus>
            Stay logged in
          </button>
          <button type="button" className="btn btn-link" onClick={() => logout('manual')}>
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}
