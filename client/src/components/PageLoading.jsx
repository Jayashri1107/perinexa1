import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

/** While a screen's code arrives (it is loaded the first time it is opened – App.jsx): a slim moving line at the top of
 *  the page area; the header, menu and bottom bar stay where they are. */
export function PageLoading() {
  return <div className="pf-page-loading" role="progressbar" aria-label="Loading the page" />;
}

/** An Outlet whose screen may still be loading: the line shows in its place, the page around it stays. */
export function LoadingOutlet(props) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Outlet {...props} />
    </Suspense>
  );
}
