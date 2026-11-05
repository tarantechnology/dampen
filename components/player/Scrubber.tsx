'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { clamp } from '@/components/ui/accent';
import { formatTime } from '@/components/ui/format';

export interface ScrubberProps {
  /** Milliseconds. */
  position: number;
  durationMs: number;
  onSeek(ms: number): void;
  disabled?: boolean;
  className?: string;
}

/**
 * Elapsed, a hairline track, and time remaining.
 *
 * While you drag, the readouts follow the pointer rather than the stream, so
 * the number under your finger is the number you are about to land on.
 */
export function Scrubber({
  position,
  durationMs,
  onSeek,
  disabled = false,
  className,
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const usable = durationMs > 0 && !disabled;
  const shown = clamp(scrubMs ?? position, 0, Math.max(durationMs, 1));
  const fraction = durationMs > 0 ? shown / durationMs : 0;

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs;
    },
    [durationMs],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setScrubMs(msFromClientX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setScrubMs(msFromClientX(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (scrubMs !== null) onSeek(Math.round(scrubMs));
    setScrubMs(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!usable) return;
    const step = e.shiftKey ? 30_000 : 5_000;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = position + step;
    else if (e.key === 'ArrowLeft') next = position - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = durationMs;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(Math.round(clamp(next, 0, durationMs)));
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(shown / 1000)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(durationMs)}`}
        aria-disabled={!usable || undefined}
        tabIndex={usable ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative flex h-5 w-full touch-none items-center',
          usable ? 'cursor-pointer' : 'pointer-events-none opacity-50',
        )}
      >
        <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-fill-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--text-2)]"
            style={{
              width: `${fraction * 100}%`,
              transition: dragging ? 'none' : 'width 220ms linear',
            }}
          />
        </div>
        <div
          aria-hidden
          className={cn(
            'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-t1',
            'shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-opacity duration-150',
            dragging
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
          style={{ left: `${fraction * 100}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="num text-[11.5px] text-t3">{formatTime(shown)}</span>
        <span className="num text-[11.5px] text-t3">
          {durationMs > 0 ? formatTime(shown - durationMs) : '--:--'}
        </span>
      </div>
    </div>
  );
}
