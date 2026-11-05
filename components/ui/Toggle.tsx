'use client';

import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

export interface ToggleProps {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  /** Second line, for the things that need explaining. */
  description?: string;
  /** Keyboard hint badge shown on the right, e.g. "B". */
  shortcut?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  /** Lights the track in the accent when on. Off = neutral white. */
  tone?: 'accent' | 'neutral';
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  shortcut,
  hideLabel = false,
  tone = 'accent',
  size = 'md',
  disabled = false,
  className,
}: ToggleProps) {
  const uid = useId();
  const reduce = useReducedMotion();
  const w = size === 'sm' ? 34 : 44;
  const h = size === 'sm' ? 20 : 26;
  const knob = h - 6;

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      {!hideLabel ? (
        <div className="min-w-0">
          <label htmlFor={uid} className="block text-[13px] font-medium text-ink">
            {label}
          </label>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{description}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-2">
        {shortcut ? (
          <kbd className="num rounded-md border border-line bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
            {shortcut}
          </kbd>
        ) : null}
        <button
          id={uid}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={hideLabel ? label : undefined}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative shrink-0 rounded-full border transition-colors duration-150',
            'disabled:pointer-events-none disabled:opacity-40',
            checked
              ? tone === 'accent'
                ? 'border-accent/50'
                : 'border-white/35 bg-white/25'
              : 'border-white/12 bg-white/[0.06] hover:bg-white/[0.1]',
          )}
          style={{
            width: w,
            height: h,
            background: checked && tone === 'accent' ? 'var(--accent-wash)' : undefined,
            boxShadow: checked && tone === 'accent' ? '0 0 16px -4px var(--accent-glow)' : undefined,
          }}
        >
          <motion.span
            aria-hidden
            className="absolute top-1/2 block rounded-full"
            style={{
              width: knob,
              height: knob,
              y: '-50%',
              background: checked && tone === 'accent' ? 'var(--accent)' : 'var(--ink-2)',
            }}
            initial={false}
            animate={{ left: checked ? w - knob - 3 : 3 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: 'spring', stiffness: 620, damping: 34, mass: 0.5 }
            }
          />
        </button>
      </div>
    </div>
  );
}
