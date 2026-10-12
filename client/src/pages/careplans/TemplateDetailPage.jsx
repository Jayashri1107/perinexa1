import { useEffect, useState } from 'react';
import { CircleCheck, Copy, Pencil, Plus, RefreshCw, Star, StarOff } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../../platform/modules.js';
import { TemplateStatusBadge } from './TemplatesPage.jsx';
import {
  APPLIES_LABELS,
  builtInOfferText,
  CARE_TYPE_TEMPLATE_LABELS,
  careWords,
  ITEM_KIND_ICONS,
  ITEM_KIND_LABELS,
  defaultChangedText,
  defaultNotice,
  groupByStage,
  plansUpdateResultText,
  plansUseText,
  templateOwnerLabel,
  timingText,
} from './templateFormat.js';
import { UpdatePlansDialog } from './UpdatePlansDialog.jsx';
import { RiskBadge } from '../patients/RiskCard.jsx';
import { NOT_CHECKED_YET, ruleText } from '../patients/riskFormat.js';

const countText = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function ApproveDialog({ template, hospitalName, onDone, onCancel, onOutdated }) {
  const [confirmed, setConfirmed] = useState(false);
  const hasRules = template.careType === 'antenatal' && template.kind === 'standard';
  const rules = hasRules ? (template.riskRules ?? []) : [];
  const toConfirm = [...template.items, ...rules].filter((x) => /doctor to (confirm|decide)/i.test(x.source ?? '')).length;
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/care-plans/templates/${template.id}/approve`, { method: 'POST', body: { confirm: confirmed, version: template.version } });
      onDone(res.recalculated);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message); // changed since the page was opened – show the latest version
    }
  };
  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="approve-title" onSubmit={approve}>
        <h2 id="approve-title">Approve for clinical use</h2>
        <p>
          You are approving <strong>{template.name}</strong> (version {template.version}) with {template.items.length} schedule items
          {hasRules && ` and ${rules.length} risk rules`}. Once approved, it can be used to build care plans for patients
          {template.kind === 'standard' ? ` in ${hospitalName}` : ' under your protocol'}.
        </p>
        {hasRules && (
          <Alert type="warning">
            Approving also approves the <strong>risk rules</strong>: patients' automatic risk levels will no longer be marked as based on draft rules.
          </Alert>
        )}
        {toConfirm > 0 && (
          <Alert type="warning">
            {toConfirm} item{toConfirm > 1 ? 's are' : ' is'} marked “doctor to confirm” in the sources – please decide on each (and edit the template if needed)
            before approving.
          </Alert>
        )}
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a qualified doctor. I have reviewed every schedule item{hasRules ? ' and every risk rule (including the cut-offs marked “doctor to confirm”)' : ''} in
            this template against the current FOGSI, WHO and Government of India guidance and our hospital's practice, and I approve it for use.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve template'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * "Patients' plans" on a template's page: how many current plans use it and how many of those are on an older version
 * (counts only), how plans are updated, and – for who may change the template, once its version is approved – the
 * button that updates them all at once (onUpdate opens the dialog).
 */
export function PlansUseCard({ template: t, onUpdate }) {
  return (
    <section className="card cp-use-card" aria-labelledby="plans-use-title">
      <h2 id="plans-use-title">Patients' plans</h2>
      <p>{plansUseText(t)}</p>
      <p className="hint">
        A plan keeps the version it was built from until a doctor updates it: one by one on the patient's Care plan tab{t.canUpdatePlans ? ', or all at once here' : ''}.
        Items done, dates moved, notes and items added for a patient are kept.
        {t.mayUpdatePlans && !t.canUpdatePlans && t.olderVersion > 0 ? ' Once this version is approved, the plans can be updated here all at once.' : ''}
      </p>
      {t.canUpdatePlans && t.olderVersion > 0 && (
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onUpdate}>
            <RefreshCw aria-hidden="true" /> Update plans to version {t.version}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * "My default protocol" on the page of a doctor's own protocol (only for that doctor): make it the default for its type
 * of care (an approved version only), or stop using it as the default. onChange(on) makes the change.
 */
export function DefaultCard({ template: t, busy, onChange }) {
  const approved = t.status === 'approved';
  return (
    <section className="card cp-use-card" aria-labelledby="default-title">
      <h2 id="default-title">My default protocol</h2>
      {t.ownerDefault ? (
        <p>If you stop using it as your default, new care plans of your patients start from the hospital standard template. Plans that already exist do not change.</p>
      ) : approved ? (
        <p>
          Make this protocol your default for {careWords(t.careType)}: new care plans of the patients assigned to you then start from it instead of the hospital
          standard template. Plans that already exist do not change. You have one default for each type of care – choosing this one replaces the earlier one.
        </p>
      ) : (
        <p className="muted">A draft cannot be your default. Once this protocol is approved, you can make it your default: new care plans of the patients assigned to you would then start from it.</p>
      )}
      {(t.ownerDefault || approved) && (
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => onChange(!t.ownerDefault)} disabled={busy}>
            {t.ownerDefault ? <StarOff aria-hidden="true" /> : <Star aria-hidden="true" />} {busy ? 'Saving…' : t.ownerDefault ? 'Stop using as my default' : 'Make it my default'}
          </button>
        </div>
      )}
    </section>
  );
}

export function TemplateDetailPage() {
  const { id } = useParams();
  const { activeMembership, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/care-plans/templates/${id}`);
  // Opened from Clinical rules → Risk rules: go to the risk rules once the template is on the page
  const toRiskRules = location.hash === '#risk-rules' && Boolean(data);
  useEffect(() => {
    if (toRiskRules) document.getElementById('risk-rules')?.scrollIntoView({ block: 'start' });
  }, [toRiskRules]);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [adding, setAdding] = useState(false); // adding the built-in draft items and rules on offer
  const [updating, setUpdating] = useState(false); // the "Update all plans" dialog
  const [defaultBusy, setDefaultBusy] = useState(false);
  const t = data?.template;

  if (error && !t) {
    return (
      <>
        <PageHeader
          breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'Care plans', to: '/care-plans/templates' }, { label: 'Not found' }]}
          title="Template not found"
        />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{error}</Alert>
            <p>
              <Link to="/care-plans/templates">Back to templates</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!t) return <FullPageSpinner />;

  const copy = async () => {
    setCopying(true);
    setActionError(null);
    try {
      const res = await api('/care-plans/templates', { method: 'POST', body: { copyFrom: t.id } });
      navigate(`/care-plans/templates/${res.template.id}`, { state: { flash: 'Your own copy was created as a draft. Edit it as needed, then approve it.' } });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setCopying(false);
    }
  };

  // Built-in DRAFT content this template does not have yet (items and risk rules for findings in this pregnancy;
  // postnatal items that now follow those findings). A template a doctor approved or edited is never changed by an
  // upgrade: a doctor adds it here, as a new draft version. The list shown is exactly what is added or changed.
  const offer = t.canEdit ? builtInOfferText(t.builtInUpdates, t.careType) : null;
  const offerText = offer?.counts ?? '';
  const addBuiltIn = async () => {
    setAdding(true);
    setActionError(null);
    try {
      const res = await api(`/care-plans/templates/${t.id}/built-in`, { method: 'POST', body: { version: t.version } });
      const rc = res.recalculated;
      setFlash(
        `Added as draft version ${res.template.version}: ${offerText}. Review them, edit what your hospital does differently, then approve the template.${
          rc?.checked ? ` Risk levels were re-checked for ${rc.checked} pregnanc${rc.checked === 1 ? 'y' : 'ies'} (${rc.changed} changed).` : ''
        }`,
      );
      reload();
    } catch (err) {
      setActionError(err.message);
      if (err.status === 409) reload();
    } finally {
      setAdding(false);
    }
  };

  // A doctor's default protocol (new plans of their patients start from it): only its own doctor chooses it, and only
  // an approved version. Existing plans never change.
  const changeDefault = async (on) => {
    setDefaultBusy(true);
    setActionError(null);
    try {
      await api(`/care-plans/templates/${t.id}/default`, on ? { method: 'PUT', body: { version: t.version } } : { method: 'DELETE' });
      setFlash(defaultChangedText(t, on));
      reload();
    } catch (err) {
      setActionError(err.message);
      if (err.status === 409) reload();
    } finally {
      setDefaultBusy(false);
    }
  };
  const notice = defaultNotice(t, user.id);

  const groups = groupByStage(t.items, t.careType);

  return (
    <>
      <PageHeader
        breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'Care plans', to: '/care-plans/templates' }, { label: t.name }]}
        title={t.name}
        tabs={knowledgeTabs(activeMembership.roles)}
        badges={<TemplateStatusBadge template={t} />}
        subtitle={`${CARE_TYPE_TEMPLATE_LABELS[t.careType]} · ${templateOwnerLabel(t, user.id)} · ${countText(t.items.length, 'item', 'items')} · last changed ${formatDateTime(t.updatedAt)}${t.updatedByName ? ` by ${t.updatedByName}` : ''}`}
        actions={
          <>
            {hasRole(activeMembership, 'doctor') && (
              <button type="button" className="btn btn-secondary" onClick={copy} disabled={copying}>
                <Copy aria-hidden="true" /> Copy as my protocol
              </button>
            )}
            {t.canEdit && (
              <Link to={`/care-plans/templates/${t.id}/edit`} className="btn btn-secondary">
                <Pencil aria-hidden="true" /> Edit
              </Link>
            )}
            {t.canApprove && t.status === 'draft' && (
              <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
                <CircleCheck aria-hidden="true" /> Approve
              </button>
            )}
          </>
        }
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {t.status === 'draft' ? (
          <Alert type="warning">
            <strong>Draft – not approved for clinical use.</strong>{' '}
            {t.approvedVersion
              ? `Version ${t.approvedVersion} was approved by ${t.approvedByName} on ${formatDateTime(t.approvedAt)}, but the template has changed since and must be approved again.`
              : 'A doctor must review every item and approve this template before it is used for patients.'}
          </Alert>
        ) : (
          <Alert type="success">
            Approved by <strong>{t.approvedByName}</strong> on {formatDateTime(t.approvedAt)} (version {t.approvedVersion}).
          </Alert>
        )}
        {offer && (
          <Alert type="info">
            <strong>New built-in draft content is available:</strong> {offer.counts} {offer.about}. This template was approved or changed by a doctor, so this was
            not added by itself. Adding makes a new <strong>draft</strong> version with exactly what is listed below – nothing else in the template changes.{' '}
            {offer.after}
            <details className="cp-offer-list">
              <summary>What would be added or changed</summary>
              <ul>
                {offer.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
            <div className="row cp-offer-actions">
              <button type="button" className="btn btn-secondary" onClick={addBuiltIn} disabled={adding}>
                <Plus aria-hidden="true" /> {adding ? 'Adding…' : 'Add as a new draft'}
              </button>
            </div>
          </Alert>
        )}
        {notice && <Alert type={notice.type}>{notice.text}</Alert>}
        <PlansUseCard template={t} onUpdate={() => setUpdating(true)} />
        {t.canSetDefault && <DefaultCard template={t} busy={defaultBusy} onChange={changeDefault} />}
        {(t.description || t.sources) && (
          <section className="card template-meta">
            {t.description && <p>{t.description}</p>}
            {t.sources && (
              <p className="muted">
                <span className="cp-meta-label">Sources:</span> {t.sources}
              </p>
            )}
          </section>
        )}

        {groups.map((g) => (
          <section key={g.key} className="dt-card stage" aria-labelledby={`stage-${g.key}`}>
            <header className="stage-head">
              <h2 id={`stage-${g.key}`} className="stage-title">
                {g.title}
              </h2>
              <span className="muted tabular">{countText(g.items.length, 'item', 'items')}</span>
            </header>
            <div className="stage-table">
              <table className="dt">
                <thead>
                  <tr>
                    <th scope="col" className="cp-col-when">
                      When
                    </th>
                    <th scope="col" className="cp-col-type">
                      Type
                    </th>
                    <th scope="col">Item</th>
                    <th scope="col" className="cp-col-for">
                      For
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it) => (
                    <tr key={it.key}>
                      <td data-label="When" className="nowrap">
                        {timingText(it, t.items)}
                      </td>
                      <td data-label="Type">
                        <StatusPill tone="neutral" icon={ITEM_KIND_ICONS[it.kind] ?? null}>
                          {ITEM_KIND_LABELS[it.kind]}
                        </StatusPill>
                      </td>
                      <td data-label="Item" className="wrap">
                        <span className="strong-name">{it.name}</span>
                        {it.patientText && <div className="cell-sub">Patient copy: “{it.patientText}”</div>}
                        {it.source && <div className="cell-sub source-text">Source: {it.source}</div>}
                      </td>
                      <td data-label="For">
                        {it.appliesWhen === 'always' ? (
                          <span className="muted">All patients</span>
                        ) : (
                          <StatusPill tone="neutral">{APPLIES_LABELS[it.appliesWhen]}</StatusPill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {t.items.length === 0 && (
          <div className="card stage-empty">
            <p className="muted">
              This template has no items yet. {t.canEdit && <Link to={`/care-plans/templates/${t.id}/edit`}>Add items</Link>}
            </p>
          </div>
        )}

        {t.careType === 'antenatal' && t.kind === 'personal' && (
          <p className="hint help">Risk levels are always worked out from the hospital standard template's rules, so a personal protocol has no risk rules.</p>
        )}
        {t.careType === 'antenatal' && t.kind === 'standard' && (
          <section className="dt-card stage" id="risk-rules" aria-labelledby="stage-risk-rules">
            <header className="stage-head">
              <h2 id="stage-risk-rules" className="stage-title">
                Risk rules (automatic risk level)
              </h2>
              <span className="muted tabular">{countText((t.riskRules ?? []).length, 'rule', 'rules')}</span>
              <p className="hint risk-rules-hint">
                If any rule applies, the patient is shown as high or moderate risk with the reason. If information needed by a rule is missing, the result is
                “Incomplete”, never “Low”. A reading not measured yet in this pregnancy (haemoglobin, blood pressure) is listed with the level instead. {NOT_CHECKED_YET}
              </p>
            </header>
            <div className="stage-table">
              <table className="dt">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col" className="cp-col-checks">
                      Checks
                    </th>
                    <th scope="col" className="cp-col-level">
                      Level
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(t.riskRules ?? []).map((r) => (
                    <tr key={r.key}>
                      <td data-label="Rule" className="wrap">
                        <span className="strong-name">{r.label}</span>
                        {r.source && <div className="cell-sub source-text">Source: {r.source}</div>}
                      </td>
                      <td data-label="Checks">{ruleText(r)}</td>
                      <td data-label="Level">
                        <RiskBadge level={r.level} />
                      </td>
                    </tr>
                  ))}
                  {!(t.riskRules ?? []).length && (
                    <tr>
                      <td colSpan={3} className="dt-empty">
                        No risk rules – every patient using this template will show “Incomplete”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {updating && (
        <UpdatePlansDialog
          template={t}
          onCancel={() => setUpdating(false)}
          onDone={(result, version) => {
            setUpdating(false);
            setActionError(null);
            setFlash(plansUpdateResultText(result, version, t.careType));
            reload();
          }}
          onOutdated={(message) => {
            setUpdating(false);
            setFlash(null);
            setActionError(message);
            reload();
          }}
        />
      )}
      {approving && (
        <ApproveDialog
          template={t}
          hospitalName={activeMembership.tenantName}
          onCancel={() => setApproving(false)}
          onDone={(recalculated) => {
            setApproving(false);
            const changed = recalculated?.checked
              ? ` Risk levels were re-checked for ${recalculated.checked} pregnanc${recalculated.checked === 1 ? 'y' : 'ies'} (${recalculated.changed} changed).`
              : '';
            setFlash(`Template approved for clinical use.${changed}`);
            reload();
          }}
          onOutdated={(message) => {
            setApproving(false);
            setFlash(null);
            setActionError(message);
            reload();
          }}
        />
      )}
    </>
  );
}
