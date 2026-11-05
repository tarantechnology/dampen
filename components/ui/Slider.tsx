'use client';

import { memo, useCallback, useId, useRef } from 'react';
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
  label: string;
  value: number;
  min: number;
  max: number;
  /** Increment in *value* space for linear sliders. Ignored for log. */
  step?: number;
  /** `log` makes an octave the same distance everywhere. Use it for all Hz. */
  scale?: SliderScale;
  /** Formats the readout. Must return a fixed-width string. */
  format(value: number): string;
  onChange(value: number): void;
  /** Fill from the centre instead of the left — for +/- dB and tilt. */
  bipolar?: boolean;
  /** Short hint shown under the label on hover/focus. */
  hint?: string;
  /** Drops the label/readout row — for the volume fader in the transport. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

function toPosition(v: number, min: number, max: number, scale: SliderScale): number {
  return scale === 'log' ? logToPosition(v, min, max) : linearToPosition(v, min, max);
}

function fromPosition(p: number, min: number, max: number, scale: SliderScale): number {
  return scale === 'log' ? positionToLog(p, min, max) : positionToLinear(p, min, max);
}

/**
 * A labelled horizontal slider with a tabular readout.
 *
 * Shift-drag divides the travel by four for fine adjustment. Frequency
 * controls pass `scale="log"` so 20 Hz -> 20 kHz spreads evenly instead of
 * cramming everything audible into the first few pixels.
 */
export const Slider = memo(function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  scale = 'linear',
  format,
  onChange,
  bipolar = false,
  hint,
  compact = false,
  disabled = false,
  className,
}: SliderProps) {
  const uid = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const grab = useRef<{ id: number; x: number; position: number } | null>(null);

  const position = clamp(toPosition(value, min, max, scale), 0, 1);

  const emit = useCallback(
    (p: number) => {
      const raw = fromPosition(clamp(p, 0, 1), min, max, scale);
      const next = scale === 'log' ? Math.round(raw) : quantize(raw, step);
      onChange(clamp(next, min, max));
    },
    [max, min, onChange, scale, step],
  );

  const positionFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return (clientX - rect.left) / rect.width;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = e.shiftKey ? position : positionFromClientX(e.clientX);
    grab.current = { id: e.pointerId, x: e.clientX, position: p };
    if (!e.shiftKey) emit(p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    e.preventDefault();
    if (e.shiftKey) {
      const rect = trackRef.current?.getBoundingClientRect();
      const width = rect?.width || 1;
      emit(g.position + (e.clientX - g.x) / width / 4);
    } else {
      emit(positionFromClientX(e.clientX));
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (grab.current?.id === e.pointerId) grab.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    // Nudging in *position* space keeps log sliders usable from the keyboard.
    const unit = e.shiftKey ? 0.002 : 0.01;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = position + unit;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = position - unit;
        break;
      case 'PageUp':
        next = position + 0.1;
        break;
      case 'PageDown':
        next = position - 0.1;
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
    emit(next);
  };

  const centre = bipolar ? clamp(toPosition(0, min, max, scale), 0, 1) : 0;
  const fillLeft = bipolar ? Math.min(centre, position) : 0;
  const fillWidth = bipolar ? Math.abs(position - centre) : position;

  return (
    <div className={cn('group/slider', disabled && 'opacity-45', className)}>
      {compact ? null : (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label htmlFor={uid} className="legend truncate">
            {label}
          </label>
          <span className="num text-[12px] font-medium tabular-nums text-ink-2">
            {format(value)}
          </span>
        </div>
      )}

      <div
        id={uid}
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={format(value)}
        aria-orientation="horizontal"
        aria-disabled={disabled || undefined}
        aria-describedby={hint ? `${uid}-hint` : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'relative flex h-6 items-center rounded-md outline-offset-4',
          disabled ? 'cursor-not-allowed' : 'cursor-ew-resize',
        )}
        style={{ touchAction: 'none' }}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.04]">
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${fillLeft * 100}%`,
              width: `${fillWidth * 100}%`,
              background: 'linear-gradient(90deg, var(--accent-hot), var(--accent))',
            }}
          />
          {bipolar ? (
            <div
              className="absolute inset-y-0 w-px bg-white/25"
              style={{ left: `${centre * 100}%` }}
            />
          ) : null}
        </div>

        {/* Thumb. A flat bar, not a ball — reads as a fader cap. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-4 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-white/25 bg-raised shadow-[0_1px_3px_rgba(0,0,0,0.6)] transition-[box-shadow] group-hover/slider:border-white/40"
          style={{
            left: `${position * 100}%`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 10px -2px var(--accent-glow)',
          }}
        />
      </div>

      {hint ? (
        <p
          id={`${uid}-hint`}
          className="mt-1 text-[11px] leading-snug text-ink-4 opacity-0 transition-opacity group-focus-within/slider:opacity-100 group-hover/slider:opacity-100"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
});
