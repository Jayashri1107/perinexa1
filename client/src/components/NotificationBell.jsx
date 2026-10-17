import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, CheckCircle2, FlaskConical, BedDouble, UserCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateTime } from './ui.jsx';

// The bell in the top bar (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md): a new appointment or an arrival for the
// doctor, a checkup done for reception, lab results to review, an admission request. Checked every minute while the page
// is open and visible; this does not count as activity, so the 30-minute logout still happens (it counts only the
// mouse and keyboard).
const REFRESH_MS = 60 * 1000;
const KIND_ICON = { appointment: CalendarClock, arrived: UserCheck, done: CheckCircle2, lab: FlaskConical, admission: BedDouble };

export function NotificationBell() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    api('/notifications')
      .then(setData)
      .catch(() => {}); // the bell is a help, never an error on the page
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [load]);

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

  const unread = data?.unread ?? 0;
  const list = data?.notifications ?? [];
  const markAllRead = async () => {
    await api('/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    load();
  };
  const openOne = async (n) => {
    setOpen(false);
    if (!n.read) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
    load();
    navigate(n.link || '/');
  };

  return (
    <div className="nb" ref={box}>
      <button
        type="button"
        className="icon-btn nb-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `Notifications: ${unread} new` : 'Notifications'}
        title="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
      >
        <Bell aria-hidden="true" />
        {unread > 0 && (
          <span className="nb-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="nb-card" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="btn btn-link btn-sm" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="nb-empty muted">Nothing new. New appointments, arrivals, checkups done, lab results and admission requests show here.</p>
          ) : (
            <ul className="nb-list">
              {list.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                return (
                  <li key={n.id}>
                    <button type="button" className={`nb-item${n.read ? '' : ' is-new'}`} onClick={() => openOne(n)}>
                      <Icon aria-hidden="true" />
                      <span className="nb-text">
                        {n.text}
                        <span className="nb-when muted">
                          {formatDateTime(n.at)}
                          {n.read ? '' : ' · new'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
