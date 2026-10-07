// Discharges (reception, nurses, doctors): the patients discharged recently, each with her signed discharge card to
// print or save as PDF, and a way to upload the scanned papers to her record.
import { FileDown, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dischargesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { UploadDocumentModal } from './PatientDocumentsCard.jsx';

export function DischargesPage() {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadFor, setUploadFor] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim().length >= 2 ? text.trim() : ''), 300);
    return () => clearTimeout(t);
  }, [text]);
  const load = useCallback(() => {
    setData(null);
    dischargesApi.list(search ? { search } : {}).then(setData).catch((err) => setError(err.message));
  }, [search]);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader title="Discharges" subtitle="Print the signed discharge card, and upload the scanned papers to her record." />
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      <section className="card">
        <div className="search">
          <Search size={16} aria-hidden />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find by name or patient number (any date)" aria-label="Find a discharge" />
        </div>
        {!data && !error && <Loader />}
        {data && (
          <p className="muted small top-gap">
            {data.days ? `Discharged in the last ${data.days} days` : 'All discharges of the patients found'} · {data.items.length}
          </p>
        )}
        {data && data.items.length === 0 && <p className="muted">No signed discharge cards{search ? ' for this search' : ' in this period'}.</p>}
        <ul className="plain-list rows">
          {(data?.items ?? []).map((d) => (
            <li key={d.id} className="appt-line">
              <span>
                <Link to={`/hospital/patients/${d.patient.id}`}><strong>{d.patient.name}</strong></Link> <span className="muted">{d.patient.patientNumber}</span>
                <span className="muted block small">
                  Discharged {formatDateTime(d.dischargedAt)}
                  {d.admittedAt && ` · admitted ${formatDate(d.admittedAt)}`}
                  {d.ward && ` · ${d.ward}`} · signed by {d.signedByName}
                </span>
              </span>
              <span className="row-actions">
                <a className="btn btn-primary btn-sm" href={`/hospital/print/discharge-card/${d.id}`} target="_blank" rel="noreferrer">
                  <FileDown size={14} aria-hidden /> Discharge card
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploadFor(d)}>
                  <Upload size={14} aria-hidden /> Upload scan
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      {uploadFor && (
        <UploadDocumentModal
          patient={uploadFor.patient}
          admissionId={uploadFor.admissionId}
          defaultKind="discharge_card"
          onClose={() => setUploadFor(null)}
          onUploaded={() => {
            setNotice(`Document uploaded to ${uploadFor.patient.name}'s record.`);
            setUploadFor(null);
          }}
        />
      )}
    </>
  );
}
