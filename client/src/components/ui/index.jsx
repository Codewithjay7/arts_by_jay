import { forwardRef, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, Info, Loader2, Star, X } from 'lucide-react';

/* ──────────────────────────── Button ──────────────────────────── */

const BUTTON_VARIANTS = {
  primary:
    'bg-lime-300 text-charcoal-950 hover:bg-lime-200 active:bg-lime-400 shadow-glow disabled:bg-charcoal-700 disabled:text-muted disabled:shadow-none',
  secondary:
    'bg-charcoal-750 text-parchment hover:bg-charcoal-700 border border-charcoal-600 disabled:text-muted',
  outline:
    'border border-lime-300/50 text-lime-300 hover:border-lime-300 hover:bg-lime-300/10 disabled:border-charcoal-700 disabled:text-muted',
  ghost: 'text-parchment hover:bg-charcoal-800 disabled:text-muted',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 disabled:bg-charcoal-700 disabled:text-muted',
  link: 'text-lime-300 underline-offset-4 hover:underline p-0',
};

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-[0.8rem]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-7 text-[0.95rem]',
  icon: 'h-10 w-10',
};

export const Button = forwardRef(function Button(
  { as, to, href, variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props },
  ref,
) {
  const classes = clsx(
    'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-wide',
    'transition-all duration-200 ease-gallery',
    'disabled:cursor-not-allowed',
    variant !== 'link' && 'whitespace-nowrap',
    BUTTON_VARIANTS[variant],
    variant !== 'link' && BUTTON_SIZES[size],
    className,
  );

  const content = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </>
  );

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} aria-disabled={disabled || undefined} {...props}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...props}>
        {content}
      </a>
    );
  }

  const Component = as ?? 'button';

  return (
    <Component
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </Component>
  );
});

/* ──────────────────────────── Form fields ──────────────────────────── */

export const Field = ({ label, hint, error, required, children, className, htmlFor }) => (
  <div className={clsx('space-y-1.5', className)}>
    {label && (
      <label htmlFor={htmlFor} className="block text-[0.8rem] font-medium text-parchment">
        {label}
        {required && (
          <span className="ml-1 text-lime-300" aria-hidden="true">
            *
          </span>
        )}
      </label>
    )}
    {children}
    {error ? (
      <p className="flex items-start gap-1.5 text-[0.78rem] text-red-400" role="alert">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {error}
      </p>
    ) : (
      hint && <p className="text-[0.78rem] text-muted">{hint}</p>
    )}
  </div>
);

const inputClasses = (error) =>
  clsx(
    'w-full rounded-xl border bg-charcoal-900/80 px-3.5 py-2.5 text-sm text-parchment',
    'placeholder:text-muted/60 transition-colors',
    'focus:border-lime-300/60 focus:outline-none focus:ring-1 focus:ring-lime-300/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
    error ? 'border-red-500/60' : 'border-charcoal-600',
  );

export const Input = forwardRef(function Input({ error, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(inputClasses(error), className)}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ error, className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={clsx(inputClasses(error), 'resize-y leading-relaxed', className)}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ error, className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={clsx(inputClasses(error), 'cursor-pointer appearance-none bg-[length:12px] pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%239aa196' stroke-width='1.6'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.85rem center',
      }}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    >
      {children}
    </select>
  );
});

export const Checkbox = ({ label, description, className, id, ...props }) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={clsx('flex gap-3', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-charcoal-600 bg-charcoal-900 text-lime-300 accent-lime-300"
        {...props}
      />
      <div className="space-y-0.5">
        <label htmlFor={inputId} className="cursor-pointer text-sm text-parchment">
          {label}
        </label>
        {description && <p className="text-[0.78rem] leading-relaxed text-muted">{description}</p>}
      </div>
    </div>
  );
};

/* ──────────────────────────── Badge ──────────────────────────── */

const BADGE_TONES = {
  neutral: 'bg-charcoal-750 text-muted border-charcoal-600',
  positive: 'bg-lime-300/12 text-lime-300 border-lime-300/30',
  info: 'bg-sky-400/12 text-sky-300 border-sky-400/30',
  negative: 'bg-red-500/12 text-red-300 border-red-500/30',
  warning: 'bg-amber-400/12 text-amber-300 border-amber-400/30',
  accent: 'bg-lime-300 text-charcoal-950 border-lime-300',
};

export const Badge = ({ tone = 'neutral', className, children, ...props }) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5',
      'font-mono text-[0.65rem] uppercase tracking-[0.12em]',
      BADGE_TONES[tone],
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

