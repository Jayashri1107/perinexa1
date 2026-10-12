import { CircleMinus, TriangleAlert } from 'lucide-react';
import { StatusPill, formatDateTime } from '../../components/ui.jsx';
import { instructionLine, medicineName } from './rxFormat.js';
import { sameMedicine } from './rxRows.js';

// Parts shared by the prescription-set library, a set's page and the picker on the Prescription tab (Feature 8b).

/**
 * What the built-in pregnancy-loss sets are for, and what is left out on purpose (server/src/visits/builtInSets.js):
 * shown where a set is chosen for a pregnancy-loss patient, and in the library.
 */
export const LOSS_SETS_NOTE =
  'The pregnancy-loss sets are for a miscarriage already diagnosed – never for ending a continuing pregnancy. Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist treatment with strict conditions (RCOG Green-top Guideline 21) – write it yourself when she meets them.';
export const THREATENED_NOTE = 'A threatened miscarriage is a continuing pregnancy, cared for under Pregnancy (antenatal), so it has no pregnancy-loss set.';

/**
 * A warning when a set made only for pregnancy-loss care is chosen for a patient of any other type of care – recorded
 * as pregnant (antenatal), for example on the visit where a missed miscarriage is found before her type of care is
 * changed, or in gynaecology or fertility care, where she may be in early pregnancy and the medicine safety check
 * (pregnancy warnings for antenatal patients only) says nothing about misoprostol. It never stops the doctor. null
 * for pregnancy-loss care itself, and for a set that is not only for it.
 */
export function lossSetWarning(set, patient) {
  const lossOnly = set?.careTypes?.length > 0 && set.careTypes.every((t) => t === 'abortion');
  if (!lossOnly || !patient?.careType || patient.careType === 'abortion') return null;
  if (patient.careType === 'antenatal') {
    return 'This set is for pregnancy-loss care, and she is recorded as pregnant (antenatal). Use it only for a miscarriage already confirmed, and change her type of care to Abortion in Edit details.';
  }
  return 'This set is for pregnancy-loss care, and she is not recorded under it. Use it only for a miscarriage already confirmed – never if she may have a continuing pregnancy – and record the loss under Abortion in Edit details.';
}

/** Approved = stable (check); draft = watch (triangle): a doctor must check every medicine and dose first. */
export function SetStatus({ set }) {
  return (
    <span className="row">
      {set.status === 'approved' ? (
        <StatusPill tone="stable" title={set.approvedByName ? `Approved by ${set.approvedByName} on ${formatDateTime(set.approvedAt)}` : undefined}>
          Approved · v{set.version}
        </StatusPill>
      ) : (
        <StatusPill tone="watch" icon={TriangleAlert}>
          Draft · v{set.version}
        </StatusPill>
      )}
      {!set.isActive && (
        <StatusPill tone="inactive" icon={CircleMinus}>
          Not in use
        </StatusPill>
      )}
    </span>
  );
}

/** "Folic acid, Iron + folic acid (IFA)" – or what the set holds instead of medicines. */
export const setMedicinesText = (set) =>
  set.items.length ? [...new Set(set.items.map((it) => it.drug))].join(', ') : [set.investigations && 'Tests', set.advice && 'advice'].filter(Boolean).join(' and ') || '—';

/**
 * What a set holds, as the prescription will read: the medicines, general instructions, tests advised and advice.
 * With `rows` (the prescription being written), medicines already on it are marked: the set's version replaces
 * them. `detailsNote` explains where tests and advice go.
 */
export function SetContents({ set, rows = null, detailsNote = null, headingId = 'rxs' }) {
  return (
    <div className="rxs-contents">
      <h3 className="rxs-sub" id={`${headingId}-medicines`}>
        Medicines
      </h3>
      {set.items.length ? (
        <ol className="vs-rx-read" aria-labelledby={`${headingId}-medicines`}>
          {set.items.map((it) => (
            <li key={it.id}>
              <strong>{medicineName(it)}</strong>
              <span className="vs-rx-line">{instructionLine(it)}</span>
              {it.instructions && <span className="vs-rx-line muted">{it.instructions}</span>}
              {rows?.some((r) => sameMedicine(r, it)) && <span className="vs-rx-line rxs-replaces">Replaces the one already on this prescription.</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No medicines – tests and advice only.</p>
      )}
      {set.notes && (
        <>
          <h3 className="rxs-sub">General instructions</h3>
          <p className="pre-line">{set.notes}</p>
        </>
      )}
      {(set.investigations || set.advice) && detailsNote && <p className="hint rxs-details-note">{detailsNote}</p>}
      {set.investigations && (
        <>
          <h3 className="rxs-sub">Tests advised</h3>
          <p className="pre-line">{set.investigations}</p>
        </>
      )}
      {set.advice && (
        <>
          <h3 className="rxs-sub">Advice</h3>
          <p className="pre-line">{set.advice}</p>
        </>
      )}
    </div>
  );
}
