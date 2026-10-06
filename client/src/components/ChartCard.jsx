// A chart in a card with a "Table" switch, so every value can also be read without hovering.
// table: { columns: [label], rows: [[cell, …]] }
import { useState } from 'react';

export function ChartCard({ title, subtitle, children, table, className = '' }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {table && (
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {asTable && table ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{table.columns.map((c, i) => <th key={c} className={i ? 'num' : undefined}>{c}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r[0]}>{r.map((cell, i) => <td key={i} className={i ? 'num' : undefined}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
