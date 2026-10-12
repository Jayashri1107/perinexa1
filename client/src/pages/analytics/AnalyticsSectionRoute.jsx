import { SearchX } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { AnalyticsPage } from './AnalyticsPage.jsx';
import { SECTIONS } from './analyticsFormat.js';

/** /analytics/:section – a known tab (Overview is /analytics itself), each its own page (keyed), or "not found". */
export function AnalyticsSectionRoute({ platform = false }) {
  const { section } = useParams();
  if (!SECTIONS.includes(section) || section === 'overview') {
    const base = platform ? '/platform/analytics' : '/analytics';
    return (
      <>
        <PageHeader title="Page not found" />
        <div className="pf-content">
          <section className="card narrow acc-message">
            <span className="acc-message-icon" aria-hidden="true">
              <SearchX />
            </span>
            <p>This analytics page doesn't exist.</p>
            <Link to={base} className="btn btn-secondary">
              Go to Analytics
            </Link>
          </section>
        </div>
      </>
    );
  }
  return <AnalyticsPage key={section} section={section} platform={platform} />;
}
