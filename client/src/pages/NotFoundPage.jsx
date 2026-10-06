import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="card center">
      <h1>Page not found</h1>
      <p className="muted">This address does not exist.</p>
      <Link to="/" className="btn btn-primary">Go to the dashboard</Link>
    </section>
  );
}
