import { cn } from '@/lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `text` adds a slightly shorter height and full rounding. */
  shape?: 'block' | 'text' | 'circle';
  /** Staggers the shimmer so a stack of rows breathes rather than pulses. */
  delayMs?: number;
}

/**
 * Shimmer placeholder. Dimensions are always supplied by the caller so the
 * skeleton occupies exactly the space the real content will — nothing in
 * Dampen is allowed to shift when data lands.
 */
export function Skeleton({ shape = 'block', delayMs = 0, className, style, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-white/[0.055]',
        shape === 'circle' ? 'rounded-full' : shape === 'text' ? 'h-3 rounded-full' : 'rounded-lg',
        className,
      )}
      style={{ animationDelay: delayMs ? `${delayMs}ms` : undefined, ...style }}
      {...rest}
    />
  );
}

/** A single track row placeholder, dimensionally identical to TrackRow. */
export function TrackRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="flex h-14 items-center gap-3 px-2">
      <Skeleton className="size-10 shrink-0 rounded-md" delayMs={index * 70} />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton shape="text" className="w-[52%]" delayMs={index * 70} />
        <Skeleton shape="text" className="h-2.5 w-[32%]" delayMs={index * 70 + 40} />
      </div>
      <Skeleton shape="text" className="h-2.5 w-9 shrink-0" delayMs={index * 70} />
    </div>
  );
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading tracks" className="py-1">
      {Array.from({ length: rows }, (_, i) => (
        <TrackRowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading playlists"
      className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2.5">
          <Skeleton className="aspect-square w-full rounded-xl" delayMs={i * 80} />
          <Skeleton shape="text" className="w-3/4" delayMs={i * 80} />
          <Skeleton shape="text" className="h-2.5 w-1/2" delayMs={i * 80 + 40} />
        </div>
      ))}
    </div>
  );
}

export function ArtistRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading artists" className="flex gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[88px] shrink-0 space-y-2">
          <Skeleton shape="circle" className="size-[88px]" delayMs={i * 80} />
          <Skeleton shape="text" className="mx-auto w-3/4" delayMs={i * 80} />
        </div>
      ))}
    </div>
  );
}
