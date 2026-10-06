// Horizontal bars for a short list of categories, each with its value at the tip.
// rows: [{ key, label, value, text }] – text is what is written (default: value).
export function BarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.text ?? r.value}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bar-value">{r.text ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}
