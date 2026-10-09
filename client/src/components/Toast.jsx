// Small slide-in notices (owner, 9 Oct 2026): "Payment recorded", "Saved to the chart", "Uploaded" … at the bottom
// right, gone after a few seconds (or with ×). Any screen calls toast('…') – no provider to pass around. Read aloud
// politely by screen readers. Errors that need the person's attention stay on the page as they are now (Alert);
// clinical warnings are never toasts.
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const listeners = new Set();
let nextId = 1;
const SHOW_MS = 3800;

/** toast('Saved') · toast('Could not save', 'error') · toast('Sent to billing', 'info') */
export function toast(text, tone = 'success') {
  const item = { id: nextId++, text, tone };
  listeners.forEach((l) => l(item));
}

const ICONS = { success: CircleCheck, info: Info, error: TriangleAlert };

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (item) => {
      setItems((list) => [...list.slice(-3), item]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), SHOW_MS);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, []);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICONS[t.tone] ?? Info;
        return (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon size={18} aria-hidden />
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Close" onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}><X size={14} aria-hidden /></button>
          </div>
        );
      })}
    </div>
  );
}
