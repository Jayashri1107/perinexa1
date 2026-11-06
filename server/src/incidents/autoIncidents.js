import { category1Late, decisionToDeliveryMinutes } from '../clinical/caesarean.js';
import { nextNumber } from '../models/Counter.js';
import { Incident } from '../models/Incident.js';
import { audit } from '../utils/audit.js';

// Incidents Perinexa reports by itself (Clinical Requirements: PX-OBG-14 "automatic incident"). One per document
// (its id is in the request id), so confirming again never makes a second one. No patient details in the text.

/** A confirmed delivery note: a category 1 caesarean delivered more than 30 minutes after the decision. */
export async function reportLateCategory1(req, doc) {
  if (!category1Late(doc.content ?? {})) return null;
  const clientRequestId = `auto-cs1-${doc._id}`;
  if (await Incident.findOne({ tenantId: req.tenantId, clientRequestId })) return null;
  const minutes = decisionToDeliveryMinutes(doc.content);
  const incident = await Incident.create({
    tenantId: req.tenantId,
    serial: await nextNumber(req.tenantId, 'incident'),
    occurredAt: new Date(doc.content.deliveredAt),
    place: 'Theatre',
    kind: 'caesarean_delay',
    severity: 'none',
    description: `Category 1 caesarean: ${minutes} minutes from the decision to the delivery (target 30 minutes or less). Reported by Perinexa when the delivery note was confirmed; the quality lead sets the degree of harm at review.`,
    patientId: doc.patientId,
    automatic: { source: 'delivery_note', documentId: doc._id },
    reported: { by: null, byName: 'Perinexa (delivery note)', at: req.now ?? new Date() },
    clientRequestId,
  });
  await audit(req, 'INCIDENT_REPORTED', { details: { incidentId: String(incident._id), serial: incident.serial, kind: incident.kind, automatic: true } });
  return incident;
}
