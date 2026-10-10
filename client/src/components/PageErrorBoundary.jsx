import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert } from './Alert.jsx';

// A page that fails while showing (or could not be downloaded) shows this message with a Reload button instead of a
// blank screen. Opening another page clears it: the boundary is keyed by the address.
class Boundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Page failed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error">
        <Alert type="error">
          This page could not be shown. Reload the page to try again – what you saved before is kept.
        </Alert>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}

export function PageErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
