// Wards and beds (hospital admin): each ward with its beds, how many are booked; add a ward, rename it, add beds, take
// a bed or a ward out of use. A bed with a patient in it stays in use; a bed is never deleted (old stays name it).
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { wardsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { HOSPITAL_ADMIN_TABS } from '../../config/navigation.js';
import { labelOf } from '../../utils/format.js';

function WardDialog({ ward, kinds, onClose, onSaved }) {
  const isNew = !ward;
  const [name, setName] = useState(ward?.name ?? '');
  const [kind, setKind] = useState(ward?.kind ?? kinds[0].key);
  const [beds, setBeds] = useState(ward?.beds ?? []);
  const [bedCount, setBedCount] = useState(isNew ? 4 : 1);
  const [bedPrefix, setBedPrefix] = useState('');
  const [error, setError] = useState('');

  const addBeds = () => {
    const prefix = bedPrefix.trim().toUpperCase();
    const used = new Set(beds.map((b) => b.label));
    const added = [];
    for (let i = 1; added.length < Number(bedCount) && i < 1000; i += 1) {
      const label = `${prefix}${i}`;
      if (!used.has(label)) added.push({ label, isActive: true });
    }
    setBeds([...beds, ...added]);
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const r = isNew ? await wardsApi.create({ name, kind, bedCount: Number(bedCount), bedPrefix }) : await wardsApi.update(ward.id, { name, kind, beds });
      onSaved(r.ward);
    } catch (err) {
      setError(Object.values(err.fields ?? {})[0] ?? err.message);
    }
  };

  return (
    <Modal title={isNew ? 'Add a ward' : `Change ${ward.name}`} onClose={onClose} size="lg">
      <form onSubmit={save}>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <div className="form-field width-half"><label htmlFor="w-name">Name<span className="required" aria-hidden> *</span></label><input id="w-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="For example General ward, Room 201–210" /></div>
          <div className="form-field width-half">
            <label htmlFor="w-kind">Kind</label>
            <select id="w-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          </div>
          <div className="form-field width-third"><label htmlFor="w-count">{isNew ? 'Number of beds' : 'Beds to add'}</label><input id="w-count" type="number" min="1" max="200" value={bedCount} onChange={(e) => setBedCount(e.target.value)} /></div>
          <div className="form-field width-third"><label htmlFor="w-prefix">Bed names start with</label><input id="w-prefix" value={bedPrefix} maxLength={6} onChange={(e) => setBedPrefix(e.target.value.toUpperCase())} placeholder="For example G → G1, G2…" /></div>
          {!isNew && (
            <div className="form-field width-third"><span className="field-label">&nbsp;</span><button type="button" className="btn btn-ghost" onClick={addBeds}><Plus size={14} aria-hidden /> Add beds</button></div>
          )}
        </div>
        {!isNew && (
          <>
            <span className="field-label">Beds – click one to take it out of use or back into use</span>
            <div className="bed-grid">
              {beds.map((b) => (
                <button key={b.label} type="button" className={`bed-chip${b.isActive ? '' : ' booked'}`} style={{ cursor: 'pointer' }} onClick={() => setBeds(beds.map((x) => (x.label === b.label ? { ...x, isActive: !x.isActive } : x)))}>
                  {b.label}
                  <span className="bed-state">{b.isActive ? 'In use' : 'Not in use'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function WardsPage() {
  const [data, setData] = useState(null);
  const [beds, setBeds] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null); // 'new' | ward

  const load = useCallback(() => {
    Promise.all([wardsApi.list(), wardsApi.availability()])
      .then(([w, a]) => {
        setData(w);
        setBeds(new Map(a.items.map((x) => [x.id, x])));
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const toggleWard = async (w) => {
    setError('');
    try {
      await wardsApi.update(w.id, { isActive: !w.isActive });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader
        title="Wards and beds"
        subtitle="The wards of the hospital and their beds. Reception and doctors choose a free bed when admitting a patient. The starting wards and bed numbers are samples: change them to match your hospital."
        actions={<button type="button" className="btn btn-primary" onClick={() => setDialog('new')}><Plus size={16} aria-hidden /> Add a ward</button>}
      />
      <SectionTabs tabs={HOSPITAL_ADMIN_TABS} label="Hospital admin" />
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <div className="occupancy">
          {data.items.map((w) => {
            const live = beds?.get(w.id);
            const inUse = w.beds.filter((b) => b.isActive).length;
            return (
              <section key={w.id} className={`card${w.isActive ? '' : ' muted'}`}>
                <h2>{w.name}</h2>
                <p className="muted small">{labelOf(data.kinds, w.kind)}{w.isActive ? '' : ' · not in use'}</p>
                <p>{inUse} beds{live ? ` · ${live.total - live.free} booked · ${live.free} free` : ''}</p>
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(w)}>Change</button>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => toggleWard(w)}>{w.isActive ? 'Take out of use' : 'Put back in use'}</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {dialog && (
        <WardDialog
          ward={dialog === 'new' ? null : dialog}
          kinds={data.kinds}
          onClose={() => setDialog(null)}
          onSaved={(w) => {
            setDialog(null);
            setNotice(`${w.name} saved.`);
            load();
          }}
        />
      )}
    </>
  );
}
