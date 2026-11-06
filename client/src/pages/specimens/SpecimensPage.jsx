import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { SpecimenList } from './SpecimenList.jsx';

// Specimens (Clinical Requirements Group A, item 3 – PX-OT-04, register OBG-L-05): the specimens waiting for their
// report, those overdue (more than 21 days without a report), reports to review, and the whole register. A specimen
// is logged from her record (her Specimens tab). Doctors, RMOs and nurses.

const SHOW = [
  ['open', 'Waiting for report'],
  ['overdue', 'Overdue'],
  ['reported', 'To review'],
  ['all', 'Register'],
];

export function SpecimensPage() {
  const [params, setParams] = useSearchParams();
  const show = SHOW.some(([k]) => k === params.get('show')) ? params.get('show') : 'open';
  const { data, error, loading, reload } = useFetch('/specimens', { show });
  return (
    <>
      <PageHeader title="Specimens" documentTitle="Specimens" help="Specimens sent for histopathology or cytology: waiting for the report, overdue after 21 days, reports to review, and the register. Log a new specimen from her record (Specimens tab)." />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <div className="row" role="group" aria-label="Show">
          {SHOW.map(([k, label]) => (
            <button key={k} type="button" className="btn btn-secondary btn-sm" aria-pressed={show === k} onClick={() => setParams({ show: k }, { replace: true })}>
              {label}
            </button>
          ))}
        </div>
        <section className="card">
          <SpecimenList specimens={data?.specimens ?? []} loading={loading && !data} onChanged={reload} />
        </section>
      </div>
    </>
  );
}
