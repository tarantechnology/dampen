'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { SpotifyImage } from '@/lib/spotify/types';
import { cn } from '@/lib/cn';

/* A grain layer, so procedural covers don't read as flat CSS gradients. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/><feColorMatrix type="saturate" values="0"/></filter><rect width="120" height="120" filter="url(#n)" opacity="0.5"/></svg>',
)}")`;

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * A deterministic cover for anything with no artwork — a local file, a
 * playlist Spotify never generated a mosaic for, or the whole design route.
 * Same title always yields the same cover, so lists stay stable.
 */
export function proceduralCover(seed: string): React.CSSProperties {
  const h = hash(seed);
  const hueA = h % 360;
  const hueB = (hueA + 40 + (h >> 8) % 140) % 360;
  const angle = (h >> 4) % 360;
  return {
    background: [
      `radial-gradient(130% 120% at 18% 12%, oklch(0.68 0.15 ${hueA}) 0%, transparent 58%)`,
      `radial-gradient(110% 110% at 85% 88%, oklch(0.5 0.17 ${hueB}) 0%, transparent 62%)`,
      `conic-gradient(from ${angle}deg at 50% 50%, oklch(1 0 0 / 0.1), transparent 22%, oklch(0 0 0 / 0.3) 58%, transparent 85%)`,
      `linear-gradient(160deg, oklch(0.3 0.06 ${hueA}), oklch(0.17 0.04 ${hueB}))`,
    ].join(','),
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
  /** Rendered on top of the art — the hover play button, for example. */
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
      className={cn(
        'relative isolate overflow-hidden bg-surface-2',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]',
        'after:ring-1 after:ring-inset after:ring-white/[0.08]',
        className,
      )}
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
        <>
          <span
            aria-hidden
            className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
            style={{ backgroundImage: GRAIN, backgroundSize: '120px 120px' }}
          />
          <span className="sr-only">{alt}</span>
        </>
      )}
      {children}
    </div>
  );
}
