'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'filled' | 'tinted' | 'plain';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  /* The one high-emphasis button on any given screen. */
  filled: 'bg-t1 text-invert hover:opacity-85',
  /* Everything else: a fill, never an outline. */
  tinted: 'bg-fill-1 text-t1 hover:bg-fill-2',
  plain: 'text-t2 hover:text-t1 hover:bg-fill-1',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-[9px] px-3 text-[13px]',
  md: 'h-10 rounded-[11px] px-4 text-[14px]',
};

export function Button({
  variant = 'tinted',
  size = 'md',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 font-medium',
        'transition-[background-color,color,opacity] duration-150',
        'disabled:pointer-events-none disabled:opacity-35',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Always required — these buttons never carry visible text. */
  label: string;
  children: ReactNode;
  /** Renders as pressed: a tinted fill and full-strength glyph. */
  active?: boolean;
}

export function IconButton({
  label,
  active = false,
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full',
        'transition-[background-color,color,opacity] duration-150',
        'disabled:pointer-events-none disabled:opacity-30',
        active ? 'bg-fill-2 text-t1' : 'text-t2 hover:bg-fill-1 hover:text-t1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
