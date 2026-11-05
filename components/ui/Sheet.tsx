'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

/* There is no document to portal into on the server. */
const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  /** Which edge it comes from. Settings slide in from the right. */
  side?: 'left' | 'right';
  /** Max width at desktop. Full-bleed below 520px either way. */
  width?: number;
  /** Replaces the body's default padding — for full-bleed contents. */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * A sheet, not a modal dialog box.
 *
 * Everything secondary in Dampen lives in one of these: it slides in from an
 * edge, dims what is behind it, closes on Escape or on the scrim, and gives
 * focus to its close button so the keyboard path in and out is obvious.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = 'right',
  width = 420,
  bodyClassName,
  children,
}: SheetProps) {
  const mounted = useSyncExternalStore(subscribeNever, onClient, onServer);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus in once the panel exists, so the keyboard path is obvious.
    const raf = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button:not([disabled])')
        ?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the sheet: it is the whole interface while open.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const offset = side === 'right' ? '100%' : '-100%';
  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { x: offset },
        animate: { x: 0 },
        exit: { x: offset },
      };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex" role="presentation">
          <motion.button
            type="button"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 cursor-default bg-[var(--scrim)] backdrop-blur-[2px]"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            {...slide}
            transition={
              reduce
                ? { duration: 0.12 }
                : { type: 'spring', stiffness: 420, damping: 42, mass: 0.9 }
            }
            style={{ maxWidth: width }}
            className={cn(
              'relative z-10 flex h-full w-full flex-col bg-bg',
              side === 'right' ? 'ml-auto' : 'mr-auto',
            )}
          >
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
              <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]">
                {title}
              </h2>
              <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
                <X size={18} strokeWidth={2} />
              </IconButton>
            </header>

            <div
              className={cn(
                'scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain',
                bodyClassName ?? 'px-4 pb-10',
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
