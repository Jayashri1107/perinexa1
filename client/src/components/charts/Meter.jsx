import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isExact, shareText } from '../../pages/analytics/analyticsFormat.js';

/**
 * One "x of y" row: the label, an 8 px track with the share filled, and the words ("34 of 40 · 85%",
 * "12 of 15 · Too few to compare", "fewer than 5 of 40"). The track is filled only from two exact numbers.
 * href: the patients behind x (doctors only).
 */
export function Meter({ label, num, den, href }) {
  const text = shareText(num, den);
  const width = isExact(num) && isExact(den) && den > 0 ? Math.min(100, (num / den) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        {href ? (
          <Link to={href} className="meter-link">
            {label}
            <ChevronRight aria-hidden="true" />
            <span className="sr-only">: open the list of patients</span>
          </Link>
        ) : (
          label
        )}
      </div>
      <div className="meter-track" role="img" aria-label={`${label}: ${text}`}>
        {width > 0 && <span className="meter-fill" style={{ width: `${width}%` }} />}
      </div>
      <div className="meter-text">{text}</div>
    </div>
  );
}
