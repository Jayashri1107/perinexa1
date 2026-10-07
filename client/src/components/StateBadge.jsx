// A status as colour + icon + word, from a "look" { tone, icon, word } (pages/*/…Format.js).
// tone: active (green) · pending (amber) · info (blue) · inactive (grey) · danger (red)
export function StateBadge({ look, small = false }) {
  if (!look) return null;
  const Icon = look.icon;
  return (
    <span className={`badge badge-${look.tone}${small ? ' small' : ''}`}>
      {Icon && <Icon size={small ? 12 : 14} aria-hidden />}
      {look.word}
    </span>
  );
}
