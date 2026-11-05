'use client';

import { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ *
 * Panel — the base surface. Everything in the console sits on one.
 * ------------------------------------------------------------------ */

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small tracked-caps heading in the panel's top-left. */
  title?: string;
  /** Right-aligned controls in the title row. */
  actions?: React.ReactNode;
  /** Removes the inner padding, for lists that manage their own. */
  flush?: boolean;
  as?: 'div' | 'section' | 'aside';
}

export function Panel({
  title,
  actions,
  flush = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag className={cn('panel rounded-panel', className)} {...rest}>
      {title || actions ? (
        <div
          className={cn(
            'flex min-h-11 items-center justify-between gap-3 border-b border-line px-4',
          )}
        >
          {title ? <h2 className="legend">{title}</h2> : <span />}
          {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Disclosure — the "advanced" reveal.
 * ------------------------------------------------------------------ */

export interface DisclosureProps {
  label: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Right-aligned summary text, visible when collapsed. */
  summary?: string;
  children: React.ReactNode;
  className?: string;
}

export function Disclosure({
  label,
  open,
  onOpenChange,
  summary,
  children,
  className,
}: DisclosureProps) {
  const uid = useId();
  const reduce = useReducedMotion();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={uid}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5',
          'text-left transition-colors hover:bg-white/[0.05]',
        )}
      >
        <span className="flex items-center gap-2">
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 0 : -90 }}
            initial={false}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex"
          >
            <ChevronDown className="size-4 text-ink-3" />
          </motion.span>
          <span className="text-[13px] font-medium text-ink">{label}</span>
        </span>
        {summary && !open ? (
          <span className="num truncate text-[11px] text-ink-4">{summary}</span>
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={uid}
            key="body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-1">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sheet — a modal overlay. Used for the device picker, the capture
 * setup help and the shortcut reference.
 * ------------------------------------------------------------------ */

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  /** One line under the title. */
  description?: string;
  /** `center` for reference content, `bottom` for pickers on a phone. */
  placement?: 'center' | 'bottom';
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  placement = 'center',
  children,
  className,
}: SheetProps) {
  const uid = useId();
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;
    cardRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: the sheet is modal, so Tab must not escape behind it.
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn(
            'fixed inset-0 z-50 flex p-4',
            placement === 'center' ? 'items-center justify-center' : 'items-end justify-center',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.16 }}
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-title`}
            aria-describedby={description ? `${uid}-desc` : undefined}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: placement === 'bottom' ? 24 : 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: placement === 'bottom' ? 24 : 12, scale: 0.98 }}
            transition={
              reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }
            }
            className={cn(
              'panel relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-panel outline-none',
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={`${uid}-title`} className="text-[15px] font-semibold text-ink">
                  {title}
                </h2>
                {description ? (
                  <p id={`${uid}-desc`} className="mt-1 text-[12px] leading-relaxed text-ink-3">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-1 rounded-lg p-1 text-ink-3 transition-colors hover:bg-white/[0.08] hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
