import { Link } from 'react-router-dom';

export function NotFoundPage({ home = '/' }) {
  return (
    <section className="card center">
      <h1>Page not found</h1>
      <p className="muted">This address does not exist.</p>
      <Link to={home} className="btn btn-primary">Go to the start page</Link>
    </section>
  );
}
