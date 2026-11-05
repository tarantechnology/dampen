'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'accent' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-lg';

const VARIANTS: Record<ButtonVariant, string> = {
  solid:
    'bg-white/[0.07] text-ink border border-white/10 hover:bg-white/[0.12] active:bg-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]',
  outline: 'border border-line-strong text-ink-2 hover:text-ink hover:border-white/25',
  ghost: 'text-ink-2 hover:text-ink hover:bg-white/[0.06]',
  accent:
    'text-ground font-semibold border border-transparent hover:brightness-110 active:brightness-95',
  danger: 'border border-danger/40 text-danger hover:bg-danger/12',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[14px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-xl',
  'icon-lg': 'h-12 w-12 rounded-2xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a lit ring — used for shuffle/repeat/bypass "engaged" states. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', size = 'md', active = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-medium',
        'transition-[background-color,color,border-color,filter,box-shadow] duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        active && 'text-accent border-accent/45 bg-accent/10',
        className,
      )}
      style={variant === 'accent' ? { background: 'var(--accent)' } : undefined}
      {...rest}
    />
  );
});

/** Transport-style round button. Bigger hit target than it looks. */
export const RoundButton = forwardRef<HTMLButtonElement, ButtonProps & { diameter?: number }>(
  function RoundButton({ className, diameter = 44, style, type = 'button', active, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-active={active || undefined}
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center rounded-full',
          'border border-white/10 bg-white/[0.06] text-ink',
          'transition-[background-color,border-color,transform] duration-150',
          'hover:bg-white/[0.12] hover:border-white/20 active:scale-[0.94]',
          'disabled:pointer-events-none disabled:opacity-35',
          // Invisible padding so phone taps land even on the 36px variants.
          'after:absolute after:-inset-1.5 after:content-[""]',
          active && 'text-accent border-accent/50 bg-accent/12',
          className,
        )}
        style={{ width: diameter, height: diameter, ...style }}
        {...rest}
      />
    );
  },
);
