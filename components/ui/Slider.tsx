'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { clamp } from './accent';
import {
  linearToPosition,
  logToPosition,
  positionToLinear,
  positionToLog,
  quantize,
} from './format';

export type SliderScale = 'linear' | 'log';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: SliderScale;
  /** Fill out from the centre — for anything that can be negative. */
  bipolar?: boolean;
  label: string;
  /** Spoken instead of the raw number: "1.24 kHz" rather than "1240". */
  valueText?: string;
  onChange(value: number): void;
  disabled?: boolean;
  className?: string;
}

/**
 * The thin linear slider used for volume and for every advanced parameter.
 *
 * Deliberately *not* the Dampen control: that one is the hero and lives in
 * `components/dampen/DampenSlider.tsx`. This one is 4px tall, has no visible
 * thumb until you touch it, and is meant to disappear into a settings row.
 */
export function Slider({
  value,
  min,
  max,
  step = 0,
  scale = 'linear',
  bipolar = false,
  label,
  valueText,
  onChange,
  disabled = false,
  className,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const toPosition = useCallback(
    (v: number) =>
      scale === 'log' ? logToPosition(v, min, max) : linearToPosition(v, min, max),
    [scale, min, max],
  );

  const fromPosition = useCallback(
    (p: number) => {
      const raw =
        scale === 'log' ? positionToLog(p, min, max) : positionToLinear(p, min, max);
      return clamp(step ? quantize(raw, step) : raw, min, max);
    },
    [scale, min, max, step],
  );

  const position = toPosition(value);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      onChange(fromPosition(clamp((clientX - rect.left) / rect.width, 0, 1)));
    },
    [fromPosition, onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setFromClientX(e.clientX);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const nudge = (deltaPositions: number) => {
    onChange(fromPosition(clamp(position + deltaPositions, 0, 1)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const coarse = e.shiftKey ? 0.1 : 0.02;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        nudge(coarse);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        nudge(-coarse);
        break;
      case 'Home':
        e.preventDefault();
        onChange(min);
        break;
      case 'End':
        e.preventDefault();
        onChange(max);
        break;
      default:
        break;
    }
  };

  const fillLeft = bipolar ? Math.min(position, 0.5) : 0;
  const fillWidth = bipolar ? Math.abs(position - 0.5) : position;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(4))}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-7 w-full touch-none items-center',
        disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer',
        className,
      )}
    >
      <div className="relative h-1 w-full rounded-full bg-fill-2">
        <div
          className="absolute inset-y-0 rounded-full bg-accent"
          style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }}
        />
        <div
          className={cn(
            'absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent',
            'shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-opacity duration-150',
            dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100',
          )}
          style={{ left: `${position * 100}%` }}
        />
      </div>
    </div>
  );
}
