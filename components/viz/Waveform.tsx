'use client';

/**
 * components/viz/Waveform.tsx
 *
 * A compact time-domain oscilloscope for the transport bar.
 *
 * At transport-bar height (24–40 px) a single-trace scope is unreadable: one
 * pixel row per 1/30th of the dynamic range, and no trigger, so the trace
 * crawls. Instead this draws the min/max envelope per pixel column — the shape
 * a DAW shows — which is stable without a trigger, legible at 28 px tall, and
 * still a genuine time-domain view rather than a level bar: asymmetric
 * material looks asymmetric.
 *
 * Same rigour as SpectrumScope: dpr-correct backing store, zero per-frame
 * allocation, and the loop parks when hidden, off-screen or sourceless.
 */

import { useCallback, useEffect, useRef, type JSX } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { vizColors, type VizPalette } from './theme';
import { useAnimationLoop, usePrefersReducedMotion } from './useAnimationLoop';
import { hairline, snap, syncCanvasSize, useCanvasMetrics, type CanvasMetrics } from './canvas';

/**
 * Per-column envelope on the min and max edges. 8 ms on the way out, 140 ms on
 * the way back: the outline snaps to a transient immediately and then relaxes,
 * which is what stops the shape shimmering between frames while still letting
 * a drum hit punch. Expressed as time constants so the look does not change
 * with frame rate.
 */
const EDGE_ATTACK_TAU = 0.008;
const EDGE_RELEASE_TAU = 0.140;

/** Idle ripple: a very slow travelling wave, so the bar reads as alive-but-quiet. */
const IDLE_PERIOD = 6.5;

interface WaveLayout {
  version: number;
  cssW: number;
  cssH: number;
  dpr: number;
  cols: number;
  midY: number;
  halfH: number;
  /** Smoothed upper and lower edges, in signal units (-1..1). */
  envMax: Float32Array;
  envMin: Float32Array;
  primed: boolean;
}

function buildWaveLayout(m: CanvasMetrics): WaveLayout | null {
  const cssW = m.cssW;
  const cssH = m.cssH;
  if (cssW < 8 || cssH < 6) return null;
  const cols = Math.max(2, Math.min(2048, Math.round(cssW)));
  return {
    version: m.version,
    cssW,
    cssH,
    dpr: m.dpr,
    cols,
    midY: cssH / 2,
    // Leave a hair of headroom so a full-scale signal does not sit flush
    // against the edges and read as clipping.
    halfH: cssH / 2 - 1.5,
    envMax: new Float32Array(cols),
    envMin: new Float32Array(cols),
    primed: false,
  };
}

interface WaveGradient {
  h: number;
  amount: number;
  fill: CanvasGradient;
}

function buildWaveGradient(
  ctx: CanvasRenderingContext2D,
  L: WaveLayout,
  p: VizPalette,
): WaveGradient {
  // Dim at the extremes, bright through the middle: gives the blob body
  // without a hard edge, and keeps the centre line readable through it.
  const g = ctx.createLinearGradient(0, 0, 0, L.cssH);
  g.addColorStop(0, p.accentDim);
  g.addColorStop(0.5, p.accentSoft);
  g.addColorStop(1, p.accentDim);
  return { h: L.cssH, amount: p.amount, fill: g };
}

/** Signal value -> canvas y, clamped inside the frame. Module scope: a closure
 *  defined per frame would be a per-frame allocation. */
function edgeY(v: number, L: WaveLayout, scale: number): number {
  const y = L.midY - v * scale;
  return y < 0.5 ? 0.5 : y > L.cssH - 0.5 ? L.cssH - 0.5 : y;
}

export interface WaveformProps {
  /** Time-domain tap. Null until the engine has started. */
  analyser: AnalyserNode | null;
  className?: string;
  /** Colour temperature, 0..1. 0 = cold/open, 1 = ember/fully dampened. */
  amount?: number;
  /**
   * Vertical scale. 1 means a full-scale sample reaches the full height.
   * Default 1.6: most dampened material peaks well below full scale, and a
   * flat line in the transport bar looks broken.
   */
  gain?: number;
}

