import { useState } from 'react';
import { CircleCheck, Pencil } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { Paged } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeSections, knowledgeTabs } from '../../platform/modules.js';
import { RulesStatusBadge } from '../redflags/RedFlagRulesPage.jsx';
import { MedSafetyPill } from './MedicineSafetyPanel.jsx';
import { amountText } from './doseCheck.js';
import { entryAgeText, entryWeeksText } from './medSafety.js';

const countText = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// The list in groups: who each group applies to (`about`), and what its "When" column says.
const GROUPS = [
  { key: 'avoid', title: 'Pregnancy: avoid', about: 'Antenatal patients.', match: (e) => e.kind === 'medicine' && e.level === 'avoid', when: entryWeeksText },
  { key: 'caution', title: 'Pregnancy: use with caution', about: 'Antenatal patients.', match: (e) => e.kind === 'medicine' && e.level === 'caution', when: entryWeeksText },
  { key: 'combination', title: 'Pregnancy: combinations to space out or watch', about: 'Antenatal patients.', match: (e) => e.kind === 'combination', when: () => 'Any time' },
  {
    key: 'breastfeeding',
    title: 'While breastfeeding',
    about: 'Postnatal patients recorded as breastfeeding – and those for whom it is not recorded, worded “if she is breastfeeding”.',
    match: (e) => e.kind === 'breastfeeding',
    when: () => 'While breastfeeding',
  },
  { key: 'newborn', title: 'Newborn babies', about: 'Newborn-care patients, by the baby’s age on the day of the visit.', match: (e) => e.kind === 'newborn', when: entryAgeText },
  {
    key: 'dose',
    title: 'Usual maximum doses',
    about:
      'Every patient. Adults: per dose and per day. Babies in newborn care: per kg, with the weight recorded at the visit (or the birth weight); where a medicine has a limit for a younger age, that one is used while the baby is that young.',
    match: (e) => e.kind === 'dose',
    dose: true,
  },
];
const limitText = (e, value) => (value == null ? '—' : amountText(value, e.doseUnit, e.perKg));

function ApproveDialog({ list, hospitalName, onDone, onCancel, onOutdated }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/medicine-safety/approve', { method: 'POST', body: { confirm: confirmed, version: list.version } });
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
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ms-approve-title" onSubmit={approve}>
        <h2 id="ms-approve-title">Approve the medicine safety list</h2>
        <p>
          You are approving {countText(list.entries.length, 'entry', 'entries')} (version {list.version}) for {hospitalName}. The list only warns while a
          prescription is written; it never stops a doctor from saving.
        </p>
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a qualified doctor. I have reviewed every entry – the medicine names, the weeks and ages, the level, the maximum doses and the advice –
            against current references and our hospital's practice, and I approve the list for use.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve list'}
          </button>
        </div>
      </form>
    </div>
  );
}

