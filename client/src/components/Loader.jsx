// Loading (owner, 9 Oct 2026): inside a page, shimmering placeholder lines where the content will be; the whole screen
// (signing in) keeps the pulsing dot. The label is read out to screen readers.
export function Loader({ full = false, label = 'Loading' }) {
  if (full) {
    return (
      <div className="loader loader-full" role="status">
        <span className="loader-dot" />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <span className="skeleton-line w-40" />
      <span className="skeleton-line w-90" />
      <span className="skeleton-line w-75" />
      <span className="skeleton-line w-60" />
    </div>
  );
}