export function Waveform({ analyser, className, amount = 0, gain = 1.6 }: WaveformProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const layoutRef = useRef<WaveLayout | null>(null);
  const gradRef = useRef<WaveGradient | null>(null);
  /**
   * Time-domain scratch, sized to the analyser's fftSize. Reallocated only
   * when fftSize changes, never per frame. Explicit buffer type because
   * `getFloatTimeDomainData` rejects SharedArrayBuffer-backed views.
   */
  const bufRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const nodeRef = useRef<AnalyserNode | null>(null);

  const reducedMotion = usePrefersReducedMotion();

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

      // Read straight from the closure; the loop hook refs this callback, so a
      // prop change rebuilds it without restarting the rAF loop.
      const node = analyser;
      const p = vizColors(amount);
      const g = gain;

      const resized = syncCanvasSize(canvas, ctx, m);
      let L = layoutRef.current;
      if (resized || !L || L.version !== m.version) {
        L = buildWaveLayout(m);
        layoutRef.current = L;
        gradRef.current = null;
      }
      if (!L) return;

      /* ---- sample ------------------------------------------------- */

      if (node) {
        if (nodeRef.current !== node) {
          nodeRef.current = node;
          L.primed = false;
        }
        const n = node.fftSize;
        if (bufRef.current.length !== n) bufRef.current = new Float32Array(n);
        node.getFloatTimeDomainData(bufRef.current);

        const buf = bufRef.current;
        const smooth = dt > 0 && L.primed;
        const kA = smooth ? 1 - Math.exp(-dt / EDGE_ATTACK_TAU) : 1;
        const kR = smooth ? 1 - Math.exp(-dt / EDGE_RELEASE_TAU) : 1;

        for (let c = 0; c < L.cols; c++) {
          // Integer sample slice for this column. Rounded, not floored, so the
          // last column still reaches the end of the buffer.
          const s0 = Math.round((c * n) / L.cols);
          const s1 = Math.max(s0 + 1, Math.round(((c + 1) * n) / L.cols));
          let lo = buf[s0];
          let hi = lo;
          for (let i = s0 + 1; i < s1 && i < n; i++) {
            const v = buf[i];
            if (v < lo) lo = v;
            else if (v > hi) hi = v;
          }
          // Each edge attacks outward and releases back toward zero.
          const eMax = L.envMax[c];
          L.envMax[c] = eMax + (hi - eMax) * (hi > eMax ? kA : kR);
          const eMin = L.envMin[c];
          L.envMin[c] = eMin + (lo - eMin) * (lo < eMin ? kA : kR);
        }
        L.primed = true;
      } else {
        nodeRef.current = null;
        const phase = reducedMotion ? 0 : (nowMs / 1000) * ((Math.PI * 2) / IDLE_PERIOD);
        for (let c = 0; c < L.cols; c++) {
          // A shallow travelling wave, tapered at both ends so it does not
          // look like a signal that got cut off by the frame.
          const u = c / (L.cols - 1);
          const taper = Math.sin(Math.PI * u);
          const a = reducedMotion ? 0.012 : 0.03 * taper * Math.sin(phase + u * Math.PI * 2);
          L.envMax[c] = Math.abs(a);
          L.envMin[c] = -Math.abs(a);
        }
        L.primed = false;
      }

      /* ---- paint -------------------------------------------------- */

      let grad = gradRef.current;
      if (!grad || grad.h !== L.cssH || grad.amount !== p.amount) {
        grad = buildWaveGradient(ctx, L, p);
        gradRef.current = grad;
      }

      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, L.cssW, L.cssH);

      const hw = hairline(L.dpr);
      const midSnapped = snap(L.midY, L.dpr);
      ctx.strokeStyle = p.hairline;
      ctx.lineWidth = hw;
      ctx.beginPath();
      ctx.moveTo(0, midSnapped);
      ctx.lineTo(L.cssW, midSnapped);
      ctx.stroke();

      const step = L.cssW / L.cols;
      const scale = L.halfH * g;

      // One closed polygon: along the top edge, back along the bottom edge.
      ctx.beginPath();
      ctx.moveTo(0, edgeY(L.envMax[0], L, scale));
      for (let c = 0; c < L.cols; c++) ctx.lineTo((c + 0.5) * step, edgeY(L.envMax[c], L, scale));
      ctx.lineTo(L.cssW, edgeY(L.envMax[L.cols - 1], L, scale));
      ctx.lineTo(L.cssW, edgeY(L.envMin[L.cols - 1], L, scale));
      for (let c = L.cols - 1; c >= 0; c--) {
        ctx.lineTo((c + 0.5) * step, edgeY(L.envMin[c], L, scale));
      }
      ctx.lineTo(0, edgeY(L.envMin[0], L, scale));
      ctx.closePath();

      ctx.fillStyle = grad.fill;
      ctx.fill();
      // Stroking the same path outlines both edges in one pass.
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(hw, 1);
      ctx.strokeStyle = node ? p.liveStroke : p.idle;
      ctx.stroke();
    },
    [metricsRef, analyser, amount, gain, reducedMotion],
  );

  // With reduced motion and no source, nothing can change: park completely.
  const { requestFrame } = useAnimationLoop({
    onFrame,
    target: hostRef,
    enabled: analyser !== null || !reducedMotion,
    fps: analyser ? 0 : 20,
    reducedFps: 10,
  });
  useEffect(() => {
    requestFrameRef.current = requestFrame;
  }, [requestFrame]);

  useEffect(() => {
    requestFrame();
  }, [requestFrame, analyser, amount, gain, reducedMotion]);

  return (
    <div
      ref={hostRef}
      className={twMerge(
        clsx('relative block h-7 min-h-5 w-full overflow-hidden rounded-sm'),
        className,
      )}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
    </div>
  );
}

export default Waveform;
