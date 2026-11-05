'use client';

/**
 * components/viz/LevelMeter.tsx
 *
 * A thin dBFS level meter, driven imperatively.
 *
 * The engine publishes meters at ~20 Hz. Routing that through React state
 * would re-render this component — and therefore anything that owns it — 20
 * times a second for a value that only ever lands in a canvas. So the level
 * comes in through an imperative handle:
 *
 *     const meter = useRef<LevelMeterHandle>(null);
 *     meter.current?.setLevel(meters.outputPeak);
 *
 * `setLevel` writes one number into a ref. It never sets state, never
 * re-renders, and is safe to call from an interval, a worklet message handler
 * or an rAF callback. Everything visible is produced by this component's own
 * animation loop, which interpolates between the 20 Hz updates so the bar
 * moves smoothly rather than in steps.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, type JSX, type Ref } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { VIZ_FONT, vizColors, type VizPalette } from './theme';
import { useAnimationLoop } from './useAnimationLoop';
import { hairline, snap, syncCanvasSize, useCanvasMetrics, type CanvasMetrics } from './canvas';

/**
 * Meter ballistics, in dB-domain time constants.
 *
 * 20 ms rise: effectively instant at 20 Hz updates, which is what makes this a
 * peak meter rather than a VU — you see the transient, not an average.
 *
 * 420 ms fall: slow enough to read a number off the bar, fast enough to follow
 * a fade. This is close to the IEC 60268-18 peak-programme fall rate (20 dB in
 * ~1.7 s) without pretending to be a certified instrument.
 */
const RISE_TAU = 0.020;
const FALL_TAU = 0.420;

/** Peak marker: hold, then fall at a constant dB/s. Standard studio behaviour. */
const PEAK_HOLD_MS = 1300;
const PEAK_FALL_DB_PER_S = 22;

/** Treat this and above as "over". Peak marker turns red and latches briefly. */
const OVER_DB = -0.3;
const OVER_LATCH_MS = 900;

const TICK_FONT = `8px ${VIZ_FONT}`;

export interface LevelMeterHandle {
  /**
   * Push a new level in dBFS. -Infinity and NaN are accepted and read as
   * silence. Cheap enough to call at any rate; nothing re-renders.
   */
  setLevel(db: number): void;
}

export interface LevelMeterProps {
  ref?: Ref<LevelMeterHandle>;
  /** Default 'horizontal'. */
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  /** Colour temperature, 0..1. 0 = cold/open, 1 = ember/fully dampened. */
  amount?: number;
  /** Bottom (or left) of the scale, dBFS. Default -60. */
  minDb?: number;
  /** Top (or right) of the scale, dBFS. Default 0. */
  maxDb?: number;
  /**
   * Scale marks, dBFS. Default [-18, -6]: -18 is the nominal alignment level
   * Dampen mixes to, -6 is the "getting loud" line.
   */
  ticks?: readonly number[];
  /** Draw the dB numbers next to the marks. Default false — it is a thin meter. */
  showTickLabels?: boolean;
  /** Accessible name. */
  label?: string;
}

interface MeterLayout {
  version: number;
  cssW: number;
  cssH: number;
  dpr: number;
  vertical: boolean;
  /** Along-axis extent in CSS px (height when vertical, width when not). */
  span: number;
  /** Across-axis extent. */
  girth: number;
}

function buildMeterLayout(m: CanvasMetrics, vertical: boolean): MeterLayout | null {
  if (m.cssW < 3 || m.cssH < 3) return null;
  return {
    version: m.version,
    cssW: m.cssW,
    cssH: m.cssH,
    dpr: m.dpr,
    vertical,
    span: vertical ? m.cssH : m.cssW,
    girth: vertical ? m.cssW : m.cssH,
  };
}

interface MeterGradient {
  span: number;
  vertical: boolean;
  amount: number;
  fill: CanvasGradient;
}

