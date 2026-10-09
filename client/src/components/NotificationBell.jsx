// The bell in the top bar (in a hospital): how many notifications are unread, and the latest ones. It checks every
// minute. Clicking one marks it read and opens its page.
// Each notification is its own row, and the list has a tab per kind with its own unread count (owner, 8 Oct 2026):
// All · Appointments · Admissions · Discharges · Prescriptions · Lab · Billing – "Mark all as read" acts on the open tab.
import { BedDouble, Bell, CalendarCheck, CalendarPlus, ClipboardList, DoorOpen, FlaskConical, Pill, Receipt, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../api/index.js';
import { formatDateTime } from '../utils/format.js';

const EVERY_MS = 60_000;

// Each kind of notification has its own icon in a pastel tile, so they can be told apart at a glance.
const KINDS = {
  TODAY_SUMMARY: { icon: CalendarCheck, tone: '' },
  TODAY_APPOINTMENTS: { icon: CalendarCheck, tone: 'tone-teal' },
  TODAY_ADMISSIONS: { icon: BedDouble, tone: '' },
  TODAY_DISCHARGES: { icon: DoorOpen, tone: 'tone-amber' },
  NEW_APPOINTMENT: { icon: CalendarPlus, tone: 'tone-teal' },
  PATIENT_ARRIVED: { icon: UserCheck, tone: 'tone-blue' },
  NEW_ADMISSION: { icon: BedDouble, tone: '' },
  DISCHARGE_SOON: { icon: DoorOpen, tone: 'tone-amber' },
  DISCHARGE_READY: { icon: DoorOpen, tone: 'tone-green' },
  FINAL_BILL: { icon: Receipt, tone: 'tone-amber' },
  PRESCRIPTION_SENT: { icon: Pill, tone: 'tone-teal' },
  LAB_BOOKED: { icon: FlaskConical, tone: 'tone-amber' },
  CARE_ORDER: { icon: ClipboardList, tone: 'tone-blue' },
  SERVICE_TO_BILL: { icon: Receipt, tone: 'tone-amber' },
};

// The tabs: which kinds each holds ("All" holds every kind).
const GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'appointments', label: 'Appointments', types: ['NEW_APPOINTMENT', 'PATIENT_ARRIVED', 'TODAY_APPOINTMENTS'] },
  { key: 'admissions', label: 'Admissions', types: ['NEW_ADMISSION', 'TODAY_ADMISSIONS'] },
  { key: 'discharges', label: 'Discharges', types: ['DISCHARGE_SOON', 'DISCHARGE_READY', 'TODAY_DISCHARGES'] },
  { key: 'prescriptions', label: 'Prescriptions', types: ['PRESCRIPTION_SENT'] },
  { key: 'lab', label: 'Lab', types: ['LAB_BOOKED'] },
  { key: 'care', label: 'Orders', types: ['CARE_ORDER'] },
  { key: 'billing', label: 'Billing', types: ['FINAL_BILL', 'SERVICE_TO_BILL'] },
];

export function NotificationBell() {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], unread: 0, unreadByType: {} });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('all');
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

  const byType = data.unreadByType ?? {};
  const unreadOf = (g) => (g.types ? g.types.reduce((s, t) => s + (byType[t] ?? 0), 0) : data.unread);
  // the tabs worth showing: All, and every kind with a notification in the list or unread
  const tabs = GROUPS.filter((g) => !g.types || unreadOf(g) > 0 || data.items.some((n) => g.types.includes(n.type)));
  const current = tabs.find((g) => g.key === tab) ?? tabs[0];
  const shown = current.types ? data.items.filter((n) => current.types.includes(n.type)) : data.items;
  const unreadHere = unreadOf(current);

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
            <strong>Notifications {data.unread > 0 && <span className="notif-total">{data.unread} unread</span>}</strong>
            {unreadHere > 0 && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => notificationsApi.readAll(current.types).then(setData).catch(() => {})}>
                Mark {current.types ? `${current.label.toLowerCase()} ` : 'all '}as read
              </button>
            )}
          </div>
          {tabs.length > 1 && (
            <div className="notif-tabs" role="tablist" aria-label="Kinds of notification">
              {tabs.map((g) => {
                const n = unreadOf(g);
                return (
                  <button key={g.key} type="button" role="tab" aria-selected={g.key === current.key} className={g.key === current.key ? 'on' : ''} onClick={() => setTab(g.key)}>
                    {g.label}
                    {n > 0 && <span className="notif-tab-count">{n > 99 ? '99+' : n}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {shown.length === 0 && <p className="muted small notif-empty">Nothing here yet.</p>}
          <ul className="plain-list notif-list">
            {shown.map((n) => {
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
                    {!n.isRead && <span className="notif-dot" aria-label="Unread" />}
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
