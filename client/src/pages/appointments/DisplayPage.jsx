import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import logo from '../../assets/brand/perinexa-logo.png';
import { formatDate } from '../../components/ui.jsx';
import { timeLabel } from './appointmentFormat.js';

// The waiting-room screen (/display/<secret>): for a TV or tablet in the waiting room, with no login. Each doctor's
// name and who goes in next – as a walk-in token number or an appointment time, never a name. Refreshes by itself.
// Its own small request (never the staff helper: this page has no staff session).

const REFRESH_SECONDS = 20;

const words = (who) => (who.kind === 'token' ? `Token ${who.token}` : who.start ? `${timeLabel(who.start)} appointment` : 'Appointment');

export function DisplayPage() {
  const { key } = useParams();
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/display/${encodeURIComponent(key)}`, { credentials: 'omit' });
        const data = await res.json().catch(() => null);
        if (!current) return;
        if (res.ok) setState({ data, error: null });
        else if (res.status === 404) setState({ data: null, error: data?.error?.message ?? 'This screen is switched off.' });
        else setState((s) => ({ ...s, error: 'Waiting for the hospital’s server…' }));
      } catch {
        if (current) setState((s) => ({ ...s, error: 'Waiting for the hospital’s server…' }));
      }
    };
    load();
    const timer = setInterval(load, REFRESH_SECONDS * 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    const before = document.title;
    document.title = 'Waiting room · Perinexa';
    return () => {
      document.title = before;
    };
  }, []);

  const { data, error } = state;
  return (
    <main className="wr-page">
      <header className="wr-head">
        <img src={logo} alt="Perinexa" className="wr-logo" />
        <div className="wr-head-text">
          <h1>{data?.hospital ?? 'Waiting room'}</h1>
          {data && (
            <p className="wr-clock tabular">
              {formatDate(data.today)} · {timeLabel(data.now)}
            </p>
          )}
        </div>
      </header>
      {error && (
        <p className="wr-note" role="status">
          {error}
        </p>
      )}
      {data && data.doctors.length === 0 && <p className="wr-note">No one is waiting at the moment.</p>}
      {data && data.doctors.length > 0 && (
        <div className="wr-doctors">
          {data.doctors.map((d) => (
            <section key={d.name} className="wr-doctor" aria-label={d.name}>
              <h2>{d.name}</h2>
              <p className="wr-label">Next</p>
              <p className="wr-next tabular">{d.next ? words(d.next) : 'No one waiting'}</p>
              {d.then.length > 0 && (
                <>
                  <p className="wr-label">Then</p>
                  <ol className="wr-then tabular">
                    {d.then.map((w, i) => (
                      <li key={`${w.kind}-${w.token ?? w.start}-${i}`}>{words(w)}</li>
                    ))}
                  </ol>
                </>
              )}
              <p className="wr-waiting">{d.waiting === 1 ? '1 person waiting' : `${d.waiting} people waiting`}</p>
            </section>
          ))}
        </div>
      )}
      <p className="wr-foot">Please wait until your token or appointment time is called. The order can change in an emergency.</p>
    </main>
  );
}
