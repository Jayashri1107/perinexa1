import { CircleCheck, FileSignature, FlaskConical, Info, ListChecks, Pill, ShieldAlert, Siren } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { TablePagination } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../../platform/modules.js';

// Clinic library → To approve (doctors): everything in the hospital's libraries that is still a draft – care-plan
// templates, red-flag rules, medicine safety, consent forms and prescription sets – in one list, each with a link
// to its page, where it is checked and approved. Drafts are reminders only until a doctor approves them. New built-in
// red-flag rules and entries of the medicine safety list that a doctor has not added yet are listed as well.

/** The drafts from the five library lists (each answer may still be loading: null). */
export function draftsFrom({ templates, redFlags, medSafety, consents, sets, packages }) {
  const out = [];
  for (const t of templates?.templates ?? []) {
    if (t.status === 'draft' && t.isActive !== false && t.canApprove !== false) out.push({ key: `t:${t.id}`, kind: 'template', name: t.name, to: `/care-plans/templates/${t.id}`, changedAt: t.updatedAt, by: t.updatedByName });
  }
  const rs = redFlags?.ruleSet;
  if (rs?.status === 'draft' && rs.canApprove !== false) out.push({ key: 'redflags', kind: 'redflags', name: 'Red-flag rules', to: '/care-plans/red-flags', changedAt: rs.updatedAt, by: rs.updatedByName });
  // Rules a doctor approved or changed are never given new built-in rules by themselves (lab results, care after
  // delivery, newborn babies): until a doctor adds them, nothing of that kind raises a flag – so it is listed here too.
  if (rs?.newBuiltIn > 0 && rs.canApprove !== false) {
    out.push({
      key: 'redflags-new',
      kind: 'redflags',
      name: `Red-flag rules – ${rs.newBuiltIn} new built-in draft ${rs.newBuiltIn === 1 ? 'rule' : 'rules'} to add and review`,
      to: '/care-plans/red-flags',
    });
  }
  const ms = medSafety?.list;
  if (ms?.status === 'draft' && ms.canApprove !== false) out.push({ key: 'medsafety', kind: 'medsafety', name: 'Medicine safety list', to: '/medicine-safety', changedAt: ms.updatedAt, by: ms.updatedByName });
  // A list a doctor approved or changed is never given new built-in entries by itself (dose limits, breastfeeding and
  // newborn entries): until a doctor adds them, nothing of that kind is checked – so it is listed here too.
  if (ms?.newBuiltIn > 0 && ms.canApprove !== false) {
    out.push({
      key: 'medsafety-new',
      kind: 'medsafety',
      name: `Medicine safety list – ${ms.newBuiltIn} new built-in draft ${ms.newBuiltIn === 1 ? 'entry' : 'entries'} to add and review`,
      to: '/medicine-safety',
    });
  }
  for (const f of consents?.forms ?? []) {
    if (f.status !== 'draft' || !f.isActive) continue;
    const info = f.kind === 'information';
    out.push({
      key: `c:${f.id}`,
      kind: info ? 'information' : 'consent',
      name: f.title?.en ?? (info ? 'Information form' : 'Consent form'),
      to: `${info ? '/information-forms' : '/consent-forms'}/${f.id}`,
      changedAt: f.updatedAt,
      by: f.updatedByName,
    });
  }
  for (const p of packages?.packages ?? []) {
    if (p.status === 'draft' && p.isActive) out.push({ key: `p:${p.id}`, kind: 'package', name: p.name, to: `/test-packages/${p.id}`, changedAt: p.updatedAt, by: p.updatedByName });
  }
  for (const s of sets?.sets ?? []) {
    if (s.status === 'draft' && s.isActive) out.push({ key: `s:${s.id}`, kind: 'set', name: s.name, to: `/prescription-sets/${s.id}`, changedAt: s.updatedAt, by: s.updatedByName });
  }
  return out;
}

export const KIND_LOOK = {
  template: { word: 'Care-plan template', icon: ListChecks },
  redflags: { word: 'Red-flag rules', icon: Siren },
  medsafety: { word: 'Medicine safety', icon: ShieldAlert },
  consent: { word: 'Consent form', icon: FileSignature },
  information: { word: 'Information form', icon: Info },
  set: { word: 'Prescription set', icon: Pill },
  package: { word: 'Test package', icon: FlaskConical },
};

/** The library lists, for doctors (null for anyone else: nothing is fetched). */
export function useLibraryDrafts(enabled) {
  const templates = useFetch(enabled ? '/care-plans/templates' : null);
  const redFlags = useFetch(enabled ? '/red-flag-rules' : null);
  const medSafety = useFetch(enabled ? '/medicine-safety' : null);
  const consents = useFetch(enabled ? '/consent-forms' : null);
  const sets = useFetch(enabled ? '/prescription-sets' : null);
  const packages = useFetch(enabled ? '/lab-packages' : null);
  const all = [templates, redFlags, medSafety, consents, sets, packages];
  return {
    drafts: draftsFrom({ templates: templates.data, redFlags: redFlags.data, medSafety: medSafety.data, consents: consents.data, sets: sets.data, packages: packages.data }),
    loading: all.some((r) => !r.data && !r.error),
    error: all.find((r) => r.error)?.error ?? null,
  };
}

export function ApprovalsPage() {
  const { activeMembership } = useAuth();
  const isDoctor = hasRole(activeMembership, 'doctor');
  const { drafts, loading, error } = useLibraryDrafts(isDoctor);
  // A long list is shown a page at a time (the list itself is unchanged).
  const [limit, setLimit] = useState(10);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(drafts.length / limit));
  const current = Math.min(page, totalPages);
  const shown = drafts.slice((current - 1) * limit, current * limit);
  return (
    <>
      <PageHeader
        breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'To approve' }]}
        title="To approve"
        help="Drafts in the clinic library: reminders only until a doctor checks and approves them."
        tabs={knowledgeTabs(activeMembership.roles)}
      />
      <div className="pf-content">
        {!isDoctor ? (
          <div className="card narrow">Doctors approve the clinic library.</div>
        ) : (
          <section className="card" aria-labelledby="ap-title">
            <h2 id="ap-title">
              Waiting for a doctor's approval {!loading && <span className="muted tabular">({drafts.length})</span>}
            </h2>
            <Alert type="error">{error}</Alert>
            {loading && <p className="muted">Loading…</p>}
            {!loading && drafts.length === 0 && (
              <p>
                <StatusPill tone="stable" icon={CircleCheck}>
                  All approved
                </StatusPill>{' '}
                Nothing in the clinic library is waiting for approval.
              </p>
            )}
            {drafts.length > 0 && (
              <ul className="plain-list ap-list">
                {shown.map((d) => {
                  const look = KIND_LOOK[d.kind];
                  return (
                    <li key={d.key}>
                      <StatusPill tone="watch" icon={look.icon}>
                        {look.word}
                      </StatusPill>
                      <Link to={d.to} className="strong-name">
                        {d.name}
                      </Link>
                      {d.changedAt && (
                        <span className="muted t-caption">
                          Last changed {formatDateTime(d.changedAt)}
                          {d.by ? ` by ${d.by}` : ''}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {drafts.length > 10 && (
              <TablePagination
                page={current}
                totalPages={totalPages}
                total={drafts.length}
                limit={limit}
                label="drafts"
                sizes={[10, 25, 50]}
                onPage={setPage}
                onLimit={(n) => {
                  setLimit(n);
                  setPage(1);
                }}
              />
            )}
          </section>
        )}
      </div>
    </>
  );
}
