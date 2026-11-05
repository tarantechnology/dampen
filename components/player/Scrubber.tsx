'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { clamp } from '@/components/ui/accent';
import { formatTime } from '@/components/ui/format';

export interface ScrubberProps {
  /** Last known position, ms. Interpolated forward while playing. */
  position: number;
  durationMs: number;
  isPlaying: boolean;
  onSeek(ms: number): void;
  disabled?: boolean;
  className?: string;
}

/**
 * The seek bar.
 *
 * Spotify reports position roughly once a second, so the bar interpolates
 * forward from the last report inside a rAF loop and writes the result
 * straight to the DOM. Nothing here goes through React state at frame rate —
 * which is also why the elapsed/remaining readouts can update 60 times a
 * second without the rest of the player noticing.
 *
 * Hovering shows the time under the cursor; dragging previews the target and
 * only commits the seek on release.
 */
export function Scrubber({
  position,
  durationMs,
  isPlaying,
  onSeek,
  disabled = false,
  className,
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const remainingRef = useRef<HTMLSpanElement | null>(null);

  const base = useRef({ ms: position, at: 0 });
  const dragging = useRef<{ id: number; ms: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);

  const paint = useCallback(
    (ms: number) => {
      const pct = durationMs > 0 ? clamp(ms / durationMs, 0, 1) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
      if (elapsedRef.current) elapsedRef.current.textContent = formatTime(ms);
      if (remainingRef.current) remainingRef.current.textContent = formatTime(ms - durationMs);
      trackRef.current?.setAttribute('aria-valuenow', Math.round(ms).toString());
      trackRef.current?.setAttribute(
        'aria-valuetext',
        `${formatTime(ms)} of ${formatTime(durationMs)}`,
      );
    },
    [durationMs],
  );

  // Re-anchor whenever Spotify reports a new position.
  useEffect(() => {
    base.current = { ms: position, at: performance.now() };
    if (!dragging.current) paint(position);
  }, [position, paint]);

  useEffect(() => {
    if (!isPlaying) {
      paint(base.current.ms);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (!dragging.current) {
        const ms = clamp(base.current.ms + (performance.now() - base.current.at), 0, durationMs);
        paint(ms);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, durationMs, paint]);

  const msAtClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || durationMs <= 0 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ms = msAtClientX(e.clientX);
    dragging.current = { id: e.pointerId, ms };
    setDragMs(ms);
    paint(ms);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) {
      const ms = msAtClientX(e.clientX);
      setHover({ x: clamp(e.clientX - rect.left, 0, rect.width), ms });
    }
    const d = dragging.current;
    if (!d || d.id !== e.pointerId) return;
    const ms = msAtClientX(e.clientX);
    d.ms = ms;
    setDragMs(ms);
    paint(ms);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d || d.id !== e.pointerId) return;
    dragging.current = null;
    setDragMs(null);
    base.current = { ms: d.ms, at: performance.now() };
    onSeek(Math.round(d.ms));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || durationMs <= 0) return;
    const step = e.shiftKey ? 30_000 : 5_000;
    const from = base.current.ms;
    let target: number | null = null;
    if (e.key === 'ArrowLeft') target = from - step;
    else if (e.key === 'ArrowRight') target = from + step;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = durationMs;
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    const ms = clamp(target, 0, durationMs);
    base.current = { ms, at: performance.now() };
    paint(ms);
    onSeek(Math.round(ms));
  };

  const previewMs = dragMs ?? hover?.ms ?? null;

  return (
    <div className={cn('group/scrub', className)}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(durationMs))}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatTime(position)} of ${formatTime(durationMs)}`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        className={cn(
          'relative flex h-5 items-center rounded-md outline-offset-4',
          disabled ? 'cursor-default' : 'cursor-pointer',
        )}
        style={{ touchAction: 'none' }}
      >
        <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-white/[0.09]">
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: '0%',
              background: 'linear-gradient(90deg, var(--accent-hot), var(--accent))',
            }}
          />
        </div>
        <div
          ref={thumbRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full',
            'bg-ink opacity-0 transition-opacity duration-150',
            !disabled && 'group-hover/scrub:opacity-100 group-focus-within/scrub:opacity-100',
            dragMs !== null && 'opacity-100',
          )}
          style={{ left: '0%', boxShadow: '0 0 12px -2px var(--accent-glow)' }}
        />

        {/* Hover/drag time preview. */}
        {previewMs !== null && !disabled ? (
          <span
            aria-hidden
            className="num pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border border-line-strong bg-raised/95 px-1.5 py-0.5 text-[11px] text-ink shadow-lg"
            style={{
              left:
                dragMs !== null && durationMs > 0
                  ? `${clamp(dragMs / durationMs, 0, 1) * 100}%`
                  : `${hover?.x ?? 0}px`,
            }}
          >
            {formatTime(previewMs)}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span ref={elapsedRef} className="num text-[11px] tabular-nums text-ink-3">
          {formatTime(position)}
        </span>
        <span ref={remainingRef} className="num text-[11px] tabular-nums text-ink-4">
          {formatTime(position - durationMs)}
        </span>
      </div>
    </div>
  );
}
