import { ClipboardCheck, DoorOpen, FileCheck, FileClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { StatusPill, formatDateTime } from '../../components/ui.jsx';

// The discharge of a stay as the patient's record shows it (9 Nov 2026 – docs/IPD_DISCHARGE_BILLING_PLAN.md): the
// doctor's card, then what the desk recorded (type, discharging doctor, remark), whether the bill is final, and the
// gate pass. No amounts here: the money is in Billing → IPD. A death shows as "Record closed" to those who may not see why.

const BILLING_ROLES = ['receptionist', 'billing', 'admin'];

/** Where the discharge stands, as colour + icon + word. */
export function dischargeStep(a) {
  if (a.status !== 'discharged') return null;
  if (a.cleared) return { tone: 'stable', icon: DoorOpen, label: `Left – gate pass ${a.cleared.passNo}` };
  if (a.bill?.final) return { tone: 'due', icon: FileCheck, label: 'Final bill made' };
  if (a.discharge) return { tone: 'watch', icon: FileClock, label: 'Final bill due' };
  return { tone: 'watch', icon: ClipboardCheck, label: 'Discharge to record at the desk' };
}

export function DischargeStepPill({ a }) {
  const s = dischargeStep(a);
  if (!s) return null;
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusPill>
  );
}

export function StayDischargeCard({ a }) {
  const { activeMembership } = useAuth();
  if (a.status !== 'discharged') return null;
  const canBill = (activeMembership?.roles ?? []).some((r) => BILLING_ROLES.includes(r));
  return (
    <section className="card stay-discharge" aria-labelledby="stay-discharge-title">
      <div className="stay-discharge-head">
        <h3 id="stay-discharge-title">Discharge</h3>
        <DischargeStepPill a={a} />
      </div>
      <dl className="stay-discharge-facts">
        <div>
          <dt>Discharge card</dt>
          <dd>
            {formatDateTime(a.dischargedAt)}
            {a.dischargedByName ? ` · signed by ${a.dischargedByName}` : ''}
          </dd>
        </div>
        <div>
          <dt>Discharge type</dt>
          <dd>{a.discharge?.label ?? 'Not recorded at the desk yet'}</dd>
        </div>
        {a.discharge && (
          <div>
            <dt>Discharging doctor</dt>
            <dd>{a.discharge.doctorName || '–'}</dd>
          </div>
        )}
        {a.discharge?.remark && (
          <div>
            <dt>Remark</dt>
            <dd>{a.discharge.remark}</dd>
          </div>
        )}
        {a.discharge && (
          <div>
            <dt>Recorded by</dt>
            <dd>
              {a.discharge.byName}
              {a.discharge.at ? `, ${formatDateTime(a.discharge.at)}` : ''}
            </dd>
          </div>
        )}
        <div>
          <dt>Bill</dt>
          <dd>{a.bill ? `${a.bill.number} · ${a.bill.final ? `final (${a.bill.final.byName}, ${formatDateTime(a.bill.final.at)})` : 'not final yet'}` : 'No bill'}</dd>
        </div>
        {a.cleared && (
          <div>
            <dt>Gate pass</dt>
            <dd>
              {a.cleared.passNo} · cleared by {a.cleared.byName}
              {a.cleared.at ? `, ${formatDateTime(a.cleared.at)}` : ''}
            </dd>
          </div>
        )}
      </dl>
      {canBill && (
        <p>
          <Link to={`/billing/ipd/${a.id}`}>Open the IPD bill</Link>
          {!a.cleared ? ' to record the discharge, make the final bill and clear her for leaving.' : '.'}
        </p>
      )}
    </section>
  );
}
