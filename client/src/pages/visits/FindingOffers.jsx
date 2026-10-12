import { useState } from 'react';
import { ClipboardPlus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert } from '../../components/ui.jsx';
import { findingOfferText } from './findingOffer.js';

/**
 * On the visit page, after the vital signs are saved: when they suggest a finding of this pregnancy (BP 140/90 or
 * higher), the doctor or RMO can add it to her record with one click. They decide – nothing is added by itself.
 * page.findingOffers comes from the server, only for those who may edit her clinical details.
 * onAdded(message): the finding was added (the page then reloads the record and the visit).
 */
export function FindingOffers({ patient, page, onAdded }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const offers = (page.findingOffers ?? []).map((offer) => ({ offer, text: findingOfferText(offer) })).filter((x) => x.text);
  if (!offers.length) return null;

  const add = async ({ offer, text }) => {
    setBusy(offer.key);
    setError(null);
    try {
      await api(`/patients/${patient.id}/pregnancy-findings`, { method: 'POST', body: { key: offer.key, present: true, visitId: page.visit.id } });
      onAdded(text.done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card vs-offer" aria-labelledby="vs-offer-title">
      <h2 id="vs-offer-title">
        <ClipboardPlus aria-hidden="true" /> Suggested for her record
      </h2>
      <Alert type="error">{error}</Alert>
      {offers.map((x) => (
        <div key={x.offer.key} className="vs-offer-row">
          <p>
            <strong>{x.text.found}</strong> If this is high blood pressure of this pregnancy, add it to her record. You decide – nothing is added by itself.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => add(x)} disabled={busy !== null}>
            {busy === x.offer.key ? 'Adding…' : x.text.button}
          </button>
          <p className="hint">
            {x.text.hint} Once added, it counts for the risk level and the care plan as the hospital's risk rules and care-plan template say – the Risk card shows
            the reason. It can be unticked later in Edit details.
          </p>
          <p className="hint">{x.text.source}</p>
        </div>
      ))}
    </section>
  );
}
