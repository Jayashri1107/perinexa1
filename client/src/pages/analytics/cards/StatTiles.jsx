import { KpiCard } from '../../../components/ui.jsx';
import { formatCount, isExact } from '../analyticsFormat.js';

/**
 * Numbers as KPI tiles. A value that is not an exact number ("fewer than 5", "Not shown") is shown in words at the
 * card-title size, never as a symbol. A tile opens its list only when it has an href (doctors).
 * tiles: [{ key, label, value, sub?, href?, tone?, icon?, text? (words to show instead of the value) }]
 */
export function StatTiles({ tiles, className = '' }) {
  return (
    <div className={`kpi-grid an-kpis ${className}`.trim()}>
      {tiles.map((t) => {
        const words = t.text ?? formatCount(t.value);
        const textValue = t.text !== undefined ? t.textValue ?? false : !isExact(t.value);
        return <KpiCard key={t.key} to={t.href ?? undefined} tone={t.tone ?? 'neutral'} icon={t.icon} label={t.label} value={words} sub={t.sub} textValue={textValue} />;
      })}
    </div>
  );
}
