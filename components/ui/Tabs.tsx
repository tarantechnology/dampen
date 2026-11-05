'use client';

import { useId, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small count chip on the right of the label. */
  count?: number;
}

export interface TabsProps<T extends string> {
  label: string;
  value: T;
  items: ReadonlyArray<TabItem<T>>;
  onChange(value: T): void;
  /** `segmented` for a pill group, `underline` for a wide bar. */
  variant?: 'segmented' | 'underline';
  className?: string;
}

/**
 * Tablist with proper roving tabindex — only the selected tab is in the tab
 * order, and Left/Right move between them. The selected indicator is a shared
 * layout element so it slides rather than blinking.
 */
export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
  variant = 'segmented',
  className,
}: TabsProps<T>) {
  const uid = useId();
  const reduce = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, dir: 1 | -1) => {
    const next = (from + dir + items.length) % items.length;
    onChange(items[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        onChange(items[0].value);
        refs.current[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        onChange(items[items.length - 1].value);
        refs.current[items.length - 1]?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        'flex items-center',
        variant === 'segmented'
          ? 'gap-1 rounded-xl border border-line bg-white/[0.035] p-1'
          : 'gap-1 border-b border-line',
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${uid}-tab-${item.value}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[12.5px] font-medium transition-colors',
              variant === 'segmented' ? 'h-7 rounded-lg' : 'h-9',
              selected ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`${uid}-indicator`}
                aria-hidden
                className={cn(
                  'absolute',
                  variant === 'segmented'
                    ? 'inset-0 rounded-lg border border-white/12 bg-white/[0.09]'
                    : 'inset-x-1 bottom-0 h-[2px] rounded-full',
                )}
                style={
                  variant === 'underline' ? { background: 'var(--accent)' } : undefined
                }
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 540, damping: 38, mass: 0.6 }
                }
              />
            ) : null}
            <span className="relative flex items-center gap-1.5">
              {item.icon}
              {item.label}
              {typeof item.count === 'number' ? (
                <span className="num text-[10.5px] text-ink-4">{item.count}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
