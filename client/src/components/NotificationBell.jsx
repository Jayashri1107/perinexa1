// The bell in the top bar (in a hospital): how many notifications are unread, and the latest ones. It checks every
// minute. Clicking one marks it read and opens its page.
import { BedDouble, Bell, CalendarCheck, CalendarPlus, DoorOpen, FlaskConical, Pill, Receipt, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../api/index.js';
import { formatDateTime } from '../utils/format.js';

const EVERY_MS = 60_000;

// Each kind of notification has its own icon in a pastel tile, so they can be told apart at a glance.
const KINDS = {
  TODAY_SUMMARY: { icon: CalendarCheck, tone: '' },
  NEW_APPOINTMENT: { icon: CalendarPlus, tone: 'tone-teal' },
  PATIENT_ARRIVED: { icon: UserCheck, tone: 'tone-blue' },
  NEW_ADMISSION: { icon: BedDouble, tone: '' },
  DISCHARGE_SOON: { icon: DoorOpen, tone: 'tone-amber' },
  DISCHARGE_READY: { icon: DoorOpen, tone: 'tone-green' },
  FINAL_BILL: { icon: Receipt, tone: 'tone-amber' },
  PRESCRIPTION_SENT: { icon: Pill, tone: 'tone-teal' },
  LAB_BOOKED: { icon: FlaskConical, tone: 'tone-amber' },
};

export function NotificationBell() {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const load = useCallback(() => {
    notificationsApi.list().then(setData).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), EVERY_MS);
    return () => clearInterval(t);
  }, [load]);

  // close on a click outside or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openOne = async (n) => {
    setOpen(false);
    if (!n.isRead) notificationsApi.read(n.id).then(setData).catch(() => {});
    if (n.link) navigate(n.link);
  };

  return (
    <div className="profile notif" ref={box}>
      <button
        type="button"
        className="icon-btn notif-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={data.unread ? `Notifications: ${data.unread} unread` : 'Notifications'}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
      >
        <Bell size={20} aria-hidden />
        {data.unread > 0 && <span className="notif-count" aria-hidden>{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="profile-card notif-card" role="dialog" aria-label="Notifications">
          <div className="card-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => notificationsApi.readAll().then(setData).catch(() => {})}>Mark all as read</button>
            )}
          </div>
          {data.items.length === 0 && <p className="muted small">Nothing yet.</p>}
          <ul className="plain-list notif-list">
            {data.items.map((n) => {
              const kind = KINDS[n.type] ?? { icon: Bell, tone: '' };
              const Icon = kind.icon;
              return (
                <li key={n.id}>
                  <button type="button" className={`notif-item${n.isRead ? '' : ' unread'}`} onClick={() => openOne(n)}>
                    <span className={`notif-icon ${kind.tone}`} aria-hidden><Icon size={16} /></span>
                    <span className="notif-text">
                      <strong className="block">{n.title}</strong>
                      {n.message && <span className="block small">{n.message}</span>}
                      <span className="block small muted">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
