'use client';

import { ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange(value: string): void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A native `<select>` with the chrome removed.
 *
 * Native means the platform's own picker — the one the user already knows,
 * already keyboard-navigable, and correct on a phone. A hand-rolled listbox
 * would be more code and worse.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  placeholder,
  disabled = false,
  className,
}: SelectProps) {
  const empty = options.length === 0;
  return (
    <div className={cn('relative inline-flex min-w-0 items-center', className)}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled || empty}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-w-0 max-w-full appearance-none truncate bg-transparent py-1 pr-5 text-right',
          'text-[15px] text-t2 outline-none',
          'disabled:opacity-50',
        )}
      >
        {empty ? <option value="">{placeholder ?? 'None available'}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        size={14}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute right-0 text-t3"
      />
    </div>
  );
}
