'use client';

import { cn } from '@/lib/cn';

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** The platform switch: 51x31 at iOS proportions, accent when on. */
export function Toggle({ checked, onChange, label, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        'disabled:pointer-events-none disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-fill-3',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[2px] size-[27px] rounded-full bg-white',
          'shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left] duration-200 ease-out',
        )}
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}
