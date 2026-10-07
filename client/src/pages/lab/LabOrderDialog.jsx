// Ordering lab tests for a patient (from her record): tests grouped as in the lab's list – adult tests, or baby tests
// for a newborn – the hospital's test packages (a package only ticks its tests; a DRAFT package says so), tests not
// in the list, urgent, and a note to the lab.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';

export function LabOrderDialog({ patient, who, onClose }) {
  const navigate = useNavigate();
  const [catalogue, setCatalogue] = useState(null);
  const [tests, setTests] = useState([]);
  const [packages, setPackages] = useState([]);
  const [other, setOther] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [noteToLab, setNoteToLab] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    labApi.catalogue().then(setCatalogue).catch((err) => setError(err.message));
  }, []);

  const groups = useMemo(() => {
    if (!catalogue) return [];
    const mine = catalogue.tests.filter((t) => t.who === who);
    return Object.entries(catalogue.groups)
      .map(([key, label]) => ({ key, label, tests: mine.filter((t) => t.group === key) }))
      .filter((g) => g.tests.length);
  }, [catalogue, who]);
  const pkgs = (catalogue?.packages ?? []).filter((p) => p.who === who);

  const toggleTest = (key) => setTests((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]));
  const togglePackage = (p) => {
    if (packages.includes(p.key)) {
      setPackages((all) => all.filter((k) => k !== p.key));
    } else {
      setPackages((all) => [...all, p.key]);
      setTests((t) => [...new Set([...t, ...p.tests])]);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const otherTests = other.split('\n').map((s) => s.trim()).filter(Boolean);
      // The tests ticked hold every test of the chosen packages, so the packages are sent for the record only.
      const { order } = await labApi.order({ patientId: patient.id, tests, otherTests, packages, urgent, noteToLab });
      navigate(`/hospital/lab/orders/${order.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const count = tests.length + other.split('\n').filter((s) => s.trim()).length;
  return (
    <Modal title={`Order lab tests – ${patient.name}`} onClose={onClose} size="lg">
      {!catalogue && !error && <Loader />}
      {catalogue && (
        <form onSubmit={submit} noValidate>
          <Alert type="error">{error}</Alert>
          {pkgs.length > 0 && (
            <div className="order-block">
              <h3>Test packages</h3>
              <div className="checkbox-group">
                {pkgs.map((p) => (
                  <label key={p.key} className={`chip-check${packages.includes(p.key) ? ' checked' : ''}`} title={p.forWhom}>
                    <input type="checkbox" checked={packages.includes(p.key)} onChange={() => togglePackage(p)} />
                    {p.name}
                    {p.status !== 'approved' && <span className="badge badge-pending small">DRAFT</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="order-block">
              <h3>{g.label}</h3>
              <div className="checkbox-group">
                {g.tests.map((t) => (
                  <label key={t.key} className={`chip-check${tests.includes(t.key) ? ' checked' : ''}`} title={t.sample}>
                    <input type="checkbox" checked={tests.includes(t.key)} onChange={() => toggleTest(t.key)} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="form-grid top-gap-sm">
            <div className="form-field width-half">
              <label htmlFor="other-tests">Other tests (one per line)</label>
              <textarea id="other-tests" rows={3} value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
            <div className="form-field width-half">
              <label htmlFor="note-to-lab">Note to the lab (optional)</label>
              <textarea id="note-to-lab" rows={3} maxLength={500} value={noteToLab} placeholder="Fasting sample, clinical question …" onChange={(e) => setNoteToLab(e.target.value)} />
            </div>
            <label className="inline-check span-2">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
            </label>
          </div>
          <div className="modal-foot inline">
            <span className="muted small grow">{count} test{count === 1 ? '' : 's'} chosen</span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || count === 0}>{saving ? 'Ordering…' : 'Order tests'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
