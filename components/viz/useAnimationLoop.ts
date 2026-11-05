'use client';

/**
 * components/viz/useAnimationLoop.ts
 *
 * One correct requestAnimationFrame loop, shared by every visualiser.
 *
 * Everything that can legitimately stop a canvas loop is handled here, in one
 * place, so the three components cannot drift out of sync with each other:
 *
 *   - `enabled === false`                  (no audio source, nothing to draw)
 *   - the element is scrolled out of view  (IntersectionObserver)
 *   - the tab is hidden                    (document.visibilitychange)
 *   - prefers-reduced-motion               (frame rate dropped, not stopped)
 *
 * The loop is *parked*, not torn down, when gating goes false — a park is a
 * single `cancelAnimationFrame`, and resuming costs one `requestAnimationFrame`.
 *
 * React 19 StrictMode double-mounts every effect. This hook is written to be
 * idempotent under that: the raf handle lives in a ref and `schedule()` refuses
 * to queue a second frame while one is already pending, so a double mount can
 * never leave two loops racing. Cleanup cancels the pending frame and
 * disconnects every observer and listener.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

/** Server snapshot: assume motion is fine, then correct on hydration. */
function readReducedMotionServer(): boolean {
  return false;
}

/**
 * Live value of `(prefers-reduced-motion: reduce)`.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the media query
 * genuinely is external state, and subscribing this way avoids the extra
 * render pass (and the cascading-render hazard) of setting state from an
 * effect on mount, while still giving a stable server snapshot for hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, readReducedMotionServer);
}

export interface AnimationLoopOptions {
  /**
   * Called once per frame.
   *
   * @param nowMs  `performance.now()`-based timestamp from rAF.
   * @param dt     Seconds since the previous frame, clamped to [0, 0.1].
   *               Zero on the first frame after a (re)start and on a one-shot
   *               `requestFrame()` — so time-based envelopes snap to the data
   *               instead of jumping when the loop resumes after being parked.
   */
  onFrame: (nowMs: number, dt: number) => void;

  /** The element whose on-screen visibility gates the loop. */
  target: React.RefObject<Element | null>;

  /** Default true. False parks the loop (one static frame is still painted). */
  enabled?: boolean;

  /**
   * Frame-rate cap in fps. Omit (or 0) to run at display refresh rate.
   * A cap is honoured by skipping work on frames that arrive too early — the
   * rAF itself keeps ticking, which is the only way to stay in step with the
   * compositor.
   */
  fps?: number;

  /** Frame-rate cap applied when the user prefers reduced motion. */
  reducedFps?: number;
}

export interface AnimationLoop {
  /** Live value of `(prefers-reduced-motion: reduce)`. */
  reducedMotion: boolean;
  /**
   * Paint exactly one frame, now-ish, even while the loop is parked. Used for
   * the static empty state and after a resize. No-ops if a frame is already
   * pending, so it is safe to call from a ResizeObserver.
   */
  requestFrame: () => void;
}

export function useAnimationLoop(options: AnimationLoopOptions): AnimationLoop {
  const { target, enabled = true, fps = 0, reducedFps = 10 } = options;

  // Latest-callback ref, so that an inline arrow function in the caller does
  // not tear down and restart the loop on every render. Synced in an effect,
  // never during render — a render can be discarded under concurrent
  // rendering, and writing refs there is unsafe as well as a lint error.
  const onFrameRef = useRef(options.onFrame);
  useEffect(() => {
    onFrameRef.current = options.onFrame;
  });

  const reducedMotion = usePrefersReducedMotion();

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const lastDrawRef = useRef<number>(0);
  /** Set by the effect; lets `requestFrame` reach into the live loop state. */
  const oneShotRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = target.current;

    // Visibility is a mutable local, not state: flipping it must park or
    // resume the loop, never re-render the component.
    let intersecting = true;
    let disposed = false;

    const cap = reducedMotion ? reducedFps : fps;
    const minInterval = cap > 0 ? 1000 / cap : 0;

    const frame = (ts: number): void => {
      rafRef.current = null;
      if (disposed) return;

      // Re-arm first: an exception thrown by onFrame must not kill the loop
      // permanently, and scheduling early keeps us on the compositor's rhythm.
      schedule();

      // Allow a 0.5 ms slop so a cap of 10 fps is not silently halved by
      // frames landing a hair under the interval.
      if (minInterval > 0 && ts - lastDrawRef.current < minInterval - 0.5) return;
      lastDrawRef.current = ts;

      const prev = lastTsRef.current;
      const dt = prev === 0 ? 0 : Math.max(0, Math.min(0.1, (ts - prev) / 1000));
      lastTsRef.current = ts;

      onFrameRef.current(ts, dt);
    };

    function schedule(): void {
      if (disposed || rafRef.current !== null) return;
      if (!enabled || !intersecting || document.hidden) return;
      rafRef.current = requestAnimationFrame(frame);
    }

    function park(): void {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Forget the timebase, so the first frame after a resume reports dt 0
      // rather than a multi-second delta that would snap every envelope.
      lastTsRef.current = 0;
    }

    const sync = (): void => {
      if (enabled && intersecting && !document.hidden) schedule();
      else park();
    };

    // One-shot paint, used while parked. dt is 0, so nothing animates.
    const oneShot = (): void => {
      if (disposed || rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame((ts) => {
        rafRef.current = null;
        if (disposed) return;
        lastTsRef.current = 0;
        lastDrawRef.current = ts;
        onFrameRef.current(ts, 0);
        // If gating turned favourable meanwhile, pick the loop back up.
        sync();
      });
    };
    oneShotRef.current = oneShot;

    const io: IntersectionObserver | null =
      el && typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) intersecting = entry.isIntersecting;
              sync();
            },
            // A small positive margin so a visualiser sliding into view is
            // already running by the time the user can see it.
            { rootMargin: '64px' },
          )
        : null;
    if (io && el) io.observe(el);

    const onVisibility = (): void => sync();
    document.addEventListener('visibilitychange', onVisibility);

    sync();
    // Always paint at least one frame, even when parked, so a disabled
    // visualiser still shows its grid and empty state rather than a void.
    if (!enabled || document.hidden) oneShot();

    return () => {
      disposed = true;
      park();
      oneShotRef.current = null;
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `target` is a ref object with a stable identity; `onFrame` is read
    // through a ref. Only the gating inputs belong here.
  }, [target, enabled, fps, reducedFps, reducedMotion]);

  const requestFrame = useCallback(() => {
    oneShotRef.current?.();
  }, []);

  return { reducedMotion, requestFrame };
}
