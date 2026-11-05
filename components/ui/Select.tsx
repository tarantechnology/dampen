'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Right-aligned secondary text in the list. */
  meta?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange(value: T): void;
  /** Hide the visible label (still read out). */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A listbox. Native `<select>` cannot be styled to match the rest of the
 * console, so this is the real thing: roving focus with Up/Down, Home/End,
 * Enter/Space to commit, Escape to cancel, click-outside to dismiss.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
  disabled = false,
  className,
}: SelectProps<T>) {
  const uid = useId();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
      listRef.current?.focus();
    }
  }, [open, options, value]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setCursor((c) => Math.min(options.length - 1, c + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        break;
      case 'Home':
        e.preventDefault();
        setCursor(0);
        break;
      case 'End':
        e.preventDefault();
        setCursor(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(cursor);
        break;
      case 'Escape':
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
    e.stopPropagation();
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {!hideLabel ? (
        <span id={`${uid}-label`} className="legend mb-1.5 block">
          {label}
        </span>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={hideLabel ? undefined : `${uid}-label`}
        aria-label={hideLabel ? label : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-line',
          'bg-white/[0.045] px-3 text-[13px] text-ink transition-colors',
          'hover:border-white/20 hover:bg-white/[0.08]',
          'disabled:pointer-events-none disabled:opacity-40',
          open && 'border-accent/50',
        )}
      >
        <span className="truncate">{selected?.label ?? '—'}</span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-ink-3" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={hideLabel ? undefined : `${uid}-label`}
            aria-activedescendant={`${uid}-opt-${cursor}`}
            onKeyDown={onListKeyDown}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
            transition={
              reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34, mass: 0.5 }
            }
            className={cn(
              'scroll-slim absolute z-40 mt-1.5 max-h-60 w-full origin-top overflow-y-auto',
              'rounded-xl border border-line-strong bg-raised/95 p-1 backdrop-blur-md',
              'shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] outline-none',
            )}
          >
            {options.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setCursor(i)}
                  onClick={() => commit(i)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[13px]',
                    i === cursor ? 'bg-white/[0.09] text-ink' : 'text-ink-2',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Check
                      aria-hidden
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected ? 'text-accent' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </span>
                  {option.meta ? (
                    <span className="num shrink-0 text-[11px] text-ink-4">{option.meta}</span>
                  ) : null}
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
