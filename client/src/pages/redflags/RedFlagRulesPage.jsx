import { useState } from 'react';
import { CircleCheck, Pencil } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { Paged } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeSections, knowledgeTabs } from '../../platform/modules.js';
import { RedFlagPill } from './RedFlagList.jsx';
import { EPISODE_HINT, LOSS_RECORD_HINT, READINGS_HINT, RED_FLAGS_NOT_CHECKED, RULE_CARE_LABELS, RULE_CARE_TYPES, appliesToText, newBuiltInText, ruleCareTypes, ruleChecksText, rulesByCareType } from './redFlagFormat.js';

const countText = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Where the built-in draft rules come from – said for a built-in draft, and for built-in rules a doctor added
const BUILT_IN_SOURCES = 'published guidance (FOGSI, WHO, Government of India, NICE, RCOG, ACOG, ATA and NNF India – each rule names its source)';

export function RulesStatusBadge({ ruleSet }) {
  return ruleSet.status === 'approved' ? (
    <StatusPill tone="stable" icon={CircleCheck}>
      Approved
    </StatusPill>
  ) : (
    <StatusPill tone="watch">Draft</StatusPill>
  );
}

function ApproveDialog({ ruleSet, hospitalName, onDone, onCancel, onOutdated }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/red-flag-rules/approve', { method: 'POST', body: { confirm: confirmed, version: ruleSet.version } });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
    }
  };
  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rf-approve-title" onSubmit={approve}>
        <h2 id="rf-approve-title">Approve the red-flag rules</h2>
        <p>
          You are approving {countText(ruleSet.rules.length, 'rule', 'rules')} (version {ruleSet.version}) for {hospitalName}. Once approved, red flags are no
          longer marked as based on draft rules.
        </p>
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a qualified doctor. I have reviewed every rule – the values, the types of care, the weeks or the baby's age, the level and the advice – against
            current guidance (FOGSI, WHO, Government of India and the sources named with each rule) and our hospital's practice, and I approve them for use.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve rules'}
          </button>
        </div>
      </form>
    </div>
  );
}