function buildMeterGradient(
  ctx: CanvasRenderingContext2D,
  L: MeterLayout,
  p: VizPalette,
): MeterGradient {
  // Runs along the scale, so the hot end of the meter is literally the hot
  // end of the ramp. Created once per size/amount, never per frame.
  const g = L.vertical
    ? ctx.createLinearGradient(0, L.cssH, 0, 0)
    : ctx.createLinearGradient(0, 0, L.cssW, 0);
  g.addColorStop(0, p.meterFillLow);
  g.addColorStop(0.72, p.meterFillLow);
  g.addColorStop(1, p.meterFillHigh);
  return { span: L.span, vertical: L.vertical, amount: p.amount, fill: g };
}

export function LevelMeter({
  ref,
  orientation = 'horizontal',
  className,
  amount = 0,
  minDb = -60,
  maxDb = 0,
  ticks = [-18, -6],
  showTickLabels = false,
  label = 'Output level',
}: LevelMeterProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const layoutRef = useRef<MeterLayout | null>(null);
  const gradRef = useRef<MeterGradient | null>(null);

  /**
   * The imperative input. Written by setLevel, read by the frame loop.
   * Deliberately unclamped: clamping happens in the loop, which always has the
   * current props, so the handle needs no knowledge of the scale at all.
   */
  const targetRef = useRef<number>(Number.NEGATIVE_INFINITY);
  /** Smoothed bar level. */
  const levelRef = useRef<number>(minDb);
  /** Peak marker and its hold deadline. */
  const peakRef = useRef<number>(minDb);
  const peakHoldRef = useRef<number>(0);
  const overUntilRef = useRef<number>(0);
  /** Last time the aria-valuenow attribute was refreshed. */
  const ariaAtRef = useRef<number>(0);

  // Stable handle: the identity never changes, so a consumer can capture
  // `ref.current` once and call it from an interval forever. `[]` deps are
  // correct precisely because the implementation touches nothing but a ref —
  // no state, no props, no render.
  useImperativeHandle(
    ref,
    () => ({
      setLevel(db: number): void {
        targetRef.current = Number.isFinite(db) ? db : Number.NEGATIVE_INFINITY;
      },
    }),
    [],
  );

  const requestFrameRef = useRef<(() => void) | null>(null);
  const onResize = useCallback(() => requestFrameRef.current?.(), []);
  const metricsRef = useCanvasMetrics(hostRef, onResize);

  const onFrame = useCallback(
    (nowMs: number, dt: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let ctx = ctxRef.current;
      if (!ctx || ctx.canvas !== canvas) {
        ctx = canvas.getContext('2d', { alpha: false });
        ctxRef.current = ctx;
      }
      if (!ctx) return;

      const m = metricsRef.current;
      if (m.cssW <= 0 || m.cssH <= 0) return;

      const vertical = orientation === 'vertical';
      const lo = minDb;
      const hi = maxDb;
      const range = hi - lo || 1;

      const resized = syncCanvasSize(canvas, ctx, m);
      let L = layoutRef.current;
      if (resized || !L || L.version !== m.version || L.vertical !== vertical) {
        L = buildMeterLayout(m, vertical);
        layoutRef.current = L;
        gradRef.current = null;
      }
      if (!L) return;

      const p = vizColors(amount);

      /* ---- ballistics ---------------------------------------------- */

      const target = Math.max(lo, Math.min(hi + 6, targetRef.current));
      const cur = levelRef.current;
      const k =
        dt > 0 ? 1 - Math.exp(-dt / (target > cur ? RISE_TAU : FALL_TAU)) : 1;
      const level = cur + (target - cur) * k;
      levelRef.current = level;

      if (level >= peakRef.current) {
        peakRef.current = level;
        peakHoldRef.current = nowMs + PEAK_HOLD_MS;
      } else if (nowMs > peakHoldRef.current && dt > 0) {
        peakRef.current = Math.max(lo, peakRef.current - PEAK_FALL_DB_PER_S * dt);
      }
      if (level >= OVER_DB) overUntilRef.current = nowMs + OVER_LATCH_MS;
      const over = nowMs < overUntilRef.current;

      /* ---- paint --------------------------------------------------- */

      let grad = gradRef.current;
      if (
        !grad ||
        grad.span !== L.span ||
        grad.vertical !== L.vertical ||
        grad.amount !== p.amount
      ) {
        grad = buildMeterGradient(ctx, L, p);
        gradRef.current = grad;
      }

      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, L.cssW, L.cssH);
      ctx.fillStyle = p.meterBody;
      ctx.fillRect(0, 0, L.cssW, L.cssH);

      // dB -> along-axis pixels. Linear in dB: the only scale a reader can do
      // arithmetic on, and the one every studio meter uses.
      const fill = ((level - lo) / range) * L.span;
      const peakPos = ((peakRef.current - lo) / range) * L.span;

      if (vertical) {
        ctx.fillStyle = grad.fill;
        ctx.fillRect(0, L.cssH - fill, L.cssW, fill);
      } else {
        ctx.fillStyle = grad.fill;
        ctx.fillRect(0, 0, fill, L.cssH);
      }

      // Scale marks, drawn over the fill so they stay readable when lit.
      const hw = hairline(L.dpr);
      ctx.lineWidth = hw;
      ctx.strokeStyle = p.hairline;
      ctx.beginPath();
      for (const t of ticks) {
        if (t <= lo || t >= hi) continue;
        const q = ((t - lo) / range) * L.span;
        if (vertical) {
          const y = snap(L.cssH - q, L.dpr);
          ctx.moveTo(0, y);
          ctx.lineTo(L.cssW, y);
        } else {
          const x = snap(q, L.dpr);
          ctx.moveTo(x, 0);
          ctx.lineTo(x, L.cssH);
        }
      }
      ctx.stroke();

      if (showTickLabels) {
        ctx.font = TICK_FONT;
        ctx.fillStyle = p.label;
        for (const t of ticks) {
          if (t <= lo || t >= hi) continue;
          const q = ((t - lo) / range) * L.span;
          if (vertical) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(t), L.cssW / 2, L.cssH - q - 1);
          } else {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(String(t), q + 2, 1);
          }
        }
      }

      // Keep the accessibility tree roughly honest without writing a DOM
      // attribute 30 times a second: 2 Hz is plenty for a screen reader and
      // costs nothing.
      if (nowMs - ariaAtRef.current > 500) {
        ariaAtRef.current = nowMs;
        hostRef.current?.setAttribute('aria-valuenow', level.toFixed(1));
      }

      // The peak marker: a 2-physical-pixel bar, so it stays visible at any
      // dpr without ever looking like part of the fill.
      if (peakRef.current > lo + 0.25) {
        ctx.fillStyle = over ? p.meterOver : p.meterPeak;
        const thick = Math.max(2 / L.dpr, 1.5);
        if (vertical) {
          const y = Math.max(0, Math.min(L.cssH - thick, L.cssH - peakPos - thick / 2));
          ctx.fillRect(0, y, L.cssW, thick);
        } else {
          const x = Math.max(0, Math.min(L.cssW - thick, peakPos - thick / 2));
          ctx.fillRect(x, 0, thick, L.cssH);
        }
      }
    },
    [metricsRef, orientation, amount, minDb, maxDb, ticks, showTickLabels],
  );

  // Always animating: the level can change at any moment and we have no signal
  // that it will not. 30 fps is an even divisor of a 60 Hz display (so the
  // cadence is regular) and is indistinguishable from 60 for a bar this size.
  const { requestFrame } = useAnimationLoop({
    onFrame,
    target: hostRef,
    fps: 30,
    reducedFps: 10,
  });
  useEffect(() => {
    requestFrameRef.current = requestFrame;
  }, [requestFrame]);

  useEffect(() => {
    requestFrame();
  }, [requestFrame, orientation, amount, minDb, maxDb, ticks, showTickLabels]);

  return (
    <div
      ref={hostRef}
      role="meter"
      aria-label={label}
      aria-valuemin={minDb}
      aria-valuemax={maxDb}
      // Refreshed imperatively at ~2 Hz from the frame loop; this is the
      // at-rest value so the ARIA node is never missing the attribute.
      aria-valuenow={minDb}
      className={twMerge(
        clsx(
          'relative block overflow-hidden rounded-sm',
          orientation === 'vertical' ? 'h-24 w-1.5' : 'h-1.5 w-24',
        ),
        className,
      )}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
    </div>
  );
}

export default LevelMeter;
