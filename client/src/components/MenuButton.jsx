import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

/**
 * A button that opens a short list under it: links (e.g. "New patient" → the types of care) or actions
 * (e.g. a care-plan row's "More": Move date, Not needed …).
 * Closes on Escape, a click elsewhere, leaving it with Tab, or choosing an entry. Arrow keys move through the list.
 * - items: [{ label, to }] for links, [{ label, icon?, onSelect, danger?, disabled? }] for actions (shown as buttons;
 *   danger: an Alert Red label for destructive actions), or [{ label, icon?, href, onClick? }] for a link that opens
 *   in a new tab (a real link, so the browser never blocks it). The kinds can be mixed.
 * - ariaLabel: the button's name for screen readers when the label alone is not enough (e.g. "More actions for Hb")
 * - className: the button's look ('btn btn-primary' in page actions; none inside the tab bar)
 * - active: shows the button as the current tab
 * - align: 'start' (list under the left edge) or 'end' (under the right edge, for buttons on the right)
 */
// wide: the list in two columns; an item's `group` starts a heading when it changes (owner, 24 Oct 2026)
export function MenuButton({ label, icon: Icon, items, className = '', active = false, align = 'start', ariaLabel, wide = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const links = () => [...(wrapRef.current?.querySelectorAll('.menu-list a, .menu-list button') ?? [])];
  const onButtonKey = (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => links()[0]?.focus());
  };
  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = links();
    const i = all.indexOf(document.activeElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <div
      className={`menu-button menu-${align}`}
      ref={wrapRef}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`${className} ${active ? 'active' : ''}`.trim() || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
      >
        {Icon && <Icon aria-hidden="true" />}
        {label}
        <ChevronDown aria-hidden="true" className="menu-chevron" />
      </button>
      {open && (
        // A mouse press keeps focus where it is: Safari does not focus buttons or links on click, and the blur
        // would close the list before the click.
        <ul id={listId} className={`menu-list${wide ? ' menu-list-wide' : ''}`} onKeyDown={onListKey} onMouseDown={(e) => e.preventDefault()}>
          {items.flatMap((item, i) => [
            ...(item.group && item.group !== items[i - 1]?.group
              ? [
                  <li key={`group-${item.group}`} className="menu-group" role="presentation">
                    {item.group}
                  </li>,
                ]
              : []),
            <li key={item.to ?? item.label}>
              {item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    setOpen(false);
                    item.onClick?.(e);
                  }}
                >
                  {item.icon && <item.icon aria-hidden="true" />}
                  {item.label}
                </a>
              ) : item.onSelect ? (
                <button
                  type="button"
                  className={item.danger ? 'menu-danger' : undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    // Focus goes back to the menu button first, so a dialog opened by the action returns focus there.
                    setOpen(false);
                    buttonRef.current?.focus();
                    item.onSelect();
                  }}
                >
                  {item.icon && <item.icon aria-hidden="true" />}
                  {item.label}
                </button>
              ) : (
                /* "current" rather than NavLink's default "active", which the tab bar styles as a selected tab */
                <NavLink to={item.to} className={({ isActive }) => (isActive ? 'current' : '')} onClick={() => setOpen(false)}>
                  {item.label}
                </NavLink>
              )}
            </li>,
          ])}
        </ul>
      )}
    </div>
  );
}
