'use client';

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fades the top/bottom edges while there is more content that way. */
  fade?: boolean;
}

/**
 * A plain overflow container with slim scrollbars and optional edge fades.
 * Deliberately not a virtual scroller — `TrackList` does its own windowing
 * over whichever element it is given.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { fade = true, className, children, onScroll, ...rest },
  ref,
) {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const raf = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Measure on mount and whenever the content resizes, so the bottom fade is
  // correct before the user has scrolled at all.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !fade) return;
    const measure = () => {
      setEdges({
        top: el.scrollTop > 4,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [fade, children]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e);
      if (!fade) return;
      const el = e.currentTarget;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const top = el.scrollTop > 4;
        const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
        setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
      });
    },
    [fade, onScroll],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={(node) => {
          viewportRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        onScroll={handleScroll}
        className={cn('scroll-slim h-full overflow-y-auto overscroll-contain', className)}
        {...rest}
      >
        {children}
      </div>
      {fade ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[var(--surface)] to-transparent transition-opacity duration-200"
            style={{ opacity: edges.top ? 1 : 0 }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--surface)] to-transparent transition-opacity duration-200"
            style={{ opacity: edges.bottom ? 1 : 0 }}
          />
        </>
      ) : null}
    </div>
  );
});
