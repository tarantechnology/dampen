'use client';

import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

const SIDE: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const OFFSET: Record<TooltipSide, { x?: number; y?: number }> = {
  top: { y: 4 },
  bottom: { y: -4 },
  left: { x: 4 },
  right: { x: -4 },
};

export interface TooltipProps {
  label: string;
  /** Optional keyboard shortcut rendered as a kbd chip. */
  shortcut?: string;
  side?: TooltipSide;
  children: React.ReactNode;
  className?: string;
}

/**
 * Hover/focus tooltip. Wraps its child in an inline-flex anchor and wires
 * `aria-describedby`, so the text is announced rather than merely drawn.
 */
export function Tooltip({ label, shortcut, side = 'top', children, className }: TooltipProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
      aria-describedby={open ? uid : undefined}
    >
      {children}
      <AnimatePresence>
        {open ? (
          <motion.span
            id={uid}
            role="tooltip"
            className={cn(
              'pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap',
              'rounded-lg border border-line-strong bg-raised/95 px-2 py-1 text-[11px] text-ink',
              'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)] backdrop-blur-sm',
              SIDE[side],
            )}
            initial={reduce ? { opacity: 0 } : { opacity: 0, ...OFFSET[side] }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, ...OFFSET[side] }}
            transition={reduce ? { duration: 0 } : { duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            {label}
            {shortcut ? (
              <kbd className="num rounded border border-line bg-white/[0.07] px-1 text-[10px] font-semibold text-ink-3">
                {shortcut}
              </kbd>
            ) : null}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