// The hospital's medicine safety list (Prescription sets → Medicine safety).
export function MedicineSafetyPage() {
  const { activeMembership } = useAuth();
  const location = useLocation();
  const { data, error, reload } = useFetch('/medicine-safety');
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = data?.list;

  // Built-in entries added since this hospital's list was made (a list a doctor approved or changed is never changed
  // by itself): a doctor adds them, as a new draft to review and approve.
  const addBuiltIn = async () => {
    setAdding(true);
    setActionError(null);
    try {
      const res = await api('/medicine-safety/add-built-in', { method: 'POST', body: { version: list.version } });
      setFlash(`${countText(res.added, 'built-in entry', 'built-in entries')} added. The list is now draft version ${res.list.version}: review it, then approve it.`);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setAdding(false);
      reload();
    }
  };

  const header = (extra = {}) => (
    <PageHeader
      breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: 'Clinical rules', to: '/care-plans/red-flags' }, { label: 'Medicine safety' }]}
      title="Medicine safety"
      tabs={knowledgeTabs(activeMembership.roles)}
      subtabs={knowledgeSections('clinical-rules')}
      {...extra}
    />
  );
  if (error && !list) {
    return (
      <>
        {header()}
        <div className="pf-content">
          <Alert type="error">{error}</Alert>
        </div>
      </>
    );
  }
  if (!list) return <FullPageSpinner />;

  return (
    <>
      {header({
        // The list's status, size and version under the title
        subtitle: (
          <>
            <RulesStatusBadge ruleSet={list} /> {countText(list.entries.length, 'entry', 'entries')} · version {list.version} ·
            last changed {formatDateTime(list.updatedAt)}
            {list.updatedByName ? ` by ${list.updatedByName}` : ''}
          </>
        ),
        actions: (
          <>
            {list.canEdit && (
              <Link to="/medicine-safety/edit" className={`btn ${list.status === 'draft' && list.canApprove ? 'btn-secondary' : 'btn-primary'}`}>
                <Pencil aria-hidden="true" /> Edit list
              </Link>
            )}
            {list.canApprove && list.status === 'draft' && (
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
        {list.status === 'draft' ? (
          <Alert type="warning">
            <strong>Draft – not approved for clinical use.</strong>{' '}
            {list.builtInVersion
              ? 'This list was prepared from published references (BNF and BNF for Children, FDA / TGA pregnancy categories, LactMed, WHO, FOGSI and Government of India guidance, manufacturers\' labels). It is not a clinical review and is not complete: a doctor must check every entry and every dose, add the hospital\'s own brands and approve it.'
              : 'The list has changed. A doctor must review and approve it.'}
          </Alert>
        ) : (
          <Alert type="success">
            Approved by <strong>{list.approvedByName}</strong> on {formatDateTime(list.approvedAt)} (version {list.version}).
          </Alert>
        )}
        {list.canEdit && list.newBuiltIn > 0 && (
          <Alert type="info">
            <strong>{countText(list.newBuiltIn, 'new built-in draft entry is', 'new built-in draft entries are')} not in this list</strong> – usual maximum doses, medicines
            while breastfeeding and medicines in newborn babies. A list that a doctor approved or changed is never changed by itself. Adding them makes a new
            draft version; the list in use keeps working until then, and a doctor reviews and approves the new one.{' '}
            <button type="button" className="btn btn-link plan-inline-link" onClick={addBuiltIn} disabled={adding}>
              {adding ? 'Adding…' : 'Add them as a draft'}
            </button>
          </Alert>
        )}
        <p className="hint help cp-section-hint">
          While a prescription is written, each medicine is compared with these names (at the start of a word, so brand names can be added too). Which entries
          apply depends on the patient: pregnancy entries for antenatal patients, breastfeeding entries for postnatal patients, newborn entries for babies in
          newborn care. Allergies recorded on the patient are also checked, for every patient. A warning never stops the doctor from saving.
        </p>
        <p className="hint cp-section-hint">
          The dose check is limited. It works the dose out from the strength, the dose and how often, as typed, and compares it with the usual maximum below. It
          stays silent when it cannot work the dose out, and it knows nothing about the medicines that are not listed here.
        </p>
        {GROUPS.map((g) => {
          const entries = list.entries.filter(g.match);
          return (
            <section key={g.key} className="dt-card stage" aria-labelledby={`ms-${g.key}`}>
              <header className="stage-head">
                <h2 id={`ms-${g.key}`} className="stage-title">
                  {g.title}
                </h2>
                <span className="muted tabular">{countText(entries.length, 'entry', 'entries')}</span>
                <p className="hint">{g.about}</p>
              </header>
              <Paged rows={entries} label="entries" initial={5} sizes={[5, 10, 25]}>
                {(shown) => (
              <div className="stage-table">
                <table className="dt">
                  <thead>
                    <tr>
                      <th scope="col">Medicine</th>
                      <th scope="col" className="cp-col-checks">
                        Names matched
                      </th>
                      {g.dose ? (
                        <>
                          <th scope="col" className="cp-col-when">
                            Maximum for one dose
                          </th>
                          <th scope="col" className="cp-col-level">
                            Maximum for a day
                          </th>
                        </>
                      ) : (
                        <>
                          <th scope="col" className="cp-col-when">
                            When
                          </th>
                          <th scope="col" className="cp-col-level">
                            Level
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.key}>
                        <td data-label="Medicine" className="wrap">
                          <span className="strong-name">{e.label}</span>
                          {g.dose && <div className="cell-sub">{e.perKg ? `Babies in newborn care${e.maxAgeDays != null ? `, ${entryAgeText(e)}` : ''}, per kg of body weight` : 'Adults'}</div>}
                          {e.message && <div className="cell-sub">{e.message}</div>}
                          {e.source && <div className="cell-sub source-text">Source: {e.source}</div>}
                        </td>
                        <td data-label="Names matched" className="wrap">
                          {e.terms.join(', ')}
                          {e.kind === 'combination' && <div className="cell-sub">together with: {e.otherTerms.join(', ')}</div>}
                        </td>
                        {g.dose ? (
                          <>
                            <td data-label="Maximum for one dose" className="tabular">
                              {limitText(e, e.maxSingle)}
                            </td>
                            <td data-label="Maximum for a day" className="tabular">
                              {limitText(e, e.maxDaily)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td data-label="When">{g.when(e)}</td>
                            <td data-label="Level">
                              <MedSafetyPill level={e.level} />
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    {!entries.length && (
                      <tr>
                        <td colSpan={4} className="dt-empty">
                          None.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}
              </Paged>
            </section>
          );
        })}
      </div>
      {approving && (
        <ApproveDialog
          list={list}
          hospitalName={activeMembership.tenantName}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Medicine safety list approved.');
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
