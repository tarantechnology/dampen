'use client';

import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { EngineMeters } from '@/lib/types';
import { cn } from '@/lib/cn';
import { clamp } from '@/components/ui/accent';
import { dbToMeter } from '@/components/ui/format';

const FLOOR = -60;
/** dB per second the bar is allowed to fall. Rises are instantaneous. */
const DECAY_DB_PER_S = 72;
/** How long a peak marker sits before it starts sliding down. */
const PEAK_HOLD_MS = 1100;
const PEAK_FALL_DB_PER_S = 24;

export interface LevelBarHandle {
  /** dBFS level and dBFS peak-hold position. */
  set(db: number, peakDb: number): void;
}

export interface LevelBarProps {
  label: string;
  /** Visual weight. `lead` is the taller input bar in the capture panel. */
  size?: 'lead' | 'row';
  /** Static readout to the right of the label. */
  suffix?: React.ReactNode;
  className?: string;
}

/**
 * One level bar. Driven entirely through its imperative `set()` — no props
 * change, no React render, ever. Whoever owns the rAF loop calls it.
 */
export const LevelBar = forwardRef<LevelBarHandle, LevelBarProps>(function LevelBar(
  { label, size = 'row', suffix, className },
  ref,
) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      set(db: number, peakDb: number) {
        if (fillRef.current) {
          fillRef.current.style.transform = `scaleX(${dbToMeter(db, FLOOR).toFixed(4)})`;
        }
        if (peakRef.current) {
          const p = dbToMeter(peakDb, FLOOR);
          peakRef.current.style.left = `${(p * 100).toFixed(2)}%`;
          peakRef.current.style.opacity = p > 0.01 ? '1' : '0';
        }
        if (valueRef.current) {
          valueRef.current.textContent = db <= FLOOR ? '−∞' : db.toFixed(1);
        }
      },
    }),
    [],
  );

  const height = size === 'lead' ? 'h-3' : 'h-[7px]';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="legend w-8 shrink-0">{label}</span>
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.05]',
          height,
        )}
      >
        <div
          ref={fillRef}
          className="absolute inset-0 origin-left rounded-full"
          style={{
            transform: 'scaleX(0)',
            background:
              'linear-gradient(90deg, var(--accent-hot) 0%, var(--accent) 62%, oklch(0.75 0.19 32) 100%)',
          }}
        />
        <div
          ref={peakRef}
          aria-hidden
          className="absolute inset-y-0 w-[2px] bg-ink/80"
          style={{ left: '0%', opacity: 0 }}
        />
      </div>
      <span className="num w-10 shrink-0 text-right text-[10.5px] tabular-nums text-ink-3">
        <span ref={valueRef}>&minus;&infin;</span>
      </span>
      {suffix}
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * The driver
 * ------------------------------------------------------------------ */

interface Held {
  level: number;
  peak: number;
  peakAt: number;
}

function advance(held: Held, target: number, now: number, dt: number): void {
  if (target >= held.level) held.level = target;
  else held.level = Math.max(target, held.level - DECAY_DB_PER_S * dt);

  if (target >= held.peak) {
    held.peak = target;
    held.peakAt = now;
  } else if (now - held.peakAt > PEAK_HOLD_MS) {
    held.peak = Math.max(target, held.peak - PEAK_FALL_DB_PER_S * dt);
  }
}

export interface MeterBarProps {
  /**
   * Polled inside a rAF loop. Pass a stable function that reads the latest
   * meters out of a ref — never a value, or the whole page re-renders at
   * 20 Hz for a 2 px bar movement.
   */
  getMeters(): EngineMeters;
  /** Engine running. When false the bars drain and read as idle. */
  running: boolean;
  className?: string;
}

/**
 * Input / output levels plus compressor gain reduction.
 *
 * This component is `memo`'d and reads its data by polling, so the 20 Hz
 * meter stream never becomes a React update. Smoothing, peak-hold and decay
 * all happen here against DOM refs.
 */
export const MeterBar = memo(function MeterBar({ getMeters, running, className }: MeterBarProps) {
  const inRef = useRef<LevelBarHandle | null>(null);
  const outRef = useRef<LevelBarHandle | null>(null);
  const grFillRef = useRef<HTMLDivElement | null>(null);
  const grValueRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const input: Held = { level: FLOOR, peak: FLOOR, peakAt: 0 };
    const output: Held = { level: FLOOR, peak: FLOOR, peakAt: 0 };
    let gr = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const m = running ? getMeters() : null;
      advance(input, m ? clamp(m.inputPeak, FLOOR, 6) : FLOOR, now, dt);
      advance(output, m ? clamp(m.outputPeak, FLOOR, 6) : FLOOR, now, dt);
      inRef.current?.set(input.level, input.peak);
      outRef.current?.set(output.level, output.peak);

      const targetGr = m ? clamp(-m.reduction, 0, 24) : 0;
      gr += (targetGr - gr) * Math.min(1, dt * 12);
      if (grFillRef.current) {
        grFillRef.current.style.transform = `scaleX(${(gr / 24).toFixed(4)})`;
      }
      if (grValueRef.current) {
        grValueRef.current.textContent = gr < 0.05 ? '0.0' : (-gr).toFixed(1);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getMeters, running]);

  return (
    <div className={cn('space-y-2', className)} role="group" aria-label="Levels">
      <LevelBar ref={inRef} label="In" />
      <LevelBar ref={outRef} label="Out" />

      <div className="flex items-center gap-2.5">
        <span className="legend w-8 shrink-0">GR</span>
        <div className="relative h-[7px] flex-1 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.05]">
          {/* Gain reduction grows from the right, the way hardware shows it. */}
          <div
            ref={grFillRef}
            className="absolute inset-0 origin-right rounded-full bg-ink-3"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
        <span className="num w-10 shrink-0 text-right text-[10.5px] tabular-nums text-ink-3">
          <span ref={grValueRef}>0.0</span>
        </span>
      </div>

      <div className="flex items-center justify-between pl-[42px] pr-[52px]">
        {[-60, -48, -36, -24, -12, -6, 0].map((db) => (
          <span key={db} className="num text-[9px] text-ink-4">
            {db === 0 ? '0' : db}
          </span>
        ))}
      </div>

      {/* Meters are a continuously changing visual; announcing them would be
          noise. The numbers beside each bar carry the same information for
          anyone who wants to read them. */}
      <p className="sr-only">
        Live input and output peak levels in dBFS, with compressor gain reduction. Values are
        shown beside each bar and update continuously.
      </p>
    </div>
  );
});
