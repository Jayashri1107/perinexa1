import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

// Nothing gets lost (doctor ideas #4, 16 Oct 2026): the visit's unsaved typing is kept on the server as the person's
// own draft a few seconds after they stop typing (never in this browser – a shared computer keeps nothing). On
// opening the visit again, a draft found is offered: Restore or Discard. Saving a part clears its draft (the form then
// reports nothing unsaved). The server never keeps text naming a baby's sex.

const WAIT_MS = 2500;

export function useVisitDraft(patientId, visitId) {
  const base = `/patients/${patientId}/visits/${visitId}/draft`;
  const [found, setFound] = useState(null); // the draft found on opening: { details, rx, savedAt }
  const [restore, setRestore] = useState(null); // the draft being put back into the forms
  const latest = useRef({});
  const sent = useRef({});
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    setFound(null);
    setRestore(null);
    latest.current = {};
    sent.current = {};
    api(base)
      .then((r) => alive && setFound(r.draft))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    for (const [part, data] of Object.entries(latest.current)) {
      const json = JSON.stringify(data);
      if (sent.current[part] === json) continue;
      if (data === null && sent.current[part] === undefined) continue; // nothing was ever kept for it
      sent.current[part] = json;
      api(base, { method: 'PUT', body: { part, data } }).catch(() => {
        delete sent.current[part]; // tried again with the next change
      });
    }
  }, [base]);

  // The last typing is sent when the page closes or the tab is left
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  const push = useCallback(
    (part, data) => {
      latest.current[part] = data;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, WAIT_MS);
    },
    [flush],
  );
  const onDetails = useCallback((d) => push('details', d), [push]);
  const onRx = useCallback((d) => push('rx', d), [push]);

  return {
    found,
    restore,
    onDetails,
    onRx,
    restoreNow: () => {
      setRestore(found);
      setFound(null);
    },
    discard: async () => {
      setFound(null);
      sent.current = {};
      await api(base, { method: 'DELETE' }).catch(() => {});
    },
  };
}
