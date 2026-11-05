'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange(value: T): void;
  label: string;
  className?: string;
}

/**
 * The iOS segmented control: a single recessed track with one raised slug.
 * Used for input mode and for the theme choice — the only two places where a
 * handful of mutually exclusive options need to be visible at once.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  const id = useId();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'relative grid gap-0.5 rounded-[10px] bg-fill-1 p-0.5',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 h-8 min-w-0 truncate rounded-[8px] px-2.5 text-[13px] font-medium',
              'transition-colors duration-150',
              selected
                ? 'bg-raised text-t1 shadow-[0_1px_3px_rgba(0,0,0,0.16)]'
                : 'text-t2 hover:text-t1',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
