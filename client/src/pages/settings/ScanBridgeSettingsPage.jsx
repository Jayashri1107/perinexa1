import { useState } from 'react';
import { CircleCheck, CircleMinus, KeyRound } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, useConfirm } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admin → Ultrasound machine (docs/USG_MACHINE_PLAN.md): the key the scan bridge – the program on a hospital
// PC next to the ultrasound machine (scan-bridge/README.md) – signs in with. Shown once when made, never again (only
// its last 4 characters); a new key stops the old one, and Switch off stops the bridge. Never a patient here.

export function ScanBridgeSettingsPage() {
  const { data, error, reload } = useFetch('/tenant/scan-bridge');
  const [bridge, setBridge] = useState(null);
  const [key, setKey] = useState(null);
  const [problem, setProblem] = useState(null);
  const [confirm, confirmDialog] = useConfirm();
  const b = bridge ?? data?.bridge;
  const make = async () => {
    if (b?.on && !(await confirm({ title: 'Make a new key?', text: 'The bridge stops working until the new key is put in its settings.', confirmLabel: 'Make a new key' }))) return;
    try {
      const res = await api('/tenant/scan-bridge/key', { method: 'POST' });
      setKey(res.key);
      setBridge(res.bridge);
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  };
  const off = async () => {
    if (!(await confirm({ title: 'Switch off the ultrasound machine link?', text: 'The bridge stops sending studies. Studies already received stay until their keep period ends.', confirmLabel: 'Switch off', danger: true }))) return;
    try {
      setBridge((await api('/tenant/scan-bridge/key', { method: 'DELETE' })).bridge);
      setKey(null);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <>
      <PageHeader title="Ultrasound machine" help="The link that brings the ultrasound machine's pictures and readings into Scans." tabs={moduleByKey('hospital-admin').tabs} />
      <div className="pf-content">
        <Alert type="error">{error ?? problem}</Alert>
        {b && (
          <section className="card narrow" aria-labelledby="sb-title">
            <h2 id="sb-title">
              <KeyRound aria-hidden="true" /> Scan bridge key
            </h2>
            <p>
              {b.on ? (
                <StatusPill tone="stable" icon={CircleCheck}>
                  On – key ending {b.keyHint}
                </StatusPill>
              ) : (
                <StatusPill tone="inactive" icon={CircleMinus}>
                  Off
                </StatusPill>
              )}
            </p>
            {b.on && (
              <p className="muted">
                Made by {b.madeByName}, {formatDateTime(b.madeAt)}. {b.lastContactAt ? `Last heard from the bridge ${formatDateTime(b.lastContactAt)}.` : 'Not heard from the bridge yet.'}
              </p>
            )}
            {key && (
              <Alert type="warning">
                <p>Copy this key into the bridge's settings (BRIDGE_KEY in scan-bridge/.env on the hospital PC). It is shown only now. Never send it by chat or email.</p>
                <p>
                  <code className="sb-key">{key}</code>
                </p>
              </Alert>
            )}
            <p className="hint">
              The bridge runs on a PC in the hospital next to the ultrasound machine; its setup is in scan-bridge/README.md. What the machine sends is kept {b.keepDays} days for the scan staff to
              choose from, then deleted; what they use stays in the scan&apos;s record.
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={make}>
                {b.on ? 'Make a new key' : 'Make a key'}
              </button>
              {b.on && (
                <button type="button" className="btn btn-secondary" onClick={off}>
                  Switch off
                </button>
              )}
            </div>
          </section>
        )}
      </div>
      {confirmDialog}
    </>
  );
}
