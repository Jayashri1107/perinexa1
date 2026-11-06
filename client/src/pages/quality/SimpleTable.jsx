// A compact table for the Clinical Requirements pages (Specimens, Newborn follow-up, Incidents, Formulary): it fits the
// page (cells wrap instead of scrolling sideways), and on phones each row becomes a small card with the column names
// beside the values (styles in components.css, .ca-table).
// columns: [{ key, header, render(row), num?: true, main?: true (the row's title on phones) }]

export function SimpleTable({ columns, rows, emptyText = 'Nothing here.', loading = false, rowKey = 'id' }) {
  if (loading) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="an-table-wrap">
      <table className="ca-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.num ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]}>
              {columns.map((c) =>
                c.main ? (
                  <th key={c.key} scope="row">
                    {c.render(r)}
                  </th>
                ) : (
                  <td key={c.key} data-label={c.header || undefined} className={c.num ? 'num' : undefined}>
                    {c.render(r)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The show-this-list choice, as the app's segmented control. */
export function ShowChoice({ options, value, onChange, label = 'Show' }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([k, words]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {words}
        </button>
      ))}
    </div>
  );
}
