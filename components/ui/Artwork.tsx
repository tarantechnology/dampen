'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { SpotifyImage } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';
import { hashString } from './accent';

/**
 * A deterministic cover for anything with no artwork — a local file, a
 * playlist Spotify never generated a mosaic for, or the /design route.
 *
 * Deliberately a quiet two-tone wash rather than a multi-stop gradient:
 * covers sit next to real album art, and anything busier announces itself as
 * a placeholder.
 */
export function proceduralCover(seed: string): React.CSSProperties {
  const h = hashString(seed);
  const hue = h % 360;
  const second = (hue + 18 + ((h >> 7) % 28)) % 360;
  const angle = 145 + ((h >> 3) % 60);
  return {
    background: `linear-gradient(${angle}deg, hsl(${hue} 22% 48%), hsl(${second} 18% 24%))`,
  };
}

/** Pick the smallest image that still covers the rendered width. */
function pickImage(images: SpotifyImage[], target: number): SpotifyImage | null {
  if (images.length === 0) return null;
  const sized = images
    .filter((i) => typeof i.width === 'number' && i.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return sized.find((i) => (i.width ?? 0) >= target) ?? sized[sized.length - 1] ?? images[0];
}

export interface ArtworkProps {
  images: SpotifyImage[];
  /** Describes the thing, e.g. "Immunity by Jon Hopkins". */
  alt: string;
  /** Seeds the procedural fallback. Usually the album or playlist title. */
  seed: string;
  /** `sizes` for next/image, and the hint used to pick a CDN variant. */
  sizes: string;
  /** Rendered width in CSS px at the largest breakpoint — picks the variant. */
  targetWidth: number;
  /** Skip lazy loading for the one piece of art above the fold. */
  eager?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Artwork({
  images,
  alt,
  seed,
  sizes,
  targetWidth,
  eager = false,
  className,
  children,
}: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const chosen = failed ? null : pickImage(images, targetWidth);

  return (
    <div
      className={cn('relative isolate overflow-hidden bg-fill-2', className)}
      style={chosen ? undefined : proceduralCover(seed)}
    >
      {chosen ? (
        <Image
          src={chosen.url}
          alt={alt}
          fill
          sizes={sizes}
          onError={() => setFailed(true)}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          className="object-cover"
        />
      ) : (
        <span className="sr-only">{alt}</span>
      )}
      {children}
    </div>
  );
}
