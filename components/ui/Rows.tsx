'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * iOS Settings-style grouped rows.
 *
 * One rounded container per group, a hairline between rows *inside* it, and
 * nothing around any individual row. Label on the left, value or control on
 * the right. This is the only layout used anywhere in the settings sheet —
 * a grid of bordered cards is what the old design did, and it read as an
 * admin dashboard.
 */

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-[13px] font-medium text-t2">{children}</h3>
  );
}

/** The one-line explanation that sits *below* a group, never inside it. */
export function GroupNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 px-1 text-[12.5px] leading-[1.45] text-t3">{children}</p>
  );
}

export function Group({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[14px] bg-fill-1',
        '[&>*+*]:border-t [&>*+*]:border-hairline',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface RowProps {
  label: ReactNode;
  /** Sits under the label, one line, quiet. */
  detail?: ReactNode;
  /** The control or value on the right. */
  trailing?: ReactNode;
  /** Stack the trailing content under the label — for sliders. */
  stacked?: boolean;
  className?: string;
}

export function Row({ label, detail, trailing, stacked, className }: RowProps) {
  return (
    <div
      className={cn(
        'flex min-h-[44px] gap-3 px-3.5 py-2.5',
        stacked ? 'flex-col justify-center' : 'items-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col justify-center',
          stacked ? 'w-full' : 'flex-1',
        )}
      >
        <span className="truncate text-[15px] text-t1">{label}</span>
        {detail ? (
          <span className="mt-0.5 text-[12.5px] leading-snug text-t3">{detail}</span>
        ) : null}
      </div>
      {trailing ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 text-[15px] text-t2',
            stacked && 'w-full',
          )}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

export interface RowButtonProps {
  label: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  onClick(): void;
  disabled?: boolean;
  /** A right chevron, for rows that open something. */
  chevron?: boolean;
  /** Destructive or primary actions centre their label, iOS-style. */
  tone?: 'default' | 'action' | 'danger';
}

export function RowButton({
  label,
  detail,
  value,
  onClick,
  disabled,
  chevron,
  tone = 'default',
}: RowButtonProps) {
  const centred = tone !== 'default';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 px-3.5 py-2.5 text-left',
        'transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2',
        'disabled:pointer-events-none disabled:opacity-40',
        centred && 'justify-center',
      )}
    >
      <span className={cn('flex min-w-0 flex-col', !centred && 'flex-1')}>
        <span
          className={cn(
            'truncate text-[15px]',
            tone === 'danger' ? 'text-danger' : tone === 'action' ? 'text-accent' : 'text-t1',
          )}
        >
          {label}
        </span>
        {detail ? (
          <span className="mt-0.5 text-[12.5px] leading-snug text-t3">{detail}</span>
        ) : null}
      </span>
      {value ? (
        <span className="shrink-0 truncate text-[15px] text-t3">{value}</span>
      ) : null}
      {chevron ? (
        <ChevronRight size={16} className="shrink-0 text-t3" strokeWidth={2} />
      ) : null}
    </button>
  );
}
