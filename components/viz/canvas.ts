'use client';

/**
 * components/viz/canvas.ts
 *
 * devicePixelRatio bookkeeping, shared by every visualiser.
 *
 * Two rules drive this file:
 *
 * 1. The backing store is sized in *device* pixels (`clientWidth * dpr`) and
 *    the context is scaled by `dpr`, so all drawing code can work in CSS
 *    pixels without thinking about it. Resizing a canvas resets its transform,
 *    so the scale has to be re-applied every time the size actually changes.
 *
 * 2. A hairline must be exactly one physical pixel. That needs two things:
 *    a line width of `1 / dpr` in CSS-pixel space, and a coordinate landing on
 *    a device-pixel *centre* — otherwise the rasteriser splits the line across
 *    two rows and you get the grey mush that makes canvas charts look cheap on
 *    a Retina display. `snap()` does the centring.
 *
 * Size is reported through a ref, not through state. A ResizeObserver that
 * calls setState re-renders the tree on every drag of a window edge, and the
 * draw loop would then have to read `clientWidth` per frame, which forces a
 * layout. Instead the observer writes into a ref and bumps a version counter;
 * the draw loop compares versions and rebuilds its geometry only when it
 * changed.
 */

import { useEffect, useRef, type RefObject } from 'react';

export interface CanvasMetrics {
  /** Layout size in CSS pixels. */
  cssW: number;
  cssH: number;
  /** Device pixels per CSS pixel at the moment of measurement. */
  dpr: number;
  /** Bumped whenever any of the above changes. */
  version: number;
}

/**
 * Observe an element's layout size and the current devicePixelRatio.
 *
 * @param onChange Called after the metrics ref has been updated. Use it to
 *                 request a repaint; do not use it to set state.
 */
export function useCanvasMetrics(
  ref: RefObject<HTMLElement | null>,
  onChange?: () => void,
): RefObject<CanvasMetrics> {
  const metrics = useRef<CanvasMetrics>({ cssW: 0, cssH: 0, dpr: 1, version: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = (): void => {
      const dpr = window.devicePixelRatio || 1;
      // Round *down* to whole CSS pixels: a fractional layout width would make
      // the right-hand edge land mid-device-pixel and soften the frame.
      const cssW = Math.max(0, Math.floor(el.clientWidth));
      const cssH = Math.max(0, Math.floor(el.clientHeight));
      const m = metrics.current;
      if (m.cssW === cssW && m.cssH === cssH && m.dpr === dpr) return;
      m.cssW = cssW;
      m.cssH = cssH;
      m.dpr = dpr;
      m.version++;
      onChangeRef.current?.();
    };

    read();

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(el);

    // devicePixelRatio changes when the window moves to another display or the
    // user zooms. Zoom fires `resize`; a display change does not reliably, so
    // watch the resolution media query as well.
    window.addEventListener('resize', read);
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        : null;
    mql?.addEventListener('change', read);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', read);
      mql?.removeEventListener('change', read);
    };
  }, [ref]);

  return metrics;
}

/**
 * Resize the backing store if needed and (re)apply the dpr transform.
 *
 * @returns true if the backing store was resized — the caller must then
 *          rebuild any size-dependent geometry, gradients and cached layers.
 */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  m: CanvasMetrics,
): boolean {
  const w = Math.max(1, Math.round(m.cssW * m.dpr));
  const h = Math.max(1, Math.round(m.cssH * m.dpr));
  if (canvas.width === w && canvas.height === h) return false;

  canvas.width = w;
  canvas.height = h;
  // Writing width/height clears the bitmap AND resets the transform, so the
  // dpr scale has to go back on afterwards.
  ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  return true;
}

/**
 * Nudge a CSS-pixel coordinate onto the centre of a device pixel, so a line of
 * width `1 / dpr` drawn there covers exactly one physical pixel row/column.
 */
export function snap(v: number, dpr: number): number {
  return (Math.round(v * dpr) + 0.5) / dpr;
}

/** A line width of exactly one physical pixel, expressed in CSS pixels. */
export function hairline(dpr: number): number {
  return 1 / dpr;
}

/** Create a detached canvas used as a cached layer, or null if 2D is refused. */
export function createLayer(
  w: number,
  h: number,
  dpr: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}
