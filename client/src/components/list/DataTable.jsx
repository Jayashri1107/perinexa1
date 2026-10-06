// Any table. columns: [{ key, label, render(row), className }]. Rows are clickable when onRowClick is given.
import { Loader } from '../Loader.jsx';

export function DataTable({ columns, rows, loading, emptyText = 'Nothing to show yet.', onRowClick, rowKey = 'id' }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}><Loader /></td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">{emptyText}</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className} data-label={c.label}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
