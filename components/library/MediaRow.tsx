'use client';

import type { SpotifyImage } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { Artwork } from '@/components/ui/Artwork';

export interface MediaRowProps {
  images: SpotifyImage[];
  seed: string;
  title: string;
  subtitle?: string;
  /** Right-aligned, quiet: a duration, a track count. */
  trailing?: string;
  /** Round the thumbnail — artists only. */
  round?: boolean;
  /** The row is the thing currently playing. */
  current?: boolean;
  className?: string;
}

/**
 * The one row shape used by every list in the sidebar: thumbnail, two lines
 * of text, an optional quiet value on the right. No borders, no card — the
 * hover fill is the only affordance.
 */
export function MediaRow({
  images,
  seed,
  title,
  subtitle,
  trailing,
  round = false,
  current = false,
  className,
}: MediaRowProps) {
  return (
    <div className={cn('flex h-[52px] w-full items-center gap-2.5 px-2', className)}>
      <Artwork
        images={images}
        alt={title}
        seed={seed}
        sizes="36px"
        targetWidth={72}
        className={cn('size-9 shrink-0', round ? 'rounded-full' : 'rounded-[4px]')}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[13.5px] leading-tight',
            current ? 'font-medium text-accent' : 'text-t1',
          )}
        >
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-[12px] leading-tight text-t3">
            {subtitle}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <span className="num shrink-0 text-[11.5px] text-t3">{trailing}</span>
      ) : null}
    </div>
  );
}
