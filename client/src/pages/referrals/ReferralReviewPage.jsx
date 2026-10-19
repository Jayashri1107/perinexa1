import { useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, PenLine } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';
import { Section } from '../worklist/WorklistSections.jsx';
import { ReviewDialog } from './ReferralPage.jsx';
import { PromisePill } from './ReferralsDeskPage.jsx';
import { isoAddDays, localIso, mondayOf, promiseLabel, shiftWeek, shortDay, whoFacts, whoName } from './referralFormat.js';

// The weekly review (docs/REFERRALS_PLAN.md – the guide: "a miss is reviewed within the week"): the promises that
// fell due in one week (Monday to Sunday) and were not kept on time, with what the consultants wrote about each –
// what went wrong and what changed. Doctors and RMOs write the reviews; the referral desk reads them.
// A No from the patient is never a miss, so it is never listed here.

/** "Mon 12 Oct – Sun 18 Oct 2026". */
const weekWords = (from, to) => `${shortDay(from)} – ${shortDay(to)} ${to.slice(0, 4)}`;

export function ReferralReviewPage() {
  const { activeMembership } = useAuth();
  const [params, setParams] = useSearchParams();
  const thisWeek = mondayOf(localIso());
  const asked = params.get('week');
  const week = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? mondayOf(asked) : thisWeek;
  const { data, error, loading, reload } = useFetch('/referrals/review', { week });
  const [writing, setWriting] = useState(null); // the item being reviewed
  const [notice, setNotice] = useState(null);
  const writes = hasRole(activeMembership, 'doctor', 'rmo');
  const go = (monday) => setParams(monday === thisWeek ? {} : { week: monday }, { replace: true });
  const items = data?.items ?? [];
  const from = data?.week?.from?.slice(0, 10) ?? week;
  const to = data?.week?.to?.slice(0, 10) ?? isoAddDays(week, 6);
  const reviewed = items.filter((i) => i.reviews?.length).length;
  return (
    <>
      <PageHeader
        title="Weekly review"
        help="Every promise to a referring doctor that was not kept on time, week by week. Her doctor or an RMO writes what went wrong and what changed; the guide promises this within the week."
        tabs={moduleByKey('referrals')?.tabs}
      />
      <div className="pf-content appt-page">
        <div className="card appt-toolbar">
          <div className="row" role="group" aria-label="Week (Monday to Sunday)">
            <button type="button" className="icon-btn" onClick={() => go(shiftWeek(week, -1))} aria-label="Week before">
              <ChevronLeft aria-hidden="true" />
            </button>
            <input type="date" aria-label="Any day of the week" style={{ width: 'auto' }} value={week} max={localIso()} onChange={(e) => e.target.value && go(mondayOf(e.target.value))} />
            <button type="button" className="icon-btn" onClick={() => go(shiftWeek(week, 1))} aria-label="Week after" disabled={week >= thisWeek}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <strong className="tabular">{weekWords(from, to)}</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(thisWeek)} disabled={week === thisWeek}>
            This week
          </button>
        </div>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{error}</Alert>
        {loading && !data ? (
          <p className="muted">Loading…</p>
        ) : (
          <Section
            id="ref-review-list"
            collapsible={false}
            icon={ClipboardCheck}
            title={`Missed promises${items.length ? ` · ${reviewed} of ${items.length} reviewed` : ''}`}
            count={items.length}
            empty="Every promise due in this week was kept on time."
          >
            <ul className="wl-list">
              {items.map((item) => {
                const r = item.referral;
                const p = { key: item.promise?.key ?? item.promise, label: item.promise?.label ?? item.label, due: item.due, doneAt: item.doneAt, state: item.state };
                return (
                  <li key={`${r.id}-${p.key}`}>
                    <div className="wl-row-head">
                      <span className="wl-who">
                        <Link to={`/referrals/${r.id}`} className="strong-name tabular">
                          {r.number}
                        </Link>
                        <span>{whoName(r)}</span>
                        <span className="muted tabular">{whoFacts(r)}</span>
                        <span className="muted">from {r.referringDoctor?.name}</span>
                      </span>
                      <span className="wl-counts">
                        <PromisePill promise={p} />
                      </span>
                    </div>
                    <p className="hint">
                      <strong>{promiseLabel(p)}</strong> · due {formatDateTime(p.due)}
                      {p.doneAt ? ` · done ${formatDateTime(p.doneAt)}` : ' · not done yet'}
                      {r.consultant ? ` · ${r.consultant.name}` : ''}
                    </p>
                    {(item.reviews ?? []).map((v) => (
                      <dl key={v.at} className="details">
                        <div>
                          <dt>What went wrong</dt>
                          <dd>{v.wentWrong}</dd>
                        </div>
                        <div>
                          <dt>What changed</dt>
                          <dd>
                            {v.changed} <span className="muted">– {v.byName}, {formatDateTime(v.at)}</span>
                          </dd>
                        </div>
                      </dl>
                    ))}
                    {writes && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWriting({ referral: r, promise: p.key })}>
                        <PenLine aria-hidden="true" /> {item.reviews?.length ? 'Add to the review' : 'Write the review'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        {!writes && items.length > 0 && <p className="hint">Her doctor or an RMO writes the reviews.</p>}
      </div>
      {writing && (
        <ReviewDialog
          referral={writing.referral}
          promises={writing.referral.promises ?? []}
          preset={writing.promise}
          onCancel={() => setWriting(null)}
          onSaved={() => {
            setWriting(null);
            setNotice('The review is saved.');
            reload();
          }}
        />
      )}
    </>
  );
}
