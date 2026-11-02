import { Component, Suspense } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';

/** While a screen's code arrives (it is loaded the first time it is opened – App.jsx): a slim moving line at the top of
 *  the page area; the header, menu and bottom bar stay where they are. */
export function PageLoading() {
  return <div className="pf-page-loading" role="progressbar" aria-label="Loading the page" />;
}

// A new deploy renames the screens' files, so a page left open asks for a name that is gone: one reload fetches the new ones.
const RELOADED = 'perinexa-reloaded-for-new-version';
const isOldFiles = (error) => /dynamically imported module|importing a module script failed|loading chunk/i.test(String(error?.message ?? error));

function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOADED)) return;
    sessionStorage.setItem(RELOADED, '1');
  } catch {
    return;
  }
  window.location.reload();
}

/** One screen failing does not blank the whole app: the header and menu stay, with a short message and the way on. */
export class ScreenBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (isOldFiles(error)) reloadOnce();
  }

  componentDidUpdate(before) {
    // Going to another page clears the message
    if (this.state.error && before.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pf-content">
        <section className="card narrow acc-message" role="alert">
          <span className="acc-message-icon" aria-hidden="true">
            <TriangleAlert />
          </span>
          <p>This page could not open. Please try again, or go back to the start page.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Try again
            </button>
            <a className="btn btn-secondary" href="/">
              Start page
            </a>
          </div>
        </section>
      </div>
    );
  }
}

/** An Outlet whose screen may still be loading: the line shows in its place, the page around it stays. */
export function LoadingOutlet(props) {
  const { pathname } = useLocation();
  return (
    <ScreenBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoading />}>
        <Outlet {...props} />
      </Suspense>
    </ScreenBoundary>
  );
}