/* ──────────────────────────── Loading ──────────────────────────── */

export const Spinner = ({ className, label = 'Loading' }) => (
  <span role="status" aria-label={label} className={clsx('inline-flex', className)}>
    <Loader2 className="h-5 w-5 animate-spin text-lime-300" aria-hidden="true" />
  </span>
);

export const Skeleton = ({ className }) => <div className={clsx('skeleton', className)} aria-hidden="true" />;

export const LoadingBlock = ({ label = 'Loading', className }) => (
  <div className={clsx('flex flex-col items-center justify-center gap-3 py-20 text-center', className)}>
    <Spinner />
    <p className="text-sm text-muted">{label}</p>
  </div>
);

/* ──────────────────────────── States ──────────────────────────── */

export const EmptyState = ({ icon: Icon, title, message, action, className }) => (
  <div
    className={clsx(
      'flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-charcoal-600 px-6 py-16 text-center',
      className,
    )}
  >
    {Icon && (
      <span className="grid h-12 w-12 place-items-center rounded-full bg-charcoal-800 text-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
    )}
    <div className="space-y-1.5">
      <h3 className="text-lg text-parchment">{title}</h3>
      {message && <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">{message}</p>}
    </div>
    {action}
  </div>
);

export const ErrorState = ({ title = 'That did not load', message, onRetry, className }) => (
  <div
    className={clsx(
      'flex flex-col items-center justify-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/5 px-6 py-14 text-center',
      className,
    )}
    role="alert"
  >
    <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-red-300">
      <AlertCircle className="h-5 w-5" aria-hidden="true" />
    </span>
    <div className="space-y-1.5">
      <h3 className="text-lg text-parchment">{title}</h3>
      {message && <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">{message}</p>}
    </div>
    {onRetry && (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

/**
 * A banner for things the server has told us are not configured — payments,
 * email, AI generation. Used instead of letting a feature look functional.
 */
export const NoticeBanner = ({ tone = 'warning', title, children, className }) => {
  const Icon = tone === 'warning' ? AlertCircle : Info;

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'warning'
          ? 'border-amber-400/30 bg-amber-400/8 text-amber-100'
          : 'border-sky-400/25 bg-sky-400/8 text-sky-100',
        className,
      )}
      role="note"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1 leading-relaxed">
        {title && <p className="font-medium">{title}</p>}
        <div className="text-[0.82rem] opacity-90">{children}</div>
      </div>
    </div>
  );
};

/* ──────────────────────────── Modal & Drawer ──────────────────────────── */

/** Traps focus and restores it on close, and closes on Escape. */
const useDialogBehaviour = (open, onClose) => {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const focusable = panel?.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const items = [
        ...panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null);

      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return panelRef;
};

export const Modal = ({ open, onClose, title, description, size = 'md', children, footer }) => {
  const panelRef = useDialogBehaviour(open, onClose);
  const titleId = useId();

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 animate-fade-in bg-charcoal-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close dialog"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={clsx(
          'relative max-h-[92vh] w-full overflow-hidden rounded-t-3xl border border-charcoal-700 bg-charcoal-850 shadow-frame',
          'animate-fade-up sm:rounded-3xl',
          widths[size],
        )}
      >
        {(title || onClose) && (
          <header className="flex items-start justify-between gap-4 border-b border-charcoal-700 px-6 py-4">
            <div className="space-y-1">
              {title && (
                <h2 id={titleId} className="text-xl text-parchment">
                  {title}
                </h2>
              )}
              {description && <p className="text-sm text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-parchment"
              aria-label="Close"
            >
              <X className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          </header>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="border-t border-charcoal-700 px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

export const Drawer = ({ open, onClose, title, children, footer, side = 'right' }) => {
  const panelRef = useDialogBehaviour(open, onClose);
  const titleId = useId();

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 animate-fade-in bg-charcoal-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close panel"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'absolute inset-y-0 flex w-full max-w-md flex-col border-charcoal-700 bg-charcoal-850 shadow-frame',
          'animate-slide-in-right',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-charcoal-700 px-5 py-4">
          <h2 id={titleId} className="text-lg text-parchment">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-parchment"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-charcoal-700 px-5 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

/* ──────────────────────────── Toasts ──────────────────────────── */

const TOAST_ICONS = { positive: Check, negative: AlertCircle, info: Info, neutral: Info };

export const ToastStack = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.tone] ?? Info;

        return (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-frame backdrop-blur',
              'animate-fade-up',
              toast.tone === 'positive' && 'border-lime-300/30 bg-charcoal-850/95',
              toast.tone === 'negative' && 'border-red-500/35 bg-charcoal-850/95',
              (toast.tone === 'info' || toast.tone === 'neutral') && 'border-charcoal-600 bg-charcoal-850/95',
            )}
          >
            <Icon
              className={clsx(
                'mt-0.5 h-4 w-4 shrink-0',
                toast.tone === 'positive' && 'text-lime-300',
                toast.tone === 'negative' && 'text-red-400',
                (toast.tone === 'info' || toast.tone === 'neutral') && 'text-muted',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-parchment">{toast.title}</p>
              {toast.message && <p className="truncate text-[0.8rem] text-muted">{toast.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="-mr-1 -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-charcoal-800 hover:text-parchment"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
};

/* ──────────────────────────── Pagination ──────────────────────────── */

export const Pagination = ({ page, totalPages, onChange, className }) => {
  if (!totalPages || totalPages <= 1) return null;

  // A compact window around the current page, with the ends always reachable.
  const pages = [];
  const window = 1;

  for (let index = 1; index <= totalPages; index += 1) {
    const nearCurrent = Math.abs(index - page) <= window;
    const isEdge = index === 1 || index === totalPages;
    if (nearCurrent || isEdge) pages.push(index);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <nav className={clsx('flex items-center justify-center gap-1.5', className)} aria-label="Pagination">
      <Button variant="ghost" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        Previous
      </Button>

      <div className="flex items-center gap-1">
        {pages.map((entry, index) =>
          entry === '…' ? (
            <span key={`gap-${index}`} className="px-1.5 text-muted" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={clsx(
                'h-9 min-w-9 rounded-full px-2.5 text-sm transition-colors',
                entry === page
                  ? 'bg-lime-300 font-medium text-charcoal-950'
                  : 'text-muted hover:bg-charcoal-800 hover:text-parchment',
              )}
            >
              {entry}
            </button>
          ),
        )}
      </div>

      <Button variant="ghost" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        Next
      </Button>
    </nav>
  );
};

/* ──────────────────────────── Stars ──────────────────────────── */

export const Stars = ({ value = 0, count, size = 'sm', className }) => {
  const dimension = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5';

  return (
    <span className={clsx('inline-flex items-center gap-1', className)}>
      <span className="flex" role="img" aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={clsx(dimension, star <= Math.round(value) ? 'fill-lime-300 text-lime-300' : 'text-charcoal-600')}
            aria-hidden="true"
          />
        ))}
      </span>
      {count != null && <span className="text-[0.75rem] text-muted">({count})</span>}
    </span>
  );
};

export const RatingInput = ({ value, onChange, className }) => (
  <div className={clsx('flex items-center gap-1', className)} role="radiogroup" aria-label="Rating">
    {[1, 2, 3, 4, 5].map((star) => (
      <button
        key={star}
        type="button"
        role="radio"
        aria-checked={value === star}
        aria-label={`${star} star${star === 1 ? '' : 's'}`}
        onClick={() => onChange(star)}
        className="rounded p-0.5 transition-transform hover:scale-110"
      >
        <Star
          className={clsx('h-6 w-6', star <= value ? 'fill-lime-300 text-lime-300' : 'text-charcoal-600')}
          aria-hidden="true"
        />
      </button>
    ))}
  </div>
);

/* ──────────────────────────── Misc ──────────────────────────── */

export const StatCard = ({ label, value, sublabel, tone = 'neutral', className }) => (
  <div className={clsx('panel p-5', className)}>
    <p className="eyebrow">{label}</p>
    <p
      className={clsx(
        'mt-2 font-display text-3xl leading-none',
        tone === 'accent' ? 'text-lime-300' : 'text-parchment',
      )}
    >
      {value}
    </p>
    {sublabel && <p className="mt-1.5 text-[0.78rem] text-muted">{sublabel}</p>}
  </div>
);

export const SectionHeader = ({ eyebrow, title, description, action, className }) => (
  <div className={clsx('flex flex-wrap items-end justify-between gap-4', className)}>
    <div className="space-y-2">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="text-display-md">{title}</h2>
      {description && <p className="lede max-w-2xl">{description}</p>}
    </div>
    {action}
  </div>
);

export const Divider = ({ className }) => <hr className={clsx('rule my-10', className)} />;
