import { useMemo, useState } from 'react';
import { CircleCheck, CircleSlash, FilePen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DataTable, usePagedRows } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DepartmentSelect } from './LabWorklistPage.jsx';
import { departmentName } from './labFormat.js';

// Lab → Tests (docs/LAB_LIMS_PLAN.md features 2 and 3): the hospital's test list – the built-in tests and the hospital's
// own – with the department, sample, turnaround time, price and whether the usual ranges are approved by a doctor (DRAFT
// until then). The lab, doctors and RMOs open a test to change it; nurses read the list. A table with search, department
// and pages (owner, 19 Oct 2026).

export const rupees = (paise) => (paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`);

export function TestStatus({ test }) {
  return test.status === 'approved' ? (
    <StatusPill tone="stable" icon={CircleCheck}>
      Approved
    </StatusPill>
  ) : (
    <StatusPill tone="watch" icon={FilePen}>
      DRAFT
    </StatusPill>
  );
}

export function LabTestsPage() {
  const { data, error, loading } = useFetch('/lab-setup/tests');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('adult');
  const [department, setDepartment] = useState('');
  const rows = useMemo(() => {
    if (!data) return undefined;
    const words = q.trim().toLowerCase();
    return data.tests.filter((t) => t.who === who && (!department || t.department === department) && (!words || t.name.toLowerCase().includes(words)));
  }, [data, q, who, department]);
  const { shown, pager } = usePagedRows(rows, { initial: 25, sizes: [25, 50, 100], label: 'tests' });
  const columns = [
    {
      key: 'name',
      header: 'Test',
      render: (t) => (
        <>
          <Link to={`/lab/tests/${t.key}`} className="strong-name">
            {t.name}
          </Link>
          <span className="muted dt-sub">{[t.sample, t.custom ? "hospital's own" : null, t.outsideLab ? `usually sent to ${t.outsideLab}` : null].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    { key: 'department', header: 'Department', render: (t) => departmentName(t.department) },
    {
      key: 'tat',
      header: 'Report in',
      render: (t) => (
        <>
          <span className="tabular">{t.tatHours} h</span>
          <span className="muted dt-sub">urgent {t.urgentTatHours} h</span>
        </>
      ),
    },
    { key: 'price', header: 'Price', align: 'right', render: (t) => <span className="tabular">{rupees(t.pricePaise)}</span> },
    {
      key: 'status',
      header: 'Ranges',
      render: (t) => (
        <span className="dt-pills">
          <TestStatus test={t} />
          {!t.active && (
            <StatusPill tone="inactive" icon={CircleSlash}>
              Not offered
            </StatusPill>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Lab tests"
        documentTitle="Lab tests"
        help="The hospital's test list. Open a test to change its department, times, outside lab or usual ranges. A change to a range is a DRAFT until a doctor approves it."
        actions={
          data?.canEdit && (
            <Link to="/lab/tests/new" className="btn btn-primary">
              <Plus aria-hidden="true" /> Add a test
            </Link>
          )
        }
      />
      <div className="pf-content lab-tables">
        <Alert type="error">{error}</Alert>
        <DataTable
          caption="Lab tests"
          columns={columns}
          rows={shown}
          rowKey="key"
          loading={loading}
          emptyText="No test matches."
          toolbar={
            <>
              <div className="segmented" role="group" aria-label="Whose tests">
                <button type="button" aria-pressed={who === 'adult'} onClick={() => setWho('adult')}>
                  Adult tests
                </button>
                <button type="button" aria-pressed={who === 'newborn'} onClick={() => setWho('newborn')}>
                  Baby tests
                </button>
              </div>
              <DepartmentSelect value={department} onChange={setDepartment} id="lab-tests-dept" />
              <label className="lab-filter" htmlFor="lab-tests-q">
                <span>Find a test</span>
                <input id="lab-tests-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </>
          }
          footer={pager}
        />
        {data && <p className="hint">Prices come from the hospital's price list (Billing → Price list), kept by the hospital admin. A new test starts at ₹0.</p>}
      </div>
    </>
  );
}
