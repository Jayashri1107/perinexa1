export function Loader({ full = false, label = 'Loading' }) {
  return (
    <div className={full ? 'loader loader-full' : 'loader'} role="status">
      <span className="loader-dot" />
      <span>{label}</span>
    </div>
  );
}
