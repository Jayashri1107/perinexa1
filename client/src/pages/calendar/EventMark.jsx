import { EVENT_LOOK } from './calendarFormat.js';

/**
 * The mark of a calendar entry: colour + icon + word (docs/BRAND.md "Calendar event marks").
 * type: booked | plan | edd | lmp. level: 'clinical' | 'reception'. event: for the EDD source ("EDD (scan)").
 * compact: icon only, with the word as its accessible name – only where the word is close by.
 * decorative: with compact, hidden from screen readers – use where the word is inside the same element (e.g. the
 * day view's section headings), so it is not heard twice.
 */
export function EventMark({ type, level = 'clinical', event, view, compact = false, decorative = false }) {
  const look = EVENT_LOOK[type];
  if (!look) return null;
  const Icon = look.icon;
  const word = look.word(level, event, view);
  if (compact) {
    if (decorative) {
      return (
        <span className={`pill cal-mark cal-mark-compact ${look.className}`} aria-hidden="true">
          <Icon aria-hidden="true" />
        </span>
      );
    }
    return (
      <span className={`pill cal-mark cal-mark-compact ${look.className}`} role="img" aria-label={word} title={word}>
        <Icon aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`pill cal-mark ${look.className}`}>
      <Icon aria-hidden="true" />
      {word}
    </span>
  );
}
