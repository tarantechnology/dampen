'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { clamp } from '@/components/ui/accent';

export interface DampenSliderProps {
  /** 0..1. */
  value: number;
  onChange(value: number): void;
  disabled?: boolean;
  className?: string;
}

/* Bouncy on release, nothing while dragging. */
const SETTLE = 'width 420ms cubic-bezier(0.34, 1.32, 0.44, 1)';

/**
 * The one hero control.
 *
 * Built like Control Center's brightness slider: the whole body is the
 * target, the fill runs from the left edge, and there is no thumb to hunt
 * for. Tracking is 1:1 under the pointer and springs on release.
 *
 * The word "Dampen" and the percentage are each rendered twice — once in the
 * foreground colour, once in the ink that reads on the accent — with the
 * second copy clipped to exactly the filled region. That is why the label
 * stays legible at every value without a blend mode or a drop shadow.
 */
export function DampenSlider({
  value,
  onChange,
  disabled = false,
  className,
}: DampenSliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(0);
  const reduce = useReducedMotion();

  /* The clipped copy needs the control's full width to lay out identically. */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown = clamp(dragValue ?? value, 0, 1);
  const percent = Math.round(shown * 100);

  const commit = useCallback(
    (next: number) => {
      const v = clamp(next, 0, 1);
      setDragValue(v);
      onChange(v);
    },
    [onChange],
  );

  const fromClientX = useCallback((clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  /* ---- pointer ---- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    rootRef.current?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    commit(fromClientX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commit(fromClientX(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    setDragValue(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /* ---- wheel ----
     React's own wheel listener is passive, so preventDefault there warns and
     the page scrolls anyway. Bind it natively instead. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX) * 0.0022;
      const current = clamp(value, 0, 1);
      const next = clamp(current + delta, 0, 1);
      if (next !== current) onChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [value, onChange, disabled]);

  /* ---- keyboard ---- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const fine = e.shiftKey ? 0.01 : 0.05;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + fine;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - fine;
        break;
      case 'PageUp':
        next = value + 0.1;
        break;
      case 'PageDown':
        next = value - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(next, 0, 1));
  };

  const readoutVisible = dragging || focused;

  const content = (ink: string) => (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-between px-[18px]"
      style={{ width: width || undefined }}
    >
      <span className={cn('text-[14px] font-medium tracking-[-0.01em]', ink)}>
        Dampen
      </span>
      <span
        className={cn(
          'num text-[14px] font-medium tabular-nums transition-opacity duration-200',
          ink,
          readoutVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {percent}%
      </span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      role="slider"
      aria-label="Dampen amount"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent} percent`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onDoubleClick={() => {
        if (!disabled) onChange(0);
      }}
      className={cn(
        'relative h-[58px] w-full touch-none select-none overflow-hidden rounded-[18px] bg-fill-2',
        'sm:h-[60px]',
        disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer',
        className,
      )}
    >
      {content('text-t1')}

      <div
        aria-hidden
        className="absolute inset-y-0 left-0 overflow-hidden bg-accent"
        style={{
          width: `${shown * 100}%`,
          transition: dragging || reduce ? 'none' : SETTLE,
        }}
      >
        {content('text-accent-ink')}
      </div>
    </div>
  );
}