// The hospital's red-flag rules (Clinic library → Clinical rules → Red-flag rules): what raises a warning – from
// the values of a visit, a lab result or, in hospital, the nursing chart. Listed by the type of care they apply to.
export function RedFlagRulesPage() {
  const { activeMembership } = useAuth();
  const location = useLocation();
  const { data, error, reload } = useFetch('/red-flag-rules');
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [adding, setAdding] = useState(false);
  const rs = data?.ruleSet;

  // Built-in rules added since this hospital's rules were made (rules a doctor approved or changed are never changed
  // by themselves): a doctor adds them, as a new draft to review and approve.
  const addBuiltIn = async () => {
    setAdding(true);
    setActionError(null);
    try {
      const res = await api('/red-flag-rules/add-built-in', { method: 'POST', body: { version: rs.version } });
      setFlash(`${countText(res.added, 'built-in rule', 'built-in rules')} added. The rules are now draft version ${res.ruleSet.version}: review them, then approve them.`);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setAdding(false);
      reload();
    }
  };

  const header = (extra = {}) => (
    <PageHeader
      breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: 'Clinical rules', to: '/care-plans/red-flags' }, { label: 'Red-flag rules' }]}
      title="Red-flag rules"
      tabs={knowledgeTabs(activeMembership.roles)}
      subtabs={knowledgeSections('clinical-rules')}
      {...extra}
    />
  );
  if (error && !rs) {
    return (
      <>
        {header()}
        <div className="pf-content">
          <Alert type="error">{error}</Alert>
        </div>
      </>
    );
  }
  if (!rs) return <FullPageSpinner />;
  const groups = rulesByCareType(rs.rules);
  // Built-in rules a doctor added to the hospital's own rules that no doctor has approved since ("Add them as a
  // draft"): marked row by row, so nobody takes them for rules a colleague wrote and reviewed.
  const addedBuiltIn = new Set(rs.status === 'draft' ? (rs.builtInAdded ?? []) : []);
  const notCovered = RULE_CARE_TYPES.filter((t) => !groups.some((g) => g.careType === t)).map((t) => RULE_CARE_LABELS[t]);

  return (
    <>
      {header({
        // The rule set's status, size and version under the title
        subtitle: (
          <>
            <RulesStatusBadge ruleSet={rs} /> {countText(rs.rules.length, 'rule', 'rules')} · version {rs.version} · last changed{' '}
            {formatDateTime(rs.updatedAt)}
            {rs.updatedByName ? ` by ${rs.updatedByName}` : ''}
          </>
        ),
        actions: (
          <>
            {rs.canEdit && (
              <Link to="/care-plans/red-flags/edit" className={`btn ${rs.status === 'draft' && rs.canApprove ? 'btn-secondary' : 'btn-primary'}`}>
                <Pencil aria-hidden="true" /> Edit rules
              </Link>
            )}
            {rs.canApprove && rs.status === 'draft' && (
              <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
                <CircleCheck aria-hidden="true" /> Approve
              </button>
            )}
          </>
        ),
      })}
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {rs.status === 'draft' ? (
          <Alert type="warning">
            <strong>Draft – not approved for clinical use.</strong>{' '}
            {rs.builtInVersion
              ? `These rules were prepared from ${BUILT_IN_SOURCES}. They are not a clinical review: a doctor must check every value and approve them.`
              : addedBuiltIn.size > 0
                ? `${countText(addedBuiltIn.size, 'rule', 'rules')} below ${addedBuiltIn.size === 1 ? 'is' : 'are'} marked "New built-in draft": added from the built-in rules, not written or reviewed by a doctor of this hospital. They were prepared from ${BUILT_IN_SOURCES} and are not a clinical review: a doctor must check every value of every rule and approve them.`
                : 'The rules have changed. A doctor must review and approve them.'}
          </Alert>
        ) : (
          <Alert type="success">
            Approved by <strong>{rs.approvedByName}</strong> on {formatDateTime(rs.approvedAt)} (version {rs.version}).
          </Alert>
        )}
        {rs.canEdit && rs.newBuiltIn > 0 && (
          <Alert type="info">
            <strong>New built-in rules are available:</strong> {newBuiltInText(rs.newBuiltIn, rs.newBuiltInCareTypes)} Rules that a doctor approved or changed are never
            changed by themselves. Adding them makes a new draft version; nothing already in your rules is changed, and a doctor reviews and approves the new version.{' '}
            <button type="button" className="btn btn-link plan-inline-link" onClick={addBuiltIn} disabled={adding}>
              {adding ? 'Adding…' : 'Add them as a draft'}
            </button>
          </Alert>
        )}
        <p className="hint cp-section-hint">
          A red flag is raised when every check of a rule is true for a patient of the rule's type of care. The values come from her latest visit, from the lab results reported in
          this pregnancy or episode of care, and – while she is in hospital – from the nursing chart. A value that was not recorded never raises a flag. {EPISODE_HINT}{' '}
          {READINGS_HINT} {LOSS_RECORD_HINT}
        </p>
        <p className="hint cp-section-hint">{RED_FLAGS_NOT_CHECKED}</p>
        {groups.length === 0 && (
          <section className="dt-card stage">
            <p className="dt-empty">No rules – no red flags will be raised.</p>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.careType} className="dt-card stage" aria-labelledby={`rf-rules-${g.careType}`}>
            <header className="stage-head">
              <h2 id={`rf-rules-${g.careType}`} className="stage-title">
                {g.label}
              </h2>
              <span className="muted tabular">{countText(g.rules.length, 'rule', 'rules')}</span>
            </header>
            <Paged rows={g.rules} label="rules" initial={5} sizes={[5, 10, 25]}>
              {(shown) => (
            <div className="stage-table">
              <table className="dt">
                <thead>
                  <tr>
                    <th scope="col">Red flag</th>
                    <th scope="col" className="cp-col-checks">
                      Raised when
                    </th>
                    <th scope="col" className="cp-col-level">
                      Level
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key}>
                      <td data-label="Red flag" className="wrap">
                        <span className="strong-name">{r.label}</span>
                        {addedBuiltIn.has(r.key) && (
                          <>
                            {' '}
                            <StatusPill tone="watch">New built-in draft</StatusPill>
                          </>
                        )}
                        {r.message && <div className="cell-sub">{r.message}</div>}
                        {r.source && <div className="cell-sub source-text">Source: {r.source}</div>}
                        {ruleCareTypes(r).length > 1 && <div className="cell-sub">Applies to: {appliesToText(r)}</div>}
                      </td>
                      <td data-label="Raised when" className="wrap">
                        {ruleChecksText(r)}
                      </td>
                      <td data-label="Level">
                        <RedFlagPill level={r.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </Paged>
          </section>
        ))}
        {notCovered.length > 0 && rs.rules.length > 0 && (
          <p className="hint cp-section-hint">No rule applies to: {notCovered.join(', ')}. Patients of these types of care have no red flags.</p>
        )}
      </div>
      {approving && (
        <ApproveDialog
          ruleSet={rs}
          hospitalName={activeMembership.tenantName}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Red-flag rules approved.');
            reload();
          }}
          onOutdated={(message) => {
            setApproving(false);
            setActionError(message);
            reload();
          }}
        />
      )}
    </>
  );
}
