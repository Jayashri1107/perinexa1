import { ArrowRight, Building2, KeyRound, Plus, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AUDIT_LABELS, auditPill, describeAudit, doneBy } from '../../components/auditFormat.js';
import { formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

// "1 super admin", "3 super admins"
const count = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function OverviewPage() {
  const { data, error, loading } = useFetch('/platform/stats');
  const s = data;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Overview' }]}
        title="Overview"
        help="Platform health at a glance."
        tabs={moduleByKey('overview').tabs}
        actions={
          <>
            <Link to="/platform/users/new" className="btn btn-secondary">
              <UserPlus aria-hidden="true" /> New account
            </Link>
            <Link to="/platform/hospitals/new" className="btn btn-primary">
              <Plus aria-hidden="true" /> New hospital
            </Link>
          </>
        }
      />
      <div className="pf-content">
        <Alert type="error">{error && <>Couldn't load the platform numbers. {error}</>}</Alert>

        <div className="kpi-grid plat-kpis" aria-busy={loading}>
          <KpiCard
            label="Active hospitals"
            value={s ? formatNumber(s.tenants.active) : '—'}
            sub={s ? `${formatNumber(s.tenants.total)} in total` : ''}
            to="/platform/hospitals?status=active"
          />
          <KpiCard
            tone={s?.tenants.withoutAdmin ? 'watch' : 'neutral'}
            label="Hospitals with no admin"
            value={s ? formatNumber(s.tenants.withoutAdmin) : '—'}
            sub="Need an admin assigned"
            to="/platform/hospitals"
          />
          <KpiCard
            label="Active accounts"
            value={s ? formatNumber(s.users.active) : '—'}
            sub={s ? `${count(s.users.superAdmins, 'super admin', 'super admins')} · ${formatNumber(s.users.inactive)} deactivated` : ''}
            to="/platform/users"
          />
          <KpiCard
            tone={s?.users.pendingFirstLogin ? 'due' : 'neutral'}
            icon={s?.users.pendingFirstLogin ? KeyRound : undefined}
            label="Pending first login"
            value={s ? formatNumber(s.users.pendingFirstLogin) : '—'}
            sub="Still using a temporary password"
            to="/platform/users/pending"
          />
          <KpiCard
            tone={s?.security.failedLogins24h ? 'high' : 'neutral'}
            label="Failed sign-ins (24 h)"
            value={s ? formatNumber(s.security.failedLogins24h) : '—'}
            sub={s ? `${count(s.security.events24h, 'security event', 'security events')} in 24 h` : ''}
            to="/platform/audit?category=security"
          />
        </div>

        <div className="plat-overview">
          {/* "Needs attention" comes first (reading order and narrow screens); on wide screens it sits in the right rail. */}
          <section className="panel plat-rail">
            <header className="panel-header">
              <h2>Needs attention</h2>
              <Link to="/platform/hospitals" className="plat-more">
                All hospitals <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            {s && s.tenantsWithoutAdmin.length === 0 ? (
              <p className="panel-empty">Every active hospital has at least one admin.</p>
            ) : (
              <ul className="attention-list">
                {s?.tenantsWithoutAdmin.map((t) => (
                  <li key={t.id}>
                    <span className="plat-attention-item">
                      <Building2 aria-hidden="true" />
                      <Link to={`/platform/hospitals/${t.id}`}>{t.name}</Link>
                      <StatusPill tone="watch">No admin</StatusPill>
                    </span>
                    <Link to={`/platform/hospitals/${t.id}/staff`} className="btn btn-secondary btn-sm">
                      Add admin
                    </Link>
                  </li>
                ))}
                {s && s.tenants.withoutAdmin > s.tenantsWithoutAdmin.length && (
                  <li className="muted">…and {formatNumber(s.tenants.withoutAdmin - s.tenantsWithoutAdmin.length)} more</li>
                )}
              </ul>
            )}
          </section>

          <section className="panel plat-main-panel">
            <header className="panel-header">
              <h2>Recent activity</h2>
              <Link to="/platform/audit" className="plat-more">
                Full audit log <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            <ul className="activity-list">
              {s?.recentActivity.map((e) => (
                <li key={e.id}>
                  <StatusPill {...auditPill(e.action)}>{AUDIT_LABELS[e.action] ?? e.action}</StatusPill>
                  <span className="activity-text">
                    {doneBy(e) ?? 'Unknown'}
                    {e.targetEmail && e.targetEmail !== e.actorEmail && (
                      <span className="muted">
                        {' '}
                        <ArrowRight aria-hidden="true" />
                        <span className="sr-only">affecting</span> {e.targetEmail}
                      </span>
                    )}
                    {describeAudit(e) && <span className="muted"> · {describeAudit(e)}</span>}
                    {e.tenantName && <span className="muted"> · {e.tenantName}</span>}
                  </span>
                  <time className="t-caption muted nowrap tabular" dateTime={e.createdAt}>
                    {formatDateTime(e.createdAt)}
                  </time>
                </li>
              ))}
              {s && s.recentActivity.length === 0 && <li className="panel-empty">Nothing recorded yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
