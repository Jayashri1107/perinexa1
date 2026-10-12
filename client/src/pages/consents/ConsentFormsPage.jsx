import { useState } from 'react';
import { CircleMinus, FilePlus2, TriangleAlert } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeTabs } from '../../platform/modules.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { LANGUAGE_NAMES, SUGGEST_LABELS, careTypesText, kindWords } from './consentFormat.js';

// The hospital's consent-form library: the built-in bilingual drafts and the hospital's own forms. Doctors,
// RMOs and nurses read it; doctors add, edit, approve and retire forms. With kind="information": the information
// forms (a condition explained to the patient and her relatives, who sign that they were informed).

/** Approved = stable (check); draft = watch (triangle): the wording must be reviewed before use. */
export function ConsentFormStatus({ form }) {
  return (
    <span className="row">
      {form.status === 'approved' ? (
        <StatusPill tone="stable" title={form.approvedByName ? `Approved by ${form.approvedByName} on ${formatDateTime(form.approvedAt)}` : undefined}>
          Approved · v{form.version}
        </StatusPill>
      ) : (
        <StatusPill tone="watch" icon={TriangleAlert}>
          Draft · v{form.version}
        </StatusPill>
      )}
      {!form.isActive && (
        <StatusPill tone="inactive" icon={CircleMinus}>
          Not in use
        </StatusPill>
      )}
    </span>
  );
}

export function ConsentFormsPage({ kind = 'consent' }) {
  const W = kindWords(kind);
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch('/consent-forms');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const newForm = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { form } = await api('/consent-forms', { method: 'POST', body: { kind } });
      navigate(`${W.base}/${form.id}/edit`, { state: { flash: 'A new draft form was created. Write its wording, then save it.' } });
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'title',
      header: 'Form',
      className: 'cf-col-title',
      render: (f) => (
        <span className="name-cell-text">
          <Link to={`${W.base}/${f.id}`} className="cp-template-link">
            {f.title.en}
          </Link>
          {f.title.mr && (
            <span className="t-caption muted" lang="mr">
              {f.title.mr}
            </span>
          )}
        </span>
      ),
    },
    { key: 'for', header: 'For', width: 200, className: 'cf-col-wrap', render: (f) => careTypesText(f.careTypes, CARE_TYPE_SHORT) },
    { key: 'suggest', header: 'Suggested', width: 220, className: 'cf-col-wrap', render: (f) => SUGGEST_LABELS[f.suggestWhen] ?? f.suggestWhen },
    { key: 'languages', header: 'Languages', width: 170, className: 'cf-col-wrap', render: (f) => f.languages.map((l) => LANGUAGE_NAMES[l]).join(', ') },
    { key: 'status', header: 'Status', width: 230, render: (f) => <ConsentFormStatus form={f} /> },
    { key: 'updated', header: 'Last changed', width: 170, render: (f) => formatDateTime(f.updatedAt) },
  ];

  const forms = data?.forms.filter((f) => (f.kind ?? 'consent') === kind);
  const anyDraft = forms?.some((f) => f.isActive && f.status === 'draft');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: W.plural }]}
        title={W.plural}
        help={
          kind === 'information'
            ? 'Sheets that record a condition or complication (PIH, GDM, low thyroid …) was explained to the patient and her relatives. They sign that they were informed; it is not a consent.'
            : "The hospital's consent forms, printed for patients in English with Marathi or Hindi next to it."
        }
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          data?.canEdit && (
            <button type="button" className="btn btn-primary" onClick={newForm} disabled={busy}>
              <FilePlus2 aria-hidden="true" /> New form
            </button>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error ?? actionError}</Alert>
        {anyDraft && (
          <Alert type="warning">
            <strong>Draft forms are not ready for patients.</strong> Their wording was prepared by the software developer and has not been legally reviewed. The
            hospital must check each form, including the Marathi and Hindi translations, and a doctor must approve it. Printed drafts say DRAFT on every page.
          </Alert>
        )}
        <DataTable
          caption={W.plural}
          columns={columns}
          rows={forms}
          loading={loading}
          onRowClick={(f) => navigate(`${W.base}/${f.id}`)}
          rowClassName={(f) => (f.isActive ? '' : 'row-inactive')}
          emptyText={`No ${W.many} yet.`}
        />
      </div>
    </>
  );
}
