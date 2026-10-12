import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CircleAlert, CircleCheck, Heart, Info, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';

// Messages carry an icon as well as colour (brand guide: never colour alone).
const ALERT_ICONS = { error: CircleAlert, critical: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info };

// closeLabel: what a screen reader says for the close button (the patient portal says it in her language).
export function Alert({ type = 'info', children, onClose, icon, closeLabel = 'Dismiss message' }) {
  if (!children) return null;
  const Icon = icon === undefined ? ALERT_ICONS[type] : icon;
  return (
    <div className={`alert alert-${type}`} role={type === 'error' || type === 'critical' ? 'alert' : 'status'}>
      {Icon && (
        <span className="alert-icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <div className="alert-body">{children}</div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label={closeLabel}>
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Status pill (brand guide page 5): dark text on a light tint, always with its icon and its word.
 * tone: stable | due | admitted | watch | high | inactive (clinical states), or neutral | brand for tags.
 * icon: a lucide icon to use instead of the tone's default; null for none.
 */
export const STATUS_ICONS = { stable: Check, due: CalendarDays, admitted: Heart, watch: TriangleAlert, high: TriangleAlert, inactive: X };

export function StatusPill({ tone = 'neutral', icon, large = false, title, className = '', children }) {
  const Icon = icon === undefined ? STATUS_ICONS[tone] : icon;
  return (
    <span className={`pill pill-${tone} ${large ? 'pill-lg' : ''} ${className}`.trim()} title={title}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for dialogs: focus moves into the dialog, Tab stays inside it, Escape cancels
 * (when onCancel is given), and focus goes back to the button that opened it when it closes.
 * Returns a ref for the dialog element (which also needs tabIndex={-1}).
 */
export function useDialogFocus(onCancel) {
  const ref = useRef(null);
  const [returnTo] = useState(() => document.activeElement);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus();
    const onKey = (e) => {
      if (!node) return;
      if (e.key === 'Escape' && cancelRef.current) {
        e.preventDefault();
        cancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node || !node.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Give focus back once the dialog has really gone (not on React's development re-run).
      setTimeout(() => {
        if (node && !node.isConnected && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
      }, 0);
    };
  }, [returnTo]);
  return ref;
}

/**
 * Branded "are you sure?" dialog, used instead of the browser's own confirm box.
 * danger: the confirm button is the red destructive button, and Cancel gets the focus.
 */
export function ConfirmDialog({ id = 'confirm', title, children, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const ref = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={ref}
        tabIndex={-1}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={children ? `${id}-text` : undefined}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children && <p id={`${id}-text`}>{children}</p>}
        <div className="row">
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus={!danger}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} autoFocus={danger}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The same dialog, asked from code: const [confirm, confirmDialog] = useConfirm();
 * if (!(await confirm({ title, text, confirmLabel, danger }))) return;  …and render {confirmDialog}.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);
  const answer = (ok) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const dialog = request ? (
    <ConfirmDialog id="confirm-action" title={request.title} confirmLabel={request.confirmLabel} danger={request.danger} onConfirm={() => answer(true)} onCancel={() => answer(false)}>
      {request.text}
    </ConfirmDialog>
  ) : null;
  return [confirm, dialog];
}

// Initials for avatars – patients and staff are shown with initials only, never photos (privacy).
export const initials = (name = '') =>
  name
    .replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

// Lavender or Teal Wash, chosen from the name so the same person always gets the same colour.
const avatarTone = (seed = '') => ([...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 === 0 ? '' : 'avatar-teal');

export function Avatar({ name, seed, large = false }) {
  return (
    <span className={`avatar ${avatarTone(seed ?? name)} ${large ? 'avatar-lg' : ''}`.trim()} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * Big-number card (brand guide page 8): status pill top-left, the number, a short caption.
 * textValue: the value is words, not a number (e.g. "fewer than 5" in Analytics), shown at the card-title size.
 */
export function KpiCard({ to, tone = 'neutral', icon, label, value, sub, textValue = false }) {
  const content = (
    <>
      <StatusPill tone={tone} icon={icon}>
        {label}
      </StatusPill>
      <span className={textValue ? 'kpi-value-text' : 'kpi-value'}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="kpi">
      {content}
    </Link>
  ) : (
    <div className="kpi">{content}</div>
  );
}

// An error under a form field: words plus an icon (never colour alone).
export function FieldError({ id, role, children }) {
  if (!children) return null;
  return (
    <p className="field-error" id={id} role={role}>
      <CircleAlert aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// A field's hint is an explanation (hidden while "Explanations" is off, see .help in base.css) unless keepHint:
// then it is always shown – for safety notes and for values worked out from what was typed.
export function Field({ label, id, error, hint, keepHint = false, children }) {
  // Screen readers read the error (or the hint) with the field, and know when it is invalid.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  let first = true;
  const content = Children.toArray(children).map((child) => {
    if (!first || !isValidElement(child)) return child;
    first = false;
    const own = child.props['aria-describedby'];
    return cloneElement(child, {
      'aria-invalid': error ? true : child.props['aria-invalid'],
      'aria-describedby': [own, describedBy].filter(Boolean).join(' ') || undefined,
    });
  });
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {content}
      {hint && !error && (
        <p className={keepHint ? 'hint' : 'hint help'} id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

// Shows a temporary password once, with a copy button.
export function TemporaryPassword({ email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="alert alert-success temp-password" role="status">
      <div>
        <strong>Temporary password for {email}:</strong>
        <div className="row">
          <code className="password-box">{password}</code>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? (
              <>
                <Check size={16} aria-hidden="true" /> Copied
              </>
            ) : (
              'Copy'
            )}
          </button>
        </div>
        <p className="hint">
          This is shown only once. Give it to the person privately (not by email or chat). They will be asked to choose
          their own password when they log in.
        </p>
      </div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss message">
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// Dates and times as the brand guide writes them: "12 Oct 2026", times in 24-hour "10:30".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const validDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// "12 Oct 2026, 10:30" in the computer's time zone.
export const formatDateTime = (value) => {
  const d = validDate(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
};

// "10:20" (local time)
export const formatTime = (value) => {
  const d = validDate(value);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
};

// "12 Oct 2026". Dates of birth, LMP, EDD etc. are stored as midnight UTC; show them without any time-zone shift.
export const formatDate = (value) => {
  const d = validDate(value);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
};

// "12 Oct" – for tight table columns where the year is obvious.
export const formatDayMonth = (value) => {
  const d = validDate(value);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : '—';
};

// "Oct 2026" – from a month ("2026-10", or an Analytics month key "m:2026-10") or a date.
export const formatMonth = (value) => {
  const m = /^(?:m:)?(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  if (m) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : '—';
  }
  const d = validDate(value);
  return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
};

export const ROLE_LABELS = {
  admin: 'Hospital admin',
  doctor: 'Doctor',
  rmo: 'RMO',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  lab: 'Lab staff',
  pharmacist: 'Pharmacist',
  billing: 'Billing',
};
export const ROLE_HINTS = {
  admin: 'Manages staff, print settings and the audit log',
  doctor: 'Full access to own patients; approves care-plan templates',
  rmo: 'Resident medical officer: works with all patients',
  nurse: 'Records vital signs; sees care plans',
  receptionist: 'Registers patients, manages appointments and admissions, and takes payments',
  lab: 'Lab worklist: collects samples, enters results, attaches reports',
  pharmacist: 'Pharmacy: medicine stock, counter sales and the registers',
  billing: 'Billing department: bills, payments, refunds and billing reports',
};
export const ROLES = Object.keys(ROLE_LABELS);
export const roleLabel = (role) => ROLE_LABELS[role] ?? role;
// Accepts one role or a list (older audit entries store a single role).
export const rolesLabel = (roles) => [roles].flat().filter(Boolean).map(roleLabel).join(', ');
export const hasRole = (membership, ...roles) => Boolean(membership?.roles?.some((r) => roles.includes(r)));

// Roles are neutral tags (not a clinical status, so no status colour).
export function RoleBadges({ roles }) {
  return (
    <span className="role-badges">
      {(roles ?? []).map((r) => (
        <span key={r} className="pill pill-neutral">
          {roleLabel(r)}
        </span>
      ))}
    </span>
  );
}

// Tick one or more roles.
export function RolePicker({ value, onChange, idPrefix = 'role', disabled = false, without = [] }) {
  const toggle = (r) => onChange(value.includes(r) ? value.filter((x) => x !== r) : ROLES.filter((x) => x === r || value.includes(x)));
  return (
    <div className="role-picker" role="group">
      {ROLES.filter((r) => !without.includes(r)).map((r) => (
        <label key={r} className={`role-option ${value.includes(r) ? 'checked' : ''}`} htmlFor={`${idPrefix}-${r}`}>
          <input id={`${idPrefix}-${r}`} type="checkbox" checked={value.includes(r)} onChange={() => toggle(r)} disabled={disabled} />
          <span>
            <strong>{ROLE_LABELS[r]}</strong>
            <small>{ROLE_HINTS[r]}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

// Waits until typing pauses before using the value (e.g. for search boxes).
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Fields most people never need (e.g. a rule's short code and guideline source), folded under "Advanced": open when
 * one of them has an error, so a problem is never hidden.
 */
export function AdvancedFields({ hasError = false, label = 'Advanced: short code and source', children }) {
  return (
    <details className="advanced-fields span-2" open={hasError || undefined}>
      <summary>{label}</summary>
      <div className="advanced-fields-body">{children}</div>
    </details>
  );
}
